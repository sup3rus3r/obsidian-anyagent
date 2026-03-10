"""
Orchestrator — analyzes a user task and produces an AgentTeamPlan.

Uses JSON-in-text extraction so it works with any model (no structured
output API required).
"""

import json
import logging
import re
from typing import Optional
from pydantic import BaseModel, Field
from agno.agent import Agent

from model_router import build_model

logger = logging.getLogger(__name__)


# ── AgentTeamPlan schema ─────────────────────────────────────────────────────

class PlannedAgent(BaseModel):
    """A single agent in the proposed team."""
    agent_id: str = Field(description="Unique ID for this agent instance within the plan (e.g. 'research_1')")
    name: str = Field(description="Display name (e.g. 'ResearchAgent')")
    role: str = Field(description="One-sentence description of this agent's role in the task")
    instructions: str = Field(description="Specific instructions tailored to this task (not generic)")
    tools: list[str] = Field(description="Tool IDs this agent needs (e.g. ['web_search', 'url_fetch'])")
    model_override: Optional[str] = Field(default=None, description="Optional model override for this agent")
    depends_on: list[str] = Field(default=[], description="agent_ids this agent waits for before starting")
    is_dynamic: bool = Field(default=False, description="True if this is a newly proposed agent type not in the base library")


class AgentTeamPlan(BaseModel):
    """The full proposed plan returned by the orchestrator."""
    task_summary: str = Field(description="One sentence summary of the task")
    team_mode: str = Field(description="Agno team mode: 'coordinate', 'route', 'broadcast', or 'tasks'")
    agents: list[PlannedAgent] = Field(description="Ordered list of agents to assemble")
    execution_steps: list[str] = Field(description="High-level steps the team will take, in order")
    clarifications: list[str] = Field(
        default=[],
        description="Questions for the user before execution starts (empty if task is clear)"
    )
    estimated_complexity: str = Field(
        description="'low', 'medium', or 'high' — how complex this task is"
    )
    new_agent_definitions: list[dict] = Field(
        default=[],
        description="Definitions for any dynamically proposed agents (name, role, instructions, tools)"
    )


# ── System prompt ────────────────────────────────────────────────────────────

_ORCHESTRATOR_SYSTEM = """You are the Orchestrator for an AI agent platform called Obsidian Any Agent.

Your job is to analyze the user's task and produce a structured AgentTeamPlan that:
1. Selects the right specialist agents from the available catalog
2. Assigns each agent a specific role and task-specific instructions
3. Defines execution order and dependencies between agents
4. Identifies any gaps requiring a new dynamic agent type
5. Asks clarifying questions only when genuinely ambiguous

## Available Base Agents
- OrchestratorAgent: coordination and task decomposition
- ResearchAgent: web search, fact-finding, URL fetching
- CodeAgent: write and execute code in a Docker sandbox
- FileAgent: read/write/transform files, CSV/JSON parsing
- BrowserAgent: web automation, scraping, form filling
- DataAgent: data analysis, statistics, chart generation
- APIAgent: call external REST APIs using vault-stored credentials
- WriterAgent: draft documents, reports, structured content
- ReviewerAgent: review and QA outputs from other agents

## Available Tools (by ID)
web_search, url_fetch, knowledge_base, docker_exec, file_read, file_write,
bash, csv_parse, gridfs_upload, browser_navigate, browser_extract,
browser_click, pandas_tools, chart_generation, http_client, vault_key_inject,
template_tools, diff_tools, task_planning, hitl_escalation

## Team Modes
- coordinate: leader delegates subtasks, synthesizes results (default)
- route: leader routes each request to exactly one member
- broadcast: all members work on same task simultaneously
- tasks: iterative loop, leader drives members in cycles

## Rules
- Only include agents that are genuinely needed for this task
- Write task-specific instructions, not generic role descriptions
- CRITICAL: Always set depends_on to create a proper execution chain. The first agent(s) have depends_on=[]. Every subsequent agent MUST list the agent_ids it depends on. Example: agent B that uses A's output must have depends_on=["a_id"]. NEVER leave all agents with empty depends_on when there are 2+ agents — that produces a disconnected graph with no execution order.
- Mark is_dynamic=true and add to new_agent_definitions for novel agent types
- Use clarifications sparingly — only for truly ambiguous tasks
- estimated_complexity: low (1-2 agents, simple), medium (3-4 agents), high (5+ agents or complex)
- Always include at least one agent that produces a concrete output
- Agents should produce the actual deliverable (code, data, report) — not multiple meta-files describing what they did
- At most one README.md is acceptable to explain how to use the output, but do NOT create separate summary, changelog, architecture, or other .md files
- Keep agent instructions concise and action-oriented — tell agents what to produce, not how to narrate it
- Prefer fewer agents: if 1-2 agents can do the job, use them. Avoid padding with reviewer/coordinator agents on simple tasks

## Output format
Respond ONLY with a JSON object (no prose before or after) matching this schema:
{
  "task_summary": "...",
  "team_mode": "coordinate|route|broadcast|tasks",
  "agents": [
    {
      "agent_id": "unique_snake_case_id",
      "name": "DisplayName",
      "role": "one sentence",
      "instructions": "task-specific instructions",
      "tools": ["tool_id", ...],
      "model_override": null,
      "depends_on": ["other_agent_id", ...],
      "is_dynamic": false
    }
  ],
  "execution_steps": ["step 1", "step 2", ...],
  "clarifications": [],
  "estimated_complexity": "low|medium|high",
  "new_agent_definitions": []
}"""


