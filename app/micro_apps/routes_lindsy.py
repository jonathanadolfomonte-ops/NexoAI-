"""Routes for the experimental Lindsy booking interface.

This module is intentionally independent from the production WhatsApp webhook.
Bookings are validated but are not persisted or sent to external services.
"""

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field

router = APIRouter(prefix="/lindsy", tags=["lindsy"])
TEMPLATE_DIR = Path(__file__).resolve().parent / "templates"
templates = Jinja2Templates(directory=str(TEMPLATE_DIR))


class BookingRequest(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    contact: str = Field(min_length=3, max_length=100)
    service: str = Field(min_length=1, max_length=120)
    preferred_date: str = Field(min_length=1, max_length=40)
    notes: str = Field(default="", max_length=1000)


@router.get("/booking", response_class=HTMLResponse, name="lindsy_booking")
async def booking_page(request: Request) -> HTMLResponse:
    """Render the booking form."""
    return templates.TemplateResponse(
        request=request,
        name="lindsy/booking.html",
        context={"title": "Reservas · Lindsy"},
    )


@router.post("/booking", name="create_booking_preview")
async def create_booking_preview(payload: BookingRequest) -> dict[str, object]:
    """Validate a booking request without saving or transmitting personal data."""
    return {
        "ok": True,
        "mode": "preview_only",
        "message": "Solicitud validada. Todavía no se guardó ni se envió.",
        "booking": payload.model_dump(),
    }
