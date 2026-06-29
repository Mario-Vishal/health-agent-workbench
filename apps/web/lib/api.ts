import type { AgentResponse, AgentSettings } from "@healthagent/shared";

export const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    ...init,
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { detail?: unknown };
      detail = formatErrorDetail(payload.detail);
    } catch {
      detail = response.statusText;
    }
    throw new Error(detail ? `${response.status} ${response.statusText}: ${detail}` : `${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

function formatErrorDetail(detail: unknown): string {
  if (!detail) {
    return "";
  }
  if (typeof detail === "string") {
    return detail;
  }
  if (typeof detail === "object") {
    const record = detail as Record<string, unknown>;
    const reason = typeof record.reason === "string" ? record.reason : "";
    const stderr = typeof record.stderr === "string" ? record.stderr.trim().split("\n").slice(-4).join(" ") : "";
    const status = typeof record.status === "string" ? record.status : "";
    return [status, reason, stderr].filter(Boolean).join(" - ") || JSON.stringify(detail);
  }
  return String(detail);
}

export type Metrics = {
  synthetic_members: number;
  fhir_resources: number;
  claims_loaded: number;
  eval_questions: number;
  grounding_score: number;
  hallucination_rate: number;
  diabetes_members: number;
  viral_fever_members?: number;
  respiratory_members?: number;
  open_care_gaps: number;
  average_abnormal_hba1c: number;
};

export type Member = {
  member_id: string;
  name: string;
  age: number;
  sex: string;
  plan: string;
  primary_clinic: string;
  risk_score: number;
  latest_hba1c: number;
  latest_temperature?: number;
  oxygen_saturation?: number;
  last_encounter_days: number;
  clinical_programs?: string[];
  diabetes: boolean;
  hypertension: boolean;
  viral_fever?: boolean;
  asthma?: boolean;
  copd?: boolean;
  medication_adherence_gap?: boolean;
  preventive_screening_due?: boolean;
  high_risk: boolean;
};

export type Claim = {
  claim_id: string;
  member_id: string;
  service_date: string;
  provider: string;
  procedure: string;
  amount: number;
  status: string;
  denial_risk: number;
  missing_documentation: string[];
  policy_ids: string[];
};

export type TimelineEvent = {
  id: string;
  type: string;
  date: string;
  title: string;
  resource: Record<string, unknown>;
};

export type RuntimeStatus = {
  app: string;
  mock_mode: boolean;
  synthetic_data_only: boolean;
  llm_provider_available: boolean;
  configured_provider: string;
  default_model: string;
  ollama_status?: {
    base_url: string;
    model: string;
    available: boolean;
    model_installed?: boolean;
    models?: string[];
    error?: string;
  } | null;
  rag_status?: {
    available: boolean;
    architecture: string;
    documents: number;
    resource_counts?: Record<string, number>;
    embedding_dim?: number;
    fusion?: string;
    reranker?: string;
    error?: string;
  };
  clinical_data_source: "synthea" | "custom_demo" | "hapi_existing";
  fhir_status?: FhirStatus;
  synthea_status?: SyntheaStatus;
};

export type FhirStatus = {
  available: boolean;
  base_url: string;
  counts: Record<string, number>;
};

export type SyntheaStatus = {
  available: boolean;
  bundle_count: number;
  bundle_dir: string;
  bundle_resource_counts: Record<string, number>;
  hapi_available: boolean;
  hapi_counts: Record<string, number>;
  last_import: Record<string, unknown>;
  active_clinical_data_source: "synthea" | "custom_demo" | "hapi_existing";
  generation_supported: Record<string, boolean>;
};

export type FhirResource = Record<string, unknown> & {
  id?: string;
  resourceType?: string;
};

export const api = {
  runtime: () => request<RuntimeStatus>("/api/settings/runtime"),
  fhirStatus: () => request<FhirStatus>("/api/fhir/status"),
  loadDemoFhir: () => request<Record<string, unknown>>("/api/fhir/load-demo", { method: "POST" }),
  fhirResources: (resourceType: string) => request<FhirResource[]>(`/api/fhir/resources/${resourceType}`),
  syntheaStatus: () => request<SyntheaStatus>("/api/synthea/status"),
  generateSynthea: () => request<Record<string, unknown>>("/api/synthea/generate", { method: "POST" }),
  importSynthea: () => request<Record<string, unknown>>("/api/synthea/import", { method: "POST" }),
  metrics: () => request<Metrics>("/api/overview/metrics"),
  members: () => request<Member[]>("/api/members"),
  memberTimeline: (memberId: string) => request<{ member: Member; events: TimelineEvent[] }>(`/api/members/${memberId}/timeline`),
  claims: () => request<Claim[]>("/api/claims"),
  claim: (claimId: string) => request<Claim & { line_items: Record<string, unknown>[] }>(`/api/claims/${claimId}`),
  reviewClaim: (claimId: string, decision: "approve" | "pend" | "deny") =>
    request(`/api/claims/${claimId}/review`, {
      method: "POST",
      body: JSON.stringify({ decision, reviewer: "demo_reviewer", rationale: `${decision} selected in demo review` }),
    }),
  agentQuery: (query: string, role: string, model: string, settings: AgentSettings) =>
    request<AgentResponse>("/api/agent/query", { method: "POST", body: JSON.stringify({ query, role, model, settings }) }),
  careGaps: () => request<Record<string, unknown>>("/api/analytics/care-gaps"),
  riskScores: () => request<Record<string, unknown>>("/api/analytics/risk-scores"),
  evals: () => request<Record<string, unknown>>("/api/evals/results"),
  runEvals: () => request<Record<string, unknown>>("/api/evals/run", { method: "POST" }),
  dataQuality: () => request<Record<string, unknown>>("/api/data-quality/report"),
  auditEvents: () => request<Record<string, unknown>[]>("/api/audit/events"),
  architecture: () => request<Record<string, unknown>>("/api/architecture/status"),
};
