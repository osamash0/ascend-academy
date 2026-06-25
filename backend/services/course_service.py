import logging
from typing import Any, List, Optional, Tuple
import uuid
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select, func, text

from backend.models.core import Course, Lecture

logger = logging.getLogger(__name__)

async def fetch_course(session: AsyncSession, course_id: str) -> Optional[Course]:
    result = await session.exec(select(Course).where(Course.id == course_id))
    return result.first()

async def list_courses(
    session: AsyncSession,
    uid: str,
    is_prof: bool,
    only_archived: bool = False,
    include_archived: bool = False,
    limit: int = 20,
    cursor: Optional[str] = None
) -> Tuple[List[dict], Optional[str], bool]:
    
    q = select(Course)
    if is_prof:
        q = q.where(Course.professor_id == uid)
    
    if only_archived:
        q = q.where(Course.is_archived == True)
    elif not include_archived:
        q = q.where(Course.is_archived == False)

    if cursor:
        q = q.where(Course.created_at < cursor)
        
    q = q.order_by(Course.created_at.desc()).limit(limit + 1)
    
    result = await session.exec(q)
    rows = result.all()
    
    has_more = len(rows) > limit
    if has_more:
        rows = rows[:-1]

    if not is_prof:
        # fetch visible courses
        stmt = text("""
            SELECT l.course_id 
            FROM assignment_enrollments ae
            JOIN assignment_lectures al ON ae.assignment_id = al.assignment_id
            JOIN lectures l ON al.lecture_id = l.id
            WHERE ae.user_id = :uid AND l.course_id IS NOT NULL
        """)
        res = await session.execute(stmt, {"uid": uid})
        visible = {str(r[0]) for r in res.all()}
        rows = [r for r in rows if str(r.id) in visible]

    # count lectures
    counts = {str(r.id): 0 for r in rows}
    if rows:
        cids = [str(r.id) for r in rows]
        lq = select(Lecture.course_id, func.count(Lecture.id)).where(Lecture.course_id.in_(cids))
        if not only_archived:
            lq = lq.where(Lecture.is_archived == False)
        lq = lq.group_by(Lecture.course_id)
        l_res = await session.execute(lq)
        for cid, cnt in l_res.all():
            counts[str(cid)] = cnt

    data = []
    for r in rows:
        d = r.dict()
        d["id"] = str(d["id"])
        d["professor_id"] = str(d["professor_id"])
        d["lecture_count"] = counts.get(d["id"], 0)
        data.append(d)

    next_cursor = str(rows[-1].created_at) if rows else None
    return data, next_cursor, has_more

async def browse_courses(
    session: AsyncSession,
    limit: int = 20,
    cursor: Optional[str] = None
) -> Tuple[List[dict], Optional[str], bool]:

    q = select(Course).where(Course.is_archived == False)
    if cursor:
        q = q.where(Course.created_at < cursor)
        
    q = q.order_by(Course.created_at.desc()).limit(limit + 1)
    result = await session.exec(q)
    rows = result.all()
    
    has_more = len(rows) > limit
    if has_more:
        rows = rows[:-1]

    counts = {str(r.id): 0 for r in rows}
    if rows:
        cids = [str(r.id) for r in rows]
        lq = select(Lecture.course_id, func.count(Lecture.id)).where(
            Lecture.course_id.in_(cids),
            Lecture.is_archived == False
        ).group_by(Lecture.course_id)
        
        l_res = await session.execute(lq)
        for cid, cnt in l_res.all():
            counts[str(cid)] = cnt

    data = []
    for r in rows:
        d = r.dict()
        d["id"] = str(d["id"])
        d["professor_id"] = None
        d["lecture_count"] = counts.get(d["id"], 0)
        data.append(d)

    next_cursor = str(rows[-1].created_at) if rows else None
    return data, next_cursor, has_more

async def get_course_details(
    session: AsyncSession,
    course_id: str,
    uid: str
) -> Tuple[str, Optional[dict]]:
    
    course = await fetch_course(session, course_id)
    if not course:
        return "missing", None
        
    is_owner = str(course.professor_id) == uid
    if not is_owner:
        stmt = text("""
            SELECT l.course_id 
            FROM assignment_enrollments ae
            JOIN assignment_lectures al ON ae.assignment_id = al.assignment_id
            JOIN lectures l ON al.lecture_id = l.id
            WHERE ae.user_id = :uid AND l.course_id = :cid
        """)
        res = await session.execute(stmt, {"uid": uid, "cid": course_id})
        visible = res.first()
        if not visible:
            return "forbidden", None

    lq = select(Lecture).where(Lecture.course_id == course_id)
    if not course.is_archived:
        lq = lq.where(Lecture.is_archived == False)
    lq = lq.order_by(Lecture.created_at.desc())
    l_res = await session.exec(lq)
    all_lectures = l_res.all()

    if is_owner:
        lectures = all_lectures
    else:
        # student
        stmt = text("""
            SELECT lecture_id 
            FROM assignment_enrollments ae
            JOIN assignment_lectures al ON ae.assignment_id = al.assignment_id
            WHERE ae.user_id = :uid
        """)
        res = await session.execute(stmt, {"uid": uid})
        allowed = {str(r[0]) for r in res.all()}
        lectures = [l for l in all_lectures if str(l.id) in allowed]

    lec_data = []
    for l in lectures:
        ld = l.dict()
        ld["id"] = str(ld["id"])
        ld["professor_id"] = str(ld["professor_id"])
        ld["course_id"] = str(ld["course_id"]) if ld["course_id"] else None
        lec_data.append(ld)

    c_data = course.dict()
    c_data["id"] = str(c_data["id"])
    c_data["professor_id"] = str(c_data["professor_id"])
    c_data["lecture_count"] = len(all_lectures) if is_owner else len(lectures)
    c_data["lectures"] = lec_data

    return "ok", c_data

