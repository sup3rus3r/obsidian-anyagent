'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Logo } from '@/components/logo'

export default function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)
    const result = await signIn('credentials', { username, password, redirect: false })
    setIsLoading(false)
    if (result?.error) {
      setError('Invalid username or password')
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div className="h-[400px] w-[400px] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-[380px]"
      >
        <div className="flex justify-center mb-8">
          <Logo size="lg" />
        </div>

        <div className="rounded-xl border border-border bg-card p-8 shadow-lg w-full">
          <h1 className="text-lg font-semibold text-foreground mb-1">Sign in</h1>
          <p className="text-xs text-muted-foreground mb-6">Enter your credentials to access the platform</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Username</label>
              <Input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username"
                autoComplete="username"
                disabled={isLoading}
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Password</label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                disabled={isLoading}
                required
              />
            </div>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <Button type="submit" disabled={isLoading} className="w-full gap-2 mt-2" size="lg">
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
              {isLoading ? 'Signing in...' : 'Sign in'}
            </Button>
          </form>
        </div>

        <p className="text-center text-xs text-muted-foreground mt-5">
          Don&apos;t have an account?{' '}
          <a href="/register" className="text-primary hover:underline cursor-pointer">Register</a>
        </p>
      </motion.div>
    </div>
  )
}
