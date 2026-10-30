# Prompt: continue the full-app audit with a populated student account

Copy everything in the fenced block below into a **new Claude Code session** opened in
`/Users/abdullahabobaker/Desktop/ascend-academy`.

Before you start, do two things:
1. Be signed in, in Chrome, as a **student account that already has uploaded courses, lectures, review cards and ideally an exam attempt**.
2. Have the Claude-in-Chrome extension connected.

---

```
Continue a full-app audit of Learnstation that a previous session started. Read
APP_AUDIT_REPORT.md at the repo root first — it holds Parts 0–8 with 27 findings
already confirmed. Do not re-audit what's already in there; append to it.

Scope for this session: PART 2 — the authenticated STUDENT experience, on a
populated account (I'm already signed in in Chrome, with real uploaded courses,
lectures and review cards). The previous session could only reach the fresh-account
onboarding flow, so everything past onboarding is unaudited.

## How to work

Act as my co-pilot, not a reporter. Drive the app yourself in Chrome via the
claude-in-chrome MCP tools and tell me what you find as you go. Load the browser
tools in ONE ToolSearch call:
  select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__read_page,mcp__claude-in-chrome__browser_batch,mcp__claude-in-chrome__read_console_messages,mcp__claude-in-chrome__read_network_requests,mcp__claude-in-chrome__javascript_tool,mcp__claude-in-chrome__get_page_text,mcp__claude-in-chrome__find

Start the servers with preview_start ("dev" on 5173 and "backend-api" on 8000) —
never with Bash. Use browser_batch to group clicks/waits/screenshots.

## Ground rules that matter in this repo

- VERIFY, DON'T INFER. The previous session nearly filed two false findings by
  reading config instead of the running system. Specifically:
  - There are TWO env files, `.env` AND `backend/.env`, and they disagree about
    feature flags. `backend/.env` is the one the API loads. To learn what's
    actually live, introspect the running app, e.g.
      .venv/bin/python -c "from backend.main import app; print(sorted(r.path for r in app.routes))"
  - `tsc -p tsconfig.json` checks NOTHING here. Use `tsconfig.app.json`.
  - CI only runs on pull_request and push-to-main, never on feature-branch pushes.
- Screenshots lie about visibility. This app has a confirmed class of bug where
  content sits at opacity 0 while fully in the viewport. When something looks
  blank or missing, confirm with a real measurement before believing it:
    [...document.querySelectorAll('section,div')].filter(el=>{const r=el.getBoundingClientRect();
      return r.height>20 && r.top<innerHeight && r.bottom>0 && parseFloat(getComputedStyle(el).opacity)<0.15})
      .map(el=>({t:el.textContent.slice(0,40),op:getComputedStyle(el).opacity}))
- Distinguish real bugs from HMR artifacts. Another Claude session may be editing
  this same working tree, which triggers vite page reloads mid-interaction. If
  behaviour looks broken, re-test after a clean `navigate` before filing it.
- Don't enter my real personal data into forms. Use obvious test values and say so.
- FEATURE_GLOBAL_SEARCH is off, so no ⌘K palette — don't file that as broken, it's
  already logged as finding 4.2.

## What to cover

Walk every student screen, in this order, and at each one collect: console errors,
failed network requests, empty/loading/error states, and anything visually broken.

1. /dashboard          — home feed, tiles, streaks, XP, nudges
2. /library            — course library, course cards
3. /course/:id         — course view (NOTE: previous session found this route is
                         effectively unreachable from nav; check that)
4. /lecture/:id        — the core study surface. Spend the most time here: slide
                         nav, AI tutor chat, quizzes, progress writes
5. /course/:id/study-guide
6. /review             — SRS review session, grade a few cards
7. /materials          — My Materials (student uploads)
8. /onboarding/upload  — the upload wizard, with a real PDF
9. /exam/:courseId     — exam config → take → report (full flow)
10. /ascent, /leaderboard, /friends, /friends/find, /profile
11. /settings          — verify the GDPR JSON export and account-deletion controls
                         actually work end to end (the privacy policy promises both).
                         Do NOT actually delete the account — confirm the control
                         exists and the endpoint responds, then stop.

Also probe deliberately, don't just click the happy path:
- Back/forward navigation mid-flow, and reload mid-flow. The one confirmed BLOCKER
  so far (finding 8.1) was a Back button leaving a state machine in an unrenderable
  state — look for more of that shape.
- Empty states: what does a course with no lectures, or a review queue with 0 due
  cards, actually render?
- Deep-link a route directly instead of clicking into it.
- Resize to mobile (preview_resize or the computer tool) on the 3 heaviest screens.
- Watch for N+1 request patterns and slow calls in read_network_requests.

## Output

Append to APP_AUDIT_REPORT.md, matching the existing format exactly:
- A table per area with columns: # | Sev | What it is now | What it should be | Evidence
- Severity: 🔴 Blocker / 🟠 High / 🟡 Medium / 🔵 Low
- Every finding needs concrete evidence — a repro table, a DOM measurement, a
  status code. No "might be" findings.
- Note things you verified as WORKING too, so the report doesn't read as
  only-bad-news and so nobody re-audits them.
- Then extend the §7 delivery plan with any new quick-win sessions your findings
  justify, keeping the same value/effort/risk scoring and the merge-order table.
  Flag file collisions between sessions like §7 does.

Start by confirming which student account is signed in and what data it actually
has (how many courses, lectures, due review cards, past exams) — then tell me your
walkthrough order before you start clicking.
```

---

## Why the prompt is shaped this way

- **It front-loads the traps.** The two-`.env` split, the useless `tsconfig.json`, and the
  CI-doesn't-run-on-branches fact each cost the first session real time. Handing them
  over stops the next session rediscovering them.
- **It demands measurement over screenshots.** This app has a confirmed opacity-0 bug class,
  so "it looks fine" is not evidence.
- **It names the HMR confound.** You run concurrent Claude sessions against one working tree;
  without that warning the next session will file phantom bugs, as nearly happened here.
- **It asks for the walkthrough order up front**, so you can redirect before it burns a
  context window on the wrong screens.
- **It asks for what works, not just what's broken** — otherwise the report can't be used to
  decide what's safe to ship.
