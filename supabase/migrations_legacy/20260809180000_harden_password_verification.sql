-- SECURITY DEFINER functions must not resolve objects through a caller-influenced schema.
-- `verify_current_password` previously searched `public`; qualify crypt() and pin the path.

CREATE OR REPLACE FUNCTION public.verify_current_password(p_password text)
    RETURNS boolean
    LANGUAGE plpgsql STABLE SECURITY DEFINER
    SET search_path TO ''
AS $$
DECLARE
    v_hash text;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'You must be signed in.';
    END IF;

    IF coalesce(p_password, '') = '' THEN
        RETURN false;
    END IF;

    SELECT encrypted_password INTO v_hash FROM auth.users WHERE id = auth.uid();
    IF coalesce(v_hash, '') = '' THEN
        RETURN false;
    END IF;

    RETURN extensions.crypt(p_password, v_hash) = v_hash;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_current_password(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_current_password(text) TO authenticated;
