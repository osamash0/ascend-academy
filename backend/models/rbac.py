from typing import Optional, List, Dict, Any
from sqlmodel import SQLModel, Field, Relationship
import uuid
from datetime import datetime

class Role(SQLModel, table=True):
    __tablename__ = "roles"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(unique=True, index=True)
    description: Optional[str] = None
    created_at: Optional[datetime] = Field(default_factory=datetime.utcnow)

class Permission(SQLModel, table=True):
    __tablename__ = "permissions"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    name: str = Field(unique=True, index=True)
    description: Optional[str] = None
    created_at: Optional[datetime] = Field(default_factory=datetime.utcnow)

class RolePermission(SQLModel, table=True):
    __tablename__ = "role_permissions"

    role_id: uuid.UUID = Field(foreign_key="roles.id", primary_key=True)
    permission_id: uuid.UUID = Field(foreign_key="permissions.id", primary_key=True)

class CourseAccess(SQLModel, table=True):
    __tablename__ = "course_access"

    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID = Field(foreign_key="profiles.id", index=True)
    course_id: uuid.UUID = Field(foreign_key="courses.id", index=True)
    
    # "student", "ta", "co_professor", etc. - can map to granular roles
    access_level: str = Field(default="student")
    
    created_at: Optional[datetime] = Field(default_factory=datetime.utcnow)
