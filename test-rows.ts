import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function checkRows() {
  try {
    const users = await pool.query(`SELECT * FROM "user"`);
    console.log("Users:", users.rows);
    
    const accounts = await pool.query(`SELECT * FROM "account"`);
    console.log("Accounts:", accounts.rows);
  } catch (err) {
    console.error(err);
  } finally {
    pool.end();
  }
}

checkRows();
