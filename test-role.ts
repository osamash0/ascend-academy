import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkRole() {
  try {
    const userResult = await pool.query(`SELECT id, role FROM "user" WHERE email = 'prof@admin.com'`);
    console.log("Better Auth User:", userResult.rows[0]);

    if (userResult.rows[0]) {
      const id = userResult.rows[0].id;
      const roleResult = await pool.query(`SELECT role FROM public.user_roles WHERE user_id = $1`, [id]);
      console.log("Supabase User Roles:", roleResult.rows);
    }
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
checkRole();
