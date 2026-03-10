"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  addEdge,
  useNodesState,
  useEdgesState,
  useNodesInitialized,
  useReactFlow,
  Connection,
  BackgroundVariant,
  Panel,
  ReactFlowProvider,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import { AgentNode } from "./agent-node"
import { AgentTeamPlan, PlannedAgent } from "@/lib/api"
import { useProjectStore } from "@/store/project-store"

const NODE_TYPES = { agentNode: AgentNode }

// Generous fixed dimensions — err on the side of too much space
// Real rendered height varies, but we budget for an expanded node
const NODE_W = 310
const NODE_H = 220   // budget for expanded state
const H_GAP = 80
const V_GAP = 100

/**
 * Layered DAG layout — assigns each agent to a layer based on longest
 * dependency chain depth, then spaces within each layer evenly.
 */
function layoutNodes(agents: PlannedAgent[], liveStatus: Record<string, string> = {}) {
  if (agents.length === 0) return []

  const depth: Record<string, number> = {}
  function getDepth(id: string, visited = new Set<string>()): number {
    if (id in depth) return depth[id]
    if (visited.has(id)) return 0
    visited.add(id)
    const agent = agents.find(a => a.agent_id === id)
    if (!agent || agent.depends_on.length === 0) return (depth[id] = 0)
    depth[id] = Math.max(...agent.depends_on.map(dep => getDepth(dep, new Set(visited)) + 1))
    return depth[id]
  }
  agents.forEach(a => getDepth(a.agent_id))

  const layers: string[][] = []
  for (const agent of agents) {
    const d = depth[agent.agent_id] ?? 0
    if (!layers[d]) layers[d] = []
    layers[d].push(agent.agent_id)
  }

  const positions: Record<string, { x: number; y: number }> = {}
  layers.forEach((layer, rowIdx) => {
    const rowWidth = layer.length * NODE_W + (layer.length - 1) * H_GAP
    const startX = -rowWidth / 2
    layer.forEach((id, colIdx) => {
      positions[id] = {
        x: startX + colIdx * (NODE_W + H_GAP),
        y: rowIdx * (NODE_H + V_GAP),
      }
    })
  })

  return agents.map(agent => ({
    id: agent.agent_id,
    type: "agentNode" as const,
    position: positions[agent.agent_id] ?? { x: 0, y: 0 },
    data: { ...agent, editable: true, liveStatus: liveStatus[agent.agent_id] ?? "idle" },
  }))
}

function buildEdges(agents: PlannedAgent[], liveStatus: Record<string, string> = {}) {
  const edges: { id: string; source: string; target: string; animated: boolean; style: object }[] = []
  for (const agent of agents) {
    for (const dep of agent.depends_on) {
      edges.push({
        id: `${dep}->${agent.agent_id}`,
        source: dep,
        target: agent.agent_id,
        animated: liveStatus[dep] === "running" || liveStatus[agent.agent_id] === "running",
        style: { stroke: "oklch(0.35 0.05 46)", strokeWidth: 1.5 },
      })
    }
  }
  return edges
}

interface PlanGraphProps {
  plan: AgentTeamPlan
  editable?: boolean
  liveStatus?: Record<string, "idle" | "running" | "done" | "error">
}

