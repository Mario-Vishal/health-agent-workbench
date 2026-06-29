from typing import Any, Literal

from pydantic import BaseModel, Field


class EvidenceCard(BaseModel):
    id: str
    title: str
    resource_type: str
    resource_id: str
    date: str
    excerpt: str
    status: Literal["supported", "partial", "unsupported"] = "supported"


class TraceStep(BaseModel):
    id: str
    name: str
    status: Literal["success", "running", "error", "skipped"] = "success"
    latency_ms: int
    input: dict[str, Any]
    output: dict[str, Any]


class AgentSettings(BaseModel):
    temperature: float = Field(default=0.2, ge=0, le=2)
    max_tokens: int = Field(default=700, ge=128, le=4000)
    retrieval_depth: int = Field(default=5, ge=1, le=12)
    strict_grounding: bool = True


class AgentQuery(BaseModel):
    query: str
    role: str = "care_manager"
    model: str = "default_agent"
    settings: AgentSettings = Field(default_factory=AgentSettings)


class AgentResponse(BaseModel):
    run_id: str
    answer: str
    intent: str
    evidence: list[EvidenceCard]
    trace: list[TraceStep]
    metrics: dict[str, Any]
    model_used: str
    mock_mode: bool


class ClaimReview(BaseModel):
    decision: Literal["approve", "pend", "deny"]
    reviewer: str = "demo_reviewer"
    rationale: str = Field(min_length=3)
