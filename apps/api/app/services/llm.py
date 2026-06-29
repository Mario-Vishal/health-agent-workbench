from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import httpx

from app.config import get_settings
from app.models.schemas import AgentQuery, EvidenceCard


@dataclass
class LLMResult:
    answer: str | None
    status: str
    error: str | None = None


def _evidence_block(evidence: list[EvidenceCard]) -> str:
    lines = []
    for index, card in enumerate(evidence, start=1):
        lines.append(
            f"[{index}] {card.resource_type}/{card.resource_id} ({card.date}) "
            f"{card.title}: {card.excerpt}"
        )
    return "\n".join(lines) or "No evidence cards were retrieved."


def generate_grounded_answer(
    *,
    payload: AgentQuery,
    router_choice: dict[str, Any],
    deterministic_answer: str,
    evidence: list[EvidenceCard],
    intent: str,
) -> LLMResult:
    settings = get_settings()
    if router_choice.get("provider") == "ollama":
        return _generate_ollama_answer(
            settings=settings,
            payload=payload,
            router_choice=router_choice,
            deterministic_answer=deterministic_answer,
            evidence=evidence,
            intent=intent,
        )
    if router_choice.get("provider") != "openai" or not settings.openai_api_key:
        return LLMResult(answer=None, status="skipped")

    try:
        from openai import OpenAI
    except ImportError as exc:
        return LLMResult(answer=None, status="error", error=f"OpenAI SDK is not installed: {exc}")

    prompt = f"""
You are HealthAgent Workbench, a healthcare operations assistant for synthetic data.
This product is not for clinical decision-making and must not invent facts.

User role: {payload.role}
Intent: {intent}
User question: {payload.query}
Strict grounding required: {payload.settings.strict_grounding}

Evidence:
{_evidence_block(evidence)}

Draft deterministic answer:
{deterministic_answer}

Write a concise operational answer. Cite evidence resource IDs inline when making factual claims.
If the evidence is insufficient, say what is missing instead of guessing.
""".strip()

    try:
        client = OpenAI(api_key=settings.openai_api_key)
        response = client.responses.create(
            model=str(router_choice["model"]),
            input=prompt,
            temperature=payload.settings.temperature,
            max_output_tokens=payload.settings.max_tokens,
        )
        answer = getattr(response, "output_text", "").strip()
        if not answer:
            return LLMResult(answer=None, status="error", error="Provider returned an empty answer")
        return LLMResult(answer=answer, status="success")
    except Exception as exc:  # Provider failures should not break the grounded workflow.
        return LLMResult(answer=None, status="error", error=str(exc))


def ollama_status() -> dict[str, Any]:
    settings = get_settings()
    base_url = settings.ollama_base_url.rstrip("/")
    result: dict[str, Any] = {"base_url": base_url, "model": settings.ollama_model, "available": False}
    try:
        response = httpx.get(f"{base_url}/api/tags", timeout=2.0)
        response.raise_for_status()
        tags = response.json().get("models", [])
        models = [tag.get("name") for tag in tags if tag.get("name")]
        result.update({"available": True, "models": models, "model_installed": settings.ollama_model in models})
    except Exception as exc:
        result["error"] = str(exc)
    return result


def _generate_ollama_answer(
    *,
    settings: Any,
    payload: AgentQuery,
    router_choice: dict[str, Any],
    deterministic_answer: str,
    evidence: list[EvidenceCard],
    intent: str,
) -> LLMResult:
    prompt = f"""
You are HealthAgent Workbench, a healthcare operations assistant for synthetic data.
This product is not for clinical decision-making and must not invent facts.
Do not include hidden reasoning, chain-of-thought, or <think> blocks.

User role: {payload.role}
Intent: {intent}
User question: {payload.query}
Strict grounding required: {payload.settings.strict_grounding}

Evidence:
{_evidence_block(evidence)}

Draft deterministic answer:
{deterministic_answer}

Write a concise operational answer. Cite evidence resource IDs inline when making factual claims.
If the evidence is insufficient, say what is missing instead of guessing.
""".strip()

    try:
        response = httpx.post(
            f"{settings.ollama_base_url.rstrip('/')}/api/chat",
            json={
                "model": router_choice["model"],
                "messages": [
                    {
                        "role": "system",
                        "content": "Answer only with the final concise operational response. Do not reveal reasoning or <think> blocks.",
                    },
                    {"role": "user", "content": prompt},
                ],
                "stream": False,
                "think": False,
                "options": {
                    "temperature": payload.settings.temperature,
                    "num_predict": payload.settings.max_tokens,
                },
            },
            timeout=180.0,
        )
        response.raise_for_status()
        answer = str(response.json().get("message", {}).get("content", "")).strip()
        answer = _strip_think_blocks(answer)
        if not answer:
            return LLMResult(answer=None, status="error", error="Ollama returned an empty answer")
        return LLMResult(answer=answer, status="success")
    except Exception as exc:
        return LLMResult(answer=None, status="error", error=str(exc))


def _strip_think_blocks(answer: str) -> str:
    while "<think>" in answer and "</think>" in answer:
        start = answer.find("<think>")
        end = answer.find("</think>", start) + len("</think>")
        answer = f"{answer[:start]}{answer[end:]}".strip()
    return answer
