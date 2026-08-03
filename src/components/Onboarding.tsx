import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Building2, Check, Eye, EyeOff, Globe, Info, Loader2, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { supabase } from '../lib/supabaseClient';
import { useAuth, saveUserSkills, saveUserClients, saveUserRegions } from '../contexts/AuthContext';
import { useData } from '../contexts/DataContext';
import { Client, Region, Skill, Team } from '../types/types';
import { Logo } from './Logo';
import { SkillPicker } from './SkillPicker';
import { PreferenceMultiSelect } from './PreferenceMultiSelect';
import { AccessRequestModal } from './AccessRequestModal';
import { checkOnboardingEmail, claimInviteeAccount, OnboardingEmailStatus } from '../lib/onboardingClaim';

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
 * "User from sub claim in JWT does not exist" -- the account this session was issued for has been
 * deleted. Nothing on this screen can succeed while that is true, so it is not an error about the
 * password; it is an error about the session.
 */
const isDeletedAccountError = (err: any) =>
    err?.code === 'user_not_found' || /sub claim|user not found/i.test(err?.message || '');

/**
 * What GoTrue puts in the URL when a link does not work out. It arrives in the fragment
 * (#error=access_denied&error_code=otp_expired&...) and, unlike the success case, supabase-js
 * leaves it there rather than clearing it -- so it is still readable by the time this renders.
 *
 * Reading it is the whole point: without this the screen sees no session, concludes the visitor
 * is a stranger, and sends them to /login, which is how a dead invite link came to look like
 * being asked to sign in.
 */
function readLinkError(): string | null {
    if (typeof window === 'undefined') return null;
    const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const fromQuery = new URLSearchParams(window.location.search);
    const code = fromHash.get('error_code') || fromQuery.get('error_code');
    const description = fromHash.get('error_description') || fromQuery.get('error_description');
    const error = fromHash.get('error') || fromQuery.get('error');
    if (!code && !description && !error) return null;

    if (code === 'otp_expired' || /expired/i.test(description || '')) {
        return 'That link has expired or had already been used. Links are good for one visit only — no matter: enter your email below and carry on from there.';
    }
    return description
        ? description.replace(/\+/g, ' ')
        : 'That link did not work. Enter your email below and carry on from there.';
}

/**
 * Where step 1 sends an address that is not waiting to be set up, and what it says on the way.
 * Every one of these is somebody who should be on the sign-in page: either they have a password
 * already, or the thing they need is an admin rather than this screen.
 */
const turnedAwayMessage: Record<Exclude<OnboardingEmailStatus, 'invitee'>, string> = {
    member: 'You are already a member — sign in with your password.',
    deactivated: 'That account has been deactivated. Ask an admin to turn it back on, or use "Request reactivation".',
    deleted: 'That account has been deleted. Use "Request reactivation" and an admin can restore it.',
    unknown: 'We have no account for that address yet. Ask an admin, or use "Request access".',
};

/**
 * Account setup, and the only door an invitee comes through.
 *
 * This screen used to assume it was being opened from a per-person invite link that had already
 * authenticated the visitor, so a visitor without a session could only be somebody lost, and it
 * sent them to /login. That assumption cost us both of the things that were wrong with invites:
 * a link that had expired or been clicked twice arrived here with no session and silently became
 * the login page, and the "shareable" link could not be shared because it was not really a link
 * to anywhere -- the credential was the whole of it.
 *
 * So the credential moved off the link. /welcome is now a public address that anyone may open,
 * and step 1 establishes who they are on the spot:
 *
 *   1a  email     -- the address they were approved under. onboarding_email_status() says which
 *                    of five states it is in, and only one of them belongs on this screen: an
 *                    invitee, meaning an account an admin created that has never been set up.
 *                    A member, a disabled account and an address with no account are all told
 *                    why in a toast and sent to /login, which is where what they need is.
 *   1b  account   -- name and password.
 *
 * Somebody who followed a working invite link from their mail arrives already signed in and
 * starts at 1b; 1a is what the shared link needs and what a dead link falls back to.
 *
 * The one-time code that used to sit between the two is parked (it is in the history if it comes
 * back). It proved the visitor reads mail at the address, and without it the address alone is
 * what gets somebody in -- which is also why the password on 1b cannot be set with
 * `auth.updateUser`: there is no session to set it under. The onboarding-claim Edge Function
 * does it, under the same invitee rule, and the browser then signs in with what it set. See that
 * function's header for what parking the code costs.
 *
 * Finishing 1b is what turns an invitee into a member: complete_onboarding_step_one() sets
 * onboarding_completed, promotes them out of 'invitee', puts them on the default team and closes
 * their access request, in one transaction.
 *
 * Step 2 -- team, skills, brands, regions -- is preferences, and preferences live in the app
 * already, so it is skippable and walking away from it costs nothing.
 */
