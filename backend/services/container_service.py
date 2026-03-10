"""
Per-project Docker container lifecycle manager.

Each project gets exactly one long-running container (obsidian-webdev-base:latest)
that persists across runs within that project.  The container is created on first
use and stopped when the project is closed or the backend shuts down.

Windows compatibility
─────────────────────
• Python Docker SDK calls go directly through the Docker daemon socket — they are
  NOT affected by Git Bash / MSYS path mangling.
• subprocess calls (exec_in_container) use subprocess.Popen via run_in_executor
  to avoid asyncio.create_subprocess_exec which fails on Windows SelectorEventLoop.
• All paths passed to `docker exec` use the `//` prefix to prevent MSYS conversion
  (e.g.  //bin/sh  and  //workspace).

Public API
──────────
    get_or_create_container(project_id) -> (container_id, host_port, host_ports)
    stop_container(project_id)          -> None
    delete_container(project_id)        -> None   (stop + remove container + volume)
    exec_in_container(container_id, cmd, workdir) -> (stdout, stderr, returncode)
    exec_stream_in_container(container_id, cmd, workdir) -> AsyncGenerator[str]
    copy_to_container(container_id, filename, data) -> None
"""

import asyncio
import logging
import subprocess
import sys
from typing import AsyncGenerator

import docker
from docker.errors import NotFound, APIError

log = logging.getLogger(__name__)

# Base image — build once: docker build -f backend/Dockerfile.base -t obsidian-webdev-base:latest backend/
BASE_IMAGE = "obsidian-webdev-base:latest"

# In-memory registry: project_id -> container_id
_registry: dict[str, str] = {}

# Lazy Docker client
_client: docker.DockerClient | None = None


def _docker() -> docker.DockerClient:
    global _client
    if _client is None:
        _client = docker.from_env()
    return _client


# ── Container lifecycle ────────────────────────────────────────────────────────

def _container_name(project_id: str) -> str:
    return f"obsidian-project-{project_id}"


def _get_existing(project_id: str) -> docker.models.containers.Container | None:
    """Return running container for this project, or None."""
    name = _container_name(project_id)
    try:
        c = _docker().containers.get(name)
        if c.status == "running":
            return c
        # Start it if stopped
        if c.status in ("exited", "created"):
            c.start()
            c.reload()
            return c
    except NotFound:
        pass
    return None


def _sync_get_or_create(project_id: str) -> tuple[str, int | None, dict]:
    """
    Synchronous create/start logic — called via run_in_executor.

    Returns (container_id, host_port, host_ports) where:
      host_port  — the first mapped TCP port (int) or None
      host_ports — full port mapping dict  e.g. {"8080/tcp": [{"HostIp":"", "HostPort":"8080"}]}
    """
    existing = _get_existing(project_id)
    if existing:
        ports = existing.ports or {}
        host_port = _first_port(ports)
        _registry[project_id] = existing.id
        log.info("Reusing container %s for project %s", existing.short_id, project_id)
        return existing.id, host_port, ports

    name = _container_name(project_id)
    log.info("Creating new container %s for project %s", name, project_id)

    # Named volume per project — auto-created by Docker, works on all platforms
    # including Windows/Docker Desktop without needing host path sharing
    volume_name = f"obsidian-workspace-{project_id}"

    try:
        container = _docker().containers.run(
            BASE_IMAGE,
            name=name,
            detach=True,
            # Keep alive
            command=["tail", "-f", "/dev/null"],
            # Named volume for workspace — persists across container restarts
            volumes={volume_name: {"bind": "/workspace", "mode": "rw"}},
            # Resource limits
            mem_limit="1g",
            nano_cpus=int(1.5 * 1e9),  # 1.5 CPU cores
            # Networking
            network_mode="bridge",
            # Prevent interactive terminal requirement
            stdin_open=False,
            tty=False,
            # Labels for identification
            labels={
                "obsidian.project_id": project_id,
                "obsidian.managed": "true",
            },
        )
    except APIError as e:
        # Container with that name already exists but wasn't caught above — race condition
        if "already in use" in str(e):
            container = _docker().containers.get(name)
            if container.status != "running":
                container.start()
                container.reload()
        else:
            raise

    container.reload()
    ports = container.ports or {}
    host_port = _first_port(ports)
    _registry[project_id] = container.id
    return container.id, host_port, ports


def _first_port(ports: dict) -> int | None:
    for _proto, bindings in ports.items():
        if bindings:
            try:
                return int(bindings[0]["HostPort"])
            except (KeyError, ValueError, IndexError):
                pass
    return None


def _sync_stop(project_id: str) -> None:
    name = _container_name(project_id)
    try:
        c = _docker().containers.get(name)
        c.stop(timeout=5)
        log.info("Stopped container %s for project %s", c.short_id, project_id)
    except NotFound:
        pass
    _registry.pop(project_id, None)


