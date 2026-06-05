import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function checkAnalytics() {
  const profId = "97be3636-98bc-4cbe-9928-cc400556172e";

  try {
    // 1. Professor's lectures
    const lectures = await pool.query(
      `SELECT id, title, total_slides FROM lectures WHERE professor_id = $1`,
      [profId]
    );
    console.log(`\n=== Lectures (${lectures.rows.length}) ===`);
    lectures.rows.forEach(l => console.log(` - [${l.id.substring(0,8)}] ${l.title} (${l.total_slides} slides)`));

    const lectureIds = lectures.rows.map(l => l.id);
    if (lectureIds.length === 0) {
      console.log("No lectures → analytics will be empty");
      return;
    }

    // 2. Student progress for these lectures
    const progress = await pool.query(
      `SELECT lecture_id, COUNT(DISTINCT user_id) as students,
              SUM(total_questions_answered) as total_q,
              SUM(correct_answers) as correct
       FROM student_progress
       WHERE lecture_id = ANY($1::uuid[])
       GROUP BY lecture_id`,
      [lectureIds]
    );
    console.log(`\n=== Student progress per lecture ===`);
    if (progress.rows.length === 0) {
      console.log("❌ NO student progress data found for any lecture!");
    } else {
      progress.rows.forEach(r => {
        const pct = r.total_q > 0 ? Math.round(r.correct / r.total_q * 100) : 0;
        console.log(` - lecture ${r.lecture_id.substring(0,8)}: ${r.students} students, ${r.total_q} Qs, ${pct}% accuracy`);
      });
    }

    // 3. Quiz questions per lecture
    const quizQ = await pool.query(
      `SELECT lecture_id, COUNT(*) as count FROM quiz_questions WHERE lecture_id = ANY($1::uuid[]) GROUP BY lecture_id`,
      [lectureIds]
    );
    console.log(`\n=== Quiz questions per lecture ===`);
    if (quizQ.rows.length === 0) {
      console.log("❌ NO quiz questions found for any lecture!");
    } else {
      quizQ.rows.forEach(r => console.log(` - lecture ${r.lecture_id.substring(0,8)}: ${r.count} questions`));
    }

    // 4. Slides per lecture
    const slides = await pool.query(
      `SELECT lecture_id, COUNT(*) as count FROM slides WHERE lecture_id = ANY($1::uuid[]) GROUP BY lecture_id`,
      [lectureIds]
    );
    console.log(`\n=== Slides per lecture ===`);
    slides.rows.forEach(r => console.log(` - lecture ${r.lecture_id.substring(0,8)}: ${r.count} slides`));

    // 5. Enrollment / course_enrollments
    const enrollments = await pool.query(
      `SELECT course_id, COUNT(*) as students FROM course_enrollments WHERE course_id = 'c1858708-2b73-4bf5-bafa-09c53703db89' GROUP BY course_id`
    );
    console.log(`\n=== Course enrollments ===`);
    console.log(enrollments.rows.length > 0 ? enrollments.rows : "❌ No enrollments");

  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

checkAnalytics();
