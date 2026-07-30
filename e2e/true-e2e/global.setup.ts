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
  // The role trigger only permits a professor role for trusted domains.
  email: "prof.e2e@system.learnstation.com",
  password: "Password123!",
  role: "professor"
};

export const E2E_STUDENT = {
  email: "student.e2e@ascend-academy.test",
  password: "Password123!",
  role: "student"
};

export const E2E_ONBOARDING_STUDENT = {
  email: "onboarding.e2e@ascend-academy.test",
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

  async function findUserByEmail(email: string) {
    // listUsers is paginated; walk every page before deciding an account is absent.
    for (let page = 1; ; page += 1) {
      const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) throw error;
      const user = data.users.find((candidate) => candidate.email === email);
      if (user) return user;
      if (data.users.length < 1000) return null;
    }
  }

  // Keep dedicated accounts stable. Local Auth can reject deletion when a
  // migration introduced a non-cascading foreign key, whereas fixture rows are
  // safe to clear explicitly below.
  async function provisionUser(credentials: typeof E2E_PROFESSOR) {
    const existingUser = await findUserByEmail(credentials.email);
    if (existingUser) {
      const { data, error } = await supabaseAdmin.auth.admin.updateUserById(existingUser.id, {
        password: credentials.password,
        user_metadata: { role: credentials.role },
      });
      if (error) throw error;
      return data.user;
    }

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
    const onboardingUser = await provisionUser(E2E_ONBOARDING_STUDENT);

    if (profUser && studentUser && onboardingUser) {
      const fixtureCourseCleanup = await supabaseAdmin
        .from('courses')
        .delete()
        .eq('professor_id', profUser.id)
        .eq('title', 'E2E Integration Course');
      if (fixtureCourseCleanup.error) throw fixtureCourseCleanup.error;

      const fixtureAttemptsCleanup = await supabaseAdmin
        .from('practice_attempts')
        .delete()
        .eq('student_id', studentUser.id);
      if (fixtureAttemptsCleanup.error) throw fixtureAttemptsCleanup.error;

      const onboardingReset = await supabaseAdmin
        .from('onboarding_progress')
        .delete()
        .eq('user_id', onboardingUser.id);
      if (onboardingReset.error) throw onboardingReset.error;

      const { error: activationError } = await supabaseAdmin
        .from('profiles')
        .update({ has_completed_activation_onboarding: true })
        .eq('user_id', studentUser.id);
      if (activationError) throw activationError;

      const { error: onboardingProfileError } = await supabaseAdmin
        .from('profiles')
        .update({ has_completed_activation_onboarding: false })
        .eq('user_id', onboardingUser.id);
      if (onboardingProfileError) throw onboardingProfileError;

      console.log("🛠 Seeding E2E Course and Practice Sheet...");
      const { data: course, error: courseError } = await supabaseAdmin.from('courses').insert({
        title: "E2E Integration Course",
        description: "Course for testing practice sheet enrollments.",
        professor_id: profUser.id,
        is_archived: false,
        status: "published",
      }).select().single();

      if (courseError) {
        throw courseError;
      } else {
        const { data: lecture, error: lectureError } = await supabaseAdmin.from('lectures').insert({
          professor_id: profUser.id,
          title: "E2E Gamification Lecture",
          course_id: course.id,
          is_archived: false,
          total_slides: 1
        }).select().single();

        if (lectureError) {
          throw lectureError;
        } else {
          const { data: slide, error: slideError } = await supabaseAdmin.from('slides').insert({
            lecture_id: lecture.id,
            slide_number: 1,
            title: "First Slide",
            content_text: "Slide content",
            summary: "Summary"
          }).select().single();
          if (slideError) throw slideError;

          // The reader intentionally serves only a complete locale snapshot.
          // Seed that snapshot here rather than relying on an external LLM in
          // a deterministic browser test. Adding the slide increments the
          // source revision, so fetch it after the insert.
          const { data: localizedLecture, error: localizedLectureError } = await supabaseAdmin
            .from('lectures')
            .select('content_revision')
            .eq('id', lecture.id)
            .single();
          if (localizedLectureError) throw localizedLectureError;

          const localizedContent = {
            lecture: { title: "E2E Gamification Lecture", description: null },
            slides: [{
              id: slide.id,
              slide_number: 1,
              title: "First Slide",
              content_text: "Slide content",
              summary: "Summary",
              questions: [],
            }],
          };
          const { error: localizationError } = await supabaseAdmin.from('lecture_localizations').insert(
            ['en', 'de'].map((locale) => ({
              lecture_id: lecture.id,
              locale,
              source_revision: localizedLecture.content_revision,
              status: 'ready',
              content: localizedContent,
            })),
          );
          if (localizationError) throw localizationError;

          const { data: sheet, error: sheetError } = await supabaseAdmin.from('practice_sheets').insert({
            lecture_id: lecture.id,
            kind: "manual",
            title: "E2E Practice Sheet",
            created_by: profUser.id,
            status: "published",
          }).select().single();
          if (sheetError) throw sheetError;

          const { error: questionError } = await supabaseAdmin.from('practice_sheet_questions').insert({
            sheet_id: sheet.id,
            order_index: 0,
            type: "multiple_choice",
            prompt: "What is 2+2?",
            choices: ["3", "4", "5"],
            correct_answer: "4",
          });
          if (questionError) throw questionError;

          const { error: enrollmentError } = await supabaseAdmin.from('course_enrollments').insert({
            user_id: studentUser.id,
            course_id: course.id,
          });
          if (enrollmentError) throw enrollmentError;

          console.log("✅ Seeded Course, Practice Sheet, and Lecture");
        }
      }
    }
  } catch (err) {
    console.error("Global setup failed to provision users:", err);
    throw err;
  }
}
