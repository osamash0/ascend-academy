from typing import Generic, List, Optional, TypeVar
from pydantic import BaseModel, Field
from fastapi import Query

T = TypeVar('T')

class PaginationParams(BaseModel):
    cursor: Optional[str] = Field(default=None, description="Cursor for pagination (e.g., ID or timestamp of the last seen item).")
    limit: int = Field(default=20, ge=1, le=100, description="Maximum number of items to return.")

class PaginatedResponse(BaseModel, Generic[T]):
    success: bool = Field(default=True)
    data: List[T]
    cursor: Optional[str] = Field(default=None, description="Cursor for the next page of results. Null if no more results.")
    has_more: bool = Field(default=False, description="Whether there are more items to fetch.")
