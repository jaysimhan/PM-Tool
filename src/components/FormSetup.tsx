import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { useData } from '../contexts/DataContext';
import { Plus, Trash2, Edit2, Check, X, Save } from 'lucide-react';
import { Client, Region, Tag } from '../types/types';
import { getRandomColor, getDiverseColors, getTagStyle, TAG_COLOR_PALETTE } from '../utils/colors';
import { useConfirm } from '../contexts/ConfirmContext';
import toast from 'react-hot-toast';

export function FormSetup() {
    const { clients, regions, allTags, refreshRegions, refreshTags } = useData();
    const { confirm } = useConfirm();
    const [activeTab, setActiveTab] = useState<'brands' | 'regions' | 'tags'>('brands');
    const [error, setError] = useState<string | null>(null);

    // Regions State
    const [isAddingRegion, setIsAddingRegion] = useState(false);
    const [newRegion, setNewRegion] = useState({ name: '', code: '', flag: '' });
    const [editingRegion, setEditingRegion] = useState<Region | null>(null);

    // Tags State
    const [isAddingTag, setIsAddingTag] = useState(false);
    const [newTag, setNewTag] = useState({ name: '', color: '#3b82f6' });
    const [editingTag, setEditingTag] = useState<Tag | null>(null);

    // Brands State
    const [isAddingBrand, setIsAddingBrand] = useState(false);
    const [newBrand, setNewBrand] = useState({ name: '', department: '', website: '' });
    const [editingBrand, setEditingBrand] = useState<Client | null>(null);

    const formatWebsite = (url: string) => {
        let cleanUrl = url.replace(/^(?:https?:\/\/)?(?:www\.)?/i, '').split('/')[0];
        return cleanUrl;
    };

    const handleSaveRegion = async () => {
        try {
            setError(null);
            if (editingRegion) {
                const { error } = await supabase
                    .from('regions')
                    .update({ name: editingRegion.name, code: editingRegion.code, flag: editingRegion.flag })
                    .eq('id', editingRegion.id);
                if (error) throw error;
                setEditingRegion(null);
            } else {
                const { error } = await supabase
                    .from('regions')
                    .insert([{ name: newRegion.name, code: newRegion.code, flag: newRegion.flag }]);
                if (error) throw error;
                setIsAddingRegion(false);
                setNewRegion({ name: '', code: '', flag: '' });
            }
            await refreshRegions();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleDeleteRegion = async (id: string) => {
        confirm('Are you sure you want to delete this region?', async () => {
            try {
                setError(null);
                const { error } = await supabase.from('regions').delete().eq('id', id);
                if (error) throw error;
                await refreshRegions();
                toast.success('Region deleted');
            } catch (err: any) {
                setError(err.message);
                toast.error(err.message);
            }
        });
    };

    const handleSaveTag = async (overrideName?: string) => {
        try {
            setError(null);
            if (editingTag) {
                const { error } = await supabase
                    .from('tags')
                    .update({ name: editingTag.name.charAt(0).toUpperCase() + editingTag.name.slice(1), color: editingTag.color })
                    .eq('id', editingTag.id);
                if (error) throw error;
                setEditingTag(null);
            } else {
                const nameToProcess = overrideName || newTag.name;
                const tagsToCreate = nameToProcess.split(',').map(t => t.trim()).filter(Boolean).map(name => name.charAt(0).toUpperCase() + name.slice(1));
                const uniqueNewTags = tagsToCreate.filter(name => !allTags.some(existing => existing.name.toLowerCase() === name.toLowerCase()));
                const colorsToUse = getDiverseColors(uniqueNewTags.length);
                const uniqueNewTagsData = uniqueNewTags.map((name, idx) => ({ name, color: colorsToUse[idx] }));
                
                if (uniqueNewTagsData.length > 0) {
                    const { error } = await supabase
                        .from('tags')
                        .insert(uniqueNewTagsData);
                    if (error) throw error;
                }
                if (!overrideName) {
                    setIsAddingTag(false);
                }
                setNewTag({ name: '', color: '#3b82f6' });
            }
            await refreshTags();
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleDeleteTag = async (id: string, e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        
        confirm('Are you sure you want to delete this tag?', async () => {
            try {
                setError(null);
                const { error } = await supabase.from('tags').delete().eq('id', id);
                if (error) throw error;
                await refreshTags();
                toast.success('Tag deleted');
            } catch (err: any) {
                console.error('Delete tag error:', err);
                setError(err.message);
                toast.error(err.message);
            }
        });
    };

    const handleSaveBrand = async () => {
        try {
            setError(null);
            if (editingBrand) {
                const website = editingBrand.website ? formatWebsite(editingBrand.website) : '';
                const favicon = website ? `https://www.google.com/s2/favicons?domain=${website}&sz=64` : '';
                const { error } = await supabase
                    .from('clients')
                    .update({ 
                        name: editingBrand.name, 
                        department: editingBrand.department,
                        website,
                        favicon
                    })
                    .eq('id', editingBrand.id);
                if (error) throw error;
                setEditingBrand(null);
            } else {
                const website = newBrand.website ? formatWebsite(newBrand.website) : '';
                const favicon = website ? `https://www.google.com/s2/favicons?domain=${website}&sz=64` : '';
                const { error } = await supabase
                    .from('clients')
                    .insert([{ 
                        name: newBrand.name, 
                        department: newBrand.department,
                        website,
                        favicon
                    }]);
                if (error) throw error;
                setIsAddingBrand(false);
                setNewBrand({ name: '', department: '', website: '' });
            }
            // Ideally we need refreshClients but reloading page works or we can add it to context later
            window.location.reload(); 
        } catch (err: any) {
            setError(err.message);
        }
    };

    const handleDeleteBrand = async (id: string) => {
        confirm('Are you sure you want to delete this brand?', async () => {
            try {
                setError(null);
                const { error } = await supabase.from('clients').delete().eq('id', id);
                if (error) throw error;
                window.location.reload();
            } catch (err: any) {
                setError(err.message);
                toast.error(err.message);
            }
        });
    };

    return (
        <div className="p-8 max-w-5xl mx-auto h-[calc(100vh-4rem)] overflow-y-auto">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-gray-900">Form Setup</h1>
                <p className="text-gray-500 mt-1">Manage Brands, Regions, and Tags available in request forms.</p>
            </div>

            {error && (
                <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-lg flex items-start gap-3">
                    <p className="text-sm">{error}</p>
                </div>
            )}

            {/* Tabs */}
            <div className="flex space-x-4 mb-6 border-b border-gray-200">
                <button
                    className={`pb-4 px-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'brands'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                    onClick={() => setActiveTab('brands')}
                >
                    Brands
                </button>
                <button
                    className={`pb-4 px-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'regions'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                    onClick={() => setActiveTab('regions')}
                >
                    Regions
                </button>
                <button
                    className={`pb-4 px-2 text-sm font-medium border-b-2 transition-colors ${
                        activeTab === 'tags'
                            ? 'border-blue-600 text-blue-600'
                            : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                    onClick={() => setActiveTab('tags')}
                >
                    Tags
                </button>
            </div>

            {/* Content */}
            {activeTab === 'brands' && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-semibold text-gray-900">Brands</h2>
                        <button
                            onClick={() => setIsAddingBrand(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                        >
                            <Plus className="w-4 h-4" /> Add Brand
                        </button>
                    </div>

                    <div className="space-y-4">
                        {isAddingBrand && (
                            <div className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                                <div className="flex-1 space-y-3">
                                    <div className="flex items-start gap-4">
                                        <div className="flex-1">
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Brand Name</label>
                                            <input
                                                type="text"
                                                placeholder="Brand Name"
                                                value={newBrand.name}
                                                onChange={(e) => setNewBrand({ ...newBrand, name: e.target.value })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                            />
                                        </div>
                                        <div className="flex-1">
                                            <label className="block text-xs font-medium text-gray-500 mb-1">Website</label>
                                            <input
                                                type="text"
                                                placeholder="Website (e.g. acme.com)"
                                                value={newBrand.website}
                                                onChange={(e) => setNewBrand({ ...newBrand, website: e.target.value })}
                                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-gray-500 mb-1">Departments</label>
                                        <textarea
                                            placeholder="Departments (e.g. IT, HR, Marketing)"
                                            value={newBrand.department}
                                            onChange={(e) => setNewBrand({ ...newBrand, department: e.target.value })}
                                            className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm resize-none"
                                            rows={2}
                                        />
                                    </div>
                                </div>
                                <div className="flex items-start gap-2 pt-6">
                                    <button onClick={handleSaveBrand} className="p-2 text-green-600 hover:bg-green-50 rounded-md">
                                        <Save className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => setIsAddingBrand(false)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-md">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {clients.map(client => (
                            <div key={client.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-lg hover:border-gray-200 hover:shadow-sm transition-all">
                                {editingBrand?.id === client.id ? (
                                    <div className="flex items-start gap-4 flex-1">
                                        <div className="flex-1 space-y-3">
                                            <div className="flex items-start gap-4">
                                                <div className="flex-1">
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">Brand Name</label>
                                                    <input
                                                        type="text"
                                                        value={editingBrand.name}
                                                        onChange={(e) => setEditingBrand({ ...editingBrand, name: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                                        placeholder="Brand Name"
                                                    />
                                                </div>
                                                <div className="flex-1">
                                                    <label className="block text-xs font-medium text-gray-500 mb-1">Website</label>
                                                    <input
                                                        type="text"
                                                        value={editingBrand.website || ''}
                                                        onChange={(e) => setEditingBrand({ ...editingBrand, website: e.target.value })}
                                                        className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                                                        placeholder="Website (e.g. acme.com)"
                                                    />
                                                </div>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-medium text-gray-500 mb-1">Departments</label>
                                                <textarea
                                                    value={editingBrand.department || ''}
                                                    onChange={(e) => setEditingBrand({ ...editingBrand, department: e.target.value })}
                                                    className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm resize-none"
                                                    placeholder="Departments (e.g. IT, HR)"
                                                    rows={2}
                                                />
                                            </div>
                                        </div>
                                        <div className="flex items-start gap-2 pt-6">
                                            <button onClick={handleSaveBrand} className="p-2 text-green-600 hover:bg-green-50 rounded-md">
                                                <Save className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => setEditingBrand(null)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-md">
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-3">
                                            {client.favicon ? (
                                                <img src={client.favicon} alt={`${client.name} favicon`} className="w-8 h-8 rounded-full bg-gray-50 border border-gray-200" />
                                            ) : (
                                                <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
                                                    {client.name.charAt(0).toUpperCase()}
                                                </div>
                                            )}
                                            <div>
                                                <div className="font-medium text-gray-900">{client.name}</div>
                                                <div className="text-sm text-gray-500 flex items-center gap-2 mt-0.5">
                                                    {client.website && (
                                                        <a 
                                                            href={`https://${client.website}`} 
                                                            target="_blank" 
                                                            rel="noopener noreferrer"
                                                            className="text-blue-600 hover:text-blue-800 hover:underline transition-colors"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            {client.website}
                                                        </a>
                                                    )}
                                                    {client.department && (
                                                        <div className="flex flex-wrap gap-1">
                                                            {client.department.split(',').map(d => d.trim()).filter(Boolean).map((dept, index) => (
                                                                <span key={index} className="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full text-xs border border-gray-200 leading-tight flex items-center">
                                                                    {dept}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => setEditingBrand(client)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors">
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => handleDeleteBrand(client.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {activeTab === 'regions' && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-semibold text-gray-900">Regions</h2>
                        <button
                            onClick={() => setIsAddingRegion(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                        >
                            <Plus className="w-4 h-4" /> Add Region
                        </button>
                    </div>

                    <div className="space-y-4">
                        {isAddingRegion && (
                            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                                <input
                                    type="text"
                                    placeholder="Name (e.g. USA)"
                                    value={newRegion.name}
                                    onChange={(e) => setNewRegion({ ...newRegion, name: e.target.value })}
                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                                />
                                <input
                                    type="text"
                                    placeholder="Code (e.g. US)"
                                    value={newRegion.code}
                                    onChange={(e) => setNewRegion({ ...newRegion, code: e.target.value })}
                                    className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm"
                                />
                                <input
                                    type="text"
                                    placeholder="Flag Emoji (e.g. 🇺🇸)"
                                    value={newRegion.flag}
                                    onChange={(e) => setNewRegion({ ...newRegion, flag: e.target.value })}
                                    className="w-32 px-3 py-2 border border-gray-300 rounded-md text-sm"
                                />
                                <div className="flex items-center gap-2">
                                    <button onClick={handleSaveRegion} className="p-2 text-green-600 hover:bg-green-50 rounded-md">
                                        <Save className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => setIsAddingRegion(false)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-md">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {regions.map(region => (
                            <div key={region.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-lg hover:border-gray-200 hover:shadow-sm transition-all">
                                {editingRegion?.id === region.id ? (
                                    <div className="flex items-center gap-4 flex-1">
                                        <input
                                            type="text"
                                            value={editingRegion.name}
                                            onChange={(e) => setEditingRegion({ ...editingRegion, name: e.target.value })}
                                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                                        />
                                        <input
                                            type="text"
                                            value={editingRegion.code}
                                            onChange={(e) => setEditingRegion({ ...editingRegion, code: e.target.value })}
                                            className="w-24 px-3 py-2 border border-gray-300 rounded-md text-sm"
                                        />
                                        <input
                                            type="text"
                                            value={editingRegion.flag || ''}
                                            onChange={(e) => setEditingRegion({ ...editingRegion, flag: e.target.value })}
                                            className="w-32 px-3 py-2 border border-gray-300 rounded-md text-sm"
                                        />
                                        <div className="flex items-center gap-2">
                                            <button onClick={handleSaveRegion} className="p-2 text-green-600 hover:bg-green-50 rounded-md">
                                                <Save className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => setEditingRegion(null)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-md">
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-3">
                                            <div className="text-2xl">{region.flag}</div>
                                            <div>
                                                <div className="font-medium text-gray-900">{region.name}</div>
                                                <div className="text-sm text-gray-500">{region.code}</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => setEditingRegion(region)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors">
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => handleDeleteRegion(region.id)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                        {regions.length === 0 && !isAddingRegion && (
                            <div className="text-center py-8 text-gray-500 text-sm border border-dashed border-gray-300 rounded-lg">
                                No regions found. Add one to get started.
                            </div>
                        )}
                    </div>
                </div>
            )}

            {activeTab === 'tags' && (
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-semibold text-gray-900">Tags</h2>
                        <button
                            onClick={() => setIsAddingTag(true)}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                        >
                            <Plus className="w-4 h-4" /> Add Tag
                        </button>
                    </div>

                    <div className="space-y-4">
                        {isAddingTag && (
                            <div className="flex items-center gap-4 p-4 bg-gray-50 rounded-lg border border-gray-200">
                                <input
                                    type="text"
                                    placeholder="Name (e.g. Frontend, Backend, UI/UX)"
                                    value={newTag.name}
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val.includes(',')) {
                                            handleSaveTag(val);
                                        } else {
                                            setNewTag({ ...newTag, name: val });
                                        }
                                    }}
                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                                />
                                <div className="flex items-center gap-2">
                                    <button onClick={() => handleSaveTag()} className="p-2 text-green-600 hover:bg-green-50 rounded-md">
                                        <Save className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => setIsAddingTag(false)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-md">
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {allTags.map(tag => (
                            <div key={tag.id} className="flex items-center justify-between p-4 border border-gray-100 rounded-lg hover:border-gray-200 hover:shadow-sm transition-all">
                                {editingTag?.id === tag.id ? (
                                    <div className="flex items-center gap-4 flex-1">
                                        <input
                                            type="text"
                                            value={editingTag.name}
                                            onChange={(e) => setEditingTag({ ...editingTag, name: e.target.value })}
                                            className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm"
                                        />
                                        <div className="flex items-center gap-1.5 flex-wrap mx-2">
                                            {TAG_COLOR_PALETTE.map(c => (
                                                <button
                                                    key={c.hex}
                                                    onClick={() => setEditingTag({ ...editingTag, color: c.hex })}
                                                    className={`w-6 h-6 rounded-full flex items-center justify-center transition-all ${editingTag.color === c.hex ? 'ring-2 ring-offset-1 ring-blue-500 scale-110' : 'hover:scale-110'}`}
                                                    style={{ backgroundColor: c.hex }}
                                                />
                                            ))}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => handleSaveTag()} className="p-2 text-green-600 hover:bg-green-50 rounded-md">
                                                <Save className="w-4 h-4" />
                                            </button>
                                            <button onClick={() => setEditingTag(null)} className="p-2 text-gray-400 hover:bg-gray-100 rounded-md">
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div className="flex items-center gap-3">
                                            <span 
                                                className={`px-3 py-1 text-sm font-medium rounded-full ${getTagStyle(tag.color).className}`}
                                                style={getTagStyle(tag.color).style}
                                            >
                                                {tag.name}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button onClick={() => setEditingTag(tag)} className="p-2 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors">
                                                <Edit2 className="w-4 h-4" />
                                            </button>
                                            <button onClick={(e) => handleDeleteTag(tag.id, e)} className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors">
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        ))}
                        {allTags.length === 0 && !isAddingTag && (
                            <div className="text-center py-8 text-gray-500 text-sm border border-dashed border-gray-300 rounded-lg">
                                No tags found. Add one to get started.
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
