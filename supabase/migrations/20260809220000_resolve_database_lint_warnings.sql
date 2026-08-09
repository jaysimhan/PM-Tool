CREATE OR REPLACE FUNCTION public.consume_onboarding_temp_password(p_email text, p_temp_password text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_user auth.users%ROWTYPE;
    v_credential public.onboarding_temp_passwords%ROWTYPE;
    v_attempts integer;
BEGIN
    SELECT au.* INTO v_user
    FROM auth.users au
    WHERE lower(au.email) = lower(trim(coalesce(p_email, '')))
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
    END IF;

    PERFORM 1
    FROM public.users u
    WHERE u.id = v_user.id
      AND u.is_active
      AND u.deleted_at IS NULL
      AND NOT u.onboarding_completed
      AND u.role IN ('invitee', 'requester');

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
    END IF;

    SELECT * INTO v_credential
    FROM public.onboarding_temp_passwords otp
    WHERE otp.user_id = v_user.id
    FOR UPDATE;

    IF NOT FOUND
       OR v_credential.consumed_at IS NOT NULL
       OR v_credential.expires_at <= timezone('utc', now())
       OR v_credential.locked_until > timezone('utc', now()) THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
    END IF;

    IF extensions.crypt(coalesce(p_temp_password, ''), v_credential.password_hash)
       <> v_credential.password_hash THEN
        v_attempts := v_credential.failed_attempts + 1;
        UPDATE public.onboarding_temp_passwords
        SET failed_attempts = CASE WHEN v_attempts >= 5 THEN 0 ELSE v_attempts END,
            locked_until = CASE
                WHEN v_attempts >= 5 THEN timezone('utc', now()) + interval '15 minutes'
                ELSE NULL
            END,
            updated_at = timezone('utc', now())
        WHERE user_id = v_user.id;
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_credentials');
    END IF;

    UPDATE public.onboarding_temp_passwords
    SET consumed_at = timezone('utc', now()),
        failed_attempts = 0,
        locked_until = NULL,
        updated_at = timezone('utc', now())
    WHERE user_id = v_user.id;

    INSERT INTO public.onboarding_temp_password_events (user_id, event_type, actor_id)
    VALUES (v_user.id, 'consumed', v_user.id);

    RETURN jsonb_build_object(
        'ok', true,
        'userId', v_user.id,
        'email', lower(v_user.email),
        'teamId', v_user.raw_user_meta_data->>'team_id'
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.request_access(p_name text, p_email text, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    v_name text;
    v_email text;
    v_note text;
    v_notified integer;
    v_existing public.users;
    v_kind text := 'access';
    v_user_id uuid := NULL;
    v_context text := '';
BEGIN
    v_name  := nullif(btrim(p_name), '');
    v_email := lower(nullif(btrim(p_email), ''));
    v_note  := nullif(btrim(p_note), '');

    IF v_name IS NULL THEN
        RAISE EXCEPTION 'Your name is required.';
    END IF;
    IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION 'A valid email address is required.';
    END IF;
    IF length(v_note) > 1000 THEN
        RAISE EXCEPTION 'Please keep your message under 1000 characters.';
    END IF;

    IF (SELECT count(*) FROM public.access_requests r
        WHERE lower(r.email) = v_email AND r.created_at > now() - interval '24 hours') >= 3 THEN
        RAISE EXCEPTION 'You have already requested access recently. An admin will be in touch.';
    END IF;
    IF (SELECT count(*) FROM public.access_requests r
        WHERE r.created_at > now() - interval '1 hour') >= 50 THEN
        RAISE EXCEPTION 'Too many access requests right now. Please try again later.';
    END IF;

    -- deleted_email as well as email: deleting an account moves the address aside, and that is
    -- the address the person will type.
    SELECT * INTO v_existing FROM public.users u
    WHERE lower(u.email) = v_email OR lower(u.deleted_email) = v_email
    LIMIT 1;

    IF v_existing.id IS NOT NULL THEN
        v_user_id := v_existing.id;
        IF v_existing.deleted_at IS NOT NULL OR NOT v_existing.is_active THEN
            -- What they are asking for is reactivation, whichever door they came through.
            v_kind := 'reactivation';
            v_context := ' Their account already exists and is '
                || CASE WHEN v_existing.deleted_at IS NOT NULL THEN 'deleted' ELSE 'deactivated' END || '.';
        ELSIF NOT v_existing.onboarding_completed THEN
            v_context := ' They were approved already but have not finished setup — send them the'
                || ' setup link again, or point them at it and let them ask for a fresh code.';
        ELSE
            v_context := ' They already have an active account, so they are probably stuck signing in'
                || ' rather than waiting to be let in.';
        END IF;
    END IF;

    INSERT INTO public.access_requests (kind, user_id, name, email, note)
    VALUES (v_kind, v_user_id, COALESCE(NULLIF(v_existing.name, ''), v_name), v_email, v_note);

    INSERT INTO public.notifications (user_id, type, title, message, link)
    SELECT
        a.id,
        'access_request',
        CASE WHEN v_kind = 'reactivation' THEN 'Reactivation requested' ELSE 'Access requested' END,
        v_name || ' (' || v_email || ') asked for access.'
            || COALESCE(NULLIF(v_context, ''), ' An admin needs to approve them.'),
        '/team-management'
    FROM public.access_request_audience() a;

    GET DIAGNOSTICS v_notified = ROW_COUNT;

    -- Same shape for every caller. Whether the address was known is not in here.
    RETURN jsonb_build_object('ok', true, 'notified', v_notified);
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_public_request(p_token text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
    link public.request_form_links;
    fld public.request_form_fields;

    -- Core field settings, keyed by field_key. Read once so each check below is a lookup
    -- rather than ten more round trips into the table.
    cfg_on  jsonb;
    cfg_req jsonb;

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
    v_custom jsonb := '{}'::jsonb;

    v_raw jsonb;
    v_val jsonb;
    v_text text;
    v_num numeric;
    v_bool boolean;
    v_date date;

    v_requester_id uuid;
    v_task_id uuid;
    v_ref text;
    v_submission_id uuid;
    v_tag_name text;
    v_tag_id uuid;
    v_palette text[] := ARRAY['#3b82f6','#ef4444','#10b981','#f59e0b','#8b5cf6','#ec4899','#06b6d4','#14b8a6','#6366f1','#f43f5e'];

    -- Helper predicates, assigned right after cfg_on/cfg_req are loaded. A field with no
    -- row at all defaults to on, so a half-applied migration degrades to the old form.
    on_description boolean; req_description boolean;
    on_category    boolean; req_category    boolean;
    on_client      boolean; req_client      boolean;
    on_region      boolean; req_region      boolean;
    on_department  boolean; req_department  boolean;
    on_priority    boolean;
    on_due         boolean; req_due         boolean;
    on_hours       boolean; req_hours       boolean;
    on_tags        boolean;
BEGIN
    SELECT * INTO link FROM public.request_form_links WHERE token = p_token;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This request link is not valid.';
    END IF;
    IF NOT link.public_access THEN
        RAISE EXCEPTION 'This form is not accepting requests right now.';
    END IF;

    SELECT
        COALESCE(jsonb_object_agg(f.field_key, f.enabled), '{}'::jsonb),
        COALESCE(jsonb_object_agg(f.field_key, f.enabled AND f.required), '{}'::jsonb)
    INTO cfg_on, cfg_req
    FROM public.request_form_fields f
    WHERE f.is_core AND f.skill_id IS NULL;

    on_description := COALESCE((cfg_on ->>'description')::boolean, true);
    on_category    := COALESCE((cfg_on ->>'category')::boolean, true);
    on_client      := COALESCE((cfg_on ->>'client')::boolean, true);
    on_region      := COALESCE((cfg_on ->>'region')::boolean, true);
    on_department  := COALESCE((cfg_on ->>'department')::boolean, true);
    on_priority    := COALESCE((cfg_on ->>'priority')::boolean, true);
    on_due         := COALESCE((cfg_on ->>'dueDate')::boolean, true);
    on_hours       := COALESCE((cfg_on ->>'estimatedHours')::boolean, true);
    on_tags        := COALESCE((cfg_on ->>'tags')::boolean, true);

    req_description := COALESCE((cfg_req->>'description')::boolean, true);
    req_category    := COALESCE((cfg_req->>'category')::boolean, true);
    req_client      := COALESCE((cfg_req->>'client')::boolean, true);
    req_region      := COALESCE((cfg_req->>'region')::boolean, true);
    req_department  := COALESCE((cfg_req->>'department')::boolean, true);
    req_due         := COALESCE((cfg_req->>'dueDate')::boolean, true);
    req_hours       := COALESCE((cfg_req->>'estimatedHours')::boolean, false);

    -- Name and email are not configurable: without them nobody can be told what happened
    -- to the request, and the per-address rate limit has nothing to count.
    v_name  := nullif(btrim(p_payload->>'requesterName'), '');
    v_email := lower(nullif(btrim(p_payload->>'requesterEmail'), ''));
    IF v_name IS NULL THEN RAISE EXCEPTION 'Your name is required.'; END IF;
    IF v_email IS NULL OR v_email !~ '^[^@[:space:]]+@[^@[:space:].]+\.[^@[:space:]]+$' THEN
        RAISE EXCEPTION 'A valid email address is required.';
    END IF;

    -- tasks.title is NOT NULL, which is why this one field has no toggle.
    v_title := nullif(btrim(p_payload->>'title'), '');
    IF v_title IS NULL THEN RAISE EXCEPTION 'A request title is required.'; END IF;

    IF on_description THEN
        v_description := nullif(btrim(p_payload->>'description'), '');
        IF v_description IS NULL AND req_description THEN
            RAISE EXCEPTION 'A description is required.';
        END IF;
    END IF;

    IF on_department THEN
        v_department := nullif(btrim(p_payload->>'department'), '');
        IF v_department IS NULL AND req_department THEN
            RAISE EXCEPTION 'A department is required.';
        END IF;
    END IF;

    IF on_priority THEN
        v_priority := COALESCE(nullif(btrim(p_payload->>'priority'), ''), 'normal');
        IF v_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
            RAISE EXCEPTION 'Unknown priority: %', v_priority;
        END IF;
    ELSE
        -- Off means the requester was not asked, not that the task has no priority.
        v_priority := 'normal';
    END IF;

    -- Foreign keys come from the client, so each is checked against the same lists
    -- get_public_request_form handed out rather than trusted into the insert. The shape
    -- is checked before the cast so a hand-crafted payload gets the form's own wording
    -- back instead of a raw 'invalid input syntax for type uuid'.
    IF on_client THEN
        IF COALESCE(p_payload->>'clientId', '') ~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' THEN
            v_client_id := (p_payload->>'clientId')::uuid;
            IF NOT EXISTS (SELECT 1 FROM public.clients c WHERE c.id = v_client_id) THEN
                RAISE EXCEPTION 'Select a brand.';
            END IF;
        ELSIF req_client THEN
            RAISE EXCEPTION 'Select a brand.';
        END IF;
    END IF;

    IF on_region THEN
        IF COALESCE(p_payload->>'regionId', '') ~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' THEN
            v_region_id := (p_payload->>'regionId')::uuid;
            IF NOT EXISTS (SELECT 1 FROM public.regions r WHERE r.id = v_region_id) THEN
                RAISE EXCEPTION 'Select a region.';
            END IF;
        ELSIF req_region THEN
            RAISE EXCEPTION 'Select a region.';
        END IF;
    END IF;

    IF on_category THEN
        IF COALESCE(p_payload->>'categoryId', '') ~ '^[0-9a-fA-F]{8}-([0-9a-fA-F]{4}-){3}[0-9a-fA-F]{12}$' THEN
            v_category_id := (p_payload->>'categoryId')::uuid;
            IF NOT EXISTS (SELECT 1 FROM public.skills s WHERE s.id = v_category_id) THEN
                RAISE EXCEPTION 'Select a work category.';
            END IF;
        ELSIF req_category THEN
            RAISE EXCEPTION 'Select a work category.';
        END IF;
    END IF;

    IF on_due THEN
        BEGIN
            v_due_date := nullif(btrim(p_payload->>'dueDate'), '')::timestamptz;
        EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'A valid due date is required.';
        END;
        IF v_due_date IS NULL AND req_due THEN
            RAISE EXCEPTION 'A due date is required.';
        END IF;
    END IF;

    IF on_hours THEN
        BEGIN
            v_hours := nullif(btrim(p_payload->>'estimatedHours'), '')::numeric;
        EXCEPTION WHEN others THEN
            RAISE EXCEPTION 'Estimated hours must be a number.';
        END;
        IF v_hours IS NULL AND req_hours THEN
            RAISE EXCEPTION 'Estimated hours are required.';
        END IF;
        IF v_hours IS NOT NULL AND (v_hours <= 0 OR v_hours > 10000) THEN
            RAISE EXCEPTION 'Estimated hours must be between 0 and 10000.';
        END IF;
    END IF;

    -- Custom fields: the base extras plus whatever is scoped to the chosen category.
    -- Anything else in p_payload->'customFields' is dropped rather than stored, so the
    -- shape of tasks.custom_fields is decided here and not by the caller.
    FOR fld IN
        SELECT * FROM public.request_form_fields f
        WHERE f.enabled AND NOT f.is_core
          AND (f.skill_id IS NULL OR f.skill_id = v_category_id)
        ORDER BY f.position, f.label
    LOOP
        v_raw := p_payload->'customFields'->fld.field_key;

        IF v_raw IS NULL
           OR jsonb_typeof(v_raw) = 'null'
           OR (jsonb_typeof(v_raw) = 'string' AND btrim(v_raw #>> '{}') = '') THEN
            IF fld.required THEN
                RAISE EXCEPTION '% is required.', fld.label;
            END IF;
            CONTINUE;
        END IF;

        IF fld.field_type = 'number' THEN
            BEGIN
                v_num := (btrim(v_raw #>> '{}'))::numeric;
            EXCEPTION WHEN others THEN
                RAISE EXCEPTION '% must be a number.', fld.label;
            END;
            v_val := to_jsonb(v_num);
        ELSIF fld.field_type = 'checkbox' THEN
            BEGIN
                v_bool := (btrim(v_raw #>> '{}'))::boolean;
            EXCEPTION WHEN others THEN
                RAISE EXCEPTION '% must be yes or no.', fld.label;
            END;
            IF fld.required AND NOT v_bool THEN
                RAISE EXCEPTION '% is required.', fld.label;
            END IF;
            v_val := to_jsonb(v_bool);
        ELSIF fld.field_type = 'date' THEN
            BEGIN
                v_date := (btrim(v_raw #>> '{}'))::date;
            EXCEPTION WHEN others THEN
                RAISE EXCEPTION '% must be a valid date.', fld.label;
            END;
            v_val := to_jsonb(v_date::text);
        ELSIF fld.field_type = 'select' THEN
            v_text := btrim(v_raw #>> '{}');
            IF NOT (fld.options ? v_text) THEN
                RAISE EXCEPTION 'Choose one of the listed options for %.', fld.label;
            END IF;
            v_val := to_jsonb(v_text);
        ELSE
            v_text := btrim(v_raw #>> '{}');
            IF length(v_text) > 5000 THEN
                RAISE EXCEPTION '% is too long (5000 characters maximum).', fld.label;
            END IF;
            v_val := to_jsonb(v_text);
        END IF;

        v_custom := v_custom || jsonb_build_object(fld.field_key, v_val);
    END LOOP;

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
        estimated_hours, status, requester_id, requester_name, requester_email, custom_fields
    ) VALUES (
        v_title, v_description, v_client_id, v_department, v_region_id, v_priority, v_due_date,
        v_hours, 'new_request', v_requester_id, v_name, v_email, v_custom
    )
    RETURNING id INTO v_task_id;

    -- The Work Category picker searches skills, so the answer belongs in task_skills.
    IF v_category_id IS NOT NULL THEN
        INSERT INTO public.task_skills (task_id, skill_id)
        VALUES (v_task_id, v_category_id)
        ON CONFLICT DO NOTHING;
    END IF;

    -- Tags are find-or-create by name, case-insensitively, same as the internal form.
    IF on_tags THEN
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
    END IF;

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
$function$;
