import fs from 'fs';
import path from 'path';
import { users, teams, skills } from '../src/data/mockData';

// We need to map our mock string IDs to UUIDs for Postgres
const uuidMap = new Map<string, string>();
let uuidCounter = 1;

function getUuid(id: string): string {
    if (!uuidMap.has(id)) {
        const hex = uuidCounter.toString(16).padStart(12, '0');
        uuidMap.set(id, `00000000-0000-4000-8000-${hex}`);
        uuidCounter++;
    }
    return uuidMap.get(id)!;
}

// Generate SQL
const sql: string[] = [];

sql.push('-- Seed Users');
users.forEach(u => {
    sql.push(`INSERT INTO public.users (id, name, email, role, daily_capacity, is_active) VALUES ('${getUuid(u.id)}', '${u.name.replace(/'/g, "''")}', '${u.email}', '${u.role}', ${u.dailyCapacity}, ${u.isActive});`);
});

sql.push('\n-- Seed Teams');
teams.forEach(t => {
    sql.push(`INSERT INTO public.teams (id, name, description, leader_id, color) VALUES ('${getUuid(t.id)}', '${t.name.replace(/'/g, "''")}', '${t.description.replace(/'/g, "''")}', '${getUuid(t.leaderId)}', '${t.color}');`);
});

sql.push('\n-- Seed Team Memberships');
teams.forEach(t => {
    t.memberIds.forEach(mId => {
        sql.push(`INSERT INTO public.team_memberships (team_id, user_id) VALUES ('${getUuid(t.id)}', '${getUuid(mId)}') ON CONFLICT DO NOTHING;`);
    });
});

sql.push('\n-- Seed Skills');
skills.forEach(s => {
    sql.push(`INSERT INTO public.skills (id, name, category) VALUES ('${getUuid(s.id)}', '${s.name.replace(/'/g, "''")}', '${s.category.replace(/'/g, "''")}');`);
});

sql.push('\n-- Seed Team Skills');
teams.forEach(t => {
    t.skillIds.forEach(sId => {
        sql.push(`INSERT INTO public.team_skills (team_id, skill_id) VALUES ('${getUuid(t.id)}', '${getUuid(sId)}') ON CONFLICT DO NOTHING;`);
    });
});

sql.push('\n-- Seed User Skills');
users.forEach(u => {
    u.skillIds.forEach(sId => {
        sql.push(`INSERT INTO public.user_skills (user_id, skill_id, proficiency_level) VALUES ('${getUuid(u.id)}', '${getUuid(sId)}', 'intermediate') ON CONFLICT DO NOTHING;`);
    });
});

const outPath = path.join(process.cwd(), 'supabase', 'seed.sql');
fs.writeFileSync(outPath, sql.join('\n'));
console.log(`Generated seed.sql at ${outPath}`);
