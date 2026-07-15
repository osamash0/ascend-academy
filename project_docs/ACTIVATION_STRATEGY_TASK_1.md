## Task 1: Student Onboarding & Progressive Profiling

### 1. Analysis of Current Friction Points
The current student onboarding flow (`src/pages/Onboarding.tsx`) introduces significant cognitive load through a mandatory 5-step upfront process:
- **Over-Customization (Step 2):** Forcing users to customize Luna's suit, visor, and insignia before entering the platform creates unnecessary analysis paralysis.
- **Complex Cascading Selections (Step 3):** The Academic Profile step requires students to navigate a cascading hierarchy (University → Faculty → Degree Program → Semester) before they can proceed.
- **Premature Commitment (Step 4 & 5):** Asking students to confirm suggested courses and platform enrollments assumes they already understand the platform's value proposition.
- **Time Delay:** The onboarding concludes with a mandatory 5-second cinematic reveal, delaying access to the actual dashboard.

### 2. Streamlined Onboarding
To accelerate time-to-value, the onboarding should be reduced to the absolute minimum required to create a personalized instance of the app:
- **Step 1 Only:** Ask for the student's Name and provide a simple, randomized starting avatar (which they can change later).
- **Optional Step (Intent):** A single "What's your primary goal?" or "What are you currently studying?" question to inform initial dashboard content, bypassing the deep catalog search.
- **Immediate Entry:** Remove the long cinematic sequence and drop the user straight into the Student Dashboard.

### 3. Progressive Profiling Strategy
Instead of front-loading data collection, we will gather information gradually as the user interacts with the platform:
- **Avatar Customization:** Move the detailed Luna customization to the Social Profile or Settings. Gamify this by unlocking new visors or patches as they earn XP or complete their first modules.
- **Academic Context:** Use contextual prompts on the Dashboard. For example, when a student attempts to upload a lecture or browse the library, trigger a micro-modal asking, "Which course should we link this to?" to progressively build their catalog.
- **Social & Friends:** Delay friend suggestions until the student has actually enrolled in courses. A "Find Classmates" widget can appear on the dashboard once we have enough data to make relevant recommendations.

### 4. Accelerating the "Aha!" Moment
- **The "Aha!" Moment:** The core value realization occurs when a student uploads their first lecture material and instantly receives an AI-generated study guide, or when they complete their first smart quiz and earn their first rank XP.
- **Impact of the New Flow:** By slashing the onboarding from 5 heavy steps to just 1 or 2 lightweight questions, a student can go from account creation to generating their first AI study guide in under 30 seconds. This dramatically increases the likelihood of activation before they drop off.
