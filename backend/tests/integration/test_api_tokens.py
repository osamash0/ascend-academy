import pytest
import uuid
import hashlib
from fastapi import Request
from types import SimpleNamespace
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException

from backend.core import auth_middleware
from backend.models.rbac import ApiToken
from backend.models.core import User, Course


@pytest.mark.asyncio
async def test_verify_api_token_success():
    class FakeSession:
        async def exec(self, stmt):
            class Res:
                def first(self):
                    token = ApiToken(
                        id=uuid.uuid4(),
                        user_id=uuid.uuid4(),
                        token_hash="fake_hash",
                        name="test_token"
                    )
                    return token
            return Res()

    # Call verify_token
    creds = SimpleNamespace(credentials="aa_valid_token")
    user = await auth_middleware.verify_token(credentials=creds, session=FakeSession())
    
    assert user.is_api_token is True
    assert user.id is not None
    assert user.course_id_scope is None

@pytest.mark.asyncio
async def test_verify_api_token_invalid():
    class FakeSessionEmpty:
        async def exec(self, stmt):
            class Res:
                def first(self):
                    return None
            return Res()

    creds = SimpleNamespace(credentials="aa_invalid_token")
    with pytest.raises(HTTPException) as exc:
        await auth_middleware.verify_token(credentials=creds, session=FakeSessionEmpty())
    assert exc.value.status_code == 401
    
@pytest.mark.asyncio
async def test_api_token_scoping():
    class FakeSessionScope:
        async def exec(self, stmt):
            class Res:
                def first(self):
                    token = ApiToken(
                        id=uuid.uuid4(),
                        user_id=uuid.uuid4(),
                        token_hash="fake_hash",
                        name="test_token",
                        course_id_scope=uuid.UUID("12345678-1234-5678-1234-567812345678")
                    )
                    return token
            return Res()

    creds = SimpleNamespace(credentials="aa_scoped_token")
    user = await auth_middleware.verify_token(credentials=creds, session=FakeSessionScope())
    
    assert user.is_api_token is True
    assert user.course_id_scope == "12345678-1234-5678-1234-567812345678"
    
    # Test require_permission with mismatched scope
    class FakeRequest:
        path_params = {"course_id": "00000000-0000-0000-0000-000000000000"}
        
    checker = auth_middleware.require_permission("read:course", check_course=True)
    
    # mock verify_token to return our user
    # actually we can't easily mock Depends(verify_token) when calling checker manually,
    # wait, checker is an inner function that takes request, user, session.
    # In FastAPI, Depends are resolved by the framework. If we call _checker directly, we must provide them.
    # Let's import the inner function trick or just call it:
    
    # We can't directly test `require_permission`'s inner function easily without overriding Depends,
    # but we can try to call it.
    
    # The returned function takes (request: Request, user: Any, session)
    try:
        await checker(request=FakeRequest(), user=user, session=FakeSessionScope())
        assert False, "Should have raised 403"
    except HTTPException as e:
        assert e.status_code == 403
        assert "API token scope does not permit" in e.detail
