import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function fixDb() {
  try {
    console.log("Dropping conflicting trigger...");
    await pool.query(`DROP TRIGGER IF EXISTS on_better_auth_user_created ON "user"`);
    console.log("Trigger dropped successfully.");
  } catch (err) {
    console.error("Error dropping trigger:", err);
  } finally {
    pool.end();
  }
}
fixDb();
