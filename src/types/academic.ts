/** Academic fingerprint types — the structured catalog + the student's linkage. */

export type StudentCatalogStatus = 'completed' | 'in_progress' | 'planned';

export interface University {
  id: string;
  name: string;
  city: string | null;
  country: string | null;
  /** Email domains that map to this university (drives the onboarding default). */
  emailDomains: string[];
  /** Whether this university has a usable catalog (>=1 faculty). */
  hasCatalog: boolean;
}

export interface Faculty {
  id: string;
  name: string;
}

export interface DegreeProgram {
  id: string;
  name: string;
  degreeLevel: string | null;
  totalSemesters: number | null;
}

export interface CatalogCourse {
  id: string;
  title: string;
  courseCode: string | null;
  typicalSemester: number | null;
  credits: number | null;
  language: string | null;
  isMandatory: boolean;
}

/** A catalog course with an onboarding suggestion attached. */
export interface SuggestedCourse extends CatalogCourse {
  suggestedStatus: StudentCatalogStatus;
  preChecked: boolean;
}

export interface MyCatalogCourse {
  catalogCourseId: string;
  title: string;
  courseCode: string | null;
  typicalSemester: number | null;
  status: StudentCatalogStatus;
}

export interface AcademicProfileInput {
  universityId: string | null;
  facultyId: string | null;
  programId: string | null;
  currentSemester: number | null;
}

export interface CatalogCourseConfirmation {
  catalogCourseId: string;
  status: StudentCatalogStatus;
}

export interface CatalogSourceFreshness {
  source: string;
  university: string;
  lastScrapedAt: string | null;
  faculties: number;
  courses: number;
}
