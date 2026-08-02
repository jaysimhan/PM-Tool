// Turns the IP addresses on auth.sessions into something a person can recognise.
//
// GoTrue records the IP a session signed in from and nothing else about where it was, so
// "location" has to come from a geo-IP lookup, and that means an outside service. It runs
// here rather than in the browser for two reasons: the free providers are rate-limited per
// caller, which one server handles far better than every tab; and the answer is only ever as
// good as the provider, so keeping it in one place makes it one thing to swap.
//
// The caller must be signed in, and is only ever told about IPs that belong to their own
// sessions -- the JWT is verified and the addresses are re-read from auth.sessions rather
// than trusted from the request body. Otherwise this would be a free geo-IP proxy for anyone
// holding the anon key.
//
// Nothing is stored. If the provider is slow, rate-limited or down, the reply simply has no
// entry for that IP and the UI shows the address on its own.

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

// Survives as long as this worker instance does. Session IPs repeat on every page load, so
// even a short-lived cache keeps the provider out of the hot path.
const cache = new Map<string, { label: string | null; at: number }>();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const isPrivate = (ip: string) =>
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ||
    ip.startsWith('fc') ||
    ip.startsWith('fd');

async function lookup(ip: string): Promise<string | null> {
    const cached = cache.get(ip);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.label;

    let label: string | null = null;
    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`https://ipapi.co/${encodeURIComponent(ip)}/json/`, {
            signal: controller.signal,
            headers: { 'User-Agent': 'workflow-pro-session-locations' },
        });
        clearTimeout(timeout);

        if (res.ok) {
            const body = await res.json();
            if (!body.error) {
                label = [body.city, body.region, body.country_name].filter(Boolean).join(', ') || null;
            }
        }
    } catch {
        label = null;   // Timed out, blocked or rate-limited: the UI just shows the IP.
    }

    cache.set(ip, { label, at: Date.now() });
    return label;
}

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

    const authorization = req.headers.get('Authorization');
    if (!authorization) return json({ error: 'not_signed_in' }, 401);

    // Verified against the project's JWT secret by getUser(), not merely decoded.
    const asCaller = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_ANON_KEY')!,
        { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } },
    );

    const { data: { user }, error: userError } = await asCaller.auth.getUser();
    if (userError || !user) return json({ error: 'not_signed_in' }, 401);

    // Their own sessions, from the database. The request body is not consulted at all.
    const { data: sessions, error: sessionError } = await asCaller.rpc('list_my_sessions');
    if (sessionError) return json({ error: 'lookup_failed', detail: sessionError.message }, 500);

    const ips = Array.from(
        new Set(
            ((sessions ?? []) as Array<{ ip?: string | null }>)
                .map((s) => s.ip)
                .filter((ip): ip is string => !!ip && !isPrivate(ip)),
        ),
    ).slice(0, 10);

    const results = await Promise.all(ips.map(async (ip) => [ip, await lookup(ip)] as const));

    return json({
        locations: Object.fromEntries(results.filter(([, label]) => label !== null)),
    });
});
