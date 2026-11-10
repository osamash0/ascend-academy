# Review pass (e): language — unclear sentences, undefined terms, inconsistencies between chapters

*2026-11-10, night. Second-examiner reading. Nothing in the thesis was edited; this file is the only output.*

**Basis.**
- The committed text at `thesis/finishing-pass-restored` **3b2af08d**, which has passes (a), (b) and (c) applied. It was read from a frozen snapshot, so concurrent edits do not shift it.
- File:line refers to 3b2af08d.
- Pages come from the PDF built at 20:35 (107 pages; **printed page = PDF page − 14**). That build also contains an uncommitted edit of Chapter 4: a new Figure 4.2 (F25). Chapter 4 pages after p. 25 can therefore be one page off against the committed source.
- One commit landed during the pass, `daa743b6` (25 lines in the abstract, Ch. 6, Ch. 7 and App. C). It does not touch the findings below except where noted.

**Scope.** Language only, in three parts:
- unclear or misleading sentences;
- terms used before they are defined, or never defined;
- the same thing named differently in different places.

Skipped: `\TODO` markers, the declaration, the co-authorship wording and the five-subject rule.

**How it was checked.**
- Three checkers each read one part of the thesis, sentence by sentence, as a reader new to the project: abstract and Ch. 1–3; Ch. 4–5 with their appendix sections; Ch. 6–7 and the appendices.
- I counted every term family across all chapters (script `e/terms.py` in the session scratchpad, LaTeX comments stripped). Cross-chapter inconsistencies only show up that way.
- I re-checked every *blocks* finding and the main *weakens* findings against the source. One checker claim did not survive, and its finding was downgraded (B12, below). The checkers dropped about 95 candidates after checking; the notable ones are at the end.

**Result.** 73 findings: 6 block, 55 weaken, 12 cosmetic.

| Part | Findings | Severity |
|---|---|---|
| A, one word for several things | 15 | 3 block, 9 weaken, 3 cosmetic |
| B, sentences that mislead | 12 | 3 block, 8 weaken, 1 cosmetic |
| C, undefined terms | 1 finding with a table and one remedy | weakens |
| D, chapter by chapter | 45 | 0 block, 37 weaken, 8 cosmetic |

**Correction to my earlier passes.** Several undefined phrases in the abstract and Chapter 7 are wordings I proposed in passes (b) and (c), and they have since been adopted:
- "five of them pass the corrected test" (pass b N1);
- "four when pages are resampled" (pass c M3);
- "the view stayed silent in 14 of 18 cases where it should" (pass c M8).

They were accurate but written for a reader who had seen the review, not the thesis. B5 and Part C give replacements that a reader new to the project can follow.

---

## Part A. One word for several things

These fifteen words and names cause most of the confusion. Each item gives a convention, and one paragraph in §3.2 ("Vocabulary and Roles") could state them all.

### A1 (blocks). "Author" means four different people or things

- **Where:** about 60 uses. Four senses:
  - **The person who wrote the material:** abstract:9; 01:20, 25, 65, 73, 98; 02:163–164, 234, 249–251; 03:51; 07:270.
  - **The writer of this thesis:** abstract:35; 01:52, 167, 171; 02:51; 03:39; 04:81, 92, 305, 320, 333, 340, 403, 535, 552–553; 05:552; 06:397; 07:36, 192, 206, 260; C:253.
  - **The model that wrote a question:** 06:27–28, 259–260, 265–266; C:308.
  - **Both developers:** 02:256, "the authors' own reading".
- **Quoted:**
  - "Where it cannot, a second look that is independent of the author decides." (p. 45, `06-trust.tex:27-28`)
  - "First, the checker is not the author." (p. 49, `06-trust.tex:259-260`)
  - "when the author's own model family checked the question that started this work, it agreed with the wrong key twice" (p. 49, `06-trust.tex:265-266`)
  - "The author audited the author's system." (p. 58, `07-conclusion.tex:206`)
- **What is wrong:**
  - By Chapter 6 the reader knows "the author" as the person who judged the benchmark. Read that way, "independent of the author" says the check is independent of the thesis writer, and "the author's own model family" reads as the thesis writer's model.
  - The person who receives feedback is "the author" in Chapters 1, 2 and 7 but "the owner" in Chapter 5 (44 uses), and the abstract switches senses within 26 lines.
  - Both abstracts carry the clash: "ihrer Autorin oder ihrem Autor" and "Der Autor war der einzige Urteilende".
- **Proposed:** state once in §3.2 and keep:
  - **owner:** the person who uploads material and receives the view. This is already the code's word and Chapter 5's.
  - **the author:** only the writer of this thesis.
  - **the generating model:** the model that wrote a question.

  Then:
  - 06:27–28: "Where it cannot, a second model that did not write the content decides."
  - 06:259–260: "First, the model that checks a question is not the model that wrote it."
  - 06:265: "when a model of the generating model's own family checked the question that started this work …"
  - 01:20: "cannot tell its owner that half of the readers stopped at page twelve."
  - 02:256: "was the two developers' own reading".
  - 07:270: "its owner can see".
  - German abstract: "der Besitzerin oder dem Besitzer".

### A2 (blocks). "The reader" is both the software and a person, and its views are counted two, three and four ways

- **Where:** about 70 uses of "reader".
  - **The screen:** 02:110, 135; 03:95; 04:54, 115, 152–153, 532; 05:45, 75, 82–83, 92, 342, 415; 06:44, 55, 138, 153, 172, 194, 197, 203, 277, 487, 521; 07:52, 90, 227.
  - **A person:** 01:24, 99, 110; 02:251–252; 03:50, 58; 05:73, 420–426, 510, 561; 06:184; 07:56, 248.
  - **A second reviewer:** 07:176, 208.
  - **The number of views:**
    - p. 14, `03-system.tex:105`: "read it in two views (the original page and a text written from it)".
    - p. 45, `06-trust.tex:44-45`: "the uploaded page is the first of three faces of a Lesson".
    - p. 59, `07-conclusion.tex:255`: "a third view of a page, which rebuilds its layout as text".
    - The code at the pin has three views: page, explain and text (`LessonFacesScreen.tsx`, `type View = 'slide' | 'explain' | 'text'`).
- **Quoted:**
  - "The reader \emph{records} it through a single writer." (p. 33, `05-loop.tex:45`). Twelve lines of the same chapter later: "lets scripted readers write five of the eight event types the reader writes" (`05-loop.tex:414-415`).
  - "eight of which the reader writes … A hotspot needs one confused reader among five" (p. 55, `07-conclusion.tex:52-56`).
- **What is wrong:**
  - The screen that writes events and the people whose events they are share one noun, sometimes within one sentence.
  - §3.2 defines Space, Lesson, page, idea, Library and Luna, but not the screen.
  - "Faces" is never defined.
  - The views are counted two, three and "a third" (that is, four).
- **Proposed:** add to §3.2: "The *reading view* is the screen in which a Lesson is read. It has three views of each page: the original page, which opens first; Explain, a text a model writes about the page; and the page's plain text. A *reader* is a person."

  Then:
  - 05:45: "The reading view records it through one function, `record_event`, which governs it."
  - 07:52: "eight of which the reading view writes".
  - 03:105: "read it in three views".
  - 06:44: "the uploaded page is the first of the three views" (drop "faces").
  - 07:255: "a fourth view of a page, which rebuilds its layout as text".
  - Table 5.1 column: "Reading view". Row text: "a member turned back".

