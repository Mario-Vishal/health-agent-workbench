from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import yaml

from app.config import get_settings
from app.services.repository import ROOT


class ModelRouter:
    def __init__(self) -> None:
        settings = get_settings()
        candidates = [
            ROOT / settings.model_router_config,
            ROOT / "model_router.yaml",
            ROOT / "apps" / "api" / "model_router.yaml",
        ]
        path = next((candidate for candidate in candidates if candidate.exists()), candidates[0])
        self.config = yaml.safe_load(path.read_text(encoding="utf-8")) if path.exists() else {"models": {}}
        self.mock_mode = settings.mock_mode

    def select(self, requested: str) -> dict[str, Any]:
        models = self.config.get("models", {})
        choice = models.get(requested) or models.get("default_agent") or {"provider": "mock", "model": "deterministic"}
        if self.mock_mode:
            return {"provider": "mock", "model": f"mock:{choice['model']}", "reason": "No API key configured"}
        if get_settings().llm_provider == "ollama":
            return {"provider": "ollama", "model": get_settings().ollama_model, "reason": "Using local Ollama provider", "configured": True}
        provider_key = f"{choice['provider'].upper()}_API_KEY"
        return {**choice, "reason": f"Using {choice['provider']} provider", "configured": bool(os.getenv(provider_key))}
