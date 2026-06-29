from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from app.services.repository import ROOT


def audit_path() -> Path:
    configured = os.getenv("AUDIT_PATH")
    if configured:
        return Path(configured)
    return ROOT / "data" / "synthetic" / "audit_events.jsonl"


def write_audit_event(event: dict[str, Any]) -> dict[str, Any]:
    path = audit_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    row = {
        "id": f"audit-{uuid4().hex[:10]}",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        **event,
    }
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row) + "\n")
    return row


def read_audit_events(limit: int = 100) -> list[dict[str, Any]]:
    path = audit_path()
    if not path.exists():
        return []
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return list(reversed(rows[-limit:]))
