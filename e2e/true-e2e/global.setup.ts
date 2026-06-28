import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// Default values for local supabase development
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  console.warn("WARNING: SUPABASE_SERVICE_ROLE_KEY is not set. Global setup may fail if not running against the default mocked setup.");
}

export const E2E_PROFESSOR = {
  email: "prof.e2e@ascend-academy.test",
  password: "Password123!",
  role: "professor"
};

export const E2E_STUDENT = {
  email: "student.e2e@ascend-academy.test",
  password: "Password123!",
  role: "student"
};

export default async function globalSetup() {
  if (!SERVICE_ROLE_KEY) return;
  
  console.log("🛠  E2E Global Setup: Provisioning test users...");
  const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  // Helper to ensure user exists and has a fresh state
  async function provisionUser(credentials: typeof E2E_PROFESSOR) {
    // 1. Check if user already exists
    const { data: { users }, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    if (listError) {
      console.error("Error listing users:", listError);
      return;
    }

    const existingUser = users.find((u) => u.email === credentials.email);
    
    // 2. If exists, delete them to ensure clean slate (deletes cascade in DB)
    if (existingUser) {
      await supabaseAdmin.auth.admin.deleteUser(existingUser.id);
      // Wait a moment for cascades
      await new Promise(res => setTimeout(res, 500));
    }

    // 3. Create the user
    const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
      email: credentials.email,
      password: credentials.password,
      email_confirm: true,
      user_metadata: { role: credentials.role },
    });

    if (createError) {
      console.error(`Error creating ${credentials.role} user:`, createError);
      throw createError;
    }
    console.log(`✅ Provisioned ${credentials.role} (${credentials.email})`);
    return newUser.user;
  }

  try {
    const profUser = await provisionUser(E2E_PROFESSOR);
    const studentUser = await provisionUser(E2E_STUDENT);

    if (profUser) {
      console.log("🛠 Seeding E2E Course and Practice Sheet...");
      // Seed a course
      const { data: course, error: courseError } = await supabaseAdmin.from('courses').insert({
        title: "E2E Integration Course",
        description: "Course for testing practice sheet enrollments.",
        professor_id: profUser.id,
        is_published: true,
        join_code: "E2E-TEST-CODE",
      }).select().single();

      if (courseError) {
        console.error("Failed to seed course", courseError);
      } else {
        // Seed a practice sheet
        const { error: sheetError } = await supabaseAdmin.from('practice_sheets').insert({
          course_id: course.id,
          title: "E2E Practice Sheet",
          description: "A test sheet for E2E students",
          content_blocks: [
            { type: "text", content: "What is 2+2?" },
            { type: "question", question_text: "What is 2+2?", options: ["3", "4", "5"], correct_answer: 1 }
          ],
          total_points: 10,
          status: "published",
        });
        if (sheetError) console.error("Failed to seed sheet", sheetError);

        // Seed a lecture and slide for gamification testing
        const { data: lecture, error: lectureError } = await supabaseAdmin.from('lectures').insert({
          professor_id: profUser.id,
          title: "E2E Gamification Lecture",
          course_id: course.id,
          is_archived: false,
          total_slides: 1
        }).select().single();

        if (lectureError) {
          console.error("Failed to seed lecture", lectureError);
        } else {
          await supabaseAdmin.from('slides').insert({
            lecture_id: lecture.id,
            slide_number: 1,
            title: "First Slide",
            content_text: "Slide content",
            summary: "Summary"
          });
          console.log("✅ Seeded Course, Practice Sheet, and Lecture");
        }
      }
    }
  } catch (err) {
    console.error("Global setup failed to provision users:", err);
    throw err;
  }
}
