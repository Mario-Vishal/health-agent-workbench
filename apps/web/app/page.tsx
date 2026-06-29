"use client";

import { QueryClient, QueryClientProvider, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Background, Controls, MarkerType, ReactFlow } from "@xyflow/react";
import type { Edge, Node } from "@xyflow/react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  BookOpen,
  Boxes,
  BrainCircuit,
  CalendarClock,
  ChevronRight,
  CheckCircle2,
  CircleHelp,
  ClipboardCheck,
  Database,
  FileSearch,
  FlaskConical,
  GitBranch,
  HeartPulse,
  History,
  LayoutDashboard,
  Network,
  Play,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  TableProperties,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { ElementType, ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { AgentResponse, TraceStep } from "@healthagent/shared";
import { api, type Claim, type FhirResource, type Member, type RuntimeStatus, type SyntheaStatus, type TimelineEvent } from "@/lib/api";
import { useWorkbenchStore, type Mode } from "@/lib/store";

const queryClient = new QueryClient();

const productTabs = ["Overview", "How to Use", "System Design", "Data Management", "Agent Workbench", "Member Timeline", "Claims & Policy Review", "Cohort Analytics"];
const engineeringTabs = ["Tool Trace", "Evidence & Grounding", "Evaluation Lab", "Data Quality", "Audit & Governance", "Architecture"];
const prompts = [
  "Find people with viral fever.",
  "Why might claim CLM-1008 be denied?",
  "Show asthma medication adherence gaps.",
  "Summarize member M-1001's clinical and claims timeline.",
  "Find diabetic members with abnormal HbA1c and no follow-up.",
  "Which evidence supports this answer?",
];

const tourSteps = [
  {
    title: "Start with Product Mode",
    body: "Use the left navigation to move through the product guide, data management, healthcare workflows, member timeline, claims review, and cohort analytics.",
    selector: "[data-tour='primary-nav']",
    mode: "product",
    tab: "Overview",
  },
  {
    title: "Switch to Engineering Mode",
    body: "The Product and Engineering toggle changes the app from operational workflows to trace inspection, grounding checks, evals, data quality, audit, and architecture.",
    selector: "[data-tour='mode-toggle']",
    mode: "product",
    tab: "Overview",
  },
  {
    title: "Run an Agent Query",
    body: "In Agent Workbench, pick a prompt or write your own question. The response includes the answer, evidence cards, tool trace, and audit event.",
    selector: "[data-tour='run-agent']",
    mode: "product",
    tab: "Agent Workbench",
  },
  {
    title: "Tune Model Settings",
    body: "Open Settings to change the model route, temperature, token budget, retrieval depth, and grounding strictness before running the agent.",
    selector: "[data-tour='settings-button']",
    mode: "product",
    tab: "Agent Workbench",
  },
  {
    title: "Adjust the Model Route",
    body: "The settings drawer controls which provider route is used and how much evidence and output budget the agent receives.",
    selector: "[data-tour='model-route']",
    mode: "product",
    tab: "Agent Workbench",
    openSettings: true,
  },
  {
    title: "Verify Runtime Status",
    body: "The app shows whether it is in deterministic mode or live LLM mode. Configure OpenAI or Ollama on the backend before treating model responses as live.",
    selector: "[data-tour='runtime-status']",
    mode: "product",
    tab: "Overview",
  },
  {
    title: "Manage Clinical Data",
    body: "Data Management shows the clinical data source, HAPI FHIR status, Synthea generation/import workflow, and a preview of records available to the app.",
    selector: "[data-tour='fhir-panel']",
    mode: "product",
    tab: "Data Management",
  },
] satisfies Array<{
  title: string;
  body: string;
  selector: string;
  mode: Mode;
  tab: string;
  openSettings?: boolean;
}>;

const tabIcons: Record<string, ElementType> = {
  Overview: LayoutDashboard,
  "How to Use": BookOpen,
  "System Design": Network,
  "Data Management": Database,
  "Agent Workbench": BrainCircuit,
  "Member Timeline": History,
  "Claims & Policy Review": FileSearch,
  "Cohort Analytics": Activity,
  "Tool Trace": GitBranch,
  "Evidence & Grounding": BadgeCheck,
  "Evaluation Lab": FlaskConical,
  "Data Quality": Database,
  "Audit & Governance": ShieldCheck,
  Architecture: Network,
};

const workflowCards = [
  {
    title: "Find Care Gaps",
    description: "Search across diabetes, respiratory, acute illness, medication adherence, and preventive screening gaps.",
    tab: "Agent Workbench",
    prompt: prompts[0],
    icon: Users,
    accent: "teal",
  },
  {
    title: "Review Claim",
    description: "Open a pended claim, inspect missing documentation, and compare it against policy snippets.",
    tab: "Claims & Policy Review",
    prompt: prompts[1],
    icon: ClipboardCheck,
    accent: "blue",
  },
  {
    title: "Inspect Member Timeline",
    description: "Review a member's labs, conditions, medications, encounters, claims, care gaps, and risk score.",
    tab: "Member Timeline",
    prompt: prompts[3],
    icon: CalendarClock,
    accent: "rose",
  },
];

const systemLayers = [
  {
    title: "People",
    label: "Care manager, claims reviewer, product evaluator",
    description: "Users start with normal healthcare questions instead of raw database screens.",
    icon: Users,
  },
  {
    title: "Workflow UI",
    label: "Next.js workbench",
    description: "Guides users through care gaps, claim review, member timelines, evidence, traces, and audit.",
    icon: LayoutDashboard,
  },
  {
    title: "Agent API",
    label: "FastAPI orchestration",
    description: "Classifies intent, calls deterministic tools, retrieves evidence, routes to a model, and validates grounding.",
    icon: BrainCircuit,
  },
  {
    title: "Clinical + payer data",
    label: "HL7 FHIR, claims, policy",
    description: "HAPI FHIR stores clinical resources while local fixtures cover claims, payer policy, care gaps, and evals.",
    icon: Database,
  },
  {
    title: "Governance",
    label: "Evidence, traces, audit",
    description: "Every answer is paired with supporting cards, execution steps, grounding status, and an audit record.",
    icon: ShieldCheck,
  },
];

const aiPipeline = [
  ["1", "Ask", "A user asks a clinical, claim, or timeline question in plain language."],
  ["2", "Plan", "The backend classifies the intent and chooses structured tools plus retrieval."],
  ["3", "Retrieve", "PostgreSQL full-text search and pgvector return evidence candidates, then RRF fuses rankings."],
  ["4", "Compose", "Ollama or OpenAI writes an answer from the evidence pack; deterministic fallback stays available."],
  ["5", "Validate", "The grounding checker marks the result supported, partial, or unsupported."],
  ["6", "Audit", "The run writes tool calls, evidence IDs, status, role, and timestamp for review."],
];

const componentGuide = [
  ["Next.js UI", "The product surface: onboarding, workflows, settings, tooltips, charts, diagrams, and evidence cards."],
  ["FastAPI", "The application backend: API contracts, agent orchestration, data access, eval routes, and status endpoints."],
  ["HAPI FHIR", "The clinical system of record for synthetic HL7 FHIR R4 resources such as Patient and Observation."],
  ["Synthea", "Optional synthetic patient generator that emits realistic HL7 FHIR bundles for local import."],
  ["PostgreSQL + pgvector", "The retrieval and application database profile for keyword search, vector search, and RAG evidence packs."],
  ["Redis + worker", "The background-job lane for generation, import, indexing, and production-style async work."],
  ["Ollama/OpenAI", "The LLM provider layer. Local Ollama keeps demos private; OpenAI can be enabled through environment variables."],
  ["Audit + evals", "Governance surfaces for trace inspection, grounding checks, query logs, and regression-style evaluation."],
];

const fhirPreviewTypes = ["Patient", "Condition", "Observation"] as const;

const pageGuides: Record<string, { purpose: string; start: string; output: string }> = {
  Overview: {
    purpose: "Command center for choosing the main healthcare workflow.",
    start: "Start here, then choose care gaps, claim review, member timeline, or data management.",
    output: "Workflow navigation, high-level status, and runtime/data-source summary.",
  },
  "How to Use": {
    purpose: "In-app instruction document for how to use the workbench.",
    start: "Read the quick-start path, then follow the page guide for the workflow you want to try.",
    output: "Step-by-step demo path, page explanations, and common questions.",
  },
  "System Design": {
    purpose: "Plain-English explanation of what the system is and how the pieces fit together.",
    start: "Use this before the technical tabs if you need the story of the product.",
    output: "Architecture map, AI pipeline, data source explanation, and component guide.",
  },
  "Data Management": {
    purpose: "Production-style clinical data operations console.",
    start: "Use the Synthea ingestion progress workflow: confirm HAPI FHIR, generate patient files, load them into FHIR, then validate the app preview.",
    output: "Step status, disk counts, loaded resource counts, ingestion results, and FHIR record previews.",
  },
  "Agent Workbench": {
    purpose: "Run grounded AI questions over synthetic clinical, claims, policy, and evidence data.",
    start: "Pick a sample prompt or type a question, then review the answer, evidence cards, and selected tools.",
    output: "AI answer, grounding status, evidence cards, trace steps, and audit event.",
  },
  "Member Timeline": {
    purpose: "Inspect one synthetic member across clinical and payer events.",
    start: "Select a member ID, then scan conditions, labs, encounters, medications, claims, and care gaps.",
    output: "Chronological member context and event details.",
  },
  "Claims & Policy Review": {
    purpose: "Review a claim against synthetic payer policy and missing-documentation rules.",
    start: "Choose a claim, inspect the denial risk and policy context, then record a review action.",
    output: "Claim details, line items, policy rationale, review decision, and audit entry.",
  },
  "Cohort Analytics": {
    purpose: "Population-level analytics for care-gap and risk-scoring workflows.",
    start: "Review open care gaps, follow-up gap rate, HbA1c distribution, risk scores, and model features.",
    output: "Charts for population health, risk distribution, feature importance, and calibration.",
  },
  "Tool Trace": {
    purpose: "Engineering view of how the agent workflow executes.",
    start: "Follow the graph nodes, then open node payloads to inspect inputs and outputs.",
    output: "Agent execution path and structured tool payloads.",
  },
  "Evidence & Grounding": {
    purpose: "Check whether claims in an AI answer are supported by retrieved evidence.",
    start: "Read each claim, evidence reference, and support status.",
    output: "Grounding table showing claim-by-claim support.",
  },
  "Evaluation Lab": {
    purpose: "Run regression-style checks for agent quality.",
    start: "Click Run eval, then review grounding, tool accuracy, hallucination estimate, citation coverage, and latency.",
    output: "Evaluation metrics and model comparison.",
  },
  "Data Quality": {
    purpose: "Inspect synthetic-data validation and completeness checks.",
    start: "Review validation rows and the FHIR completeness status.",
    output: "Data-quality checks, counts, and completeness signal.",
  },
  "Audit & Governance": {
    purpose: "Review audit events and safety boundaries for agent runs.",
    start: "Run an agent query, then return here to confirm it created an audit record.",
    output: "Timestamped query logs, tools called, resources accessed, grounding status, and result status.",
  },
  Architecture: {
    purpose: "Engineering system-design view for runtime services, RAG, and data boundaries.",
    start: "Review service cards, runtime flow, agent/RAG flow, component responsibilities, and data boundary.",
    output: "System architecture overview and links to operational Data Management.",
  },
};

const quickStartSteps = [
  ["1", "Open How to Use", "Use this page as the instruction document for the demo."],
  ["2", "Check Data Management", "Run or inspect the Synthea-to-HAPI FHIR ingestion workflow and see which source is active."],
  ["3", "Run an agent query", "Use Agent Workbench with the care-gap prompt and inspect evidence cards."],
  ["4", "Inspect one member", "Open Member Timeline to see clinical and payer context together."],
  ["5", "Review one claim", "Open Claims & Policy Review and inspect policy/missing-documentation logic."],
  ["6", "Verify governance", "Open Audit & Governance, Evidence & Grounding, and Tool Trace to see controls."],
];

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

function clinicalSourceLabel(source?: RuntimeStatus["clinical_data_source"]) {
  if (source === "synthea") {
    return "Synthea-backed HL7 FHIR";
  }
  if (source === "hapi_existing") {
    return "HAPI FHIR clinical data";
  }
  return "Custom synthetic HL7 FHIR";
}

function fhirResourceTitle(resource: FhirResource) {
  if (resource.resourceType === "Patient") {
    const names = resource.name as Array<{ given?: string[]; family?: string }> | undefined;
    const name = names?.[0];
    return [name?.given?.join(" "), name?.family].filter(Boolean).join(" ") || resource.id || "Patient";
  }
  if (resource.resourceType === "Condition" || resource.resourceType === "Observation") {
    const code = resource.code as { text?: string; coding?: Array<{ display?: string; code?: string }> } | undefined;
    return code?.text || code?.coding?.[0]?.display || code?.coding?.[0]?.code || resource.id || resource.resourceType;
  }
  return resource.id || resource.resourceType || "FHIR resource";
}

function fhirResourceSubtitle(resource: FhirResource) {
  if (resource.resourceType === "Patient") {
    return String(resource.gender ?? "unknown");
  }
  if (resource.resourceType === "Condition") {
    return String(resource.recordedDate ?? "no recorded date");
  }
  if (resource.resourceType === "Observation") {
    const value = resource.valueQuantity as { value?: number | string; unit?: string } | undefined;
    return [value?.value, value?.unit].filter((item) => item !== undefined && item !== "").join(" ") || String(resource.effectiveDateTime ?? "no value");
  }
  return String(resource.resourceType ?? "");
}

function mutationSummary(data: Record<string, unknown> | undefined) {
  if (!data) {
    return "";
  }
  const loaded = data.loaded as Record<string, number> | undefined;
  if (loaded) {
    return Object.entries(loaded)
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");
  }
  if (data.status) {
    return String(data.status);
  }
  return "Completed";
}

function Shell() {
  const { mode, activeTab, setMode, setActiveTab } = useWorkbenchStore();
  const tabs = mode === "product" ? productTabs : engineeringTabs;
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const { data: runtime } = useQuery({ queryKey: ["runtime"], queryFn: api.runtime });
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-72 shrink-0 border-r border-slate-200 bg-white px-4 py-5 lg:block">
        <div className="mb-6 flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-700 text-white">
            <HeartPulse size={21} />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-950">HealthAgent Workbench</div>
            <div className="text-xs text-slate-500">{runtime?.mock_mode ? "Deterministic mode" : "Live LLM mode"}</div>
          </div>
        </div>

        <ModeToggle mode={mode} onChange={setMode} />

        <nav className="mt-6 space-y-1" data-tour="primary-nav">
          {tabs.map((tab) => {
            const Icon = tabIcons[tab];
            return (
              <button key={tab} className="sidebar-button text-left text-sm" data-active={activeTab === tab} onClick={() => setActiveTab(tab)}>
                <Icon size={17} />
                <span>{tab}</span>
              </button>
            );
          })}
        </nav>

        <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
          Demo uses synthetic data only. No real PHI. Not for clinical decision-making.
        </div>
      </aside>

      <main className="min-w-0 flex-1">
        <TopBar mode={mode} setMode={setMode} tabs={tabs} runtime={runtime} onOpenSettings={openSettings} onStartTour={() => setTourOpen(true)} />
        <div className="mx-auto max-w-[1500px] px-4 py-5 sm:px-6 lg:px-8">
          <AnimatePresence mode="wait">
            <motion.div
              key={`${mode}-${activeTab}`}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18 }}
            >
              <ActiveTab tab={activeTab} />
            </motion.div>
          </AnimatePresence>
        </div>
      </main>
      <SettingsDrawer open={settingsOpen} onClose={closeSettings} runtime={runtime} />
      <GuidedTour open={tourOpen} onClose={() => setTourOpen(false)} onOpenSettings={openSettings} onCloseSettings={closeSettings} />
    </div>
  );
}

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (mode: Mode) => void }) {
  return (
    <div className="grid grid-cols-2 rounded-lg border border-slate-200 bg-slate-50 p-1" data-tour="mode-toggle">
      {(["product", "engineering"] as Mode[]).map((item) => (
        <button
          key={item}
          className={cn(
            "rounded-md px-3 py-2 text-xs font-medium transition",
            mode === item ? "bg-white text-teal-800 shadow-sm" : "text-slate-500 hover:text-slate-900",
          )}
          onClick={() => onChange(item)}
        >
          {item === "product" ? "Product" : "Engineering"}
        </button>
      ))}
    </div>
  );
}

