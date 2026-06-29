from __future__ import annotations

import hashlib
import math
import re
from collections import Counter, defaultdict
from dataclasses import dataclass
from typing import Any

from sqlalchemy import text

from app.db.session import engine
from app.models.schemas import EvidenceCard
from app.services.repository import get_repo


EMBEDDING_DIM = 384
RRF_K = 60


@dataclass
class RagDocument:
    resource_type: str
    resource_id: str
    title: str
    body: str
    source: str
    metadata: dict[str, Any]


@dataclass
class RagHit:
    document: RagDocument
    score: float
    lexical_rank: int | None
    vector_rank: int | None
    rerank_score: float


def ensure_rag_schema() -> None:
    with engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        connection.execute(
            text(
                """
                CREATE TABLE IF NOT EXISTS rag_documents (
                    id BIGSERIAL PRIMARY KEY,
                    resource_type TEXT NOT NULL,
                    resource_id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    body TEXT NOT NULL,
                    source TEXT NOT NULL,
                    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
                    embedding vector(384) NOT NULL,
                    search_vector TSVECTOR GENERATED ALWAYS AS (
                        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
                        setweight(to_tsvector('english', coalesce(body, '')), 'B')
                    ) STORED,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    UNIQUE (resource_type, resource_id)
                )
                """
            )
        )
        connection.execute(text("CREATE INDEX IF NOT EXISTS rag_documents_search_idx ON rag_documents USING GIN (search_vector)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS rag_documents_metadata_idx ON rag_documents USING GIN (metadata)"))
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS rag_documents_embedding_idx "
                "ON rag_documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 16)"
            )
        )


def reindex_rag_documents() -> dict[str, Any]:
    ensure_rag_schema()
    documents = _build_documents()
    with engine.begin() as connection:
        connection.execute(text("TRUNCATE TABLE rag_documents"))
        for document in documents:
            connection.execute(
                text(
                    """
                    INSERT INTO rag_documents (resource_type, resource_id, title, body, source, metadata, embedding)
                    VALUES (:resource_type, :resource_id, :title, :body, :source, CAST(:metadata AS jsonb), CAST(:embedding AS vector))
                    ON CONFLICT (resource_type, resource_id) DO UPDATE SET
                        title = EXCLUDED.title,
                        body = EXCLUDED.body,
                        source = EXCLUDED.source,
                        metadata = EXCLUDED.metadata,
                        embedding = EXCLUDED.embedding,
                        updated_at = now()
                    """
                ),
                {
                    "resource_type": document.resource_type,
                    "resource_id": document.resource_id,
                    "title": document.title,
                    "body": document.body,
                    "source": document.source,
                    "metadata": _json_metadata(document.metadata),
                    "embedding": _vector_literal(embed_text(f"{document.title}\n{document.body}")),
                },
            )
    return rag_status()


def ensure_rag_index() -> dict[str, Any]:
    ensure_rag_schema()
    status = rag_status()
    if status["documents"] == 0:
        return reindex_rag_documents()
    return status


def rag_status() -> dict[str, Any]:
    try:
        ensure_rag_schema()
        with engine.begin() as connection:
            rows = connection.execute(
                text("SELECT resource_type, count(*) AS count FROM rag_documents GROUP BY resource_type ORDER BY resource_type")
            ).mappings()
            counts = {row["resource_type"]: row["count"] for row in rows}
        return {
            "available": True,
            "architecture": "postgres_full_text_plus_pgvector_rrf",
            "documents": sum(counts.values()),
            "resource_counts": counts,
            "embedding_dim": EMBEDDING_DIM,
            "fusion": "reciprocal_rank_fusion",
            "reranker": "lexical_overlap_metadata_boost",
        }
    except Exception as exc:
        return {"available": False, "architecture": "postgres_full_text_plus_pgvector_rrf", "documents": 0, "error": str(exc)}


def hybrid_search(query: str, *, limit: int = 8, filters: dict[str, Any] | None = None) -> dict[str, Any]:
    filters = filters or {}
    try:
        ensure_rag_index()
        lexical = _lexical_search(query, filters=filters, limit=max(30, limit * 4))
        vector = _vector_search(query, filters=filters, limit=max(30, limit * 4))
        fused = _rrf_fuse(lexical, vector)
        diagnostics = {
            "lexical_candidates": len(lexical),
            "vector_candidates": len(vector),
            "fused_candidates": len(fused),
            "filters": filters,
            "backend": "postgres",
        }
    except Exception as exc:
        fused = _memory_candidates(query, filters=filters, limit=max(30, limit * 4))
        diagnostics = {
            "lexical_candidates": len(fused),
            "vector_candidates": len(fused),
            "fused_candidates": len(fused),
            "filters": filters,
            "backend": "in_memory_fallback",
            "fallback_reason": str(exc),
        }
    reranked = _rerank(query, fused)
    hits = reranked[:limit]
    return {
        "query": query,
        "architecture": "postgres_full_text_plus_pgvector_rrf",
        "hits": [_hit_to_dict(hit) for hit in hits],
        "evidence_pack": evidence_pack(query, hits),
        "diagnostics": diagnostics,
    }


