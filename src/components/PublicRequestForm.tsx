import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, Check, Eye, Link2Off, Search, Send, X } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { Logo } from './Logo';

/**
 * What the shareable link from "Share Request Form" actually opens: /request/<token>.
 *
 * Everything here goes through two SECURITY DEFINER functions (get_public_request_form and
 * submit_public_request) rather than table reads, because the visitor is anonymous and the
 * token is all they have. The option lists come back from the same call that says whether
 * the link is live, so a closed link cannot render a form at all.
 *
 * This deliberately does not use DataContext: that pulls the whole organisation's users,
 * tasks and comments, none of which an external stakeholder has any business loading.
 */

interface Brand {
    id: string;
    name: string;
    departments: string | null;
}

interface Region {
    id: string;
    name: string;
    flag: string | null;
}

interface Category {
    id: string;
    name: string;
}

interface FormConfig {
    publicAccess: boolean;
    sendConfirmation: boolean;
    brands: Brand[];
    regions: Region[];
    categories: Category[];
}

type LoadState =
    | { status: 'loading' }
    | { status: 'ready'; config: FormConfig }
    | { status: 'unavailable'; reason: 'not_found' | 'closed' | 'error'; detail?: string };

const emptyForm = {
    requesterName: '',
    requesterEmail: '',
    title: '',
    description: '',
    categoryId: '',
    clientId: '',
    regionId: '',
    department: '',
    priority: 'normal',
    dueDate: '',
    estimatedHours: '',
};

const inputClass =
    'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500';