def _sync_delete(project_id: str) -> None:
    """Stop, remove the container, and delete the workspace volume for a project."""
    name = _container_name(project_id)
    try:
        c = _docker().containers.get(name)
        c.stop(timeout=5)
        c.remove(force=True)
        log.info("Deleted container for project %s", project_id)
    except NotFound:
        pass
    # Remove the named workspace volume
    volume_name = f"obsidian-workspace-{project_id}"
    try:
        vol = _docker().volumes.get(volume_name)
        vol.remove(force=True)
        log.info("Deleted workspace volume %s", volume_name)
    except NotFound:
        pass
    _registry.pop(project_id, None)


# ── Async wrappers ─────────────────────────────────────────────────────────────

async def get_or_create_container(project_id: str) -> tuple[str, int | None, dict]:
    """Async wrapper — create or resume the per-project container."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync_get_or_create, project_id)


async def stop_container(project_id: str) -> None:
    """Async wrapper — stop and release the container."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _sync_stop, project_id)


async def delete_container(project_id: str) -> None:
    """Async wrapper — stop and remove the container permanently."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _sync_delete, project_id)


# ── Command execution ──────────────────────────────────────────────────────────

# Double-slash paths prevent MSYS/Git Bash path mangling on Windows
_SH = "//bin/sh"
_WORKSPACE = "//workspace"


def _sync_exec(container_id: str, cmd: str, workdir: str) -> tuple[str, str, int]:
    """
    Run a shell command inside the container using subprocess.Popen.

    Uses subprocess.Popen (not asyncio.create_subprocess_exec) because uvicorn on
    Windows uses SelectorEventLoop which does not support subprocess transport.
    """
    args = [
        "docker", "exec",
        "-i",
        "-w", workdir,
        container_id,
        _SH, "-c", cmd,
    ]
    proc = subprocess.Popen(
        args,
        stdin=subprocess.DEVNULL,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    stdout_bytes, stderr_bytes = proc.communicate(timeout=300)
    stdout = stdout_bytes.decode("utf-8", errors="replace")
    stderr = stderr_bytes.decode("utf-8", errors="replace")
    return stdout, stderr, proc.returncode


async def exec_in_container(
    container_id: str,
    cmd: str,
    workdir: str = _WORKSPACE,
) -> tuple[str, str, int]:
    """
    Async: run a shell command in the container.

    Returns (stdout, stderr, returncode).
    """
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _sync_exec, container_id, cmd, workdir)


async def exec_stream_in_container(
    container_id: str,
    cmd: str,
    workdir: str = _WORKSPACE,
) -> AsyncGenerator[str, None]:
    """
    Async generator: stream stdout lines from a command running in the container.

    Each yielded item is a text line (without trailing newline).
    The generator raises RuntimeError on non-zero exit.
    """
    args = [
        "docker", "exec",
        "-i",
        "-w", workdir,
        container_id,
        _SH, "-c", cmd,
    ]

    loop = asyncio.get_event_loop()

    def _start_proc():
        return subprocess.Popen(
            args,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )

    proc = await loop.run_in_executor(None, _start_proc)

    def _read_line():
        return proc.stdout.readline()

    while True:
        line_bytes = await loop.run_in_executor(None, _read_line)
        if not line_bytes:
            break
        yield line_bytes.decode("utf-8", errors="replace").rstrip("\n")

    def _wait():
        return proc.wait()

    rc = await loop.run_in_executor(None, _wait)
    if rc != 0:
        raise RuntimeError(f"Command exited with code {rc}")


# ── File injection ────────────────────────────────────────────────────────────

def _sync_copy_to_container(container_id: str, filename: str, data: bytes) -> None:
    """
    Copy a file into /workspace inside the container using Docker SDK put_archive.
    Docker SDK uses the daemon socket directly — not affected by MSYS path mangling.
    """
    import io
    import tarfile

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        info = tarfile.TarInfo(name=filename)
        info.size = len(data)
        tar.addfile(info, io.BytesIO(data))
    buf.seek(0)

    container = _docker().containers.get(container_id)
    container.put_archive("/workspace", buf)


async def copy_to_container(container_id: str, filename: str, data: bytes) -> None:
    """Async: copy a file into /workspace inside the container."""
    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, _sync_copy_to_container, container_id, filename, data)


# ── Cleanup helper (call from app shutdown) ───────────────────────────────────

async def stop_all_containers() -> None:
    """Stop all managed containers — call on app shutdown."""
    project_ids = list(_registry.keys())
    for pid in project_ids:
        try:
            await stop_container(pid)
        except Exception as e:
            log.warning("Failed to stop container for project %s: %s", pid, e)
