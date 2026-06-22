from typing import Optional, Any

class DomainError(Exception):
    """Base exception for client-facing/domain logic errors (translates to 400 Bad Request)"""
    def __init__(self, message: str, code: str = "BAD_REQUEST", details: Optional[Any] = None):
        super().__init__(message)
        self.message = message
        self.code = code
        self.details = details
        self.status_code = 400

class NotFoundError(DomainError):
    """Exception for resources not found (translates to 404 Not Found)"""
    def __init__(self, message: str, code: str = "NOT_FOUND", details: Optional[Any] = None):
        super().__init__(message, code, details)
        self.status_code = 404

class ForbiddenError(DomainError):
    """Exception for access control/authorization failures (translates to 403 Forbidden)"""
    def __init__(self, message: str, code: str = "FORBIDDEN", details: Optional[Any] = None):
        super().__init__(message, code, details)
        self.status_code = 403

class UnauthorizedError(DomainError):
    """Exception for missing or invalid authentication credentials (translates to 401 Unauthorized)"""
    def __init__(self, message: str, code: str = "UNAUTHORIZED", details: Optional[Any] = None):
        super().__init__(message, code, details)
        self.status_code = 401
