import test from 'node:test';
import assert from 'node:assert/strict';
import {
    calculateDailyCapacity,
    getWorkloadStatus,
    isTaskDueSoon,
    isTaskOverdue,
} from '../src/utils/capacityCalculations.ts';
import type { Leave, Task, User } from '../src/types/types.ts';

const task = (overrides: Partial<Task> = {}) => ({
    id: 'task-1', title: 'Task', description: '', categoryId: '', clientId: '',
    requesterId: 'user-1', status: 'in_progress', estimatedHours: 8,
    dueDate: '2026-08-12', createdDate: '2026-08-01', teamIds: [],
    requiredSkillIds: [], subtaskIds: [], dependencyIds: [], tags: [], isSubtask: false,
    ...overrides,
}) as Task;

const user = {
    id: 'user-1', name: 'User', email: 'user@example.com', role: 'team_member',
    dailyCapacity: 8, teamIds: [], skillIds: [], clientIds: [], regionIds: [],
    isActive: true, onboardingCompleted: true,
} as User;

test('overdue excludes today, completed work, and missing deadlines', () => {
    const today = new Date('2026-08-10T00:00:00');
    assert.equal(isTaskOverdue(task({ dueDate: '2026-08-09' }), today), true);
    assert.equal(isTaskOverdue(task({ dueDate: '2026-08-10' }), today), false);
    assert.equal(isTaskOverdue(task({ dueDate: '2026-08-09', status: 'completed' }), today), false);
    assert.equal(isTaskOverdue(task({ dueDate: '' }), today), false);
});

test('due soon includes both boundary days and excludes overdue work', () => {
    const today = new Date('2026-08-10T00:00:00');
    assert.equal(isTaskDueSoon(task({ dueDate: '2026-08-10' }), 3, today), true);
    assert.equal(isTaskDueSoon(task({ dueDate: '2026-08-13' }), 3, today), true);
    assert.equal(isTaskDueSoon(task({ dueDate: '2026-08-14' }), 3, today), false);
    assert.equal(isTaskDueSoon(task({ dueDate: '2026-08-09' }), 3, today), false);
});

test('capacity separates accepted and provisional hours', () => {
    const accepted = task({
        assignedToId: user.id, estimatedHours: 8, status: 'in_progress',
        proposedStartDate: '2026-08-10', proposedEndDate: '2026-08-11',
    });
    const provisional = task({
        id: 'task-2', assignedToId: user.id, estimatedHours: 4,
        status: 'awaiting_employee_approval', proposedStartDate: '2026-08-10',
        proposedEndDate: '2026-08-11',
    });
    const result = calculateDailyCapacity(user, '2026-08-10', [accepted, provisional], []);
    assert.equal(result.scheduledHours, 4);
    assert.equal(result.provisionalHours, 2);
    assert.equal(result.availableHours, 4);
    assert.equal(result.utilization, 50);
    assert.equal(result.taskCount, 2);
});

test('leave removes capacity without losing scheduled-work visibility', () => {
    const work = task({
        assignedToId: user.id, estimatedHours: 8, status: 'scheduled',
        proposedStartDate: '2026-08-10', proposedEndDate: '2026-08-10',
    });
    const leave = [{
        id: 'leave-1', userId: user.id, startDate: '2026-08-10', endDate: '2026-08-10', type: 'vacation',
    }] as Leave[];
    const result = calculateDailyCapacity(user, '2026-08-10', [work], leave);
    assert.equal(result.totalCapacity, 0);
    assert.equal(result.leaveHours, 8);
    assert.equal(result.scheduledHours, 8);
    assert.equal(result.availableHours, 0);
});

test('workload status thresholds are stable', () => {
    assert.equal(getWorkloadStatus(49.99), 'available');
    assert.equal(getWorkloadStatus(50), 'balanced');
    assert.equal(getWorkloadStatus(80), 'near_capacity');
    assert.equal(getWorkloadStatus(100), 'overallocated');
});

test('partial and overlapping leave is capped at daily capacity', () => {
    const leaves = [
        { id: 'leave-1', userId: user.id, startDate: '2026-08-10', endDate: '2026-08-10', type: 'personal', hours: 3 },
        { id: 'leave-2', userId: user.id, startDate: '2026-08-10', endDate: '2026-08-10', type: 'meeting', hours: 6 },
    ] as Leave[];
    const result = calculateDailyCapacity(user, '2026-08-10', [], leaves);
    assert.equal(result.leaveHours, 8);
    assert.equal(result.totalCapacity, 0);
});

test('DST-crossing work is distributed by calendar day, not elapsed hours', () => {
    const work = task({
        assignedToId: user.id, estimatedHours: 24, status: 'scheduled',
        proposedStartDate: '2026-03-07T00:00:00-05:00',
        proposedEndDate: '2026-03-09T00:00:00-04:00',
    });
    assert.equal(calculateDailyCapacity(user, '2026-03-08', [work], []).scheduledHours, 8);
});

test('rejected work and parent rollups are not double counted', () => {
    const parent = task({ assignedToId: user.id, subtaskIds: ['child'], proposedStartDate: '2026-08-10', proposedEndDate: '2026-08-10' });
    const rejected = task({ id: 'rejected', assignedToId: user.id, status: 'rejected', proposedStartDate: '2026-08-10', proposedEndDate: '2026-08-10' });
    const child = task({ id: 'child', assignedToId: user.id, proposedStartDate: '2026-08-10', proposedEndDate: '2026-08-10' });
    const result = calculateDailyCapacity(user, '2026-08-10', [parent, rejected, child], []);
    assert.equal(result.scheduledHours, 8);
    assert.equal(result.taskCount, 1);
});

test('archived and zero-capacity people cannot show available capacity', () => {
    const archived = { ...user, isActive: false };
    assert.equal(calculateDailyCapacity(archived, '2026-08-10', [], []).totalCapacity, 0);
    const zero = { ...user, dailyCapacity: 0 };
    assert.equal(calculateDailyCapacity(zero, '2026-08-10', [], []).availableHours, 0);
});

test('invalid calculation dates return a safe empty result', () => {
    assert.equal(calculateDailyCapacity(user, 'not-a-date', [], []).taskCount, 0);
});
