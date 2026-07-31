import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.VITE_SUPABASE_URL!, process.env.VITE_SUPABASE_ANON_KEY!);

async function seed() {
    console.log('Seeding initial user...');
    const { data, error } = await supabase.from('users').insert({
        name: 'Admin User',
        email: 'admin@example.com',
        role: 'super_admin',
        daily_capacity: 8,
        is_active: true
    }).select();

    if (error) {
        console.error('Error seeding user:', error);
    } else {
        console.log('Successfully seeded user:', data);
    }
}

seed();
