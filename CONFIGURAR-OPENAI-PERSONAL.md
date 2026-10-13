# Activar la asistencia personal de OpenAI en NexoAI

Esta función está preparada en la rama `nexoai-openai-personal`. **No se activa en producción hasta revisar, aprobar y desplegar los cambios.**

## Variables de entorno para Render

Agregar en el servicio `nexoai-whatsapp`:

- `OPENAI_API_KEY`: clave secreta de la API de OpenAI. Crear/consultar desde el panel oficial de OpenAI y guardarla únicamente como variable secreta en Render. Nunca ponerla en GitHub, en este archivo ni en mensajes de chat.
- `OWNER_WHATSAPP_NUMBER`: número personal que debe usar OpenAI, en formato internacional solo con dígitos (por ejemplo, `549XXXXXXXXXX`, reemplazando las X por el número real).
- `OPENAI_MODEL`: opcional; por defecto `gpt-4.1-mini`.

Las variables existentes de WhatsApp, Meta y Anthropic deben permanecer configuradas. El código mantiene Anthropic para todos los demás remitentes. Si el número personal está configurado pero falta `OPENAI_API_KEY`, se devuelve un aviso de configuración y no se deriva ese mensaje a Claude.

## Pasos antes de activarlo

1. Resolver la facturación de la API de OpenAI y confirmar que la cuenta tenga crédito disponible. La facturación de API es independiente de ChatGPT Plus.
2. Revisar los cambios de esta rama y probar el código.
3. Agregar las variables anteriores a Render, con la clave como secreto.
4. Desplegar solo después de una aprobación explícita del propietario.
5. Probar desde el número personal y verificar que un mensaje de un cliente común siga usando el flujo de Claude.

## Alcance y límites

- La memoria de WhatsApp es temporal y se pierde al reiniciar el servicio.
- Esta integración no comparte automáticamente el historial ni los recuerdos de una conversación de ChatGPT.
- No se ha cambiado la rama `main` ni el servicio de Render como parte de esta preparación.
