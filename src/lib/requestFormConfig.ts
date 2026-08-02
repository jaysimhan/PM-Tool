import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabaseClient';

/**
 * The shared definition of "what the request form looks like".
 *
 * One row per field in request_form_fields, read by three places that must agree:
 * the Customize Request Form modal (which edits it), the internal RequestForm, and
 * the public /request/<token> page. Before this existed the modal's field list was a
 * literal array inside RequestForm's JSX and the form ignored it entirely.
 */

export type FieldType =
    | 'text'
    | 'textarea'
    | 'number'
    | 'date'
    | 'select'
    | 'checkbox'
    // Core-only shapes: the tag chip editor and the semantic work-category search box.
    | 'tags'
    | 'picker';

/** Field types an admin is allowed to pick when adding a field of their own. */
export const CUSTOM_FIELD_TYPES: { value: FieldType; label: string }[] = [
    { value: 'text', label: 'Single line text' },
    { value: 'textarea', label: 'Paragraph' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'select', label: 'Dropdown' },
    { value: 'checkbox', label: 'Yes / no' },
];

/** The ten fields backed by a real tasks column. They can be configured, never removed. */
export const CORE_FIELD_KEYS = [
    'title',
    'description',
    'category',
    'client',
    'region',
    'department',
    'priority',
    'dueDate',
    'estimatedHours',
    'tags',
] as const;

export type CoreFieldKey = (typeof CORE_FIELD_KEYS)[number];

export interface RequestFormField {
    id: string;
    fieldKey: string;
    /** null = always on the form; otherwise it appears only for that work category. */
    skillId: string | null;
    label: string;
    placeholder: string | null;
    helpText: string | null;
    fieldType: FieldType;
    options: string[];
    defaultValue: string | null;
    enabled: boolean;
    required: boolean;
    position: number;
    isCore: boolean;
    /** Backed by a NOT NULL column, so the toggle is fixed on. */
    locked: boolean;
}

/** A value captured by a custom field, as stored in tasks.custom_fields. */
export type CustomFieldValue = string | number | boolean;

export function parseField(row: any): RequestFormField {
    return {
        id: row.id,
        fieldKey: row.fieldKey,
        skillId: row.skillId ?? null,
        label: row.label,
        placeholder: row.placeholder ?? null,
        helpText: row.helpText ?? null,
        fieldType: row.fieldType,
        options: Array.isArray(row.options) ? row.options.map(String) : [],
        defaultValue: row.defaultValue ?? null,
        enabled: Boolean(row.enabled),
        required: Boolean(row.required),
        position: Number(row.position ?? 0),
        isCore: Boolean(row.isCore),
        locked: Boolean(row.locked),
    };
}

/**
 * The form as it was before any of this was configurable. Used when the config cannot be
 * read -- a signed-out render, a network blip, or a deploy where the migration has not
 * landed yet. Failing back to a blank form would be worse than failing back to the old one.
 */
export const FALLBACK_FIELDS: RequestFormField[] = [
    ['title', 'Request Title', 'text', true, 10, true],
    ['description', 'Description', 'textarea', true, 20, false],
    ['category', 'Work Category', 'picker', true, 30, false],
    ['client', 'Brand', 'select', true, 40, false],
    ['region', 'Region', 'select', true, 50, false],
    ['department', 'Department', 'text', true, 60, false],
    ['priority', 'Priority', 'select', true, 70, false],
    ['dueDate', 'Due Date', 'date', true, 80, false],
    ['estimatedHours', 'Estimated Hours to complete', 'number', false, 90, false],
    ['tags', 'Tags', 'tags', false, 100, false],
].map(([fieldKey, label, fieldType, required, position, locked]) => ({
    id: `fallback-${fieldKey}`,
    fieldKey: fieldKey as string,
    skillId: null,
    label: label as string,
    placeholder: null,
    helpText: null,
    fieldType: fieldType as FieldType,
    options: [],
    defaultValue: fieldKey === 'priority' ? 'normal' : null,
    enabled: true,
    required: required as boolean,
    position: position as number,
    isCore: true,
    locked: locked as boolean,
}));

export async function fetchRequestFormConfig(): Promise<RequestFormField[]> {
    const { data, error } = await supabase.rpc('get_request_form_config');
    if (error) throw new Error(error.message);
    return (data ?? []).map(parseField);
}

interface ConfigState {
    fields: RequestFormField[];
    loading: boolean;
    /** Set when the config could not be read; the fallback form is showing instead. */
    error: string | null;
    reload: () => Promise<void>;
    /** Adopt the rows a save just returned, instead of refetching what we already have. */
    apply: (fields: RequestFormField[]) => void;
}

