type OperationalArea =
    | 'frontend_crash'
    | 'data_query'
    | 'task_mutation'
    | 'assignment_conflict'
    | 'invite_generation'
    | 'edge_authorization'
    | 'dashboard_rpc'
    | 'search_model'
    | 'chunk_load';

type SafeContext = Record<string, string | number | boolean | null | undefined>;

/**
 * Sends only an event category, an error class/code, and explicitly supplied non-sensitive
 * dimensions. Messages, URLs, task text, email addresses, tokens, and request payloads are
 * deliberately excluded.
 */
export function captureOperationalError(area: OperationalArea, error: unknown, context: SafeContext = {}) {
    const candidate = error as { name?: unknown; code?: unknown; status?: unknown } | null;
    const event = {
        area,
        errorName: typeof candidate?.name === 'string' ? candidate.name.slice(0, 80) : 'Error',
        errorCode: typeof candidate?.code === 'string' ? candidate.code.slice(0, 40) : undefined,
        status: typeof candidate?.status === 'number' ? candidate.status : undefined,
        context,
        occurredAt: new Date().toISOString(),
    };

    if (import.meta.env.DEV) console.error('[operational-event]', event);
    const endpoint = import.meta.env.VITE_OBSERVABILITY_ENDPOINT;
    if (!endpoint || typeof navigator === 'undefined') return;
    navigator.sendBeacon(endpoint, new Blob([JSON.stringify(event)], { type: 'application/json' }));
}

export function recordOperationalTiming(area: Extract<OperationalArea, 'dashboard_rpc'>, durationMs: number, context: SafeContext = {}) {
    if (durationMs < 1_000) return;
    captureOperationalError(area, { name: 'SlowOperation' }, { ...context, durationMs: Math.round(durationMs) });
}
