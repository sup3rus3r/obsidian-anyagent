from pydantic import BaseModel, Field
from typing import Optional, Any
from datetime import datetime, timezone
from bson import ObjectId


class PyObjectId(ObjectId):
    @classmethod
    def __get_validators__(cls):
        yield cls.validate

    @classmethod
    def validate(cls, v, handler):
        if not ObjectId.is_valid(v):
            raise ValueError("Invalid ObjectId")
        return ObjectId(v)

    @classmethod
    def __get_pydantic_json_schema__(cls, schema, handler):
        return {"type": "string"}


def utcnow():
    return datetime.now(timezone.utc)


# ============================================================================
# Users
# ============================================================================

class UserCollection:
    collection_name = "users"

    @classmethod
    async def create_indexes(cls, db):
        col = db[cls.collection_name]
        await col.create_index("username", unique=True)
        await col.create_index("email", unique=True)

    @classmethod
    async def find_by_username(cls, db, username: str) -> Optional[dict]:
        return await db[cls.collection_name].find_one({"username": username})

    @classmethod
    async def find_by_email(cls, db, email: str) -> Optional[dict]:
        return await db[cls.collection_name].find_one({"email": email})

    @classmethod
    async def create(cls, db, user_data: dict) -> dict:
        user_data.setdefault("created_at", utcnow())
        result = await db[cls.collection_name].insert_one(user_data)
        user_data["_id"] = result.inserted_id
        return user_data

    @classmethod
    async def find_by_id(cls, db, user_id: str) -> Optional[dict]:
        return await db[cls.collection_name].find_one({"_id": ObjectId(user_id)})

    @classmethod
    async def update_role(cls, db, user_id: str, new_role: str) -> Optional[dict]:
        return await db[cls.collection_name].find_one_and_update(
            {"_id": ObjectId(user_id)},
            {"$set": {"role": new_role}},
            return_document=True,
        )


# ============================================================================
# API Clients
# ============================================================================

class APIClientCollection:
    collection_name = "api_clients"

    @classmethod
    async def create_indexes(cls, db):
        await db[cls.collection_name].create_index("client_id", unique=True)

    @classmethod
    async def find_by_client_id(cls, db, client_id: str) -> Optional[dict]:
        return await db[cls.collection_name].find_one({"client_id": client_id, "is_active": True})

    @classmethod
    async def find_by_user(cls, db, user_id: str) -> list[dict]:
        cursor = db[cls.collection_name].find({"created_by": user_id})
        return await cursor.to_list(length=100)

    @classmethod
    async def create(cls, db, client_data: dict) -> dict:
        client_data.setdefault("created_at", utcnow())
        result = await db[cls.collection_name].insert_one(client_data)
        client_data["_id"] = result.inserted_id
        return client_data

    @classmethod
    async def deactivate(cls, db, client_id: str, user_id: str) -> bool:
        result = await db[cls.collection_name].update_one(
            {"client_id": client_id, "created_by": user_id},
            {"$set": {"is_active": False}},
        )
        return result.modified_count > 0


# ============================================================================
# Projects
# ============================================================================

class ProjectCollection:
    collection_name = "projects"

    @classmethod
    async def create_indexes(cls, db):
        col = db[cls.collection_name]
        await col.create_index("user_id")
        await col.create_index([("user_id", 1), ("created_at", -1)])

    @classmethod
    async def create(cls, db, data: dict) -> dict:
        data.setdefault("created_at", utcnow())
        data.setdefault("updated_at", utcnow())
        result = await db[cls.collection_name].insert_one(data)
        data["_id"] = result.inserted_id
        return data

    @classmethod
    async def find_by_user(cls, db, user_id: str) -> list[dict]:
        cursor = db[cls.collection_name].find(
            {"user_id": user_id},
            sort=[("updated_at", -1)],
        )
        return await cursor.to_list(length=200)

    @classmethod
    async def find_by_id(cls, db, project_id: str, user_id: str) -> Optional[dict]:
        return await db[cls.collection_name].find_one(
            {"_id": ObjectId(project_id), "user_id": user_id}
        )

    @classmethod
    async def update(cls, db, project_id: str, user_id: str, data: dict) -> Optional[dict]:
        data["updated_at"] = utcnow()
        return await db[cls.collection_name].find_one_and_update(
            {"_id": ObjectId(project_id), "user_id": user_id},
            {"$set": data},
            return_document=True,
        )

    @classmethod
    async def delete(cls, db, project_id: str, user_id: str) -> bool:
        result = await db[cls.collection_name].delete_one(
            {"_id": ObjectId(project_id), "user_id": user_id}
        )
        return result.deleted_count > 0


