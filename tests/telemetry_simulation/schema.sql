CREATE TABLE students (
    student_id TEXT PRIMARY KEY,
    name TEXT,
    typology TEXT
);

CREATE TABLE slides (
    slide_id TEXT PRIMARY KEY,
    title TEXT
);

CREATE TABLE telemetry_events (
    event_id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT,
    slide_id TEXT,
    duration_seconds INTEGER,
    confidence_rating TEXT,
    drop_off BOOLEAN,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(student_id) REFERENCES students(student_id),
    FOREIGN KEY(slide_id) REFERENCES slides(slide_id)
);

CREATE TABLE assessments (
    attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT,
    slide_id TEXT,
    score_percentage INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(student_id) REFERENCES students(student_id),
    FOREIGN KEY(slide_id) REFERENCES slides(slide_id)
);

CREATE TABLE ai_interactions (
    interaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id TEXT,
    slide_id TEXT,
    query_text TEXT,
    is_subject_relevant BOOLEAN,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(student_id) REFERENCES students(student_id),
    FOREIGN KEY(slide_id) REFERENCES slides(slide_id)
);
