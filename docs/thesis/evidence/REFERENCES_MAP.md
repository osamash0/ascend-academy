# References map: thesis sections to candidate sources

Companion to the academic section of `thesis/references.bib` (75 entries: 50 core, 25 secondary). Every entry was re-resolved against Crossref, DataCite or arXiv on 2026-10-10 and all 75 matched.
Compiled 2026-10-10.

> **Read before you cite.** Each entry was checked to *exist* against an
> authoritative record (Crossref/DataCite DOI registry, arXiv, NeurIPS or USENIX
> proceedings page, GI Digital Library, or the publisher or author page in its
> `url` field). Bibliographic fields were copied from that record. That proves
> the paper is real. It does not prove that the paper says what the "supports"
> line below says. Those lines describe what each source is generally known for
> and are a reading guide, not a quotation. Before you cite a source, read at
> least the abstract and the section you rely on, and change the sentence if the
> source does not back it. An examiner who spot-checks one citation and finds it
> does not fit will check the rest.

Core entries come first in each section of the `.bib`. Entries after the
`--- secondary ---` marker are verified too, but use them only if the prose needs
them. Copy into `thesis/references.bib` only what you have read.

## 1. Section to keys

| Thesis label | Core keys | Secondary keys |
|---|---|---|
| `sec:document-ai` | xu2020layoutlm, pfitzmann2022doclaynet, blecher2023nougat, auer2024docling, wang2024mineru, lee2023lpm | ouyang2025omnidocbench, tanaka2023slidevqa, huang2022layoutlmv3, zhong2019publaynet |
| `sec:llms` | brown2020gpt3, ouyang2022instructgpt, ji2023hallucination, greshake2023indirect, perez2022ignore | tam2024speakfreely, willard2023guided, huang2025hallucination |
| `sec:rag` | lewis2020rag, karpukhin2020dpr, gao2023ragsurvey, rashkin2023ais, gao2023alce, gao2023rarr | anthropic2024contextual, min2023factscore |
| `sec:srs` | wozniak1990sm2, ebbinghaus1913memory, cepeda2006distributed, roediger2006testing, settles2016hlr, ye2022ssp | dunlosky2013techniques, murre2015ebbinghaus, su2023tkde |
| `sec:gamification` | deterding2011gamification, hamari2014gamification, sailer2020gamification | ryan2000sdt |
| `sec:positioning` | vanlehn2011tutoring, kasneci2023chatgpt, zawacki2019aihe, auer2024docling, lewis2020rag, molina2024slides | meissner2024evalquiz, bastani2025guardrails, kestin2025aitutoring |
| `sec:retrieval` / `sec:data-model` | malkov2020hnsw (plus the existing `pgvector`, `postgresql-rls` @misc) | n/a |
| `sec:anti-hallucination` | ji2023hallucination, gao2023alce, rashkin2023ais, gao2023rarr | min2023factscore |
| `sec:injection` | greshake2023indirect, perez2022ignore, liu2024formalizing, owasp2025llm | hines2024spotlighting, zhan2025adaptive |
| `sec:assessment` | kurdi2020aqg, haladyna2002mcq, krathwohl2002bloom, doughty2024mcq, molina2024slides | alhazmi2024distractor, elkins2023useful, meissner2024evalquiz |
| `sec:srs-impl` | wozniak1990sm2, ye2022ssp, roediger2006testing | su2023tkde |
| `sec:idempotency` / `sec:failure-handling` | helland2012idempotence | n/a |
| `sec:automated-eval` / `sec:results` | zheng2023judging, es2024ragas, gao2023alce | wang2024fairevaluators |
| `sec:reality-vs-documented` | desilva2012erosion, lethbridge2003documentation | perry1992foundations, aghajani2019docissues |
| `sec:built-vs-deployed` (feature flags) | rahman2016toggles | hodgson2017toggles |
| `sec:citation-gap` | rashkin2023ais, gao2023alce | n/a |
| `sec:threats` | runeson2009casestudy, wohlin2012experimentation, panickssery2024selfpreference, zheng2023judging | wang2024fairevaluators |
| `sec:unanswered` (study design) | brooke1996sus, laugwitz2008ueq, mcauley1989imi, davis1989tam, sailer2020gamification | bangor2008sus, ryan2000sdt |
| `sec:research-questions` (RQ2/RQ3 framing) | sailer2020gamification, kasneci2023chatgpt | bastani2025guardrails |

## 2. Key to claim it can support

