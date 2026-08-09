-- Indexes for the columns this application actually filters and joins on.
--
-- Before this, the only indexes on the schema were the ones constraints created for
-- themselves: primary keys, a handful of uniques, and nothing else. Every filter the app
-- performs -- tasks by status, by assignee, by brand, by due date; the join tables that
-- resolve a task's teams and tags -- was a sequential scan.
--
-- That has cost nothing so far because the tables are small. It stops being free at the size
-- this is being built for, and the join tables get there first: task_teams and task_tags are
-- read in full on every session init, and their primary keys are (task_id, team_id) and
-- (task_id, tag_id). A composite key indexes its leading column only, so "which tasks belong
-- to this team" -- the direction the workload and dashboard screens ask in -- has no index at
-- all. Those two reversed indexes are the ones that matter most here.
--
-- All IF NOT EXISTS: several already exist from the acceptance-workflow migration, and this
-- must be safe to re-run.

-- ---------------------------------------------------------------------------------------
-- Tasks: the filters behind the calendar, the board, the workload screens and the dashboard.
-- ---------------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS tasks_status_idx      ON public.tasks (status);
CREATE INDEX IF NOT EXISTS tasks_assignee_id_idx ON public.tasks (assignee_id);
CREATE INDEX IF NOT EXISTS tasks_client_id_idx   ON public.tasks (client_id);
CREATE INDEX IF NOT EXISTS tasks_region_id_idx   ON public.tasks (region_id);
CREATE INDEX IF NOT EXISTS tasks_priority_idx    ON public.tasks (priority);
CREATE INDEX IF NOT EXISTS tasks_due_date_idx    ON public.tasks (due_date);
CREATE INDEX IF NOT EXISTS tasks_created_at_idx  ON public.tasks (created_at DESC);
CREATE INDEX IF NOT EXISTS tasks_requester_id_idx ON public.tasks (requester_id);

-- Subtasks are fetched by parent, and only a minority of rows are subtasks at all.
CREATE INDEX IF NOT EXISTS tasks_parent_task_id_idx
    ON public.tasks (parent_task_id) WHERE parent_task_id IS NOT NULL;

-- "What is still open" underlies the overdue count, the emergent-work block and every
-- capacity sum. Partial, because finished and abandoned work is the majority over time and
-- none of those questions ever ask about it.
CREATE INDEX IF NOT EXISTS tasks_open_due_date_idx
    ON public.tasks (due_date)
    WHERE status NOT IN ('completed', 'cancelled');

-- One person's queue: their own workload page, and the check that runs before an account can
-- be deleted or deactivated.
CREATE INDEX IF NOT EXISTS tasks_assignee_status_idx
    ON public.tasks (assignee_id, status) WHERE assignee_id IS NOT NULL;

-- ---------------------------------------------------------------------------------------
-- Join tables, in the direction the primary key does not cover.
-- ---------------------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS task_teams_team_id_idx ON public.task_teams (team_id);
CREATE INDEX IF NOT EXISTS task_tags_tag_id_idx   ON public.task_tags (tag_id);
CREATE INDEX IF NOT EXISTS task_skills_skill_id_idx ON public.task_skills (skill_id);

-- team_members already has a unique index on user_id (one team per person); team_id is the
-- direction every roster and capacity query reads.
CREATE INDEX IF NOT EXISTS team_members_team_id_idx ON public.team_members (team_id);

CREATE INDEX IF NOT EXISTS team_skills_skill_id_idx  ON public.team_skills (skill_id);
CREATE INDEX IF NOT EXISTS user_skills_skill_id_idx  ON public.user_skills (skill_id);
CREATE INDEX IF NOT EXISTS user_clients_client_id_idx ON public.user_clients (client_id);
CREATE INDEX IF NOT EXISTS user_regions_region_id_idx ON public.user_regions (region_id);

-- ---------------------------------------------------------------------------------------
-- Everything else that is read by a foreign key.
-- ---------------------------------------------------------------------------------------

-- Comments are loaded per task and shown oldest first.
CREATE INDEX IF NOT EXISTS comments_task_created_idx ON public.comments (task_id, created_at);
CREATE INDEX IF NOT EXISTS comments_user_id_idx      ON public.comments (user_id);

-- The unread badge counts one person's unread rows on every page load.
CREATE INDEX IF NOT EXISTS notifications_unread_idx
    ON public.notifications (user_id) WHERE is_read = false;

-- Users: the sign-in path matches on lower(email), and every picker filters out the people
-- who are no longer around.
CREATE INDEX IF NOT EXISTS users_lower_email_idx ON public.users (lower(email));
CREATE INDEX IF NOT EXISTS users_active_idx
    ON public.users (role) WHERE deleted_at IS NULL AND is_active;

-- The audit log is only ever read newest-first, and it is the one table here that grows
-- without bound. Its column is "timestamp", not created_at like every other table.
CREATE INDEX IF NOT EXISTS audit_logs_timestamp_idx ON public.audit_logs ("timestamp" DESC);
