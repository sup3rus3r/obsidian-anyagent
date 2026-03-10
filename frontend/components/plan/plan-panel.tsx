"use client"

import { useState, useEffect, useRef, useMemo } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { useSession } from "next-auth/react"
import { motion, AnimatePresence } from "framer-motion"
import {
  CheckCircle, XCircle, RefreshCw, ChevronDown, ChevronUp,
  AlertTriangle, Loader2, Zap, Plus, Terminal, Bot, Wrench, Square, MessageSquare, Send
} from "lucide-react"
import { PlanGraph } from "./plan-graph"
import { AgentPalette } from "./agent-palette"
import { useProjectStore } from "@/store/project-store"
import { useRunStream, RunEvent } from "@/hooks/use-run-stream"
import { api } from "@/lib/api"
import { Button } from "@/components/ui/button"

const COMPLEXITY_COLOR: Record<string, string> = {
  low: "text-green-400",
  medium: "text-yellow-400",
  high: "text-red-400",
}

const MODE_LABEL: Record<string, string> = {
  coordinate: "Coordinate — leader delegates and synthesizes",
  route: "Route — task routed to one specialist",
  broadcast: "Broadcast — all agents work simultaneously",
  tasks: "Tasks — iterative loop with leader",
}

interface PlanPanelProps {
  projectId: string
  runId: string
  onViewFiles?: () => void
}

