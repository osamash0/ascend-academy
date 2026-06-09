-- ============================================================================
-- Seed: University of Marburg — B.Sc. Computer Science catalog.
-- Makes onboarding pre-population demoable WITHOUT running the scraper.
-- Uses source='scraper:marburg' + stable external_ref values so a later run of
-- the Marburg scraper UPSERTs these rows in place (no duplicates).
-- Idempotent.
-- ============================================================================

DO $$
DECLARE
  _uni     UUID;
  _faculty UUID;
  _program UUID;
BEGIN
  -- University ---------------------------------------------------------------
  INSERT INTO public.universities (name, country, city, email_domains, source, external_ref, last_scraped_at)
  VALUES ('University of Marburg', 'Germany', 'Marburg',
          ARRAY['students.uni-marburg.de','uni-marburg.de','staff.uni-marburg.de'],
          'scraper:marburg', 'uni-marburg', now())
  ON CONFLICT (source, external_ref) DO UPDATE
    SET name = EXCLUDED.name, country = EXCLUDED.country, city = EXCLUDED.city,
        email_domains = EXCLUDED.email_domains, last_scraped_at = now(), updated_at = now()
  RETURNING id INTO _uni;

  -- Faculty ------------------------------------------------------------------
  INSERT INTO public.faculties (university_id, name, source, external_ref, last_scraped_at)
  VALUES (_uni, 'Mathematics & Computer Science (FB12)', 'scraper:marburg', 'marburg-fb12', now())
  ON CONFLICT (source, external_ref) DO UPDATE
    SET name = EXCLUDED.name, university_id = EXCLUDED.university_id,
        last_scraped_at = now(), updated_at = now()
  RETURNING id INTO _faculty;

  -- Degree program ------------------------------------------------------------
  INSERT INTO public.degree_programs (faculty_id, name, degree_level, total_semesters, source, external_ref, last_scraped_at)
  VALUES (_faculty, 'Computer Science (B.Sc.)', 'bachelor', 6, 'scraper:marburg', 'marburg-bsc-informatik', now())
  ON CONFLICT (source, external_ref) DO UPDATE
    SET name = EXCLUDED.name, faculty_id = EXCLUDED.faculty_id,
        degree_level = EXCLUDED.degree_level, total_semesters = EXCLUDED.total_semesters,
        last_scraped_at = now(), updated_at = now()
  RETURNING id INTO _program;

  -- Catalog courses -----------------------------------------------------------
  INSERT INTO public.catalog_courses
    (degree_program_id, title, course_code, typical_semester, credits, language, is_mandatory, source, external_ref, last_scraped_at)
  VALUES
    (_program, 'Foundations of Programming',        'CS-GP',   1, 9, 'de', TRUE, 'scraper:marburg', 'marburg-cs-gp',   now()),
    (_program, 'Linear Algebra',                     'CS-LA',   1, 9, 'de', TRUE, 'scraper:marburg', 'marburg-cs-la',   now()),
    (_program, 'Digital Systems & Computer Architecture','CS-TI',1, 6, 'de', TRUE, 'scraper:marburg', 'marburg-cs-ti',   now()),
    (_program, 'Algorithms & Data Structures',       'CS-ADS',  2, 9, 'de', TRUE, 'scraper:marburg', 'marburg-cs-ads',  now()),
    (_program, 'Analysis',                           'CS-AN',   2, 9, 'de', TRUE, 'scraper:marburg', 'marburg-cs-an',   now()),
    (_program, 'Object-Oriented Programming',        'CS-OOP',  2, 6, 'de', TRUE, 'scraper:marburg', 'marburg-cs-oop',  now()),
    (_program, 'Database Systems',                   'CS-DB',   3, 6, 'de', TRUE, 'scraper:marburg', 'marburg-cs-db',   now()),
    (_program, 'Operating Systems',                  'CS-OS',   3, 6, 'de', TRUE, 'scraper:marburg', 'marburg-cs-os',   now()),
    (_program, 'Probability & Statistics',           'CS-STO',  3, 6, 'de', TRUE, 'scraper:marburg', 'marburg-cs-sto',  now()),
    (_program, 'Software Engineering',               'CS-SE',   4, 9, 'de', TRUE, 'scraper:marburg', 'marburg-cs-se',   now()),
    (_program, 'Computer Networks',                  'CS-NET',  4, 6, 'de', TRUE, 'scraper:marburg', 'marburg-cs-net',  now()),
    (_program, 'Theoretical Computer Science',       'CS-THEO', 4, 9, 'de', TRUE, 'scraper:marburg', 'marburg-cs-theo', now()),
    (_program, 'Machine Learning',                   'CS-ML',   NULL, 6, 'en', FALSE, 'scraper:marburg', 'marburg-cs-ml', now()),
    (_program, 'Computer Graphics',                  'CS-CG',   NULL, 6, 'en', FALSE, 'scraper:marburg', 'marburg-cs-cg', now())
  ON CONFLICT (source, external_ref) DO UPDATE
    SET degree_program_id = EXCLUDED.degree_program_id, title = EXCLUDED.title,
        course_code = EXCLUDED.course_code, typical_semester = EXCLUDED.typical_semester,
        credits = EXCLUDED.credits, language = EXCLUDED.language, is_mandatory = EXCLUDED.is_mandatory,
        last_scraped_at = now(), updated_at = now();
END $$;
