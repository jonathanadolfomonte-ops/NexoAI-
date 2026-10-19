# Asistente personal con Groq: revisión segura

Esta rama parte de la versión actual de `main` y conserva el flujo comercial existente. **No se debe desplegar ni cambiar Render sin autorización explícita.**

## Qué hace esta prueba

- Si un mensaje entrante a la línea de WhatsApp conectada a Meta proviene del número indicado en `PERSONAL_WHATSAPP_NUMBER`, el texto se procesa con Groq.
- Los mensajes de los demás números siguen por el flujo comercial actual de Claude, incluidos pausa humana, avisos, registro y rutas públicas.
- La memoria de Lindsy es temporal y se pierde si el proceso se reinicia.
- Groq es opcional durante la configuración; si falta la clave, el asistente personal informa que no está activado, sin pasar esa consulta a Claude.

## Importante sobre los números

Esta implementación **no convierte el número personal en un bot ni envía respuestas desde ese número**. El propietario tendría que escribir desde su WhatsApp personal al número que ya está conectado a la API de WhatsApp; las respuestas saldrían desde ese número conectado a la API. Si el objetivo es que Lindsy responda desde el mismo número personal, esta arquitectura no lo consigue y hay que estudiar otra opción antes de tocar Meta.

## Variables opcionales

- `GROQ_API_KEY`: clave de Groq; guardarla solo en las variables privadas de Render, nunca en GitHub ni en el chat.
- `PERSONAL_WHATSAPP_NUMBER`: número del propietario desde el que escribirá al número de API, en formato internacional y solo dígitos.
- `GROQ_MODEL`: opcional; por defecto `openai/gpt-oss-20b`.

No modificar ni borrar las variables existentes de Meta, WhatsApp, Anthropic, `OWNER_WHATSAPP_NUMBER`, la pausa humana o el registro en planilla.

## Antes de cualquier despliegue

1. Revisar el diseño y probar el código en un entorno separado.
2. Confirmar que el número de WhatsApp conectado a Meta es el que se pretende usar para recibir y enviar las respuestas.
3. Confirmar los límites vigentes de Groq y ejecutar una prueba controlada.
4. Verificar que un mensaje de cliente no autorizado sigue por Claude y conserva el comportamiento comercial.
5. No cambiar la rama de producción `main`, el servicio `nexoai-whatsapp` ni la configuración de Meta sin aprobación explícita.
