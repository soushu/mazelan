import logging
import os
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

logger = logging.getLogger(__name__)

load_dotenv()

limiter = Limiter(key_func=get_remote_address)

_is_prod = os.getenv("ENV", "development") == "production"
app = FastAPI(
    title="mazelan",
    docs_url=None if _is_prod else "/docs",
    redoc_url=None if _is_prod else "/redoc",
    openapi_url=None if _is_prod else "/openapi.json",
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:3000").split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "X-API-Key", "X-Anthropic-Key", "X-Google-Fallback-Key", "X-Internal-API-Key", "X-API-Key-A", "X-API-Key-B"],
)


# Production error handlers: hide internal details, except auth endpoints
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    # Auth endpoints: show specific validation errors (e.g. password strength)
    if str(request.url.path).startswith("/auth/"):
        messages = []
        for err in exc.errors():
            msg = err.get("msg", "")
            # Pydantic wraps field_validator messages as "Value error, ..."
            if msg.startswith("Value error, "):
                msg = msg[len("Value error, "):]
            messages.append(msg)
        return JSONResponse(
            status_code=422,
            content={"detail": "; ".join(messages) if messages else "Invalid request"},
        )
    return JSONResponse(
        status_code=422,
        content={"detail": "Invalid request"},
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.error("Unhandled exception: %s", exc, exc_info=True)
    from backend.slack_notify import notify_error
    notify_error(str(request.url.path), str(exc))
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )


_internal_key = os.getenv("INTERNAL_API_KEY", "")
if _is_prod and len(_internal_key) < 32:
    logger.warning("INTERNAL_API_KEY is too short (%d chars). Use at least 32 characters in production.", len(_internal_key))

from backend.routers import auth, chat, contexts, debate, sessions

app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(contexts.router)
app.include_router(debate.router)
app.include_router(sessions.router)


@app.on_event("startup")
def startup():
    if _is_prod:
        from backend.serpapi_monitor import start_monitor
        start_monitor()


@app.get("/health")
def health():
    return {"status": "ok"}
