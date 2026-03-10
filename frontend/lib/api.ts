/**
 * Typed API client — all calls go through Next.js rewrites to localhost:8000
 */

const BASE = "/api"

async function req<T>(
  path: string,
  options: RequestInit = {},
  token?: string
): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }))
    throw new Error(err.detail ?? "Request failed")
  }
  if (res.status === 204) return undefined as T
  return res.json()
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface Project {
  id: string
  user_id: string
  name: string
  description?: string
  container_id?: string
  session_id?: string
  model_config_data?: { primary: string; overrides: Record<string, string> }
  workspace_path?: string
  created_at: string
  updated_at: string
}

export interface PlannedAgent {
  agent_id: string
  name: string
  role: string
  instructions: string
  tools: string[]
  model_override?: string
  depends_on: string[]
  is_dynamic: boolean
}

export interface AgentTeamPlan {
  task_summary: string
  team_mode: string
  agents: PlannedAgent[]
  execution_steps: string[]
  clarifications: string[]
  estimated_complexity: string
  new_agent_definitions: Record<string, unknown>[]
}

export interface Run {
  id: string
  project_id: string
  user_id: string
  task: string
  status: string
  model_id?: string
  proposed_plan?: AgentTeamPlan
  approved_plan?: AgentTeamPlan
  summary?: string
  token_usage?: Record<string, number>
  created_at: string
  completed_at?: string
}

export interface VaultSecret {
  id: string
  label: string
  scope: string
  created_at: string
  updated_at: string
}

export interface AgentTemplate {
  id: string
  name: string
  role: string
  instructions: string
  tools: string[]
  model_override?: string
  is_base: boolean
  user_id?: string
  created_at: string
}

export interface Artifact {
  id: string
  filename: string
  mime_type?: string
  project_id?: string
  run_id?: string
  agent_id?: string
  size: number
  created_at: string
}

// ── Projects ─────────────────────────────────────────────────────────────────

export const api = {
  projects: {
    list: (token: string) =>
      req<{ projects: Project[] }>("/projects", {}, token).then(r => r.projects),

    create: (token: string, name: string, description?: string) =>
      req<Project>("/projects", {
        method: "POST",
        body: JSON.stringify({ name, description }),
      }, token),

    get: (token: string, id: string) =>
      req<Project>(`/projects/${id}`, {}, token),

    update: (token: string, id: string, data: { name?: string; description?: string }) =>
      req<Project>(`/projects/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      }, token),

    delete: (token: string, id: string) =>
      req<void>(`/projects/${id}`, { method: "DELETE" }, token),
  },

  runs: {
    create: (token: string, projectId: string, task: string, model_id?: string, lmstudio_url?: string) =>
      req<Run>(`/projects/${projectId}/runs`, {
        method: "POST",
        body: JSON.stringify({ task, model_id, lmstudio_url }),
      }, token),

    list: (token: string, projectId: string) =>
      req<{ runs: Run[] }>(`/projects/${projectId}/runs`, {}, token).then(r => r.runs),

    get: (token: string, projectId: string, runId: string) =>
      req<Run>(`/projects/${projectId}/runs/${runId}`, {}, token),

    approve: (token: string, projectId: string, runId: string, approvedPlan: AgentTeamPlan) =>
      req<Run>(`/projects/${projectId}/runs/${runId}/approve`, {
        method: "POST",
        body: JSON.stringify({ approved_plan: approvedPlan }),
      }, token),

    reject: (token: string, projectId: string, runId: string) =>
      req<Run>(`/projects/${projectId}/runs/${runId}/reject`, {
        method: "POST",
        body: JSON.stringify({}),
      }, token),

    regenerate: (token: string, projectId: string, runId: string, instructions?: string) =>
      req<Run>(`/projects/${projectId}/runs/${runId}/regenerate`, {
        method: "POST",
        body: JSON.stringify({ instructions }),
      }, token),

    cancel: (token: string, projectId: string, runId: string) =>
      req<Run>(`/projects/${projectId}/runs/${runId}/cancel`, {
        method: "POST",
        body: JSON.stringify({}),
      }, token),

    events: (token: string, projectId: string, runId: string) =>
      req<{ events: unknown[] }>(`/projects/${projectId}/runs/${runId}/events`, {}, token)
        .then(r => r.events),

    harvest: (token: string, projectId: string, runId: string) =>
      req<{ ok: boolean }>(`/projects/${projectId}/runs/${runId}/harvest`, { method: "POST", body: "{}" }, token),
  },

  agents: {
    list: (token: string) =>
      req<{ agents: AgentTemplate[] }>("/agents", {}, token).then(r => r.agents),

    create: (token: string, body: { name: string; role: string; instructions: string; tools: string[]; model_override?: string }) =>
      req<AgentTemplate>("/agents", { method: "POST", body: JSON.stringify(body) }, token),

    update: (token: string, id: string, body: Partial<{ name: string; role: string; instructions: string; tools: string[]; model_override: string }>) =>
      req<AgentTemplate>(`/agents/${id}`, { method: "PUT", body: JSON.stringify(body) }, token),

    delete: (token: string, id: string) =>
      req<void>(`/agents/${id}`, { method: "DELETE" }, token),
  },

  vault: {
    list: (token: string) =>
      req<{ secrets: VaultSecret[] }>("/vault", {}, token).then(r => r.secrets),

    create: (token: string, label: string, value: string, scope = "global") =>
      req<VaultSecret>("/vault", {
        method: "POST",
        body: JSON.stringify({ label, value, scope }),
      }, token),

    update: (token: string, id: string, value: string) =>
      req<VaultSecret>(`/vault/${id}`, {
        method: "PUT",
        body: JSON.stringify({ value }),
      }, token),

    delete: (token: string, id: string) =>
      req<void>(`/vault/${id}`, { method: "DELETE" }, token),
  },

  artifacts: {
    list: (token: string, projectId?: string, runId?: string) => {
      const params = new URLSearchParams()
      if (projectId) params.set("project_id", projectId)
      if (runId) params.set("run_id", runId)
      const qs = params.toString()
      return req<{ artifacts: Artifact[] }>(`/artifacts${qs ? `?${qs}` : ""}`, {}, token)
        .then(r => r.artifacts)
    },
    download: async (token: string, id: string, filename: string): Promise<void> => {
      const res = await fetch(`${BASE}/artifacts/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) throw new Error("Download failed")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
    },
    delete: (token: string, id: string) =>
      req<void>(`/artifacts/${id}`, { method: "DELETE" }, token),

    uploadToWorkspace: async (token: string, projectId: string, file: File): Promise<Artifact> => {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch(`/api/projects/${projectId}/workspace/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }))
        throw new Error(err.detail ?? "Upload failed")
      }
      return res.json()
    },
  },
}
