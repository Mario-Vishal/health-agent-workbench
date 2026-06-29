export type EvidenceStatus = "supported" | "partial" | "unsupported";

export interface EvidenceCard {
  id: string;
  title: string;
  resource_type: string;
  resource_id: string;
  date: string;
  excerpt: string;
  status: EvidenceStatus;
}

export interface TraceStep {
  id: string;
  name: string;
  status: "success" | "running" | "error" | "skipped";
  latency_ms: number;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
}

export interface AgentSettings {
  temperature: number;
  max_tokens: number;
  retrieval_depth: number;
  strict_grounding: boolean;
}

export interface AgentResponse {
  run_id: string;
  answer: string;
  intent: string;
  evidence: EvidenceCard[];
  trace: TraceStep[];
  metrics: Record<string, unknown>;
  model_used: string;
  mock_mode: boolean;
}
