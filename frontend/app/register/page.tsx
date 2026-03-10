"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { encryptPayload } from "@/lib/crypto";
import { Loader2 } from "lucide-react";
import { Logo } from "@/components/logo";
import Link from "next/link";

export default function RegisterPage() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      const encryptedData = encryptPayload({ username, email, password });

      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ encrypted: encryptedData }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || "Registration failed");
      }

      router.push("/login");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <Logo size="lg" />
          <p className="text-xs text-muted-foreground">Create your account</p>
        </div>

        {/* Card */}
        <div className="rounded-xl border border-border bg-card p-8 space-y-5">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="username" className="text-[10px] text-muted-foreground uppercase tracking-widest">
                Username
              </label>
              <input
                type="text"
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="w-full px-3 py-2.5 bg-input border border-border rounded-lg text-sm text-foreground outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/40"
                placeholder="yourname"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="email" className="text-[10px] text-muted-foreground uppercase tracking-widest">
                Email
              </label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 bg-input border border-border rounded-lg text-sm text-foreground outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/40"
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-[10px] text-muted-foreground uppercase tracking-widest">
                Password
              </label>
              <input
                type="password"
                id="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 bg-input border border-border rounded-lg text-sm text-foreground outline-none focus:border-primary transition-colors placeholder:text-muted-foreground/40"
                placeholder="••••••••"
                required
              />
            </div>

            {error && (
              <p className="text-xs text-destructive border border-destructive/30 bg-destructive/10 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-2"
            >
              {isLoading ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Creating account…</>
              ) : (
                "Create account"
              )}
            </button>
          </form>

          <p className="text-center text-xs text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="text-primary hover:text-primary/80 transition-colors font-medium">
              Sign in
            </Link>
          </p>
        </div>

        <p className="text-center text-[10px] text-muted-foreground/40">
          <Link href="/home" className="hover:text-muted-foreground transition-colors">
            Back to home
          </Link>
        </p>
      </div>
    </div>
  );
}
