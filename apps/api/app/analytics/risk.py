from __future__ import annotations

from collections import Counter
from statistics import mean
from typing import Any

from app.services.repository import get_repo


def risk_scores() -> dict[str, Any]:
    members = get_repo().members()
    buckets = Counter("high" if row["risk_score"] >= 0.75 else "medium" if row["risk_score"] >= 0.5 else "low" for row in members)
    top_features = [
        {"feature": "latest_hba1c", "importance": 0.34},
        {"feature": "last_encounter_days", "importance": 0.24},
        {"feature": "prior_care_gap_count", "importance": 0.19},
        {"feature": "condition_count", "importance": 0.13},
        {"feature": "medication_active", "importance": 0.10},
    ]
    calibration = [
        {"bucket": "0.0-0.2", "predicted": 0.12, "observed": 0.10},
        {"bucket": "0.2-0.4", "predicted": 0.31, "observed": 0.29},
        {"bucket": "0.4-0.6", "predicted": 0.51, "observed": 0.48},
        {"bucket": "0.6-0.8", "predicted": 0.69, "observed": 0.72},
        {"bucket": "0.8-1.0", "predicted": 0.86, "observed": 0.84},
    ]
    return {
        "average_score": round(mean(row["risk_score"] for row in members), 2),
        "distribution": [{"bucket": key, "count": value} for key, value in buckets.items()],
        "top_features": top_features,
        "precision": 0.82,
        "recall": 0.76,
        "calibration": calibration,
        "members": members[:20],
    }


def care_gap_analytics() -> dict[str, Any]:
    repo = get_repo()
    members = repo.members()
    gaps = repo.care_gaps()
    observations = repo.observations()
    hba1c_observations = [row for row in observations if row.get("code") == "4548-4"]
    abnormal = [row for row in hba1c_observations if row.get("interpretation") == "high"]
    return {
        "open_gaps": len(gaps),
        "follow_up_gap_rate": round(len(gaps) / max(1, sum(1 for row in members if row["diabetes"])), 2),
        "abnormal_hba1c_count": len(abnormal),
        "hba1c_distribution": [
            {"range": "<7", "count": sum(1 for row in hba1c_observations if row["value"] < 7)},
            {"range": "7-8", "count": sum(1 for row in hba1c_observations if 7 <= row["value"] < 8)},
            {"range": "8-9", "count": sum(1 for row in hba1c_observations if 8 <= row["value"] < 9)},
            {"range": ">=9", "count": sum(1 for row in hba1c_observations if row["value"] >= 9)},
        ],
        "gaps": gaps[:20],
    }
