import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkLectures() {
  try {
    const userRes = await pool.query(`SELECT id FROM "user" WHERE email = 'prof@admin.com'`);
    if (userRes.rows.length > 0) {
      const id = userRes.rows[0].id;
      const lecsRes = await pool.query(`SELECT id, title, course_id FROM lectures WHERE professor_id = $1`, [id]);
      console.log(`Lectures for ${id}:`, lecsRes.rows);
    }
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
checkLectures();
