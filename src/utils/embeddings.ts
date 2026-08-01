import type { FeatureExtractionPipeline } from '@huggingface/transformers';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
export const EMBEDDING_DIMENSIONS = 384;

let extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

function getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!extractorPromise) {
        // Imported dynamically, not at module scope: transformers.js is ~1MB of JS and
        // this module is reachable from the always-loaded layout (the skill picker in
        // Preferences), so a static import would put it in the entry bundle.
        extractorPromise = import('@huggingface/transformers').then(
            ({ pipeline }) => pipeline('feature-extraction', MODEL_ID) as Promise<FeatureExtractionPipeline>
        );
    }
    return extractorPromise;
}

// Preloads the model in the background so the first search doesn't pay the download cost.
export function warmEmbeddingModel(): void {
    getExtractor().catch(() => {
        extractorPromise = null;
    });
}

export async function embedText(text: string): Promise<number[]> {
    const extractor = await getExtractor();
    const output = await extractor(text, { pooling: 'mean', normalize: true });
    return Array.from(output.data as Float32Array);
}
