-- Per-person brand and region preferences.
--
-- These are the two things, alongside availability, that steer round-robin assignment: a
-- person is only handed work for a brand and a region they picked. They are preferences, not
-- permissions -- assigning by hand deliberately ignores them and goes on skill alone, because
-- manual assignment exists precisely for work nobody preferred.
--
-- Modelled on public.user_skills: plain join tables, no ordering or weighting, and no
-- restriction to the person's own team. Somebody can want work for any brand in the org.
--
-- ON DELETE CASCADE both ways: Team Management can delete a client, and an admin can delete a
-- person, and neither must leave preference rows pointing at something gone.

CREATE TABLE IF NOT EXISTS public.user_clients (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    client_id UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, client_id)
);

CREATE TABLE IF NOT EXISTS public.user_regions (
    user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
    region_id UUID NOT NULL REFERENCES public.regions(id) ON DELETE CASCADE,
    PRIMARY KEY (user_id, region_id)
);

-- The round robin asks "who wants this brand/region", which is the reverse of the primary
-- key's leading column, so both need their own index on the thing being matched.
CREATE INDEX IF NOT EXISTS user_clients_client_id_idx ON public.user_clients (client_id);
CREATE INDEX IF NOT EXISTS user_regions_region_id_idx ON public.user_regions (region_id);

ALTER TABLE public.user_clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_regions ENABLE ROW LEVEL SECURITY;

-- Everyone signed in can read and write these: Team Management shows each member's picks, and
-- a team leader setting them up on somebody's behalf is expected. Same policy shape as
-- user_skills, so this table is no more open than the skills beside it.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_clients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_regions TO authenticated;

DROP POLICY IF EXISTS "Allow all authenticated users access to user_clients" ON public.user_clients;
CREATE POLICY "Allow all authenticated users access to user_clients"
    ON public.user_clients FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow all authenticated users access to user_regions" ON public.user_regions;
CREATE POLICY "Allow all authenticated users access to user_regions"
    ON public.user_regions FOR ALL USING (auth.role() = 'authenticated');
