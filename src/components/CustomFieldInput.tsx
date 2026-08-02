import React from 'react';
import { CustomFieldValue, RequestFormField } from '../lib/requestFormConfig';

/**
 * Renders one admin-configured field. Shared by the internal request form and the public
 * one so a field added in Customize Request Form looks and behaves the same in both --
 * the alternative is two renderers that drift the first time a field type is added.
 */

interface Props {
    field: RequestFormField;
    value: CustomFieldValue | undefined;
    onChange: (value: CustomFieldValue) => void;
    disabled?: boolean;
    /** The host form's input styling, so this component owns no visual opinions. */
    inputClassName: string;
}

export function CustomFieldInput({ field, value, onChange, disabled, inputClassName }: Props) {
    const text = value === undefined || value === null ? '' : String(value);

    if (field.fieldType === 'checkbox') {
        return (
            <label className={`flex items-start gap-2.5 ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}>
                <input
                    type="checkbox"
                    checked={value === true}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">
                    {field.label}
                    {field.required && <span className="text-red-500"> *</span>}
                    {field.helpText && <span className="block text-xs text-gray-500 mt-0.5">{field.helpText}</span>}
                </span>
            </label>
        );
    }

    return (
        <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
                {field.label}
                {field.required && <span className="text-red-500"> *</span>}
            </label>

            {field.fieldType === 'textarea' ? (
                <textarea
                    rows={3}
                    value={text}
                    required={field.required}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                    className={inputClassName}
                    placeholder={field.placeholder ?? ''}
                />
            ) : field.fieldType === 'select' ? (
                <select
                    value={text}
                    required={field.required}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                    className={inputClassName}
                >
                    <option value="">{field.placeholder || 'Select an option'}</option>
                    {field.options.map((option) => (
                        <option key={option} value={option}>
                            {option}
                        </option>
                    ))}
                </select>
            ) : (
                <input
                    type={field.fieldType === 'number' ? 'number' : field.fieldType === 'date' ? 'date' : 'text'}
                    value={text}
                    required={field.required}
                    disabled={disabled}
                    onChange={(e) => onChange(e.target.value)}
                    className={inputClassName}
                    placeholder={field.placeholder ?? ''}
                />
            )}

            {field.helpText && <p className="text-xs text-gray-500 mt-1">{field.helpText}</p>}
        </div>
    );
}
