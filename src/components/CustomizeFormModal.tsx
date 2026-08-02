import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, ChevronDown, Plus, Settings, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabaseClient';
import { useData } from '../contexts/DataContext';
import { useConfirm } from '../contexts/ConfirmContext';
import {
    CUSTOM_FIELD_TYPES,
    FieldType,
    RequestFormField,
    fetchRequestFormConfig,
} from '../lib/requestFormConfig';

/**
 * The real "Customize Request Form".
 *
 * It edits a draft of request_form_fields and writes the whole draft on Save, so Cancel
 * genuinely discards and there is exactly one write per session. The previous version of
 * this modal was uncontrolled `defaultChecked` toggles, Configure buttons with no handler
 * and a Save that fired a toast -- nothing it showed was connected to the form.
 *
 * Category-specific fields are scoped to skills rather than work_categories: the form's
 * Work Category picker searches skills, and work_categories is empty and unread by the app.
 */

interface Props {
    onClose: () => void;
    /** Lets the request form pick up label/visibility changes without a reload. */
    onSaved: (fields: RequestFormField[]) => void;
    isAdmin: boolean;
}

/** A draft row. New rows have no id until the server assigns one. */
type Draft = Omit<RequestFormField, 'id'> & { id: string | null; localKey: string };

let localKeyCounter = 0;
const nextLocalKey = () => `new-${++localKeyCounter}`;

const toDraft = (field: RequestFormField): Draft => ({ ...field, localKey: field.id });

