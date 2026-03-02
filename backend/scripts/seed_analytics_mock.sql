-- ============================================================
-- Ascend Academy — Analytics Mock Data
-- Run this in: Supabase Dashboard → SQL Editor
-- Professor UUID: 3234c12b-db9f-4a9e-b25e-adde080ebdd6
-- ============================================================

DO $$
DECLARE
  prof_id   UUID := '3234c12b-db9f-4a9e-b25e-adde080ebdd6';

  lec1 UUID := gen_random_uuid();
  lec2 UUID := gen_random_uuid();
  lec3 UUID := gen_random_uuid();

  slide_ids UUID[] := ARRAY[]::UUID[];
  slide_id  UUID;
  slide_title TEXT;

  lec_id   UUID;
  all_lecs UUID[];
  i INT;
  j INT;
  pass INT;
  correct BOOLEAN;
  conf TEXT;
  conf_opts TEXT[] := ARRAY['got_it','got_it','got_it','unsure','unsure','confused'];
  ts TIMESTAMPTZ;
  total_q INT;
  total_c INT;
BEGIN

-- ─────────────────────────────────────────────
--  1. LECTURES
-- ─────────────────────────────────────────────
INSERT INTO lectures (id, title, description, professor_id, total_slides) VALUES
  (lec1, 'Introduction to Machine Learning',
   'Core concepts of supervised and unsupervised learning', prof_id, 8),
  (lec2, 'Advanced Data Structures',
   'Graphs, trees, heaps, and algorithm complexity', prof_id, 8),
  (lec3, 'Web Development Fundamentals',
   'HTML, CSS, JavaScript and the modern web stack', prof_id, 8);

all_lecs := ARRAY[lec1, lec2, lec3];

-- ─────────────────────────────────────────────
--  2. SLIDES (8 per lecture)
-- ─────────────────────────────────────────────
FOREACH slide_title IN ARRAY ARRAY[
  'What is Machine Learning?','Supervised vs Unsupervised Learning',
  'Linear Regression Fundamentals','Decision Trees and Random Forests',
  'Neural Network Basics','Model Training and Validation',
  'Overfitting and Regularisation','Real-World ML Applications',
  'Arrays and Linked Lists','Binary Search Trees',
  'Balanced Trees (AVL)','Graph Representations',
  'BFS and DFS Traversal','Heaps and Priority Queues',
  'Hash Tables','Big-O Complexity',
  'How the Web Works','HTML Structure and Semantics',
  'CSS Layout and Flexbox','JavaScript Basics',
  'DOM Manipulation','Fetch API and REST',
  'Intro to React','Deploying a Web App'
] LOOP
  i := array_position(ARRAY[
    'What is Machine Learning?','Supervised vs Unsupervised Learning',
    'Linear Regression Fundamentals','Decision Trees and Random Forests',
    'Neural Network Basics','Model Training and Validation',
    'Overfitting and Regularisation','Real-World ML Applications',
    'Arrays and Linked Lists','Binary Search Trees',
    'Balanced Trees (AVL)','Graph Representations',
    'BFS and DFS Traversal','Heaps and Priority Queues',
    'Hash Tables','Big-O Complexity',
    'How the Web Works','HTML Structure and Semantics',
    'CSS Layout and Flexbox','JavaScript Basics',
    'DOM Manipulation','Fetch API and REST',
    'Intro to React','Deploying a Web App'
  ], slide_title);

  slide_id := gen_random_uuid();

  INSERT INTO slides (id, lecture_id, slide_number, title, content_text, summary) VALUES (
    slide_id,
    CASE WHEN i <= 8 THEN lec1 WHEN i <= 16 THEN lec2 ELSE lec3 END,
    CASE WHEN i <= 8 THEN i WHEN i <= 16 THEN i-8 ELSE i-16 END,
    slide_title,
    '## ' || slide_title || E'\n\nKey concepts covered in this slide.',
    'Summary of ' || slide_title
  );
  INSERT INTO quiz_questions (slide_id, question_text, options, correct_answer) VALUES (
    slide_id,
    'What best describes: ' || slide_title || '?',
    '["Correct answer","Wrong answer A","Wrong answer B","None of the above"]', 0
  );
  slide_ids := slide_ids || slide_id;
