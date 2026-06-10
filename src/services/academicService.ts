/**
 * Academic fingerprint service.
 *
 * Catalog reads + the student's academic-profile writes go through SECURITY
 * DEFINER RPCs (migration 20260615000000), mirroring src/features/social/api.ts.
 * The admin scraper controls go through the FastAPI backend via apiClient.
 */
import { supabase } from '@/integrations/supabase/client';
import { apiClient } from '@/lib/apiClient';
import type {
  AcademicProfileInput,
  CatalogCourseConfirmation,
  CatalogSourceFreshness,
  DegreeProgram,
  Faculty,
  MyCatalogCourse,
  RecommendedCourse,
  SuggestedCourse,
  University,
} from '@/types/academic';

// The academic RPCs are added via migration and not in the generated types.
const rpc = (name: string, args?: Record<string, unknown>) =>
  (supabase.rpc as any)(name, args);

interface Envelope<T> {
  success: boolean;
  data: T;
}

/* ------------------------------- catalog reads ---------------------------- */

export async function getUniversities(): Promise<University[]> {
  const { data, error } = await rpc('get_universities');
  if (error) throw error;
  return ((data as any[]) ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city ?? null,
    country: r.country ?? null,
    emailDomains: (r.email_domains ?? []) as string[],
    hasCatalog: !!r.has_catalog,
  }));
}

export async function getFaculties(universityId: string): Promise<Faculty[]> {
  const { data, error } = await rpc('get_faculties', { p_university_id: universityId });
  if (error) throw error;
  return ((data as any[]) ?? []).map((r) => ({ id: r.id, name: r.name }));
}

export async function getDegreePrograms(facultyId: string): Promise<DegreeProgram[]> {
  const { data, error } = await rpc('get_degree_programs', { p_faculty_id: facultyId });
  if (error) throw error;
  return ((data as any[]) ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    degreeLevel: r.degree_level ?? null,
    totalSemesters: r.total_semesters ?? null,
  }));
}

export async function getSuggestedCourses(
  programId: string,
  currentSemester: number,
): Promise<SuggestedCourse[]> {
  const { data, error } = await rpc('get_suggested_courses', {
    p_program_id: programId,
    p_current_semester: currentSemester,
  });
  if (error) throw error;
  return ((data as any[]) ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    courseCode: r.course_code ?? null,
    typicalSemester: r.typical_semester ?? null,
    credits: r.credits ?? null,
    language: r.language ?? null,
    isMandatory: !!r.is_mandatory,
    suggestedStatus: r.suggested_status,
    preChecked: !!r.pre_checked,
  }));
}

export async function getMyCatalogCourses(): Promise<MyCatalogCourse[]> {
  const { data, error } = await rpc('get_my_catalog_courses');
  if (error) throw error;
  return ((data as any[]) ?? []).map((r) => ({
    catalogCourseId: r.catalog_course_id,
    title: r.title,
    courseCode: r.course_code ?? null,
    typicalSemester: r.typical_semester ?? null,
    status: r.status,
  }));
}

/** Platform courses recommended from the caller's academic fingerprint. */
export async function getRecommendedCourses(limit = 8): Promise<RecommendedCourse[]> {
  const { data, error } = await rpc('get_recommended_courses', { p_limit: limit });
  if (error) throw error;
  return ((data as any[]) ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    color: r.color ?? null,
    icon: r.icon ?? null,
    lectureCount: r.lecture_count ?? 0,
    reason: r.reason ?? 'Recommended for you',
    matchedCourse: r.matched_course ?? null,
    score: r.score ?? 0,
  }));
}

/* ------------------------------- writes ----------------------------------- */

export async function setAcademicProfile(input: AcademicProfileInput): Promise<void> {
  const { error } = await rpc('set_academic_profile', {
    p_university_id: input.universityId,
    p_faculty_id: input.facultyId,
    p_program_id: input.programId,
    p_current_semester: input.currentSemester,
  });
  if (error) throw error;
}

export async function confirmCatalogCourses(items: CatalogCourseConfirmation[]): Promise<number> {
  const { data, error } = await rpc('confirm_catalog_courses', {
    p_items: items.map((i) => ({ catalog_course_id: i.catalogCourseId, status: i.status })),
  });
  if (error) throw error;
  return (data as number) ?? 0;
}

/** Verify the caller's institution by confirmed *account* email domain. */
export async function verifyMyInstitution(): Promise<boolean> {
  const { data, error } = await rpc('verify_my_institution');
  if (error) throw error;
  return !!data;
}

export type LinkEmailReason = 'verified' | 'invalid' | 'taken' | 'unknown_domain' | 'mismatch';
export interface LinkEmailResult {
  verified: boolean;
  university: string | null;
  reason: LinkEmailReason;
}

/** Link a separate institutional email; verifies by domain match. */
export async function linkUniversityEmail(email: string): Promise<LinkEmailResult> {
  const { data, error } = await rpc('link_university_email', { p_email: email });
  if (error) throw error;
  const row = (data as any[])?.[0];
  return {
    verified: !!row?.verified,
    university: row?.university ?? null,
    reason: (row?.reason ?? 'invalid') as LinkEmailReason,
  };
}

export interface MyVerification {
  universityEmail: string | null;
  institutionVerified: boolean;
  institution: string | null;
  universityId: string | null;
}

export async function getMyVerification(): Promise<MyVerification> {
  const { data, error } = await rpc('get_my_verification');
  if (error) throw error;
  const row = (data as any[])?.[0];
  return {
    universityEmail: row?.university_email ?? null,
    institutionVerified: !!row?.institution_verified,
    institution: row?.institution ?? null,
    universityId: row?.university_id ?? null,
  };
}

/* ------------------------------- admin (scraper) -------------------------- */

export async function triggerScrape(source = 'marburg'): Promise<unknown> {
  const res = await apiClient.post<Envelope<unknown>>('/api/admin/academic/scrape', { source });
  return res.data;
}

export async function getCatalogSources(): Promise<CatalogSourceFreshness[]> {
  const res = await apiClient.get<Envelope<any[]>>('/api/admin/academic/sources');
  return (res.data ?? []).map((r) => ({
    source: r.source,
    university: r.university,
    lastScrapedAt: r.last_scraped_at ?? null,
    faculties: r.faculties ?? 0,
    courses: r.courses ?? 0,
  }));
}
