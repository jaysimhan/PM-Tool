import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { User } from '../types/types';
import { FileText, Send, X, Link as LinkIcon, Settings, Copy, Eye, Calendar } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useData } from '../contexts/DataContext';
import { SingleDatePicker } from './SingleDatePicker';
import { format } from 'date-fns';
import { getRandomColor } from '../utils/colors';
import toast from 'react-hot-toast';

interface Props {
    currentUser: User;
}

export default function RequestForm({ currentUser }: Props) {
    const { refreshTasks, refreshClients, workCategories, clients, tasks, regions, allTags, refreshTags } = useData();

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
    const [showShareModal, setShowShareModal] = useState(false);
    const [showCustomizeModal, setShowCustomizeModal] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [tagInput, setTagInput] = useState('');
    const [shareSettings, setShareSettings] = useState({
        publicAccess: true,
        requireVerification: false,
        sendConfirmation: true
    });
    const baseUrl = import.meta.env.VITE_VERCEL_URL || import.meta.env.VITE_APP_URL || 'https://workflow-pro.app';
    const [shareableLink] = useState(`${baseUrl}/request/f7a9b2c1`);

    const isAdmin = currentUser.role === 'super_admin' || currentUser.role === 'admin';

    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
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

    const copyToClipboard = () => {
        navigator.clipboard.writeText(shareableLink);
        toast.success('Link copied to clipboard!');
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
                                Request ID: REQ-{Math.floor(Math.random() * 10000).toString().padStart(4, '0')} - Your request has been added to the queue.
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
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Work Category <span className="text-red-500">*</span>
                            </label>
                            <select
                                name="categoryId"
                                value={formData.categoryId}
                                onChange={handleChange}
                                required
                                disabled={!isAdmin}
                                className={`w-full pl-3 pr-10 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'bg-gray-50 text-gray-500' : ''}`}
                            >
                                <option value="">Select a category</option>
                                {workCategories.filter(c => c.isActive).map(category => (
                                    <option key={category.id} value={category.id}>{category.name}</option>
                                ))}
                            </select>
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
                        onClick={() => setFormData({
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
                        })}
                        disabled={true}
                        className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        Reset
                    </button>
                    <button
                        type="submit"
                        disabled={true}
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
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={shareableLink}
                                    readOnly
                                    className="flex-1 px-3 py-2 bg-white border border-gray-300 rounded text-sm"
                                />
                                <button
                                    onClick={copyToClipboard}
                                    className="px-3 py-2 bg-blue-600 text-white rounded text-sm font-medium hover:bg-blue-700 flex items-center gap-2"
                                >
                                    <Copy className="w-4 h-4" />
                                    Copy
                                </button>
                            </div>
                        </div>

                        {/* Link Settings */}
                        <div className="space-y-3 mb-6">
                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <div>
                                    <div className="text-sm font-medium text-gray-900">Public Access</div>
                                    <div className="text-xs text-gray-500">Anyone with the link can submit requests</div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        className="sr-only peer" 
                                        checked={shareSettings.publicAccess}
                                        onChange={(e) => setShareSettings({...shareSettings, publicAccess: e.target.checked})}
                                    />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                            </div>

                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <div>
                                    <div className="text-sm font-medium text-gray-900">Require Email Verification</div>
                                    <div className="text-xs text-gray-500">Requesters must verify their email</div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        className="sr-only peer" 
                                        checked={shareSettings.requireVerification}
                                        onChange={(e) => setShareSettings({...shareSettings, requireVerification: e.target.checked})}
                                    />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                            </div>

                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <div>
                                    <div className="text-sm font-medium text-gray-900">Send Confirmation Email</div>
                                    <div className="text-xs text-gray-500">Auto-send confirmation to requester</div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        className="sr-only peer" 
                                        checked={shareSettings.sendConfirmation}
                                        onChange={(e) => setShareSettings({...shareSettings, sendConfirmation: e.target.checked})}
                                    />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                            </div>
                        </div>

                        <div className="flex items-center justify-end gap-2">
                            <button
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 flex items-center gap-2"
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
