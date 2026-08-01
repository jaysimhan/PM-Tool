-- Semantic ("closest related skill") search over public.skills using pgvector.
-- Embeddings are computed client-side (transformers.js, Xenova/all-MiniLM-L6-v2, 384 dims) --
-- this migration only adds storage + a nearest-neighbor match function. No external
-- embedding API or key is involved.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

SET search_path = public, extensions;

ALTER TABLE public.skills ADD COLUMN IF NOT EXISTS embedding extensions.vector(384);

CREATE OR REPLACE FUNCTION public.match_skills(query_embedding extensions.vector(384), match_count INT DEFAULT 8)
RETURNS TABLE (id UUID, name TEXT, category TEXT, similarity FLOAT)
LANGUAGE sql STABLE
AS $$
    SELECT s.id, s.name, s.category, 1 - (s.embedding <=> query_embedding) AS similarity
    FROM public.skills s
    WHERE s.embedding IS NOT NULL
    ORDER BY s.embedding <=> query_embedding
    LIMIT match_count;
$$;

GRANT EXECUTE ON FUNCTION public.match_skills(extensions.vector(384), INT) TO anon, authenticated;
