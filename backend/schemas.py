from pydantic import BaseModel, EmailStr
from typing import Optional, Any
from datetime import datetime


# ============================================================================
# Auth
# ============================================================================

class EncryptedRequest(BaseModel):
    encrypted: str

class UserCreate(BaseModel):
    username    : str
    email       : EmailStr
    password    : str
    role        : str

class UserLogin(BaseModel):
    username    : str
    password    : str

class UserResponse(BaseModel):
    id          : str
    username    : str
    email       : str
    role        : str

    class Config:
        from_attributes = True

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse

class LoginResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse

class APIClientCreate(BaseModel):
    name: str

class APIClientResponse(BaseModel):
    id: str
    name: str
    client_id: str
    is_active: bool
    created_at: datetime

    class Config:
        from_attributes = True

class APIClientCreateResponse(BaseModel):
    id: str
    name: str
    client_id: str
    client_secret: str
    is_active: bool
    created_at: datetime
    message: str = "Store the client_secret securely. It will not be shown again."

class APIClientListResponse(BaseModel):
    clients: list[APIClientResponse]

class UserDetailsResponse(BaseModel):
    id: str
    username: str
    email: str
    role: Optional[str] = None
    auth_type: str
    client_name: Optional[str] = None

class ToggleRoleResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: UserResponse
    message: str


# ============================================================================
# Projects
# ============================================================================

class ProjectCreate(BaseModel):
    name: str
    description: Optional[str] = None

class ProjectUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

class ModelConfigData(BaseModel):
    primary: str = "claude-sonnet-4-6"
    overrides: dict[str, str] = {}

class ProjectResponse(BaseModel):
    id: str
    user_id: str
    name: str
    description: Optional[str] = None
    container_id: Optional[str] = None
    session_id: Optional[str] = None
    model_config_data: Optional[ModelConfigData] = None
    workspace_path: Optional[str] = None
    created_at: datetime
    updated_at: datetime

class ProjectListResponse(BaseModel):
    projects: list[ProjectResponse]


# ============================================================================
# Runs
# ============================================================================

class RunCreate(BaseModel):
    task: str
    model_id: Optional[str] = None
    lmstudio_url: Optional[str] = None  # Override for LM Studio base URL

class RunResponse(BaseModel):
    id: str
    project_id: str
    user_id: str
    task: str
    status: str
    model_id: Optional[str] = None
    lmstudio_url: Optional[str] = None
    proposed_plan: Optional[Any] = None
    approved_plan: Optional[Any] = None
    summary: Optional[str] = None
    token_usage: Optional[dict] = None
    created_at: datetime
    completed_at: Optional[datetime] = None

class RunListResponse(BaseModel):
    runs: list[RunResponse]


# ============================================================================
# Agent Library
# ============================================================================

class AgentCreate(BaseModel):
    name: str
    role: str
    instructions: str
    tools: list[str] = []
    model_override: Optional[str] = None

class AgentUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    instructions: Optional[str] = None
    tools: Optional[list[str]] = None
    model_override: Optional[str] = None

class AgentResponse(BaseModel):
    id: str
    name: str
    role: str
    instructions: str
    tools: list[str]
    model_override: Optional[str] = None
    is_base: bool
    user_id: Optional[str] = None
    created_at: datetime

class AgentLibraryResponse(BaseModel):
    agents: list[AgentResponse]


# ============================================================================
# Secrets Vault
# ============================================================================

class SecretCreate(BaseModel):
    label: str
    value: str
    scope: str = "global"  # "global" | "project:<project_id>"

class SecretUpdate(BaseModel):
    value: Optional[str] = None
    scope: Optional[str] = None

class SecretResponse(BaseModel):
    id: str
    label: str
    scope: str
    created_at: datetime
    updated_at: datetime
    # NOTE: value is NEVER returned

class SecretListResponse(BaseModel):
    secrets: list[SecretResponse]


# ============================================================================
# MCP Connections
# ============================================================================

class MCPToolSchema(BaseModel):
    name: str
    description: Optional[str] = None
    input_schema: Optional[dict] = None

class MCPConnectionCreate(BaseModel):
    name: str
    transport: str  # "stdio" | "http" | "sse"
    command: Optional[str] = None   # for stdio
    url: Optional[str] = None       # for http/sse
    auth_token: Optional[str] = None

class MCPConnectionUpdate(BaseModel):
    name: Optional[str] = None
    enabled: Optional[bool] = None
    command: Optional[str] = None
    url: Optional[str] = None
    auth_token: Optional[str] = None

class MCPConnectionResponse(BaseModel):
    id: str
    name: str
    transport: str
    command: Optional[str] = None
    url: Optional[str] = None
    enabled: bool
    discovered_tools: list[MCPToolSchema] = []
    created_at: datetime

class MCPConnectionListResponse(BaseModel):
    connections: list[MCPConnectionResponse]


# ============================================================================
# Artifacts (GridFS)
# ============================================================================

class ArtifactResponse(BaseModel):
    id: str
    filename: str
    mime_type: Optional[str] = None
    project_id: Optional[str] = None
    run_id: Optional[str] = None
    agent_id: Optional[str] = None
    size: int
    created_at: datetime

class ArtifactListResponse(BaseModel):
    artifacts: list[ArtifactResponse]
