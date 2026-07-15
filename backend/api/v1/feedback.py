"""Per-feature user feedback endpoint.

POST /api/feedback — any signed-in user can submit a free-text comment about
a feature. Stored in `public.user_feedback`. Service-role insert keeps the
endpoint working even if the user-scoped client cannot satisfy RLS.
"""
from __future__ import annotations

import logging
from typing import Any, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.core.auth_middleware import verify_token, _user_id
from backend.core.database import supabase_admin
from backend.core.rate_limit import limiter
from backend.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/feedback", tags=["feedback"])


class FeedbackBody(BaseModel):
    feature: str = Field(..., min_length=1, max_length=120)
    message: str = Field(..., min_length=1, max_length=4000)
    route: Optional[str] = Field(default=None, max_length=500)
    category: Optional[str] = Field(default="Other", max_length=50)


@router.post("")
@limiter.limit("10/minute")
async def submit_feedback(
    request: Request,
    body: FeedbackBody,
    user: Any = Depends(verify_token),
):
    uid = _user_id(user)
    if not uid:
        raise HTTPException(status_code=401, detail="Invalid user context.")

    user_agent = request.headers.get("user-agent", "")[:500] or None

    try:
        # Prepend category to the feature name for DB persistence
        db_feature = f"[{body.category}] {body.feature.strip()}"
        if len(db_feature) > 120:
            db_feature = db_feature[:117] + "..."

        supabase_admin.table("user_feedback").insert({
            "user_id": uid,
            "feature": db_feature,
            "message": body.message.strip(),
            "route": body.route,
            "user_agent": user_agent,
        }).execute()

        # Send email via Resend if configured
        if settings.resend_api_key:
            try:
                import resend
                resend.api_key = settings.resend_api_key
                
                # Category styling
                cat = (body.category or "Other").strip().capitalize()
                badge_bg = "#64748b" # gray for Other
                if cat == "Bug":
                    badge_bg = "#ef4444" # red
                elif cat == "Idea":
                    badge_bg = "#10b981" # green
                elif cat == "Question":
                    badge_bg = "#3b82f6" # blue

                email_content = f"""
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
                  <div style="background: #4f46e5; color: #ffffff; padding: 20px 24px;">
                    <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; background: {badge_bg}; padding: 4px 8px; border-radius: 4px; color: #ffffff;">
                      Category: {cat}
                    </span>
                    <h2 style="margin: 8px 0 0 0; font-size: 20px; font-weight: 700;">New Feedback Received</h2>
                  </div>

                  <div style="padding: 24px; background: #ffffff;">
                    <div style="background: #f8fafc; border-left: 4px solid #4f46e5; padding: 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
                      <p style="margin: 0; font-size: 16px; line-height: 1.6; color: #1e293b; font-style: italic;">
                        "{body.message.strip()}"
                      </p>
                    </div>

                    <h3 style="font-size: 12px; text-transform: uppercase; color: #64748b; letter-spacing: 0.05em; margin: 0 0 12px 0;">Context & Metadata</h3>
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px; line-height: 1.5; color: #334155;">
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-weight: 600; width: 120px;">Feature</td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; color: #0f172a;">{body.feature.strip()}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-weight: 600;">Active Route</td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; color: #0f172a; font-family: monospace;">{body.route or 'N/A'}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-weight: 600;">User Agent</td>
                        <td style="padding: 8px 0; border-bottom: 1px solid #f1f5f9; color: #64748b; font-size: 12px;">{user_agent or 'N/A'}</td>
                      </tr>
                      <tr>
                        <td style="padding: 8px 0; font-weight: 600;">User ID</td>
                        <td style="padding: 8px 0; color: #64748b; font-family: monospace; font-size: 12px;">{uid}</td>
                      </tr>
                    </table>
                  </div>
                </div>
                """
                resend.Emails.send({
                    "from": "Acme <onboarding@resend.dev>",
                    "to": settings.feedback_email_to,
                    "subject": f"New Feedback ({cat}): {body.feature.strip()}",
                    "html": email_content
                })
            except ImportError:
                logger.error("RESEND_API_KEY is set, but the 'resend' package is not installed. Please run `pip install resend`.")
            except Exception as email_err:
                logger.error("Failed to send feedback email via Resend: %s", email_err)
                # We don't raise an HTTPException here because the feedback was successfully saved to the database.

    except Exception as e:
        logger.error("Feedback insert failed: %s", e)
        raise HTTPException(status_code=500, detail="Could not record feedback.")

    return {"ok": True}
