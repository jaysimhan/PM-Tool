import React, { useState } from 'react';
import { User } from '../types/types';
import { workCategories, clients, tasks } from '../data/mockData';
import { FileText, Send, X, Link as LinkIcon, Settings, Copy, Eye } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useData } from '../contexts/DataContext';

interface Props {
    currentUser: User;
}

export default function RequestForm({ currentUser }: Props) {
    const { refreshTasks } = useData();

    const [formData, setFormData] = useState({
        title: '',
        description: '',
        categoryId: '',
        clientId: '',
        department: '',
        priority: 'normal',
        dueDate: '',
        estimatedHours: '',
        tags: ''
    });

    const [showSuccess, setShowSuccess] = useState(false);
    const [showShareModal, setShowShareModal] = useState(false);
    const [showCustomizeModal, setShowCustomizeModal] = useState(false);
    const [shareableLink] = useState('https://workflow-pro.app/request/f7a9b2c1');

    const isAdmin = currentUser.role === 'super_admin' || currentUser.role === 'admin';

    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);
        
        try {
            const { error } = await supabase.from('tasks').insert({
                title: formData.title,
                description: formData.description,
                client_id: formData.clientId || null,
                priority: formData.priority,
                due_date: formData.dueDate || null,
                estimated_hours: formData.estimatedHours ? parseFloat(formData.estimatedHours) : null,
                requester_id: currentUser.id,
                status: 'new_request'
            });

            if (error) throw error;
            
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
                tags: ''
            });

            setTimeout(() => setShowSuccess(false), 3000);
        } catch (error) {
            console.error('Error submitting request:', error);
            alert('Failed to submit request.');
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

    const copyToClipboard = () => {
        navigator.clipboard.writeText(shareableLink);
        alert('Link copied to clipboard!');
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
                                className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'bg-gray-50 text-gray-500' : ''}`}
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
                                className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'bg-gray-50 text-gray-500' : ''}`}
                            >
                                <option value="">Select a brand</option>
                                {clients.map(client => (
                                    <option key={client.id} value={client.id}>{client.name}</option>
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
                                {Array.from(new Set(tasks.map(t => t.department).filter(Boolean))).map(dep => (
                                    <option key={dep} value={dep} />
                                ))}
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
                            <input
                                type="date"
                                name="dueDate"
                                value={formData.dueDate}
                                onChange={handleChange}
                                required
                                disabled={!isAdmin}
                                min={new Date().toISOString().split('T')[0]}
                                className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'bg-gray-50 text-gray-500' : ''}`}
                            />
                        </div>

                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-2">
                                Estimated Hours (optional)
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
                                placeholder="Auto-calculated"
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
                        <input
                            type="text"
                            name="tags"
                            value={formData.tags}
                            onChange={handleChange}
                            disabled={!isAdmin}
                            className={`w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${!isAdmin ? 'bg-gray-50 text-gray-500' : ''}`}
                            placeholder="campaign, social-media, q3-launch"
                        />
                    </div>
                </div>

                {/* Form Actions */}
                {isAdmin && (
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
                                tags: ''
                            })}
                            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                        >
                            Reset
                        </button>
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50"
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
                )}
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
                                    <input type="checkbox" className="sr-only peer" defaultChecked />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                            </div>

                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <div>
                                    <div className="text-sm font-medium text-gray-900">Require Email Verification</div>
                                    <div className="text-xs text-gray-500">Requesters must verify their email</div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" className="sr-only peer" />
                                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                                </label>
                            </div>

                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <div>
                                    <div className="text-sm font-medium text-gray-900">Send Confirmation Email</div>
                                    <div className="text-xs text-gray-500">Auto-send confirmation to requester</div>
                                </div>
                                <label className="relative inline-flex items-center cursor-pointer">
                                    <input type="checkbox" className="sr-only peer" defaultChecked />
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
                            <h3 className="text-lg font-semibold text-gray-900">Customize Request Form</h3>
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
                                { id: 'estimatedHours', label: 'Estimated Hours', required: false },
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

                            <select className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-3">
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
                                    alert('Form configuration saved!');
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
