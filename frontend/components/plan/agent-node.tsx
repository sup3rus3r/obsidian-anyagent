"use client"

import { memo, useState } from "react"
import { Handle, Position, NodeProps } from "@xyflow/react"
import { X, ChevronDown, ChevronUp, Wrench, CheckCircle, XCircle } from "lucide-react"
import { PlannedAgent } from "@/lib/api"
import { useProjectStore } from "@/store/project-store"

export interface AgentNodeData extends PlannedAgent {
  onRemove?: (agentId: string) => void
  editable?: boolean
  liveStatus?: "idle" | "running" | "done" | "error"
}

const AGENT_COLORS: Record<string, string> = {
  OrchestratorAgent: "border-primary bg-accent",
  ResearchAgent:     "border-blue-500/70 bg-blue-950/60",
  CodeAgent:         "border-green-500/70 bg-green-950/60",
  FileAgent:         "border-yellow-500/70 bg-yellow-950/60",
  BrowserAgent:      "border-orange-400/70 bg-orange-950/60",
  DataAgent:         "border-purple-500/70 bg-purple-950/60",
  APIAgent:          "border-pink-500/70 bg-pink-950/60",
  WriterAgent:       "border-teal-500/70 bg-teal-950/60",
  ReviewerAgent:     "border-red-500/70 bg-red-950/60",
}

function getColor(name: string) {
  return AGENT_COLORS[name] ?? "border-border bg-card"
}

function getLiveStatusClasses(liveStatus: AgentNodeData["liveStatus"]) {
  switch (liveStatus) {
    case "running": return "border-green-400 ring-2 ring-green-400/40 ring-offset-0"
    case "done":    return "border-green-500"
    case "error":   return "border-red-500"
    default:        return ""
  }
}

export const AgentNode = memo(({ data }: NodeProps) => {
  const d = data as AgentNodeData
  const [expanded, setExpanded] = useState(false)
  const [editingRole, setEditingRole] = useState(false)
  const [roleValue, setRoleValue] = useState(d.role)
  const { updatePlanAgent, removePlanAgent, planPhase } = useProjectStore()

  const editable = d.editable ?? planPhase === "awaiting_approval"
  const colorClass = getColor(d.name)
  const liveStatusClasses = getLiveStatusClasses(d.liveStatus)

  function saveRole() {
    setEditingRole(false)
    updatePlanAgent(d.agent_id, { role: roleValue })
  }

  return (
    <div
      className={`relative rounded-xl border-2 min-w-55 max-w-70 shadow-lg ${colorClass} ${liveStatusClasses} text-foreground transition-all duration-300`}
    >
      {/* Top handle — receives from dependencies */}
      <Handle type="target" position={Position.Top} className="bg-zinc-500!" />

      {/* Live status badge — top-right corner */}
      {d.liveStatus && d.liveStatus !== "idle" && (
        <div className="absolute -top-2 -right-2 z-10">
          {d.liveStatus === "running" && (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-green-500 animate-pulse">
              <span className="h-2 w-2 rounded-full bg-green-200" />
            </span>
          )}
          {d.liveStatus === "done" && (
            <CheckCircle className="h-4 w-4 text-green-400 drop-shadow" />
          )}
          {d.liveStatus === "error" && (
            <XCircle className="h-4 w-4 text-red-400 drop-shadow" />
          )}
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <div className="flex items-center gap-2">
          {d.is_dynamic && (
            <span className="text-[9px] font-bold uppercase tracking-wider text-yellow-400 bg-yellow-950 border border-yellow-800 rounded px-1">
              new
            </span>
          )}
          <span className="text-xs font-semibold text-foreground">{d.name}</span>
        </div>
        {editable && (
          <button
            onClick={(e) => { e.stopPropagation(); removePlanAgent(d.agent_id) }}
            className="nopan nodrag cursor-pointer text-muted-foreground hover:text-destructive transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Role */}
      <div className="px-3 pb-2">
        {editingRole && editable ? (
          <input
            autoFocus
            value={roleValue}
            onChange={(e) => setRoleValue(e.target.value)}
            onBlur={saveRole}
            onKeyDown={(e) => e.key === "Enter" && saveRole()}
            className="w-full text-[11px] bg-transparent border-b border-border text-foreground focus:outline-none focus:border-primary pb-0.5 transition-colors"
          />
        ) : (
          <p
            className={`text-[11px] text-muted-foreground leading-snug ${editable ? "cursor-text hover:text-foreground" : ""}`}
            onClick={() => editable && setEditingRole(true)}
          >
            {d.role}
          </p>
        )}
      </div>

      {/* Tools */}
      <div className="px-3 pb-2 flex flex-wrap gap-1">
        {d.tools.slice(0, expanded ? undefined : 3).map((t) => (
          <span
            key={t}
            className="text-[9px] font-mono bg-secondary text-muted-foreground rounded px-1.5 py-0.5 flex items-center gap-1"
          >
            <Wrench className="h-2 w-2" />
            {t}
          </span>
        ))}
        {d.tools.length > 3 && !expanded && (
          <span className="text-[9px] text-muted-foreground/60">+{d.tools.length - 3} more</span>
        )}
      </div>

      {/* Expand toggle */}
      {(d.tools.length > 3 || d.instructions) && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded) }}
          className="nopan nodrag cursor-pointer flex items-center gap-1 w-full px-3 pb-2 text-[10px] text-muted-foreground/60 hover:text-muted-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          {expanded ? "Less" : "Details"}
        </button>
      )}

      {/* Expanded: instructions */}
      {expanded && (
        <div className="px-3 pb-3 border-t border-border pt-2 mt-1">
          <p className="text-[10px] text-muted-foreground leading-relaxed">{d.instructions}</p>
        </div>
      )}

      {/* Bottom handle — delegates to downstream agents */}
      <Handle type="source" position={Position.Bottom} className="bg-zinc-500!" />
    </div>
  )
})

AgentNode.displayName = "AgentNode"
