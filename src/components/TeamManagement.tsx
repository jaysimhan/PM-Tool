import React, { useState, useEffect } from 'react';
import { User } from '../types/types';
import { Users as UsersIcon, UserPlus, Settings, Award, X, HelpCircle, Lock, Link as LinkIcon, Edit2, Trash2, Shield } from 'lucide-react';
import { useData } from '../contexts/DataContext';
import { supabase, supabaseAdmin } from '../lib/supabaseClient';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
interface Props {
    currentUser: User;
}

export default function TeamManagement({ currentUser }: Props) {
    const { users, teams, skills, refreshTeams, refreshSkills, refreshUsers } = useData();
    const { confirm } = useConfirm();
    const [selectedTeam, setSelectedTeam] = useState<string>(teams[0]?.id || '');
    const [showInviteMember, setShowInviteMember] = useState(false);
    const [inviteSearch, setInviteSearch] = useState('');
    const [selectedInvitees, setSelectedInvitees] = useState<User[]>([]);
    const [showInviteDropdown, setShowInviteDropdown] = useState(false);
    const [inviteRole, setInviteRole] = useState('Editor');
    const [inviteMessage, setInviteMessage] = useState('');
    const [showCreateTeam, setShowCreateTeam] = useState(false);
    const [newTeamName, setNewTeamName] = useState('');
    const [newTeamDesc, setNewTeamDesc] = useState('');
    const [newTeamColor, setNewTeamColor] = useState('#3b82f6');
    const [showEditTeam, setShowEditTeam] = useState(false);
    const [editTeamName, setEditTeamName] = useState('');
    const [editTeamDesc, setEditTeamDesc] = useState('');
    const [editTeamColor, setEditTeamColor] = useState('');
    const [showManageSkills, setShowManageSkills] = useState(false);
    const [showTransferOwnership, setShowTransferOwnership] = useState(false);
    const [transferTargetId, setTransferTargetId] = useState('');
    // The team a modal (invite/edit/delete/manage skills) is acting on - distinct from
    // selectedTeam because selectedTeam can be 'all' while a modal still targets one team.
    const [actionTeamId, setActionTeamId] = useState('');
    const [manageSkillsSearch, setManageSkillsSearch] = useState('');
    const [newSkillName, setNewSkillName] = useState('');
    const [newSkillCategory, setNewSkillCategory] = useState('General');
    const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
    const [editSkillName, setEditSkillName] = useState('');
    const [editSkillCategory, setEditSkillCategory] = useState('');
    const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
    const [editingMemberRole, setEditingMemberRole] = useState('');

    useEffect(() => {
        if (!selectedTeam && teams.length > 0) {
            setSelectedTeam(teams[0].id);
        }
    }, [teams, selectedTeam]);

    const team = selectedTeam !== 'all' ? teams.find(t => t.id === selectedTeam) : undefined;
    const actionTeam = teams.find(t => t.id === actionTeamId);
    const getSkillName = (skillId: string) => {
        return skills.find(s => s.id === skillId)?.name || skillId;
    };

    // Only the super admin can assign 'admin'; admins/super admin can assign 'team_leader'.
    // 'super_admin' itself only ever changes via Transfer Ownership.
    const assignableRoles = currentUser.role === 'super_admin'
        ? ['team_member', 'team_leader', 'admin']
        : ['team_member', 'team_leader'];

    const handleRemoveMember = async (teamId: string, userId: string) => {
        const member = users.find(u => u.id === userId);
        if (member?.role === 'super_admin') {
            toast.error('The super admin cannot be removed from their team. Transfer ownership first.');
            return;
        }
        confirm('Are you sure you want to remove this member?', async () => {
            const { error } = await supabase
                .from('team_members')
                .delete()
                .eq('team_id', teamId)
                .eq('user_id', userId);

            if (error) {
                console.error('Error removing member:', error);
                toast.error('Error removing member.');
            } else {
                await refreshTeams();
                if (refreshUsers) await refreshUsers();
                toast.success('Member removed.');
            }
        });
    };

    const handleSaveMemberRole = async (userId: string) => {
        if (!editingMemberRole) return;
        if (!assignableRoles.includes(editingMemberRole)) {
            toast.error('You are not allowed to assign that role.');
            return;
        }
        const { error } = await supabase.from('users').update({ role: editingMemberRole }).eq('id', userId);
        if (error) {
            console.error('Error updating user role:', error);
            toast.error('Error updating user role.');
        } else {
            if (refreshUsers) await refreshUsers();
            setEditingMemberId(null);
            toast.success('Role updated.');
        }
    };

    const handleTransferOwnership = async () => {
        if (!transferTargetId) return;
        const target = users.find(u => u.id === transferTargetId);
        if (!target) return;
        confirm(`Transfer ownership to ${target.name}? You will become an admin and lose super admin access.`, async () => {
            const { error } = await supabase.rpc('transfer_super_admin_ownership', { new_super_admin_id: transferTargetId });
            if (error) {
                console.error('Error transferring ownership:', error);
                toast.error(error.message || 'Error transferring ownership.');
            } else {
                await refreshUsers();
                await refreshTeams();
                setShowTransferOwnership(false);
                setTransferTargetId('');
                toast.success(`Ownership transferred to ${target.name}.`);
            }
        });
    };

    const handleDeleteTeam = (t: typeof teams[0]) => {
        if (t.isHomeTeam) {
            toast.error('The home team cannot be deleted — the super admin must always belong to it.');
            return;
        }
        confirm(`Delete "${t.name}"? This removes all its members and skills.`, async () => {
            const { error } = await supabase.from('teams').delete().eq('id', t.id);
            if (error) {
                console.error('Error deleting team:', error);
                toast.error('Error deleting team.');
            } else {
                await refreshTeams();
                if (selectedTeam === t.id) {
                    setSelectedTeam(teams.find(other => other.id !== t.id)?.id || '');
                }
                toast.success('Team deleted.');
            }
        });
    };

    const handleSendInvites = async () => {
        if (!actionTeam) return;
        let successfulInvites = 0;

        let inviteesToProcess = [...selectedInvitees];
        
        // Auto-add whatever is currently typed in the input field when hitting send
        if (inviteSearch.trim()) {
            const parts = inviteSearch.split(',');
            parts.forEach((part, index) => {
                const searchStr = part.trim();
                if (searchStr) {
                    const matchedUser = users.find(u => u.email.toLowerCase() === searchStr.toLowerCase() || u.name.toLowerCase() === searchStr.toLowerCase());
                    if (matchedUser && !inviteesToProcess.find(u => u.id === matchedUser.id)) {
                        inviteesToProcess.push(matchedUser);
                    } else if (!matchedUser && !inviteesToProcess.find(u => u.email === searchStr)) {
                        inviteesToProcess.push({ 
                            id: `temp-${Date.now()}-auto-${index}`, 
                            name: searchStr, 
                            email: searchStr, 
                            role: 'team_member', 
                            avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${searchStr}&backgroundColor=3b82f6` 
                        } as any);
                    }
                }
            });
        }

        const generatedLinks: { email: string, link: string }[] = [];

        for (const user of inviteesToProcess) {
            let userId = user.id;

            // Existing users can only belong to one team at a time
            if (!userId.startsWith('temp-')) {
                const existingUser = users.find(u => u.id === userId);
                const conflictingTeamId = existingUser?.teamIds.find(tid => tid !== actionTeam.id);
                if (conflictingTeamId) {
                    const conflictingTeamName = teams.find(t => t.id === conflictingTeamId)?.name || 'another team';
                    toast.error(`${existingUser!.name} is already on ${conflictingTeamName} and cannot be added to multiple teams.`);
                    continue;
                }
            }

            // If the user ID starts with temp-, they are a new user that needs to be invited via Supabase Auth
            if (userId.startsWith('temp-')) {
                // Since SMTP is not configured, generate the invite link instead of sending an email
                const { data, error: inviteError } = await supabaseAdmin.auth.admin.generateLink({
                    type: 'invite',
                    email: user.email,
                    options: {
                        data: {
                            name: user.name,
                        }
                    }
                });
                
                if (inviteError) {
                    console.error('Error generating invite link via Supabase:', inviteError);
                    const errorMsg = inviteError.message && Object.keys(inviteError.message).length > 0
                        ? inviteError.message
                        : `Status ${inviteError.status || 'Unknown'} - Please check your Supabase settings.`;
                    toast.error(`Failed to generate invite link for ${user.email}: ${errorMsg}`);
                    continue; // Skip adding to team if invite failed
                }
                
                if (data && data.user) {
                    userId = data.user.id; // Get the real Supabase Auth user ID
                    if (data.properties?.action_link) {
                        generatedLinks.push({ email: user.email, link: data.properties.action_link });
                    }
                }
            }

            const { error } = await supabase
                .from('team_members')
                .insert({ team_id: actionTeam.id, user_id: userId });
            
            if (error) {
                console.error('Error adding member:', error);
            } else {
                successfulInvites++;
            }
        }
        
        if (successfulInvites > 0) {
            let alertMsg = `Successfully added ${successfulInvites} user(s).`;
            if (inviteMessage.trim()) {
                alertMsg += `\n\nMessage included:\n${inviteMessage}`;
            }
            if (generatedLinks.length > 0) {
                alertMsg += `\n\nSince SMTP is disabled, please send these invite links manually to the users:\n\n`;
                generatedLinks.forEach(gl => {
                    alertMsg += `${gl.email}: ${gl.link}\n`;
                });
            }
            toast.success(alertMsg, { duration: 5000 });
        }
        
        await refreshTeams();
        setShowInviteMember(false);
        setSelectedInvitees([]);
        setInviteSearch('');
        setInviteMessage('');
    };

    const handleCopyLink = () => {
        if (!actionTeam) return;
        const link = `${window.location.origin}/team/invite/${actionTeam.id}`;
        navigator.clipboard.writeText(link);
        toast.success('Invite link copied to clipboard');
    };

    const handleCreateTeam = async () => {
        if (!newTeamName) return;
        const { data, error } = await supabase
            .from('teams')
            .insert({
                name: newTeamName,
                description: newTeamDesc,
                color: newTeamColor
            })
            .select();
        
        if (error) {
            console.error('Error creating team:', error);
            toast.error('Error creating team.');
        } else {
            await refreshTeams();
            setShowCreateTeam(false);
            setNewTeamName('');
            setNewTeamDesc('');
            if (data && data[0]) {
                setSelectedTeam(data[0].id);
            }
            toast.success('Team created.');
        }
    };
    const handleOpenEditTeam = (t: typeof teams[0]) => {
        setEditTeamName(t.name);
        setEditTeamDesc(t.description);
        setEditTeamColor(t.color);
        setShowEditTeam(true);
    };

    const handleSaveEditTeam = async () => {
        if (!actionTeam || !editTeamName) return;

        const { error } = await supabase
            .from('teams')
            .update({
                name: editTeamName,
                description: editTeamDesc,
                color: editTeamColor
            })
            .eq('id', actionTeam.id);
        
        if (error) {
            console.error('Error updating team:', error);
            toast.error('Error updating team.');
        } else {
            await refreshTeams();
            setShowEditTeam(false);
            toast.success('Team updated.');
        }
    };

    const handleToggleTeamSkill = async (skillId: string) => {
        if (!actionTeam) return;
        const isSelected = actionTeam.skillIds.includes(skillId);
        if (isSelected) {
            await supabase.from('team_skills').delete().eq('team_id', actionTeam.id).eq('skill_id', skillId);
        } else {
            await supabase.from('team_skills').insert({ team_id: actionTeam.id, skill_id: skillId });
        }
        await refreshTeams();
    };

    const handleCreateNewSkill = async () => {
        if (!newSkillName.trim() || !actionTeam) return;
        const { data, error } = await supabase.from('skills').insert({
            name: newSkillName.trim(),
            category: newSkillCategory
        }).select();
        
        if (error) {
            console.error('Error creating skill:', error);
            toast.error('Error creating skill.');
            return;
        }
        if (data && data[0]) {
            if (refreshSkills) await refreshSkills();
            await supabase.from('team_skills').insert({ team_id: actionTeam.id, skill_id: data[0].id });
            await refreshTeams();
            setNewSkillName('');
            toast.success('Skill created.');
        }
    };

    const handleDeleteSkill = async (skillId: string) => {
        confirm('Are you sure you want to delete this skill globally?', async () => {
            const { error } = await supabase.from('skills').delete().eq('id', skillId);
            if (error) {
                console.error('Error deleting skill:', error);
                toast.error('Error deleting skill.');
            } else {
                if (refreshSkills) await refreshSkills();
                await refreshTeams();
                toast.success('Skill deleted.');
            }
        });
    };

    const handleSaveEditSkill = async (skillId: string) => {
        if (!editSkillName.trim()) return;
        const { error } = await supabase.from('skills').update({
            name: editSkillName.trim(),
            category: editSkillCategory
        }).eq('id', skillId);
        if (error) {
            console.error('Error updating skill:', error);
            toast.error('Error updating skill.');
        } else {
            if (refreshSkills) await refreshSkills();
            setEditingSkillId(null);
            toast.success('Skill updated.');
        }
    };

    const renderTeamSection = (t: typeof teams[0]) => {
        const teamMembers = users.filter(u => t.memberIds.includes(u.id));
        // Leadership/adminship is just a role held by whoever is on the team - a team can
        // have any number of leaders/admins, or none.
        const teamLeaders = teamMembers.filter(m => m.role === 'team_leader');
        const teamAdmins = teamMembers.filter(m => m.role === 'admin' || m.role === 'super_admin');

        return (
            <>
                {/* Team Overview */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <div className="flex items-start justify-between mb-6">
                        <div>
                            <div className="flex items-center gap-3 mb-2">
                                <div
                                    className="w-10 h-10 rounded-lg flex items-center justify-center"
                                    style={{ backgroundColor: `${t.color}20` }}
                                >
                                    <UsersIcon className="w-6 h-6" style={{ color: t.color }} />
                                </div>
                                <div>
                                    <h2 className="text-xl font-semibold text-gray-900">{t.name}</h2>
                                    <p className="text-sm text-gray-600">{t.description}</p>
                                </div>
                            </div>
                        </div>

                        <div className="flex items-center gap-2">
                            {(currentUser.role === 'super_admin' || currentUser.role === 'admin') && (
                                <button
                                    onClick={() => { setActionTeamId(t.id); handleOpenEditTeam(t); }}
                                    className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-2"
                                >
                                    <Settings className="w-4 h-4" />
                                    Edit Team
                                </button>
                            )}
                            {(currentUser.role === 'super_admin' || currentUser.role === 'admin') && !t.isHomeTeam && (
                                <button
                                    onClick={() => handleDeleteTeam(t)}
                                    className="px-3 py-2 border border-red-300 text-red-700 rounded-lg text-sm hover:bg-red-50 flex items-center gap-2"
                                >
                                    <Trash2 className="w-4 h-4" />
                                    Delete Team
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="grid grid-cols-4 gap-6">
                        <div>
                            <div className="text-sm text-gray-600 mb-1">Team Leaders</div>
                            {teamLeaders.length > 0 ? (
                                <div className="flex flex-wrap items-center gap-2">
                                    {teamLeaders.map(leader => (
                                        <div key={leader.id} className="flex items-center gap-1.5">
                                            <div
                                                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium"
                                                style={{ backgroundColor: t.color }}
                                            >
                                                {leader.name.split(' ').map(n => n[0]).join('')}
                                            </div>
                                            <span className="text-sm font-medium text-gray-900">{leader.name}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <span className="text-sm text-gray-400">No leader assigned</span>
                            )}
                        </div>

                        <div>
                            <div className="text-sm text-gray-600 mb-1">Team Admins</div>
                            {teamAdmins.length > 0 ? (
                                <div className="flex flex-wrap items-center gap-2">
                                    {teamAdmins.map(admin => (
                                        <div key={admin.id} className="flex items-center gap-1.5">
                                            <div
                                                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-medium"
                                                style={{ backgroundColor: t.color }}
                                            >
                                                {admin.name.split(' ').map(n => n[0]).join('')}
                                            </div>
                                            <span className="text-sm font-medium text-gray-900">{admin.name}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <span className="text-sm text-gray-400">No admin assigned</span>
                            )}
                        </div>

                        <div>
                            <div className="text-sm text-gray-600 mb-1">Team Members</div>
                            <div className="text-2xl font-semibold text-gray-900">{teamMembers.length}</div>
                        </div>

                        <div>
                            <div className="text-sm text-gray-600 mb-1">Team Skills</div>
                            <div className="text-2xl font-semibold text-gray-900">{t.skillIds.length}</div>
                        </div>
                    </div>
                </div>

                {/* Team Members */}
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-gray-900">Team Members</h2>
                        {(currentUser.role === 'super_admin' || currentUser.role === 'admin' || currentUser.role === 'team_leader') && (
                            <button
                                onClick={() => { setActionTeamId(t.id); setShowInviteMember(true); }}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2"
                            >
                                <UserPlus className="w-4 h-4" />
                                Invite Team Member
                            </button>
                        )}
                    </div>

                    <div className="space-y-3">
                        {teamMembers.map(member => {
                            const memberSkills = member.skillIds.map(id => getSkillName(id));
                            const isProtected = member.role === 'super_admin';

                            return (
                                <div key={member.id} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 transition-colors">
                                    <div className="flex items-start justify-between">
                                        <div className="flex items-start gap-3 flex-1">
                                            <div
                                                className="w-12 h-12 rounded-full flex items-center justify-center text-white text-sm font-medium"
                                                style={{ backgroundColor: t.color }}
                                            >
                                                {member.name.split(' ').map(n => n[0]).join('')}
                                            </div>

                                            <div className="flex-1">
                                                <div className="flex items-center gap-2 mb-1">
                                                    <h3 className="text-sm font-medium text-gray-900">{member.name}</h3>
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
                                            {editingMemberId === member.id ? (
                                                <div className="flex items-center gap-2">
                                                    <select
                                                        value={editingMemberRole}
                                                        onChange={(e) => setEditingMemberRole(e.target.value)}
                                                        className="pl-2 pr-6 py-1 bg-white border border-gray-300 rounded text-xs appearance-none focus:outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer"
                                                        style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5l3.5 3.5 3.5-3.5' stroke='%239ca3af' stroke-width='1.3' stroke-linecap='round' fill='none'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
                                                    >
                                                        {assignableRoles.map(role => (
                                                            <option key={role} value={role}>
                                                                {role.replace('_', ' ').replace(/^./, c => c.toUpperCase())}
                                                            </option>
                                                        ))}
                                                    </select>
                                                    <button
                                                        onClick={() => handleSaveMemberRole(member.id)}
                                                        className="px-2 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"
                                                    >
                                                        Save
                                                    </button>
                                                    <button
                                                        onClick={() => setEditingMemberId(null)}
                                                        className="px-2 py-1 border border-gray-300 text-gray-700 rounded text-xs hover:bg-gray-50"
                                                    >
                                                        Cancel
                                                    </button>
                                                </div>
                                            ) : (
                                                <>
                                                    {!isProtected && (currentUser.role === 'super_admin' || currentUser.role === 'admin') && (
                                                        <button
                                                            onClick={() => {
                                                                setEditingMemberId(member.id);
                                                                setEditingMemberRole(member.role);
                                                            }}
                                                            className="px-3 py-1 border border-gray-300 text-gray-700 rounded text-xs hover:bg-gray-50"
                                                        >
                                                            Edit Role
                                                        </button>
                                                    )}
                                                    {!isProtected && (currentUser.role === 'super_admin' || currentUser.role === 'admin') && (
                                                        <button
                                                            onClick={() => handleRemoveMember(t.id, member.id)}
                                                            className="px-3 py-1 border border-red-300 text-red-700 rounded text-xs hover:bg-red-50"
                                                        >
                                                            Remove
                                                        </button>
                                                    )}
                                                </>
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
                            <button
                                onClick={() => { setActionTeamId(t.id); setShowManageSkills(true); }}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
                            >
                                Manage Skills
                            </button>
                        )}
                    </div>

                    <div className="grid grid-cols-4 gap-3">
                        {t.skillIds.map(skillId => {
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
        );
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
                            className="pl-3 pr-8 py-2 bg-white border border-gray-300 rounded-lg text-sm appearance-none focus:outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer"
                            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5l3.5 3.5 3.5-3.5' stroke='%239ca3af' stroke-width='1.3' stroke-linecap='round' fill='none'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center' }}
                        >
                            <option value="all">All Teams</option>
                            {teams.map(t => (
                                <option key={t.id} value={t.id}>{t.name}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        {currentUser.role === 'super_admin' && (
                            <button
                                onClick={() => setShowTransferOwnership(true)}
                                className="px-3 py-2 border border-gray-300 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-2"
                            >
                                <Shield className="w-4 h-4" />
                                Transfer Ownership
                            </button>
                        )}
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
            </div>

            {selectedTeam === 'all'
                ? teams.map(t => <React.Fragment key={t.id}>{renderTeamSection(t)}</React.Fragment>)
                : team && renderTeamSection(team)}

            {/* Invite Member Modal */}
            {showInviteMember && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 max-w-[550px] w-full mx-4 shadow-2xl font-sans" onClick={() => setShowInviteDropdown(false)}>
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl text-gray-800">Invite</h3>
                            <button className="p-2 hover:bg-gray-100 rounded-full text-gray-600" onClick={() => setShowInviteMember(false)}>
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        {/* Input area */}
                        <div className="relative mb-2" onClick={(e) => e.stopPropagation()}>
                            <div 
                                className={`border ${selectedInvitees.length > 0 ? 'border-blue-500 ring-1 ring-blue-500' : 'border-gray-300 focus-within:border-blue-500 focus-within:ring-1 focus-within:ring-blue-500'} rounded flex flex-wrap items-start p-1.5 transition-colors`}
                            >
                                <div className="flex flex-wrap gap-1.5 flex-1 items-center min-w-[200px]">
                                    {selectedInvitees.map(user => (
                                        <div key={user.id} className="flex items-center gap-1.5 bg-white border border-gray-300 rounded-full px-1 py-0.5">
                                            <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-700">
                                                {user.name.split(' ').map(n => n[0]).join('')}
                                            </div>
                                            <span className="text-sm text-gray-800 whitespace-nowrap">{user.name}</span>
                                            <button 
                                                onClick={() => setSelectedInvitees(selectedInvitees.filter(u => u.id !== user.id))} 
                                                className="p-0.5 hover:bg-gray-200 rounded-full mr-0.5"
                                            >
                                                <X className="w-3.5 h-3.5 text-gray-600" />
                                            </button>
                                        </div>
                                    ))}
                                    <input
                                        type="text"
                                        placeholder={selectedInvitees.length === 0 ? "Add people" : ""}
                                        value={inviteSearch}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (val.includes(',')) {
                                                const parts = val.split(',');
                                                let newInvitees = [...selectedInvitees];
                                                parts.forEach((part, index) => {
                                                    const searchStr = part.trim();
                                                    if (searchStr) {
                                                        const matchedUser = users.find(u => u.email.toLowerCase() === searchStr.toLowerCase() || u.name.toLowerCase() === searchStr.toLowerCase());
                                                        if (matchedUser && !newInvitees.find(u => u.id === matchedUser.id)) {
                                                            newInvitees.push(matchedUser);
                                                        } else if (!matchedUser && !newInvitees.find(u => u.email === searchStr)) {
                                                            newInvitees.push({ 
                                                                id: `temp-${Date.now()}-${index}`, 
                                                                name: searchStr, 
                                                                email: searchStr, 
                                                                role: 'team_member', 
                                                                avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${searchStr}&backgroundColor=3b82f6` 
                                                            } as any);
                                                        }
                                                    }
                                                });
                                                setSelectedInvitees(newInvitees);
                                                setInviteSearch('');
                                            } else {
                                                setInviteSearch(val);
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && inviteSearch.trim()) {
                                                e.preventDefault();
                                                const searchStr = inviteSearch.trim();
                                                // Find if it matches an existing user, else create a dummy one for the invite
                                                const matchedUser = users.find(u => u.email.toLowerCase() === searchStr.toLowerCase() || u.name.toLowerCase() === searchStr.toLowerCase());
                                                
                                                if (matchedUser && !selectedInvitees.find(u => u.id === matchedUser.id)) {
                                                    setSelectedInvitees([...selectedInvitees, matchedUser]);
                                                } else if (!matchedUser) {
                                                    // Allow inviting external emails
                                                    setSelectedInvitees([...selectedInvitees, { 
                                                        id: `temp-${Date.now()}`, 
                                                        name: searchStr, 
                                                        email: searchStr, 
                                                        role: 'team_member', 
                                                        avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${searchStr}&backgroundColor=3b82f6` 
                                                    } as any]);
                                                }
                                                setInviteSearch('');
                                            }
                                        }}
                                        className="flex-1 min-w-[150px] outline-none text-sm px-1.5 py-1 text-gray-800 placeholder-gray-500"
                                    />
                                </div>
                            </div>
                        </div>

                        {selectedInvitees.length > 0 ? (
                            <div className="flex flex-col mt-4">
                                <div className="border border-gray-300 rounded-md">
                                   <textarea 
                                       className="w-full rounded-md p-3 text-[15px] h-32 focus:outline-none placeholder-gray-500 resize-none"
                                       placeholder="Message"
                                       value={inviteMessage}
                                       onChange={(e) => setInviteMessage(e.target.value)}
                                   />
                                </div>
                                <div className="flex justify-end gap-3 mt-4">
                                    <button 
                                        onClick={() => {
                                            setSelectedInvitees([]);
                                            setInviteSearch('');
                                            setInviteMessage('');
                                        }}
                                        className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                                    >
                                        Cancel
                                    </button>
                                    <button 
                                        onClick={handleSendInvites}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                                    >
                                        Send
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="mt-6">
                                <div className="flex justify-between items-center">
                                    <button 
                                        onClick={handleCopyLink}
                                        className="flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                                    >
                                        <LinkIcon className="w-4 h-4" />
                                        Copy link
                                    </button>
                                    <button 
                                        onClick={() => setShowInviteMember(false)}
                                        className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                                    >
                                        Done
                                    </button>
                                </div>
                            </div>
                        )}
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
            {showEditTeam && actionTeam && (
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
            {/* Transfer Ownership Modal */}
            {showTransferOwnership && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Transfer Ownership</h3>
                        <p className="text-sm text-gray-600 mb-4">
                            There is only one super admin at a time. Transferring ownership makes the
                            selected person super admin and moves them to {teams.find(t => t.isHomeTeam)?.name || 'the home team'};
                            you will become an admin.
                        </p>
                        <div className="mb-6">
                            <label className="block text-sm font-medium text-gray-700 mb-1">New Super Admin</label>
                            <select
                                value={transferTargetId}
                                onChange={(e) => setTransferTargetId(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
                            >
                                <option value="">Select a person</option>
                                {users.filter(u => u.id !== currentUser.id).map(u => (
                                    <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                                ))}
                            </select>
                        </div>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => { setShowTransferOwnership(false); setTransferTargetId(''); }}
                                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleTransferOwnership}
                                disabled={!transferTargetId}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Transfer Ownership
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* Manage Skills Modal */}
            {showManageSkills && actionTeam && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl p-6 max-w-2xl w-full mx-4 shadow-2xl flex flex-col max-h-[85vh]">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-xl font-semibold text-gray-900">Manage Team Skills</h3>
                            <button className="p-2 hover:bg-gray-100 rounded-full text-gray-600" onClick={() => setShowManageSkills(false)}>
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="mb-4">
                            <input
                                type="text"
                                placeholder="Search existing skills..."
                                value={manageSkillsSearch}
                                onChange={(e) => setManageSkillsSearch(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                            />
                        </div>

                        <div className="flex-1 overflow-y-auto min-h-[300px] border border-gray-200 rounded-lg p-2 mb-4 bg-gray-50">
                            <div className="grid grid-cols-2 gap-2">
                                {skills
                                    .filter(s => s.name.toLowerCase().includes(manageSkillsSearch.toLowerCase()))
                                    .map(skill => {
                                        const isSelected = actionTeam.skillIds.includes(skill.id);
                                        return (
                                            <div 
                                                key={skill.id} 
                                                className={`p-3 rounded-lg border flex flex-col justify-center transition-colors ${isSelected ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white hover:border-blue-300'}`}
                                            >
                                                {editingSkillId === skill.id ? (
                                                    <div className="flex flex-col gap-2">
                                                        <input type="text" value={editSkillName} onChange={e => setEditSkillName(e.target.value)} className="w-full px-2 py-1 text-sm border border-gray-300 rounded" />
                                                        <input type="text" value={editSkillCategory} onChange={e => setEditSkillCategory(e.target.value)} className="w-full px-2 py-1 text-xs border border-gray-300 rounded" />
                                                        <div className="flex gap-2 justify-end mt-1">
                                                            <button onClick={() => setEditingSkillId(null)} className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1 border border-gray-300 rounded bg-white">Cancel</button>
                                                            <button onClick={() => handleSaveEditSkill(skill.id)} className="text-xs text-white bg-blue-600 hover:bg-blue-700 px-2 py-1 rounded font-medium">Save</button>
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center justify-between w-full">
                                                        <div className="cursor-pointer flex-1 min-w-0" onClick={() => handleToggleTeamSkill(skill.id)}>
                                                            <div className={`text-sm font-medium truncate ${isSelected ? 'text-blue-900' : 'text-gray-900'}`}>{skill.name}</div>
                                                            <div className={`text-xs truncate ${isSelected ? 'text-blue-600' : 'text-gray-500'}`}>{skill.category}</div>
                                                        </div>
                                                        <div className="flex items-center gap-1 shrink-0 pl-2">
                                                            {(currentUser.role === 'super_admin' || currentUser.role === 'admin') && (
                                                                <>
                                                                    <button onClick={(e) => { e.stopPropagation(); setEditSkillName(skill.name); setEditSkillCategory(skill.category); setEditingSkillId(skill.id); }} className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-100 rounded">
                                                                        <Edit2 className="w-3.5 h-3.5" />
                                                                    </button>
                                                                    <button onClick={(e) => { e.stopPropagation(); handleDeleteSkill(skill.id); }} className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-100 rounded">
                                                                        <Trash2 className="w-3.5 h-3.5" />
                                                                    </button>
                                                                </>
                                                            )}
                                                            {isSelected && (
                                                                <div className="w-5 h-5 ml-1 rounded-full bg-blue-500 text-white flex items-center justify-center">
                                                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                })}
                            </div>
                        </div>

                        <div className="border-t border-gray-200 pt-4 mt-2">
                            <h4 className="text-sm font-medium text-gray-900 mb-2">Create New Skill</h4>
                            <div className="flex gap-2 items-center">
                                <input
                                    type="text"
                                    placeholder="Skill Name"
                                    value={newSkillName}
                                    onChange={(e) => setNewSkillName(e.target.value)}
                                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                />
                                <input
                                    type="text"
                                    placeholder="Category (e.g. Design)"
                                    value={newSkillCategory}
                                    onChange={(e) => setNewSkillCategory(e.target.value)}
                                    className="w-48 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                />
                                <button
                                    onClick={handleCreateNewSkill}
                                    disabled={!newSkillName.trim()}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Create & Add
                                </button>
                            </div>
                        </div>

                        <div className="flex justify-end mt-6">
                            <button 
                                onClick={() => setShowManageSkills(false)}
                                className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-200"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