def evidence_pack(query: str, hits: list[RagHit]) -> dict[str, Any]:
    cards = [hit_to_evidence_card(hit) for hit in hits]
    return {
        "query": query,
        "count": len(cards),
        "resource_ids": [card.resource_id for card in cards],
        "resource_types": dict(Counter(card.resource_type for card in cards)),
        "cards": [card.model_dump() for card in cards],
    }


def hit_to_evidence_card(hit: RagHit) -> EvidenceCard:
    document = hit.document
    return EvidenceCard(
        id=f"rag-{hashlib.sha1(f'{document.resource_type}:{document.resource_id}'.encode()).hexdigest()[:8]}",
        title=document.title,
        resource_type=document.resource_type,
        resource_id=document.resource_id,
        date=str(document.metadata.get("date", "2026-06-26")),
        excerpt=_excerpt(document.body),
        status="supported",
    )


def validate_grounding(answer: str, evidence: list[EvidenceCard]) -> dict[str, Any]:
    if not evidence:
        return {"grounding_status": "unsupported", "citation_coverage": 0.0, "cited_resources": [], "missing_citations": []}
    cited = [card.resource_id for card in evidence if card.resource_id in answer]
    bracket_citations = re.findall(r"\[(\d+)\]", answer)
    cited_indexes = {
        evidence[int(index) - 1].resource_id
        for index in bracket_citations
        if index.isdigit() and 0 < int(index) <= len(evidence)
    }
    cited_resources = sorted(set(cited) | cited_indexes)
    coverage = len(cited_resources) / len(evidence)
    status = "supported" if coverage >= 0.6 else "partial" if cited_resources else "unsupported"
    return {
        "grounding_status": status,
        "citation_coverage": round(coverage, 2),
        "cited_resources": cited_resources,
        "missing_citations": [card.resource_id for card in evidence if card.resource_id not in cited_resources],
    }


def evidence_matches_query(query: str, card: EvidenceCard) -> bool:
    query_terms = _clinical_query_terms(query)
    if not query_terms:
        return True
    evidence_terms = set(_tokens(f"{card.title} {card.excerpt} {card.resource_type} {card.resource_id}"))
    return any(term in evidence_terms for term in query_terms)


def embed_text(text_value: str) -> list[float]:
    vector = [0.0] * EMBEDDING_DIM
    tokens = _tokens(text_value)
    for token in tokens:
        digest = hashlib.blake2b(token.encode("utf-8"), digest_size=8).digest()
        bucket = int.from_bytes(digest[:4], "big") % EMBEDDING_DIM
        sign = 1 if digest[4] % 2 == 0 else -1
        vector[bucket] += sign * (1.0 + math.log1p(len(token)))
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [round(value / norm, 6) for value in vector]


