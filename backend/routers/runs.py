from fastapi import APIRouter, Depends, HTTPException, status
from database_mongo import get_database
from models_mongo import RunCollection, ProjectCollection, SecretsVaultCollection, AgentLibraryCollection
from schemas import RunCreate, RunResponse, RunListResponse
from auth import TokenData, get_current_user

router = APIRouter(prefix="/projects/{project_id}/runs", tags=["runs"])


def _fmt(r: dict) -> RunResponse:
    return RunResponse(
        id=str(r["_id"]),
        project_id=r["project_id"],
        user_id=r["user_id"],
        task=r["task"],
        status=r["status"],
        model_id=r.get("model_id"),
        lmstudio_url=r.get("lmstudio_url"),
        proposed_plan=r.get("proposed_plan"),
        approved_plan=r.get("approved_plan"),
        summary=r.get("summary"),
        token_usage=r.get("token_usage"),
        created_at=r["created_at"],
        completed_at=r.get("completed_at"),
    )


async def _assert_project(db, project_id: str, user_id: str):
    project = await ProjectCollection.find_by_id(db, project_id, user_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.post("", response_model=RunResponse, status_code=status.HTTP_201_CREATED)
async def create_run(
    project_id: str,
    body: RunCreate,
    current_user: TokenData = Depends(get_current_user),
):
    """
    Create a run and immediately kick off the orchestrator planning phase.
    Returns the run with proposed_plan populated.
    Status will be 'planning' while the orchestrator runs, then 'awaiting_approval'.
    """
    from orchestrator import plan_task

    db = get_database()
    project = await _assert_project(db, project_id, current_user.user_id)

    # Determine model to use (from request body, project config, or default)
    model_config = project.get("model_config_data") or {}
    model_id = body.model_id or model_config.get("primary", "claude-sonnet-4-6")

    # Create the run in pending state (store model_id and lmstudio_url for later use)
    doc = {
        "project_id": project_id,
        "user_id": current_user.user_id,
        "task": body.task,
        "status": "planning",
        "model_id": model_id,
        **({"lmstudio_url": body.lmstudio_url} if body.lmstudio_url else {}),
    }
    created = await RunCollection.create(db, doc)
    run_id = str(created["_id"])

    # Fetch user's vault secrets (for API key resolution)
    vault_secrets = await SecretsVaultCollection.find_by_scope(db, current_user.user_id, project_id)

    # Fetch agent library (base + user's custom agents)
    agent_library = await AgentLibraryCollection.find_user_agents(db, current_user.user_id)

    try:
        plan = await plan_task(
            task=body.task,
            model_id=model_id,
            vault_secrets=vault_secrets,
            agent_library=agent_library,
            lmstudio_url=body.lmstudio_url,
        )
        # Check if run was cancelled while planning
        from executor import is_cancelled
        if is_cancelled(run_id):
            await RunCollection.update_status(db, run_id, "error", extra={"error": "Cancelled by user"})
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Run was cancelled")

        # plan is an AgentTeamPlan Pydantic object — convert to dict for storage
        plan_dict = plan.model_dump()
        updated = await RunCollection.update_status(
            db, run_id, "awaiting_approval",
            extra={"proposed_plan": plan_dict}
        )
        return _fmt(updated)

    except HTTPException:
        raise
    except ValueError as e:
        # Missing API key or bad model_id — surface clearly
        await RunCollection.update_status(db, run_id, "error", extra={"error": str(e)})
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(e))
    except Exception as e:
        await RunCollection.update_status(db, run_id, "error", extra={"error": str(e)})
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/{run_id}/approve", response_model=RunResponse)
async def approve_run(
    project_id: str,
    run_id: str,
    body: dict,
    current_user: TokenData = Depends(get_current_user),
):
    """
    User approves (or edits then approves) the proposed plan.
    Body: { "approved_plan": <AgentTeamPlan dict, possibly edited by user> }
    Kicks off background execution immediately.
    """
    import asyncio
    from orchestrator import AgentTeamPlan
    from executor import execute_plan
    from main import manager

    db = get_database()
    project = await _assert_project(db, project_id, current_user.user_id)
    run = await RunCollection.find_by_id(db, run_id, current_user.user_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    if run["status"] != "awaiting_approval":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Run is '{run['status']}', not awaiting approval"
        )

    approved_plan_dict = body.get("approved_plan") or run.get("proposed_plan")
    updated = await RunCollection.update_status(
        db, run_id, "executing",
        extra={"approved_plan": approved_plan_dict}
    )

    # Parse plan
    plan = AgentTeamPlan(**approved_plan_dict)

    # Resolve model and vault
    vault_secrets = await SecretsVaultCollection.find_by_scope(db, current_user.user_id, project_id)
    model_config = project.get("model_config_data") or {}
    model_id = run.get("model_id") or model_config.get("primary", "claude-sonnet-4-6")

    async def broadcast(event: dict):
        await manager.broadcast(project_id, event)

    # Start (or resume) the per-project sandbox container
    container_id: str | None = None
    try:
        from services.container_service import get_or_create_container
        container_id, _host_port, _host_ports = await get_or_create_container(project_id)
    except Exception as e:
        # Container start failure is non-fatal — execution continues without sandbox
        import logging
        logging.getLogger(__name__).warning("Container start failed: %s", e)

    # Fire and forget — execution runs in background; register task for cancellation
    from executor import register_run_task
    task = asyncio.create_task(execute_plan(
        run_id=run_id,
        project_id=project_id,
        plan=plan,
        default_model_id=model_id,
        vault_secrets=vault_secrets,
        broadcast=broadcast,
        db=db,
        container_id=container_id,
        lmstudio_url=run.get("lmstudio_url"),
    ))
    register_run_task(run_id, task)

    return _fmt(updated)


