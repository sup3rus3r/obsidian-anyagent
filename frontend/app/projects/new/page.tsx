"use client"

import { useState, useRef } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { ArrowLeft, Loader2, Sparkles, Upload, X, FileText } from "lucide-react"
import Link from "next/link"
import { api } from "@/lib/api"
import { useProjectStore } from "@/store/project-store"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Logo } from "@/components/logo"

const MODELS = [
  { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", provider: "Anthropic", recommended: true },
  { id: "claude-opus-4-6",   label: "Claude Opus 4.6",   provider: "Anthropic" },
  { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", provider: "Anthropic" },
  { id: "gpt-4o",            label: "GPT-4o",            provider: "OpenAI" },
  { id: "gpt-4.1",           label: "GPT-4.1",           provider: "OpenAI" },
  { id: "gpt-5",             label: "GPT-5",             provider: "OpenAI" },
  { id: "o4-mini",           label: "o4-mini",           provider: "OpenAI" },
]

const LOCAL_PREFIXES = ["lmstudio/", "ollama/"]

const EXAMPLE_TASKS = [
  "Research the latest developments in quantum computing and write a comprehensive report",
  "Build a Python web scraper that collects job listings and exports them to CSV",
  "Analyze this dataset and create visualizations showing key trends",
  "Set up a GitHub Actions CI/CD pipeline for a Node.js project",
]

export default function NewProjectPage() {
  const { data: session } = useSession()
  const router = useRouter()
  const { addProject, setActiveProject, setActiveRun, setPlanPhase } = useProjectStore()

  const [projectName, setProjectName] = useState("")
  const [task, setTask] = useState("")
  const [selectedModel, setSelectedModel] = useState("claude-sonnet-4-6")
  const [localModelInput, setLocalModelInput] = useState("")
  const [lmstudioUrl, setLmstudioUrl] = useState("http://localhost:1234/v1")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileAdd(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = Array.from(e.target.files ?? [])
    setFiles(prev => [...prev, ...picked.filter(f => !prev.some(p => p.name === f.name))])
    if (fileInputRef.current) fileInputRef.current.value = ""
  }

  async function handleSubmit() {
    if (!task.trim() || !session?.accessToken) return
    setLoading(true)
    setError("")
    try {
      const name = projectName.trim() || task.slice(0, 40) + (task.length > 40 ? "…" : "")
      const project = await api.projects.create(session.accessToken, name)
      addProject(project)
      setActiveProject(project)
      // Upload any attached files before planning
      for (const file of files) {
        try {
          await api.artifacts.uploadToWorkspace(session.accessToken, project.id, file)
        } catch { /* non-fatal */ }
      }
      setPlanPhase("planning")
      const isLmStudio = selectedModel.startsWith("lmstudio/")
      const run = await api.runs.create(session.accessToken, project.id, task, selectedModel, isLmStudio ? lmstudioUrl : undefined)
      setActiveRun(run)
      router.push(`/projects/${project.id}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong")
      setPlanPhase("error")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="border-b border-border px-6 py-3 flex items-center gap-4">
        <Link href="/dashboard" className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Logo size="sm" />
        <span className="text-sm text-muted-foreground">/</span>
        <span className="text-sm text-foreground font-medium">New Project</span>
      </header>

      <main className="flex-1 flex items-start justify-center pt-14 px-6 pb-16">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="w-full max-w-2xl space-y-7"
        >
          {/* Task input */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
              What do you want to accomplish?
            </label>
            <Textarea
              value={task}
              onChange={(e) => setTask(e.target.value)}
              placeholder="Describe your task in detail..."
              rows={5}
              disabled={loading}
              className="min-h-[120px]"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSubmit()
              }}
            />
            <div className="flex flex-wrap gap-2 pt-1">
              {EXAMPLE_TASKS.map((ex) => (
                <button
                  key={ex}
                  onClick={() => setTask(ex)}
                  className="cursor-pointer text-xs text-muted-foreground hover:text-primary border border-border hover:border-primary/40 rounded px-2.5 py-1 transition-colors"
                >
                  {ex.slice(0, 45)}…
                </button>
              ))}
            </div>
          </div>

          {/* Project name */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
              Project name <span className="text-muted-foreground/50 normal-case">(optional)</span>
            </label>
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Auto-generated from task if left blank"
              disabled={loading}
              className="max-w-md"
            />
          </div>

          {/* File attachments */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
              Attach files <span className="text-muted-foreground/50 normal-case">(optional — agents can read these)</span>
            </label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="cursor-pointer flex items-center gap-2 rounded-lg border border-dashed border-border hover:border-primary/40 px-4 py-3 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Upload className="h-3.5 w-3.5 shrink-0" />
              Click to attach files
            </div>
            <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileAdd} />
            {files.length > 0 && (
              <div className="space-y-1">
                {files.map((f) => (
                  <div key={f.name} className="flex items-center gap-2 rounded border border-border bg-card px-3 py-1.5">
                    <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                    <span className="flex-1 text-xs text-foreground truncate">{f.name}</span>
                    <span className="text-[10px] text-muted-foreground shrink-0">{(f.size / 1024).toFixed(1)} KB</span>
                    <button
                      onClick={() => setFiles(prev => prev.filter(p => p.name !== f.name))}
                      className="cursor-pointer text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Model selector */}
          <div className="space-y-3">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-widest">
              Orchestrator Model
            </label>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setSelectedModel(m.id)}
                  disabled={loading}
                  className={[
                    "relative flex flex-col items-start rounded-lg border px-3 py-2.5 text-left transition-all cursor-pointer",
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                    selectedModel === m.id
                      ? "border-primary bg-accent text-foreground"
                      : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  ].join(" ")}
                >
                  <span className="text-xs font-medium leading-tight">{m.label}</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">{m.provider}</span>
                  {m.recommended && (
                    <span className="absolute top-1.5 right-1.5 text-[9px] text-primary font-semibold">default</span>
                  )}
                </button>
              ))}
            </div>

            {/* Local model — free-text entry */}
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">
                Local model{" "}
                <span className="text-muted-foreground/50">
                  — prefix with <code className="text-primary/70">lmstudio/</code> or <code className="text-primary/70">ollama/</code>
                </span>
              </p>
              <Input
                value={localModelInput}
                onChange={(e) => {
                  const v = e.target.value
                  setLocalModelInput(v)
                  const trimmed = v.trim()
                  if (trimmed) setSelectedModel(trimmed)
                  else setSelectedModel("claude-sonnet-4-6")
                }}
                placeholder="e.g. lmstudio/llama3  or  ollama/mistral"
                disabled={loading}
                className={[
                  "max-w-sm text-xs font-mono",
                  LOCAL_PREFIXES.some(p => selectedModel.startsWith(p)) ? "border-primary" : "",
                ].join(" ")}
              />
              {selectedModel.startsWith("lmstudio/") && (
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-[11px] text-muted-foreground shrink-0">Base URL</span>
                  <Input
                    value={lmstudioUrl}
                    onChange={(e) => setLmstudioUrl(e.target.value)}
                    placeholder="http://localhost:1234/v1"
                    disabled={loading}
                    className="max-w-sm text-xs font-mono"
                  />
                </div>
              )}
            </div>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          <Button
            onClick={handleSubmit}
            disabled={!task.trim() || loading}
            size="lg"
            className="w-full gap-2"
          >
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Planning your team…
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Plan &amp; Assemble Team
              </>
            )}
          </Button>
        </motion.div>
      </main>
    </div>
  )
}
