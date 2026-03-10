import { create } from "zustand"
import { Project, Run, AgentTeamPlan, AgentTemplate } from "@/lib/api"
import { RunEvent } from "@/hooks/use-run-stream"

interface ProjectStore {
  // Projects
  projects: Project[]
  setProjects: (p: Project[]) => void
  addProject: (p: Project) => void
  removeProject: (id: string) => void

  // Active project + run
  activeProject: Project | null
  setActiveProject: (p: Project | null) => void

  activeRun: Run | null
  setActiveRun: (r: Run | null) => void

  // Plan phase — local editable copy of proposed_plan
  editablePlan: AgentTeamPlan | null
  setEditablePlan: (plan: AgentTeamPlan | null) => void
  updatePlanAgent: (agentId: string, updates: Partial<AgentTeamPlan["agents"][0]>) => void
  removePlanAgent: (agentId: string) => void
  addPlanAgent: (agent: AgentTeamPlan["agents"][0]) => void

  // Agent library
  agentLibrary: AgentTemplate[]
  setAgentLibrary: (agents: AgentTemplate[]) => void

  // Run events (execution streaming)
  runEvents: RunEvent[]
  appendRunEvent: (event: RunEvent) => void
  setRunEvents: (events: RunEvent[]) => void
  clearRunEvents: () => void

  // Live agent status during execution
  liveAgentStatus: Record<string, "idle" | "running" | "done" | "error">
  setAgentStatus: (agentId: string, status: "idle" | "running" | "done" | "error") => void
  clearAgentStatuses: () => void

  // UI state
  planPhase: "idle" | "planning" | "awaiting_approval" | "approved" | "executing" | "complete" | "error"
  setPlanPhase: (phase: ProjectStore["planPhase"]) => void

  // HITL pause state during execution
  hitlPause: { pause_id: string; question: string; pause_type: string } | null
  setHitlPause: (p: { pause_id: string; question: string; pause_type: string } | null) => void
}

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  setProjects: (projects) => set({ projects }),
  addProject: (p) => set((s) => ({ projects: [p, ...s.projects] })),
  removeProject: (id) => set((s) => ({ projects: s.projects.filter((p) => p.id !== id) })),

  activeProject: null,
  setActiveProject: (activeProject) => set({ activeProject }),

  activeRun: null,
  setActiveRun: (activeRun) => set({
    activeRun,
    editablePlan: activeRun?.proposed_plan ?? null,
    planPhase: activeRun
      ? (activeRun.status as ProjectStore["planPhase"])
      : "idle",
  }),

  editablePlan: null,
  setEditablePlan: (editablePlan) => set({ editablePlan }),

  updatePlanAgent: (agentId, updates) =>
    set((s) => {
      if (!s.editablePlan) return s
      return {
        editablePlan: {
          ...s.editablePlan,
          agents: s.editablePlan.agents.map((a) =>
            a.agent_id === agentId ? { ...a, ...updates } : a
          ),
        },
      }
    }),

  removePlanAgent: (agentId) =>
    set((s) => {
      if (!s.editablePlan) return s
      return {
        editablePlan: {
          ...s.editablePlan,
          agents: s.editablePlan.agents.filter((a) => a.agent_id !== agentId),
        },
      }
    }),

  addPlanAgent: (agent) =>
    set((s) => {
      if (!s.editablePlan) return s
      return {
        editablePlan: {
          ...s.editablePlan,
          agents: [...s.editablePlan.agents, agent],
        },
      }
    }),

  agentLibrary: [],
  setAgentLibrary: (agentLibrary) => set({ agentLibrary }),

  runEvents: [],
  appendRunEvent: (event) => set((s) => ({ runEvents: [...s.runEvents, event] })),
  setRunEvents: (events) => set({ runEvents: events }),
  clearRunEvents: () => set({ runEvents: [], liveAgentStatus: {} }),

  liveAgentStatus: {},
  setAgentStatus: (agentId, status) => set((s) => ({
    liveAgentStatus: { ...s.liveAgentStatus, [agentId]: status }
  })),
  clearAgentStatuses: () => set({ liveAgentStatus: {} }),

  planPhase: "idle",
  setPlanPhase: (planPhase) => set({ planPhase }),

  hitlPause: null,
  setHitlPause: (hitlPause) => set({ hitlPause }),
}))
