"use client"

import { useEffect, useRef, useCallback } from "react"
import { useProjectStore } from "@/store/project-store"

export interface RunEvent {
  type: string
  run_id?: string
  agent_id?: string
  name?: string
  role?: string
  tool?: string
  input?: unknown
  output?: string
  content?: string
  summary?: string
  error?: string
  message?: string
  pause_id?: string
  pause_type?: "input" | "confirm" | "dangerous"
  question?: string
  response?: string
  [key: string]: unknown
}

interface UseRunStreamOptions {
  projectId: string
  runId: string
  token: string | undefined
  enabled: boolean
}

const WS_BASE = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000"
const CONNECT_TIMEOUT_MS = 10_000
const MAX_RETRIES = 3

export function useRunStream({ projectId, runId, token, enabled }: UseRunStreamOptions) {
  const { setPlanPhase, runEvents, planPhase, setHitlPause } = useProjectStore()
  const wsRef = useRef<WebSocket | null>(null)
  const retriesRef = useRef(0)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const unmountedRef = useRef(false)
  // Set to true after a terminal event — prevents retry loop
  const doneRef = useRef(false)
  // Mirror of store's runEvents.length so connect() closure always reads latest value
  const seenCountRef = useRef(runEvents.length)

  // Keep seenCountRef in sync with store (survives tab switches)
  seenCountRef.current = runEvents.length

  // If run already finished (e.g. page reload onto a complete/error run), mark done immediately
  // so we never open a WS connection just to replay events we already have
  const isTerminal = planPhase === "complete" || planPhase === "error"
  if (isTerminal) doneRef.current = true

  const connect = useCallback(() => {
    if (!token || !enabled || unmountedRef.current || doneRef.current) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    const ws = new WebSocket(`${WS_BASE}/ws/projects/${projectId}`)
    wsRef.current = ws

    timeoutRef.current = setTimeout(() => {
      if (ws.readyState !== WebSocket.OPEN) {
        ws.close()
        if (!unmountedRef.current) {
          window.dispatchEvent(new CustomEvent("run-event", { detail: { type: "run_error", error: "WebSocket connection timed out. Is the backend running?" } }))
          setPlanPhase("error")
          doneRef.current = true
        }
      }
    }, CONNECT_TIMEOUT_MS)

    ws.onopen = () => {
      // Tell the backend how many events we've already seen so it skips them on replay
      ws.send(JSON.stringify({ type: "auth", token, run_id: runId, seen: seenCountRef.current }))
    }

    ws.onmessage = (e) => {
      if (unmountedRef.current) return
      let event: RunEvent
      try { event = JSON.parse(e.data) } catch { return }

      if (event.type === "ack") return
      if (event.type === "connected") {
        retriesRef.current = 0
        if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
        return
      }
      if (event.type === "error") {
        window.dispatchEvent(new CustomEvent("run-event", { detail: { type: "run_error", error: event.detail as string ?? "WebSocket auth error" } }))
        setPlanPhase("error")
        doneRef.current = true
        return
      }

      window.dispatchEvent(new CustomEvent("run-event", { detail: event }))

      if (event.type === "run_complete") {
        doneRef.current = true
        setPlanPhase("complete")
        ws.close()
      } else if (event.type === "run_error") {
        doneRef.current = true
        setPlanPhase("error")
        ws.close()
      } else if (event.type === "hitl_pause") {
        setHitlPause({ pause_id: event.pause_id as string, question: event.question as string, pause_type: event.pause_type as string })
      } else if (event.type === "hitl_resumed") {
        setHitlPause(null)
      } else if (event.type === "run_paused") {
        // keep executing phase but HITL pause is now shown
      }
    }

    ws.onerror = () => { ws.close() }

    ws.onclose = () => {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null }
      wsRef.current = null
      // Only retry if not done and not intentionally closed
      if (!unmountedRef.current && !doneRef.current && enabled && retriesRef.current < MAX_RETRIES) {
        retriesRef.current++
        setTimeout(connect, 1500 * retriesRef.current)
      }
    }
  }, [projectId, runId, token, enabled, setPlanPhase]) // seenCountRef synced via render, not closure

  useEffect(() => {
    unmountedRef.current = false
    doneRef.current = false
    // seenCountRef is kept in sync with runEvents.length above — do NOT reset it here
    if (enabled) connect()
    return () => {
      unmountedRef.current = true
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [enabled, connect])

  const send = useCallback((msg: object) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg))
    }
  }, [])

  return { send }
}
