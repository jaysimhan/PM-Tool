const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);

async function test() {
  // Login first? Wait, we need an authenticated user to delete.
  // Actually, I can use the SERVICE_ROLE_KEY to bypass RLS, but the issue might be RLS related.
  // Let's first test with anon key. But without a session, delete will fail.
  console.log("Using anon key");
  const { data: tag, error: insertError } = await supabase.from('tags').insert([{ name: 'test_tag_' + Date.now(), color: '#000000' }]).select().single();
  if (insertError) {
      console.log('Insert error:', insertError);
      return;
  }
  console.log('Inserted tag:', tag);
  
  const { error: deleteError } = await supabase.from('tags').delete().eq('id', tag.id);
  if (deleteError) {
      console.log('Delete error:', deleteError);
  } else {
      console.log('Deleted successfully!');
  }
}

test();
