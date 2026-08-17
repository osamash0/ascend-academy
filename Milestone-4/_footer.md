---

## Appendix — provenance and how to maintain this document

### What was merged, and what that changed

Five audits produced ~90 raw finding rows. Reconciliation reduced them to 81 (`M1`–`M81`); a
source-level pass added 50 more (`R1`–`R50`).

The dedup was not clerical. Three merges changed what the findings *mean*:

- **M16** — one stalled-upload defect had been reported three separate times, at three different layers, by three documents. It is one bug.
- **M39 / M36** — a browser-observed lecture-count discrepancy (16 / 1 / 0) looked like an aggregation bug. A database query from a repo-enabled session explains it as **duplicate course rows**. Writing selector code against the browser symptom would have fixed nothing.
- **M6** — a prod audit observed a `/profiles` refetch storm and could not explain it. A repo session found the cause (an unmemoized callback used as an effect dependency), fixed it, and measured the result. Symptom and cause were filed as separate findings until they were merged.

The pattern: **a browser-observed symptom and its source-level cause are one finding, not two.**
Keep it that way as this document is updated.

### Evidence standards used here

- Every `R` finding cites `file:line` and quotes the code. None are inferred.
- Every performance claim states the measurement, the window, and the control.
- Findings that could not be verified are marked as such rather than hedged into the table.
- One finding is **retracted** (§2.1 of doc A, the "invisible feature cards" claim). Retractions are kept visible rather than deleted, so they are not re-discovered and re-filed. This has already paid for itself: the same artifact recurred three times during compilation.

### Known gaps in this document

- Prod-vs-repo drift is **inferred, not measured**. Nobody has diffed the deployed build against `main`. Until someone does, treat every prod-only finding as "may already be fixed" and every repo-only finding as "may not be deployed."
- The `R` findings are **static-analysis findings**. They are precise about what the code does and silent about how often each path is actually hit in practice.
- Severity is harmonized across five authors with different scales. Where two documents disagreed the higher severity was kept and the disagreement noted (see B4). Treat severity as a starting point for triage, not a verdict.

### Maintaining this file

1. New findings get the next free `M` or `R` id. **Never renumber** — the ids are cited across five source documents, four fix plans and this file's own cross-references.
2. When a finding is fixed, mark it `✅ FIXED — commit <sha>` in place. Do not delete the row; the fixed rows are how the merge order stays readable.
3. When a finding is disproved, mark it **RETRACTED** with the reason. Do not delete it.
4. Re-run the Part 1 rAF pre-flight before recording any visual finding. Every time.

### Source documents

Preserved in this folder as primary evidence. This file supersedes them for action, but they carry
detail — DOM measurements, network traces, hit-test grids, data-integrity statements — that was
compressed here.

| File | What it is |
|---|---|
| `APP_AUDIT_REPORT.md` (this file) | The consolidated, actionable audit |
| `LEARNSTATION_FULL_APP_AUDIT.md` | Prod browser drive, ~30 routes, student + professor + admin gating |
| `PART_2_STUDENT_AUDIT.md` | Prod student pass — superseded by the above, retained for its evidence |
| `PROFESSOR_ACCOUNT_AUDIT.md` | Prod professor pass, hit-test grids, `prof@admin.com` |
| `AUDIT_ADDENDUM_previously_uncovered.md` | Prod write-testing with authorized reversible edits; includes the data-integrity statement |
| `_reconciled_A_B.md`, `_reconciled_C_D_E.md`, `_source_audit.md`, `_header.md`, `_footer.md` | Build inputs for this file. Safe to delete once you're happy with the assembled result. |
| `learnstation-data-2026-08-17.json` | Data export captured during the prod sessions |

---

*Compiled 2026-08-18. Findings verified against a running app or actual source; none inferred from
documentation. Where a claim could not be verified, the row says so.*