# ============================================================================
# Runs
# ============================================================================

class RunCollection:
    collection_name = "runs"

    @classmethod
    async def create_indexes(cls, db):
        col = db[cls.collection_name]
        await col.create_index("project_id")
        await col.create_index("user_id")
        await col.create_index([("project_id", 1), ("created_at", -1)])

    @classmethod
    async def create(cls, db, data: dict) -> dict:
        data.setdefault("created_at", utcnow())
        data.setdefault("status", "pending")
        data.setdefault("events", [])
        result = await db[cls.collection_name].insert_one(data)
        data["_id"] = result.inserted_id
        return data

    @classmethod
    async def find_by_project(cls, db, project_id: str, user_id: str) -> list[dict]:
        cursor = db[cls.collection_name].find(
            {"project_id": project_id, "user_id": user_id},
            sort=[("created_at", -1)],
        )
        return await cursor.to_list(length=100)

    @classmethod
    async def find_by_id(cls, db, run_id: str, user_id: str) -> Optional[dict]:
        return await db[cls.collection_name].find_one(
            {"_id": ObjectId(run_id), "user_id": user_id}
        )

    @classmethod
    async def update_status(cls, db, run_id: str, status: str, extra: dict = {}) -> Optional[dict]:
        update = {"status": status, **extra}
        if status in ("completed", "error"):
            update["completed_at"] = utcnow()
        return await db[cls.collection_name].find_one_and_update(
            {"_id": ObjectId(run_id)},
            {"$set": update},
            return_document=True,
        )

    @classmethod
    async def append_event(cls, db, run_id: str, event: dict):
        await db[cls.collection_name].update_one(
            {"_id": ObjectId(run_id)},
            {"$push": {"events": event}},
        )


# ============================================================================
# Agent Library
# ============================================================================