### Document understanding (`sec:document-ai`)
- **xu2020layoutlm**: Jointly modelling text with its 2-D position improves document-image understanding. Use it to separate layout recovery from plain text extraction.
- **pfitzmann2022doclaynet**: A human-annotated layout dataset covering diverse document types. Layout segmentation is a learned task with its own benchmark.
- **blecher2023nougat**: End-to-end OCR of academic PDFs into markup. An alternative to text-layer extraction for documents where the text layer is poor.
- **auer2024docling**: The Docling conversion toolkit (layout plus table structure). Concrete example of the "document conversion" family in the positioning figure.
- **wang2024mineru**: MinerU, one of the system's swappable front-ends. Cite it where the thesis names MinerU.
- **lee2023lpm**: Lecture slides are a distinct multimodal genre (text, figures, layout). Supports the claim that slides are harder than ordinary prose.
- *ouyang2025omnidocbench*: A benchmark comparing PDF-parsing pipelines. Cite it if you justify front-end choices or call the problem unsolved.
- *tanaka2023slidevqa*: Question answering over slide decks as a research task. Related work for "understanding slides".
- *huang2022layoutlmv3*: Later LayoutLM model with image and text pre-training. Only if you discuss the family's evolution.
- *zhong2019publaynet*: Large automatically labelled layout dataset. Historical context for DocLayNet.

### LLMs (`sec:llms`)
- **brown2020gpt3**: Large language models can do new tasks from instructions and a few in-context examples. The basis for prompt-driven generation without fine-tuning.
- **ouyang2022instructgpt**: Instruction tuning with human feedback makes models follow task instructions. Why a prompt can encode quality constraints.
- **ji2023hallucination**: Defines and classifies hallucination (intrinsic versus extrinsic). Use its terms in the failure-mode paragraph.
- *tam2024speakfreely*: Forcing a strict output format such as JSON can lower model reasoning quality. A trade-off for structured output.
- *willard2023guided*: Constrained or grammar-guided decoding can guarantee schema-valid output. Contrast it with the prompt-and-validate approach.
- *huang2025hallucination*: An LLM-specific hallucination survey, newer than Ji et al.

### RAG and groundedness (`sec:rag`, `sec:anti-hallucination`, `sec:citation-gap`)
- **lewis2020rag**: Defines retrieval-augmented generation: parametric memory plus retrieved non-parametric memory.
- **karpukhin2020dpr**: Dense embedding retrieval beats sparse lexical retrieval for open-domain QA. Why embeddings and vector search are used.
- **gao2023ragsurvey**: A taxonomy of RAG variants (naive, advanced, modular). A frame for placing this system's retrieval design.
- **rashkin2023ais**: Defines "attributable to identified sources" (AIS). The most rigorous basis for defining *groundedness* in the taxonomy.
- **gao2023alce**: A benchmark and metrics for LLM answers with citations (citation recall and precision). Shows that citation correctness can be measured, which bears on the limit of post-hoc slide-index validation.
- **gao2023rarr**: Post-hoc attribution and revision of model output. The research counterpart of the post-hoc citation validation layer.
- *anthropic2024contextual*: Adding chunk-level context before embedding improves retrieval. Vendor blog, so cite only for the technique.
- *min2023factscore*: Breaks output into atomic facts and checks each against a source. Shows what content-level verification would add beyond index validation.

### Prompt injection (`sec:llms`, `sec:injection`)
- **greshake2023indirect**: Indirect prompt injection: instructions planted in retrieved or ingested content take over LLM-integrated applications. This is the threat model for student-uploaded PDFs.
- **perez2022ignore**: Early demonstration of goal hijacking and prompt leaking ("ignore previous instructions").
- **liu2024formalizing**: A formal framework and benchmark that finds existing defences insufficient. Backs the claim that prompt-level defences are mitigations, not guarantees.
- **owasp2025llm**: Industry risk catalogue where prompt injection is LLM01. Practitioner grounding.
- *hines2024spotlighting*: Marking untrusted input with delimiters or encoding ("spotlighting"). The published form of the "label retrieved context untrusted" mitigation.
- *zhan2025adaptive*: Adaptive attacks get past published indirect-injection defences. Strong support for the "no sound guarantee" limitation.

### Assessment generation (`sec:assessment`)
- **kurdi2020aqg**: Systematic review of automatic question generation for education: methods, evaluation practice, gaps.
- **haladyna2002mcq**: Item-writing guidelines (plausible distractors, homogeneous option length, no "all of the above"). The source for the prompt's quality constraints.
- **krathwohl2002bloom**: The revised Bloom's taxonomy. Use it if the thesis talks about cognitive level or difficulty.
- **doughty2024mcq**: Compares GPT-4-generated and human-written MCQs on quality criteria. Evidence about LLM item quality.
- **molina2024slides**: LLM question generation from university lecture slides, rated by students. The closest related work to the pipeline.
- *meissner2024evalquiz*: LLM self-assessment quiz generation from lecture material at a German venue (GI SEUH). Positioning.
- *alhazmi2024distractor*: Survey of distractor generation and how it is evaluated.
- *elkins2023useful*: Teachers' judgements of LLM-generated educational questions.