# ── Orchestrator builder ─────────────────────────────────────────────────────

def build_orchestrator(model_id: str = "claude-sonnet-4-6", vault_secrets: list[dict] = [], lmstudio_url: Optional[str] = None) -> Agent:
    model = build_model(model_id, vault_secrets, lmstudio_url=lmstudio_url)
    return Agent(
        name="Orchestrator",
        model=model,
        instructions=_ORCHESTRATOR_SYSTEM,
    )


async def plan_task(
    task: str,
    model_id: str = "claude-sonnet-4-6",
    vault_secrets: list[dict] = [],
    agent_library: list[dict] = [],
    lmstudio_url: Optional[str] = None,
) -> AgentTeamPlan:
    """
    Run the orchestrator on a task and return a structured AgentTeamPlan.
    """
    orchestrator = build_orchestrator(model_id, vault_secrets, lmstudio_url=lmstudio_url)

    # Inject user's custom agents into context if any exist beyond base agents
    user_agents = [a for a in agent_library if not a.get("is_base", True)]
    extra_context = ""
    if user_agents:
        extra_context = "\n\n## Additional agents from your personal library:\n"
        for a in user_agents:
            extra_context += f"- {a['name']}: {a['role']}\n"

    prompt = f"Plan the following task:\n\n{task}{extra_context}"

    response = await orchestrator.arun(prompt)

    # agno RunResponse.content can be: AgentTeamPlan, dict, str, or list of content blocks
    content = response.content
    logger.debug("Orchestrator raw content type=%s value=%r", type(content).__name__, str(content)[:200])

    if isinstance(content, AgentTeamPlan):
        return _ensure_sequential_deps(content)
    if isinstance(content, dict):
        return _ensure_sequential_deps(AgentTeamPlan(**content))

    # Flatten list of content blocks (agno may return [TextContent(...), ...])
    if isinstance(content, list):
        parts = []
        for block in content:
            if isinstance(block, str):
                parts.append(block)
            elif hasattr(block, "text"):
                parts.append(block.text)
            elif hasattr(block, "content"):
                parts.append(str(block.content))
            else:
                parts.append(str(block))
        text = "".join(parts)
    else:
        text = str(content)

    # Extract JSON from text (model returns markdown with ```json ... ``` block or raw JSON)
    m = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    if m:
        return _ensure_sequential_deps(AgentTeamPlan.model_validate_json(m.group(1)))
    # Fall back: find first { ... } spanning the whole JSON object
    start = text.find("{")
    if start != -1:
        depth = 0
        for i, ch in enumerate(text[start:], start):
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    return _ensure_sequential_deps(AgentTeamPlan.model_validate_json(text[start:i+1]))
    raise ValueError(f"Could not extract AgentTeamPlan JSON from orchestrator response. Raw content type: {type(content).__name__}. Preview: {text[:300]}")


def _ensure_sequential_deps(plan: AgentTeamPlan) -> AgentTeamPlan:
    """
    Fallback: if all agents have empty depends_on (disconnected graph),
    wire them sequentially so the graph has edges.
    """
    agents = plan.agents
    if len(agents) < 2:
        return plan
    all_empty = all(len(a.depends_on) == 0 for a in agents)
    if not all_empty:
        return plan
    # Auto-wire: each agent depends on the previous one
    wired = []
    for i, agent in enumerate(agents):
        if i == 0:
            wired.append(agent)
        else:
            wired.append(agent.model_copy(update={"depends_on": [agents[i - 1].agent_id]}))
    return plan.model_copy(update={"agents": wired})
