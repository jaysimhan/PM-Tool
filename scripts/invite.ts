import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseAdmin = createClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function inviteUser(email: string) {
    console.log(`Inviting ${email}...`);
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: {
            full_name: 'Jaysimhan'
        }
    });

    if (error) {
        console.error('Error inviting user:', error);
    } else {
        console.log('Successfully invited user!', data);
    }
}

inviteUser('jaysimhanps@carestack.com');