### Spaced repetition and retrieval practice (`sec:srs`, `sec:srs-impl`)
- **wozniak1990sm2**: Primary description of SM-2: ease factor starting at 2.5 with a floor of 1.3, I(1)=1, I(2)=6, quality grades 0-5. Check every constant the thesis states against this page.
- **ebbinghaus1913memory**: The forgetting curve and the savings method. Historical origin of spacing.
- **cepeda2006distributed**: Meta-analysis showing spaced practice beats massed practice, and how the best gap depends on the retention interval.
- **roediger2006testing**: Testing effect: retrieval practice improves long-term retention more than restudy. Why the cards are questions, not summaries.
- **settles2016hlr**: Half-life regression, a data-driven alternative to hand-tuned SM-2 (Duolingo).
- **ye2022ssp**: The research basis of FSRS. Supports "FSRS could replace SM-2 behind the same interface".
- *dunlosky2013techniques*: Review rating practice testing and distributed practice as high-utility learning techniques.
- *murre2015ebbinghaus*: Modern replication of Ebbinghaus's forgetting curve. Cite it with or instead of the 1885/1913 original.
- *su2023tkde*: The follow-up journal paper on memory-dynamics scheduling (FSRS lineage).

### Gamification (`sec:gamification`, RQ2)
- **deterding2011gamification**: The standard definition: game design elements in non-game contexts.
- **hamari2014gamification**: Literature review finding mostly positive but context-dependent effects.
- **sailer2020gamification**: Meta-analysis: small positive effects on cognitive, motivational and behavioural outcomes, with moderators. Keeps RQ2 claims modest.
- *ryan2000sdt*: Self-determination theory (autonomy, competence, relatedness). Theoretical lens behind the IMI.

### AI tutors and positioning (`sec:positioning`)
- **vanlehn2011tutoring**: Step-based intelligent tutoring systems come close to human tutoring in effect size. The "learning platforms" family.
- **kasneci2023chatgpt**: Opportunities and risks of LLMs in education. Context for an LLM-based platform.
- **zawacki2019aihe**: Systematic review of AI in higher education, which notes little involvement from educators.
- *bastani2025guardrails*: Field experiment in which unrestricted GPT access harmed learning and a guard-railed tutor reduced the harm. Supports a scoped, grounded tutor. A correction exists (see the bib note).
- *kestin2025aitutoring*: RCT in which a carefully designed AI tutor outperformed in-class active learning. A counterpoint for balance.

### Software engineering (`sec:idempotency`, `sec:reality-vs-documented`, `sec:built-vs-deployed`, `sec:threats`)
- **helland2012idempotence**: Idempotence as the practical answer to at-least-once messaging in distributed systems. The basis for the six-layer design.
- **desilva2012erosion**: Survey of architecture erosion (implementation drifting from intended architecture) and how to control it. A frame for the documented-versus-implemented ledger.
- **lethbridge2003documentation**: Developers know documentation is often out of date. Treats drift as an expected engineering phenomenon rather than a moral failing.
- **rahman2016toggles**: Feature toggles in practice, including the technical debt of long-lived flags. Relevant to features that are built but behind flags.
- **runeson2009casestudy**: Case-study guidelines, including validity categories. The method frame for a single-system audit.
- **wohlin2012experimentation**: Standard classification of validity threats (construct, internal, external, conclusion). Structure `sec:threats` with it.
- *perry1992foundations*: The original architectural "erosion" and "drift" terms.
- *aghajani2019docissues*: Empirical taxonomy of documentation issues, including outdated docs.
- *hodgson2017toggles*: Practitioner taxonomy of toggle types (release, ops, experiment, permission).

### LLM-as-judge (`sec:automated-eval`, `sec:threats`)
- **zheng2023judging**: Strong LLM judges agree with humans about as often as humans agree with each other. The paper also reports position, verbosity and self-enhancement biases. Justifies the judge and names its limits.
- **es2024ragas**: Reference-free RAG metrics (faithfulness, answer and context relevance). Possible harness metrics.
- **panickssery2024selfpreference**: LLM evaluators recognise and favour their own outputs. Directly supports the threat "judge shares a model family with the system under test".
- *wang2024fairevaluators*: Position bias in LLM evaluators changes rankings. Supports randomising answer order.

### Vector search (`sec:retrieval`, `sec:data-model`)
- **malkov2020hnsw**: The HNSW algorithm behind pgvector's approximate index. Recall-versus-speed trade-off.

### Study instruments (`sec:unanswered`)
- **brooke1996sus**: The System Usability Scale, a 10-item usability measure. Page numbers differ between printings (see the bib note).
- **laugwitz2008ueq**: The User Experience Questionnaire, which covers hedonic as well as pragmatic quality.
- **mcauley1989imi**: Psychometric validation of the Intrinsic Motivation Inventory. The instrument for RQ2 motivation.
- **davis1989tam**: Perceived usefulness and ease of use (TAM). The instrument family for RQ3 "perceived efficiency and usability".
- *bangor2008sus*: Norms for interpreting SUS scores (adjective scale).

## 3. Not included, and why
- No source was found for **LLM provider unavailability / fallback chains** (`sec:provider-strategy`). Treat it as an engineering decision, or cite provider status pages as @misc.
- **MarkItDown, LlamaParse, OpenDataLoader** are software. Add them as @misc tool entries next to the existing `pymupdf` entry, not as academic sources.
- **Postgres RLS** is already covered by the existing `postgresql-rls` @misc. No peer-reviewed RLS paper was needed.
- Page numbers are left out of the NeurIPS 2020/2022/2023 entries because the proceedings pages that were checked did not show them.
