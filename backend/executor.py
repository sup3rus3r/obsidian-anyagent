"""
Execution Engine — runs an approved AgentTeamPlan.

Builds a real agno Team from the plan, streams events via the WebSocket
ConnectionManager, and writes results back to MongoDB.

Event types broadcast to frontend:
  { "type": "run_started",   "run_id": "..." }
  { "type": "agent_started", "run_id": "...", "agent_id": "...", "name": "..." }
  { "type": "tool_call",     "run_id": "...", "agent_id": "...", "tool": "...", "input": {...} }
  { "type": "tool_result",   "run_id": "...", "agent_id": "...", "tool": "...", "output": "..." }
  { "type": "agent_output",  "run_id": "...", "agent_id": "...", "content": "..." }
  { "type": "agent_done",    "run_id": "...", "agent_id": "..." }
  { "type": "run_complete",  "run_id": "...", "summary": "..." }
  { "type": "run_error",     "run_id": "...", "error": "..." }
  { "type": "hitl_pause",    "run_id": "...", "pause_id": "...", "question": "...", "pause_type": "input"|"confirm"|"dangerous" }
  { "type": "hitl_resumed",  "run_id": "...", "pause_id": "...", "response": "..." }
  { "type": "run_paused",    "run_id": "..." }
  { "type": "run_resumed",   "run_id": "..." }
"""

import asyncio
import traceback
import uuid
from datetime import datetime, timezone
from typing import Callable, Awaitable, Any

from agno.agent import Agent
from agno.team import Team

from model_router import build_model
from orchestrator import AgentTeamPlan, PlannedAgent


# ── HITL registry ─────────────────────────────────────────────────────────────

# Maps run_id -> asyncio.Event (set = resumed, clear = paused)
_run_events: dict[str, asyncio.Event] = {}
# Maps run_id -> str | None (pending HITL response from user)
_run_hitl_responses: dict[str, str | None] = {}
# Maps run_id -> asyncio.Task (so we can cancel it)
_run_tasks: dict[str, asyncio.Task] = {}


def get_run_event(run_id: str) -> asyncio.Event:
    if run_id not in _run_events:
        _run_events[run_id] = asyncio.Event()
        _run_events[run_id].set()  # start unpaused
    return _run_events[run_id]


def pause_run(run_id: str):
    get_run_event(run_id).clear()


def resume_run(run_id: str, hitl_response: str | None = None):
    _run_hitl_responses[run_id] = hitl_response
    get_run_event(run_id).set()


_cancelled_runs: set[str] = set()


def cancel_run(run_id: str) -> bool:
    """Cancel an in-progress run task. Returns True if a task was found and cancelled."""
    _cancelled_runs.add(run_id)
    task = _run_tasks.get(run_id)
    if task and not task.done():
        # Also unblock any HITL wait so the task can exit cleanly
        resume_run(run_id)
        task.cancel()
        return True
    return False


def is_cancelled(run_id: str) -> bool:
    return run_id in _cancelled_runs


def register_run_task(run_id: str, task: asyncio.Task):
    _run_tasks[run_id] = task


def cleanup_run(run_id: str):
    _run_events.pop(run_id, None)
    _run_hitl_responses.pop(run_id, None)
    _run_tasks.pop(run_id, None)
    _cancelled_runs.discard(run_id)


# ── Tool registry ─────────────────────────────────────────────────────────────

def _make_tools(
    tool_ids: list[str],
    container_id: str | None = None,
    project_id: str | None = None,
    run_id: str | None = None,
    db=None,
) -> list:
    """Return agno tool objects for the requested tool IDs."""
    tools = []
    for tid in tool_ids:
        if tid == "web_search":
            try:
                from agno.tools.duckduckgo import DuckDuckGoTools
                tools.append(DuckDuckGoTools())
            except ImportError:
                pass
        elif tid == "url_fetch":
            try:
                from agno.tools.url import UrlTools
                tools.append(UrlTools())
            except ImportError:
                pass
        elif tid in ("bash", "docker_exec", "shell"):
            if container_id:
                tools.append(_ContainerShellTool(container_id))
            else:
                try:
                    from agno.tools.shell import ShellTools
                    tools.append(ShellTools())
                except ImportError:
                    pass
        elif tid in ("file_read", "file_write", "file"):
            if container_id:
                tools.append(_ContainerFileTool(container_id, project_id=project_id, run_id=run_id, db=db))
            else:
                tools.append(_GridFSFileTool(project_id=project_id, run_id=run_id, db=db))
        elif tid == "python":
            if container_id:
                tools.append(_ContainerPythonTool(container_id))
            else:
                try:
                    from agno.tools.python import PythonTools
                    tools.append(PythonTools())
                except ImportError:
                    pass
    return tools


