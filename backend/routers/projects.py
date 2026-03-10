from fastapi import APIRouter, Depends, HTTPException, status
from database_mongo import get_database
from models_mongo import ProjectCollection
from schemas import (
    ProjectCreate, ProjectUpdate, ProjectResponse, ProjectListResponse,
    ModelConfigData,
)
from auth import TokenData, get_current_user

router = APIRouter(prefix="/projects", tags=["projects"])


def _fmt(p: dict) -> ProjectResponse:
    mc = p.get("model_config_data")
    return ProjectResponse(
        id=str(p["_id"]),
        user_id=p["user_id"],
        name=p["name"],
        description=p.get("description"),
        container_id=p.get("container_id"),
        session_id=p.get("session_id"),
        model_config_data=ModelConfigData(**mc) if mc else None,
        workspace_path=p.get("workspace_path"),
        created_at=p["created_at"],
        updated_at=p["updated_at"],
    )


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
async def create_project(
    body: ProjectCreate,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    doc = {
        "user_id": current_user.user_id,
        "name": body.name,
        "description": body.description,
    }
    created = await ProjectCollection.create(db, doc)
    return _fmt(created)


@router.get("", response_model=ProjectListResponse)
async def list_projects(current_user: TokenData = Depends(get_current_user)):
    db = get_database()
    projects = await ProjectCollection.find_by_user(db, current_user.user_id)
    return ProjectListResponse(projects=[_fmt(p) for p in projects])


@router.get("/{project_id}", response_model=ProjectResponse)
async def get_project(
    project_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    project = await ProjectCollection.find_by_id(db, project_id, current_user.user_id)
    if not project:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return _fmt(project)


@router.put("/{project_id}", response_model=ProjectResponse)
async def update_project(
    project_id: str,
    body: ProjectUpdate,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")
    updated = await ProjectCollection.update(db, project_id, current_user.user_id, updates)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    return _fmt(updated)


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_project(
    project_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    deleted = await ProjectCollection.delete(db, project_id, current_user.user_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Project not found")
    # Remove the sandbox container for this project
    try:
        from services.container_service import delete_container
        await delete_container(project_id)
    except Exception:
        pass
