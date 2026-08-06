"""FastAPI app: cases, correlations, audit. CORS limited to localhost for the Next.js frontend."""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routers import audit, cases, correlations

app = FastAPI(
    title="Sherlock OSINT",
    version="0.1.0",
    description="OSINT investigation pipeline — collectors -> correlation -> review -> report.",
)

# CORS: Next.js dev server on localhost. Single-user, no auth.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
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
    uvicorn.run("api.main:app", host="127.0.0.1", port=8000, reload=False)
