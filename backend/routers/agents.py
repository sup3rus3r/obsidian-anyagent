from fastapi import APIRouter, Depends, HTTPException, status
from database_mongo import get_database
from models_mongo import AgentLibraryCollection
from schemas import (
    AgentCreate, AgentUpdate, AgentResponse, AgentLibraryResponse,
)
from auth import TokenData, get_current_user

router = APIRouter(prefix="/agents", tags=["agent-library"])


def _fmt(a: dict) -> AgentResponse:
    return AgentResponse(
        id=str(a["_id"]),
        name=a["name"],
        role=a["role"],
        instructions=a["instructions"],
        tools=a.get("tools", []),
        model_override=a.get("model_override"),
        is_base=a.get("is_base", False),
        user_id=a.get("user_id"),
        created_at=a["created_at"],
    )


@router.get("", response_model=AgentLibraryResponse)
async def list_agents(current_user: TokenData = Depends(get_current_user)):
    """Return base agents + user's custom agents."""
    db = get_database()
    agents = await AgentLibraryCollection.find_user_agents(db, current_user.user_id)
    return AgentLibraryResponse(agents=[_fmt(a) for a in agents])


@router.post("", response_model=AgentResponse, status_code=status.HTTP_201_CREATED)
async def create_agent(
    body: AgentCreate,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    doc = {
        "user_id": current_user.user_id,
        "name": body.name,
        "role": body.role,
        "instructions": body.instructions,
        "tools": body.tools,
        "model_override": body.model_override,
        "is_base": False,
    }
    created = await AgentLibraryCollection.create(db, doc)
    return _fmt(created)


@router.put("/{agent_id}", response_model=AgentResponse)
async def update_agent(
    agent_id: str,
    body: AgentUpdate,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")
    updated = await AgentLibraryCollection.update(db, agent_id, current_user.user_id, updates)
    if not updated:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found or is a base agent (cannot modify)",
        )
    return _fmt(updated)


@router.delete("/{agent_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_agent(
    agent_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    deleted = await AgentLibraryCollection.delete(db, agent_id, current_user.user_id)
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Agent not found or is a base agent (cannot delete)",
        )
