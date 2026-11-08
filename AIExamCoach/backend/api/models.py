from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from backend.api.deps import DB, USER
from backend.models.entities import User
from backend.security.auth import audit, client_ip, require_admin
from backend.services import model_manager as mm
from backend.services import ollama
from backend.services.system_info import system_info

ADMIN = Depends(require_admin)

router = APIRouter(prefix="/api/models", tags=["models"])
NAME = r"^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,100}$"


@router.get("")
async def overview(user: User = USER):
    return await mm.overview()


@router.get("/system")
def system(user: User = USER):
    return system_info(fresh=True)


class PullIn(BaseModel):
    model: str = Field(pattern=NAME)
    approved: bool = False


@router.post("/check")
def check(body: PullIn, user: User = ADMIN):
    return mm.check_capacity(body.model)


@router.post("/pull")
async def pull(body: PullIn, request: Request, db=DB, user: User = ADMIN):
    try:
        await ollama.version()
    except ollama.OllamaUnavailable as e:
        raise HTTPException(503, str(e))
    res = mm.start_pull(body.model, body.approved)
    if res.get("started"):
        audit(db, "model_pull", user_id=user.id, detail=body.model, ip=client_ip(request))
    return res


@router.post("/pull/{model:path}/cancel")
def cancel_pull(model: str, user: User = ADMIN):
    return {"cancelled": mm.cancel_pull(model)}


class DeleteIn(BaseModel):
    model: str = Field(pattern=NAME)
    confirm: str


@router.post("/delete")
async def delete(body: DeleteIn, request: Request, db=DB, user: User = ADMIN):
    if body.confirm != body.model:
        raise HTTPException(400, "Type the exact model name to confirm deletion")
    from backend.config import get_settings

    s = get_settings()
    if body.model in (s.chat_model, s.embedding_model):
        raise HTTPException(409, "This model is active. Select another active model first.")
    await ollama.delete(body.model)
    audit(db, "model_deleted", user_id=user.id, detail=body.model, ip=client_ip(request))
    return {"deleted": body.model}


class ActiveIn(BaseModel):
    chat_model: str | None = Field(None, pattern=NAME)
    embedding_model: str | None = Field(None, pattern=NAME)


@router.post("/active")
async def set_active(body: ActiveIn, request: Request, db=DB, user: User = ADMIN):
    try:
        res = await mm.set_active(body.chat_model, body.embedding_model)
    except ValueError as e:
        raise HTTPException(400, str(e))
    audit(db, "model_activated", user_id=user.id, detail=str(res), ip=client_ip(request))
    if body.embedding_model:
        res["note"] = "Embedding model changed: re-index your documents (Document Library → Re-index all) so search uses the new model."
    return res


class TestIn(BaseModel):
    model: str | None = Field(None, pattern=NAME)
    kind: str = Field("chat", pattern="^(chat|embedding)$")


@router.post("/test")
async def test(body: TestIn, user: User = ADMIN):
    try:
        return await (mm.test_inference(body.model) if body.kind == "chat" else mm.test_embedding(body.model))
    except ollama.OllamaError as e:
        raise HTTPException(503, str(e))


@router.post("/unload")
async def unload(body: TestIn, user: User = ADMIN):
    from backend.config import get_settings

    await ollama.unload(body.model or get_settings().chat_model)
    return {"ok": True}