class AgentLibraryCollection:
    collection_name = "agent_library"

    @classmethod
    async def create_indexes(cls, db):
        col = db[cls.collection_name]
        await col.create_index("user_id")
        await col.create_index("is_base")

    @classmethod
    async def seed_base_agents(cls, db):
        """Insert platform base agent templates if not already present."""
        col = db[cls.collection_name]
        if await col.count_documents({"is_base": True}) > 0:
            return

        base_agents = [
            {
                "name": "OrchestratorAgent",
                "role": "Plans, decomposes, and coordinates the team. The meta-agent.",
                "instructions": (
                    "You are the orchestrator. Analyze the user's task, decompose it into subtasks, "
                    "and decide which specialist agents are needed. Produce a structured AgentTeamPlan. "
                    "Always ask for clarification before making irreversible decisions."
                ),
                "tools": ["task_planning", "hitl_escalation"],
                "model_override": None,
                "is_base": True,
                "user_id": None,
                "created_at": utcnow(),
            },
            {
                "name": "ResearchAgent",
                "role": "Web search, fact-finding, and summarization.",
                "instructions": (
                    "You are a research specialist. Search the web, fetch URLs, and synthesize "
                    "accurate, cited information. Always prefer primary sources."
                ),
                "tools": ["web_search", "url_fetch", "knowledge_base"],
                "model_override": None,
                "is_base": True,
                "user_id": None,
                "created_at": utcnow(),
            },
            {
                "name": "CodeAgent",
                "role": "Write, run, and debug code in a sandboxed Docker environment.",
                "instructions": (
                    "You are a software engineer. Write clean, well-structured code, execute it in "
                    "the sandbox, and iterate based on output. Always handle errors gracefully."
                ),
                "tools": ["docker_exec", "file_read", "file_write", "bash"],
                "model_override": None,
                "is_base": True,
                "user_id": None,
                "created_at": utcnow(),
            },
            {
                "name": "FileAgent",
                "role": "Read, write, analyze, and transform files.",
                "instructions": (
                    "You are a file management specialist. Read, write, and transform files "
                    "including CSV, JSON, and text. Upload results to artifact storage."
                ),
                "tools": ["file_read", "file_write", "csv_parse", "gridfs_upload"],
                "model_override": None,
                "is_base": True,
                "user_id": None,
                "created_at": utcnow(),
            },
            {
                "name": "BrowserAgent",
                "role": "Web automation, scraping, and form filling.",
                "instructions": (
                    "You are a browser automation specialist. Navigate web pages, extract content, "
                    "and interact with forms. Handle dynamic content and authentication flows."
                ),
                "tools": ["browser_navigate", "browser_extract", "browser_click"],
                "model_override": None,
                "is_base": True,
                "user_id": None,
                "created_at": utcnow(),
            },
            {
                "name": "DataAgent",
                "role": "Data analysis, visualization, and statistics.",
                "instructions": (
                    "You are a data analyst. Load datasets, perform statistical analysis, "
                    "generate visualizations, and produce clear insights."
                ),
                "tools": ["pandas_tools", "chart_generation", "file_read"],
                "model_override": None,
                "is_base": True,
                "user_id": None,
                "created_at": utcnow(),
            },
            {
                "name": "APIAgent",
                "role": "Call external REST APIs using vault-stored credentials.",
                "instructions": (
                    "You are an API integration specialist. Make HTTP requests to external services "
                    "using credentials from the secrets vault. Handle pagination, auth flows, and errors."
                ),
                "tools": ["http_client", "vault_key_inject"],
                "model_override": None,
                "is_base": True,
                "user_id": None,
                "created_at": utcnow(),
            },
            {
                "name": "WriterAgent",
                "role": "Draft documents, reports, and structured content.",
                "instructions": (
                    "You are a professional writer. Produce well-structured, clear, and accurate "
                    "documents, reports, and content. Adapt tone to the audience."
                ),
                "tools": ["file_write", "template_tools"],
                "model_override": None,
                "is_base": True,
                "user_id": None,
                "created_at": utcnow(),
            },
            {
                "name": "ReviewerAgent",
                "role": "Review and QA outputs from other agents.",
                "instructions": (
                    "You are a quality assurance specialist. Review outputs from other agents, "
                    "identify errors, inconsistencies, and improvements. Provide structured feedback."
                ),
                "tools": ["file_read", "diff_tools"],
                "model_override": None,
                "is_base": True,
                "user_id": None,
                "created_at": utcnow(),
            },
        ]
        await col.insert_many(base_agents)

    @classmethod
    async def find_base_agents(cls, db) -> list[dict]:
        cursor = db[cls.collection_name].find({"is_base": True})
        return await cursor.to_list(length=50)

    @classmethod
    async def find_user_agents(cls, db, user_id: str) -> list[dict]:
        cursor = db[cls.collection_name].find(
            {"$or": [{"is_base": True}, {"user_id": user_id}]}
        )
        return await cursor.to_list(length=200)

    @classmethod
    async def create(cls, db, data: dict) -> dict:
        data.setdefault("created_at", utcnow())
        data.setdefault("is_base", False)
        result = await db[cls.collection_name].insert_one(data)
        data["_id"] = result.inserted_id
        return data

    @classmethod
    async def find_by_id(cls, db, agent_id: str) -> Optional[dict]:
        return await db[cls.collection_name].find_one({"_id": ObjectId(agent_id)})

    @classmethod
    async def update(cls, db, agent_id: str, user_id: str, data: dict) -> Optional[dict]:
        return await db[cls.collection_name].find_one_and_update(
            {"_id": ObjectId(agent_id), "user_id": user_id, "is_base": False},
            {"$set": data},
            return_document=True,
        )

    @classmethod
    async def delete(cls, db, agent_id: str, user_id: str) -> bool:
        result = await db[cls.collection_name].delete_one(
            {"_id": ObjectId(agent_id), "user_id": user_id, "is_base": False}
        )
        return result.deleted_count > 0


