import Link from "next/link"
import { Logo } from "@/components/logo"
import { ArrowRight, Bot, GitBranch, Shield, Zap, Terminal, Eye, Layers } from "lucide-react"

const FEATURES = [
  { icon: Bot, title: "Multi-Agent Teams", desc: "Orchestrate specialist agents (Research, Code, Browser, Data, Writer) that collaborate on complex tasks automatically planned from a single prompt." },
  { icon: GitBranch, title: "Visual DAG Planner", desc: "See your agent pipeline as an interactive graph before execution. Edit, reorder, and connect agents. Dependencies resolved automatically." },
  { icon: Eye, title: "Human-in-the-Loop", desc: "Agents pause and ask for your input at critical decision points. Approve, reject, or redirect — stay in control of every run." },
  { icon: Terminal, title: "Sandboxed Execution", desc: "Each project gets an isolated Docker container. Code runs safely, files are persisted, and you get a live terminal to inspect the workspace." },
  { icon: Shield, title: "Encrypted Secrets Vault", desc: "Store API keys and credentials encrypted at rest. Agents inject secrets at runtime — values are never exposed via the API." },
  { icon: Layers, title: "Any Model, Any Provider", desc: "Claude, GPT-4o, Gemini, local LM Studio, Ollama — route any agent to any model. Mix providers in a single pipeline." },
]

const STACK = ["Next.js 16", "FastAPI", "React 19", "Tailwind CSS 4", "Agno 2.5", "MongoDB / SQLite", "Docker", "Zustand"]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border/50 px-6 py-4 flex items-center justify-between sticky top-0 z-10 bg-background/90 backdrop-blur-sm">
        <Logo size="md" />
        <nav className="flex items-center gap-6">
          <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a>
          <a href="#quickstart" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Quickstart</a>
          <Link href="/login" className="text-sm px-4 py-1.5 rounded border border-border hover:border-primary/50 text-muted-foreground hover:text-foreground transition-colors">Sign in</Link>
          <Link href="/register" className="text-sm px-4 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium">Get started</Link>
        </nav>
      </header>

      <section className="relative flex flex-col items-center justify-center text-center px-6 py-32 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] rounded-full bg-primary/5 blur-3xl" />
        </div>
        <div className="relative">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary mb-8">
            <Zap className="h-3 w-3" />
            Open-source · Self-hosted · No vendor lock-in
          </div>
          <h1 className="text-5xl sm:text-6xl font-bold tracking-tight text-foreground mb-6 max-w-3xl">
            Multi-agent automation, <span className="text-primary">any model,</span> your infrastructure
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mb-10 leading-relaxed">
            Obsidian Any Agent lets you build, deploy, and orchestrate AI agent teams from a single prompt.
            Plan visually, execute safely in Docker, stay in control with human-in-the-loop.
          </p>
          <div className="flex flex-col sm:flex-row items-center gap-4 justify-center">
            <Link href="/register" className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors">
              Start for free <ArrowRight className="h-4 w-4" />
            </Link>
            <a href="https://github.com/sup3rus3r/obsidian-anyagent" target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 px-6 py-3 border border-border rounded-lg text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors text-sm">
              View on GitHub
            </a>
          </div>
        </div>
      </section>

      <section id="features" className="px-6 py-24 max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-bold text-foreground mb-4">Everything you need to automate with agents</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">From planning to execution, Obsidian Any Agent handles the complexity so you can focus on results.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {FEATURES.map((f) => {
            const Icon = f.icon
            return (
              <div key={f.title} className="rounded-xl border border-border bg-card p-6 hover:border-primary/30 transition-colors group">
                <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center mb-4 group-hover:bg-primary/20 transition-colors">
                  <Icon className="h-5 w-5 text-primary" />
                </div>
                <h3 className="text-sm font-semibold text-foreground mb-2">{f.title}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
              </div>
            )
          })}
        </div>
      </section>

      <section id="quickstart" className="px-6 py-24 bg-card/50 border-y border-border">
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground mb-4">Up and running in minutes</h2>
            <p className="text-muted-foreground">Self-hosted, zero cloud dependencies. Docker Compose or manual setup.</p>
          </div>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-3">1 · Clone and configure</p>
              <pre className="text-xs text-foreground/80 font-mono leading-relaxed">{`git clone https://github.com/sup3rus3r/obsidian-anyagent.git
cd obsidian-anyagent
cp backend/.env.example backend/.env
cp frontend/.env.local.example frontend/.env.local`}</pre>
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-3">2 · Start with Docker Compose</p>
              <pre className="text-xs text-foreground/80 font-mono">docker compose up -d</pre>
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-3">3 · Or run locally</p>
              <pre className="text-xs text-foreground/80 font-mono leading-relaxed">{`# Backend
cd backend && uv sync && uv run uvicorn main:app --reload

# Frontend
cd frontend && npm install && npm run dev`}</pre>
            </div>
            <div className="rounded-lg border border-border bg-background p-4">
              <p className="text-[10px] text-muted-foreground uppercase tracking-widest mb-3">4 · Open the app</p>
              <pre className="text-xs text-primary font-mono">http://localhost:3000</pre>
            </div>
          </div>
        </div>
      </section>

      <section className="px-6 py-16 max-w-4xl mx-auto text-center">
        <p className="text-xs text-muted-foreground uppercase tracking-widest mb-8">Built with</p>
        <div className="flex flex-wrap gap-3 justify-center">
          {STACK.map((s) => (
            <span key={s} className="text-xs font-mono border border-border rounded px-3 py-1.5 text-muted-foreground hover:border-primary/30 hover:text-foreground transition-colors">{s}</span>
          ))}
        </div>
      </section>

      <section className="px-6 py-24 text-center border-t border-border">
        <h2 className="text-3xl font-bold text-foreground mb-4">Ready to deploy your first agent?</h2>
        <p className="text-muted-foreground mb-8 max-w-md mx-auto">Create an account, add your API keys to the vault, and run your first multi-agent task in under 5 minutes.</p>
        <Link href="/register" className="inline-flex items-center gap-2 px-8 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors">
          Get started free <ArrowRight className="h-4 w-4" />
        </Link>
      </section>

      <footer className="border-t border-border px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <Logo size="sm" />
        <p className="text-xs text-muted-foreground">Open-source under AGPL v3 · <a href="https://github.com/sup3rus3r/obsidian-anyagent" target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">GitHub</a></p>
      </footer>
    </div>
  )
}