### A3 (blocks). "v4" is both the fourth parsing pipeline and the current interface

- **Where:**
  - **Pipeline:** 04:83–88; 07:110; C:138–141.
  - **Interface:** 03:35, 95, 130, 169, 182, 184; 04:132, 151, 157; C:73, 172; Fig. B.1.
- **Quoted:**
  - "the commit that introduced v5 names server-side writing as the first of the two things v4 could not do" (p. 20, `04-content.tex:85-86`)
  - Two pages later: "the v4 interface polls the run every three seconds" (p. 22, `04-content.tex:151`)
- **What is wrong:** within one chapter, "v4" names a pipeline replaced in June and an interface that went live in October. Table C.2's "v4 prompts" and C.4's "The v4 route" mix the two again.
- **Proposed:** write "pipeline v1 … v5" everywhere a parser version is meant, and "the current interface" for the interface. Mention "v4 in the repository" once, at 03:35, with "a label unrelated to the pipeline versions of Section 4.2". For example, 04:85–86: "… the first of the two things pipeline v4 could not do"; 07:110: "pipelines v2, v3 and v4, and the external extractors that fed pipeline v4".

### A4 (weakens). "Shipped" and "live" against "deployed"

- **Where:** p. 25, `04-content.tex:323-325`; :341–342; :106, :220; App. C Table C.2 (`appendix-c-detail.tex:148-149`, p. 86); Fig. 4.2 caption.
- **Quoted:** "The rule that shipped at the pin (vision for a page under 25 footer-free characters, …)"; then "The new rule had not been deployed at the pin."; and Table C.2: "Live at the pin."
- **What is wrong:**
  - "Shipped" and "live" normally mean "in production", which the next page denies.
  - "Live" is also used for "the code path that runs" ("One pipeline is live", "eight of them are live").
  - The 150-character bound in the rule is not marked as footer-free, and raw against footer-free is the whole point of the study.
- **Proposed:**
  - Define once in §1.4: "*In the code* means reachable at the pinned revision; *deployed* means running in production."
  - Then 04:323: "The rule in the code at the pin (vision for a page with fewer than 25 footer-free characters, or with fewer than 150 footer-free characters and figures covering at least 5 % of it) sends 87 pages of the corpus to vision."
  - Table C.2: "In the code at the pin; not yet deployed."

### A5 (weakens). "Gate" has three meanings

- **Where:**
  - **A run-time filter:** "refusal gate" (01:159, 02:103, 06:99), "structural gates" (06:243), "semantic gate".
  - **An acceptance criterion of an evaluation:** "the gate (at most two calibration errors …)" (06:321), "failed its gate" (06:357), "a gate fixed first" (06:378).
  - **A human approval step:** §6.6.1, "No Human Gate".
- **Quoted:** "Unlike the semantic gate, the answer check was not held to a gate fixed in advance." (p. 51, `06-trust.tex:374-375`)
- **What is wrong:** the sentence uses two of the three senses, and "The gate was measured in one Space" (06:426) can only be read by guessing which one.
- **Proposed:** keep "gate" for run-time filters only. Use "acceptance criterion" at 06:321, 333, 357, 378 and 527, and "No Human Approval" for §6.6.1. Then 06:374: "Unlike the similarity score, the answer check was not held to an acceptance criterion fixed in advance."

### A6 (weakens). "Figure" is a float, a picture on a page and a headline number, and "figure page" means 421 or 75 pages

- **Where:**
  - Ch. 5: 05:50, 242–247, 278–279, 496–503; Table 5.3; Fig. 5.1.
  - Ch. 4: 04:71, 205–208, 318, 326, 335–338; Fig. 4.2 item (5).
- **Quoted:**
  - "Beside the findings the engine computes three figures, each for the last eight weeks" (p. 36, `05-loop.tex:242`)
  - "all three figures were empty", on the page with Figure 5.2
  - "The new rule sends 87 pages … at the cost of one vision call per figure page." (`04-content.tex:208`)
- **What is wrong:**
  - In Chapter 5 a reader looks for a float called Figure.
  - In Chapter 4 "figure page" means the 421 pages that contain a figure block (04:205, 336). It also means the 75 that the figure branch routes (04:326, 335). Read the first way, the sentence promises 421 calls.
- **Proposed:**
  - Ch. 5: "three numbers" (or "measures"), and "the view shows the current week's value and the eight weeks as bars".
  - Ch. 4: "page with a figure" for the 421, and "figure-carried page" for the 75. Then 04:208: "The new rule sends 87 pages to vision: the 12 pages without text and 75 of the 421 pages with a figure, at one vision call each."

### A7 (weakens). "Owner" has three senses

- **Where:**
  - **The owner of a Space**, as §3.2 defines it.
  - **The uploader of a file:** 04:223, 230–232, 245–247, 522–524; C:158–162, 172, 190–199.
  - **The database role that owns a function:** 05:396; C:384 ("functions that run with the rights of their owner").
- **What is wrong:**
  - The same key is called "user" (04:223), "owner" (04:230) and "uploader" (04:522).
  - Inside that passage, "While the lock is available" means "while Redis is reachable", but reads as "while nobody holds the lock".
- **Proposed:** "uploader" in Chapter 4 and C.4, and "defining role" in the security text. Then 04:230: "While Redis, which holds the lock, is reachable, these mechanisms give at most one parse per uploader and pipeline version, unless a re-parse is forced."

### A8 (weakens). "We" is the two developers, the author alone, and the authorial plural

- **Where:** 51 uses.
  - **Both developers:** 01:31, "a web application that we built"; 01:52, "We started from five problems that the author and the co-developer observed".
  - **The author's own acts:** 05:408–435, "we asked … we wrote down … we added two arms"; 05:73, "We chose to lose an event"; 06:395, 443.
  - **The voice of the thesis:** 01:101; 02:97; 04:396; 06:80, 366.
- **What is wrong:**
  - **One person, two names.** The same person is "we" and "the author" in nearby sentences. 04:396 says "we read H1 as a statement about this judge"; 04:403, "The judge was the author". 05:408 says "we asked a narrower question"; 05:552, "the author who wrote the engine".
  - **Ownership is unclear.** Design decisions are claimed with "we" without saying whose they were, and 07:207 has "our own code".
  - **Why it matters here.** This touches the open co-authorship item, but the inconsistency is in the language whatever wording is agreed.
- **Proposed:**
  - **Convention.** State once in §1.5: "*We* is the voice of this thesis. Acts of the author (judging, labelling, writing expectations) are attributed to *the author*; where both developers acted, the text says so."
  - **Examples.**
    - 05:429: "Before the first run the author wrote down, for every arm, …"
    - 05:73: "The design loses an event rather than fail a reader."
    - 01:31: "a web application that the author built with a fellow student."

### A9 (cosmetic). "Pin" is never defined as a noun and means three things

- **Where:**
  - "The pin" as a noun: first at p. 24, `04-content.tex:275`; then 04:324, 342, 490; 05:195, 199, 520; 06:262; C:149.
  - "Pinned" for something else: "16 pinned pairs" (abstract:31, 07:80); "tests now pin them" (07:129); "They are pinned by 11 property tests" (06:460).
