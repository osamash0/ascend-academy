from typing import Optional, List, Dict, Any
from sqlmodel import SQLModel, Field, Column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from datetime import datetime
import uuid

class User(SQLModel, table=True):
    __tablename__ = "profiles"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: Optional[uuid.UUID] = None
    email: str = Field(unique=True, index=True)
    display_name: Optional[str] = None
    full_name: Optional[str] = None
    avatar_url: Optional[str] = None
    language_preference: str = Field(default="en")
    preferred_language: Optional[str] = None
    created_at: Optional[datetime] = Field(default_factory=datetime.utcnow)
    
    # Academic Catalog & Gamification
    faculty_id: Optional[int] = None
    university_id: Optional[int] = None
    degree_program_id: Optional[int] = None
    institution: Optional[str] = None
    institution_verified: bool = Field(default=False)
    university_email: Optional[str] = None
    current_semester: Optional[int] = None
    social_roles: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSONB))
    
    total_xp: int = Field(default=0)
    current_level: int = Field(default=1)
    current_streak: int = Field(default=0)
    best_streak: int = Field(default=0)
    last_active_date: Optional[datetime] = None

class Course(SQLModel, table=True):
    __tablename__ = "courses"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    professor_id: uuid.UUID = Field(foreign_key="profiles.id", index=True)
    title: str
    description: Optional[str] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    is_archived: bool = Field(default=False)
    average_rating: Optional[float] = None
    rating_count: int = Field(default=0)
    what_you_will_learn: Optional[List[str]] = Field(default=None, sa_column=Column(JSONB))
    created_at: Optional[datetime] = Field(default_factory=datetime.utcnow)
    updated_at: Optional[datetime] = Field(default_factory=datetime.utcnow)

class Lecture(SQLModel, table=True):
    __tablename__ = "lectures"
    
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    course_id: Optional[uuid.UUID] = Field(default=None, foreign_key="courses.id", index=True)
    professor_id: uuid.UUID = Field(foreign_key="profiles.id", index=True)
    title: str
    slug: Optional[str] = None
    description: Optional[str] = None
    pdf_url: Optional[str] = None
    pdf_hash: Optional[str] = None
    pdf_sha256: Optional[str] = None
    total_slides: int = Field(default=0)
    is_archived: bool = Field(default=False)
    
    lecture_type: Optional[str] = None
    subject: Optional[str] = None
    course_code: Optional[str] = None
    key_topics: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSONB))
    
    created_at: Optional[datetime] = Field(default_factory=datetime.utcnow)
