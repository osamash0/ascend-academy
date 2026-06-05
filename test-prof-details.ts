import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkDetails() {
  try {
    const baUser = await pool.query(`SELECT id, role, email FROM "user" WHERE email = 'prof@admin.com'`);
    console.log("BA User:", baUser.rows);
    
    if (baUser.rows.length > 0) {
      const id = baUser.rows[0].id;
      const roles = await pool.query(`SELECT role FROM public.user_roles WHERE user_id = $1`, [id]);
      console.log("Roles:", roles.rows);
      
      const authUser = await pool.query(`SELECT id, raw_user_meta_data FROM auth.users WHERE id = $1`, [id]);
      console.log("Auth User:", authUser.rows[0]);
    }
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
checkDetails();
