import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { embedText } from '../src/utils/embeddings';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.VITE_SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('Missing Supabase credentials in .env');
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function main() {
    const { data: skills, error } = await supabase
        .from('skills')
        .select('id, name, category, embedding');

    if (error) {
        console.error('Failed to fetch skills:', error);
        process.exit(1);
    }

    const pending = (skills || []).filter(s => !s.embedding);
    console.log(`${pending.length} of ${skills?.length ?? 0} skills need an embedding.`);

    for (const skill of pending) {
        const embedding = await embedText(`${skill.name} (${skill.category})`);
        const { error: updateError } = await supabase
            .from('skills')
            .update({ embedding })
            .eq('id', skill.id);

        if (updateError) {
            console.error(`Failed to update "${skill.name}":`, updateError);
        } else {
            console.log(`Embedded "${skill.name}"`);
        }
    }

    console.log('Done.');
}

main();
