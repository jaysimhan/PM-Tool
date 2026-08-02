import React, { useState, useEffect, useRef, useMemo } from 'react';
import { User } from '../types/types';
import { FileText, Send, X, Link as LinkIcon, Settings, Copy, Eye, Calendar, Search, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useData } from '../contexts/DataContext';
import { SingleDatePicker } from './SingleDatePicker';
import { format } from 'date-fns';
import { getRandomColor } from '../utils/colors';
import { embedText, warmEmbeddingModel } from '../utils/embeddings';
import { CustomFieldInput } from './CustomFieldInput';
import { CustomizeFormModal } from './CustomizeFormModal';
import {
    CustomFieldValue,
    RequestFormField,
    coreFields,
    customFieldsFor,
    defaultCustomValues,
    firstMissingCustomField,
    pruneCustomValues,
    serializeCustomValues,
    useRequestFormConfig,
} from '../lib/requestFormConfig';
import toast from 'react-hot-toast';

interface Props {
    currentUser: User;
}

const emptyForm = {
    title: '',
    description: '',
    categoryId: '',
    clientId: '',
    department: '',
    priority: 'normal',
    dueDate: '',
    estimatedHours: '',
    tags: '',
    regionId: ''
};

/**
 * Labels for the core fields. The configured label wins; `fallback` covers the case where
 * the config could not be read and FALLBACK_FIELDS is standing in.
 */
function Label({ field, fallback, suffix }: { field?: RequestFormField; fallback: string; suffix?: string }) {
    return (
        <label className="block text-sm font-medium text-gray-700 mb-2">
            {field?.label ?? fallback}
            {suffix}
            {(field?.required ?? false) && <span className="text-red-500"> *</span>}
        </label>
    );
}

function Hint({ field }: { field?: RequestFormField }) {
    if (!field?.helpText) return null;
    return <p className="text-xs text-gray-500 mt-1">{field.helpText}</p>;
}

