import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://anxwabquldxsketjrmgg.supabase.co';
const supabaseServiceRoleKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFueHdhYnF1bGR4c2tldGpybWdnIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NTQ3OTc2NiwiZXhwIjoyMTAxMDU1NzY2fQ.12y7zIqCH90Mj89HzFo0xTpz5_GQMs3gbvASBCzQRSE';

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey);

async function test() {
    console.log("Attempting invite...");
    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail('marcomm-user@carestack.com');
    console.log("Data:", data);
    console.log("Error:", error);
}

test();
