"""FastAPI app: cases, correlations, audit.

CORS: localhost by default. Set FRONTEND_ORIGINS to a comma-separated list
of extra origins (e.g. your deployed Vercel/Netlify URL) to widen the
allow-list in production.
"""
import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from gateway.routers import audit, cases, correlations

app = FastAPI(
    title="Sherlock OSINT",
    version="0.1.0",
    description="OSINT investigation pipeline — collectors -> correlation -> review -> report.",
)

# CORS: localhost + any extra origins from FRONTEND_ORIGINS env var.
# Single-user, no auth. Methods/headers left wide open on purpose.
ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
_extra = os.getenv("FRONTEND_ORIGINS", "").strip()
if _extra:
    ALLOWED_ORIGINS.extend(o.strip() for o in _extra.split(",") if o.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(cases.router)
app.include_router(correlations.router)
app.include_router(audit.router)


@app.get("/health")
def health():
    return {"ok": True, "service": "sherlock-osint"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("gateway.main:app", host="127.0.0.1", port=8000, reload=False)
