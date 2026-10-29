"""Smoke and validation tests for the isolated Lindsy FastAPI micro-app."""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health_endpoint_returns_ok() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok", "service": "lindsy-fastapi"}


def test_booking_page_renders_form() -> None:
    response = client.get("/lindsy/booking")
    assert response.status_code == 200
    assert "text/html" in response.headers["content-type"]
    assert "Reservas con Lindsy" in response.text
    assert 'id="booking-form"' in response.text


def test_booking_preview_accepts_valid_payload_without_claiming_to_save() -> None:
    payload = {
        "name": "Persona de prueba",
        "contact": "test@example.invalid",
        "service": "Consulta de prueba",
        "preferred_date": "15/11 por la tarde",
        "notes": "Prueba automatizada",
    }
    response = client.post("/lindsy/booking", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["ok"] is True
    assert data["mode"] == "preview_only"
    assert "no se guardó ni se envió" in data["message"]
    assert data["booking"] == payload


def test_booking_rejects_missing_required_fields() -> None:
    response = client.post("/lindsy/booking", json={"name": "Persona de prueba"})
    assert response.status_code == 422


def test_booking_rejects_overlong_name() -> None:
    payload = {
        "name": "N" * 101,
        "contact": "test@example.invalid",
        "service": "Consulta de prueba",
        "preferred_date": "15/11",
    }
    response = client.post("/lindsy/booking", json=payload)
    assert response.status_code == 422


def test_booking_rejects_overlong_notes() -> None:
    payload = {
        "name": "Persona de prueba",
        "contact": "test@example.invalid",
        "service": "Consulta de prueba",
        "preferred_date": "15/11",
        "notes": "x" * 1001,
    }
    response = client.post("/lindsy/booking", json=payload)
    assert response.status_code == 422
