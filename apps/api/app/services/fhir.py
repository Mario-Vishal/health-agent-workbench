from __future__ import annotations

from typing import Any

import httpx

from app.config import get_settings


FHIR_TYPES = ["Patient", "Condition", "Observation", "Encounter", "MedicationRequest"]


class FhirClient:
    def __init__(self, base_url: str | None = None, timeout: float = 8.0) -> None:
        self.base_url = (base_url or get_settings().fhir_base_url).rstrip("/")
        self.timeout = timeout

    def is_available(self) -> bool:
        try:
            response = httpx.get(f"{self.base_url}/metadata", timeout=self.timeout)
            return response.status_code < 500
        except httpx.HTTPError:
            return False

    def search(self, resource_type: str, params: dict[str, Any] | None = None) -> list[dict[str, Any]]:
        response = httpx.get(
            f"{self.base_url}/{resource_type}",
            params={"_count": 1000, **(params or {})},
            headers={"Accept": "application/fhir+json"},
            timeout=self.timeout,
        )
        response.raise_for_status()
        bundle = response.json()
        return [entry["resource"] for entry in bundle.get("entry", []) if entry.get("resource")]

    def read(self, resource_type: str, resource_id: str) -> dict[str, Any] | None:
        response = httpx.get(
            f"{self.base_url}/{resource_type}/{resource_id}",
            headers={"Accept": "application/fhir+json"},
            timeout=self.timeout,
        )
        if response.status_code == 404:
            return None
        response.raise_for_status()
        return response.json()

    def put(self, resource: dict[str, Any]) -> dict[str, Any]:
        resource_type = resource["resourceType"]
        resource_id = resource["id"]
        response = httpx.put(
            f"{self.base_url}/{resource_type}/{resource_id}",
            json=resource,
            headers={"Content-Type": "application/fhir+json", "Accept": "application/fhir+json"},
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()

    def create(self, resource: dict[str, Any]) -> dict[str, Any]:
        resource_type = resource["resourceType"]
        response = httpx.post(
            f"{self.base_url}/{resource_type}",
            json=resource,
            headers={"Content-Type": "application/fhir+json", "Accept": "application/fhir+json"},
            timeout=self.timeout,
        )
        response.raise_for_status()
        return response.json()

    def transaction(self, bundle: dict[str, Any]) -> dict[str, Any]:
        response = httpx.post(
            self.base_url,
            json=bundle,
            headers={"Content-Type": "application/fhir+json", "Accept": "application/fhir+json"},
            timeout=max(self.timeout, 180.0),
        )
        response.raise_for_status()
        return response.json()

    def counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for resource_type in FHIR_TYPES:
            try:
                counts[resource_type] = len(self.search(resource_type))
            except (httpx.HTTPError, ValueError, TypeError):
                counts[resource_type] = 0
        return counts


def member_to_patient_id(member_id: str) -> str:
    return f"pat-{member_id.split('-')[-1]}"


def patient_to_member_id(patient: dict[str, Any]) -> str | None:
    for identifier in patient.get("identifier", []):
        if identifier.get("system") == "urn:healthagent:member":
            return identifier.get("value")
    return None


def to_fhir_patient(row: dict[str, Any]) -> dict[str, Any]:
    return row


def to_fhir_condition(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "resourceType": "Condition",
        "id": row["id"],
        "clinicalStatus": {
            "coding": [
                {
                    "system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                    "code": row.get("clinicalStatus", "active"),
                }
            ]
        },
        "code": {"coding": [{"system": "http://hl7.org/fhir/sid/icd-10-cm", "code": row["code"], "display": row["display"]}], "text": row["display"]},
        "subject": {"reference": f"Patient/{member_to_patient_id(row['member_id'])}", "identifier": {"system": "urn:healthagent:member", "value": row["member_id"]}},
        "recordedDate": row["recordedDate"],
    }


def to_fhir_observation(row: dict[str, Any]) -> dict[str, Any]:
    interpretation = "H" if row.get("interpretation") == "high" else "L" if row.get("interpretation") == "low" else "N"
    return {
        "resourceType": "Observation",
        "id": row["id"],
        "status": "final",
        "category": [
            {
                "coding": [
                    {
                        "system": "http://terminology.hl7.org/CodeSystem/observation-category",
                        "code": "laboratory",
                        "display": "Laboratory",
                    }
                ]
            }
        ],
        "code": {"coding": [{"system": "http://loinc.org", "code": row["code"], "display": row["display"]}], "text": row["display"]},
        "subject": {"reference": f"Patient/{member_to_patient_id(row['member_id'])}", "identifier": {"system": "urn:healthagent:member", "value": row["member_id"]}},
        "effectiveDateTime": row["effectiveDateTime"],
        "valueQuantity": {"value": row["value"], "unit": row["unit"], "system": "http://unitsofmeasure.org", "code": row["unit"]},
        "interpretation": [{"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation", "code": interpretation}]}],
    }


