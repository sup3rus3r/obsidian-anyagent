from fastapi import APIRouter, Depends, HTTPException, status
from database_mongo import get_database
from models_mongo import MCPConnectionCollection
from schemas import (
    MCPConnectionCreate, MCPConnectionUpdate,
    MCPConnectionResponse, MCPConnectionListResponse, MCPToolSchema,
)
from auth import TokenData, get_current_user

router = APIRouter(prefix="/mcp", tags=["mcp"])


def _fmt(c: dict) -> MCPConnectionResponse:
    return MCPConnectionResponse(
        id=str(c["_id"]),
        name=c["name"],
        transport=c["transport"],
        command=c.get("command"),
        url=c.get("url"),
        enabled=c.get("enabled", True),
        discovered_tools=[MCPToolSchema(**t) for t in c.get("discovered_tools", [])],
        created_at=c["created_at"],
    )


@router.post("", response_model=MCPConnectionResponse, status_code=status.HTTP_201_CREATED)
async def create_connection(
    body: MCPConnectionCreate,
    current_user: TokenData = Depends(get_current_user),
):
    if body.transport == "stdio" and not body.command:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="command is required for stdio transport",
        )
    if body.transport in ("http", "sse") and not body.url:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="url is required for http/sse transport",
        )

    db = get_database()
    doc = {
        "user_id": current_user.user_id,
        "name": body.name,
        "transport": body.transport,
        "command": body.command,
        "url": body.url,
        # auth_token stored encrypted — omitted until crypto_utils.encrypt_value is used here
    }
    created = await MCPConnectionCollection.create(db, doc)
    return _fmt(created)


@router.get("", response_model=MCPConnectionListResponse)
async def list_connections(current_user: TokenData = Depends(get_current_user)):
    db = get_database()
    connections = await MCPConnectionCollection.find_by_user(db, current_user.user_id)
    return MCPConnectionListResponse(connections=[_fmt(c) for c in connections])


@router.get("/{conn_id}", response_model=MCPConnectionResponse)
async def get_connection(
    conn_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    conn = await MCPConnectionCollection.find_by_id(db, conn_id, current_user.user_id)
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")
    return _fmt(conn)


@router.put("/{conn_id}", response_model=MCPConnectionResponse)
async def update_connection(
    conn_id: str,
    body: MCPConnectionUpdate,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")
    updated = await MCPConnectionCollection.update(db, conn_id, current_user.user_id, updates)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")
    return _fmt(updated)


@router.delete("/{conn_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_connection(
    conn_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    deleted = await MCPConnectionCollection.delete(db, conn_id, current_user.user_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")
