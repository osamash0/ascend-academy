const { Client } = require('pg');
require('dotenv').config({ path: '.env' });

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const res = await client.query("SELECT polname, cmd, qual, with_check FROM pg_policies WHERE tablename = 'courses'");
  console.log(res.rows);
  await client.end();
}
run();
