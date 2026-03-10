from fastapi import APIRouter, Depends, HTTPException, status
from database_mongo import get_database
from models_mongo import SecretsVaultCollection
from schemas import SecretCreate, SecretUpdate, SecretResponse, SecretListResponse
from auth import TokenData, get_current_user
from crypto_utils import encrypt_value, decrypt_value

router = APIRouter(prefix="/vault", tags=["vault"])


def _fmt(s: dict) -> SecretResponse:
    return SecretResponse(
        id=str(s["_id"]),
        label=s["label"],
        scope=s.get("scope", "global"),
        created_at=s["created_at"],
        updated_at=s["updated_at"],
    )


@router.post("", response_model=SecretResponse, status_code=status.HTTP_201_CREATED)
async def create_secret(
    body: SecretCreate,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    # Check for duplicate label for this user
    existing = await SecretsVaultCollection.find_by_label(db, current_user.user_id, body.label)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Secret with label '{body.label}' already exists. Use PUT to update.",
        )
    doc = {
        "user_id": current_user.user_id,
        "label": body.label,
        "encrypted_value": encrypt_value(body.value),
        "scope": body.scope,
    }
    created = await SecretsVaultCollection.create(db, doc)
    return _fmt(created)


@router.get("", response_model=SecretListResponse)
async def list_secrets(current_user: TokenData = Depends(get_current_user)):
    db = get_database()
    # Labels only — encrypted_value is excluded in the collection query
    secrets = await SecretsVaultCollection.find_by_user(db, current_user.user_id)
    return SecretListResponse(secrets=[_fmt(s) for s in secrets])


@router.put("/{secret_id}", response_model=SecretResponse)
async def update_secret(
    secret_id: str,
    body: SecretUpdate,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    updates: dict = {}
    if body.value is not None:
        updates["encrypted_value"] = encrypt_value(body.value)
    if body.scope is not None:
        updates["scope"] = body.scope
    if not updates:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No fields to update")
    updated = await SecretsVaultCollection.update(db, secret_id, current_user.user_id, updates)
    if not updated:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found")
    return _fmt(updated)


@router.delete("/{secret_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_secret(
    secret_id: str,
    current_user: TokenData = Depends(get_current_user),
):
    db = get_database()
    deleted = await SecretsVaultCollection.delete(db, secret_id, current_user.user_id)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Secret not found")
