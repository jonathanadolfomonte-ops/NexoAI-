# Puente experimental de alertas 789

Este módulo es una prueba aislada. No está conectado a Express, al webhook ni a ningún servicio de producción.

## Contrato previsto

POST /api/alertas/emergencia
Authorization: Bearer <LINDSY_ALERT_BRIDGE_TOKEN>

JSON:
- event_id: identificador único de la alerta (16–128 caracteres alfanuméricos, guion o guion bajo).
- categoria: emergencia_medica | peligro_fisico | violencia | otra_urgencia_grave.
- detalle: resumen breve opcional (máximo 280 caracteres). No enviar la transcripción completa.

El destinatario no se acepta desde el cuerpo: se fija por configuración protegida del servidor.

## Variables que requeriría una futura integración

- LINDSY_ALERT_BRIDGE_TOKEN
- META_ACCESS_TOKEN
- META_PHONE_NUMBER_ID_789 (emisor: línea 789)
- ALERTA_DESTINATARIO_084 (destino: WhatsApp personal 084)
- ENABLE_REAL_ALERTS (debe permanecer false hasta la autorización explícita)

Los nombres son provisionales. 789 es el número emisor y 084 es el destinatario de la alerta. No se deben copiar secretos desde producción ni configurar valores hasta verificar con certeza que META_PHONE_NUMBER_ID_789 corresponde al número 789 y que el token tiene permiso para enviar desde ese número.

## Límites conocidos de esta primera prueba

- El modo predeterminado es simulación y no realiza llamadas externas.
- La deduplicación vive en memoria; no es suficiente para producción ni sobrevive reinicios. Antes de desplegar se deberá usar almacenamiento persistente.
- La ruta queda registrada únicamente en esta rama experimental: POST /api/alertas/emergencia. La rama no está desplegada.
- Los tests usan respuestas falsas de Meta; no envían WhatsApps reales.
- No se debe habilitar el envío real ni desplegar sin revisión y autorización separada.
