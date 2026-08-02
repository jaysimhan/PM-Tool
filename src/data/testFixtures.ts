import {
    Assignment, Client, Comment, Leave, Notification, Region, Skill, Tag, Task, TaskStatus,
    Team, User, WorkCategory
} from '../types/types';

/**
 * The dataset the test environment runs on. It is invented here and never leaves the
 * browser: nothing in this file is written to Supabase, and every id is prefixed `test-`
 * so that a stray query keyed on one of them cannot match a real row.
 *
 * Everything is generated from fixed lists rather than randomly, so two people opening
 * /test see the same sandbox and a screenshot means something. Dates are the exception —
 * they are laid out around today so the calendar, workload grid and timeline always have
 * work in view.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

const anchor = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
})();

/** A date `offset` days from today as YYYY-MM-DD. */
const day = (offset: number) => {
    const d = new Date(anchor.getTime() + offset * DAY_MS);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const iso = (offset: number) => new Date(anchor.getTime() + offset * DAY_MS).toISOString();

// ── Reference data ───────────────────────────────────────────────────────────

export const testRegions: Region[] = [
    { id: 'test-region-usa', name: 'USA', code: 'US', flag: '🇺🇸' },
    { id: 'test-region-uk', name: 'UK', code: 'GB', flag: '🇬🇧' },
    { id: 'test-region-au', name: 'AU', code: 'AU', flag: '🇦🇺' },
];

export const testClients: Client[] = [
    { id: 'test-client-carestack', name: 'CareStack', department: 'Marketing' },
    { id: 'test-client-voicestack', name: 'VoiceStack', department: 'Marketing' },
    { id: 'test-client-osdental', name: 'OS Dental', department: 'Growth' },
    { id: 'test-client-acedsn', name: 'ACE DSN', department: 'Partnerships' },
    { id: 'test-client-aeka', name: 'Aeka', department: 'Brand' },
];

export const testTeams: Team[] = [
    { id: 'test-team-design', name: 'Design', description: 'Brand and product design', memberIds: [], skillIds: [], color: '#6366f1', isHomeTeam: false },
    { id: 'test-team-content', name: 'Content', description: 'Copy, editorial and campaigns', memberIds: [], skillIds: [], color: '#10b981', isHomeTeam: false },
    { id: 'test-team-web', name: 'Web', description: 'Site builds and landing pages', memberIds: [], skillIds: [], color: '#f59e0b', isHomeTeam: false },
    { id: 'test-team-video', name: 'Video', description: 'Motion and post-production', memberIds: [], skillIds: [], color: '#ec4899', isHomeTeam: false },
];

export const testSkills: Skill[] = [
    { id: 'test-skill-figma', name: 'Figma', category: 'Design', teamIds: ['test-team-design'] },
    { id: 'test-skill-illustration', name: 'Illustration', category: 'Design', teamIds: ['test-team-design'] },
    { id: 'test-skill-copywriting', name: 'Copywriting', category: 'Content', teamIds: ['test-team-content'] },
    { id: 'test-skill-seo', name: 'SEO', category: 'Content', teamIds: ['test-team-content'] },
    { id: 'test-skill-webflow', name: 'Webflow', category: 'Web', teamIds: ['test-team-web'] },
    { id: 'test-skill-frontend', name: 'Front-end', category: 'Web', teamIds: ['test-team-web'] },
    { id: 'test-skill-aftereffects', name: 'After Effects', category: 'Video', teamIds: ['test-team-video'] },
    { id: 'test-skill-editing', name: 'Video editing', category: 'Video', teamIds: ['test-team-video'] },
];

export const testWorkCategories: WorkCategory[] = [
    { id: 'test-cat-campaign', name: 'Campaign', teamIds: ['test-team-design', 'test-team-content'], skillIds: ['test-skill-figma', 'test-skill-copywriting'], defaultHours: 12, isActive: true },
    { id: 'test-cat-landing', name: 'Landing page', teamIds: ['test-team-web', 'test-team-design'], skillIds: ['test-skill-webflow', 'test-skill-figma'], defaultHours: 16, isActive: true },
    { id: 'test-cat-social', name: 'Social', teamIds: ['test-team-content', 'test-team-video'], skillIds: ['test-skill-copywriting', 'test-skill-editing'], defaultHours: 6, isActive: true },
    { id: 'test-cat-collateral', name: 'Sales collateral', teamIds: ['test-team-design'], skillIds: ['test-skill-illustration'], defaultHours: 8, isActive: true },
];

export const testTags: Tag[] = [
    { id: 'test-tag-launch', name: 'launch', color: '#3b82f6' },
    { id: 'test-tag-rush', name: 'rush', color: '#ef4444' },
    { id: 'test-tag-event', name: 'event', color: '#8b5cf6' },
    { id: 'test-tag-evergreen', name: 'evergreen', color: '#10b981' },
];

// ── People ───────────────────────────────────────────────────────────────────

type MemberSeed = [name: string, teamId: string, role: User['role'], capacity: number, skillIds: string[]];

const memberSeeds: MemberSeed[] = [
    ['Aisha Khan', 'test-team-design', 'team_leader', 8, ['test-skill-figma', 'test-skill-illustration']],
    ['Diego Ramos', 'test-team-design', 'team_member', 8, ['test-skill-figma']],
    ['Priya Nair', 'test-team-design', 'team_member', 6, ['test-skill-illustration']],
    ['Ben Ortiz', 'test-team-content', 'team_leader', 8, ['test-skill-copywriting', 'test-skill-seo']],
    ['Hannah Boyle', 'test-team-content', 'team_member', 8, ['test-skill-copywriting']],
    ['Marcus Lee', 'test-team-content', 'team_member', 4, ['test-skill-seo']],
    ['Chen Wu', 'test-team-web', 'team_leader', 8, ['test-skill-webflow', 'test-skill-frontend']],
    ['Sofia Rossi', 'test-team-web', 'team_member', 8, ['test-skill-frontend']],
    ['Tom Becker', 'test-team-web', 'team_member', 8, ['test-skill-webflow']],
    ['Lena Fischer', 'test-team-video', 'team_leader', 8, ['test-skill-aftereffects', 'test-skill-editing']],
    ['Omar Haddad', 'test-team-video', 'team_member', 6, ['test-skill-editing']],
    ['Grace Kim', 'test-team-video', 'team_member', 8, ['test-skill-aftereffects']],
];

export const testUsers: User[] = memberSeeds.map(([name, teamId, role, dailyCapacity, skillIds], index) => ({
    id: `test-user-${index + 1}`,
    name,
    email: `${name.toLowerCase().replace(/[^a-z]+/g, '.')}@example.test`,
    role,
    teamIds: [teamId],
    skillIds,
    // Everyone is happy to take work from any brand or region, so round-robin has something
    // to chew on rather than falling through to the manual path every time.
    clientIds: testClients.map(c => c.id),
    regionIds: testRegions.map(r => r.id),
    dailyCapacity,
    isActive: true,
    onboardingCompleted: true,
    deletedAt: null,
}));

// Teams carry their membership too — several pages read it from the team rather than the user.
testTeams.forEach(team => {
    team.memberIds = testUsers.filter(u => u.teamIds.includes(team.id)).map(u => u.id);
    team.skillIds = testSkills.filter(s => s.teamIds.includes(team.id)).map(s => s.id);
});

const memberOf = (teamId: string) => testUsers.filter(u => u.teamIds.includes(teamId));

// ── Work ─────────────────────────────────────────────────────────────────────

type TaskSeed = [
    title: string,
    teamId: string,
    categoryId: string,
    status: TaskStatus,
    priority: Task['priority'],
    hours: number,
    start: number | null,   // days from today; null leaves it unscheduled
    length: number,
    tagIds: string[]
];

const taskSeeds: TaskSeed[] = [
    ['Q3 launch key visual', 'test-team-design', 'test-cat-campaign', 'in_progress', 'high', 14, -2, 4, ['test-tag-launch']],
    ['Pricing page redesign', 'test-team-design', 'test-cat-landing', 'scheduled', 'normal', 20, 1, 5, []],
    ['Conference booth panels', 'test-team-design', 'test-cat-collateral', 'accepted', 'urgent', 10, 0, 3, ['test-tag-event', 'test-tag-rush']],
    ['Icon set refresh', 'test-team-design', 'test-cat-collateral', 'on_hold', 'low', 6, 4, 2, ['test-tag-evergreen']],
    ['Brand guidelines v3', 'test-team-design', 'test-cat-collateral', 'in_review', 'normal', 12, -5, 4, []],
    ['Launch email sequence', 'test-team-content', 'test-cat-campaign', 'in_progress', 'high', 9, -1, 3, ['test-tag-launch']],
    ['SEO audit write-up', 'test-team-content', 'test-cat-campaign', 'scheduled', 'normal', 8, 2, 3, []],
    ['Case study: ACE DSN', 'test-team-content', 'test-cat-campaign', 'accepted', 'normal', 10, 3, 4, ['test-tag-evergreen']],
    ['Release notes for 4.2', 'test-team-content', 'test-cat-social', 'in_progress', 'low', 4, 0, 2, []],
    ['Webinar promo copy', 'test-team-content', 'test-cat-social', 'new_request', 'high', 5, null, 0, ['test-tag-event']],
    ['Campaign landing page', 'test-team-web', 'test-cat-landing', 'in_progress', 'urgent', 24, -3, 6, ['test-tag-launch', 'test-tag-rush']],
    ['Docs site navigation', 'test-team-web', 'test-cat-landing', 'scheduled', 'normal', 16, 2, 5, []],
    ['Cookie banner rework', 'test-team-web', 'test-cat-landing', 'accepted', 'low', 6, 5, 2, []],
    ['Partner portal tweaks', 'test-team-web', 'test-cat-landing', 'blocked', 'normal', 12, 1, 4, []],
    ['Analytics event cleanup', 'test-team-web', 'test-cat-landing', 'new_request', 'normal', 8, null, 0, []],
    ['Product tour animation', 'test-team-video', 'test-cat-social', 'in_progress', 'high', 18, -2, 5, ['test-tag-launch']],
    ['Customer testimonial cut', 'test-team-video', 'test-cat-social', 'scheduled', 'normal', 10, 3, 3, []],
    ['Event sizzle reel', 'test-team-video', 'test-cat-social', 'accepted', 'urgent', 14, 0, 4, ['test-tag-event', 'test-tag-rush']],
    ['Social teaser set', 'test-team-video', 'test-cat-social', 'waiting_for_information', 'low', 5, 6, 2, []],
    ['Yearly recap edit', 'test-team-video', 'test-cat-social', 'new_request', 'normal', 12, null, 0, []],
    ['Sales one-pager', 'test-team-design', 'test-cat-collateral', 'awaiting_assignment', 'normal', 6, null, 0, []],
    ['Nurture flow rewrite', 'test-team-content', 'test-cat-campaign', 'manager_review_required', 'high', 9, 4, 3, []],
    ['App store screenshots', 'test-team-design', 'test-cat-collateral', 'completed', 'normal', 8, -12, 3, []],
    ['Old blog migration', 'test-team-web', 'test-cat-landing', 'completed', 'low', 20, -18, 6, []],
    ['Retired banner set', 'test-team-design', 'test-cat-collateral', 'cancelled', 'low', 4, -9, 2, []],
];

export const testTasks: Task[] = taskSeeds.map(
    ([title, teamId, categoryId, status, priority, hours, start, length, tagIds], index) => {
        const team = testTeams.find(t => t.id === teamId)!;
        const members = memberOf(teamId);
        // Round-robin within the team, and every fifth task is left for somebody to pick up
        // so the unassigned lane and the assignment flows have something in them.
        const unassigned = index % 5 === 4 && start === null;
        const assignee = unassigned ? undefined : members[index % members.length];
        const client = testClients[index % testClients.length];
        const region = testRegions[index % testRegions.length];

        return {
            id: `test-task-${index + 1}`,
            requestId: `TEST-${String(index + 1).padStart(3, '0')}`,
            title,
            description: `Sandbox request for ${client.name}. Nothing here exists outside the test environment.`,
            categoryId,
            clientId: client.id,
            regionId: region.id,
            requesterId: testUsers[(index * 3) % testUsers.length].id,
            priority,
            status,
            estimatedHours: hours,
            dueDate: day(start === null ? 10 + (index % 5) : start + length + 1),
            createdDate: iso(-14 + (index % 7)),
            completedDate: status === 'completed' ? iso(start === null ? -5 : start + length) : undefined,
            teamIds: [team.id],
            requiredSkillIds: team.skillIds.slice(0, 1),
            subtaskIds: [],
            assignedToId: assignee?.id,
            assignedDate: assignee ? iso(-6 + (index % 4)) : undefined,
            acceptedDate: assignee && status !== 'awaiting_assignment' ? iso(-5 + (index % 4)) : undefined,
            proposedStartDate: start === null ? undefined : day(start),
            proposedEndDate: start === null ? undefined : day(start + length),
            dependencyIds: [],
            linkedTaskIds: [],
            tags: testTags.filter(t => tagIds.includes(t.id)),
            isSubtask: false,
        };
    }
);

// A couple of real dependencies so the timeline draws its connectors — and one that runs
// backwards, which is what turns a connector red.
testTasks[1].dependencyIds = ['test-task-1'];
testTasks[11].dependencyIds = ['test-task-11'];
testTasks[16].dependencyIds = ['test-task-18'];

export const testLeaves: Leave[] = [
    { id: 'test-leave-1', userId: 'test-user-2', startDate: day(1), endDate: day(3), type: 'vacation', description: 'Annual leave' },
    { id: 'test-leave-2', userId: 'test-user-5', startDate: day(0), endDate: day(0), type: 'training', hours: 4, description: 'Workshop' },
    { id: 'test-leave-3', userId: 'test-user-9', startDate: day(4), endDate: day(5), type: 'sick', description: 'Out sick' },
    { id: 'test-leave-4', userId: 'test-user-12', startDate: day(2), endDate: day(2), type: 'meeting', hours: 3, description: 'Client review' },
];

export const testComments: Comment[] = [
    { id: 'test-comment-1', taskId: 'test-task-1', userId: 'test-user-1', content: 'First pass is up for review.', createdDate: iso(-1), isInternal: false },
    { id: 'test-comment-2', taskId: 'test-task-11', userId: 'test-user-7', content: 'Blocked on final copy.', createdDate: iso(-2), isInternal: true },
];

export const testAssignments: Assignment[] = [];
export const testNotifications: Notification[] = [];

/** A fresh copy each time, so the sandbox can be edited without the fixtures drifting. */
export const buildTestDataset = () => ({
    users: testUsers.map(u => ({ ...u })),
    teams: testTeams.map(t => ({ ...t })),
    skills: testSkills.map(s => ({ ...s })),
    workCategories: testWorkCategories.map(c => ({ ...c })),
    clients: testClients.map(c => ({ ...c })),
    tasks: testTasks.map(t => ({ ...t })),
    leaves: testLeaves.map(l => ({ ...l })),
    assignments: testAssignments.map(a => ({ ...a })),
    notifications: testNotifications.map(n => ({ ...n })),
    comments: testComments.map(c => ({ ...c })),
    allTags: testTags.map(t => ({ ...t })),
    regions: testRegions.map(r => ({ ...r })),
});
