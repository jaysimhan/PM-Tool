-- "Share Request Form" promised four things and delivered none of them: the link was a
-- literal 'f7a9b2c1' on a hardcoded workflow-pro.app host, the three toggles were React
-- state that died with the modal, Preview Form had no handler, and /request/<token> was
-- not a route -- so the link, wherever it got pasted, went nowhere.
--
-- Making it real needs server-side state (a token and its settings have to outlive the
-- modal) plus a way for someone with no account to read the form's options and submit
-- through it. Anonymous callers get exactly two SECURITY DEFINER functions here and no
-- table access at all: everything an unauthenticated visitor can see or write is decided
-- by these function bodies, not by whoever happens to hold the anon key.
--
-- 'Require Email Verification' is deliberately not modelled. It cannot be honoured
-- without a mail provider, and a toggle that verifies nothing is worse than no toggle.
-- The confirmation email is real but opt-in: send_confirmation defaults to false and the
-- send-request-confirmation edge function reports 'not configured' rather than pretending.

-- One link per organisation. The unique scope is what makes get_or_create idempotent
-- without a second table, and leaves room for per-team links later.
CREATE TABLE IF NOT EXISTS public.request_form_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    scope text NOT NULL DEFAULT 'org' UNIQUE,
    token text NOT NULL UNIQUE,
    public_access boolean NOT NULL DEFAULT true,
    send_confirmation boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

-- Every submission that came in through a share link. Three jobs: it is the rate-limit
-- ledger, it is what the confirmation email is addressed from (recipient and contents
-- both derived server-side, so the edge function can never be used as an open relay),
-- and it keeps the external submitter's details even if the task is later reassigned.
CREATE TABLE IF NOT EXISTS public.request_form_submissions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    link_id uuid NOT NULL REFERENCES public.request_form_links(id) ON DELETE CASCADE,
    task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
    requester_name text NOT NULL,
    requester_email text NOT NULL,
    request_ref text NOT NULL,
    confirmation_sent_at timestamptz,
    confirmation_error text,
    created_at timestamptz NOT NULL DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS request_form_submissions_link_created_idx
    ON public.request_form_submissions (link_id, created_at DESC);
CREATE INDEX IF NOT EXISTS request_form_submissions_email_created_idx
    ON public.request_form_submissions (lower(requester_email), created_at DESC);

-- An external submitter is not a member of the organisation, so they get no users row.
-- Beyond the modelling, a users row would collide with users_email_key the day somebody
-- invites them for real: handle_new_user() inserts (auth uid, email) and only tolerates
-- an id conflict, so an email already taken by a non-auth row breaks the invite outright.
-- Their identity lives on the task instead; requester_id stays null unless the address
-- belongs to somebody who already has an account, in which case it is attributed to them.
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS requester_name text,
    ADD COLUMN IF NOT EXISTS requester_email text;

-- The default privileges on this schema hand anon ALL on every new table, which is
-- exactly what must not happen here: the token column is the credential.
ALTER TABLE public.request_form_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.request_form_submissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.request_form_links FROM anon;
REVOKE ALL ON TABLE public.request_form_submissions FROM anon;
REVOKE ALL ON TABLE public.request_form_links FROM authenticated;
REVOKE ALL ON TABLE public.request_form_submissions FROM authenticated;
GRANT SELECT ON TABLE public.request_form_links TO authenticated;
GRANT SELECT ON TABLE public.request_form_submissions TO authenticated;

DROP POLICY IF EXISTS "Signed-in users can read the share link" ON public.request_form_links;
CREATE POLICY "Signed-in users can read the share link"
    ON public.request_form_links FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Signed-in users can read public submissions" ON public.request_form_submissions;
CREATE POLICY "Signed-in users can read public submissions"
    ON public.request_form_submissions FOR SELECT TO authenticated USING (true);

-- Who may create the link and change its settings. Reading it is fine for any signed-in
-- user -- the amber banner on the request form tells non-admins to go get the link.
CREATE OR REPLACE FUNCTION public.current_user_is_form_admin() RETURNS boolean
    LANGUAGE sql SECURITY DEFINER STABLE
    SET search_path TO ''
    AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.users u
        WHERE u.id = auth.uid() AND u.role IN ('super_admin', 'admin')
    );
$$;

REVOKE ALL ON FUNCTION public.current_user_is_form_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_is_form_admin() TO authenticated;

-- The token is 32 hex characters of gen_random_uuid entropy. Sharing the link is the
-- whole point, so it is a bearer credential and nothing else authenticates the visitor;
-- guessing it has to be infeasible.
CREATE OR REPLACE FUNCTION public.get_or_create_request_form_link()
    RETURNS public.request_form_links
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    link public.request_form_links;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in to see the share link.';
    END IF;

    SELECT * INTO link FROM public.request_form_links WHERE scope = 'org';
    IF FOUND THEN
        RETURN link;
    END IF;

    IF NOT public.current_user_is_form_admin() THEN
        RAISE EXCEPTION 'No share link exists yet. An admin has to create one first.';
    END IF;

    INSERT INTO public.request_form_links (scope, token, created_by)
    VALUES ('org', replace(gen_random_uuid()::text, '-', ''), auth.uid())
    ON CONFLICT (scope) DO NOTHING
    RETURNING * INTO link;

    -- Two admins opening the modal at the same moment: the loser of the race reads the
    -- row the winner just wrote rather than erroring.
    IF link IS NULL THEN
        SELECT * INTO link FROM public.request_form_links WHERE scope = 'org';
    END IF;

    RETURN link;