- **Proposed:**
  - §1.4: "The thesis describes the code at revision dfc20df6 of 6 November 2026, called *the pin* below."
  - Elsewhere, "16 fixed pairs" and "enforced by tests".

### A10 (weakens). The two interfaces have eleven names between them, and "rooms" is never defined

- **Where:**
  - **The new interface:** "v4 interface", "v4 application", "v4 app", "current interface", "current reader" (Ch. 3–7).
  - **The old interface:** "first interface", "older interface", "older rooms", "older lecture rooms", "classic lecture tutor" (Fig. 2.1), "classic console" (Fig. B.1), "older dashboard", "professor dashboard" (Ch. 2, 3, 5, 6, 7, App. B).
- **Quoted:** "The older rooms still exist in the code and are no longer where learners are sent." (p. 13, `03-system.tex:41`)
- **Proposed:**
  - Use "the current interface" and "the older interface" throughout, and "the older interface's dashboard for professors" where that dashboard is meant.
  - If "rooms" stays, define it at 03:41: "the screens of the first interface, one per course, lecture and professor, which the project calls rooms".
  - Replace "classic" with "older" in the Fig. 2.1 and Fig. B.1 captions.

### A11 (cosmetic). Course, lecture and slide come back after Chapter 3 retires them

- **Where:**
  - **§3.2:** at 03:72–75, §3.2 says these words "belong to the older interface and to the database".
  - **Chapter 4:**
    - 04:139: "Parsing a lecture takes minutes".
    - 04:147–150: "create the lecture row; synthesise the slides … every slide is inserted".
    - 04:195–197: "the raw text is kept and the slide is flagged", in the same sentence as "a page".
    - Chapter 4 never says "Lesson".
  - **Chapter 6:**
    - 06:50, section title: "Answers Grounded in the Lecture".
    - 06:353: "in a German lecture".
    - 06:133–134: "course tutor".
  - **Appendix:** App. A labels "(lecture / course)" and "(total / per slide)".
- **What is wrong:** some uses are database rows, which §3.2 allows. Others are the product's Lesson and page, and within one sentence page and slide read as two objects.
- **Proposed:**
  - One sentence at the start of §4.3: "Here *lecture* and *slide* name the database rows that hold a Lesson and its pages."
  - 04:197: "the page is flagged for review".
  - 04:139: "Parsing a document takes minutes".
  - §6.2 title: "Answers Grounded in the Space".
  - 06:353: "in a German Lesson".
  - App. A: "(one Lesson / one Space)", "(total / per page)".

### A12 (weakens). Explain is Luna in Chapter 3 and not Luna in Chapter 6

- **Where:**
  - **Chapter 3:** p. 14, `03-system.tex:71-72` ("Luna is the assistant; she explains a page, asks about it, and runs short practice sessions") and 03:106 ("ask Luna to explain a page").
  - **Chapter 6:** p. 45, `06-trust.tex:53-55` ("a study session with the assistant, Luna; and Explain and Ask on a single page of the reader"), and §6.2.4, "Luna and the Reader".
- **What is wrong:**
  - Chapter 6 treats Explain and Ask as surfaces separate from Luna, with other context and other checks. A reader cannot tell which checks apply to which surface.
  - "Asks about it" (Luna asks) also collides with Ask (the learner asks).
- **Proposed:**
  - 03:71–72: "Luna is the assistant of study sessions; she works through pages with the learner and runs short practice. On a single page, the reading view offers Explain, a text a model writes about the page, and Ask, which answers a question about it."
  - Align 03:106.

### A13 (weakens). One mechanism, many names

- **The answer check:** "answer check", "independent check", "independent model" (abstract), "an independent second reading" (06:515), "a second look" (06:27), "Independent answer check" (Table 6.1).
- **The lexical verifier:** "lexical overlap", "lexical score", "lexical verifier", "lexical module", "lexical rule" (07:83).
- **The similarity verifier:** "embedding similarity", "similarity score", "semantic gate", "semantic similarity gate" (abstract, 07:84).
- **The citation check:** "citation check" (06:103), "citation range" (06:202).
- **The production extractor, eight names:** "v2's PyMuPDF engine", "the current extraction", "current", "the production extractor", "PyMuPDF's plain text layer", "the text layer", "the cheapest path", "the current text layer" (04:93–538). "Text layer" also means the PDF's embedded text, and "the block extractor" (04:303) is never related to any of them.
- **What is wrong:** in the RQ3 answer, "an independent second reading" reads as a fourth mechanism. In Chapter 4, "the layout-aware PyMuPDF path" (04:538) reads as the production path, but it means pymupdf4llm.
- **Proposed:** fix one name each and use it everywhere:
  - "the answer check"
  - "the lexical score"
  - "the similarity score"
  - "the citation check"
  - "the current extraction"
  - "pymupdf4llm", always by name

  Then 06:515: "By the answer check, for the quiz questions written during parsing: a different model answers each question from its cited page without the key …"

### A14 (cosmetic). Flag, marker and probe each have two meanings

- **Flag:**
  - **Meanings:** a feature switch (Ch. 3, 07:142); a mark on a question (06:221, 245–249, Table 6.1 "flags only"); a mark on a slide (04:197, 06:481).
  - **Gap:** the thesis never says what a flagged question does: whether it reaches learners, and who sees the flag.
- **Marker:** prompt fence delimiters (06:96–97, explained only at 06:191) and a `[Source N]` tag (06:110), fourteen lines apart.
- **Probe:** the 16-pair verifier probe (Ch. 6), "verification probe" (07:193), the readiness probe (C:68), and the production checks "written into the runbook" (07:177–178).
- **Proposed:**
  - **Flag:** use "feature flag" and "review mark", and say once "a marked question is still shown to learners" (the author must confirm this).
  - **Marker:** "fence delimiters" and "`[Source N]` tags".
  - **Probe:** "the probe" only for the 16 pairs; "the checks against production" at 07:177.

### A15 (weakens). An idea is one page in the text and several slides in the figure

- **Where:** p. 14, `03-system.tex:70` ("An *idea* is one thing a page teaches") against the Fig. B.2 note (`f5-domain-model.puml:104`: "an Idea is a run of Slides an LLM groups on demand").
- **What is wrong:** §3.2 points to Fig. B.2 for "the vocabulary as a domain model", and the two definitions disagree.
- **Proposed:** the author must decide. If the figure is right: "An *idea* is one thing the material teaches, a run of consecutive pages that a model groups on demand."

---

## Part B. Sentences that say something the thesis does not mean

### B1 (blocks). "The original page stays one key away"

- **Where:** p. 45, `06-trust.tex:28-29`.
- **Quoted:** "Where neither is possible, the system says so, and the original page stays one key away."
- **What is wrong:** §6.1 (06:44–45) and the RQ3 answer ("the first thing a learner sees") make the original page the default view; it is the generated text that is one key away. "The system says so" has no referent, since nothing tells a learner that prose is unchecked.
- **Proposed:** "Where neither is possible, nothing checks the content, and the original page, which a learner sees first, remains the reference."

### B2 (blocks). "Whatever fails a check is dropped" and "a check that fails drops its item"

