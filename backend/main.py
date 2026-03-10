from contextlib import asynccontextmanager
from datetime import timedelta, datetime, timezone
from fastapi import FastAPI, Depends, HTTPException, status, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from slowapi.errors import RateLimitExceeded
import bcrypt
import uvicorn
import json

from dotenv import load_dotenv
load_dotenv()

from database_mongo import connect_to_mongo, close_mongo_connection, get_database
from models_mongo import (
    UserCollection, APIClientCollection,
    ProjectCollection, RunCollection,
    AgentLibraryCollection, SecretsVaultCollection, MCPConnectionCollection,
)
from schemas import (
    EncryptedRequest, UserResponse, LoginResponse,
    APIClientCreate, APIClientResponse, APIClientCreateResponse,
    APIClientListResponse, UserDetailsResponse, ToggleRoleResponse,
)
from crypto_utils import decrypt_payload
from auth import (
    create_access_token, get_current_user, get_current_user_or_api_client,
    generate_client_credentials, hash_client_secret,
    TokenData, APIClientData, JWT_ACCESS_TOKEN_EXPIRE_MINUTES,
    decode_token,
)
from rate_limiter import limiter, rate_limit_exceeded_handler
from routers import projects, runs, vault, mcp, agents, artifacts, containers


@asynccontextmanager
async def lifespan(app: FastAPI):
    await connect_to_mongo()
    db = get_database()
    await UserCollection.create_indexes(db)
    await APIClientCollection.create_indexes(db)
    await ProjectCollection.create_indexes(db)
    await RunCollection.create_indexes(db)
    await AgentLibraryCollection.create_indexes(db)
    await SecretsVaultCollection.create_indexes(db)
    await MCPConnectionCollection.create_indexes(db)
    await AgentLibraryCollection.seed_base_agents(db)
    yield
    await close_mongo_connection()
    # Stop all managed sandbox containers
    try:
        from services.container_service import stop_all_containers
        await stop_all_containers()
    except Exception:
        pass


app = FastAPI(lifespan=lifespan)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projects.router)
app.include_router(runs.router)
app.include_router(vault.router)
app.include_router(mcp.router)
app.include_router(agents.router)
app.include_router(artifacts.router)
app.include_router(artifacts.workspace_router)
app.include_router(containers.router)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))


