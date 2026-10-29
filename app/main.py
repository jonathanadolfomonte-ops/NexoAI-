"""FastAPI entry point for the isolated Lindsy micro-app."""

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pathlib import Path

from app.micro_apps.routes_lindsy import router as lindsy_router

app = FastAPI(
    title="NexoAI · Lindsy",
    description="Módulo web experimental de Lindsy, aislado del webhook comercial.",
    version="0.1.0",
)

app.include_router(lindsy_router)


@app.get("/health", tags=["health"])
async def health_check() -> dict[str, str]:
    """Lightweight health check for an isolated test deployment."""
    return {"status": "ok", "service": "lindsy-fastapi"}
