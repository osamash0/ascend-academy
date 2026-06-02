# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: professor-upload.spec.ts >> Professor PDF upload >> login → upload PDF → SSE progress → publish
- Location: e2e/professor-upload.spec.ts:19:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByRole('button', { name: /get started/i })
Expected: visible
Timeout: 15000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 15000ms
  - waiting for getByRole('button', { name: /get started/i })

```

```yaml
- region "Notifications (F8)":
  - list
- region "Notifications alt+T"
- button "Ascend v2.0 Orbital":
  - img
  - text: Ascend v2.0 Orbital
- text: Navigation Hub
- list:
  - listitem:
    - link "Dashboard":
      - /url: /professor/dashboard
      - img
      - text: Dashboard
  - listitem:
    - link "Courses":
      - /url: /professor/courses
      - img
      - text: Courses
  - listitem:
    - link "Analytics":
      - /url: /professor/analytics
      - img
      - text: Analytics
  - listitem:
    - link "Upload Lecture":
      - /url: /professor/upload
      - img
      - text: Upload Lecture
  - listitem:
    - link "Settings":
      - /url: /settings
      - img
      - text: Settings
- text: T
- paragraph: Test Professor
- text: professor
- group "Language":
  - button "en" [pressed]
  - button "de"
- button "Sign out":
  - img
  - text: Sign out
- main:
  - button "Toggle sidebar":
    - img
    - text: Toggle Sidebar
  - button "Switch to Light Mode":
    - img
  - button "Notifications":
    - img
  - button:
    - img
  - img
  - heading "Create Lecture" [level=1]
  - paragraph: Build interactive learning experiences
  - button "Exit"
  - text: Lecture Title
  - textbox "Lecture Title":
    - /placeholder: e.g., Introduction to Machine Learning
    - text: Mission Briefing Lecture
  - text: Description
  - textbox "Description":
    - /placeholder: Describe what students will learn...
  - text: Course
  - combobox "Course":
    - option "Uncategorized" [selected]
  - img
  - heading "Start Building Your Lecture" [level=3]
  - paragraph: Create slides from scratch or import a PDF to auto-generate structured content with AI-powered summaries and quizzes.
  - button "Create First Slide":
    - img
    - text: Create First Slide
  - button "Import PDF":
    - img
    - text: Import PDF
  - dialog "Processing Your Lecture":
    - heading "Processing Your Lecture" [level=3]
    - paragraph: Uploading PDF...
    - progressbar: Upload Extract AI Enhance
    - text: Extraction engine Detecting… Starting… … Slides Ready
    - log "Processed slides": Waiting for first slide…
    - paragraph: Please keep this tab open while your lecture is being processed
    - button "Cancel Processing"
  - button "Send feedback":
    - img
    - text: Feedback