# ============================================================================
# Secrets Vault
# ============================================================================

class SecretsVaultCollection:
    collection_name = "secrets_vault"

    @classmethod
    async def create_indexes(cls, db):
        col = db[cls.collection_name]
        await col.create_index("user_id")
        await col.create_index([("user_id", 1), ("label", 1)], unique=True)

    @classmethod
    async def create(cls, db, data: dict) -> dict:
        data.setdefault("created_at", utcnow())
        data["updated_at"] = utcnow()
        result = await db[cls.collection_name].insert_one(data)
        data["_id"] = result.inserted_id
        return data

    @classmethod
    async def find_by_user(cls, db, user_id: str) -> list[dict]:
        """Return labels only — never encrypted_value."""
        cursor = db[cls.collection_name].find(
            {"user_id": user_id},
            projection={"encrypted_value": 0},
        )
        return await cursor.to_list(length=200)

    @classmethod
    async def find_by_label(cls, db, user_id: str, label: str) -> Optional[dict]:
        """Return full document including encrypted_value — for internal runtime use only."""
        return await db[cls.collection_name].find_one(
            {"user_id": user_id, "label": label}
        )

    @classmethod
    async def find_by_scope(cls, db, user_id: str, project_id: str) -> list[dict]:
        """Return all secrets accessible to a project (global + project-scoped)."""
        cursor = db[cls.collection_name].find({
            "user_id": user_id,
            "$or": [
                {"scope": "global"},
                {"scope": f"project:{project_id}"},
            ],
        })
        return await cursor.to_list(length=200)

    @classmethod
    async def update(cls, db, secret_id: str, user_id: str, data: dict) -> Optional[dict]:
        data["updated_at"] = utcnow()
        return await db[cls.collection_name].find_one_and_update(
            {"_id": ObjectId(secret_id), "user_id": user_id},
            {"$set": data},
            return_document=True,
        )

    @classmethod
    async def delete(cls, db, secret_id: str, user_id: str) -> bool:
        result = await db[cls.collection_name].delete_one(
            {"_id": ObjectId(secret_id), "user_id": user_id}
        )
        return result.deleted_count > 0


# ============================================================================
# MCP Connections
# ============================================================================

class MCPConnectionCollection:
    collection_name = "mcp_connections"

    @classmethod
    async def create_indexes(cls, db):
        await db[cls.collection_name].create_index("user_id")

    @classmethod
    async def create(cls, db, data: dict) -> dict:
        data.setdefault("created_at", utcnow())
        data.setdefault("enabled", True)
        data.setdefault("discovered_tools", [])
        result = await db[cls.collection_name].insert_one(data)
        data["_id"] = result.inserted_id
        return data

    @classmethod
    async def find_by_user(cls, db, user_id: str) -> list[dict]:
        cursor = db[cls.collection_name].find({"user_id": user_id})
        return await cursor.to_list(length=100)

    @classmethod
    async def find_by_id(cls, db, conn_id: str, user_id: str) -> Optional[dict]:
        return await db[cls.collection_name].find_one(
            {"_id": ObjectId(conn_id), "user_id": user_id}
        )

    @classmethod
    async def update(cls, db, conn_id: str, user_id: str, data: dict) -> Optional[dict]:
        return await db[cls.collection_name].find_one_and_update(
            {"_id": ObjectId(conn_id), "user_id": user_id},
            {"$set": data},
            return_document=True,
        )

    @classmethod
    async def delete(cls, db, conn_id: str, user_id: str) -> bool:
        result = await db[cls.collection_name].delete_one(
            {"_id": ObjectId(conn_id), "user_id": user_id}
        )
        return result.deleted_count > 0
