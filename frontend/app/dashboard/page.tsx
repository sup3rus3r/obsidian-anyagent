"use client"

import { useEffect, useState } from "react"
import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Plus, FolderOpen, Clock, Loader2, LogOut, Trash2, KeyRound, Bot } from "lucide-react"
import { motion } from "framer-motion"
import { api, Project } from "@/lib/api"
import { useProjectStore } from "@/store/project-store"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Logo } from "@/components/logo"

function timeAgo(iso: string) {
  const utc = iso.endsWith("Z") || iso.includes("+") ? iso : iso + "Z"
  const diff = Date.now() - new Date(utc).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function DashboardPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { projects, setProjects, removeProject } = useProjectStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login")
  }, [status, router])

  useEffect(() => {
    if (status !== "authenticated" || !session?.accessToken) return
    api.projects
      .list(session.accessToken)
      .then(setProjects)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [status, session?.accessToken, setProjects])

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm px-6 py-3 flex items-center justify-between">
        <Logo size="md" />
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground hidden sm:block">{session?.user?.name}</span>
          <Separator orientation="vertical" className="h-5 hidden sm:block" />
          <Link href="/agents">
            <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-foreground" title="Agent Library">
              <Bot className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/vault">
            <Button size="icon-sm" variant="ghost" className="text-muted-foreground hover:text-foreground" title="Secrets Vault">
              <KeyRound className="h-4 w-4" />
            </Button>
          </Link>
          <Link href="/projects/new">
            <Button size="sm" className="gap-2 min-w-32">
              <Plus className="h-4 w-4" />
              New Project
            </Button>
          </Link>
          <Button
            size="icon-sm"
            variant="ghost"
            onClick={() => signOut({ callbackUrl: "/login" })}
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Projects</h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              {projects.length === 0 ? "No projects yet" : `${projects.length} project${projects.length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {projects.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center py-32 text-muted-foreground"
          >
            <div className="h-16 w-16 rounded-xl border border-border bg-card flex items-center justify-center mb-4">
              <FolderOpen className="h-7 w-7" />
            </div>
            <p className="text-sm font-medium text-foreground">No projects yet</p>
            <p className="text-xs text-muted-foreground mt-1 mb-5">Create your first project to get started</p>
            <Link href="/projects/new">
              <Button className="gap-2 min-w-40">
                <Plus className="h-4 w-4" />
                Create Project
              </Button>
            </Link>
          </motion.div>
        ) : (
          <div className="grid gap-3">
            {projects.map((p, i) => (
              <ProjectCard
                key={p.id}
                project={p}
                index={i}
                onDelete={async () => {
                  if (!session?.accessToken) return
                  await api.projects.delete(session.accessToken, p.id)
                  removeProject(p.id)
                }}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  )
}

function ProjectCard({
  project,
  index,
  onDelete,
}: {
  project: Project
  index: number
  onDelete: () => Promise<void>
}) {
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    try { await onDelete() } finally { setDeleting(false); setConfirming(false) }
  }

  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04 }}>
      <div className="group relative flex items-center justify-between rounded-lg border border-border bg-card px-5 py-4 hover:border-primary/40 hover:bg-accent/30 transition-all">
        {/* Clickable link layer */}
        <Link href={`/projects/${project.id}`} className="absolute inset-0 cursor-pointer" />

        {/* Content (above link layer) */}
        <div className="relative flex items-center gap-4 pointer-events-none">
          <div className="h-2 w-2 rounded-full bg-primary/50 group-hover:bg-primary transition-colors shrink-0" />
          <div>
            <p className="font-medium text-foreground group-hover:text-primary transition-colors text-sm">{project.name}</p>
            {project.description && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{project.description}</p>
            )}
          </div>
        </div>

        {/* Right side (above link layer) */}
        <div className="relative flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5 text-muted-foreground text-xs pointer-events-none">
            <Clock className="h-3 w-3" />
            {timeAgo(project.updated_at)}
          </div>
          <Badge variant="outline" className="text-[10px] min-w-14 justify-center pointer-events-none">Active</Badge>
          <button
            onClick={handleDelete}
            disabled={deleting}
            onBlur={() => setConfirming(false)}
            className={`cursor-pointer flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
              confirming
                ? "bg-destructive/20 text-destructive border border-destructive/40 hover:bg-destructive/30"
                : "text-muted-foreground hover:text-destructive"
            }`}
          >
            {deleting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Trash2 className="h-3 w-3" />
            )}
            {confirming && !deleting && <span>Confirm</span>}
          </button>
        </div>
      </div>
    </motion.div>
  )
}