def to_fhir_encounter(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "resourceType": "Encounter",
        "id": row["id"],
        "status": row.get("status", "finished"),
        "class": {"system": "http://terminology.hl7.org/CodeSystem/v3-ActCode", "code": "AMB", "display": "ambulatory"},
        "type": [{"text": row["type"]}],
        "subject": {"reference": f"Patient/{member_to_patient_id(row['member_id'])}", "identifier": {"system": "urn:healthagent:member", "value": row["member_id"]}},
        "period": {"start": row["period_start"]},
        "location": [{"location": {"display": row["location"]}}],
    }


def to_fhir_medication_request(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "resourceType": "MedicationRequest",
        "id": row["id"],
        "status": row.get("status", "active"),
        "intent": "order",
        "medicationCodeableConcept": {"text": row["medication"]},
        "subject": {"reference": f"Patient/{member_to_patient_id(row['member_id'])}", "identifier": {"system": "urn:healthagent:member", "value": row["member_id"]}},
        "authoredOn": row["authoredOn"],
    }


def from_fhir_condition(resource: dict[str, Any]) -> dict[str, Any]:
    coding = (resource.get("code", {}).get("coding") or [{}])[0]
    return {
        "resourceType": "Condition",
        "id": resource["id"],
        "member_id": _member_id_from_subject(resource),
        "code": coding.get("code", ""),
        "display": resource.get("code", {}).get("text") or coding.get("display", ""),
        "clinicalStatus": ((resource.get("clinicalStatus", {}).get("coding") or [{}])[0]).get("code", "active"),
        "recordedDate": resource.get("recordedDate", ""),
    }


def from_fhir_observation(resource: dict[str, Any]) -> dict[str, Any]:
    coding = (resource.get("code", {}).get("coding") or [{}])[0]
    interpretation_code = (((resource.get("interpretation") or [{}])[0]).get("coding") or [{}])[0].get("code")
    value = resource.get("valueQuantity", {})
    return {
        "resourceType": "Observation",
        "id": resource["id"],
        "member_id": _member_id_from_subject(resource),
        "code": coding.get("code", ""),
        "display": resource.get("code", {}).get("text") or coding.get("display", ""),
        "value": value.get("value"),
        "unit": value.get("unit", ""),
        "effectiveDateTime": resource.get("effectiveDateTime", ""),
        "interpretation": "high" if interpretation_code == "H" else "low" if interpretation_code == "L" else "normal",
    }


def from_fhir_encounter(resource: dict[str, Any]) -> dict[str, Any]:
    return {
        "resourceType": "Encounter",
        "id": resource["id"],
        "member_id": _member_id_from_subject(resource),
        "type": ((resource.get("type") or [{}])[0]).get("text", "Encounter"),
        "status": resource.get("status", ""),
        "period_start": resource.get("period", {}).get("start", ""),
        "location": (((resource.get("location") or [{}])[0]).get("location") or {}).get("display", ""),
    }


def from_fhir_medication_request(resource: dict[str, Any]) -> dict[str, Any]:
    return {
        "resourceType": "MedicationRequest",
        "id": resource["id"],
        "member_id": _member_id_from_subject(resource),
        "medication": resource.get("medicationCodeableConcept", {}).get("text", ""),
        "status": resource.get("status", ""),
        "authoredOn": resource.get("authoredOn", ""),
    }


def _member_id_from_subject(resource: dict[str, Any]) -> str:
    subject = resource.get("subject", {})
    identifier = subject.get("identifier", {})
    if identifier.get("value"):
        return identifier["value"]
    reference = subject.get("reference", "")
    return f"M-{reference.split('-')[-1]}" if reference else ""
