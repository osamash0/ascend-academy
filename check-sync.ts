import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function checkSync() {
  const email = "prof@admin.com";
  
  try {
    // 1. Better Auth user table
    const baUser = await pool.query(`SELECT id, email, role, "emailVerified", "createdAt" FROM "user" WHERE email = $1`, [email]);
    console.log("\n=== Better Auth user ===");
    console.log(baUser.rows[0] ?? "NOT FOUND");
    
    if (!baUser.rows[0]) {
      console.log("❌ User not in Better Auth! Need to create.");
      pool.end();
      return;
    }
    const uid = baUser.rows[0].id;
    
    // 2. user_roles table
    const roles = await pool.query(`SELECT * FROM user_roles WHERE user_id = $1`, [uid]);
    console.log("\n=== user_roles ===");
    console.log(roles.rows.length > 0 ? roles.rows : "NOT FOUND");
    
    // 3. profiles table
    const profile = await pool.query(`SELECT id, user_id, email, full_name FROM profiles WHERE user_id = $1`, [uid]);
    console.log("\n=== profiles ===");
    console.log(profile.rows[0] ?? "NOT FOUND");
    
    // 4. Better Auth account (linked credential)
    const account = await pool.query(`SELECT id, "accountId", "providerId", "userId" FROM account WHERE "userId" = $1`, [uid]);
    console.log("\n=== account (Better Auth) ===");
    console.log(account.rows.length > 0 ? account.rows : "NOT FOUND");
    
    // 5. Active session
    const sessions = await pool.query(`SELECT token, "expiresAt" FROM session WHERE "userId" = $1 AND "expiresAt" > NOW()`, [uid]);
    console.log("\n=== Active sessions ===");
    console.log(sessions.rows.length > 0 ? `${sessions.rows.length} active session(s)` : "None");
    
    // 6. Courses
    const courses = await pool.query(`SELECT id, title, is_archived FROM courses WHERE professor_id = $1`, [uid]);
    console.log("\n=== Courses ===");
    console.log(courses.rows.length > 0 ? courses.rows : "None");
    
    // Summary
    console.log("\n=== Summary ===");
    const hasRole = roles.rows.some(r => r.role === "professor");
    const hasProfile = profile.rows.length > 0;
    const hasBaRole = baUser.rows[0].role === "professor";
    console.log(`✅ Better Auth role: ${baUser.rows[0].role}`);
    console.log(hasRole ? `✅ user_roles: professor` : `❌ user_roles: MISSING`);
    console.log(hasProfile ? `✅ Profile exists` : `❌ Profile: MISSING`);
    console.log(`📚 Courses: ${courses.rows.length}`);
    
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

checkSync();
