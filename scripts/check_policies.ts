import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(process.cwd(), '.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL!;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase.from('courses').select('*');
  console.log("COURSES:", data?.length);
  
  // let's fetch policies
  const { data: policies, error: err } = await supabase.rpc('execute_sql', { query: "SELECT * FROM pg_policies WHERE tablename = 'courses' OR tablename = 'lectures'" });
  if (err) {
    console.log("Could not use rpc execute_sql", err);
  } else {
    console.log(policies);
  }
}
run();
