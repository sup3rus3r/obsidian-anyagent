"""
Container management endpoints.

GET  /projects/{project_id}/container   — get current container status
POST /projects/{project_id}/container/start  — ensure container is running
POST /projects/{project_id}/container/stop   — stop container
"""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from auth import TokenData, get_current_user
from database_mongo import get_database
from models_mongo import ProjectCollection

router = APIRouter(prefix="/projects/{project_id}/container", tags=["containers"])


class ContainerStatus(BaseModel):
    project_id: str
    container_id: str | None = None
    status: str  # "running" | "stopped" | "not_created"
    host_port: int | None = None


async def _assert_project(db, project_id: str, user_id: str):
    project = await ProjectCollection.find_by_id(db, project_id, user_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return project


@router.get("", response_model=ContainerStatus)
async def get_container_status(
    project_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    await _assert_project(db, project_id, current_user.user_id)

    try:
        import docker
        from services.container_service import _container_name, _docker
        name = _container_name(project_id)
        try:
            c = _docker().containers.get(name)
            ports = c.ports or {}
            host_port = None
            for _proto, bindings in ports.items():
                if bindings:
                    try:
                        host_port = int(bindings[0]["HostPort"])
                        break
                    except (KeyError, ValueError, IndexError):
                        pass
            return ContainerStatus(
                project_id=project_id,
                container_id=c.id,
                status=c.status,
                host_port=host_port,
            )
        except docker.errors.NotFound:
            return ContainerStatus(project_id=project_id, status="not_created")
    except Exception as e:
        return ContainerStatus(project_id=project_id, status="error")


@router.post("/start", response_model=ContainerStatus)
async def start_container(
    project_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    await _assert_project(db, project_id, current_user.user_id)

    from services.container_service import get_or_create_container
    container_id, host_port, _ports = await get_or_create_container(project_id)
    return ContainerStatus(
        project_id=project_id,
        container_id=container_id,
        status="running",
        host_port=host_port,
    )


@router.post("/stop", response_model=ContainerStatus)
async def stop_container_endpoint(
    project_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    await _assert_project(db, project_id, current_user.user_id)

    from services.container_service import stop_container
    await stop_container(project_id)
    return ContainerStatus(project_id=project_id, status="stopped")