END;
$$;

REVOKE ALL ON FUNCTION public.get_or_create_request_form_link() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_request_form_link() TO authenticated;

-- NULL means "leave this one alone", so the modal can persist a single toggle.
CREATE OR REPLACE FUNCTION public.update_request_form_link(
    p_public_access boolean DEFAULT NULL,
    p_send_confirmation boolean DEFAULT NULL
)
    RETURNS public.request_form_links
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    link public.request_form_links;
BEGIN
    IF NOT public.current_user_is_form_admin() THEN
        RAISE EXCEPTION 'Only an admin can change the share link settings.';
    END IF;

    UPDATE public.request_form_links
    SET public_access = COALESCE(p_public_access, public_access),
        send_confirmation = COALESCE(p_send_confirmation, send_confirmation),
        updated_at = timezone('utc', now())
    WHERE scope = 'org'
    RETURNING * INTO link;

    IF link IS NULL THEN
        RAISE EXCEPTION 'No share link exists yet.';
    END IF;

    RETURN link;
END;
$$;

REVOKE ALL ON FUNCTION public.update_request_form_link(boolean, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_request_form_link(boolean, boolean) TO authenticated;

-- What an anonymous visitor is allowed to know: that the link is live, and the exact
-- option lists the form needs. Nothing else about the organisation leaks through here.
--
-- An admin gets the form back even when public access is off, which is what makes
-- Preview Form work on a closed link; the reply says which case it is so the page can
-- say so out loud instead of looking live.
CREATE OR REPLACE FUNCTION public.get_public_request_form(p_token text)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER STABLE
    SET search_path TO ''
    AS $$
DECLARE
    link public.request_form_links;
    caller_is_admin boolean;
BEGIN
    SELECT * INTO link FROM public.request_form_links WHERE token = p_token;
    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;

    caller_is_admin := auth.uid() IS NOT NULL AND public.current_user_is_form_admin();

    IF NOT link.public_access AND NOT caller_is_admin THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'closed');
    END IF;

    RETURN jsonb_build_object(
        'ok', true,
        'publicAccess', link.public_access,
        'sendConfirmation', link.send_confirmation,
        'brands', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', c.id, 'name', c.name, 'departments', c.department
            ) ORDER BY c.name), '[]'::jsonb)
            FROM public.clients c
        ),
        'regions', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', r.id, 'name', r.name, 'flag', r.flag
            ) ORDER BY r.name), '[]'::jsonb)
            FROM public.regions r
        ),
        'categories', (
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'id', s.id, 'name', s.name
            ) ORDER BY s.name), '[]'::jsonb)
            FROM public.skills s
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_request_form(text) TO anon, authenticated;

