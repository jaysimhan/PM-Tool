import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { User, AccessRequest } from '../types/types';
import { Users as UsersIcon, UserPlus, Settings, Award, X, HelpCircle, Lock, Edit2, Trash2, Shield, Copy, Loader2, Mail, Building2, Globe } from 'lucide-react';
import { useData } from '../contexts/DataContext';
import { supabase } from '../lib/supabaseClient';
import { inviteUser, generateSetupPassword, type InviteResult } from '../lib/adminInvite';
import toast from 'react-hot-toast';
import { useConfirm } from '../contexts/ConfirmContext';
import { embedText } from '../utils/embeddings';
import { useVirtualWindow } from '../lib/useVirtualWindow';
import { PageSkeleton } from './Skeleton';
import { useModalFocusTrap } from '../lib/useModalFocusTrap';
interface Props {
    currentUser: User;
}

interface GeneratedCredential {
    email: string;
    temporaryPassword: string;
    expiresAt: string;
}

export default React.memo(TeamManagement);

const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[a-zA-Z]{2,}$/;

// Spreadsheet and mail-client copies often carry `Name <a@b.com>` or quoted values.
const extractEmail = (raw: string): string | null => {
    const angled = raw.match(/<([^>]+)>/);
    const candidate = (angled ? angled[1] : raw).replace(/^["']+|["']+$/g, '').trim();
    return EMAIL_RE.test(candidate) ? candidate : null;
};

// Entries arrive comma/semicolon separated, or newline/tab separated from Excel. A space
// only splits when every piece it produces is an email, so names like "John Doe" survive.
const splitEntries = (raw: string): string[] =>
    raw.split(/[,;\n\r\t]+/)
        .flatMap(part => {
            const pieces = part.trim().split(/\s+/);
            return pieces.length > 1 && pieces.every(p => extractEmail(p)) ? pieces : [part];
        })
        .map(p => p.trim())
        .filter(Boolean);

let tempInviteeCount = 0;
const makeTempInvitee = (email: string) => ({
    id: `temp-${Date.now()}-${tempInviteeCount++}`,
    name: email,
    email,
    role: 'team_member',
    avatar: `https://api.dicebear.com/7.x/initials/svg?seed=${email}&backgroundColor=3b82f6`,
} as unknown as User);

function TeamManagement({ currentUser }: Props) {
    const { users, teams, skills, clients, regions, tasks, loading, refreshTeams, refreshSkills, refreshUsers } = useData();
    const [commentAuthorIds, setCommentAuthorIds] = useState<Set<string>>(new Set());
    const { confirm } = useConfirm();
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => {
        if (currentUser.role !== 'super_admin') return;
        let cancelled = false;
        supabase.from('comments').select('user_id').then(({ data, error }) => {
            if (cancelled) return;
            if (error) {
                toast.error('Could not verify account history. Account deletion is disabled for safety.');
                // A sentinel makes every account look historical and therefore non-deletable.
                setCommentAuthorIds(new Set(users.map(user => user.id)));
                return;
            }
            setCommentAuthorIds(new Set((data || []).map(row => row.user_id).filter(Boolean) as string[]));
        });
        return () => { cancelled = true; };
    }, [currentUser.role, users]);

    // The viewer's own team always sorts first; everything else is alphabetical.
    const sortedTeams = useMemo(() => {
        const myTeamId = teams.find(t => t.memberIds.includes(currentUser.id))?.id;
        return [...teams].sort((a, b) => {
            const aMine = a.id === myTeamId;
            const bMine = b.id === myTeamId;
            if (aMine && !bMine) return -1;
            if (bMine && !aMine) return 1;
            return a.name.localeCompare(b.name);
        });
    }, [teams, currentUser.id]);

    const [selectedTeam, setSelectedTeam] = useState<string>('all');
    const [showInviteMember, setShowInviteMember] = useState(false);
    const [inviteSearch, setInviteSearch] = useState('');
    const [selectedInvitees, setSelectedInvitees] = useState<User[]>([]);
    const [removedActiveUsers, setRemovedActiveUsers] = useState<User[]>([]);
    const [showInviteDropdown, setShowInviteDropdown] = useState(false);
    const [inviteRole, setInviteRole] = useState('Editor');
    const [unassignedSearch, setUnassignedSearch] = useState('');
    // Invites nobody has claimed yet. Separate search and separate list from the teamless
    // members below: the two look alike and mean opposite things.
    const [pendingSearch, setPendingSearch] = useState('');
    const [generatedCredentials, setGeneratedCredentials] = useState<GeneratedCredential[]>([]);
    const credentialsDialogRef = useRef<HTMLDivElement>(null);
    const closeGeneratedCredentials = useCallback(() => setGeneratedCredentials([]), []);
    useModalFocusTrap(generatedCredentials.length > 0, closeGeneratedCredentials, credentialsDialogRef);

    // Pending "let me in" requests from the login screen. Admins only -- RLS says the same,
    // so a non-admin asking for them gets an empty list rather than a hidden one.
    const [accessRequests, setAccessRequests] = useState<AccessRequest[]>([]);
    const [busyRequestId, setBusyRequestId] = useState<string | null>(null);
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
    // Keyboard highlight within the invite suggestion dropdown (-1 = nothing highlighted).
    const [inviteHighlight, setInviteHighlight] = useState(-1);
    // "Add existing people" search inside the Edit Team modal. The results list stays open
    // while the box has focus so an empty query still browses everyone available.
    const [addMemberSearch, setAddMemberSearch] = useState('');
    const [addMemberFocused, setAddMemberFocused] = useState(false);
    const teamWindow = useVirtualWindow(sortedTeams.length, 900, 720, 1);

    useEffect(() => {
        if (!selectedTeam && sortedTeams.length > 0) {
            setSelectedTeam('all');
        }
    }, [sortedTeams, selectedTeam]);

    // Arriving from the sidebar's Invite Team Member button. It cannot say which team it
    // means, so default to the viewer's own and let them switch inside the dialog. The state
    // is cleared straight away, otherwise a reload would reopen the dialog.
    useEffect(() => {
        if (!(location.state as { openInvite?: boolean } | null)?.openInvite) return;
        if (sortedTeams.length === 0) return;

        const ownTeam = sortedTeams.find(t => t.memberIds.includes(currentUser.id));
        setActionTeamId((ownTeam || sortedTeams[0]).id);
        setSelectedInvitees([]);
        setInviteSearch('');
        setRemovedActiveUsers([]);
        setInviteHighlight(-1);
        setShowInviteDropdown(false);
        setShowInviteMember(true);
        navigate(location.pathname, { replace: true, state: null });
    }, [location, sortedTeams, currentUser.id, navigate]);

    const skillNames = useMemo(() => new Map(skills.map(s => [s.id, s.name])), [skills]);
    const clientNames = useMemo(() => new Map(clients.map(c => [c.id, c.name])), [clients]);
    const regionLabels = useMemo(() => new Map(regions.map(r => [r.id, r.flag ? `${r.flag} ${r.name}` : r.name])), [regions]);
    const team = useMemo(() => selectedTeam !== 'all' ? teams.find(t => t.id === selectedTeam) : undefined, [teams, selectedTeam]);
    const actionTeam = useMemo(() => teams.find(t => t.id === actionTeamId), [teams, actionTeamId]);
    const getSkillName = useCallback((skillId: string) => skillNames.get(skillId) || skillId, [skillNames]);
    // The brands and regions a member wants work from. Shown beside their skills because the
    // three together are what decides whether the round robin can hand them anything.
    const getClientName = useCallback((clientId: string) => clientNames.get(clientId) || clientId, [clientNames]);
    const getRegionLabel = useCallback((regionId: string) => regionLabels.get(regionId) || regionId, [regionLabels]);

    // Everyone can view every team's members/skills. Admins and the super admin can
    // manage any team; a team leader can only edit/invite for the team they're on.
    const canManageTeam = (t: typeof teams[0]) =>
        currentUser.role === 'super_admin' ||
        currentUser.role === 'admin' ||
        (currentUser.role === 'team_leader' && t.memberIds.includes(currentUser.id));

    // Nobody hands out 'super_admin' — it only moves via Transfer Ownership — and 'admin' is
    // the super admin's to give. Everything below that is fair game for both.
    //
    // 'requester' and 'invitee' are absent on purpose: they are where someone sits before they
    // have an account to attach a job to, not roles to assign. Finishing setup promotes them out,
    // so handing either back to a member would just recreate the state the promotion exists to
    // clear. Both still show in the dropdown for anyone who currently holds one — see the option
    // lists below.
    const rolesBelowAdmin = ['team_member', 'team_leader', 'manager'];
    const assignableRoles = currentUser.role === 'super_admin'
        ? [...rolesBelowAdmin, 'admin']
        : rolesBelowAdmin;

    const canEditRoles = currentUser.role === 'super_admin' || currentUser.role === 'admin';

    const matchesQuery = (u: User, query: string) => {
        const q = query.trim().toLowerCase();
        return !q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q);
    };

    const inviteSuggestions = useMemo(() => {
        if (!showInviteMember || !inviteSearch.trim()) return [];
        return users
            .filter(u => !u.isActive || u.deletedAt)
            .filter(u => !selectedInvitees.some(s => s.id === u.id))
            .filter(u => !actionTeam?.memberIds.includes(u.id))
            .filter(u => matchesQuery(u, inviteSearch))
            .slice(0, 6);
    }, [users, selectedInvitees, actionTeam, inviteSearch, showInviteMember]);

    const addInvitee = (user: User) => {
        setSelectedInvitees(prev => prev.some(u => u.id === user.id) ? prev : [...prev, user]);
        setInviteSearch('');
        setInviteHighlight(-1);
        setShowInviteDropdown(false);
    };

    // People the Edit Team modal can pull in directly: everyone not already on this team.
    // Someone already on another team is still listed but flagged, since membership is exclusive,
    // and so is an unclaimed invite -- the row exists from the moment the invite goes out, so they
    // are searchable here long before there is a person to put on a team.
    const addMemberCandidates = useMemo(() => {
        if (!actionTeam) return [];
        return users
            .filter(u => !actionTeam.memberIds.includes(u.id))
            .filter(u => matchesQuery(u, addMemberSearch))
            .slice(0, 8);
    }, [users, actionTeam, addMemberSearch]);

    // teams and users are two separate fetches over the same team_members table, so refreshing
    // one without the other renders a member card out of two different moments: the team knows
    // somebody joined, the users row is still the copy from page load. That reads as a state the
    // app is not supposed to be able to reach -- a member badged 'Invitee', under the name their
    // invite was addressed to, with none of the skills they just picked -- and it is only the
    // screen being half-updated. Anything that re-reads memberships re-reads people too.
    const refreshTeamsAndPeople = async () => {
        await refreshTeams();
        if (refreshUsers) await refreshUsers();
    };

    // Everything below goes through a SECURITY DEFINER function rather than writing to the
    // table: who may remove, deactivate or delete is a rule, and a rule that lives only in
    // which buttons get rendered is not enforced at all -- the anon key can reach these
    // tables directly. The same calls also demote, sign the person out everywhere and tell
    // whoever needs to reassign their work.
    const handleRemoveMember = async (teamId: string, userId: string) => {
        const member = users.find(u => u.id === userId);
        confirm(
            `Remove ${member?.name || 'this member'} from the team? They will be signed out everywhere and asked to pick a team next time they log in, and anyone who can reassign their open tasks will be told.`,
            async () => {
                const { error } = await supabase.rpc('remove_team_member', {
                    p_team_id: teamId,
                    p_user_id: userId
                });

                if (error) {
                    console.error('Error removing member:', error);
                    toast.error(error.message || 'Error removing member.');
                    return;
                }
                await refreshTeamsAndPeople();
                toast.success('Member removed.');
            }
        );
    };

    // People who belong to no team: invitees who never finished setup, and anyone an admin
    // has taken off a team. They are invisible in the per-team lists, so they get their own.
    const canSeeUnassigned = currentUser.role === 'super_admin' || currentUser.role === 'admin';

    // Access requests now notify managers and team leaders too, and a notification that links to
    // a page where the thing it is about is invisible is a dead end -- so they can read the queue.
    // Only the reading is widened: approving and dismissing stay with admins, here and in the
    // database (resolve_access_request has not moved).
    const canSeeAccessRequests = canSeeUnassigned
        || currentUser.role === 'manager'
        || currentUser.role === 'team_leader';

    const loadAccessRequests = useCallback(async () => {
        if (!canSeeAccessRequests) return;
        const { data, error } = await supabase
            .from('access_requests')
            .select('id, kind, user_id, name, email, note, status, created_at')
            .eq('status', 'pending')
            .order('created_at', { ascending: false });
        if (error) {
            console.error('Could not load access requests:', error);
            return;
        }
        setAccessRequests((data || []).map((r: any) => ({
            id: r.id,
            kind: r.kind,
            userId: r.user_id,
            name: r.name,
            email: r.email,
            note: r.note,
            status: r.status,
            createdAt: r.created_at
        })));
    }, [canSeeAccessRequests]);

    useEffect(() => { loadAccessRequests(); }, [loadAccessRequests]);

    const resolveRequest = async (id: string, status: 'invited' | 'dismissed') => {
        const { error } = await supabase.rpc('resolve_access_request', { p_id: id, p_status: status });
        if (error) {
            toast.error(error.message || 'Could not update that request.');
            return false;
        }
        setAccessRequests(prev => prev.filter(r => r.id !== id));
        return true;
    };

    // Approval, which is what an invite is here: it mints the auth identity, which is what
    // makes them an 'invitee' rather than a requester. No team is attached -- they land on the
    // default one when they finish setup, and step 2 is where they can disagree.
    const inviteFromRequest = async (request: AccessRequest) => {
        setBusyRequestId(request.id);
        try {
            let result: InviteResult;
            try {
                result = await inviteUser({ email: request.email, name: request.name });
            } catch (err) {
                console.error('Error inviting from access request:', err);
                toast.error(`Could not invite ${request.email}: ${err instanceof Error ? err.message : 'unknown error'}`);
                return;
            }

            if (!result.temporaryPassword || !result.expiresAt) {
                toast.error('The account was created without a temporary password. Generate a new one from Pending Setup.');
            } else {
                setGeneratedCredentials([{
                    email: request.email,
                    temporaryPassword: result.temporaryPassword,
                    expiresAt: result.expiresAt,
                }]);
                toast.success(`${request.email} approved. Copy their temporary password now.`);
            }

            await resolveRequest(request.id, 'invited');
            if (refreshUsers) await refreshUsers();
        } finally {
            setBusyRequestId(null);
        }
    };

    const reactivateFromRequest = async (request: AccessRequest) => {
        const target = users.find(u => u.id === request.userId);
        if (!target) return;
        setBusyRequestId(request.id);
        try {
            await setUserActive(target, true);
            await resolveRequest(request.id, 'invited');
        } finally {
            setBusyRequestId(null);
        }
    };
    // Two lists, because "invited, hasn't set up an account" and "has an account, no team" are
    // different problems with different answers -- re-send the link, or put them on a team.
    // Un-onboarded people are excluded from the teamless list rather than appearing in both.
    const unassignedUsers = useMemo(() => {
        if (!canSeeUnassigned) return [];
        return users
            .filter(u => u.onboardingCompleted && u.teamIds.length === 0 && u.role !== 'super_admin' && !u.deletedAt)
            .filter(u => matchesQuery(u, unassignedSearch))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [users, canSeeUnassigned, unassignedSearch]);

    const pendingSetupUsers = useMemo(() => {
        if (!canSeeUnassigned) return [];
        return users
            .filter(u => !u.onboardingCompleted && !u.deletedAt)
            .filter(u => matchesQuery(u, pendingSearch))
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [users, canSeeUnassigned, pendingSearch]);

    const createSetupPassword = async (user: User) => {
        try {
            const result = await generateSetupPassword(user.email);
            if (!result.temporaryPassword || !result.expiresAt) {
                throw new Error('No temporary password was returned.');
            }
            setGeneratedCredentials([{
                email: user.email,
                temporaryPassword: result.temporaryPassword,
                expiresAt: result.expiresAt,
            }]);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not generate a temporary password.');
        }
    };

    const setUserActive = async (user: User, isActive: boolean) => {
        const { error } = await supabase.rpc('set_user_active', {
            p_user_id: user.id,
            p_active: isActive
        });
        if (error) {
            console.error('Error changing user active state:', error);
            toast.error(error.message || `Could not ${isActive ? 'reactivate' : 'deactivate'} ${user.name}.`);
            return;
        }
        if (refreshUsers) await refreshUsers();
        toast.success(`${user.name} ${isActive ? 'reactivated' : 'deactivated'}.`);
    };

    // Only the super admin may delete, and only an account with nothing hanging off it.
    // Anyone who has actually worked here keeps their name on it and gets deactivated
    // instead -- the button is not offered, so the rule is visible before it is enforced.
    const hasHistory = (userId: string) =>
        tasks.some((t: any) => t.assignedToId === userId || t.requesterId === userId || t.assignedById === userId)
        || commentAuthorIds.has(userId);

    const canDeleteAccount = (user: User) =>
        currentUser.role === 'super_admin'
        && user.role !== 'super_admin'
        && user.id !== currentUser.id
        && !user.deletedAt
        && !hasHistory(user.id);

    const handleDeleteUser = (user: User) => {
        confirm(
            `Delete ${user.name}'s account? Their login is destroyed and they disappear from the app. If they ever come back it will be as a new account, from scratch.`,
            async () => {
                const { error } = await supabase.rpc('delete_user_account', { p_user_id: user.id });
                if (error) {
                    console.error('Error deleting account:', error);
                    toast.error(error.message || `Could not delete ${user.name}.`);
                    return;
                }
                await refreshTeamsAndPeople();
                toast.success(`${user.name}'s account was deleted.`);
            }
        );
    };

    const handleDeactivateUser = (user: User) => {
        if (user.role === 'super_admin') {
            toast.error('The super admin cannot be deactivated. Transfer ownership first.');
            return;
        }
        if (user.id === currentUser.id) {
            toast.error('You cannot deactivate your own account.');
            return;
        }
        confirm(
            `Deactivate ${user.name}? They will lose access and drop out of workload planning. Their tasks and history stay put, and you can reactivate them here at any time.`,
            () => setUserActive(user, false)
        );
    };

    const updateMemberRole = async (userId: string, role: string) => {
        if (!role) return false;
        const member = users.find(u => u.id === userId);
        // An invite nobody has claimed is not a person with a job yet. They hold 'invitee'
        // until they set up an account, and set_user_role refuses this too -- for the super
        // admin as much as for anyone -- so this is the readable version of that refusal.
        if (member && !member.onboardingCompleted) {
            toast.error(`${member.name} has not set up their account yet, so they stay an invitee until they do.`);
            return false;
        }
        if (member?.role === 'super_admin') {
            toast.error("The super admin's role can only change through Transfer Ownership.");
            return false;
        }
        // Re-saving the role someone already has is a no-op, not an attempt to assign it.
        // Matters for roles the viewer cannot hand out but can still see in the dropdown.
        if (member && role === member.role) return true;
        if (!assignableRoles.includes(role)) {
            toast.error('You are not allowed to assign that role.');
            return false;
        }
        // Through the function, not the table. users.role decides what a person may do, so
        // the column is no longer writable by the client at all -- the checks above are the
        // UI being helpful, and set_user_role is the same rules where they cannot be skipped.
        const { error } = await supabase.rpc('set_user_role', { p_user_id: userId, p_role: role });
        if (error) {
            console.error('Error updating user role:', error);
            toast.error(error.message || 'Error updating user role.');
            return false;
        }
        if (refreshUsers) await refreshUsers();
        toast.success('Role updated.');
        return true;
    };

    const handleSaveMemberRole = async (userId: string) => {
        if (await updateMemberRole(userId, editingMemberRole)) {
            setEditingMemberId(null);
        }
    };

    // Adds someone who already has an account straight onto the team - no invite email,
    // no onboarding. Membership is exclusive, so anyone on another team is rejected here.
    const handleAddExistingMember = async (userId: string) => {
        if (!actionTeam) return;
        const user = users.find(u => u.id === userId);
        if (!user) return;

        // An unclaimed invite is not somebody who can be put on a team. Joining one is what
        // promotes a placeholder role, and the database refuses that promotion until setup is
        // done -- so this would seat an 'invitee' in the member list and leave them there. It
        // would also decide their team behind their back: complete_onboarding_step_one keeps
        // whatever team they are already on, so the team the invite named never gets applied.
        if (!user.onboardingCompleted) {
            toast.error(`${user.name} has not set up their account yet. They land on a team when they finish.`);
            return;
        }

        const conflictingTeamId = user.teamIds.find(tid => tid !== actionTeam.id);
        if (conflictingTeamId) {
            const conflictingTeamName = teams.find(t => t.id === conflictingTeamId)?.name || 'another team';
            toast.error(`${user.name} is already on ${conflictingTeamName} and cannot be added to multiple teams.`);
            return;
        }

        const { error } = await supabase
            .from('team_members')
            .insert({ team_id: actionTeam.id, user_id: userId });

        if (error) {
            console.error('Error adding member:', error);
            toast.error(`Could not add ${user.name} to ${actionTeam.name}.`);
            return;
        }
        await refreshTeamsAndPeople();
        setAddMemberSearch('');
        toast.success(`${user.name} added to ${actionTeam.name}.`);
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
                await refreshTeamsAndPeople();
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
                // Deleting a team takes its members off it, and the database demotes and signs
                // out anyone that leaves teamless -- so the roles on this page have moved too.
                await refreshTeamsAndPeople();
                if (selectedTeam === t.id) {
                    setSelectedTeam(teams.find(other => other.id !== t.id)?.id || '');
                }
                toast.success('Team deleted.');
            }
        });
    };

    // Resolves raw text into capsules: known users match by name or email, anything else
    // that parses as an email becomes a pending invite. Whatever cannot be resolved comes
    // back as `leftover` so it can stay in the input for the user to finish typing.
    const capsulizeEntries = (raw: string, current: User[]) => {
        const invitees = [...current];
        const leftover: string[] = [];
        const activeRemoved: User[] = [];
        splitEntries(raw).forEach(entry => {
            const matchedUser = users.find(u => u.email.toLowerCase() === entry.toLowerCase() || u.name.toLowerCase() === entry.toLowerCase());
            const email = extractEmail(entry);
            if (matchedUser) {
                if (matchedUser.isActive && !matchedUser.deletedAt) {
                    if (!activeRemoved.some(u => u.id === matchedUser.id)) activeRemoved.push(matchedUser);
                } else {
                    if (!invitees.some(u => u.id === matchedUser.id)) invitees.push(matchedUser);
                }
            } else if (email) {
                if (!invitees.some(u => u.email.toLowerCase() === email.toLowerCase())) invitees.push(makeTempInvitee(email));
            } else {
                leftover.push(entry);
            }
        });
        return { invitees, leftover: leftover.join(', '), activeRemoved };
    };

    // Pull anything still sitting in the input into capsules (on paste, blur, Enter, send).
    const flushInviteInput = (raw: string, notifyInvalid = false) => {
        const { invitees, leftover, activeRemoved } = capsulizeEntries(raw, selectedInvitees);
        setSelectedInvitees(invitees);
        setInviteSearch(leftover);
        if (activeRemoved.length > 0) {
            setRemovedActiveUsers(prev => {
                const newArr = [...prev];
                activeRemoved.forEach(u => { if (!newArr.some(existing => existing.id === u.id)) newArr.push(u); });
                return newArr;
            });
        }
        if (leftover && notifyInvalid) toast.error(`"${leftover}" is not a valid email address.`);
        return { invitees, leftover };
    };

    const handleSendInvites = async () => {
        if (!actionTeam) return;
        let successfulInvites = 0;

        // Auto-add whatever is currently typed in the input field when hitting send
        const { invitees: inviteesToProcess, leftover } = inviteSearch.trim()
            ? flushInviteInput(inviteSearch, true)
            : { invitees: selectedInvitees, leftover: '' };

        if (leftover) return;
        if (inviteesToProcess.length === 0) return;

        const credentials: GeneratedCredential[] = [];
        const invitedEmails: string[] = [];

        for (const user of inviteesToProcess) {
            // A temp id means nobody by that address exists yet, so they need an auth invite.
            // Someone invited earlier who never finished setup also does: a database trigger
            // gives them a profile row the moment the first invite goes out, so they look
            // like an existing member here without ever having set a password.
            const existingUser = users.find(u => u.id === user.id);
            const isNewInvite = user.id.startsWith('temp-');
            const needsResend = !isNewInvite && existingUser?.onboardingCompleted === false;

            if (needsResend) {
                try {
                    const result = await generateSetupPassword(user.email);
                    if (result.temporaryPassword && result.expiresAt) {
                        credentials.push({
                            email: user.email,
                            temporaryPassword: result.temporaryPassword,
                            expiresAt: result.expiresAt,
                        });
                    }
                } catch (err) {
                    toast.error(`Failed to generate a temporary password for ${user.email}: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    continue;
                }
                successfulInvites++;
                invitedEmails.push(user.email);
                continue;
            }

            if (isNewInvite) {
                // Lands them on account setup: password, then team and skills. The team rides
                // along in user_metadata rather than going into team_members now: that table's
                // user_id references public.users, and an invitee has no row there until
                // onboarding creates one. Onboarding applies it from there.
                try {
                    const result = await inviteUser({
                        email: user.email,
                        name: user.name,
                        teamId: actionTeam.id,
                    });

                    if (result.temporaryPassword && result.expiresAt) {
                        credentials.push({
                            email: user.email,
                            temporaryPassword: result.temporaryPassword,
                            expiresAt: result.expiresAt,
                        });
                    }
                } catch (err) {
                    toast.error(`Failed to invite ${user.email}: ${err instanceof Error ? err.message : 'Unknown error'}`);
                    continue;
                }

                successfulInvites++;
                invitedEmails.push(user.email);
                continue;
            }

            if (existingUser && (!existingUser.isActive || existingUser.deletedAt)) {
                // Inactive user, reactivate them first
                const { error: activeError } = await supabase.rpc('set_user_active', {
                    p_user_id: user.id,
                    p_active: true
                });
                if (activeError) {
                    console.error('Error reactivating user:', activeError);
                    toast.error(`Could not reactivate ${user.name}.`);
                    continue;
                }
            }

            // Existing users are fully set up already, so they join the team right away.
            if (actionTeam.memberIds.includes(user.id)) {
                toast.error(`${existingUser?.name || user.email} is already on ${actionTeam.name}.`);
                continue;
            }

            // Existing users can only belong to one team at a time
            const conflictingTeamId = existingUser?.teamIds.find(tid => tid !== actionTeam.id);
            if (conflictingTeamId) {
                const conflictingTeamName = teams.find(t => t.id === conflictingTeamId)?.name || 'another team';
                toast.error(`${existingUser!.name} is already on ${conflictingTeamName} and cannot be added to multiple teams.`);
                continue;
            }

            const { error } = await supabase
                .from('team_members')
                .insert({ team_id: actionTeam.id, user_id: user.id });

            if (error) {
                console.error('Error adding member:', error);
                toast.error(`Could not add ${user.email} to ${actionTeam.name}.`);
            } else {
                successfulInvites++;
                invitedEmails.push(user.email);
            }
        }

        if (successfulInvites > 0) {
            const who = successfulInvites === 1 ? invitedEmails[0] : `${successfulInvites} people`;
            toast.success(`Created ${who} for ${actionTeam.name}. Copy the temporary ${credentials.length === 1 ? 'password' : 'passwords'} now.`, { duration: 6000 });
            if (credentials.length > 0) setGeneratedCredentials(credentials);
        }

        await refreshTeamsAndPeople();
        setShowInviteMember(false);
        setSelectedInvitees([]);
        setRemovedActiveUsers([]);
        setInviteSearch('');
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
            await refreshTeamsAndPeople();
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
        setAddMemberSearch('');
        setAddMemberFocused(false);
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
            await refreshTeamsAndPeople();
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
        await refreshTeamsAndPeople();
    };

    const handleCreateNewSkill = async () => {
        if (!newSkillName.trim() || !actionTeam) return;
        const name = newSkillName.trim();
        const embedding = await embedText(`${name} (${newSkillCategory})`).catch(() => null);
        const { data, error } = await supabase.from('skills').insert({
            name,
            category: newSkillCategory,
            ...(embedding ? { embedding } : {})
        }).select();

        if (error) {
            console.error('Error creating skill:', error);
            toast.error('Error creating skill.');
            return;
        }
        if (data && data[0]) {
            if (refreshSkills) await refreshSkills();
            await supabase.from('team_skills').insert({ team_id: actionTeam.id, skill_id: data[0].id });
            await refreshTeamsAndPeople();
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
                await refreshTeamsAndPeople();
                toast.success('Skill deleted.');
            }
        });
    };

    const handleSaveEditSkill = async (skillId: string) => {
        if (!editSkillName.trim()) return;
        const name = editSkillName.trim();
        const embedding = await embedText(`${name} (${editSkillCategory})`).catch(() => null);
        const { error } = await supabase.from('skills').update({
            name,
            category: editSkillCategory,
            ...(embedding ? { embedding } : {})
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
            <div className="bg-white rounded-lg border border-gray-200">
                {/* Team Overview */}
                <div className="p-6">
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
                            {canManageTeam(t) && (
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
                <div className="border-t border-gray-200 p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-lg font-semibold text-gray-900">Team Members</h2>
                        {canManageTeam(t) && (
                            <button
                                onClick={() => {
                                    setActionTeamId(t.id);
                                    setSelectedInvitees([]);
                                    setInviteSearch('');
                                    setInviteHighlight(-1);
                                    setShowInviteDropdown(false);
                                    setShowInviteMember(true);
                                }}
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
                            const memberBrands = (member.clientIds || []).map(id => getClientName(id));
                            const memberRegions = (member.regionIds || []).map(id => getRegionLabel(id));
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

                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                                                    <Award className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                                    <span className="text-xs text-gray-600 -ml-1">Skills:</span>
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
                                                    {memberSkills.length === 0 && (
                                                        <span className="text-xs text-gray-400 italic">
                                                            {member.id === currentUser.id ? 'None yet - add them in Preferences' : 'None yet'}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* What they want handed to them, as opposed to what they can do */}
                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                                                    <Building2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                                    <span className="text-xs text-gray-600 -ml-1">Brands:</span>
                                                    {memberBrands.slice(0, 4).map((brand, index) => (
                                                        <span key={index} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">
                                                            {brand}
                                                        </span>
                                                    ))}
                                                    {memberBrands.length > 4 && (
                                                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                                                            +{memberBrands.length - 4} more
                                                        </span>
                                                    )}
                                                    {memberBrands.length === 0 && (
                                                        <span className="text-xs text-gray-400 italic">
                                                            {member.id === currentUser.id ? 'None yet - pick them in Preferences' : 'None yet'}
                                                        </span>
                                                    )}
                                                </div>

                                                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                                                    <Globe className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                                    <span className="text-xs text-gray-600 -ml-1">Regions:</span>
                                                    {memberRegions.map((region, index) => (
                                                        <span key={index} className="px-2 py-0.5 bg-teal-50 text-teal-700 text-xs rounded">
                                                            {region}
                                                        </span>
                                                    ))}
                                                    {memberRegions.length === 0 && (
                                                        <span className="text-xs text-gray-400 italic">
                                                            {member.id === currentUser.id ? 'None yet - pick them in Preferences' : 'None yet'}
                                                        </span>
                                                    )}
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
                                                        {/* A role the viewer cannot assign still shows, so the select never lies about the current value */}
                                                        {(assignableRoles.includes(member.role) ? assignableRoles : [member.role, ...assignableRoles]).map(role => (
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
                                                    {/* A team leader can remove people from their own team; deactivating
                                                        is an admin's call and deleting is the super admin's alone. */}
                                                    {!isProtected && canManageTeam(t) && (
                                                        <button
                                                            onClick={() => handleRemoveMember(t.id, member.id)}
                                                            className="px-3 py-1 border border-red-300 text-red-700 rounded text-xs hover:bg-red-50"
                                                        >
                                                            Remove
                                                        </button>
                                                    )}
                                                    {!isProtected && member.id !== currentUser.id
                                                        && (currentUser.role === 'super_admin' || currentUser.role === 'admin') && (
                                                        <button
                                                            onClick={() => member.isActive ? handleDeactivateUser(member) : setUserActive(member, true)}
                                                            className="px-3 py-1 border border-gray-300 text-gray-700 rounded text-xs hover:bg-gray-50"
                                                        >
                                                            {member.isActive ? 'Deactivate' : 'Reactivate'}
                                                        </button>
                                                    )}
                                                    {canDeleteAccount(member) && (
                                                        <button
                                                            onClick={() => handleDeleteUser(member)}
                                                            className="px-3 py-1 border border-red-300 text-red-700 rounded text-xs hover:bg-red-50"
                                                        >
                                                            Delete
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
                <div className="border-t border-gray-200 p-6">
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
            </div>
        );
    };

    if (loading) return <PageSkeleton variant="team" />;

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
                            {sortedTeams.map(t => (
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

            {selectedTeam === 'all' ? (
                <div
                    className={sortedTeams.length > 4 ? 'overflow-y-auto space-y-6' : 'space-y-6'}
                    style={sortedTeams.length > 4 ? { maxHeight: teamWindow.viewportHeight } : undefined}
                    onScroll={sortedTeams.length > 4 ? teamWindow.onScroll : undefined}
                >
                    {sortedTeams.length > 4 && <div style={{ height: teamWindow.paddingTop }} aria-hidden="true" />}
                    {(sortedTeams.length > 4 ? sortedTeams.slice(teamWindow.start, teamWindow.end) : sortedTeams)
                        .map(t => <React.Fragment key={t.id}>{renderTeamSection(t)}</React.Fragment>)}
                    {sortedTeams.length > 4 && <div style={{ height: teamWindow.paddingBottom }} aria-hidden="true" />}
                </div>
            ) : team && renderTeamSection(team)}

            {/* People asking to be let in, from the login screen. Access requests are new
                faces; reactivation requests are accounts that were switched off. */}
            {canSeeAccessRequests && accessRequests.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <div className="flex items-center justify-between gap-4 mb-1">
                        <h2 className="text-lg font-semibold text-gray-900">
                            Access requests
                            <span className="ml-2 text-sm font-normal text-gray-500">({accessRequests.length})</span>
                        </h2>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                        Approving somebody creates their account and generates a temporary password that is
                        shown to you once. It expires after three days. Send it through an approved channel;
                        they use it on the Welcome page to choose their permanent password. Until setup is
                        complete, their role cannot be changed.
                    </p>

                    <div className="space-y-3">
                        {accessRequests.map(request => {
                            const target = request.userId ? users.find(u => u.id === request.userId) : undefined;
                            const isDeleted = !!target?.deletedAt;
                            const canReactivate = request.kind === 'reactivation' && !!target && !isDeleted;
                            const busy = busyRequestId === request.id;

                            return (
                                <div key={request.id} className="border border-gray-200 rounded-lg p-4">
                                    <div className="flex items-start justify-between gap-4">
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className="text-sm font-medium text-gray-900 truncate">{request.name}</h3>
                                                <span className={`px-2 py-0.5 text-xs rounded ${
                                                    request.kind === 'reactivation'
                                                        ? 'bg-amber-50 text-amber-700'
                                                        : 'bg-blue-50 text-blue-700'
                                                }`}>
                                                    {request.kind === 'reactivation' ? 'Reactivation' : 'New access'}
                                                </span>
                                                {isDeleted && (
                                                    <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded">
                                                        Account was deleted
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-gray-500 mt-0.5">{request.email}</div>
                                            {request.note && (
                                                <p className="text-sm text-gray-600 mt-2 whitespace-pre-wrap">{request.note}</p>
                                            )}
                                            <div className="text-[11px] text-gray-400 mt-2">
                                                {new Date(request.createdAt).toLocaleString('en-GB', {
                                                    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
                                                })}
                                            </div>
                                        </div>

                                        <div className="flex items-center gap-2 shrink-0">
                                            {!canSeeUnassigned ? (
                                                <span className="text-xs text-gray-500 whitespace-nowrap">
                                                    An admin needs to approve this
                                                </span>
                                            ) : canReactivate ? (
                                                <button
                                                    onClick={() => reactivateFromRequest(request)}
                                                    disabled={busy}
                                                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50"
                                                >
                                                    {busy && <Loader2 className="w-4 h-4 animate-spin" />}
                                                    Reactivate
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={() => inviteFromRequest(request)}
                                                    disabled={busy}
                                                    className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50"
                                                >
                                                    {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                                                    {isDeleted ? 'Approve as new' : 'Approve'}
                                                </button>
                                            )}
                                            {canSeeUnassigned && (
                                                <button
                                                    onClick={() => resolveRequest(request.id, 'dismissed')}
                                                    disabled={busy}
                                                    className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 disabled:opacity-50"
                                                >
                                                    Dismiss
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Requesters -- invited, but nobody has claimed the account yet. Admins only, and
                deliberately its own section: they are not members, they hold no real role, and
                the only useful thing to do with them is issue a temporary password
                them. Hidden entirely when there are none, since an empty list here is the
                normal state of a healthy org. */}
            {canSeeUnassigned && pendingSetupUsers.length > 0 && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <div className="flex items-center justify-between gap-4 mb-1">
                        <h2 className="text-lg font-semibold text-gray-900">
                            Requesters
                            <span className="ml-2 text-sm font-normal text-gray-500">({pendingSetupUsers.length})</span>
                        </h2>
                        <input
                            type="text"
                            value={pendingSearch}
                            onChange={(e) => setPendingSearch(e.target.value)}
                            placeholder="Search name or email..."
                            className="w-56 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
                        />
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                        Approved, but they have not set up an account yet. They stay invitees until they do
                        &mdash; their role cannot be changed, by anyone &mdash; and they join the default team the
                        moment they finish. Generate a replacement temporary password if the previous one expired
                        or was lost; doing so invalidates the previous credential immediately. Only admins see this list.
                    </p>

                    {pendingSetupUsers.length === 0 ? (
                        <div className="text-sm text-gray-500 py-6 text-center border border-dashed border-gray-200 rounded-lg">
                            Nobody matches that search.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {pendingSetupUsers.map(u => {
                                return (
                                    <div key={u.id} className="border border-gray-200 rounded-lg p-4">
                                        <div className="flex items-center justify-between gap-4">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="w-10 h-10 rounded-full flex items-center justify-center bg-amber-100 text-amber-700 text-sm font-medium shrink-0">
                                                    {u.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                                </div>
                                                <div className="min-w-0">
                                                    <div className="flex items-center gap-2 flex-wrap">
                                                        <h3 className="text-sm font-medium text-gray-900 truncate">{u.name}</h3>
                                                        <span className="px-2 py-0.5 bg-amber-50 text-amber-700 text-xs rounded">
                                                            Setup not finished
                                                        </span>
                                                        {!u.isActive && (
                                                            <span className="px-2 py-0.5 bg-red-50 text-red-700 text-xs rounded">
                                                                Deactivated
                                                            </span>
                                                        )}
                                                    </div>
                                                    <div className="text-xs text-gray-500 truncate">{u.email}</div>
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2 shrink-0">
                                                <button
                                                    onClick={() => createSetupPassword(u)}
                                                    className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50 flex items-center gap-2"
                                                >
                                                    <Copy className="w-4 h-4" />
                                                    Generate temporary password
                                                </button>
                                                {canDeleteAccount(u) && (
                                                    <button
                                                        onClick={() => handleDeleteUser(u)}
                                                        className="px-3 py-1.5 border border-red-300 text-red-700 rounded-lg text-sm hover:bg-red-50 flex items-center gap-2"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                        Delete
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}

            {/* Members without a team -- invisible everywhere else, since every other list
                is scoped to a team. Admins only. */}
            {canSeeUnassigned && (
                <div className="bg-white rounded-lg border border-gray-200 p-6">
                    <div className="flex items-center justify-between gap-4 mb-1">
                        <h2 className="text-lg font-semibold text-gray-900">
                            Members without a team
                            <span className="ml-2 text-sm font-normal text-gray-500">({unassignedUsers.length})</span>
                        </h2>
                        {unassignedUsers.length > 0 && (
                            <input
                                type="text"
                                value={unassignedSearch}
                                onChange={(e) => setUnassignedSearch(e.target.value)}
                                placeholder="Search name or email..."
                                className="w-56 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
                            />
                        )}
                    </div>
                    <p className="text-sm text-gray-600 mb-4">
                        These are members of the organisation who are not on any team &mdash; usually because
                        somebody took them off one. They can still use the app; they just will not appear in any
                        team's workload. Add them to a team from Edit Team, or deactivate them.
                    </p>

                    {unassignedUsers.length === 0 ? (
                        <div className="text-sm text-gray-500 py-6 text-center border border-dashed border-gray-200 rounded-lg">
                            {unassignedSearch.trim() ? 'Nobody matches that search.' : 'Everyone belongs to a team.'}
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {unassignedUsers.map(u => (
                                <div key={u.id} className="border border-gray-200 rounded-lg p-4 flex items-center justify-between gap-4">
                                    <div className="flex items-center gap-3 min-w-0">
                                        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium shrink-0 ${u.isActive ? 'bg-gray-400' : 'bg-gray-300'}`}>
                                            {u.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                                        </div>
                                        <div className="min-w-0">
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <h3 className={`text-sm font-medium truncate ${u.isActive ? 'text-gray-900' : 'text-gray-500'}`}>
                                                    {u.name}
                                                </h3>
                                                <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded capitalize">
                                                    {u.role.replace('_', ' ')}
                                                </span>
                                                {/* No "invite pending" badge: anyone whose setup is
                                                    unfinished is in the Requesters list above, not
                                                    this one. */}
                                                {!u.isActive && (
                                                    <span className="px-2 py-0.5 bg-red-50 text-red-700 text-xs rounded">
                                                        Deactivated
                                                    </span>
                                                )}
                                            </div>
                                            <div className="text-xs text-gray-500 truncate">{u.email}</div>
                                        </div>
                                    </div>

                                    <div className="flex items-center gap-2 shrink-0">
                                        {u.isActive ? (
                                            <button
                                                onClick={() => handleDeactivateUser(u)}
                                                className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-red-50 hover:text-red-700 hover:border-red-200 flex items-center gap-2"
                                            >
                                                Deactivate
                                            </button>
                                        ) : (
                                            <button
                                                onClick={() => setUserActive(u, true)}
                                                className="px-3 py-1.5 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-gray-50"
                                            >
                                                Reactivate
                                            </button>
                                        )}
                                        {canDeleteAccount(u) && (
                                            <button
                                                onClick={() => handleDeleteUser(u)}
                                                className="px-3 py-1.5 border border-red-300 text-red-700 rounded-lg text-sm hover:bg-red-50 flex items-center gap-2"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                                Delete
                                            </button>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

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
                                    {selectedInvitees.map(user => {
                                        const isInactive = !user.id.startsWith('temp-') && (!user.isActive || user.deletedAt);
                                        return (
                                            <div 
                                                key={user.id} 
                                                className={`flex items-center gap-1.5 bg-white border rounded-full px-1 py-0.5 relative group ${isInactive ? 'border-orange-400' : 'border-gray-300'}`}
                                            >
                                                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium ${isInactive ? 'bg-orange-100 text-orange-700' : 'bg-blue-100 text-blue-700'}`}>
                                                    {user.name.split(' ').map(n => n[0]).join('')}
                                                </div>
                                                <span className={`text-sm whitespace-nowrap ${isInactive ? 'text-orange-800' : 'text-gray-800'}`}>{user.name}</span>
                                                <button 
                                                    onClick={() => setSelectedInvitees(selectedInvitees.filter(u => u.id !== user.id))} 
                                                    className="p-0.5 hover:bg-gray-200 rounded-full mr-0.5"
                                                >
                                                    <X className="w-3.5 h-3.5 text-gray-600" />
                                                </button>
                                                {isInactive && (
                                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-gray-800 text-white text-xs font-medium rounded-md whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-10">
                                                        Inactive user - Will be reactivated
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    <input
                                        type="text"
                                        autoFocus
                                        placeholder={selectedInvitees.length === 0 ? "Type or paste email addresses" : ""}
                                        value={inviteSearch}
                                        onFocus={() => setShowInviteDropdown(true)}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            setShowInviteDropdown(true);
                                            setInviteHighlight(-1);
                                            // A separator means the entry before it is finished - capsulize it now
                                            if (/[,;\n\r\t]/.test(val)) {
                                                flushInviteInput(val);
                                            } else {
                                                setInviteSearch(val);
                                            }
                                        }}
                                        onPaste={(e) => {
                                            const pasted = e.clipboardData.getData('text');
                                            if (!pasted) return;
                                            e.preventDefault();
                                            // Emails pasted from Excel or a mail client capsulize without pressing Enter
                                            flushInviteInput(inviteSearch + pasted);
                                        }}
                                        onBlur={() => {
                                            if (inviteSearch.trim()) flushInviteInput(inviteSearch);
                                        }}
                                        onKeyDown={(e) => {
                                            const suggestion = inviteSuggestions[inviteHighlight];
                                            if (e.key === 'ArrowDown' && inviteSuggestions.length > 0) {
                                                e.preventDefault();
                                                setShowInviteDropdown(true);
                                                setInviteHighlight((inviteHighlight + 1) % inviteSuggestions.length);
                                            } else if (e.key === 'ArrowUp' && inviteSuggestions.length > 0) {
                                                e.preventDefault();
                                                setShowInviteDropdown(true);
                                                setInviteHighlight((inviteHighlight - 1 + inviteSuggestions.length) % inviteSuggestions.length);
                                            } else if (e.key === 'Escape') {
                                                setShowInviteDropdown(false);
                                                setInviteHighlight(-1);
                                            } else if (e.key === 'Enter' && showInviteDropdown && suggestion) {
                                                // A highlighted person wins over parsing the raw text
                                                e.preventDefault();
                                                addInvitee(suggestion);
                                            } else if (e.key === 'Enter' && inviteSearch.trim()) {
                                                e.preventDefault();
                                                flushInviteInput(inviteSearch, true);
                                            } else if (e.key === 'Backspace' && !inviteSearch && selectedInvitees.length > 0) {
                                                setSelectedInvitees(selectedInvitees.slice(0, -1));
                                            }
                                        }}
                                        className="flex-1 min-w-[150px] outline-none text-sm px-1.5 py-1 text-gray-800 placeholder-gray-500"
                                    />
                                </div>
                            </div>

                            {/* Existing-people suggestions */}
                            {showInviteDropdown && inviteSuggestions.length > 0 && (
                                <div className="absolute left-0 right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10 max-h-64 overflow-y-auto">
                                    {inviteSuggestions.map((user, index) => {
                                        const otherTeam = teams.find(t => t.id !== actionTeamId && user.teamIds.includes(t.id));
                                        return (
                                            <button
                                                key={user.id}
                                                type="button"
                                                // Keeps the input's blur handler from firing before the click lands
                                                onMouseDown={(e) => e.preventDefault()}
                                                onMouseEnter={() => setInviteHighlight(index)}
                                                onClick={() => addInvitee(user)}
                                                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left ${index === inviteHighlight ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                                            >
                                                <div className="w-7 h-7 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-700 shrink-0">
                                                    {user.name.split(' ').map(n => n[0]).join('')}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="text-sm text-gray-900 truncate">{user.name}</div>
                                                    <div className="text-xs text-gray-500 truncate">{user.email}</div>
                                                </div>
                                                {otherTeam && (
                                                    <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0">
                                                        On {otherTeam.name}
                                                    </span>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {removedActiveUsers.length > 0 && (
                            <div className="mt-2 text-sm text-orange-600 bg-orange-50 p-2 rounded">
                                Already existing active users were removed: {removedActiveUsers.map(u => u.name || u.email).join(', ')}
                            </div>
                        )}

                        {selectedInvitees.length > 0 ? (
                            <div className="flex flex-col mt-6">
                                <div className="flex justify-between items-center gap-3">
                                    <div className="flex items-center gap-3">
                                        <button
                                            onClick={() => {
                                                setSelectedInvitees([]);
                                                setInviteSearch('');
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
                            </div>
                        ) : (
                            <div className="mt-6">
                                <div className="flex justify-between items-center">
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
                    <div className="bg-white rounded-lg max-w-2xl w-full mx-4 flex flex-col max-h-[85vh]">
                        <div className="flex justify-between items-center p-6 pb-4">
                            <h3 className="text-lg font-semibold text-gray-900">Edit Team</h3>
                            <button className="p-2 hover:bg-gray-100 rounded-full text-gray-600" onClick={() => setShowEditTeam(false)}>
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-6">
                            <div className="space-y-4">
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

                            {/* Add existing people */}
                            <div className="border-t border-gray-200 mt-6 pt-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Add People</label>
                                <p className="text-xs text-gray-500 mb-2">
                                    Search anyone who already has an account. To bring in someone new, use Invite Team Member.
                                </p>
                                <input
                                    type="text"
                                    value={addMemberSearch}
                                    onChange={(e) => setAddMemberSearch(e.target.value)}
                                    onFocus={() => setAddMemberFocused(true)}
                                    onBlur={() => setAddMemberFocused(false)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                                    placeholder="Search by name or email"
                                />

                                {(addMemberFocused || addMemberSearch.trim()) && (
                                    <div className="mt-2 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
                                        {addMemberCandidates.length === 0 ? (
                                            <div className="px-3 py-3 text-sm text-gray-500">No matching people.</div>
                                        ) : addMemberCandidates.map(user => {
                                            const otherTeam = teams.find(t => t.id !== actionTeam.id && user.teamIds.includes(t.id));
                                            // Listed, but not addable. Shown rather than hidden because they are
                                            // findable everywhere else on this page, and "no matching people" for
                                            // somebody who is plainly there reads as the search being broken.
                                            const pendingSetup = !user.onboardingCompleted;
                                            const blockedBecause = pendingSetup
                                                ? `${user.name} has not set up their account yet. They land on a team when they finish.`
                                                : otherTeam
                                                    ? `Remove ${user.name} from ${otherTeam.name} first`
                                                    : undefined;
                                            return (
                                                <div key={user.id} className="flex items-center gap-3 px-3 py-2">
                                                    <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-xs font-medium text-blue-700 shrink-0">
                                                        {user.name.split(' ').map(n => n[0]).join('')}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-sm text-gray-900 truncate">{user.name}</div>
                                                        <div className="text-xs text-gray-500 truncate">{user.email}</div>
                                                    </div>
                                                    {pendingSetup ? (
                                                        <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0">
                                                            Setup pending
                                                        </span>
                                                    ) : otherTeam && (
                                                        <span className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5 shrink-0">
                                                            On {otherTeam.name}
                                                        </span>
                                                    )}
                                                    <button
                                                        // Keeps focus in the search box so the list does not close mid-click
                                                        onMouseDown={(e) => e.preventDefault()}
                                                        onClick={() => handleAddExistingMember(user.id)}
                                                        disabled={!!blockedBecause}
                                                        title={blockedBecause}
                                                        className="px-3 py-1 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
                                                    >
                                                        Add
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>

                            {/* Current members and their roles */}
                            <div className="border-t border-gray-200 mt-6 pt-4 pb-2">
                                <label className="block text-sm font-medium text-gray-700 mb-2">
                                    Members ({actionTeam.memberIds.length})
                                </label>
                                {actionTeam.memberIds.length === 0 ? (
                                    <p className="text-sm text-gray-500">Nobody on this team yet.</p>
                                ) : (
                                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100">
                                        {users.filter(u => actionTeam.memberIds.includes(u.id)).map(member => {
                                            const isProtected = member.role === 'super_admin';
                                            return (
                                                <div key={member.id} className="flex items-center gap-3 px-3 py-2">
                                                    <div
                                                        className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium shrink-0"
                                                        style={{ backgroundColor: actionTeam.color }}
                                                    >
                                                        {member.name.split(' ').map(n => n[0]).join('')}
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="text-sm text-gray-900 truncate">{member.name}</div>
                                                        <div className="text-xs text-gray-500 truncate">{member.email}</div>
                                                    </div>

                                                    {canEditRoles && !isProtected ? (
                                                        <select
                                                            value={member.role}
                                                            onChange={(e) => updateMemberRole(member.id, e.target.value)}
                                                            className="pl-2 pr-6 py-1 bg-white border border-gray-300 rounded text-xs appearance-none focus:outline-none focus:ring-2 focus:ring-blue-100 cursor-pointer shrink-0"
                                                            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 12 12'%3E%3Cpath d='M2.5 4.5l3.5 3.5 3.5-3.5' stroke='%239ca3af' stroke-width='1.3' stroke-linecap='round' fill='none'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 6px center' }}
                                                        >
                                                            {/* A role the viewer cannot assign still shows, so the select never lies about the current value */}
                                                            {(assignableRoles.includes(member.role) ? assignableRoles : [member.role, ...assignableRoles]).map(role => (
                                                                <option key={role} value={role}>
                                                                    {role.replace('_', ' ').replace(/^./, c => c.toUpperCase())}
                                                                </option>
                                                            ))}
                                                        </select>
                                                    ) : (
                                                        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 text-xs rounded capitalize shrink-0">
                                                            {member.role.replace('_', ' ')}
                                                        </span>
                                                    )}

                                                    {canEditRoles && !isProtected && (
                                                        <button
                                                            onClick={() => handleRemoveMember(actionTeam.id, member.id)}
                                                            className="px-2 py-1 border border-red-300 text-red-700 rounded text-xs hover:bg-red-50 shrink-0"
                                                        >
                                                            Remove
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 p-6 pt-4 border-t border-gray-200">
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
                                {/* Unclaimed invites are left out: they hold no role until they
                                    set up an account, and the function refuses them anyway. */}
                                {users
                                    .filter(u => u.id !== currentUser.id && u.onboardingCompleted && u.isActive && !u.deletedAt)
                                    .map(u => (
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

            {generatedCredentials.length > 0 && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-labelledby="temporary-password-title">
                    <div ref={credentialsDialogRef} tabIndex={-1} className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[85vh] overflow-y-auto p-6">
                        <div className="flex items-start justify-between gap-4 mb-4">
                            <div>
                                <h2 id="temporary-password-title" className="text-lg font-semibold text-gray-900">
                                    Temporary {generatedCredentials.length === 1 ? 'password' : 'passwords'}
                                </h2>
                                <p className="text-sm text-gray-600 mt-1">
                                    Copy these now. They expire after three days and cannot be viewed again.
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={closeGeneratedCredentials}
                                aria-label="Close temporary passwords"
                                className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="space-y-3">
                            {generatedCredentials.map(credential => (
                                <div key={credential.email} className="border border-gray-200 rounded-lg p-4">
                                    <div className="text-sm font-medium text-gray-900">{credential.email}</div>
                                    <div className="flex items-center gap-2 mt-2">
                                        <code className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm break-all select-all">
                                            {credential.temporaryPassword}
                                        </code>
                                        <button
                                            type="button"
                                            onClick={async () => {
                                                await navigator.clipboard.writeText(credential.temporaryPassword);
                                                toast.success(`Temporary password copied for ${credential.email}.`);
                                            }}
                                            className="px-3 py-2 border border-gray-300 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50 flex items-center gap-2"
                                        >
                                            <Copy className="w-4 h-4" /> Copy
                                        </button>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-2">
                                        Expires {new Date(credential.expiresAt).toLocaleString()}.
                                    </p>
                                </div>
                            ))}
                        </div>

                        <div className="flex justify-end mt-6">
                            <button
                                type="button"
                                onClick={closeGeneratedCredentials}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
                            >
                                I have saved {generatedCredentials.length === 1 ? 'it' : 'them'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
