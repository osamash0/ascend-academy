import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkCourses() {
  try {
    const userRes = await pool.query(`SELECT id FROM "user" WHERE email = 'prof@admin.com'`);
    if (userRes.rows.length > 0) {
      const id = userRes.rows[0].id;
      const coursesRes = await pool.query(`SELECT id, title, professor_id FROM courses WHERE professor_id = $1`, [id]);
      console.log(`Courses for ${id}:`, coursesRes.rows);
      
      const allCoursesRes = await pool.query(`SELECT id, title, professor_id FROM courses LIMIT 5`);
      console.log(`All courses (first 5):`, allCoursesRes.rows);
    }
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
checkCourses();