export default function PublicRequestForm() {
    const { token = '' } = useParams<{ token: string }>();
    const [searchParams] = useSearchParams();
    const isPreview = searchParams.get('preview') === '1';

    const [load, setLoad] = useState<LoadState>({ status: 'loading' });
    const [formData, setFormData] = useState(emptyForm);
    const [tags, setTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState('');
    const [categorySearch, setCategorySearch] = useState('');
    const [showCategoryList, setShowCategoryList] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [submitted, setSubmitted] = useState<{ ref: string; emailed: boolean } | null>(null);
    const categoryFieldRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        let cancelled = false;

        (async () => {
            const { data, error: rpcError } = await supabase.rpc('get_public_request_form', { p_token: token });
            if (cancelled) return;

            if (rpcError) {
                setLoad({ status: 'unavailable', reason: 'error', detail: rpcError.message });
                return;
            }
            if (!data?.ok) {
                setLoad({ status: 'unavailable', reason: data?.reason === 'closed' ? 'closed' : 'not_found' });
                return;
            }
            setLoad({
                status: 'ready',
                config: {
                    publicAccess: data.publicAccess,
                    sendConfirmation: data.sendConfirmation,
                    brands: data.brands ?? [],
                    regions: data.regions ?? [],
                    categories: data.categories ?? [],
                },
            });
        })();

        return () => {
            cancelled = true;
        };
    }, [token]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (categoryFieldRef.current && !categoryFieldRef.current.contains(event.target as Node)) {
                setShowCategoryList(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const config = load.status === 'ready' ? load.config : null;

    // An admin previewing a closed link, or anyone who added ?preview=1: show the real form
    // but keep it read-only, so a preview never lands a request in the queue.
    const previewOnly = isPreview || (config ? !config.publicAccess : false);

    const departments = useMemo(() => {
        const brand = config?.brands.find((b) => b.id === formData.clientId);
        return (brand?.departments ?? '')
            .split(',')
            .map((d) => d.trim())
            .filter(Boolean);
    }, [config, formData.clientId]);

    const matchedCategories = useMemo(() => {
        const query = categorySearch.trim().toLowerCase();
        if (!config) return [];
        if (!query) return config.categories;
        return config.categories.filter((c) => c.name.toLowerCase().includes(query));
    }, [config, categorySearch]);

    const setField = (name: keyof typeof emptyForm, value: string) =>
        setFormData((prev) => ({ ...prev, [name]: value }));

    const commitTag = useCallback(() => {
        const value = tagInput.trim().replace(/,$/, '');
        if (!value) return;
        setTags((prev) => (prev.some((t) => t.toLowerCase() === value.toLowerCase()) ? prev : [...prev, value]));
        setTagInput('');
    }, [tagInput]);

    const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === ',' || e.key === 'Enter') {
            e.preventDefault();
            commitTag();
        } else if (e.key === 'Backspace' && tagInput === '') {
            setTags((prev) => prev.slice(0, -1));
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (previewOnly) return;

        // "required" cannot express "pick one of the suggestions", so the one field the
        // browser can't validate is checked here before anything is sent.
        if (!formData.categoryId) {
            setError('Please choose a work category from the list.');
            return;
        }

        setSubmitting(true);
        setError(null);

        try {
            const { data, error: rpcError } = await supabase.rpc('submit_public_request', {
                p_token: token,
                p_payload: { ...formData, tags },
            });
            if (rpcError) throw new Error(rpcError.message);
            if (!data?.ok) throw new Error('The request could not be submitted.');

            // The task is already saved at this point, so a failed confirmation email must
            // not read as a failed submission -- it downgrades to "we have it, no email".
            let emailed = false;
            if (data.sendConfirmation) {
                try {
                    const { data: mail, error: mailError } = await supabase.functions.invoke(
                        'send-request-confirmation',
                        { body: { submissionId: data.submissionId, token } },
                    );
                    emailed = !mailError && Boolean(mail?.ok);
                    if (!emailed) {
                        console.warn('Confirmation email was not sent:', mailError ?? mail);
                    }
                } catch (mailErr) {
                    console.warn('Confirmation email was not sent:', mailErr);
                }
            }

            setSubmitted({ ref: data.requestRef, emailed });
        } catch (err: any) {
            setError(err.message ?? 'Something went wrong. Please try again.');
        } finally {
            setSubmitting(false);
        }
    };

    const resetForAnother = () => {
        setFormData({ ...emptyForm, requesterName: formData.requesterName, requesterEmail: formData.requesterEmail });
        setTags([]);
        setTagInput('');
        setCategorySearch('');
        setSubmitted(null);
    };

    if (load.status === 'loading') {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
            </div>
        );
    }

    if (load.status === 'unavailable') {
        const copy = {
            not_found: {
                title: 'This link is not valid',
                body: 'The request link you used does not exist. Check with whoever shared it that you have the full URL.',
            },
            closed: {
                title: 'This form is closed',
                body: 'The team has turned off public access to this request form. Get in touch with them directly if you still need to submit a request.',
            },
            error: {
                title: 'Something went wrong',
                body: load.detail ?? 'The form could not be loaded. Please try again in a moment.',
            },
        }[load.reason];

        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
                <div className="bg-white border border-gray-200 rounded-xl p-8 max-w-md w-full text-center">
                    <div className="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-4">
                        <Link2Off className="w-6 h-6 text-gray-400" />
                    </div>
                    <h1 className="text-lg font-semibold text-gray-900">{copy.title}</h1>
                    <p className="text-sm text-gray-600 mt-2">{copy.body}</p>
                </div>
            </div>
        );
    }

    if (submitted) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
                <div className="bg-white border border-gray-200 rounded-xl p-8 max-w-md w-full text-center">
                    <div className="w-12 h-12 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
                        <Check className="w-6 h-6 text-green-600" />
                    </div>
                    <h1 className="text-lg font-semibold text-gray-900">Request submitted</h1>
                    <p className="text-sm text-gray-600 mt-2">
                        Your reference is <span className="font-semibold text-gray-900">{submitted.ref}</span>. The team
                        will review it and confirm the timeline with you.
                    </p>
                    <p className="text-xs text-gray-500 mt-3">
                        {submitted.emailed
                            ? `We've emailed a copy to ${formData.requesterEmail}.`
                            : 'Please keep this reference — it is your record of the request.'}
                    </p>
                    <button
                        onClick={resetForAnother}
                        className="mt-6 px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                    >
                        Submit another request
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen bg-gray-50 py-10 px-4">
            <div className="max-w-3xl mx-auto">
                <div className="flex items-center gap-3 mb-6">
                    <Logo className="w-10 h-10 rounded-lg" />
                    <div>
                        <h1 className="text-xl font-semibold text-gray-900">Submit a work request</h1>
                        <p className="text-sm text-gray-600">
                            Tell the marketing team what you need. No account required.
                        </p>
                    </div>
                </div>

                {previewOnly && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex items-start gap-3">
                        <Eye className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                        <div className="text-sm text-amber-800">
                            <strong>Preview.</strong> This is exactly what a recipient of the link sees. Submitting is
                            disabled here so a preview never adds a request to the queue.
                            {config && !config.publicAccess && (
                                <> Public access is currently off, so the live link shows a “form is closed” notice.</>
                            )}
                        </div>
                    </div>
                )}

                {error && (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6 flex items-start gap-3">
                        <AlertCircle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
                        <p className="text-sm text-red-800">{error}</p>
                    </div>
                )}

                <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
                    <div className="space-y-4">
                        <h2 className="text-base font-semibold text-gray-900">About you</h2>
                        <div className="grid sm:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Your name <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={formData.requesterName}
                                    onChange={(e) => setField('requesterName', e.target.value)}
                                    className={inputClass}
                                    placeholder="Jane Cooper"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Your email <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="email"
                                    required
                                    value={formData.requesterEmail}
                                    onChange={(e) => setField('requesterEmail', e.target.value)}
                                    className={inputClass}
                                    placeholder="jane@company.com"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4 border-t border-gray-200 pt-6">
                        <h2 className="text-base font-semibold text-gray-900">Your request</h2>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Request title <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                required
                                value={formData.title}
                                onChange={(e) => setField('title', e.target.value)}
                                className={inputClass}
                                placeholder="E.g., Social media campaign for product launch"
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Description <span className="text-red-500">*</span>
                            </label>
                            <textarea
                                required
                                rows={4}
                                value={formData.description}
                                onChange={(e) => setField('description', e.target.value)}
                                className={inputClass}
                                placeholder="Provide detailed information about what you need..."
                            />
                        </div>

                        <div className="grid sm:grid-cols-2 gap-4">
                            <div ref={categoryFieldRef} className="relative">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Work category <span className="text-red-500">*</span>
                                </label>
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                                    <input
                                        type="text"
                                        autoComplete="off"
                                        value={categorySearch}
                                        onChange={(e) => {
                                            setCategorySearch(e.target.value);
                                            setField('categoryId', '');
                                            setShowCategoryList(true);
                                        }}
                                        onFocus={() => setShowCategoryList(true)}
                                        className={`${inputClass} pl-9`}
                                        placeholder="Search a category..."
                                    />
                                </div>
                                {showCategoryList && (
                                    <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                                        {matchedCategories.length > 0 ? (
                                            matchedCategories.map((category) => (
                                                <button
                                                    type="button"
                                                    key={category.id}
                                                    onClick={() => {
                                                        setField('categoryId', category.id);
                                                        setCategorySearch(category.name);
                                                        setShowCategoryList(false);
                                                    }}
                                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${
                                                        formData.categoryId === category.id
                                                            ? 'bg-blue-50 text-blue-700'
                                                            : 'text-gray-700'
                                                    }`}
                                                >
                                                    {category.name}
                                                </button>
                                            ))
                                        ) : (
                                            <div className="px-3 py-2 text-sm text-gray-500">No matching categories</div>
                                        )}
                                    </div>
                                )}
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Brand <span className="text-red-500">*</span>
                                </label>
                                <select
                                    required
                                    value={formData.clientId}
                                    onChange={(e) => {
                                        setField('clientId', e.target.value);
                                        setField('department', '');
                                    }}
                                    className={inputClass}
                                >
                                    <option value="">Select a brand</option>
                                    {config!.brands.map((brand) => (
                                        <option key={brand.id} value={brand.id}>
                                            {brand.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Region <span className="text-red-500">*</span>
                                </label>
                                <select
                                    required
                                    value={formData.regionId}
                                    onChange={(e) => setField('regionId', e.target.value)}
                                    className={inputClass}
                                >
                                    <option value="">Select a region</option>
                                    {config!.regions.map((region) => (
                                        <option key={region.id} value={region.id}>
                                            {region.flag ? `${region.flag} ` : ''}
                                            {region.name}
                                        </option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Department <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    list="public-department-suggestions"
                                    value={formData.department}
                                    onChange={(e) => setField('department', e.target.value)}
                                    className={inputClass}
                                    placeholder={
                                        formData.clientId ? 'Enter or select department' : 'Select a brand first'
                                    }
                                />
                                <datalist id="public-department-suggestions">
                                    {departments.map((dept) => (
                                        <option key={dept} value={dept} />
                                    ))}
                                </datalist>
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4 border-t border-gray-200 pt-6">
                        <h2 className="text-base font-semibold text-gray-900">Priority and timeline</h2>
                        <div className="grid sm:grid-cols-3 gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Priority <span className="text-red-500">*</span>
                                </label>
                                <select
                                    required
                                    value={formData.priority}
                                    onChange={(e) => setField('priority', e.target.value)}
                                    className={inputClass}
                                >
                                    <option value="low">Low</option>
                                    <option value="normal">Normal</option>
                                    <option value="high">High</option>
                                    <option value="urgent">Urgent</option>
                                </select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Needed by <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="date"
                                    required
                                    value={formData.dueDate}
                                    onChange={(e) => setField('dueDate', e.target.value)}
                                    className={inputClass}
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Estimated hours
                                </label>
                                <input
                                    type="number"
                                    min="0.5"
                                    step="0.5"
                                    value={formData.estimatedHours}
                                    onChange={(e) => setField('estimatedHours', e.target.value)}
                                    className={inputClass}
                                    placeholder="e.g. 5"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="space-y-4 border-t border-gray-200 pt-6">
                        <h2 className="text-base font-semibold text-gray-900">Additional details</h2>
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">Tags</label>
                            <div className="w-full px-2 py-1.5 border border-gray-300 rounded-lg bg-white focus-within:ring-2 focus-within:ring-blue-500 flex flex-wrap gap-2 items-center">
                                {tags.map((tag) => (
                                    <span
                                        key={tag}
                                        className="flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-700 text-sm rounded-full"
                                    >
                                        {tag}
                                        <button
                                            type="button"
                                            onClick={() => setTags((prev) => prev.filter((t) => t !== tag))}
                                            className="hover:bg-blue-200 rounded-full p-0.5 focus:outline-none"
                                        >
                                            <X className="w-3 h-3" />
                                        </button>
                                    </span>
                                ))}
                                <input
                                    type="text"
                                    value={tagInput}
                                    onChange={(e) => {
                                        if (e.target.value.includes(',')) {
                                            setTagInput(e.target.value.replace(/,/g, ''));
                                            commitTag();
                                        } else {
                                            setTagInput(e.target.value);
                                        }
                                    }}
                                    onKeyDown={handleTagKeyDown}
                                    onBlur={commitTag}
                                    className="flex-1 min-w-[140px] bg-transparent focus:outline-none text-sm py-0.5"
                                    placeholder={tags.length === 0 ? 'campaign, social-media, q3-launch' : ''}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center justify-between gap-3 border-t border-gray-200 pt-6">
                        <p className="text-xs text-gray-500">
                            {config!.sendConfirmation
                                ? 'You will get an email confirming the request.'
                                : 'Keep the reference shown after submitting — it is your record of the request.'}
                        </p>
                        <button
                            type="submit"
                            disabled={submitting || previewOnly}
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
                        >
                            {submitting ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                    Submitting...
                                </>
                            ) : (
                                <>
                                    <Send className="w-4 h-4" />
                                    Submit request
                                </>
                            )}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
