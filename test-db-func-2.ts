import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkDb() {
  try {
    const res = await pool.query(`
      SELECT pg_get_functiondef('handle_new_user'::regproc);
    `);
    console.log(res.rows[0].pg_get_functiondef);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
checkDb();
