# How many people read in production

Cited by chapter 5, opening ("almost no readers") and section 5.6.1.

**Method.** One read-only query on the production database, November 2026,
inside `BEGIN READ ONLY … ROLLBACK` with `default_transaction_read_only=on`.
Aggregates only: no user ids, names, or event payloads were read out. The
query counts readers the way the engine does
(`backend/services/insights/sources/space.py`, members from
`course_enrollments` without the course's owner): a member who has a
`slide_view` with a positive duration on one of the Space's Lessons in the
last 56 days. A page is identified by the Lesson and the event's page (or
slide id for older events).

| | count |
|---|---|
| Spaces with at least one member who read | 4 |
| most readers in one Space | 6 |
| most readers on one page | 5 |
| pages with at least five readers (the floor) | 1 |

**What it is and is not.** A snapshot of one 56-day window. It counts
accounts, and the developers' own accounts may be among them. It does not
say whether the one page at the floor carried a finding: a finding also
needs five of the page's readers to rate it, try it, or turn back.

```sql
BEGIN READ ONLY;
WITH v AS (
  SELECT e.user_id, l.course_id, e.event_data->>'lectureId' AS lec,
         coalesce(e.event_data->>'page', e.event_data->>'slideId') AS pg
  FROM learning_events e
  JOIN lectures l ON l.id::text = e.event_data->>'lectureId'
  WHERE e.event_type = 'slide_view' AND e.created_at > now() - interval '56 days'
    AND coalesce((e.event_data->>'duration_seconds')::int, 0) > 0 AND l.course_id IS NOT NULL
), m AS (
  SELECT v.* FROM v
  JOIN course_enrollments ce ON ce.course_id = v.course_id AND ce.user_id = v.user_id
  JOIN courses c ON c.id = v.course_id AND c.professor_id <> v.user_id
)
SELECT
  (SELECT count(DISTINCT course_id) FROM m) AS spaces_with_member_reading,
  (SELECT coalesce(max(n), 0) FROM (SELECT count(DISTINCT user_id) n FROM m GROUP BY course_id) a) AS max_member_readers_in_a_space,
  (SELECT coalesce(max(n), 0) FROM (SELECT count(DISTINCT user_id) n FROM m GROUP BY lec, pg) b) AS max_member_readers_on_a_page,
  (SELECT count(*) FROM (SELECT 1 FROM m GROUP BY lec, pg HAVING count(DISTINCT user_id) >= 5) c) AS pages_at_floor;
ROLLBACK;
```