```

# Test source

```ts
  33  | 
  34  |     // ─── Mock the SSE parse endpoint with a deterministic stream ────────────
  35  |     const sseBody = [
  36  |       `data: ${JSON.stringify({ type: "info", parser: "opendataloader-pdf" })}`,
  37  |       "",
  38  |       `data: ${JSON.stringify({
  39  |         type: "progress",
  40  |         current: 1,
  41  |         total: 2,
  42  |         message: "Extracting page 1",
  43  |       })}`,
  44  |       "",
  45  |       `data: ${JSON.stringify({
  46  |         type: "slide",
  47  |         index: 0,
  48  |         slide: {
  49  |           title: "Mission Brief",
  50  |           content: "Brief slide content from the parser.",
  51  |           summary: "Mission brief summary.",
  52  |           questions: [
  53  |             {
  54  |               question: "Are we ready for launch?",
  55  |               options: ["Yes", "No", "Maybe", "Later"],
  56  |               correctAnswer: 0,
  57  |             },
  58  |           ],
  59  |         },
  60  |       })}`,
  61  |       "",
  62  |       `data: ${JSON.stringify({
  63  |         type: "progress",
  64  |         current: 2,
  65  |         total: 2,
  66  |         message: "Finalizing",
  67  |       })}`,
  68  |       "",
  69  |       `data: ${JSON.stringify({ type: "complete" })}`,
  70  |       "",
  71  |       "",
  72  |     ].join("\n");
  73  | 
  74  |     await page.route("**/api/upload/parse-pdf-stream", (route) => {
  75  |       if (route.request().method() === "OPTIONS") {
  76  |         return route.fulfill({
  77  |           status: 204,
  78  |           headers: {
  79  |             "access-control-allow-origin": "*",
  80  |             "access-control-allow-methods": "POST,OPTIONS",
  81  |             "access-control-allow-headers": "*",
  82  |           },
  83  |         });
  84  |       }
  85  |       return route.fulfill({
  86  |         status: 200,
  87  |         contentType: "text/event-stream",
  88  |         headers: { "access-control-allow-origin": "*" },
  89  |         body: sseBody,
  90  |       });
  91  |     });
  92  | 
  93  |     // ─── Storage upload mock (PDF bytes go to lecture-pdfs bucket) ──────────
  94  |     await page.route(/\/storage\/v1\/object\/lecture-pdfs\//, (route) => {
  95  |       const m = route.request().method();
  96  |       if (m === "OPTIONS") {
  97  |         return route.fulfill({
  98  |           status: 204,
  99  |           headers: {
  100 |             "access-control-allow-origin": "*",
  101 |             "access-control-allow-methods": "POST,PUT,OPTIONS",
  102 |             "access-control-allow-headers": "*",
  103 |           },
  104 |         });
  105 |       }
  106 |       return route.fulfill({
  107 |         status: 200,
  108 |         contentType: "application/json",
  109 |         headers: { "access-control-allow-origin": "*" },
  110 |         body: JSON.stringify({ Key: "lecture-pdfs/lectures/test/sample.pdf" }),
  111 |       });
  112 |     });
  113 | 
  114 |     // ─── Log in as professor, then navigate to the upload page ──────────────
  115 |     await loginAs(page, PROFESSOR, /\/professor\/dashboard/);
  116 |     await page.goto("/professor/upload");
  117 |     await expect(
  118 |       page.getByRole("heading", { name: /create lecture/i }),
  119 |     ).toBeVisible({ timeout: 30_000 });
  120 | 
  121 |     // Set the title BEFORE uploading (handleSubmit requires non-empty title).
  122 |     await page.locator("#title").fill("Mission Briefing Lecture");
  123 | 
  124 |     // Attach the PDF — the input is hidden, but Playwright can target it.
  125 |     await page.locator('input[type="file"][accept=".pdf"]').setInputFiles(FIXTURE_PDF);
  126 | 
  127 |     // ─── Wait for the SSE stream to drive the editor view ───────────────────
  128 |     // After `complete` the upload overlay shows a "Get Started" button.
  129 |     // `usePDFUpload` only flips `isUploading` to false via `closeUploadOverlay`,
  130 |     // so we MUST click "Get Started" to dismiss the modal before Publish is
  131 |     // actually clickable (the overlay would otherwise intercept pointer events).
  132 |     const getStarted = page.getByRole("button", { name: /get started/i });
> 133 |     await expect(getStarted).toBeVisible({ timeout: 15_000 });
      |                              ^ Error: expect(locator).toBeVisible() failed
  134 |     await getStarted.click();
  135 | 
  136 |     const publishButton = page.getByRole("button", { name: /^publish$/i });
  137 |     await expect(publishButton).toBeVisible({ timeout: 10_000 });
  138 |     await expect(publishButton).toBeEnabled();
  139 | 
  140 |     // ─── Publish: triggers storage upload + lectures/slides inserts ─────────
  141 |     await publishButton.click();
  142 | 
  143 |     // Success toast + redirect.
  144 |     await expect(page.getByText(/lecture created successfully/i)).toBeVisible({
  145 |       timeout: 10_000,
  146 |     });
  147 |     await page.waitForURL(/\/professor\/dashboard/);
  148 |   });
  149 | });
  150 | 
```