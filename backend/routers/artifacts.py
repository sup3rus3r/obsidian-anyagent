from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, status
from fastapi.responses import StreamingResponse
from bson import ObjectId
from database_mongo import get_database, get_gridfs
from models_mongo import ProjectCollection
from schemas import ArtifactResponse, ArtifactListResponse
from auth import TokenData, get_current_user
from typing import Optional
import io

router = APIRouter(prefix="/artifacts", tags=["artifacts"])


@router.post("", response_model=ArtifactResponse, status_code=status.HTTP_201_CREATED)
async def upload_artifact(
    file: UploadFile = File(...),
    project_id: str = None,
    run_id: str = None,
    agent_id: str = None,
    current_user: TokenData = Depends(get_current_user),
):
    # Verify project ownership if project_id provided
    if project_id:
        db = get_database()
        project = await ProjectCollection.find_by_id(db, project_id, current_user.user_id)
        if not project:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    fs = get_gridfs()
    contents = await file.read()
    metadata = {
        "user_id": current_user.user_id,
        "project_id": project_id,
        "run_id": run_id,
        "agent_id": agent_id,
        "mime_type": file.content_type,
    }
    file_id = await fs.upload_from_stream(
        file.filename,
        io.BytesIO(contents),
        metadata=metadata,
    )

    return ArtifactResponse(
        id=str(file_id),
        filename=file.filename,
        mime_type=file.content_type,
        project_id=project_id,
        run_id=run_id,
        agent_id=agent_id,
        size=len(contents),
        created_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
    )


@router.get("/{file_id}")
async def download_artifact(
    file_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    fs = get_gridfs()
    try:
        grid_out = await fs.open_download_stream(ObjectId(file_id))
    except Exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")

    # Verify ownership via metadata
    metadata = grid_out.metadata or {}
    if metadata.get("user_id") != current_user.user_id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")

    contents = await grid_out.read()
    mime = metadata.get("mime_type", "application/octet-stream")

    return StreamingResponse(
        io.BytesIO(contents),
        media_type=mime,
        headers={"Content-Disposition": f'attachment; filename="{grid_out.filename}"'},
    )


@router.get("")
async def list_artifacts(
    project_id: str = None,
    run_id: str = None,
    current_user: TokenData = Depends(get_current_user),
):
    fs = get_gridfs()
    filter_query: dict = {"metadata.user_id": current_user.user_id}
    if project_id:
        filter_query["metadata.project_id"] = project_id
    if run_id:
        filter_query["metadata.run_id"] = run_id

    cursor = fs.find(filter_query)
    artifacts = []
    async for grid_out in cursor:
        meta = grid_out.metadata or {}
        artifacts.append(ArtifactResponse(
            id=str(grid_out._id),
            filename=grid_out.filename,
            mime_type=meta.get("mime_type"),
            project_id=meta.get("project_id"),
            run_id=meta.get("run_id"),
            agent_id=meta.get("agent_id"),
            size=grid_out.length,
            created_at=grid_out.upload_date,
        ))
    return ArtifactListResponse(artifacts=artifacts)


@router.delete("/{file_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_artifact(
    file_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    fs = get_gridfs()
    try:
        grid_out = await fs.open_download_stream(ObjectId(file_id))
        metadata = grid_out.metadata or {}
        if metadata.get("user_id") != current_user.user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied")
        await fs.delete(ObjectId(file_id))
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Artifact not found")


# ── Workspace file upload (input files for agents) ───────────────────────────

workspace_router = APIRouter(prefix="/projects/{project_id}/workspace", tags=["workspace"])


@workspace_router.post("/upload", response_model=ArtifactResponse, status_code=status.HTTP_201_CREATED)
async def upload_workspace_file(
    project_id: str,
    file: UploadFile = File(...),
    current_user: TokenData = Depends(get_current_user),
):
    """
    Upload an input file to the project workspace.
    Stores the file in GridFS and copies it into the project's Docker container
    at /workspace/<filename> so agents can read it via the file_read tool.
    """
    import logging
    log = logging.getLogger(__name__)

    db = get_database()
    project = await ProjectCollection.find_by_id(db, project_id, current_user.user_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")

    contents = await file.read()

    # Store in GridFS
    fs = get_gridfs()
    metadata = {
        "user_id": current_user.user_id,
        "project_id": project_id,
        "kind": "workspace_input",
        "mime_type": file.content_type,
    }
    file_id = await fs.upload_from_stream(
        file.filename,
        io.BytesIO(contents),
        metadata=metadata,
    )

    # Copy into container workspace (best-effort — container may not be running yet)
    try:
        from services.container_service import get_or_create_container, copy_to_container
        container_id, _, __ = await get_or_create_container(project_id)
        await copy_to_container(container_id, file.filename, contents)
    except Exception as e:
        log.warning("Could not copy file to container workspace: %s", e)

    return ArtifactResponse(
        id=str(file_id),
        filename=file.filename,
        mime_type=file.content_type,
        project_id=project_id,
        run_id=None,
        agent_id=None,
        size=len(contents),
        created_at=__import__("datetime").datetime.now(__import__("datetime").timezone.utc),
    )