- **Where:** p. 45, `06-trust.tex:30`; p. 53, `06-trust.tex:490-492`.
- **Quoted:** "Whatever fails a check is dropped, not shown." / "… which is why a check that fails drops its item and never passes it through for a human to catch."
- **What is wrong:**
  - **Not every check drops.** The lexical score and the number and distractor checks only flag (06:245–249; pass (b) N4).
  - **"A check that fails" means a broken check.** When the check itself fails, the question is *kept* (06:269–270). The second sentence therefore states the opposite of the outage rule.
- **Proposed:** 06:30: "Most checks drop what fails them; the few that only mark an item are named where they occur." 06:490–492: "… which is why an item that fails a check is dropped rather than passed on for a human to catch."

### B3 (weakens). "Generated questions pass a check before a reader sees them"

- **Where:** p. 11, `02-background.tex:250-252`.
- **Quoted:** "every reader gets the same content, the author gets a view of how it is read, and generated questions pass a check before a reader sees them."
- **What is wrong:**
  - Only quiz keys get the answer check, and when the check is unavailable the question is kept (abstract; Ch. 6).
  - The owner's view is not deployed (03:111).
  - "Author" here means the owner (A1).
- **Proposed:** "every reader gets the same content, the owner gets a view of how it is read (built, not yet deployed), and generated quiz questions are checked before a reader sees them unless the check itself is unavailable."

### B4 (weakens). "Generated questions are graded by computation"

- **Where:** p. v and vi, `abstract.tex:29-30` and its German counterpart.
- **What is wrong:** §6.4.2 grades the learner's *answer* against a result computed from the question's data. As written, the questions themselves are being scored.
- **Proposed:**
  - EN: "Third, where the answer to a generated question can be computed, a learner's answer is graded against the computed result and not against the key the model wrote."
  - DE: "Drittens wird die Antwort auf eine generierte Frage, wo sie sich berechnen lässt, gegen das berechnete Ergebnis bewertet und nicht gegen den Schlüssel des Modells."

### B5 (blocks). "Nine … five … four" reads as a partition, and "the corrected test" is never named outside Chapter 4

- **Where:** p. v, `abstract.tex:20-23` (and DE); p. 18, `03-system.tex:207`; p. 55, `07-conclusion.tex:41-43`.
- **Quoted:** "Nine of the ten alternatives are rated above it, five of them by the corrected test and four when pages are resampled …" (Ch. 7)
- **What is wrong:**
  - The sentence reads as 9 = 5 + 4. In fact the four are the subset of the five that survive page resampling.
  - A test does not "rate".
  - "The corrected test" is defined only at 04:399–401.
  - The German abstract adds "statt Urteile", which the English lacks.
  - These wordings came from my passes (b) and (c); see the correction above.
- **Proposed:** "Nine of the ten alternatives score above it. Five of them stay above it at the lower end of a bootstrap interval corrected for testing ten methods at once, and four still do when pages rather than votes are resampled." Use the same wording in all three places.

### B6 (weakens). The 18-of-23 sentence nests three counts

- **Where:** p. 56, `07-conclusion.tex:59-64`, and the abstract's "the view stayed silent in 14 of 18 cases where it should".
- **Quoted:** "… 18 of 23 expectations that were written down before the run were met, nine of them in the control arm: four of five that a finding must appear, and fourteen of eighteen that the view must stay silent, of which an engine that reports nothing would meet sixteen."
- **What is wrong:**
  - The colon seems to break down "nine of them in the control arm", but 4 + 14 breaks down the 18. The sentence runs to 60 words.
  - The abstract's "where it should" is missing "have stayed silent".
- **Proposed:** "In a study with scripted readers in eight arms, 18 of 23 expectations written down before the run were met, nine of them in the control arm. Of the five expectations that a finding must appear, four were met; of the eighteen that the view must stay silent, fourteen were met, where an engine that reports nothing would have met sixteen." Abstract: "… and the view stayed silent in 14 of the 18 cases in which it should have."

### B7 (weakens). The Method paragraph names seven studies before any is introduced

- **Where:** p. 4, `01-introduction.tex:156-162`.
- **Quoted:** "The extraction benchmark, the semantic gate of the verifier probe, and the re-run of the refusal gate fixed their expectations in a commit before the run. The expectations of the persona study …"
- **What is wrong:**
  - Seven names appear without a gloss or a reference: semantic gate, verifier probe, refusal gate, persona study, routing study, deck-plan scorecard, answer check.
  - A study cannot "fix its expectations".
  - "Persona study" is never used again; Chapter 5 says "a study with scripted readers".
- **Proposed:** "Three evaluations had their expected outcomes committed before they were run: the extraction benchmark (Section 4.5), the test of a similarity verifier on a fixed set of 16 question pairs, and the repeated measurement of the tutor's refusal threshold (both Section 6.5). The expectations of the study with scripted readers (Section 5.8) were written before its first run but committed together with its results. The routing study, the deck-plan scorecard (Section 4.5) and the measurement of the answer check (Section 6.5) had no expectations fixed in advance."

### B8 (weakens). "All backend writes go through one function", but members insert directly

- **Where:** p. 33–34, `05-loop.tex:45-47, 67-69`; p. 35, `:133-134`; p. 44, `:561`.
- **Quoted:** "written through one function that never fails the reader" (Answer to RQ2).
- **What is wrong:** §5.2.2 shows that a member's own inserts bypass `record_event`. The loop figure and the answer say that every event passes one writer and both checks.
- **Proposed:** in the Answer to RQ2: "… one governed event log with a small set of types; the backend writes it through one function that never fails a reader's request, and rows that members insert directly still meet the database's type constraint."

### B9 (weakens). The abstract says the owner sees how material is read in production, and then lists four limits that are five

- **Where:** p. v, `abstract.tex:10-14` and 35–38 (and DE).
- **Quoted:**
  - "… a web application in production that turns an uploaded PDF into addressable content …, and the owner of the material sees how it is read."
  - "Four limits change how these results read. … The owner's view was merged after the described revision and is not yet deployed, and its limit of five counts the readers of a page, not the people behind a finding."
- **What is wrong:**
  - "In production" plus the present tense says the owner sees reading patterns in production, which the next paragraph denies.
  - "The described revision" points at nothing in the abstract, and "merged" is version-control jargon ("zusammengeführt").
  - One sentence holds two limits, so the paragraph announces four and states five.
  - "How these results read" is awkward.
- **Proposed:**
  - "… while the original page stays the reference. A reader opens the file at once; an assistant explains pages, asks about them, and runs practice; and a view for the owner of the material, built but not yet deployed, shows how it is read."
  - "Five limits change how these results should be read. … The owner's view was added to the code only after the revision this thesis describes and is not yet deployed. Its threshold of five counts the readers of a page, not the people behind a finding."
  - The German to match.

### B10 (weakens). "Two failure directions" means two things 28 lines apart, and the lifecycle caption says every disputed question is dropped

- **Where:** p. 49, `06-trust.tex:269-271` against :297; Fig. 6.1 caption :220–222.
- **Quoted:**
  - "Second, the two failure directions are treated differently. … If the check disputes the key, the question is dropped."
  - Caption: "a disputed key gets one repair on the same page before it is dropped."
