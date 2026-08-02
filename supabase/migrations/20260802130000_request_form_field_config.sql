-- "Customize Request Form" rendered twelve toggles, twelve Configure buttons and a Save
-- Configuration button, and not one of them did anything: the toggles were uncontrolled
-- `defaultChecked`, Configure had no handler, and Save fired a toast and closed the modal.
-- The request form itself had no idea the modal existed.
--
-- Making it real needs the field list to be data rather than a literal array in JSX, so
-- this table is the single definition both the internal form and the public share link
-- render from. Three of the fields the modal advertised -- Deliverable Quantity, Target
-- Audience, Brand Guidelines -- had nowhere to be stored at all; tasks.custom_fields is
-- where they and any admin-added field land.
--
-- Category-specific fields are keyed on skills, not work_categories. The modal's dropdown
-- read work_categories, which is empty in this project and is never fetched by the app;
-- the form's "Work Category" picker has always searched skills and writes task_skills. A
-- field scoped to a category nobody can select would be another dead toggle.

-- ---------------------------------------------------------------------------
-- Where the answers to non-column fields go.
-- ---------------------------------------------------------------------------

-- Adding a column per custom field would mean a migration every time an admin adds one,
-- so extra answers live here as {field_key: value}. jsonb, not json, so the key order is
-- normalised and `?` works for lookups; NOT NULL DEFAULT '{}' so readers never branch.
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- The field definitions.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.request_form_fields (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Stable identifier. For core fields it names the tasks column the answer goes to;
    -- for everything else it is the key inside tasks.custom_fields.
    field_key text NOT NULL CHECK (field_key ~ '^[a-z][a-zA-Z0-9_]*$'),

    -- NULL means the field is on the form always. Otherwise it appears only once the
    -- requester picks that work category, and disappears again if they change it.
    skill_id uuid REFERENCES public.skills(id) ON DELETE CASCADE,

    label text NOT NULL CHECK (btrim(label) <> ''),
    placeholder text,
    help_text text,

    field_type text NOT NULL CHECK (field_type IN (
        'text', 'textarea', 'number', 'date', 'select', 'checkbox',
        -- Core-only shapes: the tag chip editor and the semantic category search box.
        -- Admins cannot create these, because a second one would have nothing to write to.
        'tags', 'picker'
    )),
    -- A jsonb array of strings, for field_type = 'select'.
    options jsonb NOT NULL DEFAULT '[]'::jsonb,
    default_value text,

    -- enabled = does it appear on the form at all. required = must it be answered.
    -- The old modal conflated the two: its toggle was wired to the `required` literal.
    enabled boolean NOT NULL DEFAULT true,
    required boolean NOT NULL DEFAULT false,
    position integer NOT NULL DEFAULT 0,

    -- Core fields write to a real tasks column, so they cannot be created or deleted --
    -- only configured. Everything else is a custom field backed by tasks.custom_fields.
    is_core boolean NOT NULL DEFAULT false,
    -- tasks.title is NOT NULL, so that one toggle can never be turned off.
    locked boolean NOT NULL DEFAULT false,

    created_at timestamptz NOT NULL DEFAULT timezone('utc', now()),
    updated_at timestamptz NOT NULL DEFAULT timezone('utc', now()),

    CONSTRAINT request_form_fields_core_is_base CHECK (NOT is_core OR skill_id IS NULL),
    CONSTRAINT request_form_fields_locked_is_core CHECK (NOT locked OR is_core),
    CONSTRAINT request_form_fields_options_is_array CHECK (jsonb_typeof(options) = 'array'),
    -- A dropdown with nothing to drop down is the same dead control this migration exists
    -- to remove. Core selects fill their options from live data instead.
    CONSTRAINT request_form_fields_select_has_options
        CHECK (field_type <> 'select' OR is_core OR jsonb_array_length(options) > 0)
);

