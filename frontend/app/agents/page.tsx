"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowLeft, Plus, Trash2, Pencil, Check, X, Loader2, Bot, ChevronDown, ChevronUp } from "lucide-react"
import { api, AgentTemplate } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Logo } from "@/components/logo"

const AVAILABLE_TOOLS = [
  { id: "web_search",       label: "Web Search" },
  { id: "url_fetch",        label: "URL Fetch" },
  { id: "bash",             label: "Shell / Bash" },
  { id: "file_read",        label: "File Read/Write" },
  { id: "python",           label: "Python Exec" },
  { id: "http_client",      label: "HTTP Client" },
  { id: "csv_parse",        label: "CSV Parse" },
  { id: "pandas_tools",     label: "Pandas" },
  { id: "chart_generation", label: "Chart Generation" },
  { id: "browser_navigate", label: "Browser Navigate" },
  { id: "browser_extract",  label: "Browser Extract" },
  { id: "browser_click",    label: "Browser Click" },
  { id: "hitl_escalation",  label: "HITL Escalation" },
  { id: "vault_key_inject", label: "Vault Key Inject" },
  { id: "gridfs_upload",    label: "File Upload (GridFS)" },
  { id: "task_planning",    label: "Task Planning" },
]

const EMPTY_FORM = { name: "", role: "", instructions: "", tools: [] as string[], model_override: "" }