- **What is wrong:**
  - At :297, "fail in two directions" means dropping a good item or keeping a bad one; here it means outage against dispute.
  - "Dispute, then dropped" skips the repair (06:254–255).
  - The caption says the repaired question is dropped as well, that is, always.
- **Proposed:**
  - "Second, an outage and a dispute are treated differently. … If the check disputes the key, the question is rewritten once and dropped only if the rewrite is disputed too."
  - Caption: "… a disputed key gets one repair on the same page; a second dispute drops the question."

### B11 (cosmetic). "These counts are wrong verdicts"

- **Where:** p. 51, `06-trust.tex:381`; Table 6.1 caption.
- **What is wrong:** "these counts" can mean the whole table or only the answer-check row, and a count is not a verdict. The table shows "0 of 16" without "in the calls that returned a verdict", which 06:528 and 07:82 add.
- **Proposed:**
  - "The answer check's counts are wrong verdicts among the calls that returned one, not what the deployed procedure would have done."
  - Caption: "For the answer check, counts are over the calls that returned a verdict; one call did not."

### B12 (weakens). The two counts for "both unusable" describe different duels without saying so

- **Where:** p. 28, `04-content.tex:443-445` against p. 31, `:541-543`.
- **Quoted:** "31 of its 39 duels ended that way" against "judged unusable, together with its opponent, in 18 of its 33 first-round duels".
- **What is wrong:**
  - The checker reported these as contradictory. They are not; I recomputed both from the votes:
    - 31 of 39 counts the current extraction's duels in the first comparison, round 1 and round 2 together (13 + 26 duels, 9 + 22 both unusable).
    - 18 of 33 counts its round-1 duels pooled over all four comparisons (13 + 17 + 3 duels, 9 + 7 + 2 both unusable).
  - The problem is language. "Comparison", "round" and "sitting" are used as units but never defined; only "duel" and the second round are. The Answer to RQ1 then switches subset without saying so.
- **Proposed:**
  - **Define the units in Design:** "The benchmark ran in four comparisons, each a batch of duels among a fixed set of methods; within a comparison, a first round followed the seeded schedule, and a pre-registered second round added duels among the leaders."
  - **Name the subset each time,** for example: "in 18 of its 33 first-round duels over all four comparisons".

---

## Part C. Terms used before they are defined, or never defined

### C1 (weakens). About forty terms reach the reader before their definition, or never get one

**Remedy.** Most of these can be fixed in one place: a one-page glossary (an "Appendix D: Terms"), with a pointer from §1.6. Its first-use list follows. Where a term is used long before its definition, also move the definition up.

| Term | First use (page, file:line) | Defined at | Proposed one-line definition |
|---|---|---|---|
| the corrected test, corrected lower bound, H1 (per method) | p. v, abstract:22; p. 20, 04:95–97 | 04:399–401, p. 27–28 (k only in the Fig. 4.3 caption) | A method passes if the lower end of its bootstrap interval, corrected for testing ten methods at once (Bonferroni), lies above the current extraction's 1000. |
| Bradley–Terry, strength, points, expected score, minorisation-maximisation, prior | p. 27, 04:385–390 | never; Ch. 2 does not introduce them | One sentence each in §4.5.2. A model in which method *i* beats *j* with probability *sᵢ/(sᵢ+sⱼ)*; points are 1000 + 400 log₁₀(*sᵢ/s*current). |
| governed log | p. v, abstract:24 | 05:60–67 | One table whose 17 event types are fixed by a database constraint and a schema registry. |
| pinned pairs, probe, pair | p. v, abstract:31; Table 2.1 | 06:304–309 | 16 hand-written pairs of one correct and one wrong answer key for the same question. |
| parse time | p. v, abstract:30 | never | "while an uploaded PDF is processed". |
| the pin, at the pin | p. 14, 03:111; p. 24, 04:275 | never as a noun | See A9. |
| finding, detector | p. v, abstract:25; p. 1, 01:40 | 05:203 | A detector is a rule over a Lesson's events; a finding is its statement about one page: kind, page, severity. |
| floor | p. 33, Fig. 5.1 caption | 05:191–193 (never named as such) | Nothing is said about a page that fewer than five readers have read. |
| reach (none / few / enough) | Table 5.3, p. 42 | the words at 05:198–199, never called "reach" | The word that replaces the reader count. |
| calm cell, linked pairs, dwell, foggy | 05:195, 208; Table 5.2; 05:535 | never | Each needs a short gloss, or replace "foggy" with "confused". |
| first fence | implied at 05:325 | never | The ownership check in the backend's code; the second fence is row-level security. |
| figure block | p. 19, 04:46 | never | A region that PyMuPDF reports as an image or a drawing. |
| block extractor | p. 25, 04:303 | never | PyMuPDF's block-level extraction, which counts footer-free characters. |
| Deck Lab | p. 25, 04:300 | never | The project's offline harness and its 25-deck corpus (the author must confirm). |
| parse receipt | p. 22, 04:149 | 06:465–468, p. 53 | Move the definition to its first use. |
| run, run row, replay, sweep, upsert, lecture reuse | 04:151–247 | C:176–211 or never | One clause each at first use. |
| synthesis | p. 17, 03:138 | never | The model call that writes a page's generated title, summary and text. |
| packed copy / reader copy | p. 22, 04:154; C:147, 169 | never | A re-saved copy of the PDF that the reading view fetches in 16 kB ranges. One name only. |
| server-authoritative, content-addressed | 04:84; Fig. 4.1 caption | 04:218, or never | "the server, not the browser, writes the result"; "stored under the hash of its bytes". |
| comparison, round, sitting | 04:360, 446 | never | See B12. |
| live / shipped / deployed | 04:106, 323 | never | See A4. |
| operator | 04:275 | never | The person who runs production (the author). |
| golden set | 04:486; C:444 | never in Ch. 4–7 | The hand-checked question set of the retrieval measurement (§6.5). |
| rehearsal | p. 50, 06:277 | never | One-line gloss needed (the author must confirm what it is). |
| checkpoint | p. 14, 03:108 | never; the source is unstated | A short question shown while reading, generated from the page text, and not the deck quiz of §6.4.1 (the author must confirm). |
| Explain, Ask, ask bar, home screen | Table 2.1 (02:223); Table 5.1 (05:94); 06:53 | 06:53–55 (partly) | See A12. |
| course tutor, classic lecture tutor, Luna's moves | p. 9, Fig. 2.1 caption | 06:122–146 | Use Chapter 6's names in the caption, or move the figure. |
| faces | p. 45, 06:44 | never | "views" (A2). |
| the question that started this work, corrected twin | p. 49, 06:266; 06:372 | 06:421–423; never | Describe it at first use: "an ambiguous question whose options all appear on its page". "a corrected version of the same question". |
| calibration set | p. 50, 06:320 (04:334 is a different set) | never | The separate set of key pairs, from other decks, used only to fit the threshold; give its size. |
| stem | p. 50, 06:322 | never | The question text without its options. |
| RRF, BCNF, HNSW, IVFFlat, LLM, PR | 06:65; 06:281; 02:87; C:102; 01:193; 03:38 | never expanded | reciprocal rank fusion; Boyce–Codd normal form; hierarchical navigable small-world graph; inverted-file index; large language model; pull request. |
| verifier | 06:33 | App. C:427 | Move the table caption's definition to 06:33. |
| ledger of claims | 07:136 | never | A list of the project's documented claims, each checked against the code. |
| interface flag, half-states, readiness probe, compose file | Fig. 3.1/3.2 captions; 03:150 | C.1, or never | One clause each. |
| development timeline | 01:168 | never | The commit-by-commit history in `docs/timeline/`. |
| teach-back quotes, mini-app screening, links between Lessons, slot filling, golden-set anchor check, retrieval grid | Table C.x, C:440–450 | never | One clause each in the table, or drop the rows; otherwise the count of 26 cannot be checked. |

