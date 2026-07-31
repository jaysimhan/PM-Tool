import React, { useState, useEffect } from 'react';
import { User } from '../types/types';
import { Users as UsersIcon, UserPlus, Settings, Award } from 'lucide-react';
import { useData } from '../contexts/DataContext';
import { supabase } from '../lib/supabaseClient';

interface Props {
    currentUser: User;
}

export default function TeamManagement({ currentUser }: Props) {
    const { users, teams, skills, refreshTeams } = useData();
    const [selectedTeam, setSelectedTeam] = useState<string>(teams[0]?.id || '');
    const [showAddMember, setShowAddMember] = useState(false);
    const [showCreateTeam, setShowCreateTeam] = useState(false);
    const [newTeamName, setNewTeamName] = useState('');
    const [newTeamDesc, setNewTeamDesc] = useState('');
    const [newTeamColor, setNewTeamColor] = useState('#3b82f6');
    const [showEditTeam, setShowEditTeam] = useState(false);
    const [editTeamName, setEditTeamName] = useState('');
    const [editTeamDesc, setEditTeamDesc] = useState('');
    const [editTeamColor, setEditTeamColor] = useState('');

    useEffect(() => {
        if (!selectedTeam && teams.length > 0) {
            setSelectedTeam(teams[0].id);
        }
    }, [teams, selectedTeam]);

    const team = teams.find(t => t.id === selectedTeam);
    const teamMembers = team ? users.filter(u => team.memberIds.includes(u.id)) : [];
    const teamLeader = team ? users.find(u => u.id === team.leaderId) : null;

    const getSkillName = (skillId: string) => {
        return skills.find(s => s.id === skillId)?.name || skillId;
    };

    const handleAddMember = () => {
        setShowAddMember(true);
    };

    const handleRemoveMember = async (userId: string) => {
        if (!team) return;
        if (confirm('Are you sure you want to remove this member?')) {
            const { error } = await supabase
                .from('team_members')
                .delete()
                .eq('team_id', team.id)
                .eq('user_id', userId);
            
            if (error) {
                console.error('Error removing member:', error);
                alert('Error removing member.');
            } else {
                await refreshTeams();
            }
        }
    };

    const handleAddMemberToTeam = async (userId: string) => {
        if (!team) return;
        const { error } = await supabase
            .from('team_members')
            .insert({ team_id: team.id, user_id: userId });
        
        if (error) {
            console.error('Error adding member:', error);
            alert('Error adding member.');
        } else {
            await refreshTeams();
            setShowAddMember(false);
        }
    };

    const handleCreateTeam = async () => {
        if (!newTeamName) return;
        const { data, error } = await supabase
            .from('teams')
            .insert({
                name: newTeamName,
                description: newTeamDesc,
                color: newTeamColor,
                leader_id: currentUser.id
            })
            .select();
        
        if (error) {
            console.error('Error creating team:', error);
            alert('Error creating team.');
        } else {
            await refreshTeams();
            setShowCreateTeam(false);
            setNewTeamName('');
            setNewTeamDesc('');
            if (data && data[0]) {
                setSelectedTeam(data[0].id);
            }
        }
    };
    const handleOpenEditTeam = () => {
        if (!team) return;
        setEditTeamName(team.name);
        setEditTeamDesc(team.description);
        setEditTeamColor(team.color);
        setShowEditTeam(true);
    };

    const handleSaveEditTeam = async () => {
        if (!team || !editTeamName) return;
        const { error } = await supabase
            .from('teams')
            .update({
                name: editTeamName,
                description: editTeamDesc,
                color: editTeamColor
            })
            .eq('id', team.id);
        
        if (error) {
            console.error('Error updating team:', error);
            alert('Error updating team.');
        } else {
            await refreshTeams();
            setShowEditTeam(false);
        }
    };

    return (
        <div className="space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-semibold text-gray-900">Team Management</h1>
                <p className="text-sm text-gray-600 mt-1">Manage teams, members, and skills</p>
            </div>

            {/* Team Selector */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <label className="text-sm font-medium text-gray-700">Select Team:</label>
                        <select
                            value={selectedTeam}
                            onChange={(e) => setSelectedTeam(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        >
                            {teams.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </select>
                    </div>

                    {(currentUser.role === 'super_admin' || currentUser.role === 'admin') && (
                        <button 
                            onClick={() => setShowCreateTeam(true)}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                        >
                            Create New Team
                        </button>
                    )}
                </div>
            </div>

            {team && (
                <>
                    {/* Team Overview */}
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <div className="flex items-start justify-between mb-6">
                            <div>
                                <div className="flex items-center gap-3 mb-2">
                                    <div
                                        className="w-10 h-10 rounded-lg flex items-center justify-center"
                                        style={{ backgroundColor: `${team.color}20` }}
                                    >
                                        <UsersIcon className="w-6 h-6" style={{ color: team.color }} />
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-semibold text-gray-900">{team.name}</h2>
                                        <p className="text-sm text-gray-600">{team.description}</p>
                                    </div>
                                </div>
                            </div>

                            {(currentUser.role === 'super_admin' || currentUser.role === 'admin') && (
                                <button 
                                    onClick={handleOpenEditTeam}
                                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-2"
                                >
                                    <Settings className="w-4 h-4" />
                                    Edit Team
                                </button>
                            )}
                        </div>

                        <div className="grid grid-cols-3 gap-6">
                            <div>
                                <div className="text-sm text-gray-600 mb-1">Team Leader</div>
                                {teamLeader && (
                                    <div className="flex items-center gap-2">
                                        <div
                                            className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium"
                                            style={{ backgroundColor: team.color }}
                                        >
                                            {teamLeader.name.split(' ').map(n => n[0]).join('')}
                                        </div>
                                        <span className="text-sm font-medium text-gray-900">{teamLeader.name}</span>
                                    </div>
                                )}
                            </div>

                            <div>
                                <div className="text-sm text-gray-600 mb-1">Team Members</div>
                                <div className="text-2xl font-semibold text-gray-900">{teamMembers.length}</div>
                            </div>

                            <div>
                                <div className="text-sm text-gray-600 mb-1">Team Skills</div>
                                <div className="text-2xl font-semibold text-gray-900">{team.skillIds.length}</div>
                            </div>
                        </div>
                    </div>

                    {/* Team Members */}
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-gray-900">Team Members</h2>
                            <button
                                onClick={handleAddMember}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2"
                            >
                                <UserPlus className="w-4 h-4" />
                                Add Member
                            </button>
                        </div>

                        <div className="space-y-3">
                            {teamMembers.map(member => {
                                const memberSkills = member.skillIds.map(id => getSkillName(id));
                                const isLeader = member.id === team.leaderId;

                                return (
                                    <div key={member.id} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                                        <div className="flex items-start justify-between">
                                            <div className="flex items-start gap-3 flex-1">
                                                <div
                                                    className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-medium"
                                                    style={{ backgroundColor: team.color }}
                                                >
                                                    {member.name.split(' ').map(n => n[0]).join('')}
                                                </div>

                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <h3 className="text-sm font-medium text-gray-900">{member.name}</h3>
                                                        {isLeader && (
                                                            <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                                                                Team Leader
                                                            </span>
                                                        )}
                                                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded capitalize">
                                                            {member.role.replace('_', ' ')}
                                                        </span>
                                                    </div>

                                                    <div className="text-xs text-gray-500 mb-2">{member.email}</div>

                                                    <div className="flex items-center gap-2 mb-2">
                                                        <span className="text-xs text-gray-600">Daily Capacity:</span>
                                                        <span className="text-xs font-medium text-gray-900">{member.dailyCapacity}h</span>
                                                    </div>

                                                    <div className="flex items-start gap-2">
                                                        <Award className="w-4 h-4 text-gray-400 mt-0.5" />
                                                        <div className="flex-1">
                                                            <div className="text-xs text-gray-600 mb-1">Skills:</div>
                                                            <div className="flex flex-wrap gap-1">
                                                                {memberSkills.slice(0, 4).map((skill, index) => (
                                                                    <span key={index} className="px-2 py-0.5 bg-purple-50 text-purple-700 text-xs rounded">
                                                                        {skill}
                                                                    </span>
                                                                ))}
                                                                {memberSkills.length > 4 && (
                                                                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                                                                        +{memberSkills.length - 4} more
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 ml-4">
                                                <button className="px-3 py-1 border border-gray-300 text-gray-700 rounded text-xs hover:bg-gray-50">
                                                    Edit
                                                </button>
                                                {!isLeader && (currentUser.role === 'super_admin' || currentUser.role === 'admin') && (
                                                    <button
                                                        onClick={() => handleRemoveMember(member.id)}
                                                        className="px-3 py-1 border border-red-300 text-red-700 rounded text-xs hover:bg-red-50"
                                                    >
                                                        Remove
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Team Skills */}
                    <div className="bg-white rounded-lg border border-gray-200 p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-lg font-semibold text-gray-900">Team Skills</h2>
                            {(currentUser.role === 'super_admin' || currentUser.role === 'admin') && (
                                <button className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50">
                                    Manage Skills
                                </button>
                            )}
                        </div>

                        <div className="grid grid-cols-4 gap-3">
                            {team.skillIds.map(skillId => {
                                const skill = skills.find(s => s.id === skillId);
                                if (!skill) return null;

                                const membersWithSkill = teamMembers.filter(m => m.skillIds.includes(skillId)).length;

                                return (
                                    <div key={skillId} className="border border-gray-200 rounded-lg p-3">
                                        <div className="text-sm font-medium text-gray-900 mb-1">{skill.name}</div>
                                        <div className="text-xs text-gray-500">
                                            {membersWithSkill} {membersWithSkill === 1 ? 'member' : 'members'}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}

            {/* Add Member Modal (simplified) */}
            {showAddMember && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Add Team Member</h3>
                        <p className="text-sm text-gray-600 mb-4">
                            Select an existing user to add to {team?.name}
                        </p>

                        <div className="space-y-3 mb-6 max-h-60 overflow-y-auto">
                            {users
                                .filter(u => !team?.memberIds.includes(u.id) && u.role !== 'super_admin')
                                .map(user => (
                                    <div key={user.id} className="border border-gray-200 rounded p-3 hover:border-blue-300 cursor-pointer">
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <div className="text-sm font-medium text-gray-900">{user.name}</div>
                                                <div className="text-xs text-gray-500">{user.email}</div>
                                            </div>
                                            <button 
                                                onClick={() => handleAddMemberToTeam(user.id)}
                                                className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700"
                                            >
                                                Add
                                            </button>
                                        </div>
                                    </div>
                                ))}
                        </div>

                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowAddMember(false)}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Create Team Modal */}
            {showCreateTeam && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Create New Team</h3>
                        <div className="space-y-4 mb-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Team Name</label>
                                <input
                                    type="text"
                                    value={newTeamName}
                                    onChange={(e) => setNewTeamName(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                    placeholder="Enter team name"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                                <textarea
                                    value={newTeamDesc}
                                    onChange={(e) => setNewTeamDesc(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                    placeholder="Enter team description"
                                    rows={3}
                                />
                            </div>
                            <div className="flex items-center gap-4">
                                <label className="block text-sm font-medium text-gray-700">Team Color</label>
                                <input
                                    type="color"
                                    value={newTeamColor}
                                    onChange={(e) => setNewTeamColor(e.target.value)}
                                    className="h-10 w-16 cursor-pointer rounded border border-gray-300 p-0.5"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowCreateTeam(false)}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateTeam}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                            >
                                Create Team
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Edit Team Modal */}
            {showEditTeam && team && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-4">Edit Team</h3>
                        <div className="space-y-4 mb-6">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Team Name</label>
                                <input
                                    type="text"
                                    value={editTeamName}
                                    onChange={(e) => setEditTeamName(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                    placeholder="Enter team name"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                                <textarea
                                    value={editTeamDesc}
                                    onChange={(e) => setEditTeamDesc(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                    placeholder="Enter team description"
                                    rows={3}
                                />
                            </div>
                            <div className="flex items-center gap-4">
                                <label className="block text-sm font-medium text-gray-700">Team Color</label>
                                <input
                                    type="color"
                                    value={editTeamColor}
                                    onChange={(e) => setEditTeamColor(e.target.value)}
                                    className="h-10 w-16 cursor-pointer rounded border border-gray-300 p-0.5"
                                />
                            </div>
                        </div>

                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowEditTeam(false)}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveEditTeam}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                            >
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