export default function AgentsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [agents, setAgents] = useState<AgentTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_FORM })
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState("")
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login")
  }, [status, router])

  useEffect(() => {
    if (status !== "authenticated" || !session?.accessToken) return
    api.agents.list(session.accessToken)
      .then(setAgents)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [status, session?.accessToken])

  function startEdit(agent: AgentTemplate) {
    setEditingId(agent.id)
    setForm({
      name: agent.name,
      role: agent.role,
      instructions: agent.instructions,
      tools: [...agent.tools],
      model_override: agent.model_override ?? "",
    })
    setShowForm(true)
    setFormError("")
  }

  function resetForm() {
    setForm({ ...EMPTY_FORM })
    setEditingId(null)
    setShowForm(false)
    setFormError("")
  }

  function toggleTool(toolId: string) {
    setForm(f => ({
      ...f,
      tools: f.tools.includes(toolId)
        ? f.tools.filter(t => t !== toolId)
        : [...f.tools, toolId],
    }))
  }

  async function handleSave() {
    if (!form.name.trim() || !form.role.trim() || !form.instructions.trim()) {
      setFormError("Name, role, and instructions are required.")
      return
    }
    if (!session?.accessToken) return
    setSaving(true)
    setFormError("")
    try {
      const body = {
        name: form.name.trim(),
        role: form.role.trim(),
        instructions: form.instructions.trim(),
        tools: form.tools,
        model_override: form.model_override.trim() || undefined,
      }
      if (editingId) {
        const updated = await api.agents.update(session.accessToken, editingId, body)
        setAgents(prev => prev.map(a => a.id === editingId ? updated : a))
      } else {
        const created = await api.agents.create(session.accessToken, body)
        setAgents(prev => [...prev, created])
      }
      resetForm()
    } catch (e: unknown) {
      setFormError(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete(id: string) {
    if (!session?.accessToken) return
    try {
      await api.agents.delete(session.accessToken, id)
      setAgents(prev => prev.filter(a => a.id !== id))
      if (editingId === id) resetForm()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Delete failed")
    }
  }

  if (loading || status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  const baseAgents = agents.filter(a => a.is_base)
  const customAgents = agents.filter(a => !a.is_base)

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Logo size="sm" showText={false} />
          <span className="text-sm font-medium text-foreground">Agent Library</span>
        </div>
        <Button
          size="sm"
          className="gap-2"
          onClick={() => { resetForm(); setShowForm(v => !v) }}
        >
          <Plus className="h-3.5 w-3.5" />
          New Agent
        </Button>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-10 space-y-8">
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {/* Create / Edit form */}
        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-lg border border-primary/30 bg-card p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-foreground">
                  {editingId ? "Edit Agent" : "New Custom Agent"}
                </p>
                <button onClick={resetForm} className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-widest">Name</label>
                  <Input
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                    placeholder="e.g. DataCleanerAgent"
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] text-muted-foreground uppercase tracking-widest">Model override <span className="normal-case text-muted-foreground/50">(optional)</span></label>
                  <Input
                    value={form.model_override}
                    onChange={e => setForm(f => ({ ...f, model_override: e.target.value }))}
                    placeholder="e.g. claude-haiku-4-5-20251001"
                    className="text-xs font-mono"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-widest">Role</label>
                <Input
                  value={form.role}
                  onChange={e => setForm(f => ({ ...f, role: e.target.value }))}
                  placeholder="One sentence describing what this agent does"
                  className="text-xs"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-widest">Instructions</label>
                <Textarea
                  value={form.instructions}
                  onChange={e => setForm(f => ({ ...f, instructions: e.target.value }))}
                  placeholder="Detailed instructions for this agent..."
                  rows={4}
                  className="text-xs"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[10px] text-muted-foreground uppercase tracking-widest">Tools</label>
                <div className="flex flex-wrap gap-1.5">
                  {AVAILABLE_TOOLS.map(t => (
                    <button
                      key={t.id}
                      onClick={() => toggleTool(t.id)}
                      className={[
                        "cursor-pointer rounded border px-2.5 py-1 text-[10px] font-mono transition-all",
                        form.tools.includes(t.id)
                          ? "border-primary bg-accent text-foreground"
                          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                      ].join(" ")}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {formError && <p className="text-xs text-destructive">{formError}</p>}

              <div className="flex gap-2 pt-1">
                <Button onClick={handleSave} disabled={saving} className="gap-2">
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  {saving ? "Saving…" : editingId ? "Save changes" : "Create agent"}
                </Button>
                <Button variant="outline" onClick={resetForm}>Cancel</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Custom agents */}
        <section className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Your Agents</p>
          {customAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground/50 rounded-lg border border-dashed border-border">
              <Bot className="h-8 w-8 mb-3" />
              <p className="text-sm">No custom agents yet</p>
              <p className="text-xs mt-1">Create one above to make it available in all your runs</p>
            </div>
          ) : (
            <AnimatePresence>
              {customAgents.map((agent, i) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  index={i}
                  onEdit={() => startEdit(agent)}
                  onDelete={() => handleDelete(agent.id)}
                  isEditing={editingId === agent.id}
                />
              ))}
            </AnimatePresence>
          )}
        </section>

        {/* Base agents — read-only reference */}
        <section className="space-y-3">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest">Built-in Agents</p>
          <p className="text-xs text-muted-foreground/60">These are always available. You can add them to plans but cannot edit them.</p>
          <div className="space-y-2">
            {baseAgents.map((agent, i) => (
              <AgentCard key={agent.id} agent={agent} index={i} readOnly />
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}


function AgentCard({
  agent, index, onEdit, onDelete, isEditing, readOnly,
}: {
  agent: AgentTemplate
  index: number
  onEdit?: () => void
  onDelete?: () => void
  isEditing?: boolean
  readOnly?: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete() {
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    try { await onDelete?.() } finally { setDeleting(false); setConfirming(false) }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ delay: index * 0.03 }}
      className={[
        "rounded-lg border bg-card transition-colors",
        isEditing ? "border-primary/50" : "border-border",
      ].join(" ")}
    >
      <div className="flex items-start gap-3 px-4 py-3">
        <Bot className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-xs font-medium text-foreground">{agent.name}</p>
            {agent.model_override && (
              <span className="text-[9px] font-mono text-muted-foreground/60 border border-border rounded px-1.5 py-0.5">
                {agent.model_override}
              </span>
            )}
            {readOnly && (
              <span className="text-[9px] text-muted-foreground/40 border border-border rounded px-1.5 py-0.5">built-in</span>
            )}
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-1">{agent.role}</p>
          {agent.tools.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1.5">
              {agent.tools.map(t => (
                <span key={t} className="text-[9px] font-mono text-muted-foreground/50 border border-border/60 rounded px-1.5 py-0.5">{t}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setExpanded(v => !v)}
            className="cursor-pointer p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
            title="View instructions"
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {!readOnly && (
            <>
              <button
                onClick={onEdit}
                className="cursor-pointer p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                onBlur={() => setConfirming(false)}
                className={[
                  "cursor-pointer flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors",
                  confirming
                    ? "bg-destructive/20 text-destructive border border-destructive/40"
                    : "text-muted-foreground hover:text-destructive",
                ].join(" ")}
              >
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                {confirming && !deleting && <span>Confirm</span>}
              </button>
            </>
          )}
        </div>
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-4 pb-3 pt-0 border-t border-border/50 mt-0">
              <pre className="text-[10px] text-muted-foreground whitespace-pre-wrap font-mono leading-relaxed mt-3 max-h-40 overflow-y-auto">
                {agent.instructions}
              </pre>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
