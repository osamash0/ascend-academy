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

    # ─── Parser v3 infra ───────────────────────────────────────────────────────
    redis_url: str = Field(alias="REDIS_URL", default="redis://localhost:6379")
    litellm_base_url: str = Field(alias="LITELLM_BASE_URL", default="http://localhost:4000")
    # Auth key the backend sends to the LiteLLM gateway. When set, the gateway
    # rejects any request that doesn't present it (defense in depth on top of
    # the loopback-only port binding). Leave empty for an unauthenticated local
    # gateway. Must match the gateway's general_settings.master_key.
    litellm_master_key: str = Field(alias="LITELLM_MASTER_KEY", default="")
    parser_version: str = Field(alias="PARSER_VERSION", default="2")

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
