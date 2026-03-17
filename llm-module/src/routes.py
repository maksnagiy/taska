from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status

try:
    from config import Settings, get_settings
    from llm import agenerate_chat_response, agenerate_encouragement_response
    from schemas import ChatRequest, EncouragementRequest, LLMResponse
except ImportError:  # pragma: no cover
    from src.config import Settings, get_settings
    from src.llm import agenerate_chat_response, agenerate_encouragement_response
    from src.schemas import ChatRequest, EncouragementRequest, LLMResponse


router = APIRouter(prefix="/llm", tags=["llm"])


@router.get("/health")
async def healthcheck() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/chat", response_model=LLMResponse)
async def chat(
    request: ChatRequest,
    settings: Settings = Depends(get_settings),
) -> LLMResponse:
    try:
        return await agenerate_chat_response(
            request,
            settings.get_llm_config(),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "message": "Ошибка обработки ответа LLM для chat-запроса",
                "error": str(exc),
            },
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "message": "Ошибка при вызове LLM для chat-запроса",
                "error": str(exc),
            },
        ) from exc


@router.post("/encouragement", response_model=LLMResponse)
async def encouragement(
    request: EncouragementRequest,
    settings: Settings = Depends(get_settings),
) -> LLMResponse:
    try:
        return await agenerate_encouragement_response(
            request,
            settings.get_llm_config(),
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "message": "Ошибка обработки ответа LLM для encouragement-запроса",
                "error": str(exc),
            },
        ) from exc
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "message": "Ошибка при вызове LLM для encouragement-запроса",
                "error": str(exc),
            },
        ) from exc