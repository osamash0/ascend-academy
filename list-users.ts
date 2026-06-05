import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function findUsers() {
  try {
    const res = await pool.query(`SELECT id, email FROM "user"`);
    console.log("All users in Better Auth:");
    res.rows.forEach(r => console.log(`${r.email} - ${r.id}`));
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
findUsers();
