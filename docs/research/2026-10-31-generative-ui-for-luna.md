# How ChatGPT answers with cards, and how Luna can

*Research note, 2026-10-31. Prompted by screenshots of ChatGPT teaching a lesson with a diagram card, an exercise card, a radio-button check and a "Next lesson" button inside the answer. Question: how does it do that, and what would it take here?*

## The mechanism in one paragraph

The model never draws the card. It emits structured data in a shape the client already knows, and the client has one pre-built React component per shape. A heading, a flow diagram, an exercise, a check with options, a button that continues the conversation: each is a typed block. The model fills the fields; the client renders them in the house style. Anything malformed falls back to plain text, so a broken card never shows. The industry name for this is generative UI with a curated catalogue.

## Three ways it is done today

### 1. Host-level apps: OpenAI Apps SDK and MCP Apps

What ChatGPT itself uses for third-party apps. A tool result carries `structuredContent` (what the widget renders), `content` (a text summary for the model) and `_meta` with a pointer to a predeclared `ui://` HTML template. The template runs in a sandboxed iframe and talks to the host over JSON-RPC: `tools/call` to fetch more data, `ui/message` to put a follow-up into the conversation. That last one is exactly what a "Next lesson" button does: it calls a data tool for the next step, renders it, and sends a follow-up message so the model knows.

The open version is the MCP Apps extension (SEP-1865, final, co-authored by the MCP maintainers at OpenAI and Anthropic with the MCP-UI team). Same shape: `ui://` resources, `text/html;profile=mcp-app`, sandboxed iframe, auditable messages, hosts may require user consent for UI-initiated tool calls.

**For Learnstation:** this is the wrong layer. It exists so that a *third party* can put UI into *someone else's* chat. We own both ends. We do not need iframes, a bridge or a CSP declaration to render our own cards in our own app. The lesson to take from it is the split: data the model reads, data the card renders, metadata that names the card.

### 2. Catalogue-constrained spec renderers: json-render, A2UI, Thesys C1

Frameworks where you define a catalogue of components with Zod prop schemas and the model streams a JSON spec limited to that catalogue.

- **json-render** (Vercel Labs, Apache-2.0): `defineCatalog(schema, { components, actions })`, `defineRegistry(catalog, { components })`, `<Renderer spec registry />`. Streams the spec as patches through `createSpecStreamCompiler`, so cards fill in progressively. Supports `$state`, `$cond`, `visible`, `emit("press")` actions. Experimental by Vercel's own description.
- **A2UI** (Google, hosted by CopilotKit): a declarative protocol of JSON messages describing components, layouts and data bindings, rendered by the client's own trusted components. Two modes: fixed schema, or a second model generating the schema.
- **Thesys C1 / OpenUI**: a hosted generative-UI engine with its own compact language; vendor claims about token savings, unverified.

**For Learnstation:** these solve a problem we do not have. They are for products where the model must compose *layouts* from a general-purpose catalogue. Luna has a small, opinionated vocabulary, and layout is ours, not the model's. Adopting one would add a dependency and a second component system next to the stage primitives. The idea to take is the discipline: a catalogue with schemas, a renderer that never trusts props, streaming that fills cards progressively.

### 3. A typed block registry of our own

Which is what Learnstation already has, in three places:

| Where | What | Status |
|---|---|---|
| `backend/services/luna/prompts.py`, `validate.py` | Luna sessions in the reader. The model may use at most three **blocks** per turn: `text`, `key`, `explore` (parts with a `spot`, exact words from the page), `compare`, `steps`. A session has a **plan** of 3 to 5 steps of kinds `look`, `explain`, `ask`, `check`, `teachback`, `connect`. Turns stream over SSE (`say`, `blocks`, `plan`, `target`, `luna`, `learner`, `end`). | Live in prod since 2026-10-30 behind `FEATURE_LUNA_SESSIONS`. |
| `src/features/spaces/studio/answers/Blocks.tsx` | One component per block type on one base, "a quiet card". Includes `compare` and subject cards such as `fdTable`, `closure`, `bcnf`. | On main. |
| `src/features/askLuna/protocol.ts`, `backend/services/ai/ask_luna.py` | The gen-UI prototype: a turn is `{ parts }`, text or a named widget with Zod props, validated on both ends; two widgets, `JoinPlayground` and `ConceptCheck`. Widgets compute their own answers; the model picks what to practise, never what is correct. | Prototype, behind `FEATURE_ASK_LUNA`. |

