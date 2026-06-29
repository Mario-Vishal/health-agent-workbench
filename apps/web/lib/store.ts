import { create } from "zustand";

export type Mode = "product" | "engineering";

export type AgentSettings = {
  temperature: number;
  max_tokens: number;
  retrieval_depth: number;
  strict_grounding: boolean;
};

type WorkbenchState = {
  mode: Mode;
  activeTab: string;
  selectedMemberId: string;
  selectedClaimId: string;
  agentModel: string;
  agentSettings: AgentSettings;
  setMode: (mode: Mode) => void;
  setActiveTab: (tab: string) => void;
  setSelectedMemberId: (memberId: string) => void;
  setSelectedClaimId: (claimId: string) => void;
  setAgentModel: (model: string) => void;
  setAgentSettings: (settings: Partial<AgentSettings>) => void;
};

export const useWorkbenchStore = create<WorkbenchState>((set) => ({
  mode: "product",
  activeTab: "Overview",
  selectedMemberId: "M-1001",
  selectedClaimId: "CLM-1008",
  agentModel: "default_agent",
  agentSettings: {
    temperature: 0.2,
    max_tokens: 700,
    retrieval_depth: 5,
    strict_grounding: true,
  },
  setMode: (mode) => set({ mode, activeTab: mode === "product" ? "Overview" : "Tool Trace" }),
  setActiveTab: (activeTab) => set({ activeTab }),
  setSelectedMemberId: (selectedMemberId) => set({ selectedMemberId }),
  setSelectedClaimId: (selectedClaimId) => set({ selectedClaimId }),
  setAgentModel: (agentModel) => set({ agentModel }),
  setAgentSettings: (settings) => set((state) => ({ agentSettings: { ...state.agentSettings, ...settings } })),
}));
