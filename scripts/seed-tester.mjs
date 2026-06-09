/** Create/refresh a known test student for verifying the social feature. */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const txt = readFileSync(new URL("../.env", import.meta.url), "utf8");
for (const line of txt.split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const EMAIL = "tester@learnstation-demo.com";
const PASSWORD = "TestPass123!";

async function findUser() {
  for (let page = 1; page <= 20; page++) {
    const { data } = await db.auth.admin.listUsers({ page, perPage: 200 });
    const hit = data.users.find((u) => u.email === EMAIL);
    if (hit) return hit;
    if (data.users.length < 200) break;
  }
  return null;
}

let user = await findUser();
if (user) {
  await db.auth.admin.updateUserById(user.id, { password: PASSWORD, email_confirm: true });
} else {
  const { data, error } = await db.auth.admin.createUser({
    email: EMAIL, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: "Abdullah B.", demo: true },
  });
  if (error) throw error;
  user = data.user;
}

await db.from("profiles").update({
  display_name: "Abdullah B.", full_name: "Abdullah B.",
  institution: "Uni Marburg", social_roles: ["Student", "Self-learner"],
  total_xp: 2840, current_level: 7, current_streak: 12, best_streak: 14,
  last_active_date: new Date().toISOString().slice(0, 10),
}).eq("user_id", user.id);

// week of xp_events (~340 total)
await db.from("xp_events").delete().eq("user_id", user.id);
const daily = [40, 75, 20, 60, 50, 30, 65];
const evs = daily.map((xp, d) => {
  const when = new Date(); when.setDate(when.getDate() - (6 - d));
  return { user_id: user.id, xp, reason: "demo", created_at: when.toISOString() };
});
await db.from("xp_events").insert(evs);

// enroll in a couple of real courses that overlap with seeded peers
const { data: courses } = await db.from("courses").select("id").eq("is_archived", false).limit(8);
const ids = (courses ?? []).map((c) => c.id);
for (const cid of [ids[0], ids[3]].filter(Boolean)) {
  await db.from("course_enrollments").upsert({ user_id: user.id, course_id: cid }, { onConflict: "user_id,course_id", ignoreDuplicates: true });
}

console.log(`Test user ready: ${EMAIL} / ${PASSWORD}`);