def get_password_hash(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


# ============================================================================
# Public Endpoints
# ============================================================================

@app.post("/auth/register", response_model=UserResponse)
async def register(request: EncryptedRequest):
    try:
        data        = decrypt_payload(request.encrypted)
        username    = data["username"]
        email       = data["email"]
        password    = data["password"]
        role        = data.get("role", "guest")
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid encrypted data")

    if len(password.encode("utf-8")) > 72:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password too long (max 72 bytes)")

    db = get_database()
    if await UserCollection.find_by_username(db, username):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username already registered")
    if await UserCollection.find_by_email(db, email):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")

    user_data = {
        "username": username,
        "email": email,
        "role": role,
        "hashed_password": get_password_hash(password),
    }
    created_user = await UserCollection.create(db, user_data)
    return UserResponse(
        id=str(created_user["_id"]),
        username=created_user["username"],
        email=created_user["email"],
        role=created_user["role"],
    )


@app.post("/auth/login", response_model=LoginResponse)
async def login(request: EncryptedRequest):
    try:
        data     = decrypt_payload(request.encrypted)
        username = data["username"]
        password = data["password"]
    except Exception:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid encrypted data")

    db = get_database()
    db_user = await UserCollection.find_by_username(db, username)
    if not db_user or not verify_password(password, db_user["hashed_password"]):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid username or password")

    access_token = create_access_token(
        data={
            "user_id": str(db_user["_id"]),
            "username": db_user["username"],
            "role": db_user["role"],
            "token_type": "user",
        },
        expires_delta=timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return LoginResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserResponse(
            id=str(db_user["_id"]),
            username=db_user["username"],
            email=db_user["email"],
            role=db_user["role"],
        ),
    )


# ============================================================================
# Protected Endpoints
# ============================================================================

@app.get("/health")
@limiter.limit("60/minute")
async def health_check(
    request: Request,
    auth: TokenData | APIClientData = Depends(get_current_user_or_api_client),
):
    return {
        "status": "ok",
        "authenticated_as": auth.username if isinstance(auth, TokenData) else auth.client_name,
        "auth_type": auth.token_type,
    }


@app.get("/get_user_details", response_model=UserDetailsResponse)
@limiter.limit("60/minute")
async def get_user_details(
    request: Request,
    auth: TokenData | APIClientData = Depends(get_current_user_or_api_client),
):
    if isinstance(auth, TokenData):
        db = get_database()
        user = await UserCollection.find_by_id(db, auth.user_id)
        if not user:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
        return UserDetailsResponse(
            id=str(user["_id"]),
            username=user["username"],
            email=user["email"],
            role=user["role"],
            auth_type="user",
        )
    return UserDetailsResponse(
        id=auth.client_id,
        username=auth.client_name,
        email="",
        auth_type="api_client",
        client_name=auth.client_name,
    )


@app.put("/user/toggle-role", response_model=ToggleRoleResponse)
@limiter.limit("10/minute")
async def toggle_role(
    request: Request,
    current_user: TokenData = Depends(get_current_user),
):
    new_role = "guest" if current_user.role == "admin" else "admin"
    db = get_database()
    updated_user = await UserCollection.update_role(db, current_user.user_id, new_role)
    if not updated_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    access_token = create_access_token(
        data={
            "user_id": str(updated_user["_id"]),
            "username": updated_user["username"],
            "role": new_role,
            "token_type": "user",
        },
        expires_delta=timedelta(minutes=JWT_ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return ToggleRoleResponse(
        access_token=access_token,
        token_type="bearer",
        expires_in=JWT_ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        user=UserResponse(
            id=str(updated_user["_id"]),
            username=updated_user["username"],
            email=updated_user["email"],
            role=new_role,
        ),
        message=f"Role changed from '{current_user.role}' to '{new_role}'",
    )


# ============================================================================
# API Client Management
# ============================================================================

@app.post("/api-clients", response_model=APIClientCreateResponse)
async def create_api_client(
    client_data: APIClientCreate,
    current_user: TokenData = Depends(get_current_user),
):
    client_id, client_secret = generate_client_credentials()
    hashed_secret = hash_client_secret(client_secret)
    db = get_database()
    client_doc = {
        "name": client_data.name,
        "client_id": client_id,
        "hashed_secret": hashed_secret,
        "created_by": current_user.user_id,
        "is_active": True,
        "created_at": datetime.now(timezone.utc),
    }
    created_client = await APIClientCollection.create(db, client_doc)
    return APIClientCreateResponse(
        id=str(created_client["_id"]),
        name=created_client["name"],
        client_id=created_client["client_id"],
        client_secret=client_secret,
        is_active=True,
        created_at=created_client["created_at"],
    )


@app.get("/api-clients", response_model=APIClientListResponse)
async def list_api_clients(current_user: TokenData = Depends(get_current_user)):
    db = get_database()
    clients = await APIClientCollection.find_by_user(db, current_user.user_id)
    return APIClientListResponse(
        clients=[
            APIClientResponse(
                id=str(c["_id"]),
                name=c["name"],
                client_id=c["client_id"],
                is_active=c.get("is_active", True),
                created_at=c["created_at"],
            )
            for c in clients
        ]
    )


@app.delete("/api-clients/{client_id}")
async def revoke_api_client(
    client_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    success = await APIClientCollection.deactivate(db, client_id, current_user.user_id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="API client not found or already revoked")
    return {"message": "API client revoked successfully"}


# ============================================================================
# WebSocket — Project Run Stream
# ============================================================================

class ConnectionManager:
    """Manages active WebSocket connections per project."""

    def __init__(self):
        self.active: dict[str, list[WebSocket]] = {}

    async def connect(self, project_id: str, ws: WebSocket):
        self.active.setdefault(project_id, []).append(ws)

    def disconnect(self, project_id: str, ws: WebSocket):
        connections = self.active.get(project_id, [])
        if ws in connections:
            connections.remove(ws)

    async def broadcast(self, project_id: str, message: dict):
        connections = self.active.get(project_id, [])
        dead = []
        for ws in connections:
            try:
                await ws.send_text(json.dumps(message))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(project_id, ws)


manager = ConnectionManager()


@app.websocket("/ws/projects/{project_id}")
async def project_ws(project_id: str, websocket: WebSocket):
    """
    WebSocket endpoint for real-time agent event streaming.

    Auth handshake — send as first message after connecting:
      { "type": "auth", "token": "<jwt>" }

    Control messages (frontend → backend):
      { "type": "pause" }
      { "type": "resume" }
      { "type": "redirect", "message": "..." }
      { "type": "hitl_response", "pause_id": "...", "response": "..." }
      { "type": "hitl_approve", "action_id": "..." }
      { "type": "hitl_reject", "action_id": "..." }
    """
    await websocket.accept()

    try:
        # Auth handshake
        raw = await websocket.receive_text()
        msg = json.loads(raw)

        if msg.get("type") != "auth" or not msg.get("token"):
            await websocket.send_text(json.dumps({"type": "error", "detail": "Auth required"}))
            await websocket.close(code=4001)
            return

        try:
            payload = decode_token(msg["token"])
        except HTTPException:
            await websocket.send_text(json.dumps({"type": "error", "detail": "Invalid token"}))
            await websocket.close(code=4001)
            return

        user_id = payload.get("user_id")
        if not user_id:
            await websocket.send_text(json.dumps({"type": "error", "detail": "Invalid token"}))
            await websocket.close(code=4001)
            return

        # Verify project ownership
        db = get_database()
        project = await ProjectCollection.find_by_id(db, project_id, user_id)
        if not project:
            await websocket.send_text(json.dumps({"type": "error", "detail": "Project not found"}))
            await websocket.close(code=4004)
            return

        await manager.connect(project_id, websocket)
        await websocket.send_text(json.dumps({"type": "connected", "project_id": project_id}))

        # Replay only events the client hasn't seen yet (skip already-received ones)
        run_id = msg.get("run_id")
        seen = int(msg.get("seen", 0))
        if run_id:
            db2 = get_database()
            run_doc = await RunCollection.find_by_id(db2, run_id, user_id)
            if run_doc:
                events = run_doc.get("events") or []
                for ev in events[seen:]:
                    await websocket.send_text(json.dumps(ev))

        # Listen for control messages
        while True:
            raw = await websocket.receive_text()
            control = json.loads(raw)
            ctrl_type = control.get("type")
            if ctrl_type == "pause":
                from executor import pause_run
                pause_run(control.get("run_id", ""))
                await manager.broadcast(project_id, {"type": "run_paused", "run_id": control.get("run_id", "")})
            elif ctrl_type == "resume":
                from executor import resume_run
                resume_run(control.get("run_id", ""))
                await manager.broadcast(project_id, {"type": "run_resumed", "run_id": control.get("run_id", "")})
            elif ctrl_type == "hitl_response":
                from executor import resume_run
                resume_run(control.get("run_id", ""), hitl_response=control.get("response"))
                await manager.broadcast(project_id, {
                    "type": "hitl_resumed",
                    "run_id": control.get("run_id", ""),
                    "pause_id": control.get("pause_id"),
                    "response": control.get("response"),
                })
            else:
                await websocket.send_text(json.dumps({"type": "ack", "received": control}))

    except WebSocketDisconnect:
        manager.disconnect(project_id, websocket)
    except HTTPException:
        try:
            await websocket.close(code=4001)
        except Exception:
            pass
    except Exception:
        manager.disconnect(project_id, websocket)
        try:
            await websocket.close(code=1011)
        except Exception:
            pass


if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)
