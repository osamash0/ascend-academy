## Task 3: Activation Metrics & Telemetry

### 1. North Star Activation Metrics

**For Students:**
1. **Time to First Quiz Completed:** The average time from account creation to the completion of the first gamified quiz. A strong indicator of early engagement.
2. **Avatar Customization Rate:** The percentage of users who customize their Luna avatar within the first 3 days. This correlates with psychological investment in the platform.
3. **Week 1 Retention Rate:** The percentage of students who return to the app at least once during the 7 days following their initial sign-up.

**For Professors:**
1. **Lecture Upload Conversion:** The percentage of professors who upload their first lecture materials or syllabus within 48 hours of onboarding.
2. **First Analytics View:** The percentage of professors who access the lecture analytics dashboard within 7 days of their first lecture upload, indicating they are utilizing the platform's core value.

### 2. Telemetry Plan

To track the metrics above, the following core events must be instrumented in the application:

*   `account_created`: User completes sign-up. Properties: `role` (student/professor).
*   `onboarding_completed`: User finishes the initial onboarding flow.
*   `avatar_customized`: Student modifies their Luna avatar.
*   `quiz_started`: Student begins a quiz. Properties: `topic`, `difficulty`.
*   `quiz_completed`: Student finishes a quiz. Properties: `score`, `duration_seconds`.
*   `lecture_uploaded`: Professor uploads a document or video. Properties: `file_type`, `course_id`.
*   `analytics_dashboard_viewed`: Professor opens the analytics view. Properties: `course_id`.
*   `session_started`: User opens the app/website.

### 3. Lifecycle Nudges (Drop-off Recovery)

A structured notification schedule to re-engage users who drop off before activating:

**Student Nudge Schedule:**
*   **Day 1 (Push/Email):** *If no quiz taken.* "Luna is waiting! Take your first quick quiz to earn your beginner badge."
*   **Day 3 (Push):** *If avatar not customized.* "Make Luna yours! Customize your learning companion and start your journey."
*   **Day 7 (Email):** *If inactive since Day 1.* "Ready to level up? Dive into a 5-minute challenge tailored for your courses."

**Professor Nudge Schedule:**
*   **Day 2 (Email):** *If no lecture uploaded.* "Welcome to Learnstation! Upload your first lecture syllabus to see how our analytics can help your students."
*   **Day 5 (Email):** *If lecture uploaded but analytics not viewed.* "Your students are engaging! Check your dashboard to see insights on your recent upload."
*   **Day 14 (Email):** *If inactive.* "Discover how top professors are using Learnstation to boost class participation. [Link to case study/guide]"
