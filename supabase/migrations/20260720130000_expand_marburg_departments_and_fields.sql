-- ============================================================================
-- Philipps-Universität Marburg — departments and principal academic fields
--
-- Seeds the 16 Fachbereiche and their high-level fields from the university's
-- department map. These are selectable study fields, not a claim that every
-- row is a separately accredited degree title. The existing B.Sc. Computer
-- Science programme and its course catalog remain the detailed catalog entry.
-- Idempotent: external references are stable and safe to re-run.
-- ============================================================================

WITH marburg AS (
  SELECT id
  FROM public.universities
  WHERE source = 'scraper:marburg' AND external_ref = 'uni-marburg'
), faculty_seed (external_ref, name) AS (
  VALUES
    ('marburg-fb01', 'Law (FB01)'),
    ('marburg-fb02', 'Economics and Management (FB02)'),
    ('marburg-fb03', 'Social Sciences and Philosophy (FB03)'),
    ('marburg-fb04', 'Psychology (FB04)'),
    ('marburg-fb05', 'Protestant Theology (FB05)'),
    ('marburg-fb06', 'History and Cultural Studies (FB06)'),
    ('marburg-fb09', 'German Studies and Art Studies (FB09)'),
    ('marburg-fb10', 'Modern Languages and Foreign Philologies (FB10)'),
    ('marburg-fb12', 'Mathematics and Computer Science (FB12)'),
    ('marburg-fb13', 'Physics (FB13)'),
    ('marburg-fb15', 'Chemistry (FB15)'),
    ('marburg-fb16', 'Pharmacy (FB16)'),
    ('marburg-fb17', 'Biology (FB17)'),
    ('marburg-fb19', 'Geography (FB19)'),
    ('marburg-fb20', 'Medicine (FB20)'),
    ('marburg-fb21', 'Educational Sciences (FB21)')
)
INSERT INTO public.faculties (university_id, name, source, external_ref, last_scraped_at)
SELECT marburg.id, faculty_seed.name, 'scraper:marburg', faculty_seed.external_ref, now()
FROM marburg CROSS JOIN faculty_seed
ON CONFLICT (source, external_ref) DO UPDATE
  SET university_id = EXCLUDED.university_id,
      name = EXCLUDED.name,
      last_scraped_at = now(),
      updated_at = now();