def _build_documents() -> list[RagDocument]:
    repo = get_repo()
    documents: list[RagDocument] = []
    for policy in repo.policies():
        for snippet in policy.get("snippets", []):
            snippet_title = snippet.get("title") or snippet.get("id") or "Policy section"
            documents.append(
                RagDocument(
                    resource_type="Policy",
                    resource_id=snippet["id"],
                    title=f"{policy['title']} - {snippet_title}",
                    body=snippet["text"],
                    source="policy_documents",
                    metadata={"policy_id": policy["policy_id"], "date": "2026-01-01"},
                )
            )
    for claim in repo.claims():
        documents.append(
            RagDocument(
                resource_type="Claim",
                resource_id=claim["claim_id"],
                title=f"{claim['procedure']} claim for {claim['member_id']}",
                body=(
                    f"Claim {claim['claim_id']} for {claim['procedure']} at {claim['provider']} has status {claim['status']}, "
                    f"denial risk {claim['denial_risk']:.0%}, missing documentation: {', '.join(claim['missing_documentation']) or 'none'}."
                ),
                source="claims",
                metadata={"member_id": claim["member_id"], "date": claim["service_date"], "status": claim["status"]},
            )
        )
    for gap in repo.care_gaps():
        documents.append(
            RagDocument(
                resource_type="CareGap",
                resource_id=gap["id"],
                title=gap["type"],
                body=f"{gap['reason']} for member {gap['member_id']} with severity {gap['severity']}.",
                source="care_gaps",
                metadata={"member_id": gap["member_id"], "date": gap["due_date"], "severity": gap["severity"]},
            )
        )
    for member in repo.members():
        documents.append(
            RagDocument(
                resource_type="Member",
                resource_id=member["member_id"],
                title=f"{member['name']} member profile",
                body=(
                    f"{member['member_id']} is a {member['age']} year old member on {member['plan']} assigned to {member['primary_clinic']}. "
                    f"Clinical programs: {', '.join(member.get('clinical_programs', [])) or 'none'}. "
                    f"Diabetes={member['diabetes']}, hypertension={member['hypertension']}, viral fever={member.get('viral_fever', False)}, "
                    f"asthma={member.get('asthma', False)}, COPD={member.get('copd', False)}, high risk={member['high_risk']}, "
                    f"latest HbA1c={member['latest_hba1c']}, latest temperature={member.get('latest_temperature')}, "
                    f"oxygen saturation={member.get('oxygen_saturation')}, last encounter days={member['last_encounter_days']}, "
                    f"medication adherence gap={member.get('medication_adherence_gap', False)}, preventive screening due={member.get('preventive_screening_due', False)}."
                ),
                source="members",
                metadata={"member_id": member["member_id"], "date": "2026-06-26", "high_risk": member["high_risk"]},
            )
        )
    for condition in repo.condition_fixtures():
        documents.append(
            RagDocument(
                resource_type="Condition",
                resource_id=condition["id"],
                title=condition["display"],
                body=(
                    f"{condition['display']} for member {condition['member_id']} has code {condition['code']} "
                    f"and clinical status {condition['clinicalStatus']}."
                ),
                source="conditions",
                metadata={"member_id": condition["member_id"], "date": condition["recordedDate"], "code": condition["code"]},
            )
        )
    for observation in repo.observation_fixtures():
        documents.append(
            RagDocument(
                resource_type="Observation",
                resource_id=observation["id"],
                title=observation["display"],
                body=(
                    f"{observation['display']} for member {observation['member_id']} was {observation['value']} {observation['unit']} "
                    f"with interpretation {observation['interpretation']}."
                ),
                source="observations",
                metadata={"member_id": observation["member_id"], "date": observation["effectiveDateTime"], "code": observation["code"]},
            )
        )
    for encounter in repo.encounter_fixtures():
        documents.append(
            RagDocument(
                resource_type="Encounter",
                resource_id=encounter["id"],
                title=encounter["type"],
                body=(
                    f"{encounter['type']} for member {encounter['member_id']} at {encounter['location']} "
                    f"with status {encounter['status']}."
                ),
                source="encounters",
                metadata={"member_id": encounter["member_id"], "date": encounter["period_start"], "status": encounter["status"]},
            )
        )
    for medication in repo.medication_fixtures():
        documents.append(
            RagDocument(
                resource_type="MedicationRequest",
                resource_id=medication["id"],
                title=medication["medication"],
                body=(
                    f"{medication['medication']} for member {medication['member_id']} has medication request status {medication['status']}."
                ),
                source="medication_requests",
                metadata={"member_id": medication["member_id"], "date": medication["authoredOn"], "status": medication["status"]},
            )
        )
    return documents


