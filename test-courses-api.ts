import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
dotenv.config();

const supabaseAdmin = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

async function testApi() {
  const { data, error } = await supabaseAdmin.auth.admin.createSession({
    userId: "97be3636-98bc-4cbe-9928-cc400556172e",
  });
  
  if (error) {
    console.error("Failed to create session:", error);
    return;
  }
  
  const token = data.session.access_token;
  console.log("Token generated:", token.substring(0, 20) + "...");
  
  const res = await fetch("http://localhost:8000/api/courses", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  
  console.log("Status:", res.status);
  console.log("Response:", await res.text());
}

testApi();
