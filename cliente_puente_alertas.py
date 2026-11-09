"""Cliente seguro para el puente experimental de alertas 789.

No realiza conexiones externas salvo que habilitado=True y las variables
de entorno estén completas. Nunca envía transcripciones ni audio.
"""
import json
import os
import time
import urllib.error
import urllib.request

CATEGORIAS = {
    "emergencia_medica",
    "peligro_fisico",
    "violencia",
    "otra_urgencia_grave",
}


class ErrorPuenteAlerta(Exception):
    pass


def notificar_si_emergencia(
    resultado_evaluador,
    event_id,
    categoria="otra_urgencia_grave",
    detalle="",
    *,
    habilitado=None,
    urlopen=None,
    pausas=(0.4, 1.0),
):
    """Notifica únicamente resultados estado=emergencia.

    El flag habilitado y las credenciales son requisitos independientes.
    Devuelve un estado explícito; nunca interpreta un fallo como envío.
    """
    if not isinstance(resultado_evaluador, dict):
        raise TypeError("resultado_evaluador debe ser un diccionario")
    if resultado_evaluador.get("estado") != "emergencia":
        return {"estado": "omitida", "motivo": "no_es_emergencia"}

    if categoria not in CATEGORIAS:
        raise ValueError("Categoría de emergencia no permitida")
    if not isinstance(event_id, str) or not (16 <= len(event_id) <= 128):
        raise ValueError("event_id debe tener entre 16 y 128 caracteres")
    if any(not (c.isalnum() or c in "_-") for c in event_id):
        raise ValueError("event_id contiene caracteres no permitidos")

    if habilitado is None:
        habilitado = os.getenv("LINDSY_ALERT_BRIDGE_ENABLED", "false").lower() == "true"
    if not habilitado:
        return {"estado": "simulacion_local", "event_id": event_id}

    base = os.getenv("LINDSY_ALERT_BRIDGE_URL", "").rstrip("/")
    token = os.getenv("LINDSY_ALERT_BRIDGE_TOKEN", "")
    if not base.startswith("https://") or not token:
        raise ErrorPuenteAlerta("Falta URL HTTPS o token del puente")

    destino = base + "/api/alertas/emergencia"
    payload = {
        "event_id": event_id,
        "categoria": categoria,
        "detalle": str(detalle or "")[:280],
    }
    request = urllib.request.Request(
        destino,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={
            "Authorization": "Bearer " + token,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    abrir = urlopen or urllib.request.urlopen
    ultimo_error = None

    for intento, pausa in enumerate(pausas, start=1):
        if pausa:
            time.sleep(pausa)
        try:
            with abrir(request, timeout=12) as response:
                codigo = getattr(response, "status", 200)
                cuerpo = response.read().decode("utf-8")
            datos = json.loads(cuerpo or "{}")
            if codigo not in (200, 202) or not datos.get("ok"):
                raise ErrorPuenteAlerta("El puente no confirmó la alerta")
            if datos.get("en_proceso"):
                raise ErrorPuenteAlerta("La alerta sigue en proceso; todavía no está confirmada")
            es_simulacion = datos.get("modo") == "simulacion"
            es_confirmacion_real = datos.get("enviado") is True
            if not es_simulacion and not es_confirmacion_real:
                raise ErrorPuenteAlerta("Respuesta del puente sin confirmación verificable")
            return {
                "estado": "simulada" if es_simulacion else "confirmada",
                "event_id": event_id,
                "respuesta": datos,
            }
        except urllib.error.HTTPError as exc:
            # Un 4xx no se reintenta: requiere corregir autenticación o datos.
            if 400 <= exc.code < 500:
                raise ErrorPuenteAlerta("El puente rechazó la solicitud (HTTP %s)" % exc.code) from exc
            ultimo_error = exc
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            ultimo_error = exc
        except (ValueError, ErrorPuenteAlerta):
            raise

    raise ErrorPuenteAlerta("No se pudo confirmar la alerta tras los intentos") from ultimo_error