def _lexical_search(query: str, *, filters: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    where, params = _filter_sql(filters)
    params.update({"query": _fts_query(query), "limit": limit})
    with engine.begin() as connection:
        return list(
            connection.execute(
                text(
                    f"""
                    SELECT resource_type, resource_id, title, body, source, metadata,
                           ts_rank_cd(search_vector, websearch_to_tsquery('english', :query)) AS rank
                    FROM rag_documents
                    WHERE search_vector @@ websearch_to_tsquery('english', :query)
                    {where}
                    ORDER BY rank DESC
                    LIMIT :limit
                    """
                ),
                params,
            ).mappings()
        )


def _vector_search(query: str, *, filters: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    where, params = _filter_sql(filters)
    params.update({"embedding": _vector_literal(embed_text(query)), "limit": limit})
    with engine.begin() as connection:
        return list(
            connection.execute(
                text(
                    f"""
                    SELECT resource_type, resource_id, title, body, source, metadata,
                           1 - (embedding <=> CAST(:embedding AS vector)) AS rank
                    FROM rag_documents
                    WHERE 1 = 1
                    {where}
                    ORDER BY embedding <=> CAST(:embedding AS vector)
                    LIMIT :limit
                    """
                ),
                params,
            ).mappings()
        )


def _rrf_fuse(lexical: list[dict[str, Any]], vector: list[dict[str, Any]]) -> list[RagHit]:
    scores: defaultdict[tuple[str, str], float] = defaultdict(float)
    docs: dict[tuple[str, str], RagDocument] = {}
    ranks: dict[tuple[str, str], dict[str, int | None]] = {}
    for rank, row in enumerate(lexical, start=1):
        key = (row["resource_type"], row["resource_id"])
        scores[key] += 1 / (RRF_K + rank)
        docs[key] = _row_to_document(row)
        ranks.setdefault(key, {"lexical": None, "vector": None})["lexical"] = rank
    for rank, row in enumerate(vector, start=1):
        key = (row["resource_type"], row["resource_id"])
        scores[key] += 1 / (RRF_K + rank)
        docs[key] = _row_to_document(row)
        ranks.setdefault(key, {"lexical": None, "vector": None})["vector"] = rank
    return [
        RagHit(document=docs[key], score=score, lexical_rank=ranks[key]["lexical"], vector_rank=ranks[key]["vector"], rerank_score=0)
        for key, score in sorted(scores.items(), key=lambda item: item[1], reverse=True)
    ]


def _rerank(query: str, hits: list[RagHit]) -> list[RagHit]:
    query_terms = set(_tokens(query))
    for hit in hits:
        text_terms = set(_tokens(f"{hit.document.title} {hit.document.body}"))
        overlap = len(query_terms & text_terms) / max(1, len(query_terms))
        type_boost = 0.08 if hit.document.resource_type in {"Policy", "CareGap", "Observation", "Condition", "Encounter", "MedicationRequest", "Claim"} else 0
        severity_boost = 0.05 if hit.document.metadata.get("severity") in {"high", "critical"} else 0
        hit.rerank_score = round(hit.score + overlap + type_boost + severity_boost, 6)
    return sorted(hits, key=lambda hit: hit.rerank_score, reverse=True)


def _memory_candidates(query: str, *, filters: dict[str, Any], limit: int) -> list[RagHit]:
    query_terms = set(_tokens(query))
    query_vector = embed_text(query)
    hits: list[RagHit] = []
    for index, document in enumerate(_build_documents(), start=1):
        if filters.get("resource_type") and document.resource_type != filters["resource_type"]:
            continue
        if filters.get("member_id") and document.metadata.get("member_id") != filters["member_id"]:
            continue
        document_terms = set(_tokens(f"{document.title} {document.body}"))
        lexical = len(query_terms & document_terms) / max(1, len(query_terms))
        vector = _cosine(query_vector, embed_text(f"{document.title}\n{document.body}"))
        score = (lexical + vector) / 2
        hits.append(RagHit(document=document, score=score, lexical_rank=index, vector_rank=index, rerank_score=0))
    return sorted(hits, key=lambda hit: hit.score, reverse=True)[:limit]


def _filter_sql(filters: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    clauses = []
    params: dict[str, Any] = {}
    if filters.get("resource_type"):
        clauses.append("AND resource_type = :resource_type")
        params["resource_type"] = filters["resource_type"]
    if filters.get("member_id"):
        clauses.append("AND metadata->>'member_id' = :member_id")
        params["member_id"] = filters["member_id"]
    return "\n".join(clauses), params


def _row_to_document(row: dict[str, Any]) -> RagDocument:
    return RagDocument(
        resource_type=row["resource_type"],
        resource_id=row["resource_id"],
        title=row["title"],
        body=row["body"],
        source=row["source"],
        metadata=dict(row["metadata"] or {}),
    )


def _hit_to_dict(hit: RagHit) -> dict[str, Any]:
    return {
        "resource_type": hit.document.resource_type,
        "resource_id": hit.document.resource_id,
        "title": hit.document.title,
        "excerpt": _excerpt(hit.document.body),
        "source": hit.document.source,
        "score": round(hit.score, 6),
        "rerank_score": hit.rerank_score,
        "lexical_rank": hit.lexical_rank,
        "vector_rank": hit.vector_rank,
        "metadata": hit.document.metadata,
    }


def _tokens(text_value: str) -> list[str]:
    return [token for token in re.findall(r"[a-zA-Z0-9]+", text_value.lower()) if len(token) > 1]


def _clinical_query_terms(query: str) -> set[str]:
    stopwords = {
        "find",
        "people",
        "person",
        "patients",
        "patient",
        "members",
        "member",
        "with",
        "who",
        "has",
        "have",
        "show",
        "list",
        "for",
        "and",
        "or",
        "the",
        "a",
        "an",
    }
    return {token for token in _tokens(query) if token not in stopwords}


def _fts_query(text_value: str) -> str:
    tokens = _tokens(text_value)
    return " OR ".join(tokens) if tokens else text_value


def _cosine(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right))


def _excerpt(body: str, max_length: int = 220) -> str:
    body = " ".join(body.split())
    return body if len(body) <= max_length else f"{body[: max_length - 3].rstrip()}..."


def _vector_literal(values: list[float]) -> str:
    return "[" + ",".join(str(value) for value in values) + "]"


def _json_metadata(metadata: dict[str, Any]) -> str:
    import json

    return json.dumps(metadata)
