/**
 * Seed real demo peer accounts for the Social Gamification feature.
 *
 * Creates ~14 demo auth users (email <slug>@learnstation-demo.com), enriches
 * their profiles (institution, social_roles, XP, streak), logs a week of
 * xp_events, enrolls them in a sample of real courses, and wires a few
 * inter-peer friendships so mutual-friend counts are real.
 *
 * Idempotent: re-running reuses existing accounts and upserts their data.
 *
 * Usage:  node scripts/seed-social.mjs
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment (.env).
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

// --- load .env (simple parser; avoids extra deps) ---------------------------
function loadEnv() {
  try {
    const txt = readFileSync(new URL("../.env", import.meta.url), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    /* ignore */
  }
}
loadEnv();

const URL_ = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const db = createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const DOMAIN = "learnstation-demo.com";

// Mirror of the front-end demo roster (data.ts).
const PEERS = [
  { slug: "layla",  name: "Layla M.",  institution: "TU München",          roles: ["Student"],                 xp: 3180, level: 9,  streak: 21, online: true,  weekly: 680 },
  { slug: "jonas",  name: "Jonas K.",  institution: "RWTH Aachen",         roles: ["Student", "Tutor"],        xp: 2510, level: 7,  streak: 5,  online: false, weekly: 290 },
  { slug: "sofia",  name: "Sofia R.",  institution: "Uni Heidelberg",      roles: ["Self-learner"],            xp: 1980, level: 6,  streak: 9,  online: true,  weekly: 520 },
  { slug: "mateo",  name: "Mateo G.",  institution: null,                  roles: ["Self-learner"],            xp: 1620, level: 5,  streak: 3,  online: false, weekly: 210 },
  { slug: "hannah", name: "Hannah W.", institution: "LMU München",         roles: ["Student"],                 xp: 2200, level: 6,  streak: 8,  online: true,  weekly: 470 },
  { slug: "emma",   name: "Emma L.",   institution: "Goethe Uni Frankfurt",roles: ["Student"],                 xp: 1750, level: 5,  streak: 4,  online: false, weekly: 400 },
  { slug: "noah",   name: "Noah F.",   institution: "TU München",          roles: ["Student", "Tutor"],        xp: 2950, level: 8,  streak: 15, online: true,  weekly: 610 },
  { slug: "yuki",   name: "Yuki T.",   institution: "Uni Heidelberg",      roles: ["Researcher", "Self-learner"], xp: 4100, level: 11, streak: 30, online: true,  weekly: 720 },
  { slug: "lukas",  name: "Lukas B.",  institution: "Uni Marburg",         roles: ["Student"],                 xp: 2100, level: 6,  streak: 6,  online: false, weekly: 330 },
  { slug: "amelie", name: "Amélie D.", institution: "RWTH Aachen",         roles: ["Student"],                 xp: 2680, level: 7,  streak: 11, online: true,  weekly: 480 },
  { slug: "omar",   name: "Omar S.",   institution: null,                  roles: ["Self-learner"],            xp: 1450, level: 4,  streak: 2,  online: false, weekly: 260 },
  { slug: "clara",  name: "Clara N.",  institution: "LMU München",         roles: ["Student", "Tutor"],        xp: 3320, level: 9,  streak: 18, online: true,  weekly: 590 },
  { slug: "finn",   name: "Finn H.",   institution: "Goethe Uni Frankfurt",roles: ["Student"],                 xp: 1890, level: 5,  streak: 1,  online: false, weekly: 140 },
  { slug: "priya",  name: "Priya K.",  institution: "Uni Heidelberg",      roles: ["Researcher"],              xp: 3870, level: 10, streak: 25, online: true,  weekly: 700 },
];

// Accepted friendships among peers (so mutual-friend counts are real).
const PEER_FRIENDSHIPS = [
  ["layla", "noah"], ["layla", "hannah"], ["layla", "clara"],
  ["jonas", "lukas"], ["jonas", "sofia"], ["hannah", "emma"],
  ["noah", "yuki"], ["clara", "amelie"], ["priya", "yuki"],
  ["emma", "finn"], ["sofia", "mateo"], ["amelie", "lukas"],
];