const slugify = (label: string) => {
    const cleaned = label
        .replace(/[^a-zA-Z0-9 ]/g, ' ')
        .trim()
        .split(/\s+/)
        .map((word, i) => (i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
        .join('');
    return /^[a-z]/.test(cleaned) ? cleaned : `field${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}`;
};

export function CustomizeFormModal({ onClose, onSaved, isAdmin }: Props) {
    const { skills } = useData();
    const { confirm } = useConfirm();

    const [drafts, setDrafts] = useState<Draft[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [expanded, setExpanded] = useState<string | null>(null);
    const [activeSkillId, setActiveSkillId] = useState('');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const fields = await fetchRequestFormConfig();
                if (cancelled) return;
                setDrafts(fields.map(toDraft));
                setLoadError(null);
            } catch (err: any) {
                if (!cancelled) setLoadError(err?.message ?? 'The form configuration could not be loaded.');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    const baseFields = useMemo(
        () => drafts.filter((d) => d.skillId === null).sort((a, b) => a.position - b.position),
        [drafts],
    );
    const categoryFields = useMemo(
        () => drafts.filter((d) => d.skillId === activeSkillId).sort((a, b) => a.position - b.position),
        [drafts, activeSkillId],
    );

    const patch = (localKey: string, changes: Partial<Draft>) =>
        setDrafts((prev) => prev.map((d) => (d.localKey === localKey ? { ...d, ...changes } : d)));

    const addField = (skillId: string | null) => {
        const siblings = drafts.filter((d) => d.skillId === skillId);
        const localKey = nextLocalKey();
        setDrafts((prev) => [
            ...prev,
            {
                id: null,
                localKey,
                fieldKey: '',
                skillId,
                label: '',
                placeholder: null,
                helpText: null,
                fieldType: 'text',
                options: [],
                defaultValue: null,
                enabled: true,
                required: false,
                position: (siblings.reduce((max, s) => Math.max(max, s.position), 100) || 100) + 10,
                isCore: false,
                locked: false,
            },
        ]);
        setExpanded(localKey);
    };

    const removeField = (draft: Draft) => {
        const drop = () => {
            setDrafts((prev) => prev.filter((d) => d.localKey !== draft.localKey));
            if (expanded === draft.localKey) setExpanded(null);
        };
        // A field that was never saved has no answers behind it, so it just disappears.
        if (!draft.id) {
            drop();
            return;
        }
        confirm(
            `Remove "${draft.label || draft.fieldKey}" from the form? Answers already submitted stay on their requests.`,
            drop,
        );
    };

    const handleSave = async () => {
        const unlabelled = drafts.find((d) => d.label.trim() === '');
        if (unlabelled) {
            toast.error('Every field needs a label.');
            setExpanded(unlabelled.localKey);
            return;
        }
        const emptyDropdown = drafts.find((d) => !d.isCore && d.fieldType === 'select' && d.options.length === 0);
        if (emptyDropdown) {
            toast.error(`"${emptyDropdown.label}" is a dropdown with no options.`);
            setExpanded(emptyDropdown.localKey);
            return;
        }

        setSaving(true);
        const payload = drafts.map((d) => ({
            id: d.id,
            fieldKey: d.fieldKey || slugify(d.label),
            skillId: d.skillId,
            label: d.label.trim(),
            placeholder: d.placeholder,
            helpText: d.helpText,
            fieldType: d.fieldType,
            options: d.options,
            defaultValue: d.defaultValue,
            enabled: d.enabled,
            required: d.required,
            position: d.position,
        }));

        const { data, error } = await supabase.rpc('save_request_form_config', { p_fields: payload });
        setSaving(false);

        if (error) {
            toast.error(error.message);
            return;
        }

        const saved: RequestFormField[] = (data ?? []).map((row: any) => ({
            ...row,
            skillId: row.skillId ?? null,
            options: Array.isArray(row.options) ? row.options.map(String) : [],
        }));
        onSaved(saved);
        toast.success('Form configuration saved');
        onClose();
    };

    const renderRow = (draft: Draft) => {
        const isExpanded = expanded === draft.localKey;
        return (
            <div key={draft.localKey} className="bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between p-3">
                    <div className="flex items-center gap-3 min-w-0">
                        <label
                            className={`relative inline-flex items-center shrink-0 ${
                                isAdmin && !draft.locked ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                            }`}
                            title={draft.locked ? 'Every request needs a title.' : undefined}
                        >
                            <input
                                type="checkbox"
                                className="sr-only peer"
                                checked={draft.enabled}
                                disabled={!isAdmin || draft.locked}
                                onChange={(e) =>
                                    patch(draft.localKey, {
                                        enabled: e.target.checked,
                                        // Hidden fields cannot also be mandatory.
                                        required: e.target.checked ? draft.required : false,
                                    })
                                }
                            />
                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                        </label>
                        <div className="min-w-0">
                            <div className="text-sm font-medium text-gray-900 truncate">
                                {draft.label || <span className="text-gray-400 italic">Untitled field</span>}
                            </div>
                            <div className="text-xs text-gray-500">
                                {draft.enabled ? (draft.required ? 'Required field' : 'Optional field') : 'Not shown'}
                                {!draft.isCore && (
                                    <> &middot; {CUSTOM_FIELD_TYPES.find((t) => t.value === draft.fieldType)?.label}</>
                                )}
                            </div>
                        </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                        <button
                            type="button"
                            onClick={() => setExpanded(isExpanded ? null : draft.localKey)}
                            className="text-sm text-blue-600 hover:text-blue-700 flex items-center gap-1 px-2 py-1 rounded"
                        >
                            Configure
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </button>
                        {!draft.isCore && isAdmin && (
                            <button
                                type="button"
                                onClick={() => removeField(draft)}
                                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                title="Remove this field"
                            >
                                <Trash2 className="w-4 h-4" />
                            </button>
                        )}
                    </div>
                </div>

                {isExpanded && (
                    <div className="border-t border-gray-200 p-4 space-y-3 bg-white rounded-b-lg">
                        <div className="grid sm:grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Label</label>
                                <input
                                    type="text"
                                    value={draft.label}
                                    disabled={!isAdmin}
                                    onChange={(e) => patch(draft.localKey, { label: e.target.value })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                    placeholder="What the requester sees"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">
                                    {draft.fieldType === 'select' || draft.fieldType === 'picker'
                                        ? 'Empty-state text'
                                        : 'Placeholder'}
                                </label>
                                <input
                                    type="text"
                                    value={draft.placeholder ?? ''}
                                    disabled={!isAdmin || draft.fieldType === 'checkbox' || draft.fieldType === 'date'}
                                    onChange={(e) => patch(draft.localKey, { placeholder: e.target.value || null })}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:bg-gray-50 disabled:text-gray-400"
                                    placeholder={
                                        draft.fieldType === 'checkbox' || draft.fieldType === 'date'
                                            ? 'Not used for this field type'
                                            : 'Shown while the field is empty'
                                    }
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-medium text-gray-500 mb-1">Helper text</label>
                            <input
                                type="text"
                                value={draft.helpText ?? ''}
                                disabled={!isAdmin}
                                onChange={(e) => patch(draft.localKey, { helpText: e.target.value || null })}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                placeholder="Optional guidance shown under the field"
                            />
                        </div>

                        {!draft.isCore && (
                            <div className="grid sm:grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">Field type</label>
                                    <select
                                        value={draft.fieldType}
                                        disabled={!isAdmin}
                                        onChange={(e) =>
                                            patch(draft.localKey, {
                                                fieldType: e.target.value as FieldType,
                                                defaultValue: null,
                                            })
                                        }
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                    >
                                        {CUSTOM_FIELD_TYPES.map((type) => (
                                            <option key={type.value} value={type.value}>
                                                {type.label}
                                            </option>
                                        ))}
                                    </select>
                                    {draft.id && (
                                        <p className="text-[11px] text-amber-700 mt-1">
                                            Changing the type does not convert answers already submitted.
                                        </p>
                                    )}
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-gray-500 mb-1">
                                        Stored as
                                        <span className="font-normal text-gray-400"> (fixed once saved)</span>
                                    </label>
                                    <input
                                        type="text"
                                        value={draft.fieldKey || slugify(draft.label)}
                                        disabled={!isAdmin || Boolean(draft.id)}
                                        onChange={(e) => patch(draft.localKey, { fieldKey: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono disabled:bg-gray-50 disabled:text-gray-500"
                                        placeholder="fieldKey"
                                    />
                                </div>
                            </div>
                        )}

                        {!draft.isCore && draft.fieldType === 'select' && (
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">
                                    Dropdown options <span className="font-normal">(one per line)</span>
                                </label>
                                <textarea
                                    rows={3}
                                    value={draft.options.join('\n')}
                                    disabled={!isAdmin}
                                    onChange={(e) =>
                                        patch(draft.localKey, {
                                            options: e.target.value
                                                .split('\n')
                                                .map((o) => o.trim())
                                                .filter(Boolean),
                                        })
                                    }
                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm resize-y"
                                    placeholder={'Landscape\nPortrait\nSquare'}
                                />
                            </div>
                        )}

                        <div className="grid sm:grid-cols-2 gap-3 items-end">
                            <div>
                                <label className="block text-xs font-medium text-gray-500 mb-1">Default value</label>
                                {draft.fieldKey === 'priority' ? (
                                    <select
                                        value={draft.defaultValue ?? 'normal'}
                                        disabled={!isAdmin}
                                        onChange={(e) => patch(draft.localKey, { defaultValue: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                    >
                                        <option value="low">Low</option>
                                        <option value="normal">Normal</option>
                                        <option value="high">High</option>
                                        <option value="urgent">Urgent</option>
                                    </select>
                                ) : draft.fieldType === 'checkbox' ? (
                                    <select
                                        value={draft.defaultValue === 'true' ? 'true' : 'false'}
                                        disabled={!isAdmin}
                                        onChange={(e) => patch(draft.localKey, { defaultValue: e.target.value })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                    >
                                        <option value="false">Unticked</option>
                                        <option value="true">Ticked</option>
                                    </select>
                                ) : draft.fieldType === 'select' ? (
                                    <select
                                        value={draft.defaultValue ?? ''}
                                        disabled={!isAdmin}
                                        onChange={(e) => patch(draft.localKey, { defaultValue: e.target.value || null })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                    >
                                        <option value="">No default</option>
                                        {draft.options.map((option) => (
                                            <option key={option} value={option}>
                                                {option}
                                            </option>
                                        ))}
                                    </select>
                                ) : (
                                    <input
                                        type={draft.fieldType === 'number' ? 'number' : draft.fieldType === 'date' ? 'date' : 'text'}
                                        value={draft.defaultValue ?? ''}
                                        // The remaining core fields are lists of live records or a free
                                        // search box; there is no stable literal to default them to.
                                        disabled={
                                            !isAdmin ||
                                            (draft.isCore && !['title', 'description', 'department', 'estimatedHours'].includes(draft.fieldKey))
                                        }
                                        onChange={(e) => patch(draft.localKey, { defaultValue: e.target.value || null })}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm disabled:bg-gray-50 disabled:text-gray-400"
                                        placeholder="Prefilled when the form opens"
                                    />
                                )}
                            </div>
                            <label
                                className={`flex items-center gap-2 pb-2 ${
                                    isAdmin && draft.enabled && !draft.locked ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'
                                }`}
                            >
                                <input
                                    type="checkbox"
                                    checked={draft.required}
                                    disabled={!isAdmin || !draft.enabled || draft.locked}
                                    onChange={(e) => patch(draft.localKey, { required: e.target.checked })}
                                    className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                />
                                <span className="text-sm text-gray-700">
                                    Required
                                    {draft.locked && <span className="text-gray-400"> — always</span>}
                                </span>
                            </label>
                        </div>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-4">
                        <h3 className="text-lg font-semibold text-gray-900">Customize Request Form</h3>
                        <Link
                            to="/form-setup"
                            className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded-lg text-sm font-medium hover:bg-blue-100 flex items-center gap-2"
                        >
                            <Settings className="w-4 h-4" />
                            Form Setup
                        </Link>
                    </div>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <p className="text-sm text-gray-600 mb-6">
                    Configure which fields appear on the request form and set default values. Changes apply to this form
                    and to the public share link.
                </p>

                {loadError && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4 flex items-start gap-2">
                        <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                        <p className="text-sm text-red-800">{loadError}</p>
                    </div>
                )}

                {!isAdmin && !loadError && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-sm text-amber-800">
                        Only admins can change the form. You are seeing the current configuration read-only.
                    </div>
                )}

                {loading ? (
                    <div className="py-12 flex justify-center">
                        <div className="w-6 h-6 border-2 border-gray-200 border-t-blue-600 rounded-full animate-spin" />
                    </div>
                ) : (
                    <>
                        <div className="space-y-3 mb-6">
                            <h4 className="text-sm font-semibold text-gray-900">Form Fields</h4>
                            {baseFields.map(renderRow)}
                            {isAdmin && (
                                <button
                                    type="button"
                                    onClick={() => addField(null)}
                                    className="w-full py-2.5 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 flex items-center justify-center gap-2"
                                >
                                    <Plus className="w-4 h-4" /> Add a field
                                </button>
                            )}
                        </div>

                        <div className="border-t border-gray-200 pt-6 mb-6">
                            <h4 className="text-sm font-semibold text-gray-900 mb-2">Category-Specific Fields</h4>
                            <p className="text-sm text-gray-600 mb-4">
                                Fields that appear only once the requester picks that work category.
                            </p>

                            <select
                                value={activeSkillId}
                                onChange={(e) => setActiveSkillId(e.target.value)}
                                className="w-full pl-3 pr-10 py-2 border border-gray-300 rounded-lg text-sm mb-3"
                            >
                                <option value="">Select a category to configure</option>
                                {[...skills]
                                    .sort((a, b) => a.name.localeCompare(b.name))
                                    .map((skill) => {
                                        const count = drafts.filter((d) => d.skillId === skill.id).length;
                                        return (
                                            <option key={skill.id} value={skill.id}>
                                                {skill.name}
                                                {count > 0 ? ` (${count})` : ''}
                                            </option>
                                        );
                                    })}
                            </select>

                            {activeSkillId ? (
                                <div className="space-y-3">
                                    {categoryFields.map(renderRow)}
                                    {categoryFields.length === 0 && (
                                        <div className="text-center py-6 text-sm text-gray-500 border border-dashed border-gray-300 rounded-lg">
                                            No extra fields for this category yet.
                                        </div>
                                    )}
                                    {isAdmin && (
                                        <button
                                            type="button"
                                            onClick={() => addField(activeSkillId)}
                                            className="w-full py-2.5 border border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 flex items-center justify-center gap-2"
                                        >
                                            <Plus className="w-4 h-4" /> Add a field for this category
                                        </button>
                                    )}
                                </div>
                            ) : (
                                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                                    <strong>Example:</strong> for a "Video Editing" category you might add Duration,
                                    Aspect Ratio and Voice-over Required — questions that make no sense on every request.
                                </div>
                            )}
                        </div>

                        <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-6">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={!isAdmin || saving || Boolean(loadError)}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                            >
                                {saving && <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />}
                                {saving ? 'Saving...' : 'Save Configuration'}
                            </button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
