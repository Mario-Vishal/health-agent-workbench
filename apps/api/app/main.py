from __future__ import annotations

import subprocess
import sys
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.agent.graph import run_agent
from app.analytics.risk import care_gap_analytics, risk_scores
from app.audit.store import read_audit_events, write_audit_event
from app.config import get_settings
from app.data_quality.report import data_quality_report
from app.evals.runner import run_evals
from app.models.schemas import AgentQuery, ClaimReview
from app.services.fhir_loader import fhir_status, load_demo_fhir
from app.services.hybrid_rag import ensure_rag_index, hybrid_search, rag_status, reindex_rag_documents
from app.services.llm import ollama_status
from app.services.repository import ROOT, get_repo
from app.services.synthea import generate_synthea, import_synthea_bundles, synthea_status
from app.tools.deterministic import overview_metrics


def ensure_seed_data() -> None:
    if not (ROOT / "data" / "synthetic" / "members.json").exists():
        candidates = [
            ROOT / "apps" / "api" / "scripts" / "seed_demo_data.py",
            ROOT / "scripts" / "seed_demo_data.py",
        ]
        seed_script = next((candidate for candidate in candidates if candidate.exists()), candidates[0])
        subprocess.run([sys.executable, str(seed_script)], check=True)


settings = get_settings()
ensure_seed_data()

app = FastAPI(title=settings.app_name, version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


AGENT_RUNS: dict[str, dict[str, Any]] = {}
LATEST_EVALS: dict[str, Any] | None = None


@app.on_event("startup")
def auto_load_fhir_if_empty() -> None:
    if settings.use_hapi_fhir:
        try:
            status = fhir_status()
            if status["available"] and sum(status["counts"].values()) == 0:
                load_demo_fhir()
        except Exception:
            pass
    try:
        ensure_rag_index()
    except Exception:
        pass


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "app": settings.app_name, "mock_mode": settings.mock_mode, "synthetic_data_only": True}


@app.get("/api/settings/runtime")
def runtime_settings() -> dict[str, object]:
    synthea = synthea_status()
    fhir = fhir_status()
    ollama = ollama_status() if settings.llm_provider == "ollama" else None
    llm_available = bool(settings.openai_api_key) if settings.llm_provider == "openai" else bool(ollama and ollama.get("available"))
    return {
        "app": settings.app_name,
        "mock_mode": not llm_available,
        "synthetic_data_only": True,
        "llm_provider_available": llm_available,
        "configured_provider": settings.llm_provider if settings.llm_provider_available else "deterministic",
        "default_model": "default_agent",
        "ollama_status": ollama,
        "rag_status": rag_status(),
        "clinical_data_source": synthea["active_clinical_data_source"],
        "fhir_status": fhir,
        "synthea_status": synthea,
    }


@app.get("/api/overview/metrics")
def metrics() -> dict[str, Any]:
    return overview_metrics()


@app.get("/api/members")
def members() -> list[dict[str, Any]]:
    return get_repo().members()


@app.get("/api/members/{member_id}")
def member(member_id: str) -> dict[str, Any]:
    row = get_repo().member(member_id)
    if not row:
        raise HTTPException(status_code=404, detail="Member not found")
    return row


@app.get("/api/members/{member_id}/timeline")
def member_timeline(member_id: str) -> dict[str, Any]:
    return {"member": member(member_id), "events": get_repo().timeline(member_id)}


@app.get("/api/fhir/resources/{resource_type}")
def fhir_resources(resource_type: str) -> list[dict[str, Any]]:
    return get_repo().fhir_resources(resource_type)


@app.get("/api/fhir/status")
def fhir_server_status() -> dict[str, Any]:
    return fhir_status()


@app.post("/api/fhir/load-demo")
def fhir_load_demo() -> dict[str, Any]:
    try:
        return load_demo_fhir()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"HAPI FHIR load failed: {exc}") from exc


@app.get("/api/rag/status")
def rag_server_status() -> dict[str, Any]:
    return rag_status()


@app.post("/api/rag/reindex")
def rag_reindex() -> dict[str, Any]:
    try:
        return reindex_rag_documents()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"RAG reindex failed: {exc}") from exc


@app.post("/api/rag/search")
def rag_search(payload: dict[str, Any]) -> dict[str, Any]:
    query = str(payload.get("query") or "")
    if not query:
        raise HTTPException(status_code=422, detail="query is required")
    return hybrid_search(query, limit=int(payload.get("limit", 8)), filters=payload.get("filters") or {})


@app.get("/api/synthea/status")
def synthea_server_status() -> dict[str, Any]:
    return synthea_status()


@app.post("/api/synthea/generate")
def synthea_generate(patient_count: int | None = None) -> dict[str, Any]:
    result = generate_synthea(patient_count)
    if result["status"] == "failed":
        raise HTTPException(status_code=503, detail=result)
    if result["status"] == "unsupported":
        raise HTTPException(status_code=501, detail=result)
    return result