# ── Container-aware tool wrappers ──────────────────────────────────────────────

from agno.tools import Toolkit as _Toolkit


async def _gridfs_upload(db, filename: str, content: str | bytes, project_id: str | None, run_id: str | None):
    """Upload content to GridFS. Best-effort — never raises."""
    try:
        import io, mimetypes
        from database_mongo import get_gridfs
        from bson import ObjectId as _ObjId
        user_id = ""
        if db and run_id:
            doc = await db["runs"].find_one({"_id": _ObjId(run_id)}, {"user_id": 1})
            user_id = doc.get("user_id", "") if doc else ""
        mime = mimetypes.guess_type(filename)[0] or "text/plain"
        fs = get_gridfs()
        data = content if isinstance(content, bytes) else content.encode("utf-8")
        await fs.upload_from_stream(
            filename,
            io.BytesIO(data),
            metadata={
                "user_id": user_id,
                "project_id": project_id,
                "run_id": run_id,
                "kind": "workspace_output",
                "mime_type": mime,
            },
        )
    except Exception:
        pass


class _ContainerShellTool(_Toolkit):
    """Executes bash commands inside the project's Docker sandbox."""

    def __init__(self, container_id: str):
        self.container_id = container_id
        super().__init__(name="shell_tools")
        self.register(self.run_shell_command)

    async def run_shell_command(self, cmd: str) -> str:
        from services.container_service import exec_in_container
        stdout, stderr, rc = await exec_in_container(self.container_id, cmd)
        result = stdout
        if stderr:
            result += f"\n[stderr]\n{stderr}"
        if rc != 0:
            result += f"\n[exit code: {rc}]"
        return result or "(no output)"


class _ContainerFileTool(_Toolkit):
    """Read/write files inside the project's Docker sandbox via container exec."""

    def __init__(self, container_id: str, project_id: str | None = None, run_id: str | None = None, db=None):
        self.container_id = container_id
        self.project_id = project_id
        self.run_id = run_id
        self.db = db
        super().__init__(name="file_tools")
        self.register(self.read_file)
        self.register(self.write_file)

    async def read_file(self, path: str) -> str:
        from services.container_service import exec_in_container
        safe_path = path if path.startswith("/") else f"//workspace/{path}"
        stdout, stderr, rc = await exec_in_container(self.container_id, f"cat {safe_path}")
        if rc != 0:
            return f"Error reading {path}: {stderr}"
        return stdout

    async def write_file(self, path: str, content: str) -> str:
        from services.container_service import exec_in_container
        safe_path = path if path.startswith("/") else f"//workspace/{path}"
        escaped = content.replace("'", "'\"'\"'")
        cmd = f"mkdir -p $(dirname {safe_path}) && printf '%s' '{escaped}' > {safe_path}"
        stdout, stderr, rc = await exec_in_container(self.container_id, cmd)
        if rc != 0:
            return f"Error writing {path}: {stderr}"
        filename = path.split("/")[-1]
        await _gridfs_upload(self.db, filename, content, self.project_id, self.run_id)
        return f"Written {path}"


class _GridFSFileTool(_Toolkit):
    """Write files directly to GridFS (used when no container is available)."""

    def __init__(self, project_id: str | None = None, run_id: str | None = None, db=None):
        self.project_id = project_id
        self.run_id = run_id
        self.db = db
        super().__init__(name="file_tools")
        self.register(self.read_file)
        self.register(self.write_file)

    async def read_file(self, path: str) -> str:
        filename = path.split("/")[-1]
        try:
            from database_mongo import get_gridfs
            fs = get_gridfs()
            async for grid_out in fs.find(
                {"filename": filename, "metadata.project_id": self.project_id},
                sort=[("uploadDate", -1)],
            ):
                data = await grid_out.read()
                return data.decode("utf-8", errors="replace")
        except Exception:
            pass
        return f"File not found: {path}"

    async def write_file(self, path: str, content: str) -> str:
        filename = path.split("/")[-1]
        await _gridfs_upload(self.db, filename, content, self.project_id, self.run_id)
        return f"Written {path}"


