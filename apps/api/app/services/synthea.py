from __future__ import annotations

import json
import shutil
import subprocess
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.config import get_settings
from app.services.fhir import FHIR_TYPES, FhirClient
from app.services.repository import ROOT


SYNTHEA_SOURCE = "synthea"
CUSTOM_SOURCE = "custom_demo"
HAPI_EXISTING_SOURCE = "hapi_existing"
STATUS_FILE = ROOT / "data" / "synthea" / "import_status.json"


def synthea_dir() -> Path:
    return ROOT / get_settings().synthea_dir


def synthea_status(client: FhirClient | None = None) -> dict[str, Any]:
    client = client or FhirClient()
    bundles = _bundle_paths()
    bundle_counts = _count_bundle_resources(bundles)
    hapi_available = client.is_available()
    hapi_counts = client.counts() if hapi_available else {resource_type: 0 for resource_type in FHIR_TYPES}
    import_status = _read_import_status()
    active_source = CUSTOM_SOURCE
    if import_status.get("source") == SYNTHEA_SOURCE and sum(hapi_counts.values()) > 0:
        active_source = SYNTHEA_SOURCE
    elif sum(hapi_counts.values()) > 0:
        active_source = HAPI_EXISTING_SOURCE

    return {
        "available": bool(bundles),
        "bundle_count": len(bundles),
        "bundle_dir": str(synthea_dir()),
        "bundle_resource_counts": dict(bundle_counts),
        "hapi_available": hapi_available,
        "hapi_counts": hapi_counts,
        "last_import": import_status,
        "active_clinical_data_source": active_source,
        "generation_supported": _generation_supported(),
    }


def generate_synthea(patient_count: int | None = None) -> dict[str, Any]:
    script = ROOT / "scripts" / "generate_synthea.py"
    if not script.exists():
        return {"status": "unsupported", "reason": "scripts/generate_synthea.py is missing"}
    supported = _generation_supported()
    if not all(supported.values()):
        return {"status": "unsupported", "reason": "Synthea generation requires git and Java in this runtime", "generation_supported": supported}

    count = patient_count or get_settings().synthea_patient_count
    result = subprocess.run(
        [sys.executable, str(script), "--patients", str(count), "--output", str(synthea_dir())],
        cwd=ROOT,
        text=True,
        capture_output=True,
        timeout=900,
        check=False,
    )
    return {
        "status": "success" if result.returncode == 0 else "failed",
        "exit_code": result.returncode,
        "stdout": result.stdout[-4000:],
        "stderr": result.stderr[-4000:],
        "synthea": synthea_status(),
    }


def import_synthea_bundles(client: FhirClient | None = None) -> dict[str, Any]:
    client = client or FhirClient()
    bundles = _bundle_paths()
    supported_types = {*FHIR_TYPES, "Medication"}
    summary: dict[str, Any] = {"source": SYNTHEA_SOURCE, "bundles": len(bundles), "loaded": {}, "skipped": {}, "transactions": [], "errors": []}
    loaded = Counter()
    skipped = Counter()

    for bundle_path in bundles:
        try:
            bundle = json.loads(bundle_path.read_text(encoding="utf-8"))
            resources = _resources_from_bundle(bundle)
            reference_map = _reference_map_from_bundle(bundle)
            if bundle.get("resourceType") == "Bundle" and not resources:
                try:
                    response = client.transaction(bundle)
                    bundle_counts = _resource_counts_from_bundle(bundle)
                    loaded.update(bundle_counts)
                    summary["transactions"].append(
                        {
                            "bundle": str(bundle_path),
                            "resources": sum(bundle_counts.values()),
                            "response_type": response.get("type"),
                            "responses": len(response.get("entry", [])),
                        }
                    )
                except Exception as exc:
                    summary["errors"].append({"bundle": str(bundle_path), "error": str(exc)})
                continue

            for resource in _sort_resources_for_import(resources):
                resource_type = resource.get("resourceType")
                if not resource_type:
                    continue
                if resource_type not in supported_types:
                    skipped[resource_type] += 1
                    continue
                try:
                    resource = _rewrite_references(resource, reference_map)
                    if resource.get("id"):
                        client.put(resource)
                    else:
                        client.create(resource)
                    loaded[resource_type] += 1
                except Exception as exc:
                    summary["errors"].append({"bundle": str(bundle_path), "resource_type": resource_type, "id": resource.get("id"), "error": str(exc)})
        except Exception as exc:
            summary["errors"].append({"bundle": str(bundle_path), "error": str(exc)})

    summary["loaded"] = dict(loaded)
    summary["skipped"] = dict(skipped)
    summary["counts"] = client.counts()
    summary["imported_at"] = datetime.now(timezone.utc).isoformat()
    _write_import_status(summary)
    return summary