@app.post("/api/synthea/import")
def synthea_import() -> dict[str, Any]:
    try:
        return import_synthea_bundles()
    except Exception as exc:
        raise HTTPException(status_code=503, detail=f"Synthea import failed: {exc}") from exc


@app.get("/api/fhir/resources/{resource_type}/{resource_id}")
def fhir_resource(resource_type: str, resource_id: str) -> dict[str, Any]:
    row = get_repo().fhir_resource(resource_type, resource_id)
    if not row:
        raise HTTPException(status_code=404, detail="FHIR resource not found")
    return row


@app.get("/api/claims")
def claims() -> list[dict[str, Any]]:
    return get_repo().claims()


@app.get("/api/claims/{claim_id}")
def claim(claim_id: str) -> dict[str, Any]:
    row = get_repo().claim(claim_id)
    if not row:
        raise HTTPException(status_code=404, detail="Claim not found")
    return {**row, "line_items": get_repo().claim_lines(claim_id)}


@app.post("/api/claims/{claim_id}/review")
def review_claim(claim_id: str, review: ClaimReview) -> dict[str, Any]:
    row = claim(claim_id)
    event = write_audit_event(
        {
            "user_role": review.reviewer,
            "query": f"review {claim_id}",
            "model_used": "human_review",
            "tools_called": ["claim_review"],
            "resources_accessed": [claim_id],
            "grounding_status": "reviewed",
            "result_status": review.decision,
            "rationale": review.rationale,
        }
    )
    return {"claim": row, "review": review.model_dump(), "audit_event": event}


@app.post("/api/agent/query")
def agent_query(payload: AgentQuery) -> dict[str, Any]:
    response = run_agent(payload)
    AGENT_RUNS[response.run_id] = response.model_dump()
    return AGENT_RUNS[response.run_id]


@app.get("/api/agent/runs/{run_id}")
def agent_run(run_id: str) -> dict[str, Any]:
    if run_id not in AGENT_RUNS:
        raise HTTPException(status_code=404, detail="Run not found in in-memory demo store")
    return AGENT_RUNS[run_id]


@app.get("/api/agent/runs/{run_id}/trace")
def agent_trace(run_id: str) -> list[dict[str, Any]]:
    return agent_run(run_id)["trace"]


@app.post("/api/cohorts/build")
def build_cohort(criteria: dict[str, Any]) -> dict[str, Any]:
    from app.tools.deterministic import build_patient_cohort

    return build_patient_cohort(criteria)


@app.get("/api/cohorts/{cohort_id}")
def cohort(cohort_id: str) -> dict[str, Any]:
    from app.tools.deterministic import build_patient_cohort

    return {"cohort_id": cohort_id, **build_patient_cohort({"diabetes": True})}


@app.get("/api/analytics/care-gaps")
def analytics_care_gaps() -> dict[str, Any]:
    return care_gap_analytics()


@app.get("/api/analytics/risk-scores")
def analytics_risk_scores() -> dict[str, Any]:
    return risk_scores()


@app.post("/api/evals/run")
def evals_run() -> dict[str, Any]:
    global LATEST_EVALS
    LATEST_EVALS = run_evals()
    return LATEST_EVALS


@app.get("/api/evals/results")
def evals_results() -> dict[str, Any]:
    return LATEST_EVALS or run_evals()


@app.get("/api/data-quality/report")
def quality_report() -> dict[str, Any]:
    return data_quality_report()


@app.get("/api/audit/events")
def audit_events() -> list[dict[str, Any]]:
    return read_audit_events()


@app.get("/api/architecture/status")
def architecture_status() -> dict[str, Any]:
    return {
        "services": [
            {"name": "web", "status": "configured", "url": "http://localhost:3000"},
            {"name": "api", "status": "healthy", "url": "http://localhost:8000/docs"},
            {"name": "postgres", "status": "configured", "feature": "pgvector extension"},
            {"name": "redis", "status": "configured", "feature": "worker/cache ready"},
            {"name": "hapi-fhir", "status": "configured", "url": "http://localhost:8080/fhir"},
            {"name": "worker", "status": "configured", "feature": "background jobs placeholder"},
        ],
        "model_router": {
            "default_agent": "openai/gpt-4.1-mini or deterministic mock",
            "advanced_agent": "openai/gpt-5.4-mini or deterministic mock",
            "eval_judge": "openai/gpt-5.5 or deterministic mock",
            "local_fallback": f"ollama/{settings.ollama_model}",
        },
        "synthetic_data_only": True,
        "fhir_status": fhir_status(),
        "synthea_status": synthea_status(),
        "rag_status": rag_status(),
        "clinical_use": "not for clinical decision-making",
    }
