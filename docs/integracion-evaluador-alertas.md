# Integración del evaluador con el puente de alertas 789

## Estado

Cliente Python independiente agregado a esta rama experimental. No está conectado todavía al evaluador que vive en Termux y no se ha desplegado. No se transmiten audios ni transcripciones.

## Archivos

- `cliente_puente_alertas.py`: cliente HTTP con HTTPS obligatorio, token Bearer, validación de categoría e identificador, reintentos limitados y confirmación explícita.
- `tests/test_cliente_puente_alertas.py`: pruebas con HTTP simulado; no hace llamadas reales.

## Contrato desde el evaluador

Después de llamar a `evaluar_emergencia(transcripcion)`, invocar:

```python
from cliente_puente_alertas import notificar_si_emergencia

resultado = evaluar_emergencia(transcripcion)
aviso = notificar_si_emergencia(
    resultado,
    event_id=id_unico_del_grupo_de_audios,
    categoria="otra_urgencia_grave",
    detalle=resultado.get("motivo", ""),
)
```

La función solo continúa si `resultado["estado"] == "emergencia"`. No manda transcripción ni archivo de audio. Para emergencias médicas, físicas o violencia, el llamador debe mapear la clasificación validada a la categoría específica; si no puede determinarla, usar `otra_urgencia_grave`.

## Configuración futura

```bash
export LINDSY_ALERT_BRIDGE_URL="https://URL-EXPERIMENTAL"
export LINDSY_ALERT_BRIDGE_TOKEN="TOKEN-LARGO-INDEPENDIENTE"
export LINDSY_ALERT_BRIDGE_ENABLED="false"
```

Mantener ENABLED en false durante pruebas. La URL no estará operativa hasta desplegar la rama experimental. No reutilizar credenciales de producción.

El servidor puente usa 789 como emisor Cloud API y 084 como destinatario de la alerta. El identificador del emisor y el token Meta deben verificarse antes de cualquier envío real.

## Limitaciones importantes

- El identificador de evento debe ser estable para el mismo grupo de audios; generar uno nuevo por reintento anularía la deduplicación.
- El cliente confirma solo cuando el servidor devuelve `ok: true`.
- La deduplicación del servidor está en memoria, no persistente; antes de producción hay que reemplazarla por almacenamiento durable.
- El envío real requiere habilitarlo explícitamente en el servidor y también en el cliente; ambas barreras deben seguir apagadas hasta una autorización separada.
