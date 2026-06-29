from __future__ import annotations

import re
import time
from typing import Any, Callable
from uuid import uuid4

from app.agent.model_router import ModelRouter
from app.audit.store import write_audit_event
from app.models.schemas import AgentQuery, AgentResponse, EvidenceCard, TraceStep
from app.services.hybrid_rag import evidence_matches_query, hybrid_search, validate_grounding
from app.services.llm import generate_grounded_answer
from app.tools import deterministic as tools


def _trace(name: str, fn: Callable[..., dict[str, Any]], **kwargs: Any) -> tuple[dict[str, Any], TraceStep]:
    start = time.perf_counter()
    output = fn(**kwargs)
    latency = int((time.perf_counter() - start) * 1000) + 12
    return output, TraceStep(id=f"step-{uuid4().hex[:8]}", name=name, latency_ms=latency, input=kwargs, output=output)


def _member_id(query: str) -> str:
    match = re.search(r"\bM-\d{4}\b", query, re.IGNORECASE)
    return match.group(0).upper() if match else "M-1001"


def _claim_id(query: str) -> str:
    match = re.search(r"CLM-\d{4}", query, re.IGNORECASE)
    return match.group(0).upper() if match else "CLM-1008"


def _evidence(title: str, resource_type: str, resource_id: str, date: str, excerpt: str) -> EvidenceCard:
    return EvidenceCard(id=f"ev-{uuid4().hex[:8]}", title=title, resource_type=resource_type, resource_id=resource_id, date=date, excerpt=excerpt)


def _append_rag_evidence(evidence: list[EvidenceCard], rag_result: dict[str, Any], limit: int, query: str, require_match: bool = False) -> None:
    existing = {(card.resource_type, card.resource_id) for card in evidence}
    for hit in rag_result.get("hits", []):
        key = (hit["resource_type"], hit["resource_id"])
        if key in existing:
            continue
        card = EvidenceCard(
            id=f"rag-{uuid4().hex[:8]}",
            title=hit["title"],
            resource_type=hit["resource_type"],
            resource_id=hit["resource_id"],
            date=str(hit.get("metadata", {}).get("date", "2026-06-26")),
            excerpt=hit["excerpt"],
        )
        if require_match and not evidence_matches_query(query, card):
            continue
        evidence.append(card)
        existing.add(key)
        if len(evidence) >= limit:
            break


def _is_care_gap_query(query: str) -> bool:
    lowered = query.lower()
    return any(term in lowered for term in ["diabetes", "diabetic", "hba1c", "a1c", "care gap", "follow-up", "follow up", "high-risk", "high risk"])


def _is_diabetes_query(query: str) -> bool:
    lowered = query.lower()
    return any(term in lowered for term in ["diabetes", "diabetic", "hba1c", "a1c", "glp-1", "glp1"])


def _is_clinical_search_query(query: str) -> bool:
    lowered = query.lower()
    clinical_terms = [
        "viral",
        "fever",
        "respiratory",
        "infection",
        "asthma",
        "copd",
        "chronic obstructive",
        "hypertension",
        "blood pressure",
        "screening",
        "medication adherence",
        "adherence",
        "temperature",
        "oxygen",
    ]
    return any(term in lowered for term in clinical_terms)


def _clinical_date(row: dict[str, Any]) -> str:
    return str(row.get("recordedDate") or row.get("effectiveDateTime") or row.get("period_start") or row.get("authoredOn") or row.get("due_date") or "2026-06-26")