export default function RequestForm({ currentUser }: Props) {
    const { refreshTasks, refreshClients, skills, clients, regions, allTags, refreshTags } = useData();

    // What the form looks like is configuration now, not a literal in this file. Every
    // label, placeholder, default and required marker below comes from here.
    const { fields: formFields, loading: configLoading, error: configError, apply: applyConfig } = useRequestFormConfig();
    const core = useMemo(() => coreFields(formFields), [formFields]);

    const [formData, setFormData] = useState(emptyForm);
    const [customValues, setCustomValues] = useState<Record<string, CustomFieldValue>>({});

    const [showSuccess, setShowSuccess] = useState(false);
    const [lastRequestRef, setLastRequestRef] = useState<string | null>(null);
    const [showShareModal, setShowShareModal] = useState(false);
    const [showCustomizeModal, setShowCustomizeModal] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [tagInput, setTagInput] = useState('');
    const [categorySearch, setCategorySearch] = useState('');
    const [showCategorySuggestions, setShowCategorySuggestions] = useState(false);
    const categoryFieldRef = useRef<HTMLDivElement>(null);

    // The share link and its settings live in request_form_links, not in this component:
    // a link nobody else can resolve, and toggles that forget themselves when the modal
    // closes, are not a share feature.
    const [shareLink, setShareLink] = useState<{ token: string; publicAccess: boolean; sendConfirmation: boolean } | null>(null);
    const [shareLoading, setShareLoading] = useState(false);
    const [shareError, setShareError] = useState<string | null>(null);
    const [savingSetting, setSavingSetting] = useState<'publicAccess' | 'sendConfirmation' | null>(null);
    // null = not asked yet. Whether the confirmation email can actually be sent is a
    // property of the deployment (RESEND_API_KEY), so the function is asked rather than assumed.
    const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);

    const isAdmin = currentUser.role === 'super_admin' || currentUser.role === 'admin';
    const shareUrl = shareLink ? `${window.location.origin}/request/${shareLink.token}` : '';
    const inputClass = `w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'bg-gray-50 text-gray-500' : ''}`;

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [matchedSkills, setMatchedSkills] = useState(skills);
    const [isSearchingSkills, setIsSearchingSkills] = useState(false);
    const categorySearchRequestId = useRef(0);

    // Base extras plus whatever is scoped to the chosen work category. Recomputed as the
    // category changes, which is what makes category-specific fields appear and vanish.
    const visibleCustomFields = useMemo(
        () => customFieldsFor(formFields, formData.categoryId || null),
        [formFields, formData.categoryId],
    );

    /** A blank form with the configured defaults already filled in. */
    const blankForm = () => ({
        ...emptyForm,
        title: core.title?.defaultValue ?? '',
        description: core.description?.defaultValue ?? '',
        department: core.department?.defaultValue ?? '',
        estimatedHours: core.estimatedHours?.defaultValue ?? '',
        priority: core.priority?.defaultValue ?? 'normal',
    });

    // Defaults are applied once, when the config first arrives -- re-running would wipe
    // whatever the requester has typed in the meantime.
    const defaultsApplied = useRef(false);
    useEffect(() => {
        if (configLoading || defaultsApplied.current) return;
        defaultsApplied.current = true;
        setFormData(blankForm());
    }, [configLoading, core]);

    // Seed defaults for newly visible custom fields and drop answers to fields that are no
    // longer on screen, so switching category cannot smuggle the old category's answers in.
    useEffect(() => {
        setCustomValues(prev => ({
            ...defaultCustomValues(visibleCustomFields),
            ...pruneCustomValues(prev, visibleCustomFields),
        }));
    }, [visibleCustomFields]);

    // Kick off the embedding model download as soon as the form mounts so the
    // first keystroke in Work Category doesn't pay the cold-start cost.
    useEffect(() => {
        warmEmbeddingModel();
    }, []);

    useEffect(() => {
        const query = categorySearch.trim();
        if (!query) {
            setMatchedSkills(skills);
            setIsSearchingSkills(false);
            return;
        }

        const requestId = ++categorySearchRequestId.current;
        setIsSearchingSkills(true);

        const timeoutId = setTimeout(async () => {
            try {
                const queryEmbedding = await embedText(query);
                const { data, error } = await supabase.rpc('match_skills', {
                    query_embedding: queryEmbedding,
                    match_count: 8
                });
                if (requestId !== categorySearchRequestId.current) return;
                if (error) throw error;

                if (data && data.length > 0) {
                    setMatchedSkills(data);
                } else {
                    // No embedded skills matched (e.g. embeddings not backfilled yet) --
                    // fall back to a plain substring match so the field stays usable.
                    setMatchedSkills(skills.filter(s => s.name.toLowerCase().includes(query.toLowerCase())));
                }
            } catch (err) {
                if (requestId !== categorySearchRequestId.current) return;
                console.error('Semantic skill search failed, falling back to text match:', err);
                setMatchedSkills(skills.filter(s => s.name.toLowerCase().includes(query.toLowerCase())));
            } finally {
                if (requestId === categorySearchRequestId.current) setIsSearchingSkills(false);
            }
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [categorySearch, skills]);

    const selectSkill = (skillId: string, skillName: string) => {
        setFormData(prev => ({ ...prev, categoryId: skillId }));
        setCategorySearch(skillName);
        setShowCategorySuggestions(false);
    };

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (categoryFieldRef.current && !categoryFieldRef.current.contains(event.target as Node)) {
                setShowCategorySuggestions(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Fetched when the modal opens rather than on mount: most visits to this page never
    // open it, and the first admin to open it is the one who mints the link.
    useEffect(() => {
        if (!showShareModal || shareLink) return;
        let cancelled = false;

        setShareLoading(true);
        setShareError(null);
        (async () => {
            const { data, error } = await supabase.rpc('get_or_create_request_form_link');
            if (cancelled) return;
            if (error) {
                setShareError(error.message);
            } else if (data) {
                setShareLink({
                    token: data.token,
                    publicAccess: data.public_access,
                    sendConfirmation: data.send_confirmation
                });
            }
            setShareLoading(false);
        })();

        return () => { cancelled = true; };
    }, [showShareModal, shareLink]);

    useEffect(() => {
        if (!showShareModal || emailConfigured !== null) return;
        let cancelled = false;

        (async () => {
            try {
                const { data, error } = await supabase.functions.invoke('send-request-confirmation', {
                    body: { action: 'status' }
                });
                if (!cancelled) setEmailConfigured(!error && Boolean(data?.configured));
            } catch {
                // Not deployed at all counts as not configured.
                if (!cancelled) setEmailConfigured(false);
            }
        })();

        return () => { cancelled = true; };
    }, [showShareModal, emailConfigured]);

    const updateShareSetting = async (key: 'publicAccess' | 'sendConfirmation', value: boolean) => {
        if (!shareLink) return;

        const previous = shareLink;
        setShareLink({ ...shareLink, [key]: value });
        setSavingSetting(key);

        const { data, error } = await supabase.rpc('update_request_form_link', {
            p_public_access: key === 'publicAccess' ? value : null,
            p_send_confirmation: key === 'sendConfirmation' ? value : null
        });

        setSavingSetting(null);

        if (error || !data) {
            setShareLink(previous);
            toast.error(error?.message || 'Could not save that setting.');
            return;
        }

        setShareLink({
            token: data.token,
            publicAccess: data.public_access,
            sendConfirmation: data.send_confirmation
        });
    };

    const openPreview = () => {
        if (!shareUrl) return;
        // ?preview=1 renders the real page with submitting disabled, so previewing never
        // drops a test request into the queue.
        window.open(`${shareUrl}?preview=1`, '_blank', 'noopener,noreferrer');
    };

    /** Is this core field on the form? A field with no row at all stays on. */
    const on = (key: keyof typeof core) => core[key]?.enabled ?? true;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // Two required fields the browser cannot police: the category picker only counts
        // once a suggestion is chosen, and the due date is a div, not an input.
        if (on('category') && core.category?.required && !formData.categoryId) {
            toast.error(`Please select a ${(core.category.label || 'work category').toLowerCase()}.`);
            return;
        }
        if (on('dueDate') && core.dueDate?.required && !formData.dueDate) {
            toast.error(`${core.dueDate.label} is required.`);
            return;
        }
        const missingCustom = firstMissingCustomField(visibleCustomFields, customValues);
        if (missingCustom) {
            toast.error(`${missingCustom} is required.`);
            return;
        }

        setIsSubmitting(true);

        try {
            const { data: taskData, error } = await supabase.from('tasks').insert({
                title: formData.title,
                description: on('description') ? formData.description : null,
                client_id: on('client') ? formData.clientId || null : null,
                // A hidden Priority field means the requester was not asked, not that the
                // request has no priority -- it falls back to the configured default.
                priority: on('priority') ? formData.priority : core.priority?.defaultValue ?? 'normal',
                due_date: on('dueDate') ? formData.dueDate || null : null,
                estimated_hours: on('estimatedHours') && formData.estimatedHours ? parseFloat(formData.estimatedHours) : null,
                requester_id: currentUser.id,
                region_id: on('region') ? formData.regionId || null : null,
                department: on('department') ? formData.department || null : null,
                custom_fields: serializeCustomValues(visibleCustomFields, customValues),
                status: 'new_request'
            }).select().single();

            if (error) throw error;

            // The Work Category picker searches skills, so the answer belongs in
            // task_skills. It used to be validated as required and then dropped.
            if (taskData && on('category') && formData.categoryId) {
                const { error: skillError } = await supabase
                    .from('task_skills')
                    .insert({ task_id: taskData.id, skill_id: formData.categoryId });
                if (skillError) throw skillError;
            }

            // Check if department is new for this brand and add it if so
            if (on('client') && on('department') && formData.clientId && formData.department) {
                const client = clients.find(c => c.id === formData.clientId);
                if (client) {
                    const existingDepts = client.department 
                        ? client.department.split(',').map(d => d.trim()).filter(Boolean) 
                        : [];
                    const newDept = formData.department.trim();
                    
                    if (newDept && !existingDepts.some(d => d.toLowerCase() === newDept.toLowerCase())) {
                        // Brands are admin-owned, and this append is the one thing a requester
                        // legitimately writes to one -- so it goes through the function that
                        // does only that, rather than an UPDATE that could rewrite the row.
                        const { error: deptError } = await supabase.rpc('add_client_department', {
                            p_client_id: client.id,
                            p_department: newDept,
                        });
                        // Not worth failing the request over: the task is already saved and the
                        // department is recorded on it either way.
                        if (deptError) console.error('Could not add the department to the brand:', deptError);
                        else await refreshClients();
                    }
                }
            }

            // Handle Tags
            if (on('tags') && formData.tags) {
                const tagNames = formData.tags.split(',').map(t => t.trim()).filter(Boolean).map(name => name.charAt(0).toUpperCase() + name.slice(1));
                const uniqueTagNames = Array.from(new Set(tagNames));
                
                const existingTags = allTags.filter(t => uniqueTagNames.some(ut => ut.toLowerCase() === t.name.toLowerCase()));
                const existingTagNamesLower = existingTags.map(t => t.name.toLowerCase());
                
                const newTagNames = uniqueTagNames.filter(name => !existingTagNamesLower.includes(name.toLowerCase()));
                
                let finalTaskTags = [...existingTags];
                
                if (newTagNames.length > 0) {
                    const newTagsData = newTagNames.map(name => ({
                        name,
                        color: getRandomColor()
                    }));
                    
                    const { data: insertedTags, error: insertError } = await supabase
                        .from('tags')
                        .insert(newTagsData)
                        .select();
                        
                    if (insertError) throw insertError;
                    if (insertedTags) {
                        finalTaskTags = [...finalTaskTags, ...insertedTags];
                    }
                    await refreshTags();
                }

                if (finalTaskTags.length > 0 && taskData) {
                    const taskTagsData = finalTaskTags.map(tag => ({
                        task_id: taskData.id,
                        tag_id: tag.id
                    }));
                    await supabase.from('task_tags').insert(taskTagsData);
                }
            }

            await refreshTasks();
            setLastRequestRef(taskData ? `REQ-${taskData.id.replace(/-/g, '').slice(0, 6).toUpperCase()}` : null);
            setShowSuccess(true);

            // Reset form
            setFormData(blankForm());
            setCustomValues(defaultCustomValues(customFieldsFor(formFields, null)));
            setCategorySearch('');

            setTimeout(() => setShowSuccess(false), 3000);
        } catch (error) {
            console.error('Error submitting request:', error);
            toast.error('Failed to submit request.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        });
    };

    const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === ',' || e.key === 'Enter') {
            e.preventDefault();
            const newTag = tagInput.trim().replace(/,$/, '');
            if (newTag) {
                const currentTags = formData.tags ? formData.tags.split(',').map(t => t.trim()) : [];
                if (!currentTags.includes(newTag)) {
                    setFormData({
                        ...formData,
                        tags: currentTags.length > 0 ? `${formData.tags}, ${newTag}` : newTag
                    });
                }
                setTagInput('');
            }
        } else if (e.key === 'Backspace' && tagInput === '') {
            e.preventDefault();
            const currentTags = formData.tags ? formData.tags.split(',').map(t => t.trim()) : [];
            if (currentTags.length > 0) {
                currentTags.pop();
                setFormData({
                    ...formData,
                    tags: currentTags.join(', ')
                });
            }
        }
    };

    const handleTagChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.value.includes(',')) {
            const parts = e.target.value.split(',');
            const newTags = parts.map(p => p.trim()).filter(Boolean);
            const currentTags = formData.tags ? formData.tags.split(',').map(t => t.trim()) : [];
            const combined = Array.from(new Set([...currentTags, ...newTags]));
            setFormData({
                ...formData,
                tags: combined.join(', ')
            });
            setTagInput('');
        } else {
            setTagInput(e.target.value);
        }
    };

    const removeTag = (tagToRemove: string) => {
        const currentTags = formData.tags.split(',').map(t => t.trim()).filter(t => t !== tagToRemove);
        setFormData({
            ...formData,
            tags: currentTags.join(', ')
        });
    };

    const copyToClipboard = async () => {
        if (!shareUrl) return;
        try {
            await navigator.clipboard.writeText(shareUrl);
            toast.success('Link copied to clipboard!');
        } catch {
            // Clipboard access needs a secure context; say so instead of claiming success.
            toast.error('Could not copy automatically — select the link and copy it.');
        }
    };

    return (
        <div className="space-y-6 max-w-4xl">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-gray-900">Create New Request</h1>
                    <p className="text-sm text-gray-600 mt-1">Submit a new work request to the team</p>
                </div>

                <div className="flex items-center gap-2">
                    {(currentUser.role === 'super_admin' || currentUser.role === 'admin') && (
                        <button
                            onClick={() => setShowCustomizeModal(true)}
                            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2"
                        >
                            <Settings className="w-4 h-4" />
                            Customize Form
                        </button>
                    )}
                    <button
                        onClick={() => setShowShareModal(true)}
                        className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2"
                    >
                        <LinkIcon className="w-4 h-4" />
                        Share Form
                    </button>
                </div>
            </div>

            {/* Success Message */}
            {showSuccess && (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                            <FileText className="w-4 h-4 text-green-600" />
                        </div>
                        <div>
                            <div className="text-sm font-medium text-green-900">Request Submitted Successfully!</div>
                            <div className="text-xs text-green-700 mt-0.5">
                                {lastRequestRef ? `Request ID: ${lastRequestRef} - ` : ''}Your request has been added to the queue.
                            </div>
                        </div>
                    </div>
                    <button onClick={() => setShowSuccess(false)} className="text-green-600 hover:text-green-700">
                        <X className="w-5 h-5" />
                    </button>
                </div>
            )}

            {/* Form */}
            {!isAdmin && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
                    <p className="text-sm text-amber-800">
                        <strong>View-Only Mode:</strong> Only administrators can edit or submit requests internally. You can view the form structure or use the "Share Form" button to get a public link.
                    </p>
                </div>
            )}
            {configError && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6 flex items-start gap-3">
                    <AlertCircle className="w-4 h-4 text-amber-600 mt-0.5 shrink-0" />
                    <p className="text-sm text-amber-800">
                        The saved form configuration could not be loaded, so the standard fields are shown instead.
                        Anything customised is missing from this view. ({configError})
                    </p>
                </div>
            )}
            <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
                {/* Basic Information */}
                <div className="space-y-4">
                    <h2 className="text-lg font-semibold text-gray-900">Basic Information</h2>

                    <div>
                        <Label field={core.title} fallback="Request Title" />
                        <input
                            type="text"
                            name="title"
                            value={formData.title}
                            onChange={handleChange}
                            required
                            disabled={!isAdmin}
                            className={inputClass}
                            placeholder={core.title?.placeholder ?? 'E.g., Social media campaign for product launch'}
                        />
                        <Hint field={core.title} />
                    </div>

                    {on('description') && (
                        <div>
                            <Label field={core.description} fallback="Description" />
                            <textarea
                                name="description"
                                value={formData.description}
                                onChange={handleChange}
                                required={core.description?.required ?? true}
                                disabled={!isAdmin}
                                rows={4}
                                className={inputClass}
                                placeholder={core.description?.placeholder ?? 'Provide detailed information about what you need...'}
                            />
                            <Hint field={core.description} />
                        </div>
                    )}

                    <div className="grid grid-cols-2 gap-4">
                        {on('category') && (
                            <div ref={categoryFieldRef} className="relative">
                                <Label field={core.category} fallback="Work Category" />
                                <div className="relative">
                                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
                                    <input
                                        type="text"
                                        value={categorySearch}
                                        onChange={(e) => {
                                            setCategorySearch(e.target.value);
                                            setFormData(prev => ({ ...prev, categoryId: '' }));
                                            setShowCategorySuggestions(true);
                                        }}
                                        onFocus={() => setShowCategorySuggestions(true)}
                                        disabled={!isAdmin}
                                        autoComplete="off"
                                        className={`w-full pl-9 pr-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'bg-gray-50 text-gray-500' : ''}`}
                                        placeholder={core.category?.placeholder ?? 'Search a category...'}
                                    />
                                </div>
                                {showCategorySuggestions && isAdmin && (
                                    <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                                        {isSearchingSkills && (
                                            <div className="px-3 py-2 text-xs text-gray-400">Searching...</div>
                                        )}
                                        {matchedSkills.length > 0 ? (
                                            matchedSkills.map((skill: { id: string; name: string }) => (
                                                <button
                                                    type="button"
                                                    key={skill.id}
                                                    onClick={() => selectSkill(skill.id, skill.name)}
                                                    className={`w-full text-left px-3 py-2 text-sm hover:bg-blue-50 ${formData.categoryId === skill.id ? 'bg-blue-50 text-blue-700' : 'text-gray-700'}`}
                                                >
                                                    {skill.name}
                                                </button>
                                            ))
                                        ) : !isSearchingSkills ? (
                                            <div className="px-3 py-2 text-sm text-gray-500">No matching categories</div>
                                        ) : null}
                                    </div>
                                )}
                                <Hint field={core.category} />
                            </div>
                        )}

                        {on('client') && (
                            <div>
                                <Label field={core.client} fallback="Brand" />
                                <select
                                    name="clientId"
                                    value={formData.clientId}
                                    onChange={handleChange}
                                    required={core.client?.required ?? true}
                                    disabled={!isAdmin}
                                    className={`w-full pl-3 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'bg-gray-50 text-gray-500' : ''}`}
                                >
                                    <option value="">{core.client?.placeholder ?? 'Select a brand'}</option>
                                    {clients.map(client => (
                                        <option key={client.id} value={client.id}>{client.name}</option>
                                    ))}
                                </select>
                                <Hint field={core.client} />
                            </div>
                        )}

                        {on('region') && (
                            <div>
                                <Label field={core.region} fallback="Region" />
                                <select
                                    name="regionId"
                                    value={formData.regionId}
                                    onChange={handleChange}
                                    required={core.region?.required ?? true}
                                    disabled={!isAdmin}
                                    className={inputClass}
                                >
                                    <option value="">{core.region?.placeholder ?? 'Select a region'}</option>
                                    {regions.map(region => (
                                        <option key={region.id} value={region.id}>
                                            {region.flag} {region.name}
                                        </option>
                                    ))}
                                </select>
                                <Hint field={core.region} />
                            </div>
                        )}

                        {on('department') && (
                            <div>
                                <Label field={core.department} fallback="Department" />
                                <input
                                    type="text"
                                    name="department"
                                    value={formData.department}
                                    onChange={handleChange}
                                    required={core.department?.required ?? true}
                                    disabled={!isAdmin}
                                    list="department-suggestions"
                                    className={inputClass}
                                    placeholder={core.department?.placeholder ?? 'Enter or select department'}
                                />
                                <datalist id="department-suggestions">
                                    {clients.find(c => c.id === formData.clientId)?.department
                                        ?.split(',')
                                        .map(d => d.trim())
                                        .filter(Boolean)
                                        .map(dep => (
                                            <option key={dep} value={dep} />
                                        ))
                                    }
                                </datalist>
                                <Hint field={core.department} />
                            </div>
                        )}
                    </div>
                </div>

                {/* Priority and Timeline. The whole section goes when all three are off. */}
                {(on('priority') || on('dueDate') || on('estimatedHours')) && (
                    <div className="space-y-4 border-t border-gray-200 pt-6">
                        <h2 className="text-lg font-semibold text-gray-900">Priority and Timeline</h2>

                        <div className="grid grid-cols-3 gap-4">
                            {on('priority') && (
                                <div>
                                    <Label field={core.priority} fallback="Priority" />
                                    <select
                                        name="priority"
                                        value={formData.priority}
                                        onChange={handleChange}
                                        required={core.priority?.required ?? true}
                                        disabled={!isAdmin}
                                        className={inputClass}
                                    >
                                        <option value="low">Low</option>
                                        <option value="normal">Normal</option>
                                        <option value="high">High</option>
                                        <option value="urgent">Urgent</option>
                                    </select>
                                    <Hint field={core.priority} />
                                </div>
                            )}

                            {on('dueDate') && (
                                <div>
                                    <Label field={core.dueDate} fallback="Due Date" />
                                    <div className="relative">
                                        <div
                                            className={`w-full px-3 py-2 border border-gray-300 rounded-lg flex items-center justify-between cursor-pointer ${!isAdmin ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : 'bg-white hover:border-blue-500'}`}
                                            onClick={() => isAdmin && setShowDatePicker(true)}
                                        >
                                            <span className={formData.dueDate ? 'text-gray-900' : 'text-gray-400'}>
                                                {formData.dueDate ? format(new Date(formData.dueDate), 'dd/MM/yyyy') : 'dd/mm/yyyy'}
                                            </span>
                                            <Calendar className="w-5 h-5 text-gray-400" />
                                        </div>
                                        {showDatePicker && isAdmin && (
                                            <SingleDatePicker
                                                date={formData.dueDate}
                                                onChange={(date) => setFormData({ ...formData, dueDate: date })}
                                                onClose={() => setShowDatePicker(false)}
                                            />
                                        )}
                                    </div>
                                    <Hint field={core.dueDate} />
                                </div>
                            )}

                            {on('estimatedHours') && (
                                <div>
                                    <Label field={core.estimatedHours} fallback="Estimated Hours to complete" />
                                    <input
                                        type="number"
                                        name="estimatedHours"
                                        value={formData.estimatedHours}
                                        onChange={handleChange}
                                        required={core.estimatedHours?.required ?? false}
                                        disabled={!isAdmin}
                                        min="1"
                                        step="0.5"
                                        className={inputClass}
                                        placeholder={core.estimatedHours?.placeholder ?? 'e.g. 5'}
                                    />
                                    <Hint field={core.estimatedHours} />
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Additional Details: tags plus every custom field currently in scope. */}
                {(on('tags') || visibleCustomFields.length > 0) && (
                    <div className="space-y-4 border-t border-gray-200 pt-6">
                        <h2 className="text-lg font-semibold text-gray-900">Additional Details</h2>

                        {on('tags') && (
                            <div>
                                <Label field={core.tags} fallback="Tags" suffix=" (comma-separated)" />
                                <div className={`w-full px-2 py-1.5 border border-gray-300 rounded-lg focus-within:ring-2 focus-within:ring-blue-500 flex flex-wrap gap-2 items-center ${!isAdmin ? 'bg-gray-50' : 'bg-white'}`}>
                                    {formData.tags.split(',').map(t => t.trim()).filter(Boolean).map((tag, idx) => (
                                        <span key={idx} className="flex items-center gap-1 px-2.5 py-1 bg-blue-100 text-blue-700 text-sm rounded-full">
                                            {tag}
                                            {isAdmin && (
                                                <button
                                                    type="button"
                                                    onClick={() => removeTag(tag)}
                                                    className="hover:bg-blue-200 rounded-full p-0.5 focus:outline-none"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            )}
                                        </span>
                                    ))}
                                    <input
                                        type="text"
                                        name="tags"
                                        value={tagInput}
                                        onChange={handleTagChange}
                                        onKeyDown={handleTagKeyDown}
                                        disabled={!isAdmin}
                                        className="flex-1 min-w-[120px] bg-transparent focus:outline-none text-sm py-0.5"
                                        placeholder={(!formData.tags && tagInput === '') ? (core.tags?.placeholder ?? 'campaign, social-media, q3-launch') : ''}
                                    />
                                </div>
                                <Hint field={core.tags} />
                            </div>
                        )}

                        {visibleCustomFields.map(field => (
                            <div key={field.id}>
                                {/* A category-scoped field says so, otherwise it looks like it
                                    was always there and vanishing on a category change reads
                                    as a bug rather than as configuration. */}
                                {field.skillId !== null && (
                                    <div className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">
                                        {skills.find(s => s.id === field.skillId)?.name ?? 'Category'} only
                                    </div>
                                )}
                                <CustomFieldInput
                                    field={field}
                                    value={customValues[field.fieldKey]}
                                    disabled={!isAdmin}
                                    inputClassName={inputClass}
                                    onChange={(value) => setCustomValues(prev => ({ ...prev, [field.fieldKey]: value }))}
                                />
                            </div>
                        ))}
                    </div>
                )}

                {/* Form Actions */}
                <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-6">
                    <button
                        type="button"
                        onClick={() => {
                            // Reset means "back to how the form opens", which now includes
                            // whatever defaults an admin configured.
                            setFormData(blankForm());
                            setCustomValues(defaultCustomValues(customFieldsFor(formFields, null)));
                            setCategorySearch('');
                            setTagInput('');
                        }}
                        disabled={!isAdmin || isSubmitting}
                        className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Reset
                    </button>
                    <button
                        type="submit"
                        disabled={!isAdmin || isSubmitting}
                        className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {isSubmitting ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                Submitting...
                            </>
                        ) : (
                            <>
                                <Send className="w-4 h-4" />
                                Submit Request
                            </>
                        )}
                    </button>
                </div>
            </form>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <h3 className="text-sm font-medium text-blue-900 mb-2">What happens next?</h3>
                <ul className="text-sm text-blue-800 space-y-1">
                    <li>• Your request will be reviewed and assigned to the appropriate team</li>
                    <li>• You'll receive a notification when it's assigned</li>
                    <li>• The assigned team member will confirm the timeline and start date</li>
                    <li>• You can track progress in the task details page</li>
                </ul>
            </div>

            {/* Share Form Modal */}
            {showShareModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-lg w-full mx-4">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-gray-900">Share Request Form</h3>
                            <button onClick={() => setShowShareModal(false)} className="text-gray-400 hover:text-gray-600">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <p className="text-sm text-gray-600 mb-4">
                            Share this link with external stakeholders to submit work requests. They don't need an account to use it.
                        </p>

                        {/* Shareable Link */}
                        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                            <div className="flex items-center gap-2 mb-2">
                                <LinkIcon className="w-4 h-4 text-gray-400" />
                                <span className="text-xs font-medium text-gray-700">Shareable Link</span>
                            </div>
                            {shareError ? (
                                <div className="flex items-start gap-2 text-sm text-red-700">
                                    <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                                    <span>{shareError}</span>
                                </div>
                            ) : (
                                <>
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="text"
                                            value={shareLoading ? 'Loading link...' : shareUrl}
                                            readOnly
                                            onFocus={(e) => e.currentTarget.select()}
                                            className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded text-sm text-gray-900"
                                        />
                                        <button
                                            onClick={copyToClipboard}
                                            disabled={!shareUrl}
                                            className="px-3 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <Copy className="w-4 h-4" />
                                            Copy
                                        </button>
                                    </div>
                                    {shareLink && !shareLink.publicAccess && (
                                        <p className="text-xs text-amber-700 mt-2">
                                            Public access is off, so anyone opening this link sees a “form is closed” notice.
                                        </p>
                                    )}
                                </>
                            )}
                        </div>

                        {/* Link Settings */}
                        <div className="space-y-3 mb-6">
                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <div>
                                    <div className="text-sm font-medium text-gray-900">Public Access</div>
                                    <div className="text-xs text-gray-500">Anyone with the link can submit requests</div>
                                </div>
                                <label className={`relative inline-flex items-center ${isAdmin && shareLink ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                                    <input
                                        type="checkbox"
                                        className="sr-only peer"
                                        checked={shareLink?.publicAccess ?? false}
                                        disabled={!isAdmin || !shareLink || savingSetting !== null}
                                        onChange={(e) => updateShareSetting('publicAccess', e.target.checked)}
                                    />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                            </div>

                            <div className="p-3 bg-gray-50 rounded-lg">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <div className="text-sm font-medium text-gray-900">Send Confirmation Email</div>
                                        <div className="text-xs text-gray-500">Auto-send confirmation to requester</div>
                                    </div>
                                    <label className={`relative inline-flex items-center ${isAdmin && shareLink && emailConfigured !== false ? 'cursor-pointer' : 'cursor-not-allowed opacity-60'}`}>
                                        <input
                                            type="checkbox"
                                            className="sr-only peer"
                                            checked={shareLink?.sendConfirmation ?? false}
                                            disabled={
                                                !isAdmin ||
                                                !shareLink ||
                                                savingSetting !== null ||
                                                // Turning it off is always allowed; turning it on
                                                // when nothing can send is not.
                                                (emailConfigured === false && !shareLink.sendConfirmation)
                                            }
                                            onChange={(e) => updateShareSetting('sendConfirmation', e.target.checked)}
                                        />
                                        <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                    </label>
                                </div>
                                {emailConfigured === false && (
                                    <p className="text-xs text-amber-700 mt-2">
                                        Email sending isn't set up yet. Deploy the <code className="font-mono">send-request-confirmation</code> function and set <code className="font-mono">RESEND_API_KEY</code> to enable this.
                                    </p>
                                )}
                            </div>
                        </div>

                        {!isAdmin && (
                            <p className="text-xs text-gray-500 mb-4">
                                Only admins can change these settings. You can still copy and share the link.
                            </p>
                        )}

                        <div className="flex items-center justify-end gap-2">
                            <button
                                onClick={openPreview}
                                disabled={!shareUrl}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Eye className="w-4 h-4" />
                                Preview Form
                            </button>
                            <button
                                onClick={() => setShowShareModal(false)}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                            >
                                Done
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Customize Form Modal. Lives in its own component: it edits
                request_form_fields and this file only needs the result. */}
            {showCustomizeModal && (
                <CustomizeFormModal
                    isAdmin={isAdmin}
                    onClose={() => setShowCustomizeModal(false)}
                    onSaved={applyConfig}
                />
            )}

        </div>
    );
}
