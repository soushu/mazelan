import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.database import get_db
from backend.dependencies import get_current_user_id
from backend.models import Context

limiter = Limiter(key_func=get_remote_address)
router = APIRouter(prefix="/contexts", tags=["contexts"])


class ContextCreate(BaseModel):
    content: str
    category: str = "general"


class ContextUpdate(BaseModel):
    content: str | None = None
    category: str | None = None


class ContextResponse(BaseModel):
    id: str
    content: str
    category: str
    source: str
    is_active: bool
    created_at: str
    updated_at: str

    class Config:
        from_attributes = True


@router.get("")
def list_contexts(
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    contexts = (
        db.query(Context)
        .filter(Context.user_id == current_user_id)
        .order_by(Context.category, Context.created_at.desc())
        .all()
    )
    grouped: dict[str, list] = {}
    for c in contexts:
        item = ContextResponse(
            id=str(c.id),
            content=c.content,
            category=c.category,
            source=c.source,
            is_active=c.is_active,
            created_at=c.created_at.isoformat(),
            updated_at=c.updated_at.isoformat(),
        )
        grouped.setdefault(c.category, []).append(item)
    return {"contexts": grouped, "total": len(contexts)}


@router.post("", response_model=ContextResponse, status_code=201)
@limiter.limit("20/minute")
def create_context(
    request: Request,
    req: ContextCreate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    ctx = Context(
        user_id=current_user_id,
        content=req.content.strip(),
        category=req.category,
        source="manual",
    )
    db.add(ctx)
    db.commit()
    db.refresh(ctx)
    return ContextResponse(
        id=str(ctx.id),
        content=ctx.content,
        category=ctx.category,
        source=ctx.source,
        is_active=ctx.is_active,
        created_at=ctx.created_at.isoformat(),
        updated_at=ctx.updated_at.isoformat(),
    )


@router.patch("/{context_id}", response_model=ContextResponse)
@limiter.limit("20/minute")
def update_context(
    request: Request,
    context_id: uuid.UUID,
    req: ContextUpdate,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    ctx = db.query(Context).filter(Context.id == context_id).first()
    if not ctx:
        raise HTTPException(status_code=404, detail="Context not found")
    if ctx.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")

    if req.content is not None:
        ctx.content = req.content.strip()
    if req.category is not None:
        ctx.category = req.category
    ctx.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(ctx)
    return ContextResponse(
        id=str(ctx.id),
        content=ctx.content,
        category=ctx.category,
        source=ctx.source,
        is_active=ctx.is_active,
        created_at=ctx.created_at.isoformat(),
        updated_at=ctx.updated_at.isoformat(),
    )


@router.delete("/{context_id}", status_code=204)
@limiter.limit("20/minute")
def delete_context(
    request: Request,
    context_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    ctx = db.query(Context).filter(Context.id == context_id).first()
    if not ctx:
        raise HTTPException(status_code=404, detail="Context not found")
    if ctx.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    db.delete(ctx)
    db.commit()


@router.patch("/{context_id}/toggle", response_model=ContextResponse)
@limiter.limit("20/minute")
def toggle_context(
    request: Request,
    context_id: uuid.UUID,
    current_user_id: uuid.UUID = Depends(get_current_user_id),
    db: Session = Depends(get_db),
):
    ctx = db.query(Context).filter(Context.id == context_id).first()
    if not ctx:
        raise HTTPException(status_code=404, detail="Context not found")
    if ctx.user_id != current_user_id:
        raise HTTPException(status_code=403, detail="Forbidden")
    ctx.is_active = not ctx.is_active
    ctx.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(ctx)
    return ContextResponse(
        id=str(ctx.id),
        content=ctx.content,
        category=ctx.category,
        source=ctx.source,
        is_active=ctx.is_active,
        created_at=ctx.created_at.isoformat(),
        updated_at=ctx.updated_at.isoformat(),
    )
