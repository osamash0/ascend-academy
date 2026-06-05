import pg from "pg";
import dotenv from "dotenv";
import { randomUUID } from "crypto";
dotenv.config();

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    
    // Fetch all old auth.users
    const { rows: users } = await client.query(`
      SELECT id, email, encrypted_password, raw_user_meta_data, created_at 
      FROM auth.users
    `);
    
    console.log(`Found ${users.length} users to migrate.`);
    
    let migrated = 0;
    for (const user of users) {
      // Check if user already exists in Better Auth by email
      const { rows: existing } = await client.query(`SELECT id FROM "user" WHERE email = $1`, [user.email]);
      if (existing.length > 0) {
        console.log(`Skipping ${user.email} - already exists in Better Auth`);
        continue; // Already migrated or created via Better Auth
      }
      
      const role = user.raw_user_meta_data?.role || 'student';
      const name = user.raw_user_meta_data?.full_name || user.email.split('@')[0] || 'User';
      const emailVerified = user.raw_user_meta_data?.email_verified === true;
      
      // Insert into public.user
      await client.query(`
        INSERT INTO "user" (id, name, email, "emailVerified", image, "createdAt", "updatedAt", role)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        user.id,
        name,
        user.email,
        emailVerified,
        null, // image
        user.created_at,
        user.created_at,
        role
      ]);
      
      // Insert into public.account
      await client.query(`
        INSERT INTO "account" (
          id, "accountId", "providerId", "userId", password, "createdAt", "updatedAt"
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        randomUUID(),
        user.id, // accountId
        'credential', // providerId
        user.id, // userId
        user.encrypted_password,
        user.created_at,
        user.created_at
      ]);
      
      migrated++;
    }
    
    await client.query("COMMIT");
    console.log(`Successfully migrated ${migrated} users to Better Auth!`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("Migration failed:", err);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