function TopBar({
  mode,
  setMode,
  tabs,
  runtime,
  onOpenSettings,
  onStartTour,
}: {
  mode: Mode;
  setMode: (mode: Mode) => void;
  tabs: string[];
  runtime?: RuntimeStatus;
  onOpenSettings: () => void;
  onStartTour: () => void;
}) {
  const { activeTab, setActiveTab } = useWorkbenchStore();
  const guide = pageGuides[activeTab];
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur sm:px-6 lg:px-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-slate-950">{activeTab}</h1>
          <p className="text-xs text-slate-500">{guide?.purpose ?? "Grounded agent workflows over synthetic HL7 FHIR R4 and claims data"}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <span
            className={cn("hidden rounded-lg px-3 py-2 text-xs font-medium sm:inline-flex", runtime?.mock_mode ? "bg-amber-50 text-amber-900" : "bg-teal-50 text-teal-800")}
            data-tour="runtime-status"
          >
            {runtime?.mock_mode ? "Deterministic mode" : "Live LLM mode"}
          </span>
          <div className="block w-48 max-w-full sm:w-56 lg:hidden">
            <ModeToggle mode={mode} onChange={setMode} />
          </div>
          <button className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50" title="Start guided tour" onClick={onStartTour}>
            <CircleHelp size={18} />
          </button>
          <button className="rounded-lg border border-slate-200 p-2 text-slate-700 hover:bg-slate-50" title="Open model settings" onClick={onOpenSettings} data-tour="settings-button">
            <Settings size={18} />
          </button>
          <a className="rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50" href="http://localhost:8000/docs" target="_blank">
            API Docs
          </a>
        </div>
      </div>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-1 lg:hidden">
        {tabs.map((tab) => (
          <button
            key={tab}
            className={cn(
              "shrink-0 rounded-lg border px-3 py-2 text-xs font-medium",
              activeTab === tab ? "border-teal-300 bg-teal-50 text-teal-800" : "border-slate-200 bg-white text-slate-600",
            )}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      {guide ? (
        <div className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600 md:grid-cols-2">
          <div>
            <span className="font-semibold text-slate-950">Start: </span>
            {guide.start}
          </div>
          <div>
            <span className="font-semibold text-slate-950">Output: </span>
            {guide.output}
          </div>
        </div>
      ) : null}
    </header>
  );
}

function SettingsDrawer({ open, onClose, runtime }: { open: boolean; onClose: () => void; runtime?: RuntimeStatus }) {
  const { agentModel, setAgentModel, agentSettings, setAgentSettings } = useWorkbenchStore();
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-40">
      <button className="absolute inset-0 cursor-default bg-slate-950/30" aria-label="Close settings" onClick={onClose} />
      <motion.aside
        className="absolute right-0 top-0 h-full w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl"
        initial={{ x: 420 }}
        animate={{ x: 0 }}
        exit={{ x: 420 }}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal size={19} />
            <div>
              <div className="text-sm font-semibold text-slate-950">Agent Settings</div>
              <div className="text-xs text-slate-500">{runtime?.mock_mode ? "Deterministic fallback is active" : `${runtime?.configured_provider ?? "LLM"} provider is configured`}</div>
            </div>
          </div>
          <button className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50" title="Close settings" onClick={onClose}>
            <X size={17} />
          </button>
        </div>

        <div className="mt-5 space-y-5">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="text-xs font-medium text-slate-500">Clinical data source</div>
            <div className="mt-1 text-sm font-semibold text-slate-950">{clinicalSourceLabel(runtime?.clinical_data_source)}</div>
            <div className="mt-2 text-xs leading-5 text-slate-600">
              Synthea bundles can be generated/imported into HAPI FHIR; claims and policy rules remain custom demo fixtures.
            </div>
          </div>

          {runtime?.ollama_status ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-500">Local LLM</div>
              <div className="mt-1 text-sm font-semibold text-slate-950">{runtime.ollama_status.model}</div>
              <div className="mt-2 text-xs leading-5 text-slate-600">
                {runtime.ollama_status.available
                  ? runtime.ollama_status.model_installed
                    ? `Connected to Ollama at ${runtime.ollama_status.base_url}.`
                    : `Ollama is reachable, but this model is not installed yet.`
                  : `Ollama is not reachable at ${runtime.ollama_status.base_url}.`}
              </div>
            </div>
          ) : null}

          {runtime?.rag_status ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs font-medium text-slate-500">Retrieval architecture</div>
              <div className="mt-1 text-sm font-semibold text-slate-950">PostgreSQL FTS + pgvector</div>
              <div className="mt-2 text-xs leading-5 text-slate-600">
                {runtime.rag_status.documents} indexed evidence documents with {runtime.rag_status.fusion ?? "RRF fusion"} and {runtime.rag_status.reranker ?? "reranking"}.
              </div>
            </div>
          ) : null}

          <label className="block text-xs font-medium text-slate-500" data-tour="model-route">
            Model route
            <select className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800" value={agentModel} onChange={(event) => setAgentModel(event.target.value)}>
              <option value="default_agent">default_agent</option>
              <option value="advanced_agent">advanced_agent</option>
              <option value="local_fallback">local_fallback</option>
            </select>
          </label>

          <SettingsRange
            label="Temperature"
            value={agentSettings.temperature}
            min={0}
            max={1}
            step={0.1}
            display={agentSettings.temperature.toFixed(1)}
            onChange={(value) => setAgentSettings({ temperature: value })}
          />
          <SettingsRange
            label="Max output tokens"
            value={agentSettings.max_tokens}
            min={200}
            max={2000}
            step={50}
            display={`${agentSettings.max_tokens}`}
            onChange={(value) => setAgentSettings({ max_tokens: Math.round(value) })}
          />
          <SettingsRange
            label="Retrieval depth"
            value={agentSettings.retrieval_depth}
            min={1}
            max={10}
            step={1}
            display={`${agentSettings.retrieval_depth} evidence cards`}
            onChange={(value) => setAgentSettings({ retrieval_depth: Math.round(value) })}
          />

          <label className="flex items-start gap-3 rounded-lg border border-slate-200 p-3 text-sm">
            <input className="mt-1" type="checkbox" checked={agentSettings.strict_grounding} onChange={(event) => setAgentSettings({ strict_grounding: event.target.checked })} />
            <span>
              <span className="block font-medium text-slate-900">Strict grounding</span>
              <span className="mt-1 block text-xs leading-5 text-slate-500">The LLM is instructed to cite evidence resource IDs and state when evidence is missing.</span>
            </span>
          </label>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            Live LLM answers require `LLM_PROVIDER=ollama` with Ollama running, or `LLM_PROVIDER=openai` with `OPENAI_API_KEY`. Without a reachable provider, the workflow returns deterministic grounded answers.
          </div>
        </div>
      </motion.aside>
    </div>
  );
}

