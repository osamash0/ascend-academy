-- 1. Overview Panel
SELECT 
    (SELECT COUNT(DISTINCT student_id) FROM students) as unique_students,
    (SELECT ROUND(AVG(score_percentage), 2) FROM assessments) as class_average_score,
    (SELECT COUNT(*) FROM assessments) as total_quiz_attempts;

-- 2. Slide Performance Index (Slide 2)
SELECT 
    slide_id,
    ROUND(AVG(duration_seconds), 2) as avg_duration,
    ROUND(SUM(CASE WHEN confidence_rating IN ('confused', 'unsure') THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as confusion_index_percent,
    (SELECT COUNT(*) FROM ai_interactions WHERE slide_id = 'SLIDE_2' AND is_subject_relevant = 1) as ai_queries
FROM telemetry_events 
WHERE slide_id = 'SLIDE_2'
GROUP BY slide_id;

-- 3. Confidence Map (Class-wide)
SELECT 
    slide_id,
    confidence_rating,
    COUNT(*) as count
FROM telemetry_events
GROUP BY slide_id, confidence_rating
ORDER BY slide_id, confidence_rating;

-- 4. Drop-off Data (Slide 2 Drop-off Rate)
SELECT 
    ROUND(CAST(SUM(CASE WHEN drop_off = 1 THEN 1 ELSE 0 END) AS FLOAT) / 
          (SELECT COUNT(DISTINCT student_id) FROM telemetry_events WHERE slide_id = 'SLIDE_2') * 100, 2) as slide_2_dropoff_rate
FROM telemetry_events
WHERE slide_id = 'SLIDE_2';

-- 5. Student Typologies
SELECT student_id, name, typology FROM students ORDER BY student_id;

-- 6. Filtered AI Queries
SELECT student_id, slide_id, query_text FROM ai_interactions WHERE is_subject_relevant = 1;
