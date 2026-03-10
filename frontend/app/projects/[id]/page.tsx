"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useSession } from "next-auth/react"
import Link from "next/link"
import { ArrowLeft, Loader2, Plus, ChevronRight, KeyRound, XCircle, ChevronDown, Bot } from "lucide-react"
import { motion } from "framer-motion"
import { api, Run } from "@/lib/api"
import type { RunEvent } from "@/hooks/use-run-stream"
import { useProjectStore } from "@/store/project-store"
import { PlanPanel } from "@/components/plan/plan-panel"
import { ArtifactsPanel } from "@/components/workspace/artifacts-panel"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Textarea } from "@/components/ui/textarea"
import { Logo } from "@/components/logo"

export default function ProjectPage() {
  const { id } = useParams<{ id: string }>()
  const { data: session, status } = useSession()
  const router = useRouter()

  const {
    activeProject, setActiveProject,
    activeRun, setActiveRun,
    planPhase, setPlanPhase,
    agentLibrary, setAgentLibrary,
    clearRunEvents, setRunEvents,
  } = useProjectStore()

  const [loading, setLoading] = useState(true)
  const [task, setTask] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState("")
  const [runHistory, setRunHistory] = useState<Run[]>([])
  const [activeTab, setActiveTab] = useState<"execution" | "artifacts">("execution")
  const [selectedModel, setSelectedModel] = useState("claude-sonnet-4-6")
  const [localModelInput, setLocalModelInput] = useState("")
  const [lmstudioUrl, setLmstudioUrl] = useState("http://localhost:1234/v1")
  const [showModelPicker, setShowModelPicker] = useState(false)

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login")
  }, [status, router])

  useEffect(() => {
    if (status !== "authenticated" || !session?.accessToken) return
    Promise.all([
      api.projects.get(session.accessToken, id),
      api.runs.list(session.accessToken, id),
      api.agents.list(session.accessToken),
    ])
      .then(async ([project, runs, agents]) => {
        setActiveProject(project)
        setAgentLibrary(agents)
        setRunHistory(runs)
        const latest = runs.find((r) => r.status !== "rejected")
        if (latest) {
          setActiveRun(latest)
          setPlanPhase(latest.status as typeof planPhase)
          if (latest.model_id) setSelectedModel(latest.model_id)
          const isTerminal = latest.status === "complete" || latest.status === "error"
          if (isTerminal) {
            try {
              const events = await api.runs.events(session.accessToken!, id, latest.id)
              setRunEvents(events as RunEvent[])
            } catch { clearRunEvents() }
          } else {
            clearRunEvents()
          }
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [status, session?.accessToken, id])

  // Keep run history status badges in sync with live events
  useEffect(() => {
    function onEvent(e: Event) {
      const ev = (e as CustomEvent).detail
      if (!ev.run_id) return
      if (ev.type === "run_complete") {
        setRunHistory(prev => prev.map(r => r.id === ev.run_id ? { ...r, status: "complete" } : r))
      } else if (ev.type === "run_error") {
        setRunHistory(prev => prev.map(r => r.id === ev.run_id ? { ...r, status: "error" } : r))
      }
    }
    window.addEventListener("run-event", onEvent)
    return () => window.removeEventListener("run-event", onEvent)
  }, [])

  // Sync active run's status badge when planPhase changes (e.g. after cancel)
  useEffect(() => {
    if (!activeRun) return
    if (planPhase === "complete" || planPhase === "error") {
      setRunHistory(prev => prev.map(r => r.id === activeRun.id ? { ...r, status: planPhase } : r))
    }
  }, [planPhase, activeRun?.id])

  async function handleNewTask() {
    if (!task.trim() || !session?.accessToken) return
    setSubmitting(true)
    setError("")
    setPlanPhase("planning")
    clearRunEvents()
    try {
      const isLmStudio = selectedModel.startsWith("lmstudio/")
      const run = await api.runs.create(session.accessToken, id, task, selectedModel, isLmStudio ? lmstudioUrl : undefined)
      setActiveRun(run)
      setRunHistory(prev => [run, ...prev])
      setTask("")
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Failed to create run")
      setPlanPhase("error")
    } finally {
      setSubmitting(false)
    }
  }

  if (loading || status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  const showPlanPanel = ["planning", "awaiting_approval", "approved", "executing", "complete", "error"].includes(planPhase)

  return (
    <div className="h-screen overflow-hidden bg-background text-foreground flex flex-col">
      <header className="border-b border-border px-5 py-3 flex items-center justify-between shrink-0 bg-background/95 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Logo size="sm" showText={false} />
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <div>
            <h1 className="text-sm font-semibold text-foreground leading-tight">
              {activeProject?.name ?? "Project"}
            </h1>
            {activeProject?.description && (
              <p className="text-[10px] text-muted-foreground">{activeProject.description}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/agents" className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors" title="Agent Library">
            <Bot className="h-4 w-4" />
          </Link>
          <Link href="/vault" className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors" title="Secrets Vault">
            <KeyRound className="h-4 w-4" />
          </Link>
          {activeRun?.model_id && (
            <span className="text-[10px] font-mono text-muted-foreground/60 border border-border rounded px-1.5 py-0.5">
              {activeRun.model_id}
            </span>
          )}
          <PhaseChip phase={planPhase} />
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="w-72 shrink-0 border-r border-border flex flex-col bg-card/30">
          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {runHistory.length > 0 && (
              <>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider px-1 mb-1">
                  Runs
                </p>
                {runHistory.map((run, i) => (
                  <motion.button
                    key={run.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.03 }}
                    onClick={async () => {
                      setActiveRun(run)
                      setPlanPhase(run.status as typeof planPhase)
                      if (run.model_id) setSelectedModel(run.model_id)
                      setActiveTab("execution")
                      const isTerminal = run.status === "complete" || run.status === "error"
                      if (isTerminal && session?.accessToken) {
                        try {
                          const events = await api.runs.events(session.accessToken, id, run.id)
                          setRunEvents(events as RunEvent[])
                        } catch { clearRunEvents() }
                      } else {
                        clearRunEvents()
                      }
                    }}
                    className={[
                      "w-full cursor-pointer text-left rounded-lg border px-3 py-3 transition-all",
                      activeRun?.id === run.id
                        ? "bg-card border-primary/50"
                        : "bg-card/50 border-border hover:border-primary/30 hover:bg-card",
                    ].join(" ")}
                  >
                    <p className="text-xs text-foreground leading-snug line-clamp-2">{run.task}</p>
                    <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                      <StatusDot status={run.status} />
                      <span className="text-[10px] text-muted-foreground capitalize">
                        {run.status.replace(/_/g, " ")}
                      </span>
                      {run.model_id && (
                        <span className="text-[9px] font-mono text-muted-foreground/50 ml-auto">
                          {run.model_id.replace("claude-", "").replace("-20251001", "")}
                        </span>
                      )}
                    </div>
                  </motion.button>
                ))}
              </>
            )}
          </div>

          {planPhase === "planning" && !submitting && (
            <div className="p-4 border-t border-border">
              <p className="text-xs text-muted-foreground animate-pulse mb-2">Assembling your team…</p>
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-2 hover:text-destructive hover:border-destructive/50"
                onClick={async () => {
                  setPlanPhase("idle")
                  if (activeRun && session?.accessToken) {
                    try { await api.runs.cancel(session.accessToken, id, activeRun.id) } catch { /* ignore */ }
                  }
                  setActiveRun(null)
                }}
              >
                <XCircle className="h-3.5 w-3.5" />
                Discard
              </Button>
            </div>
          )}
          {(planPhase === "idle" || planPhase === "error" || planPhase === "complete") && (
            <div className="p-4 border-t border-border space-y-2">
              <Textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Describe a new task..."
                rows={3}
                disabled={submitting}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleNewTask()
                }}
              />
              {/* Model picker toggle */}
              <button
                onClick={() => setShowModelPicker(v => !v)}
                className="cursor-pointer flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors w-full"
              >
                <ChevronDown className={`h-3 w-3 transition-transform ${showModelPicker ? "rotate-180" : ""}`} />
                Model: <span className="text-foreground/70 font-mono ml-0.5">{selectedModel}</span>
              </button>
              {showModelPicker && (
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-2 gap-1">
                    {[
                      { id: "claude-sonnet-4-6", label: "Sonnet 4.6" },
                      { id: "claude-opus-4-6", label: "Opus 4.6" },
                      { id: "claude-haiku-4-5-20251001", label: "Haiku 4.5" },
                      { id: "gpt-4o", label: "GPT-4o" },
                      { id: "gpt-4.1", label: "GPT-4.1" },
                      { id: "o4-mini", label: "o4-mini" },
                    ].map(m => (
                      <button
                        key={m.id}
                        onClick={() => setSelectedModel(m.id)}
                        className={[
                          "cursor-pointer rounded border px-2 py-1 text-[10px] text-left transition-all",
                          selectedModel === m.id
                            ? "border-primary bg-accent text-foreground"
                            : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                        ].join(" ")}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                  <input
                    value={localModelInput}
                    onChange={(e) => {
                      const v = e.target.value
                      setLocalModelInput(v)
                      const trimmed = v.trim()
                      setSelectedModel(trimmed || "claude-sonnet-4-6")
                    }}
                    placeholder="lmstudio/model  or  ollama/model"
                    className="w-full rounded border border-border bg-input px-2 py-1 text-[10px] font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
                  />
                  {selectedModel.startsWith("lmstudio/") && (
                    <input
                      value={lmstudioUrl}
                      onChange={(e) => setLmstudioUrl(e.target.value)}
                      placeholder="http://localhost:1234/v1"
                      className="w-full rounded border border-border bg-input px-2 py-1 text-[10px] font-mono text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
                    />
                  )}
                </div>
              )}
              {error && <p className="text-xs text-destructive">{error}</p>}
              <Button
                onClick={handleNewTask}
                disabled={!task.trim() || submitting}
                className="w-full gap-2"
                size="sm"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                {submitting ? "Planning..." : "Plan Task (Cmd+Enter)"}
              </Button>
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 overflow-hidden p-5">
          {showPlanPanel && activeRun ? (
            <div className="flex flex-col h-full gap-0">
              {/* Tab strip */}
              <div className="flex items-center border-b border-border shrink-0 mb-4">
                {([["execution", "Execution"], ["artifacts", "Files"]] as const).map(([tab, label]) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={[
                      "cursor-pointer px-4 py-2 text-xs font-medium border-b-2 -mb-px transition-colors",
                      activeTab === tab
                        ? "border-primary text-foreground"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    ].join(" ")}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex-1 min-h-0">
                {activeTab === "execution"
                  ? <PlanPanel projectId={id} runId={activeRun.id} onViewFiles={() => setActiveTab("artifacts")} />
                  : <ArtifactsPanel projectId={id} runId={activeRun.id} />
                }
              </div>
            </div>
          ) : planPhase === "idle" ? (
            <EmptyState />
          ) : null}
        </div>
      </div>
    </div>
  )
}

function PhaseChip({ phase }: { phase: string }) {
  const config: Record<string, { label: string; variant: "default" | "outline" | "warning" | "success" | "orange" | "secondary" }> = {
    idle:              { label: "Idle",              variant: "outline" },
    planning:          { label: "Planning...",       variant: "warning" },
    awaiting_approval: { label: "Awaiting Approval", variant: "orange" },
    approved:          { label: "Approved",          variant: "default" },
    executing:         { label: "Executing...",      variant: "success" },
    complete:          { label: "Complete",           variant: "success" },
    error:             { label: "Error",              variant: "outline" },
  }
  const c = config[phase] ?? config.idle
  return <Badge variant={c.variant}>{c.label}</Badge>
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    planning:          "bg-yellow-500 animate-pulse",
    awaiting_approval: "bg-primary",
    approved:          "bg-primary",
    executing:         "bg-green-500 animate-pulse",
    complete:          "bg-green-500",
    error:             "bg-destructive",
    rejected:          "bg-muted-foreground",
  }
  return <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${colors[status] ?? "bg-muted-foreground"}`} />
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3">
      <div className="h-12 w-12 rounded-xl border border-border bg-card flex items-center justify-center">
        <Plus className="h-5 w-5" />
      </div>
      <p className="text-sm">Submit a task to assemble your agent team</p>
    </div>
  )
}