class _ContainerPythonTool(_Toolkit):
    """Run Python code inside the project's Docker sandbox."""

    def __init__(self, container_id: str):
        self.container_id = container_id
        super().__init__(name="python_tools")
        self.register(self.run_python)

    async def run_python(self, code: str) -> str:
        from services.container_service import exec_in_container
        escaped = code.replace("'", "'\"'\"'")
        cmd = (
            f"printf '%s' '{escaped}' > //workspace/_tmp_run.py "
            f"&& python //workspace/_tmp_run.py "
            f"&& rm -f //workspace/_tmp_run.py"
        )
        stdout, stderr, rc = await exec_in_container(self.container_id, cmd)
        result = stdout
        if stderr:
            result += f"\n[stderr]\n{stderr}"
        if rc != 0:
            result += f"\n[exit code: {rc}]"
        return result or "(no output)"


# ── Agent builder ─────────────────────────────────────────────────────────────

def _build_agent(
    planned: PlannedAgent,
    default_model_id: str,
    vault_secrets: list[dict],
    broadcast: Callable[[dict], Awaitable[None]],
    run_id: str,
    container_id: str | None = None,
    lmstudio_url: str | None = None,
    project_id: str | None = None,
    db=None,
) -> Agent:
    model_id = planned.model_override or default_model_id
    model = build_model(model_id, vault_secrets, lmstudio_url=lmstudio_url)
    tools = _make_tools(planned.tools, container_id=container_id, project_id=project_id, run_id=run_id, db=db)

    _concise_prefix = (
        "## Behavior\n"
        "- Act immediately. Do not explain what you are about to do — just do it.\n"
        "- Be terse. One-line status updates only. No preamble, no summaries, no conclusions.\n"
        "- When a tool call produces output, use it directly. Do not re-narrate it.\n"
        "- Do not announce each step before taking it.\n"
        "- Report results concisely: file path, key numbers, or done/error. Nothing more.\n"
        "- Only create files that are direct deliverables of the task. "
        "You may create a single README.md to explain how to use the output. "
        "Do NOT create any other .md files (no summaries, changelogs, architecture docs, etc.).\n\n"
        "## Task\n"
    )
    instructions = _concise_prefix + planned.instructions

    return Agent(
        name=planned.name,
        model=model,
        instructions=instructions,
        tools=tools,
        markdown=False,
    )


# ── Broadcast helper ──────────────────────────────────────────────────────────

async def _safe_broadcast(broadcast: Callable[[dict], Awaitable[None]], event: dict):
    try:
        await broadcast(event)
    except Exception:
        pass


# ── Workspace artifact harvester ─────────────────────────────────────────────

# Extensions we consider "output" files worth uploading
_HARVEST_EXTENSIONS = {
    ".py", ".js", ".ts", ".sh", ".yaml", ".yml", ".json", ".toml", ".cfg", ".ini",
    ".txt", ".md", ".csv", ".tsv", ".html", ".css", ".sql", ".r", ".ipynb",
    ".png", ".jpg", ".jpeg", ".gif", ".svg", ".webp",
    ".pdf", ".zip", ".tar", ".gz",
}
# Skip these input-marker files and anything > 50 MB
_MAX_HARVEST_BYTES = 50 * 1024 * 1024

import mimetypes
import logging as _logging
_harvest_log = _logging.getLogger(__name__)