def _bundle_paths() -> list[Path]:
    path = synthea_dir()
    if not path.exists():
        return []
    return sorted(file for file in path.glob("*.json") if file.is_file())


def _resources_from_bundle(bundle: dict[str, Any]) -> list[dict[str, Any]]:
    if bundle.get("resourceType") != "Bundle":
        return [bundle] if bundle.get("resourceType") else []
    return [entry["resource"] for entry in bundle.get("entry", []) if entry.get("resource")]


def _resource_counts_from_bundle(bundle: dict[str, Any]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for resource in _resources_from_bundle(bundle):
        resource_type = resource.get("resourceType")
        if resource_type:
            counts[resource_type] += 1
    return counts


def _reference_map_from_bundle(bundle: dict[str, Any]) -> dict[str, str]:
    if bundle.get("resourceType") != "Bundle":
        return {}
    mapping: dict[str, str] = {}
    for entry in bundle.get("entry", []):
        resource = entry.get("resource") or {}
        resource_type = resource.get("resourceType")
        resource_id = resource.get("id")
        full_url = entry.get("fullUrl")
        if resource_type and resource_id and full_url:
            mapping[full_url] = f"{resource_type}/{resource_id}"
    return mapping


def _rewrite_references(value: Any, reference_map: dict[str, str]) -> Any:
    if not reference_map:
        return value
    if isinstance(value, list):
        return [_rewrite_references(item, reference_map) for item in value]
    if isinstance(value, dict):
        rewritten = {key: _rewrite_references(item, reference_map) for key, item in value.items()}
        reference = rewritten.get("reference")
        if isinstance(reference, str) and reference in reference_map:
            rewritten["reference"] = reference_map[reference]
        return rewritten
    return value


def _sort_resources_for_import(resources: list[dict[str, Any]]) -> list[dict[str, Any]]:
    priority = {
        "Patient": 0,
        "Organization": 1,
        "Location": 1,
        "Practitioner": 1,
        "Medication": 1,
        "Encounter": 2,
        "Condition": 3,
        "MedicationRequest": 3,
        "Observation": 4,
    }
    return sorted(resources, key=lambda resource: priority.get(resource.get("resourceType", ""), 9))


def _count_bundle_resources(paths: list[Path]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for path in paths:
        try:
            bundle = json.loads(path.read_text(encoding="utf-8"))
            counts.update(_resource_counts_from_bundle(bundle))
        except Exception:
            counts["unreadable"] += 1
    return counts


def _generation_supported() -> dict[str, bool]:
    return {
        "git": bool(shutil.which("git")),
        "java": bool(shutil.which("java")),
    }


def _read_import_status() -> dict[str, Any]:
    if not STATUS_FILE.exists():
        return {}
    try:
        return json.loads(STATUS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def _write_import_status(summary: dict[str, Any]) -> None:
    STATUS_FILE.parent.mkdir(parents=True, exist_ok=True)
    STATUS_FILE.write_text(json.dumps(summary, indent=2), encoding="utf-8")
