import uuid
import logging
from typing import Optional, Set
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select
from sqlalchemy import text

from backend.models.rbac import CourseAccess, Role, Permission, RolePermission
from backend.models.core import Course

logger = logging.getLogger(__name__)

async def get_user_global_permissions(session: AsyncSession, user_id: uuid.UUID) -> Set[str]:
    """
    Fetch global permissions for a user from their global roles (e.g., Supabase user_roles).
    For now, if they are an admin in user_roles, they have all permissions.
    """
    permissions = set()
    
    # 1. Check legacy user_roles for admin
    try:
        stmt = text("SELECT role FROM user_roles WHERE user_id = :uid")
        res = await session.execute(stmt, {"uid": str(user_id)})
        roles = {row[0] for row in res.all()}
        
        if "admin" in roles:
            permissions.add("*")
            return permissions
    except Exception as e:
        logger.warning(f"Failed to check global user_roles for {user_id}: {e}")
        
    # TODO: In the future, we could have a global UserRole table mapping to our new Role/Permission models
    return permissions

async def get_user_course_permissions(session: AsyncSession, user_id: uuid.UUID, course_id: uuid.UUID) -> Set[str]:
    """
    Fetch resource-level permissions for a user on a specific course.
    """
    permissions = set()
    
    # 1. Is the user the professor of the course?
    course = await session.get(Course, course_id)
    if course and course.professor_id == user_id:
        # Professor gets all access to their own course
        permissions.add("*")
        return permissions
        
    # 2. Check CourseAccess for granular roles
    stmt = select(CourseAccess).where(CourseAccess.user_id == user_id, CourseAccess.course_id == course_id)
    res = await session.exec(stmt)
    access = res.first()
    
    if access:
        # Resolve the role name to permissions
        role_stmt = select(Permission.name).join(
            RolePermission, RolePermission.permission_id == Permission.id
        ).join(
            Role, Role.id == RolePermission.role_id
        ).where(Role.name == access.access_level)
        
        perm_res = await session.exec(role_stmt)
        for perm in perm_res.all():
            permissions.add(perm)
            
    return permissions

async def has_permission(
    session: AsyncSession, 
    user_id: str | uuid.UUID, 
    required_permission: str, 
    course_id: Optional[str | uuid.UUID] = None
) -> bool:
    """
    Core RBAC resolution engine.
    Checks if `user_id` has `required_permission`, optionally scoped to `course_id`.
    """
    if isinstance(user_id, str):
        user_id = uuid.UUID(user_id)
        
    # 1. Check global permissions first (e.g. admins)
    global_perms = await get_user_global_permissions(session, user_id)
    if "*" in global_perms or required_permission in global_perms:
        return True
        
    # 2. If resource-scoped, check course-level permissions
    if course_id:
        if isinstance(course_id, str):
            course_id = uuid.UUID(course_id)
        course_perms = await get_user_course_permissions(session, user_id, course_id)
        if "*" in course_perms or required_permission in course_perms:
            return True
            
    return False
