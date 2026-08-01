import React, { useState } from 'react';
import { User } from '../types/types';
import { tasks, users, clients, workCategories, teams } from '../data/mockData';
import { AlertTriangle, UserCheck, Calendar, TrendingUp } from 'lucide-react';
import { getPriorityColor, getStatusBadgeColor, formatStatusLabel } from '../utils/capacityCalculations';
import toast from 'react-hot-toast';

interface Props {
  currentUser: User;
}

export default function ManagerReview({ currentUser }: Props) {
  const [selectedTask, setSelectedTask] = useState<string | null>(null);

  // Tasks requiring manager review
  const managerReviewTasks = tasks.filter(t => t.status === 'manager_review_required');

  // Overallocated employees
  const overallocatedUsers = users.filter(u => {
    const userTasks = tasks.filter(t =>
      t.assignedToId === u.id &&
      (t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted')
    );
    const totalHours = userTasks.reduce((sum, t) => sum + (t.estimatedHours - (t.actualHours || 0)), 0);
    return totalHours > u.dailyCapacity * 5; // More than a week's worth of work
  });

  // Teams with insufficient capacity
  const teamsWithIssues = teams.map(team => {
    const teamTasks = tasks.filter(t =>
      t.teamIds.includes(team.id) &&
      (t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted')
    );
    const teamMembers = users.filter(u => team.memberIds.includes(u.id));
    const totalCapacity = teamMembers.reduce((sum, u) => sum + u.dailyCapacity, 0) * 5;
    const scheduledHours = teamTasks.reduce((sum, t) => sum + (t.estimatedHours - (t.actualHours || 0)), 0);

    return {
      team,
      utilization: totalCapacity > 0 ? (scheduledHours / totalCapacity) * 100 : 0,
      hasIssue: (scheduledHours / totalCapacity) > 0.8
    };
  }).filter(t => t.hasIssue);

  // Find available team members for a task
  const getAvailableMembers = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return [];

    return users.filter(u => {
      // Must be in one of the required teams
      const isInTeam = task.teamIds.some(teamId => u.teamIds.includes(teamId));
      if (!isInTeam) return false;

      // Has required skills
      const hasSkills = task.requiredSkillIds.some(skillId => u.skillIds.includes(skillId));
      if (!hasSkills) return false;

      // Calculate current workload
      const userTasks = tasks.filter(t =>
        t.assignedToId === u.id &&
        (t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted')
      );
      const totalHours = userTasks.reduce((sum, t) => sum + (t.estimatedHours - (t.actualHours || 0)), 0);

      return totalHours < u.dailyCapacity * 5; // Has capacity
    });
  };

  const handleAssignTask = (taskId: string, userId: string) => {
    console.log('Assigning task', taskId, 'to user', userId);
    toast.success(`Task would be assigned to ${users.find(u => u.id === userId)?.name}`);
  };

  const handleChangeDeadline = (taskId: string) => {
    toast('This would open a dialog to change the deadline');
  };

  const handleSplitTask = (taskId: string) => {
    toast('This would open a dialog to split the task into multiple subtasks');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">Manager Review Queue</h1>
        <p className="text-sm text-gray-600 mt-1">Tasks and capacity issues requiring management attention</p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600">Unassigned Tasks</div>
              <div className="text-2xl font-semibold text-orange-600 mt-1">{managerReviewTasks.length}</div>
            </div>
            <div className="w-12 h-12 bg-orange-100 rounded-lg flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-orange-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600">Overallocated Members</div>
              <div className="text-2xl font-semibold text-red-600 mt-1">{overallocatedUsers.length}</div>
            </div>
            <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
              <UserCheck className="w-6 h-6 text-red-600" />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-gray-600">Teams Over Capacity</div>
              <div className="text-2xl font-semibold text-red-600 mt-1">{teamsWithIssues.length}</div>
            </div>
            <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
              <TrendingUp className="w-6 h-6 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Tasks Requiring Review */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Tasks Requiring Assignment</h2>

        {managerReviewTasks.length === 0 ? (
          <div className="text-center py-8 text-gray-500 text-sm">
            No tasks requiring manager review
          </div>
        ) : (
          <div className="space-y-4">
            {managerReviewTasks.map(task => {
              const client = clients.find(c => c.id === task.clientId);
              const category = workCategories.find(c => c.id === task.categoryId);
              const availableMembers = getAvailableMembers(task.id);
              const isExpanded = selectedTask === task.id;

              return (
                <div key={task.id} className="border-2 border-orange-200 rounded-lg overflow-hidden">
                  <div className="p-5 bg-orange-50">
                    {/* Task Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                          <div
                            className="w-3 h-3 rounded-full"
                            style={{ backgroundColor: getPriorityColor(task.priority) }}
                          ></div>
                          <h3 className="text-lg font-semibold text-gray-900">{task.title}</h3>
                          <span className="text-xs px-2 py-1 rounded bg-orange-200 text-orange-900 font-medium">
                            NEEDS ASSIGNMENT
                          </span>
                        </div>
                        <p className="text-sm text-gray-600">{task.description}</p>
                      </div>
                    </div>

                    {/* Task Info */}
                    <div className="grid grid-cols-5 gap-4 mb-4">
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Client</div>
                        <div className="text-sm font-medium text-gray-900">{client?.name}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Category</div>
                        <div className="text-sm font-medium text-gray-900">{category?.name}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Priority</div>
                        <div className="text-sm font-medium capitalize">{task.priority}</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Hours</div>
                        <div className="text-sm font-medium text-gray-900">{task.estimatedHours}h</div>
                      </div>
                      <div>
                        <div className="text-xs text-gray-500 mb-1">Due Date</div>
                        <div className="text-sm font-medium text-gray-900">
                          {new Date(task.dueDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        </div>
                      </div>
                    </div>

                    {/* Reason for Review */}
                    <div className="p-3 bg-white border border-orange-200 rounded-lg mb-4">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="w-4 h-4 text-orange-600 mt-0.5" />
                        <div className="flex-1">
                          <div className="text-xs font-medium text-orange-900 mb-1">Why this needs review</div>
                          <div className="text-sm text-gray-700">
                            No team members with the required skills have sufficient capacity to complete this task before the deadline.
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Available Members */}
                    <div className="mb-4">
                      <div className="text-sm font-medium text-gray-900 mb-2">
                        Available Team Members ({availableMembers.length})
                      </div>
                      {availableMembers.length === 0 ? (
                        <div className="text-sm text-gray-500 p-3 bg-white border border-gray-200 rounded">
                          No team members currently available. Consider changing the deadline or assigning to another team.
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          {availableMembers.map(member => {
                            const memberTeam = teams.find(t => t.memberIds.includes(member.id));
                            const memberTasks = tasks.filter(t =>
                              t.assignedToId === member.id &&
                              (t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted')
                            );
                            const workload = memberTasks.reduce((sum, t) => sum + (t.estimatedHours - (t.actualHours || 0)), 0);

                            return (
                              <div
                                key={member.id}
                                className="p-3 bg-white border border-gray-200 rounded hover:border-blue-300 cursor-pointer transition-colors"
                                onClick={() => handleAssignTask(task.id, member.id)}
                              >
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <div
                                      className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-medium"
                                      style={{ backgroundColor: memberTeam?.color || '#6B7280' }}
                                    >
                                      {member.name.split(' ').map(n => n[0]).join('')}
                                    </div>
                                    <div>
                                      <div className="text-sm font-medium text-gray-900">{member.name}</div>
                                      <div className="text-xs text-gray-500">{memberTeam?.name}</div>
                                    </div>
                                  </div>
                                </div>
                                <div className="text-xs text-gray-600">
                                  Current workload: {workload.toFixed(1)}h
                                </div>
                                <div className="text-xs text-gray-600">
                                  {memberTasks.length} active tasks
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleChangeDeadline(task.id)}
                        className="flex-1 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                      >
                        <Calendar className="w-4 h-4 inline mr-2" />
                        Change Deadline
                      </button>
                      <button
                        onClick={() => handleSplitTask(task.id)}
                        className="flex-1 px-4 py-2 bg-white border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50"
                      >
                        Split Task
                      </button>
                      <button className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700">
                        Override & Assign
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Overallocated Members */}
      {overallocatedUsers.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Overallocated Team Members</h2>
          <div className="space-y-3">
            {overallocatedUsers.map(user => {
              const userTeam = teams.find(t => t.memberIds.includes(user.id));
              const userTasks = tasks.filter(t =>
                t.assignedToId === user.id &&
                (t.status === 'in_progress' || t.status === 'scheduled' || t.status === 'accepted')
              );
              const totalHours = userTasks.reduce((sum, t) => sum + (t.estimatedHours - (t.actualHours || 0)), 0);
              const weekCapacity = user.dailyCapacity * 5;
              const utilization = (totalHours / weekCapacity) * 100;

              return (
                <div key={user.id} className="border border-red-200 rounded-lg p-4 bg-red-50">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-white text-sm font-medium"
                        style={{ backgroundColor: userTeam?.color || '#6B7280' }}
                      >
                        {user.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-gray-900">{user.name}</div>
                        <div className="text-xs text-gray-500">{userTeam?.name}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-red-600">
                        {totalHours.toFixed(1)}h / {weekCapacity}h
                      </div>
                      <div className="text-xs text-gray-600">
                        {utilization.toFixed(0)}% utilized
                      </div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="text-xs text-gray-600 mb-1">
                      {userTasks.length} active tasks
                    </div>
                    <button className="text-xs text-blue-600 hover:text-blue-700 font-medium">
                      View Tasks & Reassign →
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
