import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkDb() {
  try {
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name IN ('user', 'session', 'account');
    `);
    console.log("Found Better Auth tables:", res.rows.map(r => r.table_name));
    
    if (res.rows.length > 0) {
      const users = await pool.query("SELECT * FROM \"user\" LIMIT 1");
      console.log("Users in Better Auth:", users.rows.length > 0 ? "Exists" : "None");
    }
  } catch (err) {
    console.error("DB check error:", err);
  } finally {
    pool.end();
  }
}

checkDb();