function SettingsRange({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="block text-xs font-medium text-slate-500">
      <span className="flex items-center justify-between">
        <span>{label}</span>
        <span className="text-slate-900">{display}</span>
      </span>
      <input className="mt-2 w-full accent-teal-700" type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}

function GuidedTour({
  open,
  onClose,
  onOpenSettings,
  onCloseSettings,
}: {
  open: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onCloseSettings: () => void;
}) {
  const [index, setIndex] = useState(0);
  const [targetBox, setTargetBox] = useState<{ top: number; left: number; width: number; height: number } | null>(null);
  const { setMode, setActiveTab } = useWorkbenchStore();
  const closeTour = () => {
    onCloseSettings();
    onClose();
  };

  useEffect(() => {
    if (open) {
      setIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    const step = tourSteps[index];
    setMode(step.mode);
    setActiveTab(step.tab);
    if (step.openSettings) {
      onOpenSettings();
    } else {
      onCloseSettings();
    }

    const updateTargetBox = () => {
      const element = document.querySelector(step.selector);
      if (!element) {
        setTargetBox(null);
        return;
      }
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        setTargetBox(null);
        return;
      }
      setTargetBox({ top: rect.top, left: rect.left, width: rect.width, height: rect.height });
    };

    const element = document.querySelector(step.selector);
    element?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    const timeout = window.setTimeout(updateTargetBox, 220);
    window.addEventListener("resize", updateTargetBox);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("resize", updateTargetBox);
    };
  }, [index, onCloseSettings, onOpenSettings, open, setActiveTab, setMode]);

  if (!open) {
    return null;
  }
  const step = tourSteps[index];
  const isLast = index === tourSteps.length - 1;
  const tooltipStyle = tooltipPosition(targetBox);

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/45">
      {targetBox ? (
        <div
          className="pointer-events-none fixed rounded-xl border-2 border-teal-300 shadow-[0_0_0_9999px_rgba(15,23,42,0.46)]"
          style={{
            top: targetBox.top - 8,
            left: targetBox.left - 8,
            width: targetBox.width + 16,
            height: targetBox.height + 16,
          }}
        />
      ) : null}
      <motion.div
        className="fixed w-[min(92vw,430px)] rounded-lg bg-white p-5 shadow-xl"
        style={tooltipStyle}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs font-medium text-teal-800">
              Step {index + 1} of {tourSteps.length}
            </div>
            <h2 className="mt-2 text-lg font-semibold text-slate-950">{step.title}</h2>
          </div>
          <button className="rounded-lg border border-slate-200 p-2 hover:bg-slate-50" title="Skip tour" onClick={closeTour}>
            <X size={17} />
          </button>
        </div>
        <p className="mt-3 text-sm leading-6 text-slate-600">{step.body}</p>
        <div className="mt-5 flex items-center justify-between gap-3">
          <button className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={closeTour}>
            Skip
          </button>
          <div className="flex gap-2">
            {index > 0 ? (
              <button className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50" onClick={() => setIndex(index - 1)}>
                Back
              </button>
            ) : null}
            <button className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800" onClick={() => (isLast ? closeTour() : setIndex(index + 1))}>
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function tooltipPosition(targetBox: { top: number; left: number; width: number; height: number } | null): { top: number | string; left: number | string; transform?: string } {
  if (!targetBox || typeof window === "undefined") {
    return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
  }

  const width = Math.min(window.innerWidth * 0.92, 430);
  const gap = 18;
  const below = targetBox.top + targetBox.height + gap;
  const above = targetBox.top - gap - 230;
  const right = targetBox.left + targetBox.width + gap;
  const left = targetBox.left - width - gap;

  if (right + width < window.innerWidth - 16) {
    return { top: Math.max(16, Math.min(targetBox.top, window.innerHeight - 280)), left: right };
  }
  if (left > 16) {
    return { top: Math.max(16, Math.min(targetBox.top, window.innerHeight - 280)), left };
  }
  if (below + 230 < window.innerHeight - 16) {
    return { top: below, left: Math.max(16, Math.min(targetBox.left, window.innerWidth - width - 16)) };
  }
  return { top: Math.max(16, above), left: Math.max(16, Math.min(targetBox.left, window.innerWidth - width - 16)) };
}

function ActiveTab({ tab }: { tab: string }) {
  switch (tab) {
    case "Overview":
      return <Overview />;
    case "How to Use":
      return <UserGuide />;
    case "System Design":
      return <SystemWalkthrough />;
    case "Data Management":
      return <DataManagement />;
    case "Agent Workbench":
      return <AgentWorkbench />;
    case "Member Timeline":
      return <MemberTimeline />;
    case "Claims & Policy Review":
      return <ClaimsReview />;
    case "Cohort Analytics":
      return <CohortAnalytics />;
    case "Tool Trace":
      return <ToolTrace />;
    case "Evidence & Grounding":
      return <EvidenceGrounding />;
    case "Evaluation Lab":
      return <EvaluationLab />;
    case "Data Quality":
      return <DataQuality />;
    case "Audit & Governance":
      return <AuditGovernance />;
    case "Architecture":
      return <Architecture />;
    default:
      return <Overview />;
  }
}

function UserGuide() {
  const { setActiveTab, setMode } = useWorkbenchStore();
  const productGuideRows = productTabs.map((tab) => [tab, pageGuides[tab]?.purpose ?? "", pageGuides[tab]?.start ?? "", pageGuides[tab]?.output ?? ""]);
  const engineeringGuideRows = engineeringTabs.map((tab) => [tab, pageGuides[tab]?.purpose ?? "", pageGuides[tab]?.start ?? "", pageGuides[tab]?.output ?? ""]);

  return (
    <div className="space-y-5">
      <section className="panel overflow-hidden">
        <div className="grid gap-0 xl:grid-cols-[0.85fr_1.15fr]">
          <div className="border-b border-slate-200 p-6 xl:border-b-0 xl:border-r">
            <div className="flex items-center gap-2 text-sm font-semibold text-teal-800">
              <BookOpen size={18} />
              In-App Instruction Document
            </div>
            <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-normal text-slate-950">Start here if this is your first time</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              HealthAgent Workbench is a synthetic healthcare AI operations demo. Use this guide like the product manual: it explains what each page is for, what to click first, and what output to expect.
            </p>
            <div className="mt-5 rounded-lg border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900">
              Synthetic data only. No real patient data is used. The app is for product and engineering demonstration, not clinical decision-making.
            </div>
          </div>
          <div className="bg-slate-50 p-6">
            <div className="text-sm font-semibold text-slate-950">Recommended demo path</div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {quickStartSteps.map(([step, title, body]) => (
                <div key={step} className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-teal-50 text-sm font-semibold text-teal-800">{step}</span>
                    <div className="text-sm font-semibold text-slate-950">{title}</div>
                  </div>
                  <p className="mt-3 text-xs leading-5 text-slate-600">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="panel p-5">
          <div className="text-sm font-semibold text-slate-950">Try these first</div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {[
              ["Data check", "Confirm the FHIR server is online and records are visible.", "Data Management"],
              ["Agent answer", "Run the care-gap prompt and inspect citations.", "Agent Workbench"],
              ["Governance", "Check the generated audit event and grounding status.", "Audit & Governance"],
            ].map(([title, body, tab]) => (
              <button
                key={title}
                className="rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-teal-300 hover:bg-teal-50"
                onClick={() => {
                  setMode(engineeringTabs.includes(tab) ? "engineering" : "product");
                  setActiveTab(tab);
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm font-semibold text-slate-950">{title}</div>
                  <ArrowRight size={16} className="text-slate-400" />
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-600">{body}</p>
              </button>
            ))}
          </div>
        </div>
        <div className="panel p-5">
          <div className="text-sm font-semibold text-slate-950">What the app is demonstrating</div>
          <div className="mt-4 space-y-3 text-xs leading-5 text-slate-600">
            <p>Healthcare workflow UI over synthetic HL7 FHIR, claims, policy, and care-gap data.</p>
            <p>Grounded AI answers using tools, hybrid retrieval, evidence cards, and validation.</p>
            <p>Production-style controls: data management, trace inspection, evals, data quality, and audit.</p>
          </div>
        </div>
      </section>

      <section className="panel p-5">
        <div className="text-sm font-semibold text-slate-950">Product pages</div>
        <div className="mt-4 overflow-x-auto">
          <GuideTable rows={productGuideRows} />
        </div>
      </section>

      <section className="panel p-5">
        <div className="text-sm font-semibold text-slate-950">Engineering pages</div>
        <div className="mt-4 overflow-x-auto">
          <GuideTable rows={engineeringGuideRows} />
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {[
          ["Why Data Management?", "Healthcare platforms usually separate data operations from architecture diagrams. This is where an operator checks sources, ingestion, and previews."],
          ["Why evidence cards?", "In healthcare workflows, users need to verify where an AI answer came from before trusting or acting on it."],
          ["Why Engineering Mode?", "Technical reviewers need to inspect traces, evals, data quality, audit logs, and runtime architecture without crowding the product workflow."],
        ].map(([title, body]) => (
          <div key={title} className="panel p-5">
            <div className="text-sm font-semibold text-slate-950">{title}</div>
            <p className="mt-2 text-xs leading-5 text-slate-600">{body}</p>
          </div>
        ))}
      </section>
    </div>
  );
}

function GuideTable({ rows }: { rows: string[][] }) {
  return (
    <table className="w-full min-w-[900px] text-left text-sm">
      <thead className="bg-slate-50 text-xs text-slate-500">
        <tr>
          {["Page", "Purpose", "First action", "Expected output"].map((column) => (
            <th key={column} className="px-4 py-3">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map(([page, purpose, start, output]) => (
          <tr key={page} className="border-t border-slate-100 align-top">
            <td className="px-4 py-3 font-medium text-slate-950">{page}</td>
            <td className="max-w-sm px-4 py-3 text-slate-600">{purpose}</td>
            <td className="max-w-sm px-4 py-3 text-slate-600">{start}</td>
            <td className="max-w-sm px-4 py-3 text-slate-600">{output}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SystemWalkthrough() {
  const { setActiveTab, setMode } = useWorkbenchStore();
  const { data: runtime } = useQuery({ queryKey: ["runtime"], queryFn: api.runtime });
  const { data: synthea } = useQuery({ queryKey: ["synthea-status"], queryFn: api.syntheaStatus });
  const dataSource = clinicalSourceLabel(runtime?.clinical_data_source);

  return (
    <div className="space-y-5">
      <section className="panel overflow-hidden">
        <div className="grid gap-0 xl:grid-cols-[0.9fr_1.1fr]">
          <div className="border-b border-slate-200 p-6 xl:border-b-0 xl:border-r">
            <div className="flex items-center gap-2 text-sm font-semibold text-teal-800">
              <BookOpen size={18} />
              Plain-English System Guide
            </div>
            <h2 className="mt-4 max-w-2xl text-3xl font-semibold tracking-normal text-slate-950">What HealthAgent Workbench does</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              This is a healthcare AI operations workbench. A user asks about a care gap, a claim, or a member timeline. The system retrieves synthetic HL7 FHIR and payer evidence, uses an LLM only after evidence is assembled, then shows the answer, citations, trace, and audit record.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                ["Workflow first", "The app starts from care gaps, claim review, member timelines, and data operations instead of a blank chatbot."],
                ["Evidence grounded", "Answers are built from retrieved FHIR, claims, policy, and care-gap evidence before the LLM responds."],
                ["Inspectable system", "Trace, grounding, eval, data quality, audit, and architecture screens expose how the workflow behaves."],
                ["Synthetic and safe", "Every screen uses synthetic data and clearly marks unsupported answers."],
              ].map(([title, body]) => (
                <div key={title} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                  <div className="text-sm font-semibold text-slate-950">{title}</div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{body}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-slate-50 p-6">
            <div className="text-sm font-semibold text-slate-950">End-to-end architecture map</div>
            <div className="mt-4 grid gap-3">
              {systemLayers.map((layer, index) => {
                const Icon = layer.icon;
                return (
                  <div key={layer.title} className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 sm:grid-cols-[42px_1fr_auto] sm:items-center">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-50 text-teal-800">
                      <Icon size={19} />
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-slate-950">{layer.title}</div>
                      <div className="mt-1 text-xs font-medium text-slate-500">{layer.label}</div>
                      <p className="mt-2 text-xs leading-5 text-slate-600">{layer.description}</p>
                    </div>
                    <span className="hidden h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-500 sm:flex">{index + 1}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="panel p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <BrainCircuit size={18} />
            AI Architecture
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {aiPipeline.map(([step, title, body]) => (
              <div key={step} className="rounded-lg border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-sm font-semibold text-teal-800">{step}</span>
                  <div className="text-sm font-semibold text-slate-950">{title}</div>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Database size={18} />
            Data Sources
          </div>
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="text-xs text-slate-500">Active clinical source</div>
              <div className="mt-1 text-lg font-semibold text-slate-950">{dataSource}</div>
              <p className="mt-2 text-xs leading-5 text-slate-600">
                Synthea can generate patient bundles, HAPI FHIR stores clinical resources, and the app keeps payer claims and policies as controlled fixtures.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <SmallStat label="Synthea bundles" value={String(synthea?.bundle_count ?? 0)} />
              <SmallStat label="FHIR server" value={runtime?.fhir_status?.available ? "Online" : "Checking"} />
            </div>
            <button
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={() => {
                setMode("product");
                setActiveTab("Data Management");
              }}
            >
              Open data management
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </section>

      <section className="panel p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-950">Component Guide</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">Use this section as the demo narration: each component maps to a visible part of the product.</p>
          </div>
          <button
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
            onClick={() => {
              setMode("product");
              setActiveTab("Agent Workbench");
            }}
          >
            Try the agent
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {componentGuide.map(([title, body]) => (
            <div key={title} className="rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-950">{title}</div>
              <p className="mt-2 text-xs leading-5 text-slate-600">{body}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Overview() {
  const { data: metrics } = useQuery({ queryKey: ["metrics"], queryFn: api.metrics });
  const { data: runtime } = useQuery({ queryKey: ["runtime"], queryFn: api.runtime });
  const { data: synthea } = useQuery({ queryKey: ["synthea-status"], queryFn: api.syntheaStatus });
  const { data: auditEvents } = useQuery({ queryKey: ["audit"], queryFn: api.auditEvents, refetchInterval: 10000 });
  const reduceMotion = useReducedMotion();
  const metricCards = [
    ["Synthetic Members", metrics?.synthetic_members ?? 100, "Total demo members"],
    ["FHIR Resources", metrics?.fhir_resources ?? 0, "Patient, Condition, Observation, Encounter"],
    ["Claims Loaded", metrics?.claims_loaded ?? 0, "Synthetic professional claims"],
    ["Eval Questions", metrics?.eval_questions ?? 0, "Grounding and tool-call cases"],
    ["Grounding Score", `${Math.round((metrics?.grounding_score ?? 0.91) * 100)}%`, "Mock evaluation score"],
    ["Hallucination Rate", `${((metrics?.hallucination_rate ?? 0.031) * 100).toFixed(1)}%`, "Unsupported claim estimate"],
  ];
  const { setActiveTab, setMode } = useWorkbenchStore();
  const sourceLabel = clinicalSourceLabel(runtime?.clinical_data_source);
  const statusCards = [
    ["FHIR server", runtime?.fhir_status?.available ? "Online" : "Checking", runtime?.fhir_status?.available ? "Ready for clinical resource reads" : "Waiting for HAPI FHIR", runtime?.fhir_status?.available],
    ["Clinical source", sourceLabel, `${synthea?.bundle_count ?? 0} Synthea bundle files available`, runtime?.clinical_data_source === "synthea"],
    ["LLM mode", runtime?.mock_mode ? "Deterministic" : "Live LLM", runtime?.configured_provider ?? "checking provider", !runtime?.mock_mode],
    ["RAG index", `${runtime?.rag_status?.documents ?? 0} docs`, runtime?.rag_status?.fusion ?? "hybrid retrieval", runtime?.rag_status?.available],
    ["Audit log", `${auditEvents?.length ?? 0} events`, "Agent and review actions are tracked", true],
  ];
  const commandCards = [
    {
      title: "Start guided demo",
      body: "Open the instruction document and follow the recommended path through the app.",
      tab: "How to Use",
      mode: "product" as Mode,
      icon: BookOpen,
      cta: "Open guide",
    },
    {
      title: "Manage clinical data",
      body: "Run the Synthea-to-HAPI FHIR workflow, track disk and loaded counts, and preview records.",
      tab: "Data Management",
      mode: "product" as Mode,
      icon: Database,
      cta: "Open data",
    },
    {
      title: "Run agent query",
      body: "Ask a grounded healthcare operations question and inspect evidence cards.",
      tab: "Agent Workbench",
      mode: "product" as Mode,
      icon: BrainCircuit,
      cta: "Run query",
    },
    {
      title: "Inspect member",
      body: "Review one member timeline across clinical, claims, medications, care gaps, and risk.",
      tab: "Member Timeline",
      mode: "product" as Mode,
      icon: History,
      cta: "Open timeline",
    },
    {
      title: "Review claim",
      body: "Inspect a claim against synthetic payer policy and missing-documentation logic.",
      tab: "Claims & Policy Review",
      mode: "product" as Mode,
      icon: ClipboardCheck,
      cta: "Review claim",
    },
    {
      title: "Verify governance",
      body: "Check audit events, grounding, trace steps, and evaluation signals.",
      tab: "Audit & Governance",
      mode: "engineering" as Mode,
      icon: ShieldCheck,
      cta: "Open audit",
    },
  ];
  const recentAuditEvents = (auditEvents ?? []).slice(0, 3);

  return (
    <div className="space-y-5" data-tour="command-center">
      <section className="panel overflow-hidden">
        <div className="grid gap-0 xl:grid-cols-[1fr_360px]">
          <div className="p-6">
            <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
              <span className="rounded-md bg-teal-50 px-2 py-1 text-teal-800">Operations command center</span>
              <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-800">Evidence-first AI</span>
              <span className="rounded-md bg-rose-50 px-2 py-1 text-rose-800">Synthetic data only</span>
            </div>
            <h2 className="mt-4 max-w-3xl text-3xl font-semibold tracking-normal text-slate-950 sm:text-4xl">HealthAgent Workbench</h2>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
              Start here to run healthcare operations workflows: manage the synthetic clinical source, ask grounded AI questions, inspect member timelines, review claims, and verify evidence, trace, and audit controls.
            </p>
            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {commandCards.map((card, index) => {
                const Icon = card.icon;
                return (
                  <motion.button
                    key={card.title}
                    className="group rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-teal-300 hover:bg-teal-50"
                    initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                    animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.04 }}
                    onClick={() => {
                      setMode(card.mode);
                      setActiveTab(card.tab);
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-teal-800 group-hover:bg-white">
                        <Icon size={19} />
                      </span>
                      <span className="flex items-center gap-1 text-xs font-medium text-slate-500 group-hover:text-teal-800">
                        {card.cta}
                        <ArrowRight size={14} />
                      </span>
                    </div>
                    <div className="mt-4 text-sm font-semibold text-slate-950">{card.title}</div>
                    <p className="mt-2 text-xs leading-5 text-slate-600">{card.body}</p>
                  </motion.button>
                );
              })}
            </div>
          </div>
          <aside className="border-t border-slate-200 bg-slate-50 p-6 xl:border-l xl:border-t-0">
            <div className="text-sm font-semibold text-slate-950">Recommended first steps</div>
            <div className="mt-4 space-y-3">
              {quickStartSteps.slice(0, 4).map(([step, title, body]) => (
                <div key={step} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-md bg-teal-50 text-xs font-semibold text-teal-800">{step}</span>
                    <div className="text-sm font-semibold text-slate-950">{title}</div>
                  </div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{body}</p>
                </div>
              ))}
            </div>
            <button
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
              onClick={() => {
                setMode("product");
                setActiveTab("How to Use");
              }}
            >
              Open full guide
              <ArrowRight size={16} />
            </button>
          </aside>
        </div>
      </section>

      <section className="grid gap-3 md:grid-cols-5">
        {statusCards.map(([label, value, hint, healthy]) => (
          <div key={String(label)} className="panel p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-medium text-slate-500">{label}</div>
              <span className={cn("h-2.5 w-2.5 rounded-full", healthy ? "bg-teal-600" : "bg-amber-500")} />
            </div>
            <div className="mt-2 break-words text-lg font-semibold text-slate-950">{value}</div>
            <div className="mt-1 break-words text-xs leading-5 text-slate-500">{hint}</div>
          </div>
        ))}
      </section>

      <section className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <div className="panel p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-950">Workflow launchpad</div>
              <p className="mt-1 text-xs leading-5 text-slate-500">The most common healthcare operations flows are one click away.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            {workflowCards.map((workflow, index) => {
              const Icon = workflow.icon;
              return (
                <motion.button
                  key={workflow.title}
                  className="group rounded-lg border border-slate-200 bg-white p-4 text-left hover:border-teal-300 hover:bg-teal-50"
                  initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                  animate={reduceMotion ? undefined : { opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  onClick={() => {
                    setMode("product");
                    setActiveTab(workflow.tab);
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-100 text-teal-800 group-hover:bg-white">
                      <Icon size={19} />
                    </span>
                    <ArrowRight size={17} className="text-slate-400 group-hover:text-teal-800" />
                  </div>
                  <div className="mt-4 text-sm font-semibold text-slate-950">{workflow.title}</div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{workflow.description}</p>
                </motion.button>
              );
            })}
          </div>
        </div>
        <div className="panel p-5">
          <div className="text-sm font-semibold text-slate-950">Recent activity</div>
          <div className="mt-4 space-y-3">
            {recentAuditEvents.length ? (
              recentAuditEvents.map((event, index) => (
                <div key={String(event.timestamp ?? index)} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <div className="break-words text-xs font-medium text-slate-950">{String(event.query ?? "Audit event")}</div>
                  <div className="mt-1 text-xs text-slate-500">{String(event.grounding_status ?? event.result_status ?? "logged")}</div>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
                No recent audit events yet. Run an agent query or review a claim to create one.
              </div>
            )}
          </div>
          <button
            className="mt-4 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            onClick={() => {
              setMode("engineering");
              setActiveTab("Audit & Governance");
            }}
          >
            Open audit log
          </button>
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        {metricCards.map(([label, value, hint]) => (
          <motion.div key={label} className="panel p-4" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <div className="text-xs text-slate-500">{label}</div>
            <div className="metric-value mt-2 text-2xl font-semibold text-slate-950">{value}</div>
            <div className="mt-1 text-xs text-slate-500">{hint}</div>
          </motion.div>
        ))}
      </section>
    </div>
  );
}

function AgentWorkbench() {
  const [query, setQuery] = useState(prompts[0]);
  const [role, setRole] = useState("care_manager");
  const [response, setResponse] = useState<AgentResponse | null>(null);
  const { agentModel, setAgentModel, agentSettings } = useWorkbenchStore();
  const mutation = useMutation({
    mutationFn: () => api.agentQuery(query, role, agentModel, agentSettings),
    onSuccess: setResponse,
  });

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[260px_minmax(0,1fr)] 2xl:grid-cols-[260px_minmax(0,1fr)_300px]">
      <div className="panel min-w-0 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <BookOpen size={17} />
          Sample Prompts
        </div>
        <div className="space-y-2">
          {prompts.map((prompt) => (
            <button key={prompt} className="w-full rounded-lg border border-slate-200 p-3 text-left text-sm leading-5 text-slate-700 hover:border-teal-300 hover:bg-teal-50" onClick={() => setQuery(prompt)}>
              {prompt}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3">
          <label className="text-xs font-medium text-slate-500">
            Role
            <select className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800" value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="care_manager">Care manager</option>
              <option value="claims_reviewer">Claims reviewer</option>
              <option value="data_scientist">Data scientist</option>
            </select>
          </label>
          <label className="text-xs font-medium text-slate-500">
            Model
            <select className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800" value={agentModel} onChange={(event) => setAgentModel(event.target.value)}>
              <option value="default_agent">default_agent</option>
              <option value="advanced_agent">advanced_agent</option>
              <option value="local_fallback">local_fallback</option>
            </select>
          </label>
        </div>
      </div>

      <div className="min-w-0 space-y-4">
        <div className="panel p-4">
          <label className="text-xs font-medium text-slate-500">Query</label>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <input className="min-w-0 flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm" value={query} onChange={(event) => setQuery(event.target.value)} />
            <button
              className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              data-tour="run-agent"
            >
              <Play size={16} />
              Run
            </button>
          </div>
        </div>

        <div className="panel min-h-[260px] p-5">
          <div className="mb-3 text-sm font-semibold text-slate-950">Answer</div>
          {mutation.isPending ? <div className="text-sm text-slate-500">Calling deterministic tools...</div> : null}
          {mutation.error ? <div className="text-sm text-rose-700">API request failed: {mutation.error.message}</div> : null}
          {response ? (
            <div className="min-w-0 space-y-4">
              <p className="max-w-full break-words text-sm leading-6 text-slate-700">{response.answer}</p>
              {response.evidence.length ? (
                <div className="grid min-w-0 gap-3 2xl:grid-cols-2">
                  {response.evidence.map((card) => (
                    <motion.div key={card.id} className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-3" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0 break-words text-sm font-medium text-slate-950">{card.title}</div>
                        <span className="rounded-md bg-teal-50 px-2 py-1 text-xs text-teal-800">{card.status}</span>
                      </div>
                      <div className="mt-1 break-all text-xs text-slate-500">
                        {card.resource_type}/{card.resource_id} - {card.date}
                      </div>
                      <p className="mt-2 break-words text-xs leading-5 text-slate-600">{card.excerpt}</p>
                    </motion.div>
                  ))}
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">No matching evidence cards were retrieved for this query.</div>
              )}
            </div>
          ) : (
            <div className="text-sm text-slate-500">Run a sample prompt to see a grounded answer with evidence cards.</div>
          )}
        </div>

        <TraceTimeline steps={response?.trace ?? []} />
      </div>

      <div className="min-w-0 space-y-4 xl:col-span-2 2xl:col-span-1">
        <div className="panel p-4">
          <div className="text-sm font-semibold">Selected Tools</div>
          <div className="mt-3 space-y-2">
            {(response?.trace ?? []).map((step) => (
              <div key={step.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-slate-200 p-2 text-xs">
                <span className="min-w-0 break-words">{step.name}</span>
                <span className="text-slate-500">{step.latency_ms} ms</span>
              </div>
            ))}
            {!response ? <div className="text-xs text-slate-500">Tools appear after a run.</div> : null}
          </div>
        </div>
        <div className="panel p-4">
          <div className="text-sm font-semibold">Model Router</div>
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            Current selection: <span className="font-medium text-slate-900">{agentModel}</span>
            <br />
            Runtime: {response ? (response.mock_mode ? "deterministic fallback" : "live provider") : "shown after the next run"}.
            <br />
            Settings: temperature {agentSettings.temperature.toFixed(1)}, depth {agentSettings.retrieval_depth}, max {agentSettings.max_tokens} tokens.
          </div>
        </div>
      </div>
    </div>
  );
}

function TraceTimeline({ steps }: { steps: TraceStep[] }) {
  return (
    <div className="panel p-4">
      <div className="mb-3 text-sm font-semibold">Animated Trace Timeline</div>
      <div className="flex gap-3 overflow-x-auto pb-2">
        {steps.map((step, index) => (
          <motion.div key={step.id} className="min-w-56 max-w-64 shrink-0 rounded-lg border border-slate-200 bg-white p-3" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
            <div className="flex min-w-0 items-start justify-between gap-2 text-xs">
              <span className="min-w-0 break-words font-medium leading-5 text-slate-900">{step.name}</span>
              <span className="shrink-0 rounded-md bg-teal-50 px-2 py-1 text-teal-800">{step.status}</span>
            </div>
            <div className="mt-2 text-xs text-slate-500">{step.latency_ms} ms</div>
          </motion.div>
        ))}
        {steps.length === 0 ? <div className="text-sm text-slate-500">Trace will populate after an agent run.</div> : null}
      </div>
    </div>
  );
}

function MemberTimeline() {
  const { selectedMemberId, setSelectedMemberId } = useWorkbenchStore();
  const { data: members } = useQuery({ queryKey: ["members"], queryFn: api.members });
  const { data } = useQuery({ queryKey: ["timeline", selectedMemberId], queryFn: () => api.memberTimeline(selectedMemberId) });
  const [selectedEvent, setSelectedEvent] = useState<TimelineEvent | null>(null);

  return (
    <div className="grid gap-4 xl:grid-cols-[320px_1fr_420px]">
      <div className="panel p-4">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Search size={17} />
          Member Search
        </div>
        <select className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm" value={selectedMemberId} onChange={(event) => setSelectedMemberId(event.target.value)}>
          {(members ?? []).slice(0, 40).map((member) => (
            <option key={member.member_id} value={member.member_id}>
              {member.member_id} - {member.name}
            </option>
          ))}
        </select>
        {data?.member ? <MemberProfile member={data.member} /> : null}
      </div>
      <div className="panel p-4">
        <div className="mb-4 text-sm font-semibold">FHIR and Claims Timeline</div>
        <div className="space-y-3">
          {(data?.events ?? []).map((event, index) => (
            <motion.button
              key={event.id}
              className="grid w-full grid-cols-[120px_1fr] gap-3 rounded-lg border border-slate-200 bg-white p-3 text-left hover:border-teal-300 hover:bg-teal-50"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.025 }}
              onClick={() => setSelectedEvent(event)}
            >
              <span className="text-xs text-slate-500">{event.date}</span>
              <span>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">{event.type}</span>
                <span className="mt-2 block text-sm font-medium text-slate-950">{event.title}</span>
              </span>
            </motion.button>
          ))}
        </div>
      </div>
      <JsonDrawer event={selectedEvent ?? data?.events?.[0] ?? null} />
    </div>
  );
}

function MemberProfile({ member }: { member: Member }) {
  return (
    <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
      <div className="font-semibold text-slate-950">{member.name}</div>
      <div className="mt-1 text-xs text-slate-500">
        {member.age} years - {member.plan} - {member.primary_clinic}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <span className="rounded-md bg-white p-2">Risk {member.risk_score}</span>
        <span className="rounded-md bg-white p-2">HbA1c {member.latest_hba1c}%</span>
        <span className="rounded-md bg-white p-2">{member.latest_temperature ? `Temp ${member.latest_temperature} F` : member.diabetes ? "Diabetes" : "No diabetes"}</span>
        <span className="rounded-md bg-white p-2">{member.oxygen_saturation ? `SpO2 ${member.oxygen_saturation}%` : member.hypertension ? "Hypertension" : "No HTN"}</span>
      </div>
      {member.clinical_programs?.length ? (
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {member.clinical_programs.map((program) => (
            <span key={program} className="rounded-md bg-white px-2 py-1 capitalize text-slate-600">
              {program}
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function JsonDrawer({ event }: { event: TimelineEvent | null }) {
  return (
    <div className="panel p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
        <TableProperties size={17} />
        JSON Resource
      </div>
      <pre className="max-h-[650px] overflow-auto rounded-lg bg-slate-950 p-4 text-xs leading-5 text-slate-100">{JSON.stringify(event?.resource ?? { status: "select an event" }, null, 2)}</pre>
    </div>
  );
}

function ClaimsReview() {
  const { selectedClaimId, setSelectedClaimId } = useWorkbenchStore();
  const queryClient = useQueryClient();
  const { data: claims } = useQuery({ queryKey: ["claims"], queryFn: api.claims });
  const { data: claim } = useQuery({ queryKey: ["claim", selectedClaimId], queryFn: () => api.claim(selectedClaimId) });
  const review = useMutation({
    mutationFn: (decision: "approve" | "pend" | "deny") => api.reviewClaim(selectedClaimId, decision),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["audit"] }),
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <div className="panel overflow-hidden">
        <div className="border-b border-slate-200 p-4 text-sm font-semibold">Claims Queue</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500">
              <tr>
                <th className="px-4 py-3">Claim</th>
                <th className="px-4 py-3">Member</th>
                <th className="px-4 py-3">Procedure</th>
                <th className="px-4 py-3">Risk</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {(claims ?? []).slice(0, 20).map((row) => (
                <tr key={row.claim_id} className={cn("border-t border-slate-100 hover:bg-slate-50", selectedClaimId === row.claim_id && "bg-teal-50")} onClick={() => setSelectedClaimId(row.claim_id)}>
                  <td className="px-4 py-3 font-medium text-slate-950">{row.claim_id}</td>
                  <td className="px-4 py-3">{row.member_id}</td>
                  <td className="px-4 py-3">{row.procedure}</td>
                  <td className="px-4 py-3">{Math.round(row.denial_risk * 100)}%</td>
                  <td className="px-4 py-3">{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="space-y-4">
        <div className="panel p-4">
          <div className="text-sm font-semibold">{claim?.claim_id ?? selectedClaimId}</div>
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
            {claim?.procedure} for {claim?.member_id} at {claim?.provider}
          </div>
          <div className="mt-4">
            <div className="text-xs text-slate-500">Denial-risk score</div>
            <div className="mt-2 h-3 rounded-full bg-slate-100">
              <div className="h-3 rounded-full bg-rose-600" style={{ width: `${Math.round((claim?.denial_risk ?? 0) * 100)}%` }} />
            </div>
            <div className="mt-1 text-sm font-semibold text-rose-700">{Math.round((claim?.denial_risk ?? 0) * 100)}%</div>
          </div>
          <div className="mt-4">
            <div className="text-xs font-medium text-slate-500">Missing documentation</div>
            <div className="mt-2 space-y-2">
              {(claim?.missing_documentation?.length ? claim.missing_documentation : ["No critical gaps identified"]).map((item) => (
                <div key={item} className="flex items-center gap-2 rounded-lg border border-slate-200 p-2 text-sm">
                  <ClipboardCheck size={16} className="text-amber-700" />
                  {item}
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            {(["approve", "pend", "deny"] as const).map((decision) => (
              <button key={decision} className="rounded-lg border border-slate-200 px-3 py-2 text-sm capitalize hover:bg-slate-50" onClick={() => review.mutate(decision)}>
                {decision}
              </button>
            ))}
          </div>
        </div>
        <PolicyCards claim={claim} />
      </div>
    </div>
  );
}

function PolicyCards({ claim }: { claim?: Claim }) {
  const policies = claim?.policy_ids ?? ["POL-PA-GLP1"];
  return (
    <div className="panel p-4">
      <div className="text-sm font-semibold">Policy Citations</div>
      <div className="mt-3 space-y-2">
        {policies.map((policy) => (
          <div key={policy} className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
            <div className="font-medium text-slate-950">{policy}</div>
            <p className="mt-1 text-xs leading-5 text-slate-600">Prior authorization policies require recent lab evidence and step therapy documentation for high-cost medication starts.</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function CohortAnalytics() {
  const { data: gaps } = useQuery({ queryKey: ["care-gaps"], queryFn: api.careGaps });
  const { data: risk } = useQuery({ queryKey: ["risk"], queryFn: api.riskScores });
  const hba1c = (gaps?.hba1c_distribution as Array<Record<string, number | string>> | undefined) ?? [];
  const distribution = (risk?.distribution as Array<Record<string, number | string>> | undefined) ?? [];
  const features = (risk?.top_features as Array<Record<string, number | string>> | undefined) ?? [];
  const calibration = (risk?.calibration as Array<Record<string, number | string>> | undefined) ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-4">
        <SmallStat label="Open care gaps" value={String(gaps?.open_gaps ?? 0)} />
        <SmallStat label="Follow-up gap rate" value={`${Math.round(Number(gaps?.follow_up_gap_rate ?? 0) * 100)}%`} />
        <SmallStat label="Precision" value={`${Math.round(Number(risk?.precision ?? 0.82) * 100)}%`} />
        <SmallStat label="Recall" value={`${Math.round(Number(risk?.recall ?? 0.76) * 100)}%`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ChartPanel title="HbA1c Distribution">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={hba1c}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="range" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="count" fill="#0f766e" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title="Risk Score Distribution">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={distribution} dataKey="count" nameKey="bucket" outerRadius={90} label>
                {["#0f766e", "#2563eb", "#b45309"].map((color) => (
                  <Cell key={color} fill={color} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title="Top Features">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={features} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis type="category" dataKey="feature" width={140} />
              <Tooltip />
              <Bar dataKey="importance" fill="#2563eb" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>
        <ChartPanel title="Calibration">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={calibration}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="bucket" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="predicted" stroke="#2563eb" strokeWidth={2} />
              <Line type="monotone" dataKey="observed" stroke="#be123c" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
    </div>
  );
}

function ToolTrace() {
  const demoSteps: TraceStep[] = [
    { id: "1", name: "Intent Classifier", status: "success", latency_ms: 31, input: { query: "care gap" }, output: { intent: "care_gap_query" } },
    { id: "2", name: "search_patients", status: "success", latency_ms: 48, input: { diabetes: true }, output: { count: 20 } },
    { id: "3", name: "get_patient_observations", status: "success", latency_ms: 36, input: { code: "4548-4" }, output: { abnormal: 27 } },
    { id: "4", name: "compute_care_gaps", status: "success", latency_ms: 44, input: { cohort: "diabetes" }, output: { gaps: 46 } },
    { id: "5", name: "validate_answer_grounding", status: "success", latency_ms: 22, input: { evidence_count: 5 }, output: { grounding_status: "supported" } },
    { id: "6", name: "write_audit_event", status: "success", latency_ms: 15, input: { run: "demo" }, output: { status: "logged" } },
  ];
  const nodes: Node[] = demoSteps.map((step, index) => ({
    id: step.id,
    position: { x: (index % 3) * 260, y: Math.floor(index / 3) * 170 },
    data: { label: `${step.name}\n${step.latency_ms} ms` },
  }));
  const edges: Edge[] = demoSteps.slice(1).map((step, index) => ({
    id: `e-${index}`,
    source: demoSteps[index].id,
    target: step.id,
    animated: true,
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: "#0f766e" },
  }));
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <div className="panel h-[620px] overflow-hidden p-2">
        <ReactFlow nodes={nodes} edges={edges} fitView>
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      <div className="panel p-4">
        <div className="mb-3 text-sm font-semibold">Node Payloads</div>
        <div className="space-y-3">
          {demoSteps.map((step) => (
            <details key={step.id} className="rounded-lg border border-slate-200 p-3 text-xs">
              <summary className="cursor-pointer font-medium text-slate-900">{step.name}</summary>
              <pre className="mt-2 overflow-auto rounded bg-slate-950 p-3 text-slate-100">{JSON.stringify({ input: step.input, output: step.output }, null, 2)}</pre>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}

function EvidenceGrounding() {
  const rows = [
    ["Member has abnormal HbA1c.", "Observation/obs-a1c-M-1001, HbA1c above threshold", "Supported"],
    ["Claim requires prior authorization.", "Policy/POL-PA-GLP1-S1", "Supported"],
    ["Step therapy is missing.", "Policy/POL-PA-GLP1-S2 and Claim/CLM-1008", "Supported"],
  ];
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-slate-200 p-4 text-sm font-semibold">Claim-by-claim Grounding</div>
      <table className="w-full text-left text-sm">
        <thead className="bg-slate-50 text-xs text-slate-500">
          <tr>
            <th className="px-4 py-3">Claim</th>
            <th className="px-4 py-3">Evidence</th>
            <th className="px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([claim, evidence, status]) => (
            <tr key={claim} className="border-t border-slate-100">
              <td className="px-4 py-3 font-medium">{claim}</td>
              <td className="px-4 py-3">{evidence}</td>
              <td className="px-4 py-3 text-teal-800">{status}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function EvaluationLab() {
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["evals"], queryFn: api.evals });
  const mutation = useMutation({ mutationFn: api.runEvals, onSuccess: () => queryClient.invalidateQueries({ queryKey: ["evals"] }) });
  const summary = data?.summary as Record<string, number> | undefined;
  const results = (data?.results as Array<Record<string, string | number>> | undefined) ?? [];
  const modelComparison = (data?.model_comparison as Array<Record<string, string | number>> | undefined) ?? [];
  return (
    <div className="space-y-4">
      <div className="panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <div className="text-sm font-semibold">Grounding Regression Set</div>
          <div className="text-xs text-slate-500">Mock evals for citation coverage, tool accuracy, hallucination rate, and latency.</div>
        </div>
        <button className="flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800" onClick={() => mutation.mutate()}>
          <Play size={16} />
          Run eval
        </button>
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <SmallStat label="Grounding" value={`${Math.round((summary?.grounding_score ?? 0.91) * 100)}%`} />
        <SmallStat label="Tool accuracy" value={`${Math.round((summary?.tool_call_accuracy ?? 0.92) * 100)}%`} />
        <SmallStat label="Hallucination" value={`${((summary?.hallucination_rate ?? 0.031) * 100).toFixed(1)}%`} />
        <SmallStat label="Citation coverage" value={`${Math.round((summary?.citation_coverage ?? 0.89) * 100)}%`} />
        <SmallStat label="P50 latency" value={`${summary?.p50_latency_ms ?? 640} ms`} />
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
        <TablePanel rows={results} columns={["id", "query", "status", "grounding_score", "tool_call_accuracy", "latency_ms"]} />
        <ChartPanel title="Model Comparison">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={modelComparison}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="model" tick={{ fontSize: 10 }} />
              <YAxis />
              <Tooltip />
              <Area type="monotone" dataKey="grounding" stroke="#0f766e" fill="#ccfbf1" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartPanel>
      </div>
    </div>
  );
}

function DataQuality() {
  const { data } = useQuery({ queryKey: ["quality"], queryFn: api.dataQuality });
  const checks = (data?.checks as Array<Record<string, string | number>> | undefined) ?? [];
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
      <TablePanel rows={checks} columns={["name", "status", "count"]} />
      <div className="panel p-4">
        <div className="text-sm font-semibold">FHIR Validation Status</div>
        <div className="mt-3 rounded-lg bg-teal-50 p-4 text-sm leading-6 text-teal-900">
          Synthetic fixture checks pass. Resource completeness is {Math.round(Number(data?.resource_completeness ?? 0.96) * 100)}%.
        </div>
      </div>
    </div>
  );
}

function AuditGovernance() {
  const { data } = useQuery({ queryKey: ["audit"], queryFn: api.auditEvents, refetchInterval: 8000 });
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">Demo uses synthetic data only. No real PHI. Not for clinical decision-making.</div>
      <TablePanel
        rows={data ?? []}
        columns={["timestamp", "user_role", "query", "model_used", "tools_called", "resources_accessed", "grounding_status", "result_status"]}
      />
    </div>
  );
}

function DataManagement() {
  return (
    <div className="space-y-4">
      <section className="panel overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="border-b border-slate-200 p-5 lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2 text-sm font-semibold text-teal-800">
              <Database size={18} />
              Data Management
            </div>
            <h2 className="mt-3 text-2xl font-semibold tracking-normal text-slate-950">Clinical source operations</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">
              Production healthcare applications usually separate data operations from architecture diagrams. This screen is the operations console for synthetic clinical data: follow the Synthea-to-HAPI FHIR progress workflow, see where files exist, confirm what is loaded, and preview what the app can read.
            </p>
          </div>
          <div className="bg-slate-50 p-5">
            <div className="text-sm font-semibold text-slate-950">How to think about this page</div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              {[
                ["Source", "Which clinical records are available?"],
                ["Ingestion", "Which step moved files into the FHIR server?"],
                ["Validation", "Can the app read usable records?"],
              ].map(([title, body]) => (
                <div key={title} className="rounded-lg border border-slate-200 bg-white p-3">
                  <div className="text-sm font-semibold text-slate-950">{title}</div>
                  <p className="mt-2 text-xs leading-5 text-slate-600">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
      <ClinicalDataSetup />
    </div>
  );
}

function ClinicalDataSetup() {
  const queryClient = useQueryClient();
  const [activeStep, setActiveStep] = useState(0);
  const { data: fhir } = useQuery({ queryKey: ["fhir-status"], queryFn: api.fhirStatus, refetchInterval: 10000 });
  const { data: synthea } = useQuery({ queryKey: ["synthea-status"], queryFn: api.syntheaStatus, refetchInterval: 10000 });
  const hasSyntheaBundles = Boolean(synthea?.available && synthea.bundle_count > 0);
  const canGenerateSynthea = Boolean(synthea?.generation_supported?.git && synthea?.generation_supported?.java);
  const refreshDataStatus = () => {
    queryClient.invalidateQueries({ queryKey: ["fhir-status"] });
    queryClient.invalidateQueries({ queryKey: ["synthea-status"] });
    queryClient.invalidateQueries({ queryKey: ["runtime"] });
    queryClient.invalidateQueries({ queryKey: ["metrics"] });
    queryClient.invalidateQueries({ queryKey: ["architecture"] });
    queryClient.invalidateQueries({ queryKey: ["fhir-preview"] });
  };
  const loadFhir = useMutation({
    mutationFn: api.loadDemoFhir,
    onSuccess: refreshDataStatus,
  });
  const generateSynthea = useMutation({
    mutationFn: api.generateSynthea,
    onSuccess: refreshDataStatus,
  });
  const importSynthea = useMutation({
    mutationFn: api.importSynthea,
    onSuccess: refreshDataStatus,
  });
  const runSyntheaPipeline = useMutation({
    mutationFn: async () => {
      setActiveStep(1);
      const generation = canGenerateSynthea ? await api.generateSynthea() : { skipped: "Generation unavailable; loaded existing Synthea files from disk." };
      setActiveStep(2);
      const loaded = await api.importSynthea();
      setActiveStep(3);
      return { generation, loaded };
    },
    onSuccess: refreshDataStatus,
  });
  const { data: fhirPreview } = useQuery({
    queryKey: ["fhir-preview"],
    queryFn: async () => {
      const entries = await Promise.all(fhirPreviewTypes.map(async (resourceType) => [resourceType, await api.fhirResources(resourceType)] as const));
      return Object.fromEntries(entries) as Record<(typeof fhirPreviewTypes)[number], FhirResource[]>;
    },
    enabled: Boolean(fhir?.available),
  });
  const fhirCounts = fhir?.counts ?? {};
  const lastImport = synthea?.last_import ?? {};
  const lastImportLoaded = lastImport.loaded as Record<string, number> | undefined;
  const activeSource = clinicalSourceLabel(synthea?.active_clinical_data_source);
  const diskPatientCount = synthea?.bundle_resource_counts?.Patient ?? 0;
  const diskResourceCount = Object.values(synthea?.bundle_resource_counts ?? {}).reduce((total, value) => total + Number(value), 0);
  const loadedResourceCount = Object.values(lastImportLoaded ?? {}).reduce((total, value) => total + Number(value), 0);
  const hapiClinicalCount = Object.values(fhirCounts).reduce((total, value) => total + Number(value), 0);
  const hasPreviewRecords = fhirPreviewTypes.some((resourceType) => (fhirPreview?.[resourceType]?.length ?? 0) > 0);
  const isGenerating = generateSynthea.isPending || runSyntheaPipeline.isPending;
  const isLoadingGenerated = importSynthea.isPending || runSyntheaPipeline.isPending;
  const canRunSynthea = Boolean(fhir?.available && (canGenerateSynthea || hasSyntheaBundles));
  const stepCards = [
    {
      title: "1. FHIR server ready",
      status: fhir?.available ? "Complete" : "Waiting",
      output: `${hapiClinicalCount} clinical resources currently visible in HAPI FHIR.`,
      complete: Boolean(fhir?.available),
    },
    {
      title: "2. Synthea files on disk",
      status: isGenerating ? "Running" : hasSyntheaBundles ? "Complete" : "Not started",
      output: `${synthea?.bundle_count ?? 0} files, ${diskPatientCount} patients, ${diskResourceCount} total resources in ${synthea?.bundle_dir ?? "data/synthea/fhir"}.`,
      complete: hasSyntheaBundles,
    },
    {
      title: "3. Loaded into FHIR",
      status: isLoadingGenerated ? "Running" : loadedResourceCount > 0 ? "Complete" : hasSyntheaBundles ? "Ready" : "Waiting",
      output: loadedResourceCount > 0 ? `${loadedResourceCount} generated clinical resources loaded in the last run.` : "Generated patient records have not been loaded into HAPI FHIR yet.",
      complete: loadedResourceCount > 0,
    },
    {
      title: "4. Validated in app",
      status: hasPreviewRecords ? "Complete" : "Waiting",
      output: hasPreviewRecords ? `The app can preview FHIR records. Active source: ${activeSource}.` : "No FHIR preview records are readable yet.",
      complete: hasPreviewRecords,
    },
  ];
  const completedSteps = stepCards.filter((step) => step.complete).length;
  const progressPercent = Math.round((completedSteps / stepCards.length) * 100);
  const selectedStep = stepCards[activeStep] ?? stepCards[0];
  const primaryPipelineLabel = runSyntheaPipeline.isPending
    ? "Running pipeline..."
    : !canGenerateSynthea && hasSyntheaBundles
      ? "Load existing Synthea files"
      : hasSyntheaBundles
        ? "Regenerate and load Synthea patients"
        : "Generate and load Synthea patients";
  const primaryPipelineTitle = !canGenerateSynthea && hasSyntheaBundles ? "Load existing Synthea bundles into HAPI FHIR" : "Generate Synthea patient files, then load them into HAPI FHIR";

  return (
    <div className="panel overflow-hidden" data-tour="fhir-panel">
      <div className="border-b border-slate-200 bg-slate-50 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <Database size={18} />
              Clinical Data Operations
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-600">
              This is the synthetic clinical data operations workflow. The preferred path is Synthea: generate realistic synthetic patient files, load them into HAPI FHIR, then validate that the app can read them. Built-in demo FHIR remains available as a fallback.
            </p>
          </div>
          <span className={cn("rounded-md px-2 py-1 text-xs font-medium", synthea?.active_clinical_data_source === "synthea" ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-900")}>
            Active source: {activeSource}
          </span>
        </div>
      </div>

      <div className="border-b border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-950">Synthea ingestion progress</div>
            <p className="mt-1 max-w-3xl text-xs leading-5 text-slate-600">
              This connects the whole flow: generated files on disk, records loaded into HAPI FHIR, and records readable by the app.
            </p>
          </div>
          <button
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
            onClick={() => runSyntheaPipeline.mutate()}
            disabled={runSyntheaPipeline.isPending || !canRunSynthea}
            title={primaryPipelineTitle}
          >
            {primaryPipelineLabel}
          </button>
        </div>
        {!canRunSynthea ? (
          <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">
            The primary workflow is waiting for HAPI FHIR plus Git/Java, or existing Synthea bundle files. Use fallback demo FHIR only when Synthea cannot run in this environment.
          </div>
        ) : null}
        <div className="mt-4 grid gap-3 md:grid-cols-4">
          {[
            ["File folder", synthea?.bundle_dir ?? "data/synthea/fhir", `${synthea?.bundle_count ?? 0} bundle files on disk`],
            ["Patients on disk", String(diskPatientCount), `${diskResourceCount} total FHIR resources in files`],
            ["Loaded last run", String(loadedResourceCount), "Generated resources imported into HAPI FHIR"],
            ["FHIR server now", String(hapiClinicalCount), `${activeSource} active`],
          ].map(([label, value, hint]) => (
            <div key={label} className="min-w-0 rounded-lg border border-slate-200 bg-white p-3">
              <div className="text-xs font-medium text-slate-500">{label}</div>
              <div className="mt-2 break-words text-sm font-semibold text-slate-950">{value}</div>
              <div className="mt-1 text-xs leading-5 text-slate-500">{hint}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-200">
          <div className="h-full rounded-full bg-teal-700 transition-all" style={{ width: `${progressPercent}%` }} />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
          <span>{completedSteps} of {stepCards.length} steps complete</span>
          <span>{progressPercent}% ready</span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          {stepCards.map((step, index) => (
            <button
              key={step.title}
              className={cn(
                "rounded-lg border p-3 text-left transition",
                activeStep === index ? "border-teal-300 bg-teal-50" : "border-slate-200 bg-white hover:border-teal-200 hover:bg-slate-50",
              )}
              onClick={() => setActiveStep(index)}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-slate-950">{step.title}</div>
                <span
                  className={cn(
                    "rounded-md px-2 py-1 text-xs font-medium",
                    step.status === "Complete" ? "bg-teal-50 text-teal-800" : step.status === "Running" ? "bg-blue-50 text-blue-800" : step.status === "Ready" ? "bg-amber-50 text-amber-900" : "bg-slate-100 text-slate-600",
                  )}
                >
                  {step.status}
                </span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-600">{step.output}</p>
            </button>
          ))}
        </div>
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
          <div className="text-sm font-semibold text-slate-950">{selectedStep.title}</div>
          <p className="mt-2 text-xs leading-5 text-slate-600">
            <span className="font-semibold">Current output:</span> {selectedStep.output}
          </p>
        </div>
        {runSyntheaPipeline.data ? (
          <div className="mt-3 rounded-lg bg-teal-50 p-3 text-xs leading-5 text-teal-900">
            Pipeline finished. Generated files, then loaded: {mutationSummary(runSyntheaPipeline.data.loaded)}.
          </div>
        ) : null}
        {runSyntheaPipeline.error ? <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs leading-5 text-rose-700">Pipeline failed: {runSyntheaPipeline.error.message}</div> : null}
      </div>

      <div className="grid gap-0 xl:grid-cols-[1fr_1fr]">
        <div className="border-b border-slate-200 p-5 xl:border-b-0 xl:border-r">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-slate-950">FHIR server inventory and fallback data</div>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-600">
                HAPI FHIR stores clinical records in the standard HL7 FHIR R4 format. The agent and timeline screens read from this server when records are available.
              </p>
              <div className="mt-2 text-xs text-slate-500">{fhir?.base_url ?? "Checking HAPI FHIR..."}</div>
            </div>
            <span className={cn("rounded-md px-2 py-1 text-xs font-medium", fhir?.available ? "bg-teal-50 text-teal-800" : "bg-amber-50 text-amber-900")}>
              {fhir?.available ? "FHIR server online" : "FHIR server unavailable"}
            </span>
          </div>
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-950">Fallback: load built-in demo FHIR</div>
                <p className="mt-1 max-w-xl text-xs leading-5 text-slate-600">
                  Use this only if Synthea generation is unavailable. It copies the app's bundled synthetic Patients, Conditions, Observations, Encounters, and MedicationRequests into HAPI FHIR.
                </p>
              </div>
              <button
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                onClick={() => loadFhir.mutate()}
                disabled={loadFhir.isPending || !fhir?.available}
                title="Copy the local synthetic clinical fixtures into the HAPI FHIR server"
              >
                {loadFhir.isPending ? "Loading..." : "Load fallback demo FHIR"}
              </button>
            </div>
            {loadFhir.data ? <div className="mt-3 rounded-lg bg-teal-50 p-3 text-xs text-teal-900">Loaded: {mutationSummary(loadFhir.data)}</div> : null}
            {loadFhir.error ? <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs leading-5 text-rose-700">FHIR load failed: {loadFhir.error.message}</div> : null}
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {["Patient", "Condition", "Observation", "Encounter", "MedicationRequest"].map((resourceType) => (
              <div key={resourceType} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">{resourceType}</div>
                <div className="mt-2 text-2xl font-semibold text-slate-950">{fhirCounts[resourceType] ?? 0}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-5">
          <div>
            <div className="text-sm font-semibold text-slate-950">Advanced Synthea controls</div>
            <p className="mt-2 max-w-2xl text-xs leading-5 text-slate-600">
              The primary button above runs the full pipeline. Use these controls only when you want to generate files separately, load existing files, or debug one stage of ingestion.
            </p>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              ["Bundle files found", `${synthea?.bundle_count ?? 0}`],
              ["Patients in files", `${synthea?.bundle_resource_counts?.Patient ?? 0}`],
              ["Java available", synthea?.generation_supported?.java ? "Yes" : "No"],
              ["Git available", synthea?.generation_supported?.git ? "Yes" : "No"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="mt-2 text-xl font-semibold text-slate-950">{value}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-950">Generate synthetic patient files</div>
                <p className="mt-1 max-w-xl text-xs leading-5 text-slate-600">
                  Downloads/runs Synthea and writes FHIR JSON files to {synthea?.bundle_dir ?? "data/synthea/fhir"}. This is step 2 only; it does not load them into the FHIR server yet.
                </p>
              </div>
              <button
                className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm hover:bg-slate-50 disabled:opacity-60"
                onClick={() => generateSynthea.mutate()}
                disabled={generateSynthea.isPending || !canGenerateSynthea}
                title="Create local Synthea FHIR JSON bundle files"
              >
                {generateSynthea.isPending ? "Generating..." : "Generate files only"}
              </button>
            </div>
            {generateSynthea.data ? <div className="mt-3 rounded-lg bg-teal-50 p-3 text-xs text-teal-900">Generation finished: {mutationSummary(generateSynthea.data)}</div> : null}
            {generateSynthea.error ? <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">Generation failed: {generateSynthea.error.message}</div> : null}
          </div>

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-950">Advanced: load existing files</div>
                <p className="mt-1 max-w-xl text-xs leading-5 text-slate-600">
                  Reads existing Synthea JSON bundles and loads supported clinical records into HAPI FHIR. Use this only when files already exist and you do not want to regenerate them.
                </p>
              </div>
              <button
                className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-60"
                onClick={() => importSynthea.mutate()}
                disabled={importSynthea.isPending || !hasSyntheaBundles || !fhir?.available}
                title={hasSyntheaBundles ? "Load existing Synthea bundles into HAPI FHIR" : "Run the full pipeline or generate files only first; no bundle files are currently available"}
              >
                {importSynthea.isPending ? "Loading..." : "Load existing files"}
              </button>
            </div>
            {!hasSyntheaBundles ? (
              <div className="mt-3 rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-900">
                This action is disabled because no generated Synthea files are available. Run the full pipeline first, generate files only, or use fallback demo FHIR.
              </div>
            ) : null}
            {importSynthea.data ? <div className="mt-3 rounded-lg bg-teal-50 p-3 text-xs text-teal-900">Loaded: {mutationSummary(importSynthea.data)}</div> : null}
            {importSynthea.error ? <div className="mt-3 rounded-lg bg-rose-50 p-3 text-xs leading-5 text-rose-700">Load failed: {importSynthea.error.message}</div> : null}
          </div>
          {lastImportLoaded ? (
            <div className="mt-4 rounded-lg border border-slate-200 bg-white p-4">
              <div className="text-sm font-semibold text-slate-950">Last generated-patient load</div>
              <p className="mt-1 text-xs leading-5 text-slate-600">
                Loaded at {String(lastImport.imported_at ?? "unknown time")}. Resources include {Object.entries(lastImportLoaded).slice(0, 5).map(([key, value]) => `${key}: ${value}`).join(", ")}.
              </p>
            </div>
          ) : null}
        </div>
      </div>

      <div className="border-t border-slate-200 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-950">FHIR record preview</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">A quick look at records currently readable through the app's FHIR layer.</p>
          </div>
          <span className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600">Preview only</span>
        </div>
        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          {fhirPreviewTypes.map((resourceType) => {
            const resources = fhirPreview?.[resourceType]?.slice(0, 4) ?? [];
            return (
              <div key={resourceType} className="rounded-lg border border-slate-200 bg-white">
                <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-950">{resourceType}</div>
                <div className="divide-y divide-slate-100">
                  {resources.length ? (
                    resources.map((resource) => (
                      <div key={`${resource.resourceType}-${resource.id}`} className="p-3">
                        <div className="break-words text-sm font-medium text-slate-950">{fhirResourceTitle(resource)}</div>
                        <div className="mt-1 break-all text-xs text-slate-500">{resource.resourceType}/{resource.id}</div>
                        <div className="mt-1 break-words text-xs text-slate-600">{fhirResourceSubtitle(resource)}</div>
                      </div>
                    ))
                  ) : (
                    <div className="p-3 text-xs leading-5 text-slate-500">No {resourceType} records are readable yet. Run the Synthea pipeline or load fallback demo FHIR.</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Architecture() {
  const { data } = useQuery({ queryKey: ["architecture"], queryFn: api.architecture });
  const { data: fhir } = useQuery({ queryKey: ["fhir-status"], queryFn: api.fhirStatus, refetchInterval: 10000 });
  const { data: synthea } = useQuery({ queryKey: ["synthea-status"], queryFn: api.syntheaStatus, refetchInterval: 10000 });
  const { setActiveTab, setMode } = useWorkbenchStore();
  const services = (data?.services as Array<Record<string, string>> | undefined) ?? [];
  const fhirCounts = fhir?.counts ?? {};

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        {services.map((service) => (
          <div key={service.name} className="panel p-4">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-slate-950">{service.name}</div>
              <span className="rounded-md bg-teal-50 px-2 py-1 text-xs text-teal-800">{service.status}</span>
            </div>
            <div className="mt-2 text-xs leading-5 text-slate-500">{service.url ?? service.feature}</div>
          </div>
        ))}
      </div>
      <div className="panel p-5">
        <div className="mb-4 text-sm font-semibold">Runtime Diagram</div>
        <div className="grid gap-3 md:grid-cols-5">
          {["Next.js", "FastAPI", "Postgres + pgvector", "Redis", "HAPI FHIR"].map((item, index) => (
            <div key={item} className="flex items-center gap-2 rounded-lg border border-slate-200 p-3 text-sm">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-slate-100 text-xs">{index + 1}</span>
              {item}
              {index < 4 ? <ChevronRight className="ml-auto hidden text-slate-400 md:block" size={16} /> : null}
            </div>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-2 text-sm">
          <a className="rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50" href="http://localhost:8000/docs" target="_blank">
            OpenAPI docs
          </a>
          <a className="rounded-lg border border-slate-200 px-3 py-2 hover:bg-slate-50" href="http://localhost:8080/fhir" target="_blank">
            FHIR server
          </a>
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <div className="panel p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <BrainCircuit size={18} />
            Agent and RAG Flow
          </div>
          <div className="mt-4 space-y-3">
            {aiPipeline.map(([step, title, body]) => (
              <div key={step} className="grid gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[34px_1fr]">
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-white text-xs font-semibold text-teal-800">{step}</span>
                <div>
                  <div className="text-sm font-semibold text-slate-950">{title}</div>
                  <p className="mt-1 text-xs leading-5 text-slate-600">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="panel p-5">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <Boxes size={18} />
            Component Responsibilities
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {componentGuide.map(([title, body]) => (
              <div key={title} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <div className="text-sm font-semibold text-slate-950">{title}</div>
                <p className="mt-2 text-xs leading-5 text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
              <Database size={18} />
              Clinical Data Boundary
            </div>
            <p className="mt-2 max-w-3xl text-xs leading-5 text-slate-600">
              Architecture shows how the data path works. Operational tasks such as generating Synthea files, loading them into HAPI FHIR, validating previews, or using fallback demo FHIR are handled in Product Mode under Data Management.
            </p>
          </div>
          <button
            className="rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800"
            onClick={() => {
              setMode("product");
              setActiveTab("Data Management");
            }}
          >
            Open Data Management
          </button>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {["Patient", "Condition", "Observation", "Encounter", "MedicationRequest"].map((resourceType) => (
            <div key={resourceType} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <div className="text-xs text-slate-500">{resourceType}</div>
              <div className="mt-2 text-2xl font-semibold text-slate-950">{fhirCounts[resourceType] ?? 0}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-5 text-slate-600">
          Active clinical source: {clinicalSourceLabel(synthea?.active_clinical_data_source)}. Synthea bundle files: {synthea?.bundle_count ?? 0}.
        </div>
      </div>
    </div>
  );
}

function SmallStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-950">{value}</div>
    </div>
  );
}

function ChartPanel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="panel p-4">
      <div className="mb-4 text-sm font-semibold">{title}</div>
      {children}
    </div>
  );
}

function TablePanel({ rows, columns }: { rows: Array<Record<string, unknown>>; columns: string[] }) {
  return (
    <div className="panel overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              {columns.map((column) => (
                <th key={column} className="px-4 py-3 capitalize">
                  {column.replaceAll("_", " ")}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={String(row.id ?? row.name ?? index)} className="border-t border-slate-100">
                {columns.map((column) => (
                  <td key={column} className="max-w-md px-4 py-3 align-top">
                    {Array.isArray(row[column]) ? row[column].join(", ") : String(row[column] ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  );
}
