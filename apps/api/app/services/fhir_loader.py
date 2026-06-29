from __future__ import annotations

from typing import Any, Callable

from app.services.fhir import (
    FHIR_TYPES,
    FhirClient,
    to_fhir_condition,
    to_fhir_encounter,
    to_fhir_medication_request,
    to_fhir_observation,
    to_fhir_patient,
)
from app.services.repository import get_repo


Transformer = Callable[[dict[str, Any]], dict[str, Any]]


def load_demo_fhir(client: FhirClient | None = None) -> dict[str, Any]:
    client = client or FhirClient()
    repo = get_repo()
    groups: list[tuple[str, list[dict[str, Any]], Transformer]] = [
        ("Patient", repo.fhir_fixture_resources("Patient"), to_fhir_patient),
        ("Condition", repo.condition_fixtures(), to_fhir_condition),
        ("Observation", repo.observation_fixtures(), to_fhir_observation),
        ("Encounter", repo.encounter_fixtures(), to_fhir_encounter),
        ("MedicationRequest", repo.medication_fixtures(), to_fhir_medication_request),
    ]

    summary: dict[str, Any] = {"loaded": {}, "errors": []}
    for resource_type, rows, transform in groups:
        loaded = 0
        for row in rows:
            try:
                client.put(transform(row))
                loaded += 1
            except Exception as exc:
                summary["errors"].append({"resource_type": resource_type, "id": row.get("id"), "error": str(exc)})
        summary["loaded"][resource_type] = loaded
    summary["counts"] = client.counts()
    summary["available"] = client.is_available()
    return summary


def fhir_status(client: FhirClient | None = None) -> dict[str, Any]:
    client = client or FhirClient()
    available = client.is_available()
    return {
        "available": available,
        "base_url": client.base_url,
        "counts": client.counts() if available else {resource_type: 0 for resource_type in FHIR_TYPES},
    }
