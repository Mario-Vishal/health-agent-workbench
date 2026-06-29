from __future__ import annotations

import csv
import json
import random
from datetime import date, timedelta
from pathlib import Path


ROOT = Path(__file__).resolve().parents[3]
DATA_DIR = ROOT / "data" / "synthetic"
EVAL_DIR = ROOT / "data" / "evals"


FIRST_NAMES = [
    "Avery",
    "Jordan",
    "Riley",
    "Taylor",
    "Morgan",
    "Casey",
    "Quinn",
    "Jamie",
    "Skyler",
    "Reese",
]
LAST_NAMES = [
    "Patel",
    "Rivera",
    "Johnson",
    "Nguyen",
    "Thompson",
    "Garcia",
    "Kim",
    "Williams",
    "Brown",
    "Davis",
]
CLINICS = ["North Valley Clinic", "Lakeview Medical", "Cedar Primary Care", "Summit Endocrinology", "Riverside Respiratory Care"]


def write_json(name: str, rows: object) -> None:
    path = DATA_DIR / name
    path.write_text(json.dumps(rows, indent=2), encoding="utf-8")


def main() -> None:
    random.seed(26)
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    EVAL_DIR.mkdir(parents=True, exist_ok=True)

    today = date(2026, 6, 26)
    members = []
    patients = []
    conditions = []
    observations = []
    encounters = []
    medications = []
    claims = []
    claim_lines = []
    care_gaps = []

    for i in range(1, 101):
        member_id = f"M-{1000 + i}"
        patient_id = f"pat-{1000 + i}"
        age = random.randint(23, 84)
        diabetes = i <= 46 or random.random() < 0.16
        hypertension = i % 3 == 0 or random.random() < 0.18
        viral_fever = i % 11 == 0 or i in {7, 58, 83}
        asthma = i % 8 == 0 or (age < 45 and i % 13 == 0)
        copd = age >= 55 and i % 14 == 0
        preventive_screening_due = age >= 45 and i % 9 == 0
        medication_adherence_gap = (diabetes and i % 10 == 0) or (asthma and i % 6 == 0) or (copd and i % 5 == 0)
        latest_hba1c = round(random.uniform(6.2, 10.7) if diabetes else random.uniform(4.8, 5.6), 1)
        latest_temperature = round(random.uniform(100.4, 103.1), 1) if viral_fever else round(random.uniform(97.4, 99.2), 1)
        oxygen_saturation = random.randint(89, 94) if copd else random.randint(93, 96) if asthma else random.randint(96, 99)
        last_encounter_days = random.randint(20, 420)
        prior_gap_count = random.randint(0, 4 if diabetes else 2)
        claim_count = random.randint(1, 7)
        high_risk = (
            (diabetes and (latest_hba1c >= 8.0 or last_encounter_days > 180 or prior_gap_count >= 2))
            or (viral_fever and latest_temperature >= 102.0)
            or (copd and oxygen_saturation <= 92)
            or medication_adherence_gap
        )
        name = f"{FIRST_NAMES[i % len(FIRST_NAMES)]} {LAST_NAMES[i % len(LAST_NAMES)]}"
        clinical_programs = []
        if diabetes:
            clinical_programs.append("diabetes")
        if hypertension:
            clinical_programs.append("hypertension")
        if viral_fever:
            clinical_programs.append("acute viral illness")
        if asthma:
            clinical_programs.append("asthma")
        if copd:
            clinical_programs.append("copd")
        if preventive_screening_due:
            clinical_programs.append("preventive screening")

        members.append(
            {
                "member_id": member_id,
                "patient_id": patient_id,
                "name": name,
                "age": age,
                "sex": "female" if i % 2 else "male",
                "plan": "Gold HMO" if i % 4 else "Silver PPO",
                "primary_clinic": CLINICS[i % len(CLINICS)],
                "risk_score": round(min(0.96, 0.18 + latest_hba1c / 14 + prior_gap_count * 0.06 + (last_encounter_days / 900)), 2),
                "latest_hba1c": latest_hba1c,
                "latest_temperature": latest_temperature,
                "oxygen_saturation": oxygen_saturation,
                "last_encounter_days": last_encounter_days,
                "condition_count": int(diabetes) + int(hypertension) + int(viral_fever) + int(asthma) + int(copd) + random.randint(0, 2),
                "medication_active": (diabetes and i % 5 != 0) or ((asthma or copd) and not medication_adherence_gap),
                "medication_adherence_gap": medication_adherence_gap,
                "preventive_screening_due": preventive_screening_due,
                "clinical_programs": clinical_programs,
                "claim_count_12m": claim_count,
                "prior_care_gap_count": prior_gap_count,
                "diabetes": diabetes,
                "hypertension": hypertension,
                "viral_fever": viral_fever,
                "asthma": asthma,
                "copd": copd,
                "high_risk": high_risk,
            }
        )

        patients.append(
            {
                "resourceType": "Patient",
                "id": patient_id,
                "identifier": [{"system": "urn:healthagent:member", "value": member_id}],
                "name": [{"family": name.split()[1], "given": [name.split()[0]]}],
                "gender": "female" if i % 2 else "male",
                "birthDate": str(date(today.year - age, (i % 12) + 1, (i % 27) + 1)),
            }
        )

        if diabetes:
            conditions.append(
                {
                    "resourceType": "Condition",
                    "id": f"cond-dm-{member_id}",
                    "member_id": member_id,
                    "code": "E11.9",
                    "display": "Type 2 diabetes mellitus",
                    "clinicalStatus": "active",
                    "recordedDate": str(today - timedelta(days=900 + i)),
                }
            )
            observations.append(
                {
                    "resourceType": "Observation",
                    "id": f"obs-a1c-{member_id}",
                    "member_id": member_id,
                    "code": "4548-4",
                    "display": "Hemoglobin A1c/Hemoglobin.total in Blood",
                    "value": latest_hba1c,
                    "unit": "%",
                    "effectiveDateTime": str(today - timedelta(days=random.randint(15, 210))),
                    "interpretation": "high" if latest_hba1c >= 8.0 else "normal",
                }
            )
            medications.append(
                {
                    "resourceType": "MedicationRequest",
                    "id": f"med-metformin-{member_id}",
                    "member_id": member_id,
                    "medication": "Metformin 500 MG Oral Tablet",
                    "status": "active" if i % 5 != 0 else "stopped",
                    "authoredOn": str(today - timedelta(days=320)),
                }
            )
        if hypertension:
            conditions.append(
                {
                    "resourceType": "Condition",
                    "id": f"cond-htn-{member_id}",
                    "member_id": member_id,
                    "code": "I10",
                    "display": "Essential hypertension",
                    "clinicalStatus": "active",
                    "recordedDate": str(today - timedelta(days=700 + i)),
                }
            )
            observations.append(
                {
                    "resourceType": "Observation",
                    "id": f"obs-bp-{member_id}",
                    "member_id": member_id,
                    "code": "85354-9",
                    "display": "Blood pressure panel",
                    "value": random.randint(128, 168),
                    "unit": "mmHg systolic",
                    "effectiveDateTime": str(today - timedelta(days=random.randint(10, 160))),
                    "interpretation": "high" if i % 4 == 0 else "normal",
                }
            )

        if viral_fever:
            conditions.append(
                {
                    "resourceType": "Condition",
                    "id": f"cond-viral-fever-{member_id}",
                    "member_id": member_id,
                    "code": "B34.9",
                    "display": "Acute viral syndrome with fever",
                    "clinicalStatus": "active",
                    "recordedDate": str(today - timedelta(days=random.randint(2, 21))),
                }
            )
            observations.append(
                {
                    "resourceType": "Observation",
                    "id": f"obs-temp-{member_id}",
                    "member_id": member_id,
                    "code": "8310-5",
                    "display": "Body temperature",
                    "value": latest_temperature,
                    "unit": "degF",
                    "effectiveDateTime": str(today - timedelta(days=random.randint(1, 14))),
                    "interpretation": "high" if latest_temperature >= 100.4 else "normal",
                }
            )

        if asthma:
            conditions.append(
                {
                    "resourceType": "Condition",
                    "id": f"cond-asthma-{member_id}",
                    "member_id": member_id,
                    "code": "J45.909",
                    "display": "Asthma",
                    "clinicalStatus": "active",
                    "recordedDate": str(today - timedelta(days=500 + i)),
                }
            )
            medications.append(
                {
                    "resourceType": "MedicationRequest",
                    "id": f"med-albuterol-{member_id}",
                    "member_id": member_id,
                    "medication": "Albuterol inhaler",
                    "status": "active" if not medication_adherence_gap else "stopped",
                    "authoredOn": str(today - timedelta(days=180)),
                }
            )

        if copd:
            conditions.append(
                {
                    "resourceType": "Condition",
                    "id": f"cond-copd-{member_id}",
                    "member_id": member_id,
                    "code": "J44.9",
                    "display": "Chronic obstructive pulmonary disease",
                    "clinicalStatus": "active",
                    "recordedDate": str(today - timedelta(days=620 + i)),
                }
            )
            observations.append(
                {
                    "resourceType": "Observation",
                    "id": f"obs-spo2-{member_id}",
                    "member_id": member_id,
                    "code": "2708-6",
                    "display": "Oxygen saturation in Arterial blood",
                    "value": oxygen_saturation,
                    "unit": "%",
                    "effectiveDateTime": str(today - timedelta(days=random.randint(5, 90))),
                    "interpretation": "low" if oxygen_saturation <= 92 else "normal",
                }
            )

        encounters.append(
            {
                "resourceType": "Encounter",
                "id": f"enc-{member_id}",
                "member_id": member_id,
                "type": "Viral fever evaluation" if viral_fever else "Pulmonary follow-up" if asthma or copd else "Primary care follow-up",
                "status": "finished",
                "period_start": str(today - timedelta(days=random.randint(1, 14) if viral_fever else last_encounter_days)),
                "location": CLINICS[i % len(CLINICS)],
            }
        )

        if high_risk:
            if diabetes and (latest_hba1c >= 8.0 or last_encounter_days > 180 or prior_gap_count >= 2):
                care_gaps.append(
                    {
                        "id": f"gap-a1c-followup-{member_id}",
                        "member_id": member_id,
                        "type": "Diabetes follow-up",
                        "severity": "high" if latest_hba1c >= 8.5 else "medium",
                        "reason": "Abnormal HbA1c without timely follow-up",
                        "due_date": str(today - timedelta(days=20)),
                        "status": "open",
                    }
                )
            if viral_fever and latest_temperature >= 102.0:
                care_gaps.append(
                    {
                        "id": f"gap-viral-fever-followup-{member_id}",
                        "member_id": member_id,
                        "type": "Acute illness follow-up",
                        "severity": "medium",
                        "reason": "Viral fever with high temperature needs symptom follow-up",
                        "due_date": str(today + timedelta(days=2)),
                        "status": "open",
                    }
                )
            if asthma and medication_adherence_gap:
                care_gaps.append(
                    {
                        "id": f"gap-asthma-adherence-{member_id}",
                        "member_id": member_id,
                        "type": "Asthma medication adherence",
                        "severity": "medium",
                        "reason": "Controller or rescue inhaler adherence review is due",
                        "due_date": str(today - timedelta(days=5)),
                        "status": "open",
                    }
                )
            if copd and oxygen_saturation <= 92:
                care_gaps.append(
                    {
                        "id": f"gap-copd-followup-{member_id}",
                        "member_id": member_id,
                        "type": "COPD follow-up",
                        "severity": "high",
                        "reason": "Low oxygen saturation requires pulmonary follow-up",
                        "due_date": str(today - timedelta(days=3)),
                        "status": "open",
                    }
                )
            if medication_adherence_gap and diabetes:
                care_gaps.append(
                    {
                        "id": f"gap-med-adherence-{member_id}",
                        "member_id": member_id,
                        "type": "Medication adherence",
                        "severity": "medium",
                        "reason": "Medication adherence review is due",
                        "due_date": str(today - timedelta(days=7)),
                        "status": "open",
                    }
                )

        if preventive_screening_due:
            care_gaps.append(
                {
                    "id": f"gap-preventive-screening-{member_id}",
                    "member_id": member_id,
                    "type": "Preventive screening",
                    "severity": "low",
                    "reason": "Preventive screening outreach is due",
                    "due_date": str(today + timedelta(days=30)),
                    "status": "open",
                }
            )

        for j in range(1, claim_count + 1):
            claim_id = f"CLM-{1000 + len(claims) + 1}"
            procedure = (
                "GLP-1 initiation"
                if claim_id == "CLM-1008" or (diabetes and j == 2 and i % 7 == 0)
                else "Spirometry"
                if (asthma or copd) and j == 2
                else "Respiratory infection visit"
                if viral_fever and j == 1
                else "Office visit"
            )
            denial_risk = 0.84 if procedure == "GLP-1 initiation" and not (i % 4 == 0) else round(random.uniform(0.08, 0.42), 2)
            missing_docs = ["Prior authorization", "Recent HbA1c lab", "Step therapy documentation"] if denial_risk > 0.7 else []
            claims.append(
                {
                    "claim_id": claim_id,
                    "member_id": member_id,
                    "service_date": str(today - timedelta(days=random.randint(5, 180))),
                    "provider": CLINICS[(i + j) % len(CLINICS)],
                    "procedure": procedure,
                    "amount": random.randint(120, 1800),
                    "status": "pended" if denial_risk > 0.7 else "paid",
                    "denial_risk": denial_risk,
                    "missing_documentation": missing_docs,
                    "policy_ids": ["POL-PA-GLP1"] if procedure == "GLP-1 initiation" else ["POL-PULM-SPIRO"] if procedure == "Spirometry" else ["POL-PCP-ROUTINE"],
                }
            )
            claim_lines.append(
                {
                    "claim_id": claim_id,
                    "line_id": f"{claim_id}-1",
                    "code": "J3490" if procedure == "GLP-1 initiation" else "94010" if procedure == "Spirometry" else "99214",
                    "description": procedure,
                    "allowed_amount": random.randint(90, 1400),
                }
            )

    policy_documents = [
        {
            "policy_id": "POL-PA-GLP1",
            "title": "GLP-1 Prior Authorization Policy",
            "effective_date": "2026-01-01",
            "snippets": [
                {
                    "id": "POL-PA-GLP1-S1",
                    "text": "GLP-1 therapy requires prior authorization for initial approval.",
                    "requires": ["Prior authorization"],
                },
                {
                    "id": "POL-PA-GLP1-S2",
                    "text": "Documentation must include recent HbA1c and evidence of step therapy unless contraindicated.",
                    "requires": ["Recent HbA1c lab", "Step therapy documentation"],
                },
            ],
        },
        {
            "policy_id": "POL-PCP-ROUTINE",
            "title": "Routine Primary Care Claim Policy",
            "effective_date": "2026-01-01",
            "snippets": [
                {
                    "id": "POL-PCP-ROUTINE-S1",
                    "text": "Routine office visits require a valid diagnosis and rendering provider.",
                    "requires": [],
                }
            ],
        },
        {
            "policy_id": "POL-PULM-SPIRO",
            "title": "Pulmonary Function Testing Policy",
            "effective_date": "2026-01-01",
            "snippets": [
                {
                    "id": "POL-PULM-SPIRO-S1",
                    "text": "Spirometry claims require a respiratory diagnosis such as asthma or COPD and documentation of medical necessity.",
                    "requires": ["Respiratory diagnosis", "Medical necessity documentation"],
                }
            ],
        },
    ]

    prior_authorization_rules = [
        {
            "rule_id": "PA-GLP1-001",
            "policy_id": "POL-PA-GLP1",
            "trigger": "procedure == GLP-1 initiation",
            "required_documents": ["Prior authorization", "Recent HbA1c lab", "Step therapy documentation"],
        }
    ]

    eval_questions = [
        {
            "id": "eval-001",
            "query": "Find diabetic members with abnormal HbA1c and no follow-up.",
            "expected_tools": ["search_patients", "get_patient_observations", "compute_care_gaps"],
        },
        {
            "id": "eval-002",
            "query": "Why might claim CLM-1008 be denied?",
            "expected_tools": ["get_claim_details", "retrieve_policy_snippets"],
        },
        {
            "id": "eval-003",
            "query": "Show care gaps for high-risk diabetic members.",
            "expected_tools": ["build_patient_cohort", "compute_care_gaps"],
        },
        {
            "id": "eval-004",
            "query": "Summarize member M-1001's clinical and claims timeline.",
            "expected_tools": ["get_patient_timeline"],
        },
        {
            "id": "eval-005",
            "query": "Which evidence supports this answer?",
            "expected_tools": ["validate_answer_grounding", "check_citation_coverage"],
        },
        {
            "id": "eval-006",
            "query": "Find people with viral fever.",
            "expected_tools": ["search_clinical_records"],
        },
        {
            "id": "eval-007",
            "query": "Show asthma medication adherence gaps.",
            "expected_tools": ["search_clinical_records"],
        },
    ]

    write_json("members.json", members)
    write_json("fhir_patients.json", patients)
    write_json("conditions.json", conditions)
    write_json("observations.json", observations)
    write_json("encounters.json", encounters)
    write_json("medication_requests.json", medications)
    write_json("claims.json", claims)
    write_json("claim_line_items.json", claim_lines)
    write_json("policy_documents.json", policy_documents)
    write_json("prior_authorization_rules.json", prior_authorization_rules)
    write_json("care_gaps.json", care_gaps)
    (EVAL_DIR / "questions.json").write_text(json.dumps(eval_questions, indent=2), encoding="utf-8")

    with (DATA_DIR / "member_features.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "member_id",
                "age_group",
                "condition_count",
                "last_encounter_days",
                "latest_hba1c",
                "medication_active",
                "claim_count_12m",
                "prior_care_gap_count",
                "follow_up_gap",
            ],
        )
        writer.writeheader()
        for member in members:
            writer.writerow(
                {
                    "member_id": member["member_id"],
                    "age_group": "65+" if member["age"] >= 65 else "45-64" if member["age"] >= 45 else "18-44",
                    "condition_count": member["condition_count"],
                    "last_encounter_days": member["last_encounter_days"],
                    "latest_hba1c": member["latest_hba1c"],
                    "medication_active": int(member["medication_active"]),
                    "claim_count_12m": member["claim_count_12m"],
                    "prior_care_gap_count": member["prior_care_gap_count"],
                    "follow_up_gap": int(member["high_risk"]),
                }
            )

    print(f"Seeded {len(members)} members, {len(claims)} claims, {len(care_gaps)} care gaps.")


if __name__ == "__main__":
    main()
