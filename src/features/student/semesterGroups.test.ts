import { describe, it, expect } from 'vitest';
import { groupCoursesBySemester, semesterOf } from './semesterGroups';

const label = (key: number | 'none') => (key === 'none' ? 'Other' : `${key}. Semester`);
const course = (title: string, description: string | null = null) => ({ title, description });

describe('semesterOf', () => {
  it('reads the semester from either the title or the description', () => {
    expect(semesterOf(course('Databases 4. Semester'))).toBe(4);
    expect(semesterOf(course('Databases', '9 LP - 2. Semester'))).toBe(2);
    expect(semesterOf(course('Databases', 'Semester 6'))).toBe(6);
  });

  it('returns null when no semester is stated', () => {
    expect(semesterOf(course('Database Systems (DBS)'))).toBeNull();
    expect(semesterOf(course('My own course', 'Built from my lecture slides.'))).toBeNull();
  });
});

describe('groupCoursesBySemester', () => {
  it('leads with the group of the most relevant course, then ascending semesters', () => {
    const groups = groupCoursesBySemester(
      [course('Networks 4. Semester'), course('Algorithms 1. Semester'), course('Compilers 6. Semester')],
      label,
    );
    expect(groups.map((g) => g.label)).toEqual(['4. Semester', '1. Semester', '6. Semester']);
  });

  it('lets the un-numbered group lead when the most relevant course states no semester', () => {
    // The regression this guards: a student's own course states no semester, is
    // the only one they have lectures in (so it sorts first), and used to be
    // pushed into a trailing "Other" group that the collapsed rail hides.
    const groups = groupCoursesBySemester(
      [course('Database Systems (DBS)'), course('Networks 4. Semester'), course('Algorithms 1. Semester')],
      label,
    );
    expect(groups[0].label).toBe('Other');
    expect(groups[0].courses.map((c) => c.title)).toEqual(['Database Systems (DBS)']);
    expect(groups.map((g) => g.label)).toEqual(['Other', '1. Semester', '4. Semester']);
  });

  it('keeps the un-numbered group last when a numbered course leads', () => {
    const groups = groupCoursesBySemester(
      [course('Networks 4. Semester'), course('Database Systems (DBS)'), course('Algorithms 1. Semester')],
      label,
    );
    expect(groups.map((g) => g.label)).toEqual(['4. Semester', '1. Semester', 'Other']);
  });

  it('preserves the caller ordering inside each group and never duplicates a course', () => {
    const groups = groupCoursesBySemester(
      [course('B 4. Semester'), course('A 4. Semester'), course('C 1. Semester')],
      label,
    );
    expect(groups[0].courses.map((c) => c.title)).toEqual(['B 4. Semester', 'A 4. Semester']);
    expect(groups.flatMap((g) => g.courses)).toHaveLength(3);
  });

  it('returns no groups for an empty rail', () => {
    expect(groupCoursesBySemester([], label)).toEqual([]);
  });
});
