# Asistente personal con Groq: revisión segura

Esta rama parte de la versión actual de `main` y conserva el flujo comercial existente. **No se debe desplegar ni cambiar Render sin autorización explícita.**

## Qué hace esta prueba

- Si se configura `PERSONAL_WHATSAPP_PHONE_NUMBER_ID`, los mensajes que llegan a esa línea se procesan con Groq y las respuestas salen desde ese mismo ID de teléfono.
- El flujo comercial de Claude sigue vinculado a `WHATSAPP_PHONE_NUMBER_ID` y conserva sus rutas, avisos y registro.
- `PERSONAL_WHATSAPP_NUMBER` queda solo como compatibilidad con la prueba anterior: enruta por el remitente, pero las respuestas salen desde la línea API comercial.
- La memoria de Lindsy es temporal y se pierde si el proceso se reinicia.
- Groq es opcional durante la configuración; si falta la clave, el asistente personal informa que no está activado, sin pasar esa consulta a Claude.

## Importante sobre los números

La implementación ya contempla dos rutas aisladas por ID de teléfono: `WHATSAPP_PHONE_NUMBER_ID` para NexoAI comercial y `PERSONAL_WHATSAPP_PHONE_NUMBER_ID` para la línea personal, siempre que Meta haya habilitado correctamente la coexistencia y ambos IDs sean accesibles con el token configurado. La configuración de código por sí sola **no activa la coexistencia ni registra el número**. No cargar el ID personal ni desplegar hasta confirmar que Meta completó el alta compatible y que el webhook entrega eventos de esa línea.

## Variables opcionales

- `GROQ_API_KEY`: clave de Groq; guardarla solo en las variables privadas de Render, nunca en GitHub ni en el chat.
- `PERSONAL_WHATSAPP_PHONE_NUMBER_ID`: ID de teléfono de Meta para la línea personal habilitada con coexistencia; enruta mensajes entrantes y envíos de respuesta por esa línea.
- `PERSONAL_WHATSAPP_NUMBER`: compatibilidad antigua para probar Groq cuando el remitente coincide; no consigue que las respuestas salgan desde el número personal.
- `GROQ_MODEL`: opcional; por defecto `openai/gpt-oss-20b`.

No modificar ni borrar las variables existentes de Meta, WhatsApp, Anthropic, `OWNER_WHATSAPP_NUMBER`, la pausa humana o el registro en planilla.

## Antes de cualquier despliegue

1. Revisar el diseño y probar el código en un entorno separado.
2. Confirmar en Meta que la coexistencia fue habilitada para el número personal, identificar su `phone_number_id` y comprobar que el token puede enviar desde esa línea.
3. Confirmar los límites vigentes de Groq y ejecutar una prueba controlada.
4. Verificar que un mensaje de cliente no autorizado sigue por Claude y conserva el comportamiento comercial.
5. No cambiar la rama de producción `main`, el servicio `nexoai-whatsapp` ni la configuración de Meta sin aprobación explícita.
