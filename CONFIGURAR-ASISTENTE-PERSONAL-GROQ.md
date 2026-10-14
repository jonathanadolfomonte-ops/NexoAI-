# Preparar el asistente personal por WhatsApp con Groq

Esta rama está aislada de `main`. Render sigue desplegando `main`; estos cambios no se publican en producción automáticamente porque Render está configurado para la rama `main`.

## Objetivo

- Los mensajes del número indicado en `PERSONAL_WHATSAPP_NUMBER` se envían al asistente personal con Groq.
- Los mensajes de otros números siguen el flujo comercial actual de Claude, incluyendo pedidos y derivaciones.
- Si Groq no está configurado o falla, el mensaje personal recibe un aviso; nunca se deriva silenciosamente a Claude.
- La memoria personal es temporal y se pierde cuando el servicio se reinicia.

## Variables nuevas para Render (solo cuando se apruebe probar)

- `GROQ_API_KEY`: clave secreta de Groq, guardada únicamente en variables de entorno de Render.
- `PERSONAL_WHATSAPP_NUMBER`: tu número personal en formato internacional solo con dígitos, por ejemplo `549XXXXXXXXXX` (reemplazá las X por tu número real; no lo publiques en GitHub).
- `GROQ_MODEL`: opcional; por defecto `openai/gpt-oss-20b`.

No se deben borrar ni cambiar las variables existentes de Meta, WhatsApp, Anthropic ni `OWNER_WHATSAPP_NUMBER`, que se usa para avisos comerciales.

## Antes de desplegar

1. Crear la cuenta y una API key en Groq; revisar los límites gratuitos vigentes.
2. Agregar las dos variables nuevas a Render solo después de decidir hacer una prueba.
3. Revisar esta rama y probarla antes de desplegar.
4. Mantener `main` como rama de producción hasta que el propietario autorice explícitamente otra cosa.
5. Probar primero desde el número personal y comprobar después que un mensaje de cliente siga usando Claude.

Nunca copiar la clave API en GitHub, capturas públicas o mensajes.
