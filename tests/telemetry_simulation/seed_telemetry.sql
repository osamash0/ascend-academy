-- Students
INSERT INTO students (student_id, name) VALUES ('S1', 'Nova');
INSERT INTO students (student_id, name) VALUES ('S2', 'Astra');
INSERT INTO students (student_id, name) VALUES ('S3', 'Leo');

-- Slides
INSERT INTO slides (slide_id, title) VALUES ('SLIDE_1', 'Intro');
INSERT INTO slides (slide_id, title) VALUES ('SLIDE_2', 'Core Normalization');
INSERT INTO slides (slide_id, title) VALUES ('SLIDE_3', 'Conclusion');

-- Scenario A: Nova (Struggling)
INSERT INTO telemetry_events (student_id, slide_id, duration_seconds, confidence_rating, drop_off) 
VALUES ('S1', 'SLIDE_1', 15, 'unsure', 0);
INSERT INTO telemetry_events (student_id, slide_id, duration_seconds, confidence_rating, drop_off) 
VALUES ('S1', 'SLIDE_2', 120, 'confused', 1); -- Drops off here
INSERT INTO assessments (student_id, slide_id, score_percentage) 
VALUES ('S1', 'SLIDE_2', 35);
INSERT INTO ai_interactions (student_id, slide_id, query_text) 
VALUES ('S1', 'SLIDE_2', 'Why does 3NF require removing transitive dependencies?');

-- Scenario B: Astra (Thriving)
INSERT INTO telemetry_events (student_id, slide_id, duration_seconds, confidence_rating, drop_off) 
VALUES ('S2', 'SLIDE_1', 20, 'got_it', 0);
INSERT INTO telemetry_events (student_id, slide_id, duration_seconds, confidence_rating, drop_off) 
VALUES ('S2', 'SLIDE_2', 45, 'got_it', 0);
INSERT INTO assessments (student_id, slide_id, score_percentage) 
VALUES ('S2', 'SLIDE_2', 90);
INSERT INTO telemetry_events (student_id, slide_id, duration_seconds, confidence_rating, drop_off) 
VALUES ('S2', 'SLIDE_3', 30, 'got_it', 0); -- Completes module

-- Scenario C: Leo (Average)
INSERT INTO telemetry_events (student_id, slide_id, duration_seconds, confidence_rating, drop_off) 
VALUES ('S3', 'SLIDE_1', 25, 'got_it', 0);
INSERT INTO telemetry_events (student_id, slide_id, duration_seconds, confidence_rating, drop_off) 
VALUES ('S3', 'SLIDE_2', 75, 'unsure', 0);
INSERT INTO assessments (student_id, slide_id, score_percentage) 
VALUES ('S3', 'SLIDE_2', 70);
INSERT INTO ai_interactions (student_id, slide_id, query_text) 
VALUES ('S3', 'SLIDE_2', 'Hello AI');
INSERT INTO ai_interactions (student_id, slide_id, query_text) 
VALUES ('S3', 'SLIDE_2', 'What is a primary key?');
INSERT INTO telemetry_events (student_id, slide_id, duration_seconds, confidence_rating, drop_off) 
VALUES ('S3', 'SLIDE_3', 30, 'got_it', 0); -- Completes module