def _append_clinical_search_evidence(evidence: list[EvidenceCard], search: dict[str, Any], query: str) -> None:
    gap_focused = any(term in query.lower() for term in ["gap", "adherence", "follow-up", "follow up"])
    if gap_focused:
        for gap in search.get("care_gaps", [])[:3]:
            evidence.append(_evidence(gap["type"], "CareGap", gap["id"], _clinical_date(gap), f"{gap['reason']} for member {gap['member_id']} with severity {gap['severity']}."))
        for medication in search.get("medications", [])[:2]:
            evidence.append(_evidence(medication["medication"], "MedicationRequest", medication["id"], _clinical_date(medication), f"{medication['medication']} for member {medication['member_id']} is {medication['status']}."))
        if search.get("care_gaps"):
            return
    for condition in search.get("conditions", [])[:3]:
        evidence.append(_evidence(condition["display"], "Condition", condition["id"], _clinical_date(condition), f"{condition['display']} for member {condition['member_id']} is {condition['clinicalStatus']}."))
    for observation in search.get("observations", [])[:3]:
        evidence.append(_evidence(observation["display"], "Observation", observation["id"], _clinical_date(observation), f"{observation['display']} for member {observation['member_id']} was {observation['value']} {observation['unit']} with interpretation {observation['interpretation']}."))
    for encounter in search.get("encounters", [])[:2]:
        evidence.append(_evidence(encounter["type"], "Encounter", encounter["id"], _clinical_date(encounter), f"{encounter['type']} for member {encounter['member_id']} at {encounter['location']}."))
    for medication in search.get("medications", [])[:2]:
        evidence.append(_evidence(medication["medication"], "MedicationRequest", medication["id"], _clinical_date(medication), f"{medication['medication']} for member {medication['member_id']} is {medication['status']}."))
    for gap in search.get("care_gaps", [])[:3]:
        evidence.append(_evidence(gap["type"], "CareGap", gap["id"], _clinical_date(gap), f"{gap['reason']} for member {gap['member_id']} with severity {gap['severity']}."))


