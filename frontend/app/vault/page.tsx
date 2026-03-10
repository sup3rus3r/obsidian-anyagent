"use client"

import { useEffect, useState } from "react"
import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Plus, Trash2, Eye, EyeOff, KeyRound, Loader2, Pencil, Check, X } from "lucide-react"
import { motion, AnimatePresence } from "framer-motion"
import { api, VaultSecret } from "@/lib/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Logo } from "@/components/logo"

const SUGGESTED_LABELS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GITHUB_TOKEN",
  "SERPAPI_KEY",
]

export default function VaultPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  const [secrets, setSecrets] = useState<VaultSecret[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")

  // Add form state
  const [addLabel, setAddLabel] = useState("")
  const [addValue, setAddValue] = useState("")
  const [showValue, setShowValue] = useState(false)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState("")

  useEffect(() => {
    if (status === "unauthenticated") router.push("/login")
  }, [status, router])

  useEffect(() => {
    if (status !== "authenticated" || !session?.accessToken) return
    api.vault.list(session.accessToken)
      .then(setSecrets)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [status, session?.accessToken])

  async function handleAdd() {
    if (!addLabel.trim() || !addValue.trim() || !session?.accessToken) return
    setAdding(true)
    setAddError("")
    try {
      const secret = await api.vault.create(session.accessToken, addLabel.trim(), addValue.trim())
      setSecrets(prev => [...prev, secret])
      setAddLabel("")
      setAddValue("")
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : "Failed to add secret")
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(id: string) {
    if (!session?.accessToken) return
    await api.vault.delete(session.accessToken, id)
    setSecrets(prev => prev.filter(s => s.id !== id))
  }

  async function handleUpdate(id: string, value: string) {
    if (!session?.accessToken) return
    const updated = await api.vault.update(session.accessToken, id, value)
    setSecrets(prev => prev.map(s => s.id === id ? updated : s))
  }

  if (loading || status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur-sm px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/dashboard" className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <Logo size="sm" showText={false} />
          <span className="text-sm font-medium text-foreground">Secrets Vault</span>
        </div>
        <p className="text-xs text-muted-foreground hidden sm:block">Values are encrypted at rest and never returned by the API</p>
      </header>

      <main className="max-w-2xl mx-auto px-6 py-10 space-y-8">

        {/* Add new secret */}
        <div className="rounded-lg border border-border bg-card p-5 space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium text-foreground">Add Secret</p>
          </div>

          {/* Suggested labels */}
          <div className="flex flex-wrap gap-2">
            {SUGGESTED_LABELS.filter(l => !secrets.find(s => s.label === l)).map(l => (
              <button
                key={l}
                onClick={() => setAddLabel(l)}
                className="cursor-pointer text-[10px] font-mono text-muted-foreground hover:text-primary border border-border hover:border-primary/40 rounded px-2 py-1 transition-colors"
              >
                {l}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            <Input
              value={addLabel}
              onChange={e => setAddLabel(e.target.value)}
              placeholder="Label e.g. ANTHROPIC_API_KEY"
              className="font-mono text-xs flex-1"
              disabled={adding}
            />
          </div>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showValue ? "text" : "password"}
                value={addValue}
                onChange={e => setAddValue(e.target.value)}
                placeholder="Secret value"
                className="font-mono text-xs pr-10"
                disabled={adding}
                onKeyDown={e => { if (e.key === "Enter") handleAdd() }}
              />
              <button
                onClick={() => setShowValue(!showValue)}
                className="cursor-pointer absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {showValue ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
            <Button onClick={handleAdd} disabled={!addLabel.trim() || !addValue.trim() || adding} className="gap-2 min-w-24">
              {adding ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              {adding ? "Saving…" : "Add"}
            </Button>
          </div>
          {addError && <p className="text-xs text-destructive">{addError}</p>}
        </div>

        {/* Secrets list */}
        {error && (
          <div className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</div>
        )}

        {secrets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <KeyRound className="h-8 w-8 mb-3 opacity-30" />
            <p className="text-sm">No secrets yet</p>
            <p className="text-xs mt-1">Add your API keys above to use them in agent runs</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-widest mb-3">Stored Secrets</p>
            <AnimatePresence>
              {secrets.map((s, i) => (
                <SecretRow
                  key={s.id}
                  secret={s}
                  index={i}
                  onDelete={() => handleDelete(s.id)}
                  onUpdate={(value) => handleUpdate(s.id, value)}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>
    </div>
  )
}

function SecretRow({
  secret, index, onDelete, onUpdate,
}: {
  secret: VaultSecret
  index: number
  onDelete: () => void
  onUpdate: (value: string) => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [newValue, setNewValue] = useState("")
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [confirming, setConfirming] = useState(false)

  async function saveEdit() {
    if (!newValue.trim()) return
    setSaving(true)
    try {
      await onUpdate(newValue.trim())
      setEditing(false)
      setNewValue("")
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!confirming) { setConfirming(true); return }
    setDeleting(true)
    try { await onDelete() } finally { setDeleting(false); setConfirming(false) }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -8 }}
      transition={{ delay: index * 0.03 }}
      className="rounded-lg border border-border bg-card px-4 py-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <KeyRound className="h-3.5 w-3.5 text-primary/70 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs font-mono font-medium text-foreground truncate">{secret.label}</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {secret.scope === "global" ? "Global" : secret.scope} · ••••••••
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => { setEditing(!editing); setNewValue(""); setConfirming(false) }}
            className="cursor-pointer p-1.5 text-muted-foreground hover:text-foreground rounded transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            onBlur={() => setConfirming(false)}
            className={`cursor-pointer flex items-center gap-1 rounded px-2 py-1 text-[10px] font-medium transition-colors ${
              confirming
                ? "bg-destructive/20 text-destructive border border-destructive/40"
                : "text-muted-foreground hover:text-destructive"
            }`}
          >
            {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            {confirming && !deleting && <span>Confirm</span>}
          </button>
        </div>
      </div>

      <AnimatePresence>
        {editing && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="flex gap-2 mt-3 pt-3 border-t border-border">
              <Input
                type="password"
                value={newValue}
                onChange={e => setNewValue(e.target.value)}
                placeholder="New value"
                className="font-mono text-xs flex-1"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") setEditing(false) }}
              />
              <button
                onClick={saveEdit}
                disabled={!newValue.trim() || saving}
                className="cursor-pointer p-2 text-green-500 hover:text-green-400 disabled:opacity-40 transition-colors"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              </button>
              <button onClick={() => setEditing(false)} className="cursor-pointer p-2 text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}