END LOOP;

-- ─────────────────────────────────────────────
--  3. EVENTS — 5 passes as "different sessions"
--     (All under prof_id since only real auth
--      users can satisfy the FK constraint)
-- ─────────────────────────────────────────────
FOR pass IN 1..5 LOOP
  FOREACH lec_id IN ARRAY all_lecs LOOP
    CONTINUE WHEN random() < 0.25;

    total_q := 0;
    total_c := 0;
    ts := now() - ((random() * 7 + (pass-1)) * interval '1 day');

    INSERT INTO learning_events (user_id, event_type, event_data, created_at) VALUES
      (prof_id, 'lecture_start', jsonb_build_object('lectureId', lec_id), ts);

    FOR j IN 1..8 LOOP
      slide_id := slide_ids[
        CASE lec_id WHEN lec1 THEN j WHEN lec2 THEN 8+j ELSE 16+j END
      ];
      ts := now() - ((random() * 7 + (pass-1)) * interval '1 day');

      IF random() > 0.2 THEN
        INSERT INTO learning_events (user_id, event_type, event_data, created_at) VALUES (
          prof_id, 'slide_view', jsonb_build_object(
            'lectureId', lec_id, 'slideId', slide_id,
            'slideTitle', slide_title,
            'duration_seconds', (20 + floor(random()*220))::int,
            'timestamp', ts
          ), ts);
      END IF;

      IF random() < 0.70 THEN
        correct := random() < 0.65;
        total_q := total_q + 1;
        IF correct THEN total_c := total_c + 1; END IF;
        INSERT INTO learning_events (user_id, event_type, event_data, created_at) VALUES (
          prof_id, 'quiz_attempt', jsonb_build_object(
            'lectureId', lec_id, 'slideId', slide_id,
            'slideTitle', slide_title, 'correct', correct,
            'time_to_answer_seconds', (5 + floor(random()*40))::int,
            'timestamp', ts
          ), ts);
      END IF;

      IF random() < 0.60 THEN
        conf := conf_opts[1 + floor(random()*6)::int];
        INSERT INTO learning_events (user_id, event_type, event_data, created_at) VALUES (
          prof_id, 'confidence_rating', jsonb_build_object(
            'lectureId', lec_id, 'slideId', slide_id,
            'slideTitle', slide_title, 'rating', conf, 'timestamp', ts
          ), ts);
      END IF;
    END LOOP;

    IF random() < 0.60 THEN
      INSERT INTO learning_events (user_id, event_type, event_data, created_at) VALUES (
        prof_id, 'lecture_complete', jsonb_build_object(
          'lectureId', lec_id, 'xpEarned', total_c*10,
          'correctAnswers', total_c,
          'total_duration_seconds', (300 + floor(random()*2100))::int
        ), now() - (random() * interval '6 days'));
    END IF;

    INSERT INTO student_progress
      (user_id, lecture_id, completed_slides, quiz_score,
       total_questions_answered, correct_answers, xp_earned)
    VALUES (
      prof_id, lec_id, ARRAY[1,2,3,4,5,6,7,8],
      CASE WHEN total_q > 0 THEN round((total_c::numeric/total_q)*100) ELSE 0 END,
      total_q, total_c, total_c*10
    )
    ON CONFLICT (user_id, lecture_id) DO UPDATE SET
      quiz_score = EXCLUDED.quiz_score,
      total_questions_answered = student_progress.total_questions_answered + EXCLUDED.total_questions_answered,
      correct_answers = student_progress.correct_answers + EXCLUDED.correct_answers;
  END LOOP;
END LOOP;

RAISE NOTICE '✅ Mock data seeded! Open /professor/analytics to see results.';
END $$;
