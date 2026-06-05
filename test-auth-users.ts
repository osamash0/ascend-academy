import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkAuthUsers() {
  try {
    const res = await pool.query(`
      SELECT id, email, encrypted_password, raw_user_meta_data, created_at 
      FROM auth.users 
      LIMIT 1;
    `);
    console.log(res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

checkAuthUsers();