---

## Part D. Chapter by chapter

Items already covered in Parts A–C are not repeated here.

### Abstract and Chapters 1–3

| ID | Sev. | Where | Issue | Proposed |
|---|---|---|---|---|
| D1 | weakens | p. 1, 01:37–41 | The floor and its apparent violation follow each other with no explanation; "finding", "merged" and "the revision" appear before §1.4. | "… and only for pages that at least five people have read. Because this threshold counts the readers of a page and not the people behind a pattern, Chapter 5 shows that a pattern can still rest on fewer than five people, in the extreme on one. The view was added to the code two days after the revision this thesis describes (Section 1.4)." |
| D2 | weakens | p. 3, 01:107–109 | "under a protocol that was fixed before the first vote and extended four times" reads as a contradiction. | "under a protocol frozen before the first vote and later extended by four recorded deviations". |
| D3 | weakens | p. 13, 03:38–41 vs 01:164–165 | Chapter 3 supplies a reason ("The author's reason is …") two chapters after the method promises not to. | Mark it as recollection: "the author's recollection, not recorded at the time, is that …"; and in 01:164 add "where the author gives a reason from memory, it is marked as such." |
| D4 | weakens | p. 14, 03:80–85; Fig. B.1 | "Role" is used for both owner/member and the account type; "the two models met badly" collides with language models. | "Creating a Space needs no particular account type, and publishing it is reserved to its owner, so a student can own and publish a Space." / "… where the two permission schemes, account type and Space ownership, conflicted." |
| D5 | weakens | p. 9, Fig. 2.1 caption | Uses "course tutor", "Luna's moves", "classic lecture tutor" and "student path" six chapters before they are introduced. | "The course tutor behind the home ask bar refuses before any model call; Luna's page references and highlighted phrases are checked against the page; Explain and Ask rely on the prompt alone; and the tutor of the older interface, which has no refusal gate, is no longer reachable by students." |
| D6 | weakens | p. 15–16, Fig. 3.1 and 3.2 captions | "Interface flag", "half-states", bare `0be0081` and "the readiness probe" are undefined; in Fig. 3.2, "which" attaches to "path"; "Postgres" against "PostgreSQL". | Fig. 3.1: "Since the end of October each frontend build flag follows its backend flag, which removed the screens that, at the earlier revision 0be0081 (August 2026), were shown while their backend was off." Fig. 3.2: "… depends on the direct asyncpg pool to PostgreSQL, a dependency that the readiness check (Section C.1) does not test." |
| D7 | weakens | p. 17, 03:169–170 | "the production compose file counts roughly 360 such call sites": a compose file cannot count call sites. The number comes from a comment in it. | "… at roughly 360 call sites in the backend code (a count recorded in a comment of the production compose file)." |
| D8 | weakens | p. 18, 03:204–207 | "One of them hides a finding": PyMuPDF is not among the seven recorded choices, since it was chosen by attrition. | "The production extractor is a case apart: the plain-text call of PyMuPDF became the extractor by attrition and not by comparison, and the benchmark of Chapter 4 rates nine of ten alternatives above it." |
| D9 | weakens | p. 7, 02:50–53 | "arrives at the same result": Dinh et al. measure answer quality, Chapter 4 a judge's preference. | "Chapter 4 reaches a related result by another route: …" |
| D10 | weakens | p. 13, 03:42–44 | "The backend changed as often" compares two interfaces with nine pipeline generations. | "The backend changed far more often." |
| D11 | weakens | p. vi, abstract DE 48–88 | Calques: "ansprechen" (for "address"), "geskripteten Lesenden", "Mechanik"; the owner is "wer das Material bereitstellt" and later "Besitzerin oder Besitzer". | "… kann auf den Inhalt ihrer Seiten jedoch nicht gezielt zugreifen"; "mit simulierten, per Skript gesteuerten Lesenden"; "prüfen die technischen Abläufe"; "Besitzerin oder Besitzer" throughout. |
| D12 | weakens | p. 3–4, Table 1.1 and 01:182–184 | Table 1.1 cites RQ1 and RQ2 two pages before they are defined (also pass (d) T6). | Caption: "… the research questions RQ1 to RQ3 are stated in Section 1.6." |
| D13 | cosmetic | p. 17, 03:153–154 | "the routing layer": "routing" means text against vision everywhere else, and "routes" means HTTP endpoints. | "… describes the gateway as the layer through which every model call passes." |
| D14 | cosmetic | p. 14, 18, 20, 35, 40, 46–47, 92 | cleveref prints appendices as "Chapter B" and "Chapter C". | Set the cleveref name for appendices ("Appendix") once in the preamble. |
| D15 | cosmetic | p. 13, 03:30–32 | "In the system that production serves since 29 October": tense; "drops" is product slang; "it" is ambiguous. | "In the system that production has served since 29 October 2026, anyone can upload a PDF and read it at once, and everything else is added to the pages while they are being read." |
| D16 | cosmetic | p. 17, 03:147–153 | A 45-word sentence whose second clause lost its verb; "carried its base URL in its environment" has two "its". | "The container was removed from the production compose file by commit 68a091e0 of 25 August 2026, which reached the main branch through pull request #51 on 28 August; the remaining configuration was removed by commit 7830d49a of 18 September, merged through pull request #74 on 10 October." |

### Chapters 4 and 5

