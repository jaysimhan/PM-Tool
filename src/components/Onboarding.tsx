import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Check, Eye, EyeOff, Info, Loader2, Users } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth, saveUserSkills } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Skill, Team } from '../types/types';
import { Logo } from './Logo';
import { SkillPicker } from './SkillPicker';

const PageLoader = () => (
    <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
    </div>
);

const calculateStrength = (pass: string) => {
    if (!pass) return 0;
    let score = 0;
    if (pass.length >= 8) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[a-z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(pass)) score += 1;
    return score;
};

const getStrengthDetails = (score: number) => {
    switch (score) {
        case 1: return { label: 'Very Weak', color: 'bg-red-500', text: 'text-red-500' };
        case 2: return { label: 'Weak', color: 'bg-orange-500', text: 'text-orange-500' };
        case 3: return { label: 'Fair', color: 'bg-yellow-500', text: 'text-yellow-600' };
        case 4: return { label: 'Good', color: 'bg-blue-500', text: 'text-blue-500' };
        case 5: return { label: 'Strong', color: 'bg-green-500', text: 'text-green-500' };
        default: return { label: '', color: 'bg-gray-200', text: 'text-gray-500' };
    }
};

/**
 * Account setup for someone arriving from an invite link. The invite already
 * authenticated them, so this is not a sign-up -- it is the two things the invite
 * cannot know: a password of their own, then their team and skills.
 *
 * Their public.users row already exists: the on_auth_user_created trigger writes it when
 * the invite is issued. So "has a profile" cannot mean "is set up" -- users.onboarding_completed
 * is what says so, and setting it is the last thing this screen does.
 *
 * Dropping off part-way is expected, so arriving here resumes rather than restarts:
 *   - set up and on a team    -> nothing to do, straight to the app
 *   - no password yet         -> step 1, as if for the first time
 *   - password but no profile -> step 2, with step 1 already ticked
 *   - set up but no team      -> step 2 alone (an admin took them off their team)
 * The password is the thing that says step 1 is done, and only the database can see it,
 * hence current_user_has_password().
 */