-- Two scopes, so two partial uniques: one 'brief' field on the base form, and one per
-- category. NULLs are not distinct-comparable, which is why this cannot be one index.
CREATE UNIQUE INDEX IF NOT EXISTS request_form_fields_base_key_idx
    ON public.request_form_fields (field_key) WHERE skill_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS request_form_fields_scoped_key_idx
    ON public.request_form_fields (skill_id, field_key) WHERE skill_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS request_form_fields_skill_idx
    ON public.request_form_fields (skill_id);

-- ---------------------------------------------------------------------------
-- Seed: exactly the form as it stands today, so installing this changes nothing
-- until an admin actually moves a toggle.
-- ---------------------------------------------------------------------------

INSERT INTO public.request_form_fields
    (field_key, label, placeholder, field_type, enabled, required, position, is_core, locked, default_value)
VALUES
    ('title',          'Request Title',               'E.g., Social media campaign for product launch', 'text',     true,  true,  10,  true,  true,  NULL),
    ('description',    'Description',                 'Provide detailed information about what you need...', 'textarea', true, true, 20, true, false, NULL),
    ('category',       'Work Category',               'Search a category...',                          'picker',   true,  true,  30,  true,  false, NULL),
    ('client',         'Brand',                       'Select a brand',                                'select',   true,  true,  40,  true,  false, NULL),
    ('region',         'Region',                      'Select a region',                               'select',   true,  true,  50,  true,  false, NULL),
    ('department',     'Department',                  'Enter or select department',                    'text',     true,  true,  60,  true,  false, NULL),
    ('priority',       'Priority',                    NULL,                                            'select',   true,  true,  70,  true,  false, 'normal'),
    ('dueDate',        'Due Date',                    NULL,                                            'date',     true,  true,  80,  true,  false, NULL),
    ('estimatedHours', 'Estimated Hours to complete', 'e.g. 5',                                        'number',   true,  false, 90,  true,  false, NULL),
    ('tags',           'Tags',                        'campaign, social-media, q3-launch',             'tags',     true,  false, 100, true,  false, NULL)
ON CONFLICT (field_key) WHERE skill_id IS NULL DO NOTHING;

-- The three the modal listed but never had storage for. Seeded off, so they show up in
-- the modal ready to be switched on rather than silently appearing on the live form.
INSERT INTO public.request_form_fields
    (field_key, label, placeholder, help_text, field_type, enabled, required, position, is_core)
VALUES
    ('deliverableCount', 'Deliverable Quantity', 'e.g. 3',
     'How many individual deliverables this request covers.', 'number', false, false, 110, false),
    ('targetAudience',   'Target Audience',      'e.g. Existing customers in EMEA',
     'Who the work is aimed at.', 'text', false, false, 120, false),
    ('brandGuidelines',  'Brand Guidelines',     'Link to the brand guidelines, or any constraints to follow',
     'Anything the team must follow when producing this.', 'textarea', false, false, 130, false)
ON CONFLICT (field_key) WHERE skill_id IS NULL DO NOTHING;

-- ---------------------------------------------------------------------------
-- Access. Same posture as request_form_links: anon touches nothing directly and
-- reaches the form only through get_public_request_form / submit_public_request.
-- ---------------------------------------------------------------------------

ALTER TABLE public.request_form_fields ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.request_form_fields FROM anon;
REVOKE ALL ON TABLE public.request_form_fields FROM authenticated;
GRANT SELECT ON TABLE public.request_form_fields TO authenticated;

DROP POLICY IF EXISTS "Signed-in users can read form fields" ON public.request_form_fields;
CREATE POLICY "Signed-in users can read form fields"
    ON public.request_form_fields FOR SELECT TO authenticated USING (true);

-- ---------------------------------------------------------------------------
-- Reading the config.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.request_form_field_json(f public.request_form_fields)
    RETURNS jsonb
    LANGUAGE sql IMMUTABLE
    SET search_path TO ''
    AS $$
    SELECT jsonb_build_object(
        'id', f.id,
        'fieldKey', f.field_key,
        'skillId', f.skill_id,
        'label', f.label,
        'placeholder', f.placeholder,
        'helpText', f.help_text,
        'fieldType', f.field_type,
        'options', f.options,
        'defaultValue', f.default_value,
        'enabled', f.enabled,
        'required', f.required,
        'position', f.position,
        'isCore', f.is_core,
        'locked', f.locked
    );
