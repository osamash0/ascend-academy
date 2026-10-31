# Browser review, 2026-10-31

Reviewed https://learnstation.app in the connected Chrome browser using browser-use CLI, including the public landing and account screens, signed-in Home, a personal Lesson, PDF page turning, Explain, a follow-up question, saved reader position, Spaces, and the mobile Library. The user signed in and explicitly approved AI testing on the software-engineering Lesson.

| Finding | Local change | Verification |
| --- | --- | --- |
| The landing header hides Sign in below 640px, directing returning visitors through signup. | Keep Sign in visible on phones. The hero still offers Start learning; the extra header signup button appears on larger screens. | Chrome at 320px; sign-in and signup navigation regression tests. |
| Landing demo tabs all occupy the tab sequence and lack arrow-key navigation or panel associations. | One active tab stop, Left/Right wrapping, Home/End, focus stops autoplay, and a labelled, focusable panel. | Chrome confirmed ArrowRight focuses and selects Explain; regression tests cover wrapping, endpoints and panel associations. |
| Ask displayed the model's schema label “key block” above its answer. | Recognize spaced, camel-case, underscored and hyphenated block names and replace them with the existing readable format labels. Preserve human descriptions. | Five schema-label variants and a human-label regression case. |
| Explain assigned an instructor's contact office to the lecture venue, then repeated it in a checkpoint. The page states the lecture venue separately. Ask distinguished the two when explicitly prompted. | Strengthen source-grounding rules for Explain and Ask, preserve relationships between facts, allow short factual summaries instead of forced examples, and bump both cache versions. | Prompt construction and service tests pass. This is a mitigation; model behavior with the revised prompts still needs live verification after deployment. |
| Practice ignored the requested language, and its cache reused questions across language changes. | Read revision-matching published translations, keep original-language fallback questions clearly labelled, cache by lesson and language, and submit canonical choice values for server grading. Both standalone practice and the reader's practice panel use the mapping. | 25 frontend tests and 9 backend tests passed, including late responses during a language switch, canonical answer submission, malformed translations, and locale propagation through the API. |

Validation passed: 17 landing tests, 23 targeted reader backend tests, TypeScript (`tsconfig.app.json`), frontend production build, full frontend lint, focused Ruff checks, and `git diff --check`. Lint reports existing warnings; the build reports existing chunk-size warnings.

At the initial review these changes were local and not deployed. The backend tests use isolated fake services and do not call real AI providers. That pass submitted no new account or file upload and did not test the full practice/rehearsal journey. This was a focused review, not an exhaustive platform audit.

Continued inside Codex's in-app browser using its existing signed-in session. Practice accepted the six-ECTS answer and showed its explanation; Next question advanced, and Escape returned to the Lesson. At 390px, double-tap zoom and page turning worked in the PDF reader. The practice-language change also passed TypeScript, full frontend lint, a production build, and focused Ruff checks. Reading published translations does not generate a new translation or invoke an AI provider.

Next: review and deploy the frontend and API changes together, then verify practice language and the revised Explain/Ask prompts on the live Lesson. Keep upload processing and a complete rehearsal run as the remaining review scope.

## Release preparation

The user authorized upload/rehearsal testing and deployment of the frontend and API together. Created an original three-page water-cycle PDF and uploaded it through the in-app browser. The reader opened all three pages and saved page 3 as its resume position. The worker completed the parse in 42.52 seconds. The first rehearsal request failed during a Gemini 503/busy response; the retry path is being exercised before live verification is finalized.

The API logs exposed a metering bug for personal Spaces: the virtual Space id was being inserted into `llm_calls.course_id`, which references real courses. Rehearsal generation now records no course id for personal Spaces while retaining the user id. Regression tests cover both personal and real-course attribution.

Main's pre-existing CI failure was seven pypdf advisories against 6.21.2. Updated the dev pin and Docker minimum to the published 6.21.4 security patch. No audit exceptions were added. Production is healthy, has 21 GB free disk and a 4 GB swapfile, and its checkout is 2a367069. The deployment will use a green main revision, retain rollback images, take the documented database backup, build before swapping, and verify API readiness plus browser flows afterward.