const email = (slug) => `${slug}@${DOMAIN}`;

async function findUserByEmail(addr) {
  // listUsers is paginated; scan until found (demo project is small enough).
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const hit = data.users.find((u) => u.email === addr);
    if (hit) return hit;
    if (data.users.length < 200) break;
  }
  return null;
}

async function ensureUser(peer) {
  const addr = email(peer.slug);
  const { data, error } = await db.auth.admin.createUser({
    email: addr,
    password: `Demo!${peer.slug}-${Math.random().toString(36).slice(2, 10)}`,
    email_confirm: true,
    user_metadata: { full_name: peer.name, demo: true },
  });
  if (!error) return data.user;
  if (/already.+registered|already exists|duplicate/i.test(error.message)) {
    const existing = await findUserByEmail(addr);
    if (existing) return existing;
  }
  throw new Error(`createUser ${addr}: ${error.message}`);
}

async function run() {
  // sample of real courses for enrollments
  const { data: courses, error: cErr } = await db.from("courses").select("id").eq("is_archived", false).limit(8);
  if (cErr) throw cErr;
  const courseIds = (courses ?? []).map((c) => c.id);

  const idBySlug = {};

  for (let i = 0; i < PEERS.length; i++) {
    const peer = PEERS[i];
    const user = await ensureUser(peer);
    idBySlug[peer.slug] = user.id;

    // The handle_new_user trigger already created profile + student role.
    const { error: pErr } = await db.from("profiles").update({
      display_name: peer.name,
      full_name: peer.name,
      institution: peer.institution,
      social_roles: peer.roles,
      total_xp: peer.xp,
      current_level: peer.level,
      current_streak: peer.streak,
      best_streak: peer.streak,
      last_active_date: peer.online ? new Date().toISOString().slice(0, 10) : null,
    }).eq("user_id", user.id);
    if (pErr) throw new Error(`profile ${peer.slug}: ${pErr.message}`);

    // Week of xp_events summing to ~weekly (reset existing demo events first).
    await db.from("xp_events").delete().eq("user_id", user.id);
    const days = 7;
    const per = Math.max(10, Math.round(peer.weekly / days));
    const events = [];
    let remaining = peer.weekly;
    for (let d = 0; d < days; d++) {
      const xp = d === days - 1 ? remaining : Math.min(remaining, Math.round(per * (0.6 + (((i + d) % 5) * 0.2))));
      remaining -= xp;
      if (xp <= 0) continue;
      const when = new Date();
      when.setDate(when.getDate() - (days - 1 - d));
      events.push({ user_id: user.id, xp, reason: "demo", created_at: when.toISOString() });
    }
    if (events.length) {
      const { error: xErr } = await db.from("xp_events").insert(events);
      if (xErr) throw new Error(`xp_events ${peer.slug}: ${xErr.message}`);
    }

    // Enroll in a rotating sample of real courses.
    if (courseIds.length) {
      const picks = [courseIds[i % courseIds.length], courseIds[(i + 3) % courseIds.length]];
      for (const cid of [...new Set(picks)]) {
        await db.from("course_enrollments").upsert(
          { user_id: user.id, course_id: cid },
          { onConflict: "user_id,course_id", ignoreDuplicates: true },
        );
      }
    }
    console.log(`✓ ${peer.name} (${peer.slug})`);
  }

  // Inter-peer friendships.
  for (const [a, b] of PEER_FRIENDSHIPS) {
    const ra = idBySlug[a], rb = idBySlug[b];
    if (!ra || !rb) continue;
    await db.from("friend_requests").upsert(
      { requester_id: ra, addressee_id: rb, status: "accepted", responded_at: new Date().toISOString() },
      { onConflict: "requester_id,addressee_id", ignoreDuplicates: true },
    );
  }
  console.log(`✓ ${PEER_FRIENDSHIPS.length} inter-peer friendships`);
  console.log("\nDone. Demo peers seeded.");
}

run().catch((e) => {
  console.error("Seed failed:", e.message);
  process.exit(1);
});
