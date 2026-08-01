import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { User } from '../types/types';
import { FileText, Send, X, Link as LinkIcon, Settings, Copy, Eye, Calendar, Search, AlertCircle } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useData } from '../contexts/DataContext';
import { SingleDatePicker } from './SingleDatePicker';
import { format } from 'date-fns';
import { getRandomColor } from '../utils/colors';
import { embedText, warmEmbeddingModel } from '../utils/embeddings';
import toast from 'react-hot-toast';

interface Props {
    currentUser: User;
}

export default function RequestForm({ currentUser }: Props) {
    const { refreshTasks, refreshClients, workCategories, skills, clients, tasks, regions, allTags, refreshTags } = useData();

    const [formData, setFormData] = useState({
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
    });

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

    const [isSubmitting, setIsSubmitting] = useState(false);
    const [matchedSkills, setMatchedSkills] = useState(skills);
    const [isSearchingSkills, setIsSearchingSkills] = useState(false);
    const categorySearchRequestId = useRef(0);

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

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!formData.categoryId) {
            toast.error('Please select a work category.');
            return;
        }

        setIsSubmitting(true);

        try {
            const { data: taskData, error } = await supabase.from('tasks').insert({
                title: formData.title,
                description: formData.description,
                client_id: formData.clientId || null,
                priority: formData.priority,
                due_date: formData.dueDate || null,
                estimated_hours: formData.estimatedHours ? parseFloat(formData.estimatedHours) : null,
                requester_id: currentUser.id,
                region_id: formData.regionId || null,
                department: formData.department || null,
                status: 'new_request'
            }).select().single();

            if (error) throw error;

            // The Work Category picker searches skills, so the answer belongs in
            // task_skills. It used to be validated as required and then dropped.
            if (taskData && formData.categoryId) {
                const { error: skillError } = await supabase
                    .from('task_skills')
                    .insert({ task_id: taskData.id, skill_id: formData.categoryId });
                if (skillError) throw skillError;
            }

            // Check if department is new for this brand and add it if so
            if (formData.clientId && formData.department) {
                const client = clients.find(c => c.id === formData.clientId);
                if (client) {
                    const existingDepts = client.department 
                        ? client.department.split(',').map(d => d.trim()).filter(Boolean) 
                        : [];
                    const newDept = formData.department.trim();
                    
                    if (newDept && !existingDepts.some(d => d.toLowerCase() === newDept.toLowerCase())) {
                        const updatedDepts = client.department ? `${client.department}, ${newDept}` : newDept;
                        await supabase
                            .from('clients')
                            .update({ department: updatedDepts })
                            .eq('id', client.id);
                        
                        await refreshClients();
                    }
                }
            }

            // Handle Tags
            if (formData.tags) {
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
            setFormData({
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
            });
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
            <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
                {/* Basic Information */}
                <div className="space-y-4">
                    <h2 className="text-lg font-semibold text-gray-900">Basic Information</h2>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Request Title <span className="text-red-500">*</span>
                        </label>
                        <input
                            type="text"
                            name="title"
                            value={formData.title}
                            onChange={handleChange}
                            required
                            disabled={!isAdmin}
                            className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'bg-gray-50 text-gray-500' : ''}`}
                            placeholder="E.g., Social media campaign for product launch"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Description <span className="text-red-500">*</span>
                        </label>
                        <textarea
                            name="description"
                            value={formData.description}
                            onChange={handleChange}
                            required
                            disabled={!isAdmin}
                            rows={4}
                            className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'bg-gray-50 text-gray-500' : ''}`}
                            placeholder="Provide detailed information about what you need..."
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div ref={categoryFieldRef} className="relative">
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Work Category <span className="text-red-500">*</span>
                            </label>
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
                                    placeholder="Search a category..."
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
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Brand <span className="text-red-500">*</span>
                            </label>
                            <select
                                name="clientId"
                                value={formData.clientId}
                                onChange={handleChange}
                                required
                                disabled={!isAdmin}
                                className={`w-full pl-3 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'bg-gray-50 text-gray-500' : ''}`}
                            >
                                <option value="">Select a brand</option>
                                {clients.map(client => (
                                    <option key={client.id} value={client.id}>{client.name}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Region <span className="text-red-500">*</span>
                            </label>
                            <select
                                name="regionId"
                                value={formData.regionId}
                                onChange={handleChange}
                                required
                                disabled={!isAdmin}
                                className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'bg-gray-50 text-gray-500' : ''}`}
                            >
                                <option value="">Select a region</option>
                                {regions.map(region => (
                                    <option key={region.id} value={region.id}>
                                        {region.flag} {region.name}
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
                                name="department"
                                value={formData.department}
                                onChange={handleChange}
                                required
                                disabled={!isAdmin}
                                list="department-suggestions"
                                className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'bg-gray-50 text-gray-500' : ''}`}
                                placeholder="Enter or select department"
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
                        </div>
                    </div>
                </div>

                {/* Priority and Timeline */}
                <div className="space-y-4 border-t border-gray-200 pt-6">
                    <h2 className="text-lg font-semibold text-gray-900">Priority and Timeline</h2>

                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Priority <span className="text-red-500">*</span>
                            </label>
                            <select
                                name="priority"
                                value={formData.priority}
                                onChange={handleChange}
                                required
                                disabled={!isAdmin}
                                className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'bg-gray-50 text-gray-500' : ''}`}
                            >
                                <option value="low">Low</option>
                                <option value="normal">Normal</option>
                                <option value="high">High</option>
                                <option value="urgent">Urgent</option>
                            </select>
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Due Date <span className="text-red-500">*</span>
                            </label>
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
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Estimated Hours to complete
                            </label>
                            <input
                                type="number"
                                name="estimatedHours"
                                value={formData.estimatedHours}
                                onChange={handleChange}
                                disabled={!isAdmin}
                                min="1"
                                step="0.5"
                                className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'bg-gray-50 text-gray-500' : ''}`}
                                placeholder="e.g. 5"
                            />
                        </div>
                    </div>
                </div>

                {/* Additional Details */}
                <div className="space-y-4 border-t border-gray-200 pt-6">
                    <h2 className="text-lg font-semibold text-gray-900">Additional Details</h2>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Tags (comma-separated)
                        </label>
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
                                placeholder={(!formData.tags && tagInput === '') ? "campaign, social-media, q3-launch" : ""}
                            />
                        </div>
                    </div>
                </div>

                {/* Form Actions */}
                <div className="flex items-center justify-end gap-3 border-t border-gray-200 pt-6">
                    <button
                        type="button"
                        onClick={() => {
                            setFormData({
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
                            });
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

            {/* Customize Form Modal */}
            {showCustomizeModal && (
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
                            <button onClick={() => setShowCustomizeModal(false)} className="text-gray-400 hover:text-gray-600">
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <p className="text-sm text-gray-600 mb-6">
                            Configure which fields appear on the request form and set default values.
                        </p>

                        {/* Form Field Configuration */}
                        <div className="space-y-4 mb-6">
                            <h4 className="text-sm font-semibold text-gray-900">Form Fields</h4>

                            {[
                                { id: 'title', label: 'Request Title', required: true },
                                { id: 'description', label: 'Description', required: true },
                                { id: 'category', label: 'Work Category', required: true },
                                { id: 'client', label: 'Brand', required: true },
                                { id: 'department', label: 'Department', required: true },
                                { id: 'priority', label: 'Priority', required: false },
                                { id: 'dueDate', label: 'Due Date', required: true },
                                { id: 'estimatedHours', label: 'Estimated Hours to complete', required: false },
                                { id: 'tags', label: 'Tags', required: false },
                                { id: 'deliverableCount', label: 'Deliverable Quantity', required: false },
                                { id: 'targetAudience', label: 'Target Audience', required: false },
                                { id: 'brandGuidelines', label: 'Brand Guidelines', required: false }
                            ].map(field => (
                                <div key={field.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input type="checkbox" className="sr-only peer" defaultChecked={field.required} />
                                            <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                        </label>
                                        <div>
                                            <div className="text-sm font-medium text-gray-900">{field.label}</div>
                                            {field.required && (
                                                <div className="text-xs text-gray-500">Required field</div>
                                            )}
                                        </div>
                                    </div>
                                    <button className="text-sm text-blue-600 hover:text-blue-700">
                                        Configure
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* Category-Specific Fields */}
                        <div className="border-t border-gray-200 pt-6 mb-6">
                            <h4 className="text-sm font-semibold text-gray-900 mb-4">Category-Specific Fields</h4>
                            <p className="text-sm text-gray-600 mb-4">
                                Configure custom fields that appear based on the selected work category.
                            </p>

                            <select className="w-full pl-3 pr-10 py-2 border border-gray-300 rounded-lg text-sm mb-3">
                                <option>Select a category to configure</option>
                                {workCategories.map(cat => (
                                    <option key={cat.id}>{cat.name}</option>
                                ))}
                            </select>

                            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-800">
                                <strong>Example:</strong> For "Videos" category, you can add fields like: Duration, Format, Aspect Ratio, Voice-over Required, etc.
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2 border-t border-gray-200 pt-6">
                            <button
                                onClick={() => setShowCustomizeModal(false)}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={() => {
                                    toast.success('Form configuration saved!');
                                    setShowCustomizeModal(false);
                                }}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                            >
                                Save Configuration
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