async def _harvest_workspace(db, container_id: str, project_id: str, run_id: str) -> None:
    """
    After a run completes, scan /workspace in the container and upload any
    output files to GridFS as artifacts (skipping already-uploaded input files).
    """
    try:
        from services.container_service import exec_in_container
        from database_mongo import get_gridfs
        import io

        # List all files in /workspace recursively (name + size, tab-separated)
        stdout, _, rc = await exec_in_container(
            container_id,
            r"find /workspace -type f -printf '%s\t%p\n'",
        )
        if rc != 0 or not stdout.strip():
            return

        # Get user_id from run doc for artifact ownership
        from bson import ObjectId as _ObjId
        run_doc = await db["runs"].find_one({"_id": _ObjId(run_id)}, {"user_id": 1})
        user_id = run_doc.get("user_id", "") if run_doc else ""

        # Fetch filenames already in GridFS for this project (input uploads)
        fs = get_gridfs()
        existing: set[str] = set()
        async for grid_out in fs.find({"metadata.project_id": project_id, "metadata.kind": "workspace_input"}):
            existing.add(grid_out.filename)

        for line in stdout.strip().splitlines():
            parts = line.split("\t", 1)
            if len(parts) != 2:
                continue
            size_str, full_path = parts
            try:
                size = int(size_str)
            except ValueError:
                continue

            filename = full_path.split("/")[-1]
            ext = "." + filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

            if ext not in _HARVEST_EXTENSIONS:
                continue
            if size > _MAX_HARVEST_BYTES:
                continue
            if filename in existing:
                continue  # already uploaded as input

            # Read file bytes from container via base64 to preserve binary
            import base64 as _b64
            b64_out, _, cat_rc = await exec_in_container(container_id, f"base64 '{full_path}'")
            if cat_rc != 0:
                continue
            try:
                data = _b64.b64decode(b64_out.strip())
            except Exception:
                continue

            mime = mimetypes.guess_type(filename)[0] or "application/octet-stream"
            await fs.upload_from_stream(
                filename,
                io.BytesIO(data),
                metadata={
                    "user_id": user_id,
                    "project_id": project_id,
                    "run_id": run_id,
                    "kind": "workspace_output",
                    "mime_type": mime,
                },
            )

    except Exception as e:
        _harvest_log.warning("Workspace harvest failed: %s", e)


# ── Main execution entry point ────────────────────────────────────────────────

