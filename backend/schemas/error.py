from typing import Optional, Any
from pydantic import BaseModel, Field

class ErrorDetails(BaseModel):
    code: str = Field(..., description="A unique string identifier for the error category")
    message: str = Field(..., description="A user-friendly, descriptive message explaining the error")
    details: Optional[Any] = Field(None, description="Optional payload containing granular error metadata")

class ErrorResponse(BaseModel):
    data: None = Field(default=None, description="Must be null when an error occurs")
    error: ErrorDetails = Field(..., description="Error details payload")