/** Loads the config once per mount, falling back to the pre-config form on failure. */
export function useRequestFormConfig(): ConfigState {
    const [fields, setFields] = useState<RequestFormField[]>(FALLBACK_FIELDS);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const loaded = await fetchRequestFormConfig();
            // An empty table means the seed never ran; the old form beats no form.
            setFields(loaded.length > 0 ? loaded : FALLBACK_FIELDS);
            setError(null);
        } catch (err: any) {
            console.error('Could not load the request form configuration:', err);
            setFields(FALLBACK_FIELDS);
            setError(err?.message ?? 'The form configuration could not be loaded.');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const apply = useCallback((next: RequestFormField[]) => {
        if (next.length > 0) {
            setFields(next);
            setError(null);
        }
    }, []);

    return { fields, loading, error, reload: load, apply };
}

/** Core fields by key, so callers can ask `core.priority?.enabled` directly. */
export function coreFields(fields: RequestFormField[]): Partial<Record<CoreFieldKey, RequestFormField>> {
    const map: Partial<Record<CoreFieldKey, RequestFormField>> = {};
    for (const field of fields) {
        if (field.isCore && field.skillId === null) {
            map[field.fieldKey as CoreFieldKey] = field;
        }
    }
    return map;
}

/** Is this core field on the form right now? Missing rows default to on. */
export function isOn(fields: RequestFormField[], key: CoreFieldKey): boolean {
    const field = coreFields(fields)[key];
    return field ? field.enabled : true;
}

/**
 * The custom fields to render for a given work category: the ones that are always on the
 * form, plus the ones scoped to that category. Disabled rows never come back.
 */
export function customFieldsFor(
    fields: RequestFormField[],
    skillId: string | null,
): RequestFormField[] {
    return fields
        .filter(
            (f) =>
                !f.isCore &&
                f.enabled &&
                (f.skillId === null || (skillId !== null && f.skillId === skillId)),
        )
        .sort((a, b) => {
            // Base extras first, then the category-specific ones.
            if ((a.skillId === null) !== (b.skillId === null)) return a.skillId === null ? -1 : 1;
            return a.position - b.position || a.label.localeCompare(b.label);
        });
}

/** Starting values for a set of custom fields, honouring each field's default. */
export function defaultCustomValues(fields: RequestFormField[]): Record<string, CustomFieldValue> {
    const values: Record<string, CustomFieldValue> = {};
    for (const field of fields) {
        if (field.fieldType === 'checkbox') {
            values[field.fieldKey] = field.defaultValue === 'true';
        } else {
            values[field.fieldKey] = field.defaultValue ?? '';
        }
    }
    return values;
}

/**
 * Drops answers to fields that are no longer on screen -- changing work category must not
 * quietly submit the previous category's answers.
 */
export function pruneCustomValues(
    values: Record<string, CustomFieldValue>,
    visible: RequestFormField[],
): Record<string, CustomFieldValue> {
    const allowed = new Set(visible.map((f) => f.fieldKey));
    const next: Record<string, CustomFieldValue> = {};
    for (const [key, value] of Object.entries(values)) {
        if (allowed.has(key)) next[key] = value;
    }
    return next;
}

/**
 * The client-side half of the required check. The server enforces the same rules for
 * public submissions; this exists so the requester finds out before a round trip.
 * Returns the label of the first unanswered required field, or null.
 */
export function firstMissingCustomField(
    visible: RequestFormField[],
    values: Record<string, CustomFieldValue>,
): string | null {
    for (const field of visible) {
        if (!field.required) continue;
        const value = values[field.fieldKey];
        if (field.fieldType === 'checkbox') {
            if (value !== true) return field.label;
        } else if (value === undefined || value === null || String(value).trim() === '') {
            return field.label;
        }
    }
    return null;
}

/** Strips blanks so tasks.custom_fields holds answers rather than empty strings. */
export function serializeCustomValues(
    visible: RequestFormField[],
    values: Record<string, CustomFieldValue>,
): Record<string, CustomFieldValue> {
    const payload: Record<string, CustomFieldValue> = {};
    for (const field of visible) {
        const value = values[field.fieldKey];
        if (field.fieldType === 'checkbox') {
            if (value === true) payload[field.fieldKey] = true;
            continue;
        }
        const text = value === undefined || value === null ? '' : String(value).trim();
        if (text === '') continue;
        payload[field.fieldKey] = field.fieldType === 'number' ? Number(text) : text;
    }
    return payload;
}

/** How a stored custom value should read on a task. */
export function formatCustomValue(value: CustomFieldValue | null | undefined): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
}
