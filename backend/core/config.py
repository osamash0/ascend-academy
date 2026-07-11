"""
Typed, validated application config via Pydantic Settings.
Fails fast at startup if required environment variables are missing.

Usage:
    from backend.core.config import settings
    settings.groq_api_key
"""
from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, model_validator


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Load backend/.env first; root .env is a fallback loaded by database.py
        env_file=str(Path(__file__).parent.parent / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # ─── Environment ───────────────────────────────────────────────────────────
    env: str = Field(alias="ENV", default="development")

    # ─── Supabase ──────────────────────────────────────────────────────────────
    supabase_url: str = Field(alias="SUPABASE_URL", default="")
    supabase_key: str = Field(alias="SUPABASE_KEY", default="")

    # Fallback: frontend may export VITE_ prefixed vars
    vite_supabase_url: str = Field(alias="VITE_SUPABASE_URL", default="")
    vite_supabase_key: str = Field(alias="VITE_SUPABASE_PUBLISHABLE_KEY", default="")

    # ─── LLM Providers ─────────────────────────────────────────────────────────
    groq_api_key: str = Field(alias="GROQ_API_KEY", default="")
    gemini_api_key: str = Field(alias="GEMINI_API_KEY", default="")
    google_api_key: str = Field(alias="GOOGLE_API_KEY", default="")
    llama_cloud_api_key: str = Field(alias="LLAMA_CLOUD_API_KEY", default="")
    llamaparse_result_type: str = Field(alias="LLAMAPARSE_RESULT_TYPE", default="markdown")
    llamaparse_model: str = Field(alias="LLAMAPARSE_MODEL", default="")

    # ─── Parser v3 infra ───────────────────────────────────────────────────────
    redis_url: str = Field(alias="REDIS_URL", default="redis://localhost:6379")
    litellm_base_url: str = Field(alias="LITELLM_BASE_URL", default="http://localhost:4000")
    # Auth key the backend sends to the LiteLLM gateway. When set, the gateway
    # rejects any request that doesn't present it (defense in depth on top of
    # the loopback-only port binding). Leave empty for an unauthenticated local
    # gateway. Must match the gateway's general_settings.master_key.
    litellm_master_key: str = Field(alias="LITELLM_MASTER_KEY", default="")
    parser_version: str = Field(alias="PARSER_VERSION", default="5")
    # Vision-capable model the unified pipeline (PARSER_VERSION=5) uses for
    # image/scanned/diagram slides so they get real OCR/vision content instead
    # of empty text. Must be a vision-capable provider (groq, gemini-2.0-flash).
    vision_model: str = Field(alias="VISION_MODEL", default="gemini-2.0-flash")
    # Bulk text model the unified pipeline (PARSER_VERSION=5) uses for slide
    # analysis + deck summary/quiz — server-configured, not chosen per upload.
    # Set to "openai" to use OpenAI, or a self-hosted OpenAI-compatible
    # university LLM via OPENAI_BASE_URL + OPENAI_MODEL. Slower models may need
    # a higher LLM_TIMEOUT_SECONDS (default 25; gpt-4o-mini wants ~90).
    parser_llm_model: str = Field(alias="PARSER_LLM_MODEL", default="cerebras")
    # LEGACY: the standalone Fast Upload pipeline was retired in the Phase-0
    # sweep (module archived under backend/_legacy/). This field is unused by the
    # live app and kept only so the archived module remains revertable.
    fast_upload_model: str = Field(alias="FAST_UPLOAD_MODEL", default="gemini/gemini-2.0-flash")

    # ─── Uploads ───────────────────────────────────────────────────────────────
    # Single source of truth for the max upload size (PDF/PPTX). Enforced by the
    # endpoint stream guard AND file validation, and served to the frontend via
    # GET /api/v1/upload/config so the client rejects with the same number.
    max_upload_mb: int = Field(alias="MAX_UPLOAD_MB", default=50)
    # Max files accepted by one multi-file batch upload (Phase 1).
    max_batch_files: int = Field(alias="MAX_BATCH_FILES", default=30)
    # Arq worker concurrency — tunable per deploy target's RAM/CPU budget
    # rather than hardcoded, since a 30-file batch enqueues 30 jobs at once
    # and the worker throttles to this number regardless of origin batch.
    arq_max_jobs: int = Field(alias="ARQ_MAX_JOBS", default=4)

    # ─── Review engine (Roadmap Phase 1.1, "Daily Ascent") ─────────────────────
    # Off by default — gates the /review router mount and the card-factory
    # enqueue call in unified_orchestrator.py. Set FEATURE_REVIEW_ENGINE=1 to enable.
    feature_review_engine: bool = Field(alias="FEATURE_REVIEW_ENGINE", default=False)

    # ─── Exam Mode (Roadmap Phase 1.2) ──────────────────────────────────────────
    # Off by default — gates the /exams router mount. Set FEATURE_EXAM_MODE=1
    # to enable. Depends only on review-engine's DB schema (review_cards/
    # review_schedule), not FEATURE_REVIEW_ENGINE being on.
    feature_exam_mode: bool = Field(alias="FEATURE_EXAM_MODE", default=False)

    # ─── Global search + course tutor (Roadmap Phase 2.2, "Ask anything") ──────
    # Off by default — gates the /search router mount. Depends on the
    # match_slides_scoped/search_*_keyword RPCs (migration
    # 20260710030000_global_search.sql). Set FEATURE_GLOBAL_SEARCH=1 to enable.
    feature_global_search: bool = Field(alias="FEATURE_GLOBAL_SEARCH", default=False)

    # ─── Student self-serve uploads (Roadmap Phase 3.1, "My Materials") ────────
    # Off by default — gates the /materials router mount. Depends on migration
    # 20260710040000_student_uploads.sql (lectures.visibility/student_owner_id,
    # upload_quotas). Set FEATURE_STUDENT_UPLOADS=1 to enable.
    feature_student_uploads: bool = Field(alias="FEATURE_STUDENT_UPLOADS", default=False)
    # Monthly cap on private uploads per student; quota is the monetization seam.
    student_upload_monthly_limit: int = Field(alias="STUDENT_UPLOAD_MONTHLY_LIMIT", default=5)

    # ─── Computed ──────────────────────────────────────────────────────────────
    @model_validator(mode="after")
    def resolve_supabase_credentials(self) -> "Settings":
        if not self.supabase_url:
            self.supabase_url = self.vite_supabase_url
        if not self.supabase_key:
            self.supabase_key = self.vite_supabase_key
        if not self.supabase_url or not self.supabase_key:
            raise ValueError(
                "SUPABASE_URL and SUPABASE_KEY must be set in the .env file"
            )
        return self

    @property
    def effective_gemini_key(self) -> str:
        return self.gemini_api_key or self.google_api_key

    @property
    def litellm_client_key(self) -> str:
        """API key the backend presents to the LiteLLM gateway.

        Falls back to a non-empty placeholder when no master key is configured:
        the AsyncOpenAI client rejects an empty ``api_key``, and a gateway
        started without a ``master_key`` ignores whatever value it receives.
        """
        return self.litellm_master_key or "sk-litellm-noauth"


settings = Settings()