async def execute_plan(
    run_id: str,
    project_id: str,
    plan: AgentTeamPlan,
    default_model_id: str,
    vault_secrets: list[dict],
    broadcast: Callable[[dict], Awaitable[None]],
    db,
    container_id: str | None = None,
    lmstudio_url: str | None = None,
) -> None:
    """
    Execute an approved AgentTeamPlan.

    - Builds agno agents from the plan
    - Streams events to `broadcast` (WebSocket)
    - Persists events + final status to MongoDB
    """
    from models_mongo import RunCollection

    async def emit(event: dict):
        event.setdefault("run_id", run_id)
        await RunCollection.append_event(db, run_id, event)
        await _safe_broadcast(broadcast, event)

    async def hitl_pause(
        question: str,
        pause_type: str = "input",
    ) -> str | None:
        """Pause execution and wait for a HITL response from the frontend.

        Emits a `hitl_pause` event, blocks until `resume_run` is called
        (via WebSocket control message), then returns the user's response.

        Args:
            question:   The question / prompt to show the user.
            pause_type: One of "input", "confirm", or "dangerous".

        Returns:
            The string response provided by the user, or None if no response.
        """
        pause_id = str(uuid.uuid4())
        await emit({
            "type": "hitl_pause",
            "pause_id": pause_id,
            "question": question,
            "pause_type": pause_type,
        })
        pause_run(run_id)
        await emit({"type": "run_paused"})
        await get_run_event(run_id).wait()
        response = _run_hitl_responses.get(run_id)
        await emit({
            "type": "hitl_resumed",
            "pause_id": pause_id,
            "response": response,
        })
        return response

    # Ensure a clean event state for this run
    get_run_event(run_id).set()

    try:
        await emit({"type": "run_started"})

        # Build individual agents
        agents: list[Agent] = []
        for planned in plan.agents:
            agent = _build_agent(
                planned, default_model_id, vault_secrets, broadcast, run_id,
                container_id=container_id,
                lmstudio_url=lmstudio_url,
                project_id=project_id,
                db=db,
            )
            agents.append(agent)
            await emit({
                "type": "agent_ready",
                "agent_id": planned.agent_id,
                "name": planned.name,
                "role": planned.role,
            })

        if not agents:
            raise ValueError("Plan contains no agents to execute")

        # Build agno Team
        lead_agent = agents[0]
        member_agents = agents[1:] if len(agents) > 1 else []

        team_mode = plan.team_mode or "coordinate"

        if member_agents:
            team = Team(
                name="ObsidianTeam",
                mode=team_mode,
                model=lead_agent.model,
                members=agents,
                instructions=f"Execute the following task: {plan.task_summary}",
                markdown=False,
            )
            run_target = team
        else:
            run_target = lead_agent

        # Run with streaming events
        task_prompt = plan.task_summary
        if plan.execution_steps:
            steps_text = "\n".join(f"{i+1}. {s}" for i, s in enumerate(plan.execution_steps))
            task_prompt += f"\n\nExecution steps:\n{steps_text}"

        await emit({"type": "run_started", "message": "Team assembled, beginning execution"})

        # Signal all agents as started
        for planned in plan.agents:
            await emit({
                "type": "agent_started",
                "agent_id": planned.agent_id,
                "name": planned.name,
            })

        # Stream agno events in real-time
        from agno.utils.events import (
            RunEvent as AgnoRunEvent,
            TeamRunEvent as AgnoTeamRunEvent,
        )

        content = ""
        async for ev in run_target.arun(task_prompt, stream=True, stream_events=True):
            # Check cancellation on every event — breaks out of the stream
            if is_cancelled(run_id):
                raise asyncio.CancelledError("Run cancelled by user")

            ev_type = getattr(ev, "event", None)

            # Tool call started — show what tool is being called
            if ev_type in (AgnoRunEvent.tool_call_started, AgnoTeamRunEvent.tool_call_started):
                tool = getattr(ev, "tool", None)
                tool_name = getattr(tool, "name", None) if tool else None
                tool_args = getattr(tool, "arguments", None) if tool else None
                if tool_name:
                    await emit({
                        "type": "tool_call",
                        "tool": tool_name,
                        "input": tool_args,
                    })

            # Tool call completed — show result
            elif ev_type in (AgnoRunEvent.tool_call_completed, AgnoTeamRunEvent.tool_call_completed):
                tool = getattr(ev, "tool", None)
                tool_name = getattr(tool, "name", None) if tool else None
                tool_result = getattr(tool, "result", None) if tool else None
                if tool_name and tool_result is not None:
                    await emit({
                        "type": "tool_result",
                        "tool": tool_name,
                        "output": str(tool_result)[:500],
                    })

            # Streaming content delta from agent
            elif ev_type in (AgnoRunEvent.run_content, AgnoTeamRunEvent.run_content):
                chunk = getattr(ev, "content", "") or ""
                if chunk:
                    content += chunk
                    await emit({"type": "agent_output", "content": chunk})

            # Run completed
            elif ev_type in (AgnoRunEvent.run_completed, AgnoTeamRunEvent.run_completed):
                # Final content from completed event if we didn't get streaming
                if not content:
                    run_output = getattr(ev, "content", None)
                    if run_output:
                        content = str(run_output)

        # Signal all agents done
        for planned in plan.agents:
            await emit({
                "type": "agent_done",
                "agent_id": planned.agent_id,
                "name": planned.name,
            })

        await emit({
            "type": "run_complete",
            "summary": content[:2000] if content else "Execution complete",
        })

        # Persist final state
        await RunCollection.update_status(
            db, run_id, "complete",
            extra={
                "summary": content,
                "completed_at": datetime.now(timezone.utc),
            }
        )

        # Harvest workspace files → GridFS artifacts
        if container_id:
            await _harvest_workspace(db, container_id, project_id, run_id)

    except asyncio.CancelledError:
        # Task was cancelled — status already set to "error" by the cancel endpoint
        try:
            await emit({"type": "run_error", "error": "Cancelled by user"})
        except Exception:
            pass
        raise  # re-raise so the asyncio Task is properly marked cancelled

    except Exception as exc:
        error_msg = str(exc)
        tb = traceback.format_exc()
        await emit({"type": "run_error", "error": error_msg, "traceback": tb})
        try:
            from models_mongo import RunCollection
            await RunCollection.update_status(
                db, run_id, "error",
                extra={"error": error_msg, "completed_at": datetime.now(timezone.utc)}
            )
        except Exception:
            pass

    finally:
        cleanup_run(run_id)
