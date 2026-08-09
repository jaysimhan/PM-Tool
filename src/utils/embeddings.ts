import type { FeatureExtractionPipeline } from '@huggingface/transformers';
import { captureOperationalError } from '../lib/observability';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMENSIONS = 384;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function semanticSearchAllowed(): boolean {
    if (typeof navigator === 'undefined') return true;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    return !connection?.saveData && connection?.effectiveType !== '2g' && connection?.effectiveType !== 'slow-2g' && !(memory && memory < 4);
}

function getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!semanticSearchAllowed()) return Promise.reject(Object.assign(new Error('Semantic search is disabled on this device.'), { code: 'CONSTRAINED_DEVICE' }));
    if (!extractorPromise) {
        // Imported dynamically, not at module scope: transformers.js is ~1MB of JS and
        // this module is reachable from the always-loaded layout (the skill picker in
        // Preferences), so a static import would put it in the entry bundle.
        const startedAt = performance.now();
        extractorPromise = import('@huggingface/transformers')
            .then(({ pipeline }) => pipeline('feature-extraction', MODEL_ID) as Promise<FeatureExtractionPipeline>)
            .then(extractor => {
                const durationMs = Math.round(performance.now() - startedAt);
                if (durationMs > 5_000) captureOperationalError('search_model', { name: 'SlowModelLoad' }, { durationMs });
                return extractor;
            })
            .catch(error => {
                extractorPromise = null;
                captureOperationalError('search_model', error);
                throw error;
            });
    }
    return extractorPromise;
}

// Preloads the model in the background so the first search doesn't pay the download cost.
export function warmEmbeddingModel(): void {
    if (!semanticSearchAllowed()) return;
    getExtractor().catch(() => {
        extractorPromise = null;
    });
}

export async function embedText(text: string): Promise<number[]> {
    const extractor = await getExtractor();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
}
