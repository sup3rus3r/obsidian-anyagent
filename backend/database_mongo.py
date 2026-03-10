from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorGridFSBucket
from typing import Optional
import os

MONGO_URL = os.getenv("MONGO_URL", "mongodb://localhost:27017")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "obsidian_agents")

client: Optional[AsyncIOMotorClient] = None
db = None
gridfs_bucket: Optional[AsyncIOMotorGridFSBucket] = None


async def connect_to_mongo():
    global client, db, gridfs_bucket
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[MONGO_DB_NAME]
    gridfs_bucket = AsyncIOMotorGridFSBucket(db, bucket_name="artifacts")


async def close_mongo_connection():
    global client
    if client:
        client.close()


def get_database():
    return db


def get_gridfs() -> AsyncIOMotorGridFSBucket:
    return gridfs_bucket
