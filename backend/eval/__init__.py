"""AI evaluation harness (Roadmap Foundation 10x, Phase 1 P1-3).

Before this package, AI output quality was unmeasured: the only "eval" is
backend/tests/unit/test_course_tutor_grounding.py, which exercises a pure
threshold function and never calls a model or embeds anything. Every
prompt change, model swap, or provider failover could silently change
output quality with no way to detect a regression.

This package defines:
  - golden_sets.py  — frozen golden-set fixtures + case dataclasses for the
                       three measurable quality dimensions (quiz answer-key
                       accuracy, tutor faithfulness, retrieval precision@k).
  - scorer.py        — pure scoring functions over a golden set + a
                       pipeline's outputs.
  - judge.py         — an LLM-judge wrapper for open-ended synthesis
                       quality, with the actual model call injected so it's
                       testable without live API calls.
  - pipeline.py       — the EvalPipeline protocol + a FakePipeline (for
                       CI-safe tests) and LivePipeline (wires the real
                       retrieval/orchestrator calls for a real nightly run).
  - run_eval.py      — orchestrates a full run, persists to `eval_runs`,
                       and fails (non-zero exit) on a regression beyond the
                       configured band.

Run with: python -m backend.eval.run_eval
"""