async def create_course(
    session: AsyncSession,
    uid: str,
    title: str,
    description: Optional[str],
    color: Optional[str],
    icon: Optional[str]
) -> dict:
    course = Course(
        professor_id=uid,
        title=title,
        description=description,
        color=color,
        icon=icon
    )
    session.add(course)
    await session.commit()
    await session.refresh(course)
    
    d = course.dict()
    d["id"] = str(d["id"])
    d["professor_id"] = str(d["professor_id"])
    d["lecture_count"] = 0
    return d

async def update_course(
    session: AsyncSession,
    course_id: str,
    uid: str,
    patch: dict
) -> Tuple[bool, Optional[dict]]:
    course = await fetch_course(session, course_id)
    if not course:
        return False, None
    if str(course.professor_id) != uid:
        raise ValueError("Forbidden")
        
    for k, v in patch.items():
        setattr(course, k, v)
        
    session.add(course)
    await session.commit()
    await session.refresh(course)
    
    lq = select(func.count(Lecture.id)).where(Lecture.course_id == course_id)
    if not course.is_archived:
        lq = lq.where(Lecture.is_archived == False)
    cnt = await session.scalar(lq)
    
    d = course.dict()
    d["id"] = str(d["id"])
    d["professor_id"] = str(d["professor_id"])
    d["lecture_count"] = cnt
    return True, d

async def delete_course(
    session: AsyncSession,
    course_id: str,
    uid: str,
    reassign_to: Optional[str]
) -> bool:
    course = await fetch_course(session, course_id)
    if not course:
        return False
    if str(course.professor_id) != uid:
        raise ValueError("Forbidden")
        
    lq = select(Lecture.id).where(Lecture.course_id == course_id)
    res = await session.exec(lq)
    lecs = res.all()
    
    if lecs:
        if reassign_to:
            target = await fetch_course(session, reassign_to)
            if not target or str(target.professor_id) != uid:
                raise ValueError("Target")
            await session.execute(
                text("UPDATE lectures SET course_id = :tid WHERE course_id = :cid"),
                {"tid": reassign_to, "cid": course_id}
            )
        else:
            raise ValueError("LecturesExist")
            
    await session.delete(course)
    await session.commit()
    return True

async def enroll_course(session: AsyncSession, uid: str, course_id: str):
    course = await fetch_course(session, course_id)
    if not course:
        raise ValueError("NotFound")
    stmt = text("INSERT INTO course_enrollments (user_id, course_id) VALUES (:uid, :cid) ON CONFLICT DO NOTHING")
    await session.execute(stmt, {"uid": uid, "cid": course_id})
    await session.commit()

async def unenroll_course(session: AsyncSession, uid: str, course_id: str):
    stmt = text("DELETE FROM course_enrollments WHERE user_id = :uid AND course_id = :cid")
    await session.execute(stmt, {"uid": uid, "cid": course_id})
    await session.commit()

async def toggle_course_visibility(
    session: AsyncSession,
    course_id: str
) -> Tuple[bool, Optional[bool]]:
    course = await fetch_course(session, course_id)
    if not course:
        return False, None
    course.is_archived = not course.is_archived
    session.add(course)
    await session.commit()
    await session.refresh(course)
    return True, course.is_archived

async def assign_lecture(session: AsyncSession, uid: str, course_id: str, lecture_id: str):
    if not course or str(course.professor_id) != uid:
        raise ValueError("CourseNotFound")
        
    res = await session.exec(select(Lecture).where(Lecture.id == lecture_id))
    lecture = res.first()
    if not lecture:
        raise ValueError("LectureNotFound")
    if str(lecture.professor_id) != uid:
        raise ValueError("Forbidden")
        
    lecture.course_id = course_id
    session.add(lecture)
    await session.commit()

async def unassign_lecture(session: AsyncSession, uid: str, course_id: str, lecture_id: str):
    course = await fetch_course(session, course_id)
    if not course or str(course.professor_id) != uid:
        raise ValueError("CourseNotFound")
        
    res = await session.exec(select(Lecture).where(Lecture.id == lecture_id))
    lecture = res.first()
    if not lecture or str(lecture.professor_id) != uid:
        raise ValueError("LectureNotFound")
        
    if str(lecture.course_id) != course_id:
        raise ValueError("NotAssigned")
        
    lecture.course_id = None
    session.add(lecture)
    await session.commit()
