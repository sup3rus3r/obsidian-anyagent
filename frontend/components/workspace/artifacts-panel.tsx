"use client"

import { useEffect, useState, useRef } from "react"
import { useSession } from "next-auth/react"
import { motion, AnimatePresence } from "framer-motion"
import { FileText, Download, Trash2, RefreshCw, Package, Image, Code, FileArchive, Upload, Loader2, FolderSync, X } from "lucide-react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { api, Artifact } from "@/lib/api"

const TEXT_EXTS = new Set(["py","js","ts","json","yaml","yml","sh","md","txt","csv","tsv","html","css","sql","r","toml","cfg","ini","ipynb"])
const IMAGE_EXTS = new Set(["png","jpg","jpeg","gif","svg","webp"])
const MD_EXTS = new Set(["md"])

function isTextFile(filename: string) {
  return TEXT_EXTS.has(filename.split(".").pop()?.toLowerCase() ?? "")
}
function isImageFile(filename: string) {
  return IMAGE_EXTS.has(filename.split(".").pop()?.toLowerCase() ?? "")
}
function isPreviewable(filename: string) {
  return isTextFile(filename) || isImageFile(filename)
}

interface ArtifactsPanelProps {
  projectId: string
  runId?: string
}

function fileIcon(filename: string, mime?: string) {
  const ext = filename.split(".").pop()?.toLowerCase() ?? ""
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return Image
  if (["py", "js", "ts", "json", "yaml", "yml", "sh", "md", "txt", "csv"].includes(ext)) return Code
  if (["zip", "tar", "gz", "tgz"].includes(ext)) return FileArchive
  return FileText
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function timeAgo(dateStr: string): string {
  const d = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z")
  const diff = Math.floor((Date.now() - d.getTime()) / 1000)
  if (diff < 60) return "just now"
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

export function ArtifactsPanel({ projectId, runId }: ArtifactsPanelProps) {
  const { data: session } = useSession()
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [loading, setLoading] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ artifact: Artifact; content: string; isImage: boolean; blobUrl?: string } | null>(null)
  const [loadingPreview, setLoadingPreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [harvesting, setHarvesting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function load() {
    if (!session?.accessToken) return
    setLoading(true)
    try {
      const list = await api.artifacts.list(session.accessToken, projectId)
      setArtifacts(list)
    } catch {
      // silent
    } finally {
      setLoading(false)
    }
  }

  // Load all project files (inputs + outputs); runId is passed for context only
  useEffect(() => { load() }, [projectId, session?.accessToken])

  // Re-fetch when a run completes
  useEffect(() => {
    function onEvent(e: Event) {
      const ev = (e as CustomEvent).detail
      if (ev.type === "run_complete") {
        setTimeout(load, 1000) // small delay for files to be written
      }
    }
    window.addEventListener("run-event", onEvent)
    return () => window.removeEventListener("run-event", onEvent)
  }, [projectId, runId, session?.accessToken])

  async function handlePreview(artifact: Artifact) {
    if (!session?.accessToken) return
    if (preview?.artifact.id === artifact.id) { setPreview(null); return }
    setLoadingPreview(artifact.id)
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      })
      if (!res.ok) throw new Error("Failed to load")
      if (isImageFile(artifact.filename)) {
        const blob = await res.blob()
        const blobUrl = URL.createObjectURL(blob)
        setPreview({ artifact, content: "", isImage: true, blobUrl })
      } else {
        const text = await res.text()
        setPreview({ artifact, content: text, isImage: false })
      }
    } catch {
      // silent
    } finally {
      setLoadingPreview(null)
    }
  }

  async function handleDownload(id: string, filename: string) {
    if (!session?.accessToken) return
    setDownloadingId(id)
    try {
      await api.artifacts.download(session.accessToken, id, filename)
    } catch (err) {
      console.error("Download failed:", err)
    } finally {
      setDownloadingId(null)
    }
  }

  async function handleDelete(id: string) {
    if (!session?.accessToken) return
    setDeletingId(id)
    try {
      await api.artifacts.delete(session.accessToken, id)
      setArtifacts(prev => prev.filter(a => a.id !== id))
    } finally {
      setDeletingId(null)
    }
  }

  async function handleHarvest() {
    if (!session?.accessToken || !runId) return
    setHarvesting(true)
    try {
      await api.runs.harvest(session.accessToken, projectId, runId)
      await load()
    } catch (err) {
      console.error("Harvest failed:", err)
    } finally {
      setHarvesting(false)
    }
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !session?.accessToken) return
    setUploading(true)
    try {
      const artifact = await api.artifacts.uploadToWorkspace(session.accessToken, projectId, file)
      setArtifacts(prev => [artifact, ...prev])
    } catch (err) {
      console.error("Upload failed:", err)
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  return (
    <div className="flex h-full min-h-0 gap-0">
      {/* File list column */}
      <div className={`flex flex-col ${preview ? "w-64 shrink-0 border-r border-border" : "flex-1"} min-h-0`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            <Package className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium text-foreground">Files</span>
            {artifacts.length > 0 && (
              <span className="text-[10px] text-muted-foreground bg-muted rounded-full px-1.5 py-0.5">
                {artifacts.length}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {runId && (
              <button
                onClick={handleHarvest}
                disabled={harvesting}
                title="Sync files from workspace"
                className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
              >
                {harvesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderSync className="h-3.5 w-3.5" />}
              </button>
            )}
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Upload file to workspace"
              className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            >
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={load}
              disabled={loading}
              className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
          <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
        </div>

        <div className="flex-1 overflow-y-auto">
          {artifacts.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-2 text-muted-foreground/50 py-12">
              <Package className="h-8 w-8" />
              <p className="text-xs">No files yet</p>
              {runId && (
                <button onClick={handleHarvest} disabled={harvesting} className="cursor-pointer text-xs text-primary/60 hover:text-primary transition-colors">
                  {harvesting ? "Syncing…" : "Sync files from workspace"}
                </button>
              )}
              <button onClick={() => fileInputRef.current?.click()} className="cursor-pointer text-xs text-muted-foreground/50 hover:text-muted-foreground transition-colors">
                Upload a file for agents to use
              </button>
            </div>
          ) : (
            <AnimatePresence initial={false}>
              {artifacts.map((artifact) => {
                const Icon = fileIcon(artifact.filename, artifact.mime_type)
                const isSelected = preview?.artifact.id === artifact.id
                const canPreview = isPreviewable(artifact.filename)
                return (
                  <motion.div
                    key={artifact.id}
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, x: -10 }}
                    onClick={() => canPreview && handlePreview(artifact)}
                    className={[
                      "flex items-center gap-3 px-4 py-2.5 border-b border-border/50 group",
                      canPreview ? "cursor-pointer hover:bg-muted/30" : "",
                      isSelected ? "bg-muted/40" : "",
                    ].join(" ")}
                  >
                    {loadingPreview === artifact.id
                      ? <Loader2 className="h-4 w-4 text-muted-foreground shrink-0 animate-spin" />
                      : <Icon className="h-4 w-4 text-muted-foreground shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-foreground truncate">{artifact.filename}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {formatSize(artifact.size)} · {timeAgo(artifact.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      <button
                        onClick={() => handleDownload(artifact.id, artifact.filename)}
                        disabled={downloadingId === artifact.id}
                        className="cursor-pointer p-1 text-muted-foreground hover:text-foreground rounded transition-colors disabled:opacity-40"
                        title="Download"
                      >
                        {downloadingId === artifact.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                      </button>
                      <button
                        onClick={() => handleDelete(artifact.id)}
                        disabled={deletingId === artifact.id}
                        className="cursor-pointer p-1 text-muted-foreground hover:text-destructive rounded transition-colors disabled:opacity-40"
                        title="Delete"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          )}
        </div>
      </div>

      {/* Preview pane */}
      {preview && (
        <div className="flex-1 min-w-0 flex flex-col min-h-0">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
            <span className="text-xs font-medium text-foreground truncate">{preview.artifact.filename}</span>
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => handleDownload(preview.artifact.id, preview.artifact.filename)}
                className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors"
                title="Download"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
              <button onClick={() => setPreview(null)} className="cursor-pointer text-muted-foreground hover:text-foreground transition-colors">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex-1 overflow-auto p-4 min-h-0">
            {preview.isImage ? (
              <img src={preview.blobUrl} alt={preview.artifact.filename} className="max-w-full h-auto rounded" />
            ) : MD_EXTS.has(preview.artifact.filename.split(".").pop()?.toLowerCase() ?? "") ? (
              <div className="prose prose-invert prose-sm max-w-none text-foreground/80">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    p: ({ children }) => <p className="text-xs text-foreground/80 mb-2 leading-relaxed">{children}</p>,
                    h1: ({ children }) => <h1 className="text-sm font-semibold text-foreground mb-2 mt-4">{children}</h1>,
                    h2: ({ children }) => <h2 className="text-xs font-semibold text-foreground mb-2 mt-3">{children}</h2>,
                    h3: ({ children }) => <h3 className="text-xs font-semibold text-foreground/90 mb-1 mt-2">{children}</h3>,
                    ul: ({ children }) => <ul className="text-xs text-foreground/80 list-disc pl-4 mb-2 space-y-1">{children}</ul>,
                    ol: ({ children }) => <ol className="text-xs text-foreground/80 list-decimal pl-4 mb-2 space-y-1">{children}</ol>,
                    li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                    code: ({ children, className }) => {
                      const isBlock = className?.includes("language-")
                      return isBlock
                        ? <code className="block bg-black/40 rounded p-2 text-[11px] text-green-400/80 whitespace-pre-wrap overflow-x-auto my-2 font-mono">{children}</code>
                        : <code className="bg-black/40 rounded px-1 text-[11px] text-green-400/80 font-mono">{children}</code>
                    },
                    pre: ({ children }) => <pre className="my-2">{children}</pre>,
                    blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-3 my-2 text-xs text-foreground/60 italic">{children}</blockquote>,
                    strong: ({ children }) => <strong className="font-semibold text-foreground/90">{children}</strong>,
                    a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary/80 hover:text-primary underline">{children}</a>,
                    table: ({ children }) => <div className="overflow-x-auto my-2"><table className="text-xs border-collapse w-full">{children}</table></div>,
                    th: ({ children }) => <th className="border border-border/50 px-2 py-1 text-left font-semibold text-foreground/80 bg-muted/30">{children}</th>,
                    td: ({ children }) => <td className="border border-border/50 px-2 py-1 text-foreground/70">{children}</td>,
                    hr: () => <hr className="border-border/50 my-3" />,
                  }}
                >
                  {preview.content}
                </ReactMarkdown>
              </div>
            ) : (
              <pre className="text-[11px] text-foreground/80 whitespace-pre-wrap font-mono leading-relaxed">{preview.content}</pre>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