export function PlanGraph({ plan, editable = true, liveStatus = {} }: PlanGraphProps) {
  const { editablePlan } = useProjectStore()

  const initialNodes = useMemo(() => layoutNodes(plan.agents), [plan.agents])
  const initialEdges = useMemo(() => buildEdges(plan.agents), [plan.agents])

  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges)

  // Sync agent list changes (add/remove agents in edit mode)
  const prevAgentsRef = useRef<PlannedAgent[] | undefined>(undefined)
  useEffect(() => {
    const agents = editablePlan?.agents
    if (!agents || agents === prevAgentsRef.current) return
    prevAgentsRef.current = agents
    // Preserve existing positions when re-layouting
    setNodes((prev) => {
      const posMap: Record<string, { x: number; y: number }> = {}
      for (const n of prev) posMap[n.id] = n.position
      return layoutNodes(agents, liveStatus).map((n) =>
        posMap[n.id] ? { ...n, position: posMap[n.id] } : n
      )
    })
    setEdges(buildEdges(agents, liveStatus))
  }, [editablePlan?.agents]) // eslint-disable-line react-hooks/exhaustive-deps

  // Update node data with live status — patch in-place, never rebuild positions
  // Use a serialized key so object identity changes don't cause infinite loops
  const liveStatusKey = JSON.stringify(liveStatus)
  const prevLiveStatusRef = useRef("")
  useEffect(() => {
    if (liveStatusKey === prevLiveStatusRef.current) return
    prevLiveStatusRef.current = liveStatusKey
    setNodes((prev) =>
      prev.map((n) => ({
        ...n,
        data: {
          ...n.data,
          liveStatus: liveStatus[n.id] ?? "idle",
        },
      }))
    )
    setEdges((prev) =>
      prev.map((e) => ({
        ...e,
        animated:
          liveStatus[e.source] === "running" || liveStatus[e.target] === "running",
      }))
    )
  }, [liveStatusKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) =>
        addEdge({ ...connection, style: { stroke: "oklch(0.35 0.05 46)" } }, eds)
      ),
    [setEdges]
  )

  return (
    <div className="w-full h-full rounded-xl overflow-hidden border border-zinc-800">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={editable ? onNodesChange : undefined}
        onEdgesChange={editable ? onEdgesChange : undefined}
        onConnect={editable ? onConnect : undefined}
        nodeTypes={NODE_TYPES}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        nodesDraggable={editable}
        nodesConnectable={editable}
        elementsSelectable={editable}
        colorMode="dark"
        proOptions={{ hideAttribution: true }}
      >
        <CollisionResolver setNodes={setNodes} />
        <Background variant={BackgroundVariant.Dots} color="oklch(0.20 0 0)" gap={20} />
        <Controls className="bg-card! border-border!" />
        <MiniMap
          nodeColor={() => "oklch(0.18 0.03 46)"}
          maskColor="rgba(5,5,5,0.75)"
          className="bg-background! border-border!"
        />
        {editable && (
          <Panel position="top-right" className="text-[10px] text-muted-foreground/50">
            Drag to rearrange · Click node to edit
          </Panel>
        )}
      </ReactFlow>
    </div>
  )
}

const GAP = 20 // minimum gap between any two nodes

/** Runs inside ReactFlow context — resolves overlaps after nodes are measured. */
function CollisionResolver({ setNodes }: { setNodes: ReturnType<typeof useNodesState>[2] }) {
  const initialized = useNodesInitialized()
  const { getNodes, fitView } = useReactFlow()
  const resolvedRef = useRef(false)

  useEffect(() => {
    if (!initialized || resolvedRef.current) return
    resolvedRef.current = true

    const measured = getNodes()
    if (measured.length < 2) return

    // Simple iterative separation: push overlapping nodes apart
    const pos = measured.map(n => ({
      id: n.id,
      x: n.position.x,
      y: n.position.y,
      w: (n.measured?.width ?? NODE_W) + GAP,
      h: (n.measured?.height ?? NODE_H) + GAP,
    }))

    for (let iter = 0; iter < 20; iter++) {
      let moved = false
      for (let i = 0; i < pos.length; i++) {
        for (let j = i + 1; j < pos.length; j++) {
          const a = pos[i], b = pos[j]
          const overlapX = (a.w + b.w) / 2 - Math.abs(a.x - b.x)
          const overlapY = (a.h + b.h) / 2 - Math.abs(a.y - b.y)
          if (overlapX > 0 && overlapY > 0) {
            // Push along the axis of least overlap
            if (overlapX < overlapY) {
              const push = overlapX / 2 + 1
              if (a.x < b.x) { a.x -= push; b.x += push }
              else { a.x += push; b.x -= push }
            } else {
              const push = overlapY / 2 + 1
              if (a.y < b.y) { a.y -= push; b.y += push }
              else { a.y += push; b.y -= push }
            }
            moved = true
          }
        }
      }
      if (!moved) break
    }

    setNodes(prev => prev.map(n => {
      const p = pos.find(p => p.id === n.id)
      return p ? { ...n, position: { x: p.x, y: p.y } } : n
    }))
    // Re-fit after repositioning so all nodes are visible
    setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50)
  }, [initialized]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset resolver when node count changes (new agents added)
  const nodeCount = getNodes().length
  useEffect(() => { resolvedRef.current = false }, [nodeCount])

  return null
}
