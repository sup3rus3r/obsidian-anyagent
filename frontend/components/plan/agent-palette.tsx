"use client"

import { AgentTemplate } from "@/lib/api"
import { Plus } from "lucide-react"

interface AgentPaletteProps {
  library: AgentTemplate[]
  onAdd: (template: AgentTemplate) => void
}

const AGENT_ACCENT: Record<string, string> = {
  OrchestratorAgent: "border-primary/50 hover:border-primary",
  ResearchAgent:     "border-blue-700 hover:border-blue-500",
  CodeAgent:         "border-green-700 hover:border-green-500",
  FileAgent:         "border-yellow-700 hover:border-yellow-500",
  BrowserAgent:      "border-orange-700 hover:border-orange-500",
  DataAgent:         "border-purple-700 hover:border-purple-500",
  APIAgent:          "border-pink-700 hover:border-pink-500",
  WriterAgent:       "border-teal-700 hover:border-teal-500",
  ReviewerAgent:     "border-red-700 hover:border-red-500",
}

export function AgentPalette({ library, onAdd }: AgentPaletteProps) {
  const baseAgents = library.filter((a) => a.is_base)
  const userAgents = library.filter((a) => !a.is_base)

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Add Agent</p>

      <div>
        <p className="text-[10px] text-muted-foreground/60 mb-2">Base Templates</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {baseAgents.map((a) => (
            <PaletteCard key={a.id} agent={a} onAdd={onAdd} />
          ))}
        </div>
      </div>

      {userAgents.length > 0 && (
        <div>
          <p className="text-[10px] text-muted-foreground/60 mb-2">Your Agents</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {userAgents.map((a) => (
              <PaletteCard key={a.id} agent={a} onAdd={onAdd} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function PaletteCard({ agent, onAdd }: { agent: AgentTemplate; onAdd: (a: AgentTemplate) => void }) {
  const accent = AGENT_ACCENT[agent.name] ?? "border-border hover:border-primary/40"
  return (
    <button
      onClick={() => onAdd(agent)}
      className={`cursor-pointer flex items-start gap-2 rounded-lg border bg-card px-3 py-2.5 text-left transition-all ${accent}`}
    >
      <Plus className="h-3 w-3 text-muted-foreground mt-0.5 shrink-0" />
      <div>
        <p className="text-xs font-medium text-foreground">{agent.name}</p>
        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-2">{agent.role}</p>
      </div>
    </button>
  )
}