| ID | Sev. | Where | Issue | Proposed |
|---|---|---|---|---|
| D17 | weakens | p. 27–28, 04:385–401; caption | H1 is stated as "at least one" and then used per method ("holds for five methods"); k appears only in the caption; the sentence at :385–390 is about 60 words. | "A challenger passes if the lower end of its bootstrap interval, Bonferroni-corrected for k = 10 challengers, lies above 1000; H1, that at least one challenger is rated above the current extraction, holds if any passes. Five pass." (See also C1.) |
| D18 | weakens | p. 20, 04:95–97 | The Docling sentence in §4.2 uses points, interval, corrected bound and H1 seven pages before they are defined. | "The benchmark in Section 4.5.2 later rated Docling above the current extraction, but not by a margin that survives the correction for testing ten methods at once." |
| D19 | weakens | p. 28, 04:410–413 | "86 went to the right side" first reads as "the correct side"; the test is not named. | "86 chose the output shown on the right-hand side (binomial test, p = 0.011)". |
| D20 | weakens | p. 25, 27; 04:323 vs 335–336 | "two were left unlabelled" (inside the 55-page sample) against "21 were never labelled" (outside it). | "Of the 75 figure-carried pages the rule routes to vision, 21 lie outside the 55-page labelled sample." |
| D21 | weakens | p. 31, 04:535–537 | "a vision model … at more than 10:1": only the stronger one is above 10:1, and it is never named in the text (Fig. 4.3 names it). "Three courses" against "five PDFs of four sources". | "the stronger vision model (gpt-6.1-sol) at more than 10:1 in expected score, the smaller (gpt-4.1-mini) at about 9:1"; name both in §4.5.2; one description of the sources. |
| D22 | weakens | p. 27, 04:358–361 | "the five fast methods … the three heavy local engines … one smaller OCR build": the groups are never listed, and "a 60-page cut" conflicts with a 24-page test set. | "the five fast methods (current, pymupdf4llm, MarkItDown, pdf.js and OpenDataLoader), the two paid vision models, the three heavy engines (Docling, MinerU and Marker), which processed only a 60-page excerpt of the five PDFs, and the 4-bit PaddleOCR build". The lists are inferred; the author must confirm them. |
| D23 | weakens | p. 19, 04:30–31 | "stated once, in the architecture chapter": Chapter 3 is "Learnstation at a Glance", and the deployed revision is in §3.3. | "… stated once, in Section 3.3". |
| D24 | weakens | p. 31, 04:527–530 | "Route by the page, not by a count": the rule is a character count; "12 empty ones" is elliptical. | "Route by what the page holds, not by a raw character count: … on 1,593 real pages this means 87 vision calls, where the old rule made 12, all on pages without teaching text." |
| D25 | weakens | p. 23, 04:187–188 | A garden path with a dangling "measured", which also implies several parsers. | "One function decides how each page is read. It measures the PDF page itself, so the decision does not depend on which parser supplied the text." |
| D26 | weakens | p. 20, 28, 30; 04:84–88, 431–447, 489–497; C:237–244, 283–288 | Five sentences of 65 to 90 words; "Three qualifications" introduces four items. | Split as proposed by the checker. For example, 04:489: "The benchmark records three preferences of the one judge. The current extraction came second to last, above only MarkItDown. pymupdf4llm stands 263 points above it … Transcription by a vision model is preferred further still, at a price." 04:431: "Four qualifications belong to the result." |
| D27 | weakens | p. 86–88, C.4 and Fig. C.2 | Mechanisms L0–L8 inside "Layer 1–4", so "L1" reads as "Layer 1"; "the six-hour sweep" for a sweep that runs every ten minutes. | Rename the mechanisms M0–M8 in the text and the figure; "the sweep, which every ten minutes fails runs queued for six hours". |
| D28 | weakens | p. 24, 04:245–247 | "The guarantee also has an edge between owners … and that run waits": "edge" and "that run" are unclear. | "The guarantee also has a gap between uploaders: if a second user uploads identical bytes while the first user's parse runs, the second user's job finds the lock held and stays queued until the sweep marks it as failed after six hours." |
| D29 | weakens | p. 33–44, Fig. 5.1; 05:192, 310, 336, 505, 565; Table 5.2 | The floor is stated in five units: readers, members who have read, readers of a page, people, raters. The distinction §5.8.3 rests on is blurred before it is drawn. | In §5.4.2: "The floor is five readers of a page, that is, members other than the owner with a view of positive duration; a share such as the confused share additionally needs five contributors (raters, askers, or people who turned back)." Then use only "readers" and "contributors". |
| D30 | weakens | p. 38–40, 05:325–327, 346, 353, 375 | "the second fence" without a first; "the public key of the database service" suggests cryptography, where Chapter 3 and Fig. B.6 say "anonymous key". | "The first fence is the ownership check in the backend's code, the second row-level security." / "A browser holds the anonymous key of the database service …". |
| D31 | weakens | p. 40, 44; 05:338–343, 566–570 | "One gap remains", but the answer has "two stated limits"; "excludes …, and nothing else" parses two ways; the question-to-owner feature appears first in the answer. | "A second gap, besides the one in Section 5.8.3, concerns raw rows: … the only rows it withholds are the questions asked in the current reading view." Introduce the question-to-owner item earlier, or drop it from the answer. |
| D32 | weakens | p. 43, 05:488–494 | "Four misses … One, in arm B": arm B has two misses; the heading says three things, the text sorts four and one; "the promise we had written down for them" is the sentence shown to members, not something written for the rules. | "In none of the five misses does the code depart from its rules. They fall into three groups, one per paragraph below. In all but arm B the author's expectations had misread the rules; arm B's two misses show that the rules do not keep the promise made to members." |
| D33 | weakens | p. 92, C:371–399 (hardening) | "This opened a read across courses": "this" has two antecedents; "The two commits" were never named; "requests" reads as HTTP requests; time phases and fault classes are mixed. | "Opening sign-up to any domain let a professor read across courses; a further migration (20260621000000) closed this … The migration that opened the read and the one that closed it were committed on the same day …"; "… and not the individual migrations"; "The first class, from January to June 2026, concerns who may hold a role." |
| D34 | cosmetic | Ch. 4 batch | Small items. | 04:36: "drops on the page" (page is a defined term), use "drops into the upload area". 04:142: "The queue Redis keeps jobs", use "The Redis instance that holds the queue keeps jobs across restarts". 04:297: dangling "Before replacing it, the question was", use "Before replacing it, the author asked …". 04:375: "typed by hand as" reads as "transcribed", use "assigned by hand to five page types: …, layout (3), and table or formula (3)" (Oxford comma). 04:452: "strip it (4, 1, and 0)" reads as pages stripped, use "(it remains on 4, 1, and 0 pages)". 04:351: "The repository had opinions on this for months and no measurement." is a flourish, use "Before the benchmark, the choice of extractor had never been measured." |
| D35 | cosmetic | Ch. 5 batch | Small items. | 05:27: "Two revisions matter", then a third hash at :412; add "the script was committed later (a342dea9); the engine it calls is identical to 2e146f51". 05:156: "A student's personal Space" clashes with §3.2's Library. Fig. 5.2 caption: name the arms (I and G). Table 5.2 column "Spaces": rename "Owner's view". The engine has three names ("engine for Spaces", "Space engine", "engine for the owner's view"), so pick one. "leak" against "leaky bucket". Register: 05:135, "bending the owner's picture"; 05:527, "are heard by no one". 05:334: "What a member is told matches what is built" needs "(but see Section 5.8.3)". |
| D36 | cosmetic | App. C batch (Ch. 4 parts) | Small items. | C:332: "would remove the problem" has no antecedent. C:325: "it" could be OpenAI or the check. "Legs" against "entries". C:271: "classified four ways" lists three outcomes. C:304: "soft gate" is undefined. Oxford comma missing in the F11 caption. Table C.2: "later called dormant" (by whom?) and "One AI stage for every external extractor" is opaque. |

### Chapters 6 and 7, Appendices