export function Onboarding() {
    const { session, profile, loading: authLoading, refreshProfile, signOut } = useAuth();
    const { refreshUsers, refreshTeams } = useData();
    const navigate = useNavigate();

    const [step, setStep] = useState(1);
    // How far into step 1 somebody who is not signed in yet has got. Once they are, the session
    // decides -- see `stage` below.
    const [unverifiedStage, setStage] = useState<'email' | 'account'>('email');
    const [verifyEmail, setVerifyEmail] = useState('');
    const [checking, setChecking] = useState(false);
    const [showRequestAccess, setShowRequestAccess] = useState(false);
    // Only ever read once, and before anything else can rewrite the URL.
    const [linkError, setLinkError] = useState<string | null>(readLinkError);
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

    // The session's address when there is one, and otherwise the one they just typed and had
    // checked -- which is the address the rest of step 1 is about either way.
    const email = session?.user?.email || verifyEmail;
    const strengthScore = useMemo(() => calculateStrength(newPassword), [newPassword]);
    const strengthDetails = getStrengthDetails(strengthScore);

    // The invite carries the name the admin typed; fall back to the local part of the
    // email. An admin who invited by address alone leaves the name as that address, so
    // treat that the same as having typed nothing.
    useEffect(() => {
        if (!email) return;
        const meta = session?.user?.user_metadata || {};
        const invited = [meta.name, meta.full_name].find(n => n && !n.includes('@'));
        setName(prev => prev || invited || email.split('@')[0] || '');
    }, [session, email]);

    // A session is proof of identity however it was obtained, so it settles the question of
    // whether the address still has to be established. Derived rather than stored: an effect
    // would leave one render showing the email form to somebody who is already signed in.
    const stage: 'email' | 'account' = session?.user ? 'account' : unverifiedStage;

    // Whatever a dead link had to say stops mattering the moment they are in.
    useEffect(() => {
        if (session?.user) setLinkError(null);
    }, [session]);

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
    // No session is no longer a reason to send anybody away: it is simply somebody at the start
    // of step 1, which is what the shared link is for.
    //
    // Step 1 being already behind them, on the other hand, still is -- a second click on an
    // invite or setup link included. /login sends a live session to the dashboard.
    if (session && profile?.onboardingCompleted && !completedStepOneHere.current) {
        return <Navigate to="/login" replace />;
    }

    /**
     * The whole of step 1a: is there an account behind this address waiting to be set up?
     *
     * Only an invitee stays here. Everyone else is somebody the sign-in page can do more for
     * than this one can -- a member has a password, and a disabled or unknown address needs an
     * admin -- so they are told which it is and sent there rather than shown a password box
     * that would be refused at the end of it.
     */
    const handleCheckEmail = async (e?: React.FormEvent) => {
        e?.preventDefault();
        const address = verifyEmail.trim().toLowerCase();
        if (!address) {
            setError('Enter the email address you were approved under.');
            return;
        }

        setChecking(true);
        setError(null);
        setLinkError(null);
        try {
            const status = await checkOnboardingEmail(address);

            if (status !== 'invitee') {
                toast(turnedAwayMessage[status], { icon: 'ℹ️', duration: 7000 });
                navigate('/login', { replace: true });
                return;
            }

            setVerifyEmail(address);
            setStage('account');
        } catch (err: any) {
            setError(err.message || 'Could not check that address.');
        } finally {
            setChecking(false);
        }
    };

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
            // The invite carried a team; whichever way the session was obtained, that is where
            // it is, and it has to survive into the RPC below.
            let invitedTeamId: string | null = session?.user?.user_metadata?.team_id ?? null;

            if (session?.user) {
                const { error: updateError } = await supabase.auth.updateUser({
                    password: newPassword,
                    data: { name: name.trim() }
                });
                // Typing the password they already have is not a mistake worth stopping for: the
                // point of this step is that a password exists, and one does.
                if (updateError && !isSamePasswordError(updateError)) throw updateError;
            } else {
                // Nobody is signed in, because step 1a established the address by asking the
                // database rather than by mailing it. `updateUser` has no session to work with,
                // so the Edge Function sets the password (and confirms the address, which an
                // invite leaves unconfirmed), and signing in with it is what produces the
                // session the RPC below needs.
                await claimInviteeAccount({
                    email: verifyEmail,
                    name: name.trim(),
                    password: newPassword
                });

                const { data: signedIn, error: signInError } = await supabase.auth.signInWithPassword({
                    email: verifyEmail,
                    password: newPassword
                });
                if (signInError) throw signInError;

                invitedTeamId = (signedIn.user?.user_metadata?.team_id as string | undefined) ?? null;
            }

            // Before the call, not after. On the claim path the sign-in above happens in this
            // same submit, so AuthContext is still fetching the profile while the RPC below
            // commits -- and a fetch that lands after that commit sees onboarding_completed and
            // renders the guard, which would throw them out to /login having just set their
            // password. Nothing is claimed prematurely: the guard needs a completed profile as
            // well, so if the RPC fails this flag alone changes nothing.
            completedStepOneHere.current = true;

            // One call for the rest of it: the name, onboarding_completed, the promotion out of
            // 'invitee', and the default team. An invite that named a team keeps it.
            const { data: result, error: rpcError } = await supabase.rpc('complete_onboarding_step_one', {
                p_name: name.trim(),
                p_team_id: invitedTeamId
            });
            if (rpcError) throw rpcError;

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
            // The account this session was issued for is gone -- deleted, and in the usual case
            // re-invited since, which mints a new one and leaves this browser holding a token for
            // the old. AuthContext clears these on the way in; this catches the one that dies
            // while the form is open. Reporting it as "could not set your password" would be a
            // lie about a screen there is no way forward from, so the session goes and they
            // start again from the address, which is the step that fixes it.
            if (isDeletedAccountError(err)) {
                await supabase.auth.signOut({ scope: 'local' });
                setStage('email');
                setNewPassword('');
                setRetypePassword('');
                setError(
                    'That setup link was issued for an account that no longer exists — it was'
                    + ' probably replaced by a newer invite. Enter your email address to start'
                    + ' again.'
                );
                return;
            }
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

    // Three things happen here and the person should be able to see which one they are on.
    // `step` cannot say it by itself: it counts transactions, and the first of those -- the
    // address, then a password -- is two pieces of work from where they are sitting.
    //
    // "Your email" rather than "Verify email": nothing here verifies that they read mail at the
    // address any more, and a label should not claim otherwise.
    const steps = [
        { number: 1, label: 'Your email' },
        { number: 2, label: 'Create password' },
        { number: 3, label: 'Team & skills' }
    ];

    const displayStep = step === 2 ? 3 : stage === 'account' ? 2 : 1;

    const joinedTeamName = teams.find(t => t.id === joinedTeamId)?.name;

    const heading = step === 2
        ? "You're in"
        : stage === 'account'
            ? 'Create your password'
            : 'Set up your account';

    const subheading = step === 2
        ? joinedTeamName
            ? `Your account is ready and you've been added to ${joinedTeamName}. The rest is optional — change your team or tell us what you work on, or skip it and do it later from Preferences.`
            : 'Your account is ready. The rest is optional — tell us what you work on, or skip it and do it later from Preferences.'
        : stage === 'email'
            ? 'Start with the email address your access was approved under.'
            : arrivedWithPassword
                ? 'Confirm your name and password to finish creating your account. If you have already chosen a password, enter it again here.'
                : "Pick a name and a password and you're in.";

    return (
        <div className="min-h-screen bg-gray-50 py-12 px-4 flex justify-center font-sans">
            <div className="max-w-lg w-full h-fit">
                <div className="flex justify-center mb-6">
                    <Logo className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0" />
                </div>

                <div className="bg-white p-6 md:p-8 rounded-xl shadow-sm border border-gray-200">
                    <h1 className="text-xl font-bold text-gray-900">{heading}</h1>
                    <p className="text-sm text-gray-500 mt-1">{subheading}</p>

                    {/* Label under the circle, not beside it. Three of these side by side do not
                        fit the card in a row -- the third wrapped onto a line of its own, which
                        read as a broken layout rather than a third step. Stacked, each step owns a
                        fixed column and the connectors take whatever is left, so it holds together
                        at any width and however long the labels get. */}
                    <div className="flex items-start my-6">
                        {steps.map((s, index) => (
                            <React.Fragment key={s.number}>
                                <div className="flex flex-col items-center gap-1.5 w-24 shrink-0">
                                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold ${
                                        displayStep > s.number
                                            ? 'bg-green-500 text-white'
                                            : displayStep === s.number
                                                ? 'bg-blue-600 text-white'
                                                : 'bg-gray-200 text-gray-500'
                                    }`}>
                                        {displayStep > s.number ? <Check className="w-4 h-4" /> : s.number}
                                    </div>
                                    <span className={`text-[11px] font-medium text-center leading-tight ${displayStep >= s.number ? 'text-gray-900' : 'text-gray-400'}`}>
                                        {s.label}
                                    </span>
                                </div>
                                {/* Sits level with the middle of the circles above the labels. */}
                                {index < steps.length - 1 && (
                                    <div className="flex-1 h-px bg-gray-200 mt-3.5" />
                                )}
                            </React.Fragment>
                        ))}
                    </div>

                    {/* A dead link is not the visitor's mistake and there is a way on from here,
                        so it is said in amber and followed by the form that fixes it. */}
                    {linkError && (
                        <div className="mb-4 bg-amber-50 text-amber-800 px-4 py-3 rounded-lg text-sm border border-amber-200">
                            {linkError}
                        </div>
                    )}

                    {error && (
                        <div className="mb-4 bg-red-50 text-red-700 px-4 py-3 rounded-lg text-sm border border-red-100">
                            {error}
                        </div>
                    )}

                    {step === 1 && stage === 'email' ? (
                        <form onSubmit={handleCheckEmail} className="space-y-5">
                            <div className="space-y-1">
                                <label className="block text-sm font-medium text-gray-700">
                                    Work email <span className="text-gray-500">*</span>
                                </label>
                                <input
                                    type="email"
                                    required
                                    autoFocus
                                    value={verifyEmail}
                                    onChange={(e) => setVerifyEmail(e.target.value)}
                                    placeholder="you@example.com"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all text-sm"
                                />
                                <div className="mt-2 bg-amber-50 text-amber-800 px-3 py-2.5 rounded-lg text-xs font-medium border border-amber-200">
                                    This has to be the address an admin approved, character for character.
                                    Only an address that is waiting to be set up gets past here.
                                </div>
                            </div>

                            <div className="pt-2 flex justify-end">
                                <button
                                    type="submit"
                                    disabled={checking || !verifyEmail.trim()}
                                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                                >
                                    {checking && <Loader2 className="w-4 h-4 animate-spin" />}
                                    Continue
                                </button>
                            </div>
                        </form>
                    ) : step === 1 ? (
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

                {/* Two different ways of not being the person this screen thinks it is talking to.
                    With a session there is something to end; without one, nothing has happened
                    yet and the address is simply the wrong one, so going back a step is the fix
                    rather than being sent to a sign-in page they cannot use. */}
                {step === 1 && stage === 'account' && (
                    <p className="text-center text-xs text-gray-500 mt-4">
                        Not {email}?{' '}
                        {session?.user ? (
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
                        ) : (
                            <button
                                type="button"
                                onClick={() => {
                                    setStage('email');
                                    setError(null);
                                    setNewPassword('');
                                    setRetypePassword('');
                                }}
                                className="text-blue-600 hover:text-blue-700 font-medium"
                            >
                                Use a different email
                            </button>
                        )}
                    </p>
                )}

                {/* Before a session exists this is the only honest answer to "it says my address
                    is not one you know": they have not been approved, and asking is the way to be. */}
                {step === 1 && stage !== 'account' && (
                    <p className="text-center text-xs text-gray-500 mt-4">
                        Not been approved yet?{' '}
                        <button
                            type="button"
                            onClick={() => setShowRequestAccess(true)}
                            className="text-blue-600 hover:text-blue-700 font-medium"
                        >
                            Request access
                        </button>
                        {' · '}
                        <button
                            type="button"
                            onClick={() => navigate('/login')}
                            className="text-blue-600 hover:text-blue-700 font-medium"
                        >
                            Already have a password? Sign in
                        </button>
                    </p>
                )}
            </div>

            {showRequestAccess && (
                <AccessRequestModal
                    kind="access"
                    defaultEmail={verifyEmail}
                    onClose={() => setShowRequestAccess(false)}
                />
            )}
        </div>
    );
}