$$;

GRANT EXECUTE ON FUNCTION public.request_form_field_json(public.request_form_fields) TO anon, authenticated;

-- Everything, disabled rows included: this is what the Customize modal edits, and the
-- internal form needs to know a field is off, not merely not hear about it.
CREATE OR REPLACE FUNCTION public.get_request_form_config()
    RETURNS jsonb
    LANGUAGE sql SECURITY DEFINER STABLE
    SET search_path TO ''
    AS $$
    SELECT COALESCE(
        jsonb_agg(public.request_form_field_json(f) ORDER BY f.skill_id NULLS FIRST, f.position, f.label),
        '[]'::jsonb
    )
    FROM public.request_form_fields f
    WHERE auth.uid() IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.get_request_form_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_request_form_config() TO authenticated;

-- ---------------------------------------------------------------------------
-- Saving the config. The modal sends its whole draft and this reconciles against it,
-- so Cancel really does discard and Save really is the only write.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.save_request_form_config(p_fields jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
    entry jsonb;
    v_id uuid;
    v_key text;
    v_skill uuid;
    v_type text;
    v_options jsonb;
    v_label text;
    v_enabled boolean;
    v_required boolean;
    v_kept uuid[] := ARRAY[]::uuid[];
    existing public.request_form_fields;
BEGIN
    IF NOT public.current_user_is_form_admin() THEN
        RAISE EXCEPTION 'Only an admin can change the request form.';
    END IF;

    IF p_fields IS NULL OR jsonb_typeof(p_fields) <> 'array' THEN
        RAISE EXCEPTION 'Expected a list of fields.';
    END IF;

    FOR entry IN SELECT * FROM jsonb_array_elements(p_fields)
    LOOP
        v_id      := nullif(entry->>'id', '')::uuid;
        v_key     := btrim(COALESCE(entry->>'fieldKey', ''));
        v_skill   := nullif(entry->>'skillId', '')::uuid;
        v_label   := btrim(COALESCE(entry->>'label', ''));
        v_type    := COALESCE(entry->>'fieldType', 'text');
        v_options := COALESCE(entry->'options', '[]'::jsonb);
        v_enabled := COALESCE((entry->>'enabled')::boolean, true);
        v_required := COALESCE((entry->>'required')::boolean, false);

        IF v_label = '' THEN
            RAISE EXCEPTION 'Every field needs a label.';
        END IF;
        IF jsonb_typeof(v_options) <> 'array' THEN
            RAISE EXCEPTION 'Options for "%" must be a list.', v_label;
        END IF;

        IF v_id IS NOT NULL THEN
            SELECT * INTO existing FROM public.request_form_fields WHERE id = v_id;
            IF NOT FOUND THEN
                RAISE EXCEPTION 'That field no longer exists -- reopen the form settings and try again.';
            END IF;

            -- Identity is not editable. Letting the key or scope move would silently
            -- orphan every answer already stored under the old key.
            IF existing.is_core AND existing.locked AND NOT v_enabled THEN
                RAISE EXCEPTION '"%" cannot be turned off.', existing.label;
            END IF;
            IF NOT existing.is_core AND v_type NOT IN ('text','textarea','number','date','select','checkbox') THEN
                RAISE EXCEPTION 'Unknown field type: %', v_type;
            END IF;
            IF NOT existing.is_core AND v_type = 'select' AND jsonb_array_length(v_options) = 0 THEN
                RAISE EXCEPTION 'Dropdown "%" needs at least one option.', v_label;
            END IF;

            UPDATE public.request_form_fields SET
                label         = v_label,
                placeholder   = nullif(btrim(COALESCE(entry->>'placeholder', '')), ''),
                help_text     = nullif(btrim(COALESCE(entry->>'helpText', '')), ''),
                -- Core fields render a fixed control, so their type is theirs to keep.
                field_type    = CASE WHEN existing.is_core THEN existing.field_type ELSE v_type END,
                options       = CASE WHEN existing.is_core THEN existing.options ELSE v_options END,
                default_value = nullif(btrim(COALESCE(entry->>'defaultValue', '')), ''),
                enabled       = v_enabled,
                -- A field nobody can see cannot be required, and a locked one -- title,
                -- backed by a NOT NULL column -- cannot stop being.
                required      = CASE WHEN existing.locked THEN true ELSE v_enabled AND v_required END,
                position      = COALESCE((entry->>'position')::integer, existing.position),
                updated_at    = timezone('utc', now())
            WHERE id = v_id;

            v_kept := v_kept || v_id;
        ELSE
            IF v_key !~ '^[a-z][a-zA-Z0-9_]*$' THEN
                RAISE EXCEPTION 'Field key "%" must start with a lowercase letter and contain only letters, numbers or underscores.', v_key;
            END IF;
            IF v_type NOT IN ('text','textarea','number','date','select','checkbox') THEN
                RAISE EXCEPTION 'Unknown field type: %', v_type;
            END IF;
            IF v_type = 'select' AND jsonb_array_length(v_options) = 0 THEN
                RAISE EXCEPTION 'Dropdown "%" needs at least one option.', v_label;
            END IF;
            IF v_skill IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.skills s WHERE s.id = v_skill) THEN
                RAISE EXCEPTION 'That work category no longer exists.';
            END IF;
            IF EXISTS (
                SELECT 1 FROM public.request_form_fields f
                WHERE f.field_key = v_key AND f.skill_id IS NOT DISTINCT FROM v_skill
            ) THEN
                RAISE EXCEPTION 'A field with the key "%" already exists here.', v_key;
            END IF;

            INSERT INTO public.request_form_fields (
                field_key, skill_id, label, placeholder, help_text, field_type, options,
                default_value, enabled, required, position, is_core
            ) VALUES (
                v_key, v_skill, v_label,
                nullif(btrim(COALESCE(entry->>'placeholder', '')), ''),
                nullif(btrim(COALESCE(entry->>'helpText', '')), ''),
                v_type, v_options,
                nullif(btrim(COALESCE(entry->>'defaultValue', '')), ''),
                v_enabled, v_enabled AND v_required,
                COALESCE((entry->>'position')::integer, 500),
                false
            )
            RETURNING id INTO v_id;

            v_kept := v_kept || v_id;
        END IF;
    END LOOP;

    -- Anything custom the draft no longer mentions was removed in the modal. Core rows
    -- are never deleted, so a malformed payload cannot amputate the form.
    DELETE FROM public.request_form_fields f
    WHERE NOT f.is_core AND NOT (f.id = ANY (v_kept));

    RETURN public.get_request_form_config();
END;
$$;

REVOKE ALL ON FUNCTION public.save_request_form_config(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_request_form_config(jsonb) TO authenticated;

-- ---------------------------------------------------------------------------
-- The public form now renders from the same config.
-- ---------------------------------------------------------------------------

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
        ),
        -- Only the enabled ones. A disabled field is not "hidden by CSS" out here; the
        -- visitor is never told it exists, and submit_public_request would reject it.
        'fields', (
            SELECT COALESCE(jsonb_agg(public.request_form_field_json(f)
                ORDER BY f.skill_id NULLS FIRST, f.position, f.label), '[]'::jsonb)
            FROM public.request_form_fields f
            WHERE f.enabled
        )
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_request_form(text) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- Submitting through the public link, now validated against the config rather than
-- against a list of rules hardcoded here. The client-side form is still only advice.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_public_request(p_token text, p_payload jsonb)
    RETURNS jsonb
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
    on_priority    boolean; req_priority    boolean;
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
    req_priority    := COALESCE((cfg_req->>'priority')::boolean, true);
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
$$;

GRANT EXECUTE ON FUNCTION public.submit_public_request(text, jsonb) TO anon, authenticated;
