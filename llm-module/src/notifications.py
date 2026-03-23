from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
import httpx
import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent.parent / ".env")

SUPABASE_URL = (
    os.getenv("SUPABASE_URL")
    or os.getenv("VITE_SUPABASE_URL")
    or ""
).rstrip("/")
SUPABASE_KEY = (
    os.getenv("SUPABASE_ANON_KEY")
    or os.getenv("VITE_SUPABASE_ANON_KEY")
    or os.getenv("SUPABASE_PUBLISHABLE_KEY")
    or os.getenv("SUPABASE_KEY")
    or ""
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


class NotificationOut(BaseModel):
    id: int
    user_id: int
    task_id: Optional[int]
    type: str
    title: str
    message: Optional[str]
    is_read: bool
    created_at: datetime


def _ensure_supabase_env() -> None:
    if not SUPABASE_URL or not SUPABASE_KEY:
        raise HTTPException(
            status_code=500,
            detail="SUPABASE_URL/SUPABASE_ANON_KEY не заданы в llm-module/.env",
        )


def _headers(prefer: Optional[str] = None) -> dict:
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    return headers


async def _request(
    method: str,
    path: str,
    *,
    params: Optional[dict] = None,
    json: Optional[dict] = None,
    prefer: Optional[str] = None,
):
    _ensure_supabase_env()
    url = f"{SUPABASE_URL}/rest/v1/{path.lstrip('/')}"

    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.request(
            method,
            url,
            headers=_headers(prefer),
            params=params,
            json=json,
        )

    if response.status_code >= 400:
        detail = response.text
        try:
            parsed = response.json()
            detail = parsed.get("message") or parsed.get("hint") or parsed
        except Exception:
            pass
        raise HTTPException(status_code=response.status_code, detail=str(detail))

    if "application/json" not in response.headers.get("content-type", ""):
        return None
    return response.json()


@router.get("/", response_model=List[NotificationOut])
async def get_notifications(
    user_id: int,
    unread_only: bool = False,
    limit: int = 30,
):
    params = {
        "select": "id,user_id,task_id,type,title,message,is_read,created_at",
        "user_id": f"eq.{user_id}",
        "order": "created_at.desc",
        "limit": str(limit),
    }
    if unread_only:
        params["is_read"] = "eq.false"

    data = await _request("GET", "notifications", params=params)
    return data or []


@router.patch("/{notif_id}/read")
async def mark_read(
    notif_id: int,
    user_id: int,
):
    params = {
        "id": f"eq.{notif_id}",
        "user_id": f"eq.{user_id}",
        "select": "id",
    }

    data = await _request(
        "PATCH",
        "notifications",
        params=params,
        json={"is_read": True},
        prefer="return=representation",
    )

    if not data:
        raise HTTPException(status_code=404, detail="Уведомление не найдено или не ваше")

    return {"status": "read"}
