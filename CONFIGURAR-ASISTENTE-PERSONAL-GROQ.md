# Asistente personal con Groq: revisión segura

Esta rama contiene una implementación aislada para preparar un servicio personal separado. **No desplegar sobre `main` ni modificar el servicio comercial existente.**

## Qué hace esta prueba

- Si se configura `PERSONAL_WHATSAPP_PHONE_NUMBER_ID`, los mensajes que llegan a esa línea se procesan con Groq y las respuestas salen desde ese mismo ID de teléfono.
- El flujo comercial de Claude sigue vinculado a `WHATSAPP_PHONE_NUMBER_ID` y conserva sus rutas, avisos y registro.
- `PERSONAL_WHATSAPP_NUMBER` queda solo como compatibilidad con la prueba anterior: enruta por el remitente, pero las respuestas salen desde la línea API comercial.
- La memoria de Lindsy es temporal y se pierde si el proceso se reinicia.
- En modo compartido, Groq sigue siendo opcional para mantener compatibilidad con el servidor comercial.
- Para un servicio totalmente separado, `PERSONAL_ASSISTANT_ONLY=true` hace que el servidor requiera únicamente las credenciales necesarias para WhatsApp, firma del webhook y Groq; no exige `ANTHROPIC_API_KEY` ni `WHATSAPP_PHONE_NUMBER_ID` comercial.
- En modo solo personal, el servidor exige `PERSONAL_WHATSAPP_PHONE_NUMBER_ID` y descarta mensajes que no lleguen con ese ID. Las respuestas se envían desde ese mismo ID.

## Importante sobre los números

La implementación ya contempla dos rutas aisladas por ID de teléfono: `WHATSAPP_PHONE_NUMBER_ID` para NexoAI comercial y `PERSONAL_WHATSAPP_PHONE_NUMBER_ID` para la línea personal, siempre que Meta haya habilitado correctamente la coexistencia y ambos IDs sean accesibles con el token configurado. La configuración de código por sí sola **no activa la coexistencia ni registra el número**. No cargar el ID personal ni desplegar hasta confirmar que Meta completó el alta compatible y que el webhook entrega eventos de esa línea.

## Variables del servicio personal separado

Configurar en el nuevo servicio de Render, nunca en `nexoai-whatsapp`:

- `PERSONAL_ASSISTANT_ONLY=true`
- `WHATSAPP_TOKEN`: token de Meta autorizado para la línea personal después del alta oficial.
- `WHATSAPP_VERIFY_TOKEN`: secreto elegido para verificar el webhook.
- `META_APP_SECRET`: secreto de la aplicación Meta para validar firmas.
- `GROQ_API_KEY`: clave privada de Groq.
- `PERSONAL_WHATSAPP_PHONE_NUMBER_ID`: ID confirmado de la línea personal.
- `GROQ_MODEL`: opcional; por defecto `openai/gpt-oss-20b`.

No crear ni desplegar el servicio hasta disponer del ID correcto y de credenciales válidas; no pegar secretos en GitHub ni en el chat.

## Variables opcionales

- `GROQ_API_KEY`: clave de Groq; guardarla solo en las variables privadas de Render, nunca en GitHub ni en el chat.
- `PERSONAL_WHATSAPP_PHONE_NUMBER_ID`: ID de teléfono de Meta para la línea personal habilitada con coexistencia; enruta mensajes entrantes y envíos de respuesta por esa línea.
- `PERSONAL_WHATSAPP_NUMBER`: compatibilidad antigua para probar Groq cuando el remitente coincide; no consigue que las respuestas salgan desde el número personal.
- `GROQ_MODEL`: opcional; por defecto `openai/gpt-oss-20b`.

No modificar ni borrar las variables existentes de Meta, WhatsApp, Anthropic, `OWNER_WHATSAPP_NUMBER`, la pausa humana o el registro en planilla.

## Antes de cualquier despliegue

1. Ejecutar pruebas unitarias y de integración aisladas; deben aprobar antes de crear el servicio.
2. Crear un servicio nuevo en Render apuntando exclusivamente a `asistente-personal-groq-base-segura`, con despliegue automático desactivado hasta validar configuración.
3. Confirmar en Meta que la coexistencia fue habilitada para el número personal, identificar su `phone_number_id` y comprobar que el token puede enviar desde esa línea.
4. Confirmar los límites vigentes de Groq y ejecutar una prueba controlada.
5. Verificar que un mensaje de cliente no autorizado sigue por Claude y conserva el comportamiento comercial.
6. No cambiar la rama de producción `main`, el servicio `nexoai-whatsapp` ni la configuración de Meta sin aprobación explícita.
