from __future__ import annotations

import json
from functools import lru_cache
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.services.fhir import (
    FhirClient,
    from_fhir_condition,
    from_fhir_encounter,
    from_fhir_medication_request,
    from_fhir_observation,
)


def find_project_root() -> Path:
    current = Path(__file__).resolve()
    for parent in current.parents:
        if (parent / "data" / "synthetic").exists():
            return parent
        if (parent / "model_router.yaml").exists() and (parent / "app").exists():
            return parent
    return current.parents[2]


ROOT = find_project_root()


class DemoRepository:
    def __init__(self) -> None:
        self.settings = get_settings()
        self.data_dir = ROOT / self.settings.data_dir
        self.eval_dir = ROOT / "data" / "evals"
        self.fhir_client = FhirClient()

    def _read_json(self, file_name: str) -> list[dict[str, Any]]:
        path = self.data_dir / file_name
        if not path.exists():
            return []
        return json.loads(path.read_text(encoding="utf-8"))

    def members(self) -> list[dict[str, Any]]:
        return self._read_json("members.json")

    def member(self, member_id: str) -> dict[str, Any] | None:
        return next((row for row in self.members() if row["member_id"] == member_id), None)

    def claims(self) -> list[dict[str, Any]]:
        return self._read_json("claims.json")

    def claim(self, claim_id: str) -> dict[str, Any] | None:
        return next((row for row in self.claims() if row["claim_id"] == claim_id), None)

    def claim_lines(self, claim_id: str | None = None) -> list[dict[str, Any]]:
        rows = self._read_json("claim_line_items.json")
        return [row for row in rows if row["claim_id"] == claim_id] if claim_id else rows

    def policies(self) -> list[dict[str, Any]]:
        return self._read_json("policy_documents.json")

    def care_gaps(self, member_id: str | None = None) -> list[dict[str, Any]]:
        rows = self._read_json("care_gaps.json")
        return [row for row in rows if row["member_id"] == member_id] if member_id else rows

    def condition_fixtures(self, member_id: str | None = None) -> list[dict[str, Any]]:
        rows = self._read_json("conditions.json")
        return [row for row in rows if row["member_id"] == member_id] if member_id else rows

    def observation_fixtures(self, member_id: str | None = None) -> list[dict[str, Any]]:
        rows = self._read_json("observations.json")
        return [row for row in rows if row["member_id"] == member_id] if member_id else rows

    def encounter_fixtures(self, member_id: str | None = None) -> list[dict[str, Any]]:
        rows = self._read_json("encounters.json")
        return [row for row in rows if row["member_id"] == member_id] if member_id else rows

    def medication_fixtures(self, member_id: str | None = None) -> list[dict[str, Any]]:
        rows = self._read_json("medication_requests.json")
        return [row for row in rows if row["member_id"] == member_id] if member_id else rows

    def conditions(self, member_id: str | None = None) -> list[dict[str, Any]]:
        rows = self._fhir_rows("Condition", from_fhir_condition)
        if not rows:
            return self.condition_fixtures(member_id)
        return [row for row in rows if row["member_id"] == member_id] if member_id else rows

    def observations(self, member_id: str | None = None) -> list[dict[str, Any]]:
        rows = self._fhir_rows("Observation", from_fhir_observation)
        if not rows:
            return self.observation_fixtures(member_id)
        return [row for row in rows if row["member_id"] == member_id] if member_id else rows

    def encounters(self, member_id: str | None = None) -> list[dict[str, Any]]:
        rows = self._fhir_rows("Encounter", from_fhir_encounter)
        if not rows:
            return self.encounter_fixtures(member_id)
        return [row for row in rows if row["member_id"] == member_id] if member_id else rows

    def medications(self, member_id: str | None = None) -> list[dict[str, Any]]:
        rows = self._fhir_rows("MedicationRequest", from_fhir_medication_request)
        if not rows:
            return self.medication_fixtures(member_id)
        return [row for row in rows if row["member_id"] == member_id] if member_id else rows

    def fhir_fixture_resources(self, resource_type: str) -> list[dict[str, Any]]:
        mapping = {
            "Patient": "fhir_patients.json",
            "Condition": "conditions.json",
            "Observation": "observations.json",
            "Encounter": "encounters.json",
            "MedicationRequest": "medication_requests.json",
        }
        return self._read_json(mapping.get(resource_type, "missing.json"))

    def fhir_resources(self, resource_type: str) -> list[dict[str, Any]]:
        if self.settings.use_hapi_fhir:
            try:
                rows = self.fhir_client.search(resource_type)
                if rows:
                    return rows
            except Exception:
                pass
        return self.fhir_fixture_resources(resource_type)

    def fhir_resource(self, resource_type: str, resource_id: str) -> dict[str, Any] | None:
        return next((row for row in self.fhir_resources(resource_type) if row["id"] == resource_id), None)

    def _fhir_rows(self, resource_type: str, convert: Any) -> list[dict[str, Any]]:
        if not self.settings.use_hapi_fhir:
            return []
        try:
            return [convert(resource) for resource in self.fhir_client.search(resource_type)]
        except Exception:
            return []

    def timeline(self, member_id: str) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        for condition in self.conditions(member_id):
            events.append(
                {
                    "id": condition["id"],
                    "type": "Condition",
                    "date": condition["recordedDate"],
                    "title": condition["display"],
                    "resource": condition,
                }
            )
        for observation in self.observations(member_id):
            events.append(
                {
                    "id": observation["id"],
                    "type": "Observation",
                    "date": observation["effectiveDateTime"],
                    "title": f"{observation['display']}: {observation['value']}{observation['unit']}",
                    "resource": observation,
                }
            )
        for encounter in self.encounters(member_id):
            events.append(
                {
                    "id": encounter["id"],
                    "type": "Encounter",
                    "date": encounter["period_start"],
                    "title": encounter["type"],
                    "resource": encounter,
                }
            )
        for medication in self.medications(member_id):
            events.append(
                {
                    "id": medication["id"],
                    "type": "MedicationRequest",
                    "date": medication["authoredOn"],
                    "title": medication["medication"],
                    "resource": medication,
                }
            )
        for claim in [row for row in self.claims() if row["member_id"] == member_id]:
            events.append(
                {
                    "id": claim["claim_id"],
                    "type": "Claim",
                    "date": claim["service_date"],
                    "title": f"{claim['procedure']} - {claim['status']}",
                    "resource": claim,
                }
            )
        for gap in self.care_gaps(member_id):
            events.append(
                {
                    "id": gap["id"],
                    "type": "Care Gap",
                    "date": gap["due_date"],
                    "title": gap["reason"],
                    "resource": gap,
                }
            )
        member = self.member(member_id)
        if member:
            events.append(
                {
                    "id": f"risk-{member_id}",
                    "type": "Risk Score",
                    "date": "2026-06-26",
                    "title": f"Care-gap risk score {member['risk_score']}",
                    "resource": {"member_id": member_id, "risk_score": member["risk_score"]},
                }
            )
        return sorted(events, key=lambda row: row["date"], reverse=True)

    def eval_questions(self) -> list[dict[str, Any]]:
        path = self.eval_dir / "questions.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else []


@lru_cache
def get_repo() -> DemoRepository:
    return DemoRepository()
