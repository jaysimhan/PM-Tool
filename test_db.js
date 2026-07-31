import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
const envFile = fs.readFileSync('.env', 'utf-8');
let env = {};
envFile.split('\n').forEach(line => {
  if (line.includes('=')) {
    const [k, ...v] = line.split('=');
    env[k] = v.join('=').trim();
  }
});
const supabase = createClient(env['VITE_SUPABASE_URL'], env['VITE_SUPABASE_ANON_KEY']);
supabase.from('tasks').select('*').limit(1).then(res => console.log(Object.keys(res.data[0])));