So the research answer is short. The thing in the screenshots is a typed block registry with progressive rendering and a continuation button. We have the registry and the streaming. What we do not have is one vocabulary shared by every place Luna speaks, and the home chat does not use it at all.

## What the home chat uses today, and the gap

The home ask bar calls `POST /api/v1/v4/ask`, which returns prose plus page citations. The lab on `/v4/lab/home-chat` renders that prose word by word and lights the cited pages. It cannot show a diagram, a check or a next step because the shape it receives has no room for them.

The reader's Luna sessions already receive the right shape. The gap is a Space-level entry point and a shared renderer.

## Recommendation

**Build on the Luna session blocks. Do not adopt a framework. Do not add an iframe layer.**

1. **One vocabulary.** Fold the Ask Luna prototype's `ConceptCheck` into the session block list as a `check` block (it already exists as the `check` step kind), and let `JoinPlayground` be the first subject-specific interactive block. Retire `parts` in favour of `blocks`. One Pydantic model set on the backend, one Zod set on the frontend, both already exist and need merging rather than writing.
2. **One renderer.** `Blocks.tsx` becomes the renderer for the reader, the studio and the home chat. The home chat lab's paper, trail and inline page marks are the citation layer under it: every block carries `lecture_id` and `page`, and `explore` already carries a `spot`, which is the exact line to wash on the paper.
3. **Progressive, block by block.** Stream whole validated blocks over the existing SSE, not partial JSON. A block is small enough to arrive as one event; the word-by-word reveal we built stays for `text` and `key`. This avoids tolerant partial-JSON parsing on the client, which the literature consistently flags as fragile, and keeps validation strict.
4. **Interactive blocks compute their own truth.** Keep the prototype's rule. A `check` block carries options and which is correct as data the model wrote, but the *grading* and the hint ladder live in the component, and a wrong answer key is caught by the same validator that already requires exactly one correct option.
5. **Continuation is a plan, not a button.** The "Next" in the screenshots is a follow-up message the widget sends. Luna sessions already have a plan with steps and statuses. On Home, a session scoped to a Space rather than a Lesson gives the same affordance: the offered chips in the lab become the next plan step, and "Next" is just the first of them.
6. **Rules carry over.** Hairline cards, the Lesson's accent, no eyebrow labels, one fact once. The flow diagram block in the screenshot would be drawn from the Lesson's own Concepts, the planets the map already has, not from free text.

## What this needs, in order

1. A Space-scoped session start on the backend (today `start` takes a `lecture_id`; Home asks across a Space). Mostly plumbing in `session_service.py`.
2. The block schema union: session blocks plus `check` plus the interactive widgets, validated in `validate.py` and `protocol.ts`.
3. `Blocks.tsx` learning the two or three block types it does not have yet, drawn to the stage rules, and a `page` prop so the lab's paper can follow it.
4. The lab switched from `/v4/ask` to the session turn stream. The transition, Luna's glance, the trail and the following thread stay as they are.
5. Then the product step: into Home behind a flag, with i18n and the motion tests.

## Sources

- OpenAI Apps SDK, custom UX: https://developers.openai.com/apps-sdk/build/custom-ux
- MCP Apps, SEP-1865: https://modelcontextprotocol.io/seps/1865-mcp-apps-interactive-user-interfaces-for-mcp
- MCP blog, MCP Apps announcement: https://blog.modelcontextprotocol.io/posts/2025-11-21-mcp-apps/
- Vercel Labs json-render: https://github.com/vercel-labs/json-render
- The New Stack on json-render: https://thenewstack.io/vercels-json-render-a-step-toward-generative-ui/
- A2UI via CopilotKit: https://docs.copilotkit.ai/ms-agent-python/generative-ui/a2ui
- Agentic UI frameworks comparison (June 2026): https://agentic-ui-frameworks.pages.dev/
- Generative UI in 2026, developer guide: https://www.alexcloudstar.com/blog/generative-ui-developer-guide-2026/
- Streaming structured output, TanStack: https://tanstack.com/blog/streaming-structured-output
- Progressively updating UI with FastAPI streamed structured responses: https://www.timlrx.com/blog/progressively-updating-ui-with-fastapi-streamed-structured-responses
- How the OpenAI Apps SDK works (third-party): https://tollbit.com/blog/how-openai-apps-sdk-works
- ChatGPT study mode: https://openai.com/index/chatgpt-study-mode/