-- The one write an anonymous visitor can make. Every field is re-validated here because
-- the client-side form is advice, not enforcement: a public URL means arbitrary payloads.
--
-- Rate limits stand in for the captcha this form does not have. They are per-link and
-- per-address, and the ledger is request_form_submissions, so they survive restarts.
CREATE OR REPLACE FUNCTION public.submit_public_request(p_token text, p_payload jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    link public.request_form_links;
    v_name text;
    v_email text;
    v_title text;
    v_description text;
    v_department text;
    v_priority text;
    v_client_id uuid;
    v_region_id uuid;
    v_category_id uuid;
    v_due_date timestamptz;
    v_hours numeric;
    v_requester_id uuid;
    v_task_id uuid;
    v_ref text;
    v_submission_id uuid;
    v_tag_name text;
    v_tag_id uuid;
    v_palette text[] := ARRAY['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#14b8a6','#6366f1','#f43f5e'];
BEGIN
    SELECT * INTO link FROM public.request_form_links WHERE token = p_token;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This request link is not valid.';
    END IF;
    IF NOT link.public_access THEN
        RAISE EXCEPTION 'This form is not accepting requests right now.';
    END IF;

    v_name        := nullif(btrim(p_payload->>'requesterName'), '');
    v_email       := lower(nullif(btrim(p_payload->>'requesterEmail'), ''));
    v_title       := nullif(btrim(p_payload->>'title'), '');
    v_description := nullif(btrim(p_payload->>'description'), '');
    v_department  := nullif(btrim(p_payload->>'department'), '');
    v_priority    := COALESCE(nullif(btrim(p_payload->>'priority'), ''), 'normal');

    IF v_name IS NULL THEN RAISE EXCEPTION 'Your name is required.'; END IF;
    IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION 'A valid email address is required.';
    END IF;
    IF v_title IS NULL THEN RAISE EXCEPTION 'A request title is required.'; END IF;
    IF v_description IS NULL THEN RAISE EXCEPTION 'A description is required.'; END IF;
    IF v_department IS NULL THEN RAISE EXCEPTION 'A department is required.'; END IF;
    IF v_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
        RAISE EXCEPTION 'Unknown priority: %', v_priority;
    END IF;

    -- Foreign keys come from the client, so each one is checked against the same lists
    -- get_public_request_form handed out rather than trusted into the insert. The shape
    -- is checked before the cast so a hand-crafted payload gets the form's own wording
    -- back instead of a raw 'invalid input syntax for type uuid'.
    IF COALESCE(p_payload->>'clientId', '') !~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' THEN
        RAISE EXCEPTION 'Select a brand.';
    END IF;
    v_client_id := (p_payload->>'clientId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_client_id) THEN
        RAISE EXCEPTION 'Select a brand.';
    END IF;

    IF COALESCE(p_payload->>'regionId', '') !~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' THEN
        RAISE EXCEPTION 'Select a region.';
    END IF;
    v_region_id := (p_payload->>'regionId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.regions r WHERE r.id = v_region_id) THEN
        RAISE EXCEPTION 'Select a region.';
    END IF;

    IF COALESCE(p_payload->>'categoryId', '') !~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' THEN
        RAISE EXCEPTION 'Select a work category.';
    END IF;
    v_category_id := (p_payload->>'categoryId')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.skills s WHERE s.id = v_category_id) THEN
        RAISE EXCEPTION 'Select a work category.';
    END IF;

    BEGIN
        v_due_date := nullif(btrim(p_payload->>'dueDate'), '')::timestamptz;
    EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'A valid due date is required.';
    END;
    IF v_due_date IS NULL THEN RAISE EXCEPTION 'A due date is required.'; END IF;

    BEGIN
        v_hours := nullif(btrim(p_payload->>'estimatedHours'), '')::numeric;
    EXCEPTION WHEN others THEN
        RAISE EXCEPTION 'Estimated hours must be a number.';
    END;
    IF v_hours IS NOT NULL AND (v_hours <= 0 OR v_hours > 10000) THEN
        RAISE EXCEPTION 'Estimated hours must be between 0 and 10000.';
    END IF;

    IF (SELECT count(*) FROM public.request_form_submissions s
        WHERE s.link_id = link.id AND s.created_at > now() - interval '1 hour') >= 100 THEN
        RAISE EXCEPTION 'This form has received too many requests in the last hour. Please try again later.';
    END IF;
    IF (SELECT count(*) FROM public.request_form_submissions s
        WHERE lower(s.requester_email) = v_email AND s.created_at > now() - interval '1 hour') >= 10 THEN
        RAISE EXCEPTION 'Too many requests from this email address in the last hour. Please try again later.';
    END IF;

    -- Someone on the team using the public link still gets attributed to their account.
    SELECT u.id INTO v_requester_id FROM public.users u WHERE lower(u.email) = v_email;

    INSERT INTO public.tasks (
        title, description, client_id, department, region_id, priority, due_date,
        estimated_hours, status, requester_id, requester_name, requester_email
    ) VALUES (
        v_title, v_description, v_client_id, v_department, v_region_id, v_priority, v_due_date,
        v_hours, 'new_request', v_requester_id, v_name, v_email
    )
    RETURNING id INTO v_task_id;

    -- The Work Category picker searches skills, so the answer belongs in task_skills.
    INSERT INTO public.task_skills (task_id, skill_id)
    VALUES (v_task_id, v_category_id)
    ON CONFLICT DO NOTHING;

    -- Tags are find-or-create by name, case-insensitively, same as the internal form.
    FOR v_tag_name IN
        SELECT DISTINCT btrim(elem.tag)
        FROM jsonb_array_elements_text(COALESCE(p_payload->'tags', '[]'::jsonb)) AS elem(tag)
        WHERE btrim(elem.tag) <> ''
    LOOP
        v_tag_name := upper(left(v_tag_name, 1)) || substr(v_tag_name, 2);

        SELECT id INTO v_tag_id FROM public.tags WHERE lower(name) = lower(v_tag_name);
        IF v_tag_id IS NULL THEN
            INSERT INTO public.tags (name, color)
            VALUES (v_tag_name, v_palette[1 + floor(random() * array_length(v_palette, 1))::int])
            RETURNING id INTO v_tag_id;
        END IF;

        INSERT INTO public.task_tags (task_id, tag_id)
        VALUES (v_task_id, v_tag_id)
        ON CONFLICT DO NOTHING;
    END LOOP;

    v_ref := 'REQ-' || upper(left(replace(v_task_id::text, '-', ''), 6));

    INSERT INTO public.request_form_submissions (
        link_id, task_id, requester_name, requester_email, request_ref
    ) VALUES (
        link.id, v_task_id, v_name, v_email, v_ref
    )
    RETURNING id INTO v_submission_id;

    RETURN jsonb_build_object(
        'ok', true,
        'taskId', v_task_id,
        'requestRef', v_ref,
        'submissionId', v_submission_id,
        'sendConfirmation', link.send_confirmation
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_public_request(text, jsonb) TO anon, authenticated;
