import { createClient } from '@supabase/supabase-js';

import * as dotenv from 'dotenv';
import { differenceInBusinessDays, addDays, isWeekend, parseISO, format } from 'date-fns';

// Load environment variables from .env
dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || '';
// Use service role key to bypass RLS for backend sync operations
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';
const ASANA_ACCESS_TOKEN = process.env.ASANA_ACCESS_TOKEN || '';
const ASANA_WORKSPACE_GID = process.env.ASANA_WORKSPACE_GID || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Missing Supabase credentials in .env');
  process.exit(1);
}

if (!ASANA_ACCESS_TOKEN || !ASANA_WORKSPACE_GID) {
  console.warn('⚠️ Missing ASANA_ACCESS_TOKEN or ASANA_WORKSPACE_GID. Running in mock mode is not supported in this version. Please add credentials to .env to perform a real sync.');
  process.exit(0);
}

// Initialize Supabase client
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Helper function to fetch from Asana API
async function fetchAsana(endpoint: string, params: Record<string, string> = {}) {
  const url = new URL(`https://app.asana.com/api/1.0${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.append(key, value));
  
  const response = await fetch(url.toString(), {
    headers: {
      'Authorization': `Bearer ${ASANA_ACCESS_TOKEN}`,
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Asana API error: ${response.status} ${response.statusText} - ${errorText}`);
  }
  
  return response.json();
}

async function syncAsana() {
  console.log('🚀 Starting Asana sync process...');
  const syncStartTime = new Date();
  let tasksReceived = 0;
  let tasksUpserted = 0;
  
  try {
    // 1. Fetch Users from Asana and Map Them
    console.log('👥 Fetching workspace users from Asana...');
    const usersResponse = await fetchAsana(`/workspaces/${ASANA_WORKSPACE_GID}/users`, {
      opt_fields: 'name,email'
    });
    const asanaUsers = usersResponse.data;

    for (const user of asanaUsers) {
      // Check if user exists in Supabase
      const { data: existingUser } = await supabase
        .from('users')
        .select('id')
        .eq('email', user.email)
        .single();

      // Upsert Asana mapping
      await supabase.from('asana_user_mappings').upsert({
        asana_user_gid: user.gid,
        asana_name: user.name,
        asana_email: user.email,
        employee_id: existingUser ? existingUser.id : null,
        mapping_status: existingUser ? 'mapped' : 'unmapped',
        updated_at: new Date().toISOString()
      }, { onConflict: 'asana_user_gid' });
    }
    console.log(`✅ Synced ${asanaUsers.length} users.`);

    // 2. Fetch Tasks from Asana
    console.log('📋 Fetching incomplete tasks from Asana workspace...');
    
    // Using task search endpoint for the workspace
    const tasksResponse = await fetchAsana(`/workspaces/${ASANA_WORKSPACE_GID}/tasks/search`, {
      'completed': 'false',
      'is_subtask': 'false',
      opt_fields: 'name,assignee,start_on,due_on,completed,custom_fields,permalink_url'
    });
    
    const asanaTasks = tasksResponse.data;
    tasksReceived = asanaTasks.length;
    console.log(`📥 Received ${tasksReceived} tasks.`);

    for (const task of asanaTasks) {
      // Extract estimated hours from custom fields (assuming a custom field named "Estimated Hours")
      let estimatedHours = null;
      if (task.custom_fields) {
        const hoursField = task.custom_fields.find((f: any) => f.name.toLowerCase().includes('estimated hours') || f.name.toLowerCase().includes('hours'));
        if (hoursField && hoursField.number_value) {
          estimatedHours = hoursField.number_value;
        }
      }

      // We need both start_on and due_on to calculate workload
      // If start_on is missing, assume it starts on due_on
      const startDateStr = task.start_on || task.due_on;
      const dueDateStr = task.due_on;

      // 3. Upsert Task in Supabase
      const { data: savedTask, error: taskError } = await supabase.from('asana_tasks').upsert({
        asana_gid: task.gid,
        name: task.name,
        assignee_asana_gid: task.assignee ? task.assignee.gid : null,
        start_date: startDateStr,
        due_date: dueDateStr,
        estimated_hours: estimatedHours,
        completed: task.completed,
        permalink_url: task.permalink_url,
        last_synced_at: new Date().toISOString()
      }, { onConflict: 'asana_gid' }).select('id').single();

      if (taskError) {
        console.error(`❌ Error saving task ${task.gid}:`, taskError);
        continue;
      }
      tasksUpserted++;

      // 4. Calculate and Upsert Workload Allocations
      if (savedTask && task.assignee && startDateStr && dueDateStr && estimatedHours) {
        // Find internal employee_id from mapping
        const { data: mapping } = await supabase
          .from('asana_user_mappings')
          .select('employee_id')
          .eq('asana_user_gid', task.assignee.gid)
          .single();

        if (mapping && mapping.employee_id) {
          const employeeId = mapping.employee_id;
          const startDate = parseISO(startDateStr);
          const dueDate = parseISO(dueDateStr);
          
          // Calculate total business days
          let businessDays = differenceInBusinessDays(addDays(dueDate, 1), startDate);
          if (businessDays <= 0) businessDays = 1; // Fallback to 1 if same day

          const hoursPerDay = estimatedHours / businessDays;

          // Generate daily allocations
          let currentDate = startDate;
          while (currentDate <= dueDate) {
            if (!isWeekend(currentDate)) {
              const formattedDate = format(currentDate, 'yyyy-MM-dd');
              
              await supabase.from('workload_allocations').upsert({
                task_id: savedTask.id,
                employee_id: employeeId,
                allocation_date: formattedDate,
                allocated_hours: hoursPerDay,
                daily_capacity: 10, // Default capacity, could pull from users table
                calculated_at: new Date().toISOString()
              }, { onConflict: 'task_id,employee_id,allocation_date' });
            }
            currentDate = addDays(currentDate, 1);
          }
        }
      }
    }

    console.log(`✅ Successfully processed ${tasksUpserted} tasks.`);

    // 5. Log the Sync Event
    await supabase.from('asana_sync_logs').insert({
      sync_type: 'scheduled',
      tasks_received: tasksReceived,
      tasks_upserted: tasksUpserted,
      started_at: syncStartTime.toISOString(),
      completed_at: new Date().toISOString(),
      status: 'success'
    });

  } catch (error) {
    console.error('❌ Sync failed:', error);
    
    // Log failure
    await supabase.from('asana_sync_logs').insert({
      sync_type: 'scheduled',
      started_at: syncStartTime.toISOString(),
      completed_at: new Date().toISOString(),
      status: 'failed',
      errors: error instanceof Error ? error.message : String(error)
    });
  }
}

syncAsana();
