from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "HealthAgent Workbench"
    database_url: str = "sqlite:///./healthagent.db"
    redis_url: str = "redis://localhost:6379/0"
    api_cors_origins: str = "http://localhost:3000"
    llm_provider: str = "deterministic"
    openai_api_key: str | None = None
    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "qwen3.5:9b"
    model_router_config: str = "apps/api/model_router.yaml"
    data_dir: str = Field(default="data/synthetic")
    fhir_base_url: str = "http://localhost:8080/fhir"
    use_hapi_fhir: bool = True
    synthea_dir: str = "data/synthea/fhir"
    synthea_patient_count: int = 25

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.api_cors_origins.split(",") if origin.strip()]

    @property
    def llm_provider_available(self) -> bool:
        if self.llm_provider == "openai":
            return bool(self.openai_api_key)
        if self.llm_provider == "ollama":
            return True
        return False

    @property
    def mock_mode(self) -> bool:
        return not self.llm_provider_available


@lru_cache
def get_settings() -> Settings:
    return Settings()