export function PlanPanel({ projectId, runId, onViewFiles }: PlanPanelProps) {
  const { data: session } = useSession()
  const {
    editablePlan, activeRun, planPhase, setPlanPhase,
    setActiveRun, addPlanAgent, agentLibrary,
    runEvents, appendRunEvent, clearRunEvents,
    liveAgentStatus, setAgentStatus,
    hitlPause, setHitlPause,
  } = useProjectStore()

  const [showSteps, setShowSteps] = useState(false)
  const [showPalette, setShowPalette] = useState(false)
  const [regenNote, setRegenNote] = useState("")
  const [clarificationAnswers, setClarificationAnswers] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [hitlAnswer, setHitlAnswer] = useState("")
  const logContainerRef = useRef<HTMLDivElement>(null)

  // Wire WebSocket stream during execution
  const isExecuting = planPhase === "executing"
  const { send: wsSend } = useRunStream({
    projectId,
    runId,
    token: session?.accessToken,
    enabled: isExecuting,
  })

  function sendHitlResponse(response: string) {
    wsSend({ type: "hitl_response", run_id: runId, pause_id: hitlPause?.pause_id, response })
    setHitlAnswer("")
    setHitlPause(null)
  }

  // Listen to run-event custom events and push to store
  useEffect(() => {
    function onEvent(e: Event) {
      const event = (e as CustomEvent<RunEvent>).detail
      appendRunEvent(event)
      // Update live agent status
      if (event.type === "agent_started" && event.agent_id) {
        setAgentStatus(event.agent_id as string, "running")
      } else if (event.type === "agent_done" && event.agent_id) {
        setAgentStatus(event.agent_id as string, "done")
      } else if (event.type === "run_error" && event.agent_id) {
        setAgentStatus(event.agent_id as string, "error")
      } else if (event.type === "agent_ready" && event.agent_id) {
        setAgentStatus(event.agent_id as string, "idle")
      }
    }
    window.addEventListener("run-event", onEvent)
    return () => window.removeEventListener("run-event", onEvent)
  }, [appendRunEvent, setAgentStatus])

  // Clear events when a new run starts
  useEffect(() => {
    if (planPhase === "planning") clearRunEvents()
  }, [planPhase, clearRunEvents])

  // Auto-scroll log to bottom whenever new events arrive
  useEffect(() => {
    const el = logContainerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [runEvents.length])

  if (planPhase === "planning") {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-muted-foreground">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm">Assembling your team…</p>
      </div>
    )
  }

  if (!editablePlan) return null

  async function handleApprove() {
    if (!session?.accessToken || !editablePlan) return
    setLoading(true)
    setError("")
    try {
      const run = await api.runs.approve(session.accessToken, projectId, runId, editablePlan)
      setActiveRun(run)
      setPlanPhase("executing")
      clearRunEvents()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Approval failed")
    } finally {
      setLoading(false)
    }
  }

  async function handleReject() {
    if (!session?.accessToken) return
    setLoading(true)
    try {
      const run = await api.runs.reject(session.accessToken, projectId, runId)
      setActiveRun(run)
      setPlanPhase("idle")
    } finally {
      setLoading(false)
    }
  }

  async function handleRegenerate(noteOverride?: string) {
    if (!session?.accessToken) return
    setLoading(true)
    setError("")
    setPlanPhase("planning")
    try {
      const note = noteOverride ?? regenNote
      const run = await api.runs.regenerate(session.accessToken, projectId, runId, note)
      setActiveRun(run)
      setRegenNote("")
      setClarificationAnswers({})
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Regeneration failed")
      setPlanPhase("awaiting_approval")
    } finally {
      setLoading(false)
    }
  }

  // ── Executing / Complete — show live event log + graph ───────────────────
  if ((planPhase === "executing" || planPhase === "complete" || planPhase === "error") && runEvents.length > 0) {
    return (
      <div className="flex gap-3 h-full">
        {/* Event log — left */}
        <div className="flex flex-col flex-1 min-w-0 gap-3">
          {/* Header */}
          <div className="flex items-center justify-between shrink-0">
            <div>
              <h3 className="text-sm font-semibold text-foreground">{editablePlan.task_summary}</h3>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {planPhase === "executing"
                  ? `${editablePlan.agents.length} agents running…`
                  : "Execution complete"}
                {activeRun?.model_id && (
                  <span className="ml-2 font-mono text-muted-foreground/50">{activeRun.model_id}</span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {planPhase === "executing" && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin text-primary" />
                  <button
                    onClick={async () => {
                      if (!session?.accessToken) return
                      try {
                        await api.runs.cancel(session.accessToken, projectId, runId)
                        setPlanPhase("error")
                      } catch { /* ignore */ }
                    }}
                    title="Stop execution"
                    className="cursor-pointer flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive border border-border hover:border-destructive/50 rounded px-2 py-1 transition-colors"
                  >
                    <Square className="h-3 w-3" />
                    Stop
                  </button>
                </>
              )}
              {planPhase === "complete" && (
                <CheckCircle className="h-4 w-4 text-green-500" />
              )}
              {planPhase === "error" && (
                <button
                  onClick={() => { clearRunEvents(); setPlanPhase("idle") }}
                  title="Dismiss and start a new run"
                  className="cursor-pointer flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground border border-border hover:border-primary/40 rounded px-2 py-1 transition-colors"
                >
                  <Plus className="h-3 w-3" />
                  New run
                </button>
              )}
            </div>
          </div>

          {/* HITL pause — agent asking user a question */}
          {hitlPause && (
            <div className="shrink-0 rounded-lg border border-primary/40 bg-primary/5 px-4 py-3 space-y-2">
              <div className="flex items-center gap-2">
                <MessageSquare className="h-3.5 w-3.5 text-primary" />
                <span className="text-xs font-medium text-primary">Agent needs your input</span>
                {hitlPause.pause_type === "dangerous" && (
                  <span className="text-[10px] text-destructive border border-destructive/30 rounded px-1.5 py-0.5">dangerous</span>
                )}
              </div>
              <p className="text-xs text-foreground/80">{hitlPause.question}</p>
              {hitlPause.pause_type === "confirm" ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => sendHitlResponse("yes")}
                    className="cursor-pointer flex-1 text-xs rounded border border-green-700/60 bg-green-950/30 text-green-400 hover:bg-green-950/60 px-3 py-1.5 transition-colors"
                  >
                    Yes, proceed
                  </button>
                  <button
                    onClick={() => sendHitlResponse("no")}
                    className="cursor-pointer flex-1 text-xs rounded border border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/20 px-3 py-1.5 transition-colors"
                  >
                    No, skip
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    value={hitlAnswer}
                    onChange={(e) => setHitlAnswer(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && hitlAnswer.trim()) sendHitlResponse(hitlAnswer.trim()) }}
                    placeholder="Your answer…"
                    autoFocus
                    className="flex-1 rounded border border-border bg-input px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring"
                  />
                  <button
                    onClick={() => { if (hitlAnswer.trim()) sendHitlResponse(hitlAnswer.trim()) }}
                    disabled={!hitlAnswer.trim()}
                    className="cursor-pointer flex items-center gap-1 text-xs rounded border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 px-3 py-1.5 transition-colors disabled:opacity-40"
                  >
                    <Send className="h-3 w-3" />
                    Send
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Live event log — coalesce adjacent agent_output chunks into one line */}
          {(() => {
            const coalescedEvents = runEvents.reduce<RunEvent[]>((acc, ev) => {
              if (ev.type === "agent_output" && acc.length > 0 && acc[acc.length - 1].type === "agent_output") {
                const last = acc[acc.length - 1]
                acc[acc.length - 1] = { ...last, content: String(last.content ?? "") + String(ev.content ?? "") }
                return acc
              }
              return [...acc, ev]
            }, [])
            return (
              <div ref={logContainerRef} className="flex-1 min-h-0 rounded-lg border border-border bg-card overflow-y-auto p-3 space-y-1.5 font-mono text-[11px]">
                {runEvents.length === 0 && planPhase === "executing" && (
                  <p className="text-muted-foreground animate-pulse">Connecting…</p>
                )}
                {coalescedEvents.map((ev, i) => (
                  <EventLine key={i} event={ev} />
                ))}
              </div>
            )
          })()}

          {/* Complete summary */}
          {(planPhase === "complete" || planPhase === "error") && (() => {
            const completeEvent = runEvents.findLast(e => e.type === "run_complete")
            const errorEvent = runEvents.findLast(e => e.type === "run_error")
            const summary = completeEvent?.summary as string | undefined
            const errorMsg = errorEvent?.error as string | undefined
            if (!summary && !errorMsg) return null
            return summary ? (
              <div className="shrink-0 rounded-lg border border-green-800/50 bg-green-950/20 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium text-green-400">Summary</p>
                  {onViewFiles && (
                    <button
                      onClick={onViewFiles}
                      className="cursor-pointer text-[10px] text-primary hover:text-primary/80 border border-primary/30 hover:border-primary/60 rounded px-2 py-0.5 transition-colors"
                    >
                      View files →
                    </button>
                  )}
                </div>
                <div className="max-h-32 overflow-y-auto">
                  <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">{summary}</p>
                </div>
              </div>
            ) : (
              <div className="shrink-0 max-h-40 overflow-y-auto rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3">
                <p className="text-xs font-medium text-destructive mb-1">Error</p>
                <p className="text-xs text-foreground/80 whitespace-pre-wrap leading-relaxed">{errorMsg}</p>
              </div>
            )
          })()}
        </div>

        {/* Live graph — right */}
        <div className="w-[45%] shrink-0 rounded-lg overflow-hidden border border-border">
          <PlanGraph plan={editablePlan} editable={false} liveStatus={liveAgentStatus} />
        </div>
      </div>
    )
  }

  // ── Awaiting approval / approved ─────────────────────────────────────────
  return (
    <div className="flex flex-col h-full gap-4">
      {/* Plan header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{editablePlan.task_summary}</h3>
          <div className="flex items-center gap-3 mt-1">
            <span className="text-[11px] text-muted-foreground">
              {editablePlan.agents.length} agents ·{" "}
              <span className={COMPLEXITY_COLOR[editablePlan.estimated_complexity]}>
                {editablePlan.estimated_complexity} complexity
              </span>
              {activeRun?.model_id && (
                <> · <span className="text-muted-foreground/60">{activeRun.model_id}</span></>
              )}
            </span>
            <span className="text-[11px] text-muted-foreground/60">{MODE_LABEL[editablePlan.team_mode]}</span>
          </div>
        </div>
        <button
          onClick={() => setShowPalette(!showPalette)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-border hover:border-primary/40 rounded px-2.5 py-1.5 transition-colors cursor-pointer"
        >
          <Plus className="h-3 w-3" />
          Add agent
        </button>
      </div>

      {/* Clarifications */}
      {editablePlan.clarifications.length > 0 && (
        <div className="rounded-lg border border-yellow-800 bg-yellow-950/40 px-4 py-3 space-y-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-yellow-500" />
            <span className="text-xs font-medium text-yellow-500">Answer these to improve the plan (or skip and approve as-is)</span>
          </div>
          {editablePlan.clarifications.map((q, i) => (
            <div key={i} className="space-y-1">
              <p className="text-xs text-yellow-200">• {q}</p>
              <input
                value={clarificationAnswers[i] ?? ""}
                onChange={(e) => setClarificationAnswers(prev => ({ ...prev, [i]: e.target.value }))}
                placeholder="Your answer…"
                className="w-full rounded border border-yellow-800/60 bg-black/20 px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-yellow-600/60"
              />
            </div>
          ))}
          {Object.values(clarificationAnswers).some(v => v.trim()) && (
            <button
              onClick={() => {
                const answers = editablePlan.clarifications
                  .map((q, i) => clarificationAnswers[i]?.trim() ? `Q: ${q}\nA: ${clarificationAnswers[i]}` : null)
                  .filter(Boolean).join("\n\n")
                handleRegenerate(answers)
              }}
              disabled={loading}
              className="cursor-pointer flex items-center gap-1 text-xs text-yellow-400 hover:text-yellow-300 border border-yellow-800/60 hover:border-yellow-600/60 rounded px-3 py-1.5 transition-colors disabled:opacity-40"
            >
              <RefreshCw className="h-3 w-3" />
              Re-plan with answers
            </button>
          )}
        </div>
      )}

      {/* Agent graph */}
      <div className="flex-1 min-h-0">
        <PlanGraph plan={editablePlan} editable={planPhase === "awaiting_approval"} />
      </div>

      {/* Agent palette drawer */}
      <AnimatePresence>
        {showPalette && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <AgentPalette
              library={agentLibrary}
              onAdd={(template) => {
                addPlanAgent({
                  agent_id: `${template.name.toLowerCase()}_${Date.now()}`,
                  name: template.name,
                  role: template.role,
                  instructions: template.instructions,
                  tools: template.tools,
                  model_override: template.model_override,
                  depends_on: [],
                  is_dynamic: false,
                })
                setShowPalette(false)
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Execution steps */}
      <div>
        <button
          onClick={() => setShowSteps(!showSteps)}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          <Zap className="h-3 w-3" />
          Execution steps ({editablePlan.execution_steps.length})
          {showSteps ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        <AnimatePresence>
          {showSteps && (
            <motion.ol
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mt-2 space-y-1 overflow-hidden"
            >
              {editablePlan.execution_steps.map((step, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="text-muted-foreground/40 font-mono">{i + 1}.</span>
                  {step}
                </li>
              ))}
            </motion.ol>
          )}
        </AnimatePresence>
      </div>

      {/* Regen input */}
      {planPhase === "awaiting_approval" && (
        <div className="flex gap-2">
          <input
            value={regenNote}
            onChange={(e) => setRegenNote(e.target.value)}
            placeholder="Add instructions for regeneration (optional)"
            className="flex-1 h-10 text-xs bg-input border border-border rounded-md px-3 py-2 text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-ring focus:ring-2 focus:ring-ring/30 transition-colors"
          />
          <button
            onClick={handleRegenerate}
            disabled={loading}
            className="cursor-pointer h-10 w-10 flex items-center justify-center text-muted-foreground hover:text-foreground border border-border hover:border-primary/40 rounded-md transition-colors disabled:opacity-40"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}

      {/* Action buttons */}
      {planPhase === "awaiting_approval" && (
        <div className="flex gap-3">
          <Button
            onClick={handleApprove}
            disabled={loading}
            className="flex-1 gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
            Approve &amp; Execute
          </Button>
          <Button
            onClick={handleReject}
            disabled={loading}
            variant="outline"
            className="gap-2 hover:text-destructive hover:border-destructive/50 min-w-24"
          >
            <XCircle className="h-4 w-4" />
            Reject
          </Button>
        </div>
      )}

      {planPhase === "approved" && (
        <div className="flex items-center gap-2 text-sm rounded-md border border-primary/30 bg-primary/5 px-4 py-3 text-primary">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          Execution starting…
        </div>
      )}

      {planPhase === "error" && (
        <div className="flex gap-3">
          <Button
            onClick={handleRegenerate}
            disabled={loading}
            className="flex-1 gap-2"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Re-plan &amp; try again
          </Button>
          <Button
            onClick={() => { clearRunEvents(); setPlanPhase("idle") }}
            variant="outline"
            className="gap-2 min-w-24"
          >
            <Plus className="h-4 w-4" />
            New run
          </Button>
        </div>
      )}
    </div>
  )
}


// ── Event log line renderer ───────────────────────────────────────────────────

function EventLine({ event }: { event: RunEvent }) {
  switch (event.type) {
    case "run_started":
      return (
        <div className="flex items-center gap-2 text-primary/80">
          <Zap className="h-3 w-3 shrink-0" />
          <span>{event.message ?? "Execution started"}</span>
        </div>
      )
    case "agent_ready":
      return (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Bot className="h-3 w-3 shrink-0" />
          <span className="text-foreground/70">{event.name}</span>
          <span className="text-muted-foreground/50">ready — {event.role}</span>
        </div>
      )
    case "agent_started":
      return (
        <div className="flex items-center gap-2 text-blue-400/80">
          <Bot className="h-3 w-3 shrink-0" />
          <span>{event.name} started</span>
        </div>
      )
    case "tool_call":
      return (
        <div className="flex items-start gap-2 text-yellow-400/80">
          <Wrench className="h-3 w-3 shrink-0 mt-0.5" />
          <span>
            <span className="text-yellow-300">{event.tool}</span>
            {event.input ? (
              <span className="text-muted-foreground ml-1">
                {JSON.stringify(event.input).slice(0, 80)}
              </span>
            ) : null}
          </span>
        </div>
      )
    case "tool_result":
      return (
        <div className="flex items-start gap-2 text-muted-foreground/70 pl-5">
          <span className="truncate">{String(event.output ?? "").slice(0, 120)}</span>
        </div>
      )
    case "agent_output":
      return <AgentOutputLine content={String(event.content ?? "")} />
    case "agent_done":
      return (
        <div className="flex items-center gap-2 text-green-500/70">
          <CheckCircle className="h-3 w-3 shrink-0" />
          <span>{event.name ?? event.agent_id} done</span>
        </div>
      )
    case "run_complete":
      return (
        <div className="flex items-center gap-2 text-green-400 font-medium">
          <CheckCircle className="h-3 w-3 shrink-0" />
          <span>Execution complete</span>
        </div>
      )
    case "run_error":
      return (
        <div className="flex items-start gap-2 text-destructive">
          <XCircle className="h-3 w-3 shrink-0 mt-0.5" />
          <span className="wrap-break-word">{event.error}</span>
        </div>
      )
    case "hitl_pause":
      return (
        <div className="flex items-start gap-2 text-primary/80">
          <MessageSquare className="h-3 w-3 shrink-0 mt-0.5" />
          <span>Waiting for input: <span className="text-foreground/70">{event.question}</span></span>
        </div>
      )
    case "hitl_resumed":
      return (
        <div className="flex items-start gap-2 text-muted-foreground/60">
          <Send className="h-3 w-3 shrink-0 mt-0.5" />
          <span>Answered: <span className="text-foreground/60">{event.response ?? "(no response)"}</span></span>
        </div>
      )
    case "run_paused":
      return null
    case "run_resumed":
      return null
    default:
      return null
  }
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="text-[10px] text-foreground/70 mb-1 last:mb-0 leading-relaxed">{children}</p>,
        h1: ({ children }) => <h1 className="text-[11px] font-semibold text-foreground/90 mb-1 mt-2">{children}</h1>,
        h2: ({ children }) => <h2 className="text-[11px] font-semibold text-foreground/80 mb-1 mt-2">{children}</h2>,
        h3: ({ children }) => <h3 className="text-[10px] font-semibold text-foreground/80 mb-0.5 mt-1.5">{children}</h3>,
        ul: ({ children }) => <ul className="text-[10px] text-foreground/70 list-disc pl-4 mb-1 space-y-0.5">{children}</ul>,
        ol: ({ children }) => <ol className="text-[10px] text-foreground/70 list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>,
        li: ({ children }) => <li className="leading-relaxed">{children}</li>,
        code: ({ children, className }) => {
          const isBlock = className?.includes("language-")
          return isBlock
            ? <code className="block bg-black/40 rounded p-1.5 text-[10px] text-green-400/80 whitespace-pre-wrap overflow-x-auto my-1">{children}</code>
            : <code className="bg-black/40 rounded px-1 text-[10px] text-green-400/80">{children}</code>
        },
        pre: ({ children }) => <pre className="my-1">{children}</pre>,
        blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-2 my-1 text-[10px] text-foreground/60 italic">{children}</blockquote>,
        strong: ({ children }) => <strong className="font-semibold text-foreground/90">{children}</strong>,
        a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary/80 hover:text-primary underline">{children}</a>,
        table: ({ children }) => <table className="text-[10px] border-collapse my-1 w-full">{children}</table>,
        th: ({ children }) => <th className="border border-border/50 px-1.5 py-0.5 text-left font-semibold text-foreground/80">{children}</th>,
        td: ({ children }) => <td className="border border-border/50 px-1.5 py-0.5 text-foreground/70">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  )
}

function AgentOutputLine({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false)
  const expandedRef = useRef<HTMLDivElement>(null)
  const preview = content.replace(/\s+/g, " ").trim().slice(0, 80)
  const long = content.length > 80

  useEffect(() => {
    if (expanded && expandedRef.current) {
      expandedRef.current.scrollTop = expandedRef.current.scrollHeight
    }
  }, [content, expanded])

  return (
    <div className="flex items-start gap-2 text-foreground/80">
      <Terminal className="h-3 w-3 shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate">{preview}{long && !expanded ? "…" : ""}</span>
          {long && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(v => !v) }}
              className="cursor-pointer shrink-0 text-orange-400 hover:text-orange-300 transition-colors"
            >
              {expanded ? <ChevronUp className="h-2.5 w-2.5" /> : <ChevronDown className="h-2.5 w-2.5" />}
            </button>
          )}
        </div>
        {expanded && (
          <div ref={expandedRef} className="mt-1 max-h-48 overflow-y-auto rounded border border-border/50 bg-black/30 p-2">
            <MarkdownContent content={content} />
          </div>
        )}
      </div>
    </div>
  )
}
