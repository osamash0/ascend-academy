# Where the deck quiz attached its questions, before and after the deck plan

Cited by chapter 4, section 4.3.3 ("Planning the Deck Without a Model").

**The question.** Before commit f34a7870 (merged with PR #84 in October 2026) the
deck quiz kept the first 10 pages with more than 50 characters and showed them to
the model as "Slide 1" to "Slide 10", not with their real page numbers
(`synthesis.py` before f34a7870, lines 96–102). The page number the model gave
back was stored as a real page (`_map_deck_quiz`, lines 224–236). PR #84 says this
"anchored every question to slide 0". This note checks that in production.

**Method.** One read-only query on the production database, November 2026, inside
`BEGIN READ ONLY … ROLLBACK` with `default_transaction_read_only=on`. Aggregates
only; no question text was read. A deck question is a `quiz_questions` row whose
`metadata->>'is_deck'` is `true`; its anchor is the page of its `slide_id`,
counted from the first page of its lecture. "Before" means created before the
merge of PR #84 (2026-10-13).

| Month | Period | Deck questions | Lectures | On the first page | Mean anchor page | Highest anchor page | Mean deck length |
|---|---|---|---|---|---|---|---|
| June 2026 | before | 37 | 6 | 15 | 3.7 | 11 | 37 |
| July 2026 | before | 359 | 54 | 16 | 5.5 | 10 | 36 |
| August 2026 | before | 121 | 18 | 1 | 5.9 | 10 | 46 |
| September 2026 | before | 7 | 1 | 0 | 5.1 | 8 | 27 |
| October 2026 | after | 115 | 18 | 0 | 24.7 | 121 | 55 |
| November 2026 | after | 7 | 1 | 0 | 7.4 | 13 | 14 |

**Result.** Before the fix: 524 deck questions in 79 lectures, all on the first
eleven pages of their deck, 32 of them (6 %) on the first page. After the fix the
anchors reach page 121. So the claim "every question on slide 0" does not hold;
what holds is that every question sat near the start of the deck, whatever page
its content came from.

**Limits.** The query shows where questions were attached, not whether each one
was attached to the wrong page; that would need reading the questions. Lectures
deleted since then are not counted.

```sql
BEGIN READ ONLY;
WITH dq AS (
  SELECT q.created_at, s.lecture_id, s.slide_number AS anchor,
         (SELECT min(slide_number) FROM slides s2 WHERE s2.lecture_id = s.lecture_id) AS first_no,
         (SELECT count(*) FROM slides s3 WHERE s3.lecture_id = s.lecture_id) AS pages
  FROM quiz_questions q JOIN slides s ON s.id = q.slide_id
  WHERE q.metadata->>'is_deck' = 'true'
)
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS mon,
       CASE WHEN created_at < '2026-10-13' THEN 'before' ELSE 'after' END AS period,
       count(*) AS deck_questions,
       count(DISTINCT lecture_id) AS lectures,
       count(*) FILTER (WHERE anchor = first_no) AS on_first_page,
       round(avg(anchor - first_no + 1), 1) AS avg_anchor_page,
       max(anchor - first_no + 1) AS max_anchor_page,
       round(avg(pages), 0) AS avg_deck_pages
FROM dq GROUP BY 1, 2 ORDER BY 1, 2;
ROLLBACK;
```
