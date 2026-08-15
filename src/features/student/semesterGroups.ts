/**
 * Grouping for the library's course rail.
 *
 * Semester is not a column on `courses` — it is parsed out of the title or
 * description, the same rule the skill tree uses. Courses that state no
 * semester (which includes every course a student builds from their own
 * uploads) group under 'none'.
 */

export interface GroupableCourse {
  title: string;
  description: string | null;
}

export interface CourseGroup<T> {
  key: string;
  label: string;
  courses: T[];
}

/** The semester stated in a course's title/description, or null. */
export function semesterOf(course: GroupableCourse): number | null {
  const text = `${course.description || ''} ${course.title}`;
  const m = text.match(/(\d+)\.\s*Semester/i) || text.match(/Semester\s*(\d+)/i);
  return m ? parseInt(m[1], 10) : null;
}

/**
 * Group courses for the rail: the lead group first, then remaining semesters
 * ascending, then the un-numbered group.
 *
 * The lead group is the group of `courses[0]` — the caller has already sorted
 * by relevance (has-lectures, then last-opened, then progress), so the most
 * relevant course decides which group the collapsed rail shows.
 *
 * 'none' must be allowed to lead. A course a student built from their own
 * uploads states no semester, so it lands in the un-numbered group; it is also
 * usually the only course they have lectures in, so it sorts first. Picking the
 * lead by "first course that states a semester" hid exactly that course behind
 * "Show all".
 */
export function groupCoursesBySemester<T extends GroupableCourse>(
  courses: T[],
  label: (key: number | 'none') => string,
): CourseGroup<T>[] {
  const byKey = new Map<number | 'none', T[]>();
  courses.forEach((course) => {
    const key: number | 'none' = semesterOf(course) ?? 'none';
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key)!.push(course);
  });

  const first = courses[0];
  const leadKey: number | 'none' | null = first ? semesterOf(first) ?? 'none' : null;

  const groupFor = (key: number | 'none'): CourseGroup<T> => ({
    key: String(key),
    label: label(key),
    courses: byKey.get(key)!,
  });

  const rest = [...byKey.keys()].filter((k) => k !== leadKey);
  const groups = leadKey != null && byKey.has(leadKey) ? [groupFor(leadKey)] : [];
  groups.push(...rest.filter((k): k is number => k !== 'none').sort((a, b) => a - b).map(groupFor));
  if (rest.includes('none')) groups.push(groupFor('none'));
  return groups;
}
