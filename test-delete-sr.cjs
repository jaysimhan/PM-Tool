const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_SERVICE_ROLE_KEY);

async function test() {
  console.log("Fetching tags...");
  const { data: tags, error: fetchError } = await supabase.from('tags').select('*');
  if (fetchError) {
      console.log('Fetch error:', fetchError);
      return;
  }
  
  if (tags.length === 0) {
      console.log("No tags found");
      return;
  }
  
  const tag = tags[0];
  console.log("Attempting to delete tag:", tag);
  
  const { data, error: deleteError } = await supabase.from('tags').delete().eq('id', tag.id);
  
  console.log("Delete result:", data, "Error:", deleteError);
  
  // Restore the tag
  await supabase.from('tags').insert({ id: tag.id, name: tag.name, color: tag.color });
  console.log("Tag restored");
}

test();