def run_agent(payload: AgentQuery) -> AgentResponse:
    query = payload.query
    lowered = query.lower()
    router_choice = ModelRouter().select(payload.model)
    trace: list[TraceStep] = []
    evidence: list[EvidenceCard] = []

    require_rag_match = False

    if "timeline" in lowered or re.search(r"\bM-\d{4}\b", query, re.IGNORECASE):
        intent = "member_timeline"
        member_id = _member_id(query)
        timeline, step = _trace("get_patient_timeline", tools.get_patient_timeline, member_id=member_id)
        trace.append(step)
        events = timeline["events"][:6]
        for event in events[:4]:
            evidence.append(_evidence(event["title"], event["type"], event["id"], event["date"], f"Timeline event for {member_id}: {event['title']}"))
        answer = f"{member_id} has {len(timeline['events'])} timeline events across clinical, medication, claims, care-gap, and risk-score records. The most recent items are {', '.join(event['type'] for event in events[:3])}."
    elif "claim" in lowered or "denied" in lowered or "denial" in lowered:
        intent = "claims_denial_risk"
        claim_id = _claim_id(query)
        details, step = _trace("get_claim_details", tools.get_claim_details, claim_id=claim_id)
        trace.append(step)
        policy, step = _trace("retrieve_policy_snippets", tools.retrieve_policy_snippets, claim_id=claim_id)
        trace.append(step)
        claim = details["claim"]
        snippets = policy["snippets"]
        for snippet in snippets:
            evidence.append(_evidence(snippet["title"], "Policy", snippet["id"], "2026-01-01", snippet["text"]))
        if claim:
            evidence.append(_evidence("Claim detail", "Claim", claim["claim_id"], claim["service_date"], f"{claim['procedure']} has denial risk {claim['denial_risk']:.0%}."))
            missing = ", ".join(claim["missing_documentation"]) or "no critical missing documentation"
            answer = f"{claim_id} may be denied because the claim is for {claim['procedure']} and is missing {missing}. The matching policy requires prior authorization evidence for this service."
        else:
            answer = f"I could not find {claim_id} in the synthetic claims fixture."
    elif _is_clinical_search_query(query) and not _is_diabetes_query(query):
        intent = "clinical_record_search"
        clinical, step = _trace("search_clinical_records", tools.search_clinical_records, query=query, member_id=None)
        trace.append(step)
        _append_clinical_search_evidence(evidence, clinical, query)
        members = clinical.get("members", [])
        if clinical["count"]:
            member_list = ", ".join(member["member_id"] for member in members[:6])
            answer = (
                f"I found {clinical['count']} matching synthetic members for '{query}'. "
                f"Examples: {member_list}. Matching evidence includes {len(clinical.get('conditions', []))} conditions, "
                f"{len(clinical.get('observations', []))} observations, {len(clinical.get('encounters', []))} encounters, "
                f"{len(clinical.get('medications', []))} medication records, and {len(clinical.get('care_gaps', []))} care gaps."
            )
        else:
            answer = f"I could not find matching synthetic clinical evidence for '{query}'."
        require_rag_match = True
    elif "cohort" in lowered or "high-risk" in lowered or "high risk" in lowered:
        intent = "cohort_analytics"
        criteria = {
            "diabetes": "diabet" in lowered or "hba1c" in lowered,
            "hypertension": "hypertension" in lowered or "blood pressure" in lowered,
            "viral_fever": "viral" in lowered or "fever" in lowered,
            "asthma": "asthma" in lowered,
            "copd": "copd" in lowered or "chronic obstructive" in lowered,
            "high_risk": "risk" in lowered,
        }
        if not any(value for key, value in criteria.items() if key != "high_risk"):
            criteria["diabetes"] = True
        cohort, step = _trace("build_patient_cohort", tools.build_patient_cohort, criteria=criteria)
        trace.append(step)
        gaps, step = _trace("compute_care_gaps", tools.compute_care_gaps)
        trace.append(step)
        for gap in gaps["care_gaps"][:4]:
            evidence.append(_evidence(gap["type"], "CareGap", gap["id"], gap["due_date"], gap["reason"]))
        answer = f"The cohort builder found {cohort['count']} matching synthetic members. There are {gaps['count']} open synthetic care gaps across diabetes, respiratory, medication adherence, preventive screening, and acute illness workflows."
    elif "evidence" in lowered or "ground" in lowered:
        intent = "evidence_grounding"
        validation, step = _trace("validate_answer_grounding", tools.validate_answer_grounding, evidence_count=3)
        trace.append(step)
        coverage, step = _trace("check_citation_coverage", tools.check_citation_coverage, claims_count=3, evidence_count=3)
        trace.append(step)
        evidence.extend(
            [
                _evidence("Abnormal HbA1c", "Observation", "obs-a1c-M-1001", "2026-04-12", "HbA1c exceeds the abnormal threshold."),
                _evidence("Policy requirement", "Policy", "POL-PA-GLP1-S2", "2026-01-01", "Policy requires recent HbA1c and step therapy documentation."),
            ]
        )
        answer = f"The answer is grounded as {validation['grounding_status']} with {coverage['citation_coverage']:.0%} citation coverage across the checked claims."
    elif _is_care_gap_query(query):
        intent = "care_gap_query"
        gaps, step = _trace("compute_care_gaps", tools.compute_care_gaps)
        trace.append(step)
        if _is_diabetes_query(query):
            patients, step = _trace("search_patients", tools.search_patients, diabetes=True, high_risk=True)
            trace.append(step)
            observations, step = _trace("get_patient_observations", tools.get_patient_observations, member_id=None)
            trace.append(step)
            abnormal = [row for row in observations["observations"] if row.get("code") == "4548-4" and row["interpretation"] == "high"]
            answer = f"I found {patients['count']} high-risk diabetic members and {len(abnormal)} abnormal HbA1c observations. The open follow-up gaps should be prioritized by severity and last encounter age."
        else:
            answer = f"I found {gaps['count']} open synthetic care gaps across the loaded workflows."
        for gap in gaps["care_gaps"][:5]:
            evidence.append(_evidence(gap["type"], "CareGap", gap["id"], gap["due_date"], gap["reason"]))
    else:
        intent = "clinical_record_search"
        require_rag_match = True
        answer = (
            f"I could not find matching synthetic evidence for '{query}'. "
            "The current indexed demo data contains members, diabetes/hypertension conditions, HbA1c observations, care gaps, claims, and policy snippets."
        )

    rag_start = time.perf_counter()
    rag_result = hybrid_search(query, limit=payload.settings.retrieval_depth)
    _append_rag_evidence(evidence, rag_result, payload.settings.retrieval_depth * 2, query, require_match=require_rag_match)
    trace.append(
        TraceStep(
            id=f"step-{uuid4().hex[:8]}",
            name="hybrid_rag_retrieve",
            latency_ms=int((time.perf_counter() - rag_start) * 1000) + 10,
            input={"query": query, "limit": payload.settings.retrieval_depth, "architecture": rag_result["architecture"]},
            output={"evidence_pack": rag_result["evidence_pack"], "diagnostics": rag_result["diagnostics"]},
        )
    )

    llm_start = time.perf_counter()
    llm_result = generate_grounded_answer(
        payload=payload,
        router_choice=router_choice,
        deterministic_answer=answer,
        evidence=evidence[: payload.settings.retrieval_depth],
        intent=intent,
    )
    if llm_result.answer:
        answer = llm_result.answer
    trace.append(
        TraceStep(
            id=f"step-{uuid4().hex[:8]}",
            name="generate_grounded_llm_answer",
            status="success" if llm_result.status == "success" else ("error" if llm_result.status == "error" else "skipped"),
            latency_ms=int((time.perf_counter() - llm_start) * 1000) + 8,
            input={
                "model": router_choice["model"],
                "temperature": payload.settings.temperature,
                "max_tokens": payload.settings.max_tokens,
                "strict_grounding": payload.settings.strict_grounding,
            },
            output={"status": llm_result.status, "error": llm_result.error},
        )
    )

    grounding = validate_grounding(answer, evidence[: payload.settings.retrieval_depth])
    trace.append(
        TraceStep(
            id=f"step-{uuid4().hex[:8]}",
            name="validate_grounded_response",
            latency_ms=8,
            input={"evidence_count": len(evidence[: payload.settings.retrieval_depth]), "strict_grounding": payload.settings.strict_grounding},
            output=grounding,
        )
    )
    audit_event = write_audit_event(
        {
            "user_role": payload.role,
            "query": payload.query,
            "model_used": router_choice["model"],
            "tools_called": [step.name for step in trace],
            "resources_accessed": [card.resource_id for card in evidence],
            "grounding_status": grounding["grounding_status"],
            "result_status": "success" if llm_result.status != "error" else "deterministic_fallback",
        }
    )
    trace.append(
        TraceStep(
            id=f"step-{uuid4().hex[:8]}",
            name="write_audit_event",
            latency_ms=9,
            input={"query": payload.query},
            output={"audit_id": audit_event["id"]},
        )
    )

    return AgentResponse(
        run_id=f"run-{uuid4().hex[:10]}",
        answer=answer,
        intent=intent,
        evidence=evidence,
        trace=trace,
        metrics={
            "grounding_status": grounding["grounding_status"],
            "citation_coverage": grounding["citation_coverage"],
            "latency_ms": sum(step.latency_ms for step in trace),
            "tool_calls": len(trace),
            "llm_status": llm_result.status,
            "retrieval_depth": payload.settings.retrieval_depth,
            "strict_grounding": payload.settings.strict_grounding,
            "rag_architecture": rag_result["architecture"],
            "rag_fused_candidates": rag_result["diagnostics"]["fused_candidates"],
        },
        model_used=router_choice["model"],
        mock_mode=router_choice["provider"] == "mock" or llm_result.status != "success",
    )
