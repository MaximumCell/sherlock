"""Sherlock gateway: takes commands from the web app (see docs/CONTRACTS.md).

It validates, authorises, rate-limits and enqueues; the workers do the scanning and
the browser reads results straight from Supabase. Nothing here holds state in memory,
so the instance may sleep and restart at any time.
"""
from __future__ import annotations

import logging
import time

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sherlock_core import config
from sherlock_core.models import ModuleInfo
from sherlock_core.modules import all_modules
from sherlock_core.platforms import all_platforms
from starlette.exceptions import HTTPException as StarletteHTTPException

from gateway.logs import setup_logging
from gateway.routers import cases, correlations
from gateway.schemas import Health, PlatformOut

log = logging.getLogger("sherlock.gateway")
access = logging.getLogger("sherlock.gateway.access")

LOCAL_ORIGINS = ["http://localhost:3000", "http://127.0.0.1:3000"]


def create_app() -> FastAPI:
    app = FastAPI(
        title="Sherlock gateway",
        version="2.0.0",
        description="Commands for the Sherlock OSINT app: cases, scans, review, report, agent.",
    )

    @app.middleware("http")
    async def log_requests(request: Request, call_next):
        start = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
        except Exception:
            # Answer here (inside the CORS layer) so the browser can read the error.
            log.exception("unhandled error", extra={"method": request.method, "path": request.url.path})
            response = JSONResponse({"detail": "Internal server error"}, status_code=500)
        principal = getattr(request.state, "principal", None)
        access.info("request", extra={
            "method": request.method, "path": request.url.path, "status": status,
            "ms": round((time.perf_counter() - start) * 1000, 1),
            "principal": getattr(principal, "user_id", None),
            "anonymous": getattr(principal, "is_anonymous", None),
        })
        return response

    # Added last so it is the outermost layer and also covers error responses.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(dict.fromkeys(LOCAL_ORIGINS + config.FRONTEND_ORIGINS)),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return JSONResponse({"detail": detail}, status_code=exc.status_code, headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        parts = []
        for err in exc.errors():
            where = ".".join(str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path"))
            parts.append(f"{where}: {err.get('msg')}" if where else str(err.get("msg")))
        return JSONResponse({"detail": "; ".join(parts) or "invalid request"}, status_code=422)

    @app.exception_handler(Exception)
    async def unhandled_error(request: Request, exc: Exception):
        # Normally the middleware above answers first; this is the documented fallback.
        log.error("unhandled error", exc_info=exc, extra={"method": request.method, "path": request.url.path})
        return JSONResponse({"detail": "Internal server error"}, status_code=500)

    @app.get("/health", response_model=Health, tags=["meta"])
    def health():
        return {"ok": True, "service": "sherlock-gateway"}

    @app.get("/modules", response_model=list[ModuleInfo], tags=["meta"])
    def modules():
        return [m.info() for m in all_modules()]

    @app.get("/platforms", response_model=list[PlatformOut], tags=["meta"])
    def platforms(response: Response):
        """Display metadata (label, domain, category) per platform, for icons. Public and static."""
        response.headers["Cache-Control"] = "public, max-age=86400"
        return all_platforms()

    app.include_router(cases.router)
    app.include_router(correlations.router)
    return app


setup_logging()
app = create_app()
