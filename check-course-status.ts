import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkCourseStatus() {
  try {
    const res = await pool.query(`SELECT id, title, is_archived, created_at FROM courses WHERE professor_id = '97be3636-98bc-4cbe-9928-cc400556172e'`);
    console.log("prof@admin.com courses:", res.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
checkCourseStatus();