WITH field_seed (faculty_ref, external_ref, name) AS (
  VALUES
    ('marburg-fb01', 'marburg-fb01-law', 'Law'),
    ('marburg-fb01', 'marburg-fb01-civil-law', 'Civil Law'),
    ('marburg-fb01', 'marburg-fb01-criminal-law', 'Criminal Law'),
    ('marburg-fb01', 'marburg-fb01-public-law', 'Public Law'),
    ('marburg-fb01', 'marburg-fb01-legal-theory-history', 'Legal Theory and History'),
    ('marburg-fb01', 'marburg-fb01-international-european-law', 'International and European Law'),
    ('marburg-fb02', 'marburg-fb02-business-administration', 'Business Administration'),
    ('marburg-fb02', 'marburg-fb02-economics', 'Economics'),
    ('marburg-fb02', 'marburg-fb02-finance-accounting', 'Finance and Accounting'),
    ('marburg-fb02', 'marburg-fb02-management-marketing', 'Management and Marketing'),
    ('marburg-fb02', 'marburg-fb02-business-informatics', 'Business Informatics'),
    ('marburg-fb02', 'marburg-fb02-economic-policy', 'Economic Policy'),
    ('marburg-fb03', 'marburg-fb03-philosophy', 'Philosophy'),
    ('marburg-fb03', 'marburg-fb03-political-science', 'Political Science'),
    ('marburg-fb03', 'marburg-fb03-sociology', 'Sociology'),
    ('marburg-fb03', 'marburg-fb03-media-studies', 'Media Studies'),
    ('marburg-fb03', 'marburg-fb03-peace-conflict-studies', 'Peace and Conflict Studies'),
    ('marburg-fb03', 'marburg-fb03-religious-studies', 'Religious Studies'),
    ('marburg-fb03', 'marburg-fb03-sports-science', 'Sports Science'),
    ('marburg-fb03', 'marburg-fb03-social-cultural-analysis', 'Social and Cultural Analysis'),
    ('marburg-fb04', 'marburg-fb04-psychology', 'Psychology'),
    ('marburg-fb04', 'marburg-fb04-clinical-psychotherapy', 'Clinical Psychology and Psychotherapy'),
    ('marburg-fb04', 'marburg-fb04-developmental-psychology', 'Developmental Psychology'),
    ('marburg-fb04', 'marburg-fb04-cognitive-psychology', 'Cognitive Psychology'),
    ('marburg-fb04', 'marburg-fb04-biological-psychology', 'Biological Psychology'),
    ('marburg-fb04', 'marburg-fb04-work-organisational-psychology', 'Work and Organisational Psychology'),
    ('marburg-fb04', 'marburg-fb04-psychological-methods', 'Psychological Methods'),
    ('marburg-fb05', 'marburg-fb05-biblical-studies', 'Biblical Studies'),
    ('marburg-fb05', 'marburg-fb05-church-history', 'Church History'),
    ('marburg-fb05', 'marburg-fb05-systematic-theology', 'Systematic Theology'),
    ('marburg-fb05', 'marburg-fb05-practical-theology', 'Practical Theology'),
    ('marburg-fb05', 'marburg-fb05-religious-education', 'Religious Education'),
    ('marburg-fb05', 'marburg-fb05-ecumenism', 'Ecumenism and Interreligious Dialogue'),
    ('marburg-fb06', 'marburg-fb06-history', 'History'),
    ('marburg-fb06', 'marburg-fb06-archaeology', 'Archaeology'),
    ('marburg-fb06', 'marburg-fb06-ancient-studies', 'Ancient Studies'),
    ('marburg-fb06', 'marburg-fb06-prehistory', 'Prehistory and Early History'),
    ('marburg-fb06', 'marburg-fb06-art-material-culture', 'Art and Material Culture'),
    ('marburg-fb06', 'marburg-fb06-cultural-studies', 'Cultural Studies'),
    ('marburg-fb06', 'marburg-fb06-historical-research', 'Regional and Global Historical Research'),
    ('marburg-fb09', 'marburg-fb09-german-language-literature', 'German Language and Literature'),
    ('marburg-fb09', 'marburg-fb09-linguistics', 'Linguistics'),
    ('marburg-fb09', 'marburg-fb09-literary-studies', 'Literary Studies'),
    ('marburg-fb09', 'marburg-fb09-art-history', 'Art History'),
    ('marburg-fb09', 'marburg-fb09-visual-culture', 'Visual Culture'),
    ('marburg-fb09', 'marburg-fb09-music-cultural-analysis', 'Music and Cultural Analysis'),
    ('marburg-fb10', 'marburg-fb10-english-american-studies', 'English and American Studies'),
    ('marburg-fb10', 'marburg-fb10-romance-languages', 'Romance Languages and Literatures'),
    ('marburg-fb10', 'marburg-fb10-applied-linguistics', 'Applied Linguistics'),
    ('marburg-fb10', 'marburg-fb10-language-acquisition', 'Language Acquisition'),
    ('marburg-fb10', 'marburg-fb10-translation-culture', 'Translation and Culture Studies'),
    ('marburg-fb10', 'marburg-fb10-foreign-language-education', 'Foreign-language Teacher Education'),
    ('marburg-fb12', 'marburg-fb12-mathematics', 'Mathematics'),
    ('marburg-fb12', 'marburg-fb12-statistics', 'Statistics'),
    ('marburg-fb12', 'marburg-bsc-informatik', 'Computer Science (B.Sc.)'),
    ('marburg-fb12', 'marburg-fb12-theoretical-practical-cs', 'Theoretical and Practical Computer Science'),
    ('marburg-fb12', 'marburg-fb12-algorithms-data-systems', 'Algorithms and Data Systems'),
    ('marburg-fb12', 'marburg-fb12-scientific-computing', 'Scientific Computing'),
    ('marburg-fb13', 'marburg-fb13-experimental-physics', 'Experimental Physics'),
    ('marburg-fb13', 'marburg-fb13-theoretical-physics', 'Theoretical Physics'),
    ('marburg-fb13', 'marburg-fb13-condensed-matter', 'Condensed Matter Physics'),
    ('marburg-fb13', 'marburg-fb13-atomic-molecular-optical', 'Atomic, Molecular and Optical Physics'),
    ('marburg-fb13', 'marburg-fb13-particle-nuclear', 'Particle and Nuclear Physics'),
    ('marburg-fb13', 'marburg-fb13-materials-interdisciplinary', 'Materials and Interdisciplinary Physics'),
    ('marburg-fb15', 'marburg-fb15-general-chemistry', 'General, Inorganic and Organic Chemistry'),
    ('marburg-fb15', 'marburg-fb15-physical-analytical', 'Physical and Analytical Chemistry'),
    ('marburg-fb15', 'marburg-fb15-biochemistry-related', 'Biochemistry-related Chemistry'),
    ('marburg-fb15', 'marburg-fb15-materials-molecular', 'Materials and Molecular Science'),
    ('marburg-fb16', 'marburg-fb16-pharmaceutical-chemistry', 'Pharmaceutical Chemistry'),
    ('marburg-fb16', 'marburg-fb16-pharmaceutical-biology', 'Pharmaceutical Biology'),
    ('marburg-fb16', 'marburg-fb16-pharmaceutics', 'Pharmaceutics'),
    ('marburg-fb16', 'marburg-fb16-pharmacology', 'Pharmacology'),
    ('marburg-fb16', 'marburg-fb16-clinical-pharmacy', 'Clinical Pharmacy'),
    ('marburg-fb16', 'marburg-fb16-drug-development-safety', 'Drug Development and Medicines Safety'),
    ('marburg-fb17', 'marburg-fb17-molecular-cellular', 'Molecular and Cellular Biology'),
    ('marburg-fb17', 'marburg-fb17-genetics', 'Genetics'),
    ('marburg-fb17', 'marburg-fb17-microbiology', 'Microbiology'),
    ('marburg-fb17', 'marburg-fb17-ecology-biodiversity', 'Ecology and Biodiversity'),
    ('marburg-fb17', 'marburg-fb17-neurobiology', 'Neurobiology'),
    ('marburg-fb17', 'marburg-fb17-plant-animal-sciences', 'Plant and Animal Sciences'),
    ('marburg-fb17', 'marburg-fb17-biomedical-biology', 'Biomedical Biology'),
    ('marburg-fb19', 'marburg-fb19-human-geography', 'Human Geography'),
    ('marburg-fb19', 'marburg-fb19-physical-geography', 'Physical Geography'),
    ('marburg-fb19', 'marburg-fb19-environmental-geography', 'Environmental Geography'),
    ('marburg-fb19', 'marburg-fb19-gis-geoinformatics', 'GIS and Geoinformatics'),
    ('marburg-fb19', 'marburg-fb19-climate-landscape-sustainability', 'Climate, Landscape and Sustainability Research'),
    ('marburg-fb19', 'marburg-fb19-spatial-planning', 'Spatial Planning'),
    ('marburg-fb20', 'marburg-fb20-human-medicine', 'Human Medicine'),
    ('marburg-fb20', 'marburg-fb20-clinical-medicine', 'Clinical Medicine'),
    ('marburg-fb20', 'marburg-fb20-biomedical-research', 'Biomedical Research'),
    ('marburg-fb20', 'marburg-fb20-public-health', 'Public Health-related Research'),
    ('marburg-fb20', 'marburg-fb20-neuroscience', 'Neuroscience'),
    ('marburg-fb20', 'marburg-fb20-diagnostics-therapeutics', 'Diagnostics and Therapeutic Disciplines'),
    ('marburg-fb21', 'marburg-fb21-education', 'Education'),
    ('marburg-fb21', 'marburg-fb21-pedagogy', 'Pedagogy'),
    ('marburg-fb21', 'marburg-fb21-adult-continuing', 'Adult and Continuing Education'),
    ('marburg-fb21', 'marburg-fb21-educational-research', 'Educational Research'),
    ('marburg-fb21', 'marburg-fb21-social-pedagogy', 'Social Pedagogy'),
    ('marburg-fb21', 'marburg-fb21-counselling', 'Counselling'),
    ('marburg-fb21', 'marburg-fb21-inclusion-lifelong-learning', 'Inclusion and Lifelong Learning')
)
INSERT INTO public.degree_programs
  (faculty_id, name, degree_level, total_semesters, source, external_ref, last_scraped_at)
SELECT f.id, field_seed.name,
       CASE WHEN field_seed.external_ref = 'marburg-bsc-informatik' THEN 'bachelor' ELSE NULL END,
       CASE WHEN field_seed.external_ref = 'marburg-bsc-informatik' THEN 6 ELSE NULL END,
       'scraper:marburg', field_seed.external_ref, now()
FROM field_seed
JOIN public.faculties f
  ON f.source = 'scraper:marburg' AND f.external_ref = field_seed.faculty_ref
ON CONFLICT (source, external_ref) DO UPDATE
  SET faculty_id = EXCLUDED.faculty_id,
      name = EXCLUDED.name,
      degree_level = EXCLUDED.degree_level,
      total_semesters = EXCLUDED.total_semesters,
      last_scraped_at = now(),
      updated_at = now();
