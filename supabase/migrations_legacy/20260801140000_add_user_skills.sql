-- Per-person skills.
--
-- A person's skills are their own, not their team's: anyone can put any skill in the
-- org on their profile, including skills owned by another team. That is why this is a
-- plain join table against public.skills rather than a subset of team_skills.
--
-- public.user_skills already existed on the deployed database but was unused and, unlike
-- every other table here, had no RLS. Everything below is written to be idempotent: on
-- the deployed database this migration only adds the lookup index, turns RLS on and
-- gives it the same authenticated-only policy the rest of the schema uses; on a fresh
-- database it also creates the table.
--
-- ON DELETE CASCADE on skill_id matters: Team Management can delete a skill globally,
-- and that must not leave dangling ids on people's profiles.

CREATE TABLE IF NOT EXISTS public.user_skills (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES public.skills(id) ON DELETE CASCADE,
    proficiency_level TEXT,
    PRIMARY KEY (user_id, skill_id),
    CONSTRAINT user_skills_proficiency_level_check
        CHECK (proficiency_level IN ('beginner', 'intermediate', 'advanced', 'expert'))
);

CREATE INDEX IF NOT EXISTS user_skills_skill_id_idx ON public.user_skills (skill_id);

ALTER TABLE public.user_skills ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all authenticated users access to user_skills" ON public.user_skills;
CREATE POLICY "Allow all authenticated users access to user_skills"
    ON public.user_skills FOR ALL USING (auth.role() = 'authenticated');
