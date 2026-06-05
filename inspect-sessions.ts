import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function inspect() {
  try {
    // Check the session table for prof@admin.com
    const userRow = await pool.query(`SELECT id FROM "user" WHERE email = 'prof@admin.com'`);
    const uid = userRow.rows[0]?.id;
    console.log("prof@admin.com uid:", uid);

    // Grab a sample session
    const sessions = await pool.query(
      `SELECT token, "expiresAt", "userId" FROM session WHERE "userId" = $1 LIMIT 2`,
      [uid]
    );
    console.log("Sessions:", sessions.rows.map(r => ({
      token: r.token?.substring(0, 40) + "...",
      expiresAt: r.expiresAt,
      userId: r.userId
    })));

    // Test the join query directly
    if (sessions.rows.length > 0) {
      const tok = sessions.rows[0].token;
      const result = await pool.query(
        `SELECT u.id, u.email, u.role
         FROM session s
         JOIN "user" u ON s."userId" = u.id
         WHERE s.token = $1 AND s."expiresAt" > NOW()`,
        [tok]
      );
      console.log("Join result:", result.rows);
    }
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}
inspect();