@router.post("/{run_id}/reject", response_model=RunResponse)
async def reject_run(
    project_id: str,
    run_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    """User rejects the proposed plan — run is cancelled."""
    db = get_database()
    await _assert_project(db, project_id, current_user.user_id)
    run = await RunCollection.find_by_id(db, run_id, current_user.user_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    updated = await RunCollection.update_status(db, run_id, "rejected")
    return _fmt(updated)


@router.post("/{run_id}/regenerate", response_model=RunResponse)
async def regenerate_plan(
    project_id: str,
    run_id: str,
    body: dict,
    current_user: TokenData = Depends(get_current_user),
):
    """
    Re-run the orchestrator with optional additional instructions.
    Body: { "instructions": "Focus more on X..." }  (optional)
    """
    from orchestrator import plan_task

    db = get_database()
    project = await _assert_project(db, project_id, current_user.user_id)
    run = await RunCollection.find_by_id(db, run_id, current_user.user_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")

    vault_secrets = await SecretsVaultCollection.find_by_scope(db, current_user.user_id, project_id)
    agent_library = await AgentLibraryCollection.find_user_agents(db, current_user.user_id)
    model_config = project.get("model_config_data") or {}
    # Prefer: explicit body override → run's stored model → project default → hardcoded default
    model_id = body.get("model_id") or run.get("model_id") or model_config.get("primary", "claude-sonnet-4-6")

    extra_instructions = body.get("instructions", "")
    task = run["task"]
    if extra_instructions:
        task = f"{task}\n\nAdditional instructions: {extra_instructions}"

    await RunCollection.update_status(db, run_id, "planning")

    try:
        plan = await plan_task(
            task=task,
            model_id=model_id,
            vault_secrets=vault_secrets,
            agent_library=agent_library,
        )
        updated = await RunCollection.update_status(
            db, run_id, "awaiting_approval",
            extra={"proposed_plan": plan.model_dump()}
        )
        return _fmt(updated)
    except Exception as e:
        await RunCollection.update_status(db, run_id, "error", extra={"error": str(e)})
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.post("/{run_id}/cancel", response_model=RunResponse)
async def cancel_run_endpoint(
    project_id: str,
    run_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    """Cancel an executing run."""
    from executor import cancel_run
    from datetime import datetime, timezone

    db = get_database()
    await _assert_project(db, project_id, current_user.user_id)
    run = await RunCollection.find_by_id(db, run_id, current_user.user_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    if run["status"] not in ("planning", "executing", "approved", "awaiting_approval"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Run is '{run['status']}', cannot cancel"
        )

    cancel_run(run_id)
    # Stop (but don't delete) the sandbox container — it will restart on next run
    try:
        from services.container_service import stop_container
        await stop_container(project_id)
    except Exception:
        pass
    updated = await RunCollection.update_status(
        db, run_id, "error",
        extra={"error": "Cancelled by user", "completed_at": datetime.now(timezone.utc)}
    )
    return _fmt(updated)


@router.get("", response_model=RunListResponse)
async def list_runs(
    project_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    await _assert_project(db, project_id, current_user.user_id)
    runs = await RunCollection.find_by_project(db, project_id, current_user.user_id)
    return RunListResponse(runs=[_fmt(r) for r in runs])


@router.get("/{run_id}", response_model=RunResponse)
async def get_run(
    project_id: str,
    run_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    await _assert_project(db, project_id, current_user.user_id)
    run = await RunCollection.find_by_id(db, run_id, current_user.user_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    return _fmt(run)


@router.post("/{run_id}/harvest", status_code=status.HTTP_200_OK)
async def harvest_run_files(
    project_id: str,
    run_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    """Scan /workspace in the project container and upload files to GridFS."""
    db = get_database()
    await _assert_project(db, project_id, current_user.user_id)
    run = await RunCollection.find_by_id(db, run_id, current_user.user_id)
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    try:
        from services.container_service import get_or_create_container
        from executor import _harvest_workspace
        container_id, _, __ = await get_or_create_container(project_id)
        await _harvest_workspace(db, container_id, project_id, run_id)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))
    return {"ok": True}


@router.get("/{run_id}/events")
async def get_run_events(
    project_id: str,
    run_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    """Return persisted events array for a completed/error run."""
    from bson import ObjectId
    db = get_database()
    await _assert_project(db, project_id, current_user.user_id)
    run = await db["runs"].find_one(
        {"_id": ObjectId(run_id), "user_id": current_user.user_id},
        {"events": 1}
    )
    if not run:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    return {"events": run.get("events", [])}