export function Onboarding() {
    const { session, profile, loading: authLoading, refreshProfile, signOut } = useAuth();
    const { refreshUsers, refreshTeams } = useData();
    const navigate = useNavigate();

    const [step, setStep] = useState(1);
    const [name, setName] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [retypePassword, setRetypePassword] = useState('');
    const [showNew, setShowNew] = useState(false);
    const [showRetype, setShowRetype] = useState(false);
    const [showTooltip, setShowTooltip] = useState(false);

    const [teams, setTeams] = useState<Team[]>([]);
    const [skills, setSkills] = useState<Skill[]>([]);
    const [teamId, setTeamId] = useState<string>('');
    const [skillIds, setSkillIds] = useState<string[]>([]);

    const [loadingOptions, setLoadingOptions] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // null while we are still asking. Rendering a step before the answer is in would flash
    // the password form at someone who already has one.
    const [arrivedWithPassword, setArrivedWithPassword] = useState<boolean | null>(null);
    const resumeResolved = useRef(false);

    const email = session?.user?.email || '';
    const strengthScore = useMemo(() => calculateStrength(newPassword), [newPassword]);
    const strengthDetails = getStrengthDetails(strengthScore);

    // The invite carries the name the admin typed; fall back to the local part of the
    // email. An admin who invited by address alone leaves the name as that address, so
    // treat that the same as having typed nothing.
    useEffect(() => {
        if (!session?.user) return;
        const meta = session.user.user_metadata || {};
        const invited = [meta.name, meta.full_name].find(n => n && !n.includes('@'));
        setName(prev => prev || invited || email.split('@')[0] || '');
    }, [session, email]);

    // Read teams/skills straight from Supabase rather than DataContext: DataContext loads
    // once on mount, which on an invite link can be before the session exists.
    useEffect(() => {
        if (!session?.user) return;
        let cancelled = false;

        (async () => {
            const [{ data: teamsData }, { data: skillsData }, { data: membership }, hasPassword] = await Promise.all([
                supabase.from('teams').select('id, name, description, color').order('name'),
                supabase.from('skills').select('id, name, category').order('name'),
                supabase.from('team_members').select('team_id').eq('user_id', session.user.id),
                supabase.rpc('current_user_has_password')
            ]);
            if (cancelled) return;

            // Resolved once, on the way in. Setting a password fires an auth update that
            // re-runs this effect, and by then a password of course exists -- re-reading it
            // would relabel a first-time setup as a resume.
            if (!resumeResolved.current) {
                resumeResolved.current = true;
                const resuming = hasPassword.data === true;
                setArrivedWithPassword(resuming);
                if (resuming) setStep(2);
                // Treat an unavailable check as "no password" rather than blocking setup: the
                // worst case is the old behaviour, a trip back through step 1.
                if (hasPassword.error) console.error('Could not check password state:', hasPassword.error);
            }

            setTeams((teamsData || []) as unknown as Team[]);
            setSkills((skillsData || []).map((s: any) => ({
                id: s.id,
                name: s.name,
                category: s.category || 'General',
                teamIds: []
            })));
            // Pre-select the team they were invited into. team_members only has a row if an
            // admin placed them after they already had a profile; a fresh invite instead
            // carries the team in user_metadata, since team_members.user_id cannot reference
            // them until the profile row below exists.
            //
            // Someone re-picking after being removed gets no pre-selection at all: the invite
            // metadata still names the team they were just taken off, and defaulting them
            // straight back into it would undo the removal on the first click.
            const invitedTeamId = profile?.onboardingCompleted ? null : session.user.user_metadata?.team_id;
            if (membership && membership.length > 0) setTeamId(membership[0].team_id);
            else if (invitedTeamId) setTeamId(invitedTeamId);
            setLoadingOptions(false);
        })();

        return () => { cancelled = true; };
    }, [session, profile?.onboardingCompleted]);

    if (authLoading) return <PageLoader />;
    if (!session) return <Navigate to="/login" replace />;
    // Already set up and on a team -- nothing to do here.
    if (profile?.onboardingCompleted && profile.teamIds.length > 0) return <Navigate to="/" replace />;
    // Still working out how far they got last time.
    if (arrivedWithPassword === null) return <PageLoader />;

    // Someone an admin has taken off their team lands here too, but they already have a
    // password and skills of their own -- all they owe us is a new team.
    const teamOnly = profile?.onboardingCompleted === true;
    const activeStep = teamOnly ? 2 : step;

    const handleCreatePassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) {
            setError('Please enter your name.');
            return;
        }
        if (newPassword !== retypePassword) {
            setError('Passwords do not match.');
            return;
        }
        if (strengthScore < 5) {
            setError('Password does not meet all requirements.');
            return;
        }

        setSaving(true);
        setError(null);
        try {
            const { error: updateError } = await supabase.auth.updateUser({
                password: newPassword,
                data: { name: name.trim() }
            });
            if (updateError) throw updateError;
            setStep(2);
        } catch (err: any) {
            setError(err.message || 'Could not set your password.');
        } finally {
            setSaving(false);
        }
    };

    const handleFinish = async () => {
        if (!session?.user) return;
        if (teams.length > 0 && !teamId) {
            setError('Please select your team.');
            return;
        }

        setSaving(true);
        setError(null);
        const userId = session.user.id;

        try {
            // Someone re-picking a team keeps the name, role and skills they already have;
            // only their membership changes.
            if (teamOnly) {
                if (teamId) {
                    const { error: deleteError } = await supabase
                        .from('team_members')
                        .delete()
                        .eq('user_id', userId);
                    if (deleteError) throw deleteError;

                    const { error: memberError } = await supabase
                        .from('team_members')
                        .insert({ team_id: teamId, user_id: userId });
                    if (memberError) throw memberError;
                }

                await refreshProfile();
                await Promise.all([refreshUsers(), refreshTeams()]);
                navigate('/', { replace: true });
                return;
            }

            // Never re-insert over an existing profile: that would reset the role of
            // someone who landed here because of a transient profile-load failure.
            const { data: existing, error: readError } = await supabase
                .from('users')
                .select('id')
                .eq('id', userId)
                .maybeSingle();
            if (readError) throw readError;

            if (existing) {
                const { error: updateError } = await supabase
                    .from('users')
                    .update({ name: name.trim(), onboarding_completed: true })
                    .eq('id', userId);
                if (updateError) throw updateError;
            } else {
                const { error: insertError } = await supabase
                    .from('users')
                    .insert({
                        id: userId,
                        name: name.trim(),
                        email,
                        role: 'team_member',
                        daily_capacity: 8,
                        is_active: true,
                        onboarding_completed: true
                    });
                if (insertError) throw insertError;
            }

            if (teamId) {
                // A person belongs to one team, so replace rather than add.
                const { error: deleteError } = await supabase
                    .from('team_members')
                    .delete()
                    .eq('user_id', userId);
                if (deleteError) throw deleteError;

                const { error: memberError } = await supabase
                    .from('team_members')
                    .insert({ team_id: teamId, user_id: userId });
                if (memberError) throw memberError;
            }

            await saveUserSkills(userId, skillIds);

            await refreshProfile();
            await Promise.all([refreshUsers(), refreshTeams()]);
            navigate('/', { replace: true });
        } catch (err: any) {
            setError(err.message || 'Could not finish setting up your account.');
        } finally {
            setSaving(false);
        }
    };

    const steps = [
        { number: 1, label: 'Create password' },
        { number: 2, label: 'Team & skills' }
    ];

    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4 flex justify-center font-sans">
            <div className="max-w-lg w-full h-fit">
                <div className="flex justify-center mb-6">
                    <Logo className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0" />
                </div>

                <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-200">
                    <h1 className="text-xl font-bold text-gray-900">
                        {teamOnly ? 'Choose your team' : 'Set up your account'}
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        {teamOnly
                            ? "You're not on a team right now. Pick the one you're working with to carry on."
                            : arrivedWithPassword
                                ? 'Your password is already set. Pick your team and skills to finish.'
                                : "You've been invited to CareStack Marketing Workflow. Two quick steps and you're in."}
                    </p>

                    {/* Stepper -- a team re-pick is a single step, so there is nothing to track */}
                    {!teamOnly && (
                        <div className="flex items-center gap-3 my-6">
                            {steps.map((s, index) => (
                                <React.Fragment key={s.number}>
                                    <div className="flex items-center gap-2">
                                        <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                                            activeStep > s.number
                                                ? 'bg-green-500 text-white'
                                                : activeStep === s.number
                                                    ? 'bg-blue-600 text-white'
                                                    : 'bg-gray-200 text-gray-500'
                                        }`}>
                                            {activeStep > s.number ? <Check className="w-4 h-4" /> : s.number}
                                        </div>
                                        <span className={`text-sm font-medium ${activeStep >= s.number ? 'text-gray-900' : 'text-gray-400'}`}>
                                            {s.label}
                                        </span>
                                    </div>
                                    {index < steps.length - 1 && <div className="flex-1 h-px bg-gray-200" />}
                                </React.Fragment>
                            ))}
                        </div>
                    )}
                    {teamOnly && <div className="my-6" />}

                    {error && (
                        <div className="mb-4 bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm border border-red-100">
                            {error}
                        </div>
                    )}

                    {activeStep === 1 ? (
                        <form onSubmit={handleCreatePassword} className="space-y-5">
                            <div className="space-y-1">
                                <label className="block text-sm font-medium text-gray-700">Email</label>
                                <input
                                    type="email"
                                    value={email}
                                    disabled
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500 text-sm cursor-not-allowed"
                                />
                                <p className="text-xs text-gray-500">This is the address your invite was sent to.</p>
                            </div>

                            <div className="space-y-1">
                                <label className="block text-sm font-medium text-gray-700">
                                    Your Name <span className="text-gray-500">*</span>
                                </label>
                                <input
                                    type="text"
                                    required
                                    value={name}
                                    onChange={(e) => setName(e.target.value)}
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                                />
                            </div>

                            <div className="space-y-1">
                                <div className="flex items-center gap-1.5">
                                    <label className="block text-sm font-medium text-gray-700">
                                        Create Password <span className="text-gray-500">*</span>
                                    </label>
                                    <div
                                        className="relative flex items-center"
                                        onMouseEnter={() => setShowTooltip(true)}
                                        onMouseLeave={() => setShowTooltip(false)}
                                        onClick={() => setShowTooltip(!showTooltip)}
                                    >
                                        <Info className="w-4 h-4 text-gray-400 hover:text-gray-500 cursor-help transition-colors" />
                                        {showTooltip && (
                                            <div className="absolute left-6 top-1/2 -translate-y-1/2 w-[300px] bg-white border border-gray-200 shadow-xl rounded-xl p-4 z-50 text-sm text-gray-700">
                                                <div className="absolute -left-2 top-1/2 -translate-y-1/2 w-4 h-4 bg-white border-l border-b border-gray-200 transform rotate-45" />
                                                <div className="relative z-10">
                                                    <p className="font-semibold text-gray-900 mb-2 leading-snug">
                                                        Your password should have atleast 8 characters containing a minimum of :
                                                    </p>
                                                    <ol className="space-y-1 text-gray-600 text-[13px]">
                                                        <li>1. 1 Upper case letter (A-Z)</li>
                                                        <li>2. 1 small case letter (a-z)</li>
                                                        <li>3. 1 numerical character (0..9)</li>
                                                        <li>4. 1 special character(s)(#,$,@...)</li>
                                                    </ol>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                <div className="relative">
                                    <input
                                        type={showNew ? 'text' : 'password'}
                                        required
                                        value={newPassword}
                                        onChange={(e) => setNewPassword(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowNew(!showNew)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 rounded-md"
                                    >
                                        {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>

                                {newPassword.length > 0 && (
                                    <div className="pt-1 space-y-1">
                                        <div className="flex gap-1 h-1.5 w-full">
                                            {[1, 2, 3, 4, 5].map((level) => (
                                                <div
                                                    key={level}
                                                    className={`h-full flex-1 rounded-full ${strengthScore >= level ? strengthDetails.color : 'bg-gray-200'} transition-colors duration-300`}
                                                />
                                            ))}
                                        </div>
                                        <p className={`text-xs font-medium text-right ${strengthDetails.text}`}>
                                            {strengthDetails.label}
                                        </p>
                                    </div>
                                )}
                            </div>

                            <div className="space-y-1">
                                <label className="block text-sm font-medium text-gray-700">
                                    Retype Password <span className="text-gray-500">*</span>
                                </label>
                                <div className="relative">
                                    <input
                                        type={showRetype ? 'text' : 'password'}
                                        required
                                        value={retypePassword}
                                        onChange={(e) => setRetypePassword(e.target.value)}
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowRetype(!showRetype)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 p-1 rounded-md"
                                    >
                                        {showRetype ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            <div className="pt-2 flex justify-end">
                                <button
                                    type="submit"
                                    disabled={saving || !name.trim() || !newPassword || !retypePassword || strengthScore < 5}
                                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Continue'}
                                </button>
                            </div>
                        </form>
                    ) : (
                        <div className="space-y-6">
                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-gray-700 flex items-center gap-2">
                                    <Users className="w-4 h-4 text-gray-400" />
                                    Your Team {teams.length > 0 && <span className="text-gray-500">*</span>}
                                </label>
                                {loadingOptions ? (
                                    <div className="text-sm text-gray-500 py-3">Loading teams...</div>
                                ) : teams.length === 0 ? (
                                    <div className="text-sm text-gray-500 py-3">
                                        No teams have been set up yet. An admin can add you to one later.
                                    </div>
                                ) : (
                                    <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
                                        {teams.map(team => (
                                            <button
                                                type="button"
                                                key={team.id}
                                                onClick={() => setTeamId(team.id)}
                                                className={`w-full flex items-center gap-3 px-3 py-2.5 text-left transition-colors ${
                                                    teamId === team.id ? 'bg-blue-50 hover:bg-blue-100' : 'hover:bg-gray-50'
                                                }`}
                                            >
                                                <span
                                                    className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                                                    style={{ backgroundColor: team.color || '#9ca3af' }}
                                                />
                                                <span className="min-w-0 flex-1">
                                                    <span className={`block text-sm font-medium truncate ${teamId === team.id ? 'text-blue-900' : 'text-gray-900'}`}>
                                                        {team.name}
                                                    </span>
                                                    {team.description && (
                                                        <span className={`block text-xs truncate ${teamId === team.id ? 'text-blue-600' : 'text-gray-500'}`}>
                                                            {team.description}
                                                        </span>
                                                    )}
                                                </span>
                                                {teamId === team.id && <Check className="w-4 h-4 text-blue-600 flex-shrink-0" />}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Skills are already theirs on a re-pick -- Preferences is where they change them */}
                            {!teamOnly && (
                                <div className="space-y-2">
                                    <label className="block text-sm font-medium text-gray-700">Your Skills</label>
                                    <p className="text-xs text-gray-500">
                                        Pick everything you can work on. Skills are not limited to your team &mdash;
                                        choose any of them, and you can change this later in Preferences.
                                    </p>
                                    <SkillPicker
                                        allSkills={skills}
                                        selectedIds={skillIds}
                                        onChange={setSkillIds}
                                        placeholder="Search skills across all teams..."
                                    />
                                </div>
                            )}

                            <div className="pt-2 flex justify-end">
                                <button
                                    type="button"
                                    onClick={handleFinish}
                                    disabled={saving || loadingOptions || (teams.length > 0 && !teamId)}
                                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : (teamOnly ? 'Join team' : 'Finish setup')}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                <p className="text-center text-xs text-gray-500 mt-4">
                    Not {email}?{' '}
                    <button
                        type="button"
                        onClick={async () => {
                            await signOut();
                            navigate('/login', { replace: true });
                        }}
                        className="text-blue-600 hover:text-blue-700 font-medium"
                    >
                        Sign out
                    </button>
                </p>
            </div>
        </div>
    );
}
