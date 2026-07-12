# Learnstation Brand Voice — Calm Competence

## The concept

Learnstation sounds like the student a semester ahead of you who took this exact course, has immaculate notes, and actually shares them. Prepared, honest, calm — and quietly happy for you when you get it.

Not a spaceship. Not a hype machine. Not a corporate deck. The coursemate with the best notes.

This applies everywhere Learnstation speaks: the AI tutor, generated summaries and quizzes, gamification, error messages, onboarding, and marketing. Voice is constant; tone adapts by surface (see below).

## Tone axes

| Axis | Position | In practice |
|---|---|---|
| **Formal ↔ Casual** | casual-leaning | Contractions, short sentences, *du* in German. Never slang, never memes. |
| **Encouraging ↔ Neutral** | encouraging, earned | Praise always names the concrete fact ("5 in a row", "42 of 50", "12-day streak"). No inflation, no stacked exclamation marks. |
| **Playful ↔ Serious** | serious spine | Playfulness is a *moment*, not a vocabulary — allowed in badge names and streak celebrations only. Never in errors, exams, tutor answers, or professor analytics. |
| **Corporate ↔ Plainspoken** | hard plainspoken | Concrete nouns and verbs. No buzzwords: no "next-generation", "AI-powered" as a selling point, "unlock your potential". |
| **Performing ↔ Honest** | fully honest | The product never roleplays — not a spaceship, not a brain, not magic. It says what happened and what's next. |

## Tone by surface

| Surface | Tone |
|---|---|
| Tutor / chat | Patient coach — concise, encouraging, asks leading questions |
| Gamification | Quiet celebration — specific numbers, not hype |
| Errors | Own it, offer the next step — "we" language, never blame the user |
| Exam mode | Calm, zero play — no celebration language mid-exam |
| Professor analytics | Precise colleague — plain data, no coaching-speak padding |
| Marketing | Confident and concrete — claims are provable, not aspirational adjectives |

## Do / don't vocabulary

| ✅ Use | 🚫 Banned |
|---|---|
| start, review, try again, due, ready | neural, synapse, cognitive (as decoration), protocol, telemetry, orbital, mission, evolution, phase |
| lecture, slides, course, quiz, cards, streak, level | "unlock", "supercharge", "master your potential", "revolutionize" |
| numbers as praise: "5 in a row", "30 cards cleared" | "journey" (retire — overused in edtech and already everywhere in onboarding) |
| "we couldn't…" — errors in active voice, owned | "AI-powered", "next-generation", "data-driven" as selling points |
| you/your focus; Luna speaks first-person only in onboarding/companion moments | "Oops!" / "Whoops!" baby-talk; passive-voice errors ("login not possible") |
| keep established loanwords in German: Quiz, Level, Badge, Streak | stacked punctuation ("!!", "?!"), ALL-CAPS drama ("LOCKED PROTOCOL") |

**Banned sci-fi list, explicitly:** neural, synapse, orbital, protocol, telemetry, mission (as a metaphor for tasks), cognitive architecture/evolution, "Hall of Valor" and similar mock-epic framing.

## Five rewrites

**1. Tutor refusal** — the constraint showcase:
- Before: *"This doesn't appear in your course materials…"*
- EN: *"That's not in your lectures, so I won't guess. The closest thing your course covers is [topic] — want to start there?"*
- DE: *"Das kommt in deinen Vorlesungen nicht vor, deshalb rate ich nicht. Am nächsten dran ist [Thema] — sollen wir da reinschauen?"*
- The refusal stays a refusal. Warmer delivery, identical boundary.

**2. Exam feedback:**
- Before: *"Exam Ready Achieved!" / "Mission Completed"* · CTA: *"Send Misses to Review Engine"*
- EN: *"You're exam-ready. 42 of 50 — the 8 you missed are one review away."* · CTA: *"Review the 8 I missed"*
- DE: *"Du bist bereit für die Prüfung. 42 von 50 — die 8 Fehler holst du dir in einer Wiederholung."* · CTA: *"Die 8 Fehler wiederholen"*

**3. Level-up:**
- Before: *"Synapse Evolution Confirmed — Cognitive architecture upgraded. Your integration with the Orbital protocol has reached the next phase."* · CTA: *"Continue Mission"*
- EN: *"Level 12 — that's 300 correct answers and counting. Keep it rolling."* · CTA: *"Keep going"*
- DE: *"Level 12 — 300 richtige Antworten, und es werden mehr. Weiter so."* · CTA: *"Weitermachen"*

**4. Error toast:**
- Before: *"Error" / "Failed to load lecture."*
- EN: *"We couldn't load this lecture. Try again — if it keeps happening, tell us."*
- DE: *"Wir konnten die Vorlesung nicht laden. Versuch es noch einmal — wenn es wieder passiert, sag uns Bescheid."*

**5. Marketing:**
- Before: *"The next-generation learning platform. AI-powered, data-driven, and built for the future of education."*
- EN: *"Built for one thing: turning your lectures into knowledge that sticks. The tutor only answers from your course — nothing made up."*
- DE: *"Für eine Sache gebaut: aus deinen Vorlesungen Wissen machen, das bleibt. Der Tutor antwortet nur aus deinem Kurs — nichts ist erfunden."*

## German register — the rules

- **Du, everywhere.** Students and professors both. No Sie anywhere in the product.
- **German warmth is drier, not weaker.** Don't translate exclamation marks — "Nice work!" lands as "Gut gemacht." (period). Equally sincere, differently expressed.
- **Errors keep "wir"-ownership.** "Wir konnten dich nicht anmelden" — never the passive-bureaucratic "Anmeldung leider nicht möglich".
- **Gender-inclusive forms, consistently.** "Dozent:in", "Studierende:r", "Nutzer:in" — this is policy, not a one-off choice.
- **Structure over syntax.** Split long German sentences rather than mirroring English rhythm; German compounds punish literal translation.
- **AI output**: the tutor and professor-chat surfaces answer in the language the user writes in. Generated content (summaries, quizzes, taglines) stays English for now — a deliberate, scoped-down first step.

## Naming

**Learnstation.** One word, capital L only. Not "LearnStation", not "Learn Station", not "Ascend" or "Ascend Academy" on any user-facing surface.

## Hard constraint — groundedness is untouchable

Tone is a coat of paint on the grounding rules, never a solvent. The tutor's retrieval-only answers, citation enforcement, and refusal behavior are never softened, hedged, or "made friendlier" by a tone change. A refusal stays a refusal, warmly delivered. This is the product's actual differentiator — an AI that says "that's not in your lectures, so I won't guess" is the brand, not a limitation to apologize for.

## Voice checklist — paste into PRs and prompts

- [ ] No banned sci-fi words (neural, synapse, orbital, protocol, telemetry, mission-as-metaphor, cognitive-as-decoration)
- [ ] No buzzwords ("AI-powered", "next-generation", "unlock your potential")
- [ ] Praise is specific (a real number), not inflated ("Awesome!!", "Flawless!")
- [ ] Errors are owned ("we couldn't…"), never blame the user, offer a next step
- [ ] DE uses *du* throughout, gender-inclusive forms, no translated exclamation marks
- [ ] New user-facing strings are in an i18n namespace, not hardcoded — both EN and DE added
- [ ] If it's an AI prompt: composed with `backend/services/ai/voice.py`'s `with_voice()`, not a bespoke persona
- [ ] Tutor/grounding logic is untouched by any tone edit — a refusal stays a refusal
- [ ] Product is called "Learnstation" — one word, capital L