| ID | Sev. | Where | Issue | Proposed |
|---|---|---|---|---|
| D37 | weakens | p. 50, 06:277; :520–522 | "The rehearsal and the checkpoints of the reader have five kinds of question": rehearsal is undefined, and the attachment is ambiguous; are the checkpoints the answer-checked deck quiz? | "The rehearsal (gloss) and the reading view's checkpoints, which are generated from the page text and are not the deck quiz of Section 6.4.1, use five kinds of question." The author must confirm both. |
| D38 | weakens | p. 46, 06:70–82 | A 45-word sentence with a nested parenthesis; "a column" unnamed; "those pages" without an antecedent; a commit that "counts"; "It" in "We report it"; "the order of trust". | "Until 11 October 2026 the scoped search joined the embeddings on a column that is empty for most rows, because embeddings are keyed by content hash; the fix reached the main branch with PR #96 on 24 October. Pages whose embeddings lacked that column were invisible to the ask bar; the fix, commit b66a97c6, records 40 such rows out of 68 in one Space and adds a database test that fails on the old join. We report the defect because every later check depends on retrieval: …" |
| D39 | weakens | p. 52, 06:403–410, 428–429 | "The groups do not overlap" (the three tiers, or the two sets?); "an unanswerable question" reads as any one; 0.025 cannot be derived from the rounded figures; "among the first five hits" against the six that the ask bar keeps. | "The similarities of the answerable and the unanswerable questions do not overlap, but the gap is narrow: no unanswerable question reaches more than 0.634, the weakest answerable question reaches 0.659, and the threshold of 0.65 lies between them." Say why five hits and not six. |
| D40 | weakens | p. 53, 06:499–504 | "guarded by prompt rules and by one independent model, and only for quiz keys": "only" attaches to both. "There is no entailment check" seems to contradict the answer check. | "Meaning is guarded by prompt rules on every surface and, for quiz keys only, by the answer check." / "There is no entailment check: nothing tests directly whether a page logically supports a key or a sentence; the answer check tests a key only indirectly." |
| D41 | weakens | p. 45, 06:21–24 | "Chapter 5 returned what readers do": returned to whom? "Between the two" is unclear; the third kind of text, a model-written verdict, is never examined, since §6.4.2 says the model "writes the task but not the verdict". | "Chapter 4 turned uploads into pages, and Chapter 5 fed back to the owner what readers do on them. Along the way a model writes three kinds of text that a learner may take for true: an answer to a question, a quiz question with its key, and the task behind a graded exercise." |
| D42 | weakens | p. 93, App. C 24 June note, C:405–415 | "Why the refusal was removed is not recorded", then "The only stated motive is a comment in the diff". The last sentence repeats 06:129–130. | "No commit message, pull request or test records why the refusal was removed; the only trace of a motive is a comment in the diff: …" |
| D43 | weakens | p. 93, mechanisms table C:426–451 | Six entries appear nowhere in the prose (C1), and the Kind column uses "input side" and "limits and tests", which the caption does not define. | Caption: "… a verifier computes, validates, filters or drops; a prompt rule only instructs the model; a harness measures offline; an input-side mechanism changes text before a model sees it; a limit bounds cost." Gloss each entry. |
| D44 | weakens | p. 56–58, Ch. 7 discussion | A heading contradicts its paragraph ("The simple method was never measured" over "the first comparison it ever faced"). "Drifted apart, in both directions" never names the directions. "The migration history recorded two of the migrations". Register: "and it lost", "measuring before believing", "kept the system honest", "of the same rank as latency" (latency is discussed nowhere), "answer back". | "The simple method was never chosen."; "with the documents sometimes ahead of the code and sometimes behind it"; "recorded only two of the 136 migrations"; replace each phrase with a plain statement, for example "and nine of the ten alternatives were rated above it". |
| D45 | cosmetic | Ch. 6, Ch. 7 and appendix batch | Small items. | 06:190: "make that rule hold on to something", use "gives that rule a boundary that uploaded text cannot forge". 06:193: "foreign text", use "untrusted text" (02:77). 06:357: "failed in the registered direction", use "failed in the direction named in advance as its risk". 06:439–440: the cross-reference for the caps points to the OpenAI-only section. 07:86, 275: "withdrawn", use "abandoned before merging". 07:235–244: number the "four engineering steps"; "retention should run", use "the retention job, which has never run, should be switched on". 07:261: "shared as source code is", use "shared the way source code is". 07:276: "visible in each of those sentences", use "in each of those findings". Register: 06:498 "The distribution is the finding."; 06:292; 06:173; 06:530–531. App. A labels: "Gemini leg", "OpenAI daily fleet ceiling", "Anchor-slide synthetic similarity", "RRF constant", use plain names. Fig. B.8: "validated citations reach learners through the current interface", use "… only through the ask bar". Fig. C.1: ISO date and "age-encrypted", use "30 October 2026" and "encrypted with the age tool". Oxford comma in the Fig. B.3 and B.6 captions. |

---

## Dropped after checking

About 95 candidates were dropped by the checkers (27, 36 and 32), and I adjusted two of theirs. The notable ones:

- **Downgraded (B12).** "31 of 39 against 18 of 33 cannot both be true": both hold, for different subsets of duels (recomputed from the votes). What remains is a language issue, B12.
- **"The lexical rule it replaced had rejected 14 of 16" (07:82–83).** Dropped, as in pass (a): the code comment at the pin ("Do NOT re-enable enforcement") shows that lexical dropping was enforced before the answer check replaced it.
- **Defined at or near first use:** Space, Lesson, Library and Luna; hotspot, speed bump, landing, themes, boilerplate, deck plan, bulk and quality chain, "found, then fixed", the second round, spotlighting, SM-2, k-anonymity, Arq, entailment (glossed inline), Provider Chaos Lab.
- **Consistent counts:** "ten detectors" against "eleven detectors" (05:206: ten of the eleven run); 23 expectations; five misses; "five small changes"; six privacy mechanisms; 11, 10 and 9 detectors; the September and November "27 questions" (the same set).
- **Spelling:** British throughout. The only "-ize" forms are code identifiers (`pseudonymize.ts`) and `itemize`. The Oxford comma is used consistently apart from the captions listed in D36 and D45.
- **Taste, not language:** "teaching travels as a PDF", "learning objects", "not trusted either", "Two tutors therefore exist".
- **Standard terms:** pure function, savepoint, GIN, SET NX, fails open, property tests, distractor, functional dependencies, operator.

---

## The five findings that matter most

1. **A1.** "Author" means four things: the thesis writer, the person who made the material, the model that wrote a question, and both developers. In Chapter 6 this makes "independent of the author" and "the author's own model family" read as statements about the thesis writer. Use *owner*, *the author* and *the generating model*, stated once in §3.2.
2. **A2.** "The reader" is both the screen and a person, often in one sentence, and the screen's views are counted two, three and four ways. Name the *reading view* and its three views once in §3.2. Use "reader" only for people.
3. **A3.** "v4" names both the fourth parsing pipeline and the current interface, two pages apart in Chapter 4. Write "pipeline v1 … v5", and keep "v4" as a one-time note about the interface's repository name.
4. **B1 + B2.** Two sentences at the heart of RQ3 say the opposite of the chapter:
   - "The original page stays one key away": it is the default view.
   - "A check that fails drops its item": a check that fails *keeps* the question, and several checks only flag.

   Rewrite both as proposed.
5. **C1, with B5 and B9.** About forty terms reach the reader before their definition. The worst are in the abstract: the corrected test, governed log, pinned pairs, parse time, the described revision, merged. Three of them came from my own earlier proposals. A one-page glossary, plus the abstract and Chapter 7 wordings in B5 and B9, fixes most of them at once.

Close behind:

- **A4:** "shipped" and "live" against "not deployed".
- **A5:** "gate" in three senses.
- **A13:** the production extractor has eight names.
- **D17:** H1 is stated as "at least one" and used per method.
