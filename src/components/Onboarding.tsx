import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Building2, Check, Eye, EyeOff, Globe, Info, Loader2, Users } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { useAuth, saveUserSkills, saveUserClients, saveUserRegions } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Client, Region, Skill, Team } from '../types/types';
import { Logo } from './Logo';
import { SkillPicker } from './SkillPicker';
import { PreferenceMultiSelect } from './PreferenceMultiSelect';

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

/** Supabase refuses a password identical to the current one. Here that is not a failure. */
const isSamePasswordError = (err: any) =>
    err?.code === 'same_password' || /different from the old password/i.test(err?.message || '');

/**
 * Account setup for someone arriving from an invite link. The invite already authenticated
 * them, so this is not a sign-up -- it is the one thing the invite cannot know: a password
 * of their own.
 *
 * Step 1 -- name and password -- is the account. Finishing it is what turns an unclaimed
 * invite into a person: complete_onboarding_step_one() sets onboarding_completed, promotes
 * them out of 'requester', and puts them on the default team in one transaction. Until it is
 * done they are a requester and nothing, including a super admin, can move them.
 *
 * Step 2 -- team, skills, brands, regions -- is preferences, and preferences live in the app
 * already, so it is skippable and walking away from it costs nothing: they land on the
 * dashboard next time, on the default team, and can fill the rest in from Preferences.
 *
 * Which means this screen is only ever for one thing, and it says so:
 *   - step 1 not done -> step 1, however many times it takes
 *   - step 1 done     -> nothing to do here; back to the login route, which lands an
 *                        already-signed-in person on their dashboard
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
    const [clients, setClients] = useState<Client[]>([]);
    const [regions, setRegions] = useState<Region[]>([]);
    const [teamId, setTeamId] = useState<string>('');
    const [joinedTeamId, setJoinedTeamId] = useState<string>('');
    const [skillIds, setSkillIds] = useState<string[]>([]);
    const [clientIds, setClientIds] = useState<string[]>([]);
    const [regionIds, setRegionIds] = useState<string[]>([]);

    const [loadingOptions, setLoadingOptions] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // They already have a password -- they used the reset link instead of the invite, or set one
    // and closed the tab before this call finished. Step 1 still has to be completed; this only
    // changes what the screen says about it. Resolved once, because setting a password fires an
    // auth update that re-runs the effect below.
    const [arrivedWithPassword, setArrivedWithPassword] = useState(false);
    const resumeResolved = useRef(false);

    // Step 1 finished in this visit. Without it, the onboarding_completed the RPC just wrote
    // would send them straight out of step 2 through the guard below.
    const completedStepOneHere = useRef(false);

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
            const [
                { data: teamsData },
                { data: skillsData },
                { data: clientsData },
                { data: regionsData },
                { data: membership },
                hasPassword
            ] = await Promise.all([
                supabase.from('teams').select('id, name, description, color').order('name'),
                supabase.from('skills').select('id, name, category').order('name'),
                supabase.from('clients').select('id, name').order('name'),
                supabase.from('regions').select('id, name, code, flag').order('name'),
                supabase.from('team_members').select('team_id').eq('user_id', session.user.id),
                supabase.rpc('current_user_has_password')
            ]);
            if (cancelled) return;

            if (!resumeResolved.current) {
                resumeResolved.current = true;
                setArrivedWithPassword(hasPassword.data === true);
                if (hasPassword.error) console.error('Could not check password state:', hasPassword.error);
            }

            setTeams((teamsData || []) as unknown as Team[]);
            setSkills((skillsData || []).map((s: any) => ({
                id: s.id,
                name: s.name,
                category: s.category || 'General',
                teamIds: []
            })));
            setClients((clientsData || []) as unknown as Client[]);
            setRegions((regionsData || []) as unknown as Region[]);

            // Whatever team they are actually on wins. On the way into step 1 that is usually
            // nothing; step 1 puts them on the default team and hands the id back.
            if (membership && membership.length > 0) {
                setJoinedTeamId(membership[0].team_id);
                setTeamId(prev => prev || membership[0].team_id);
            }

            // Somebody who set a password by another route may already have preferences. Start
            // the pickers from them rather than empty, or saving would read as "I have none".
            if (profile?.skillIds?.length) {
                setSkillIds(prev => (prev.length ? prev : profile.skillIds));
            }
            if (profile?.clientIds?.length) {
                setClientIds(prev => (prev.length ? prev : profile.clientIds));
            }
            if (profile?.regionIds?.length) {
                setRegionIds(prev => (prev.length ? prev : profile.regionIds));
            }
            setLoadingOptions(false);
        })();

        return () => { cancelled = true; };
    }, [session, profile?.onboardingCompleted]);

    if (authLoading) return <PageLoader />;
    if (!session) return <Navigate to="/login" replace />;
    // Step 1 is already behind them, so there is nothing on this screen for them -- a second
    // click on an invite or setup link included. /login sends a live session to the dashboard.
    if (profile?.onboardingCompleted && !completedStepOneHere.current) {
        return <Navigate to="/login" replace />;
    }

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
            // Typing the password they already have is not a mistake worth stopping for: the
            // point of this step is that a password exists, and one does.
            if (updateError && !isSamePasswordError(updateError)) throw updateError;

            // One call for the rest of it: the name, onboarding_completed, the promotion out of
            // 'requester', and the default team. An invite that named a team keeps it.
            const { data: result, error: rpcError } = await supabase.rpc('complete_onboarding_step_one', {
                p_name: name.trim(),
                p_team_id: session?.user?.user_metadata?.team_id ?? null
            });
            if (rpcError) throw rpcError;

            completedStepOneHere.current = true;

            const landedOn = (result as any)?.team_id as string | undefined;
            if (landedOn) {
                setJoinedTeamId(landedOn);
                setTeamId(prev => prev || landedOn);
            }

            // Their role and team just changed, so the app's copies of both are stale.
            await refreshProfile();
            await Promise.all([refreshUsers(), refreshTeams()]);
            setStep(2);
        } catch (err: any) {
            setError(err.message || 'Could not set your password.');
        } finally {
            setSaving(false);
        }
    };

    /** Step 2 is optional, so leaving it is a first-class way out rather than an escape hatch. */
    const skipRest = () => navigate('/', { replace: true });

    const handleFinish = async () => {
        if (!session?.user) return;

        setSaving(true);
        setError(null);
        const userId = session.user.id;

        try {
            // A person belongs to one team, so a change is a replacement. Unchanged means no
            // write at all -- deleting and re-inserting the same row buys nothing.
            if (teamId && teamId !== joinedTeamId) {
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

            // These all diff, so anything ticked or unticked here is applied and the rest is
            // left alone.
            await saveUserSkills(userId, skillIds);
            await saveUserClients(userId, clientIds);
            await saveUserRegions(userId, regionIds);

            await refreshProfile();
            await Promise.all([refreshUsers(), refreshTeams()]);
            navigate('/', { replace: true });
        } catch (err: any) {
            setError(err.message || 'Could not save your preferences.');
        } finally {
            setSaving(false);
        }
    };

    const steps = [
        { number: 1, label: 'Create password' },
        { number: 2, label: 'Team & skills' }
    ];

    const joinedTeamName = teams.find(t => t.id === joinedTeamId)?.name;

    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4 flex justify-center font-sans">
            <div className="max-w-lg w-full h-fit">
                <div className="flex justify-center mb-6">
                    <Logo className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0" />
                </div>

                <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-200">
                    <h1 className="text-xl font-bold text-gray-900">
                        {step === 1 ? 'Set up your account' : "You're in"}
                    </h1>
                    <p className="text-sm text-gray-500 mt-1">
                        {step === 1
                            ? arrivedWithPassword
                                ? 'Confirm your name and password to finish creating your account. If you have already chosen a password, enter it again here.'
                                : "You've been invited to CareStack Marketing Workflow. One quick step and you're in."
                            : joinedTeamName
                                ? `Your account is ready and you've been added to ${joinedTeamName}. The rest is optional — change your team or tell us what you work on, or skip it and do it later from Preferences.`
                                : 'Your account is ready. The rest is optional — tell us what you work on, or skip it and do it later from Preferences.'}
                    </p>

                    <div className="flex items-center gap-3 my-6">
                        {steps.map((s, index) => (
                            <React.Fragment key={s.number}>
                                <div className="flex items-center gap-2">
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                                        step > s.number
                                            ? 'bg-green-500 text-white'
                                            : step === s.number
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-gray-200 text-gray-500'
                                    }`}>
                                        {step > s.number ? <Check className="w-4 h-4" /> : s.number}
                                    </div>
                                    <span className={`text-sm font-medium ${step >= s.number ? 'text-gray-900' : 'text-gray-400'}`}>
                                        {s.label}
                                    </span>
                                    {s.number === 2 && (
                                        <span className="text-xs text-gray-400">(optional)</span>
                                    )}
                                </div>
                                {index < steps.length - 1 && <div className="flex-1 h-px bg-gray-200" />}
                            </React.Fragment>
                        ))}
                    </div>

                    {error && (
                        <div className="mb-4 bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm border border-red-100">
                            {error}
                        </div>
                    )}

                    {step === 1 ? (
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
                                    Your Team
                                </label>
                                <p className="text-xs text-gray-500">
                                    {joinedTeamName
                                        ? `You're on ${joinedTeamName}. Pick a different one if that isn't where you work — an admin can move you later either way.`
                                        : 'Pick the team you work with. An admin can move you later either way.'}
                                </p>
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

                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-gray-700">Your Skills</label>
                                <p className="text-xs text-gray-500">
                                    Pick everything you can work on. Skills are not limited to your team &mdash; choose any
                                    of them, and you can change this later in Preferences.
                                </p>
                                <SkillPicker
                                    allSkills={skills}
                                    selectedIds={skillIds}
                                    onChange={setSkillIds}
                                    placeholder="Search skills across all teams..."
                                />
                            </div>

                            {/* Skills say what they can do; these two say what they want handed to them */}
                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-gray-700 flex items-center gap-2">
                                    <Building2 className="w-4 h-4 text-gray-400" />
                                    Preferred Brands
                                </label>
                                <p className="text-xs text-gray-500">
                                    Work for these brands can come to you automatically. Pick as many as you like.
                                </p>
                                <PreferenceMultiSelect
                                    options={clients.map(c => ({ id: c.id, name: c.name }))}
                                    selectedIds={clientIds}
                                    onChange={setClientIds}
                                    emptyLabel="No brands have been set up yet. You can pick them later in Preferences."
                                    accent="blue"
                                    searchPlaceholder="Search brands..."
                                />
                            </div>

                            <div className="space-y-2">
                                <label className="block text-sm font-medium text-gray-700 flex items-center gap-2">
                                    <Globe className="w-4 h-4 text-gray-400" />
                                    Preferred Regions
                                </label>
                                <p className="text-xs text-gray-500">
                                    The regions you want to cover. Leave these empty and work will only reach you when
                                    someone assigns it to you by hand. You can change all of this later in Preferences.
                                </p>
                                <PreferenceMultiSelect
                                    options={regions.map(r => ({ id: r.id, name: r.name, prefix: r.flag }))}
                                    selectedIds={regionIds}
                                    onChange={setRegionIds}
                                    emptyLabel="No regions have been set up yet. You can pick them later in Preferences."
                                    accent="teal"
                                    searchPlaceholder="Search regions..."
                                />
                            </div>

                            <div className="pt-2 flex items-center justify-end gap-2">
                                <button
                                    type="button"
                                    onClick={skipRest}
                                    disabled={saving}
                                    className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium text-sm disabled:opacity-50"
                                >
                                    Skip for now
                                </button>
                                <button
                                    type="button"
                                    onClick={handleFinish}
                                    disabled={saving || loadingOptions}
                                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save and continue'}
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {step === 1 && (
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
                )}
            </div>
        </div>
    );
}
