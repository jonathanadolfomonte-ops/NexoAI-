# Bitácora técnica y evidencias — Lindsy Personal / NexoAI

Última actualización: 2026-10-28  
Rama de referencia: `asistente-personal-groq-base-segura`  
Servicio aislado de Render: `nexoai-personal` — https://nexoai-personal.onrender.com

## Propósito y reglas de seguridad

Este documento conserva decisiones, pruebas, resultados y pendientes para reutilizar el proceso al convertir Lindsy Personal en una aplicación comercializable.

- Mantener el trabajo personal aislado de `main` y del servicio comercial `nexoai-whatsapp`.
- No desplegar código incompleto ni cambiar Meta/WhatsApp sin autorización explícita.
- No guardar tokens, claves, secretos, números privados completos ni payloads reales de clientes en el repositorio.
- Usar números, tokens y secretos ficticios en las pruebas automatizadas.
- No crear bases de datos o recursos pagos sin revisar primero el costo exacto y obtener aprobación explícita.
- Un test automatizado exitoso no equivale a una prueba completa de WhatsApp en producción.

## Historial de cambios y validaciones

### 2026-10-21 — Prueba aislada inicial de servidor

Registro previo de GitHub Actions: 30/30 pruebas aprobadas con Node.js 22 (duración aproximada de 3,6 segundos). La prueba aislada cubría el GET de verificación del webhook, rechazo de firma inválida, enrutamiento entre Groq/Claude, manejo de errores de Groq, duplicados y bloqueo/intercepción de llamadas externas. No se modificaron `server.js`, `main`, Render, Meta ni se enviaron mensajes reales en esa operación.

Auditoría de ese momento: la rama tenía commits propios y estaba detrás de `main`; se registró riesgo de divergencia y posible ausencia de cambios comerciales recientes. Por ese motivo no se recomendó fusionar ni desplegar sobre producción.

### 2026-10-28 — Corrección de respuesta duplicada en primer contacto

- Evidencia compartida: GitHub Actions run #21 inicialmente mostraba 34/38 pruebas aprobadas y 4 fallos en `tests/server-real.integration.test.js`.
- Fallos observados: respuesta saliente duplicada en primer contacto, mensaje de saludo fijo en un caso que esperaba respuesta simulada de Groq y expectativa de texto de error no coincidente.
- Cambio registrado en `server.js`:
  - Commit: `33d59f66195c7c8461f4ef3a39dd5f2ad6810cc4`
  - Mensaje: `Fix personal assistant first-contact double reply`
  - Resumen: el saludo fijo inicial solo se activa si el mensaje entrante es un saludo breve, en lugar de interceptar cualquier primer mensaje.
- Resultado reportado posteriormente: GitHub Actions ejecución #21 marcada como exitosa.
- Enlace del run: https://github.com/jonathanadolfomonte-ops/NexoAI-/actions/runs/40635509883
- Nota de rigor: el estado se transcribe del historial de revisión; verificar el run en GitHub si se necesita una auditoría nueva. Un estado combinado de commit vacío no demuestra por sí mismo que no haya workflow ni que la ejecución haya fallado.

## Pruebas y archivos identificados en la rama

El comando de pruebas definido en `package.json` es:

```sh
npm test
# ejecuta: node --test tests/*.test.js
```

Node requerido: `>=20`.

Archivos revisados en la rama:

- `tests/server-real.integration.test.js`: inicia un servidor local real en un puerto libre, usa entorno y credenciales ficticios, genera firmas HMAC simuladas, simula webhooks y registra las salidas para comprobarlas. Bloquea llamadas externas mediante `tests/fixtures/block-external-fetch.mjs`; elimina los temporales al terminar.
- `tests/routing.test.js`: normalización de teléfonos, selección de flujo personal/comercial y no interceptación si no se configura número personal.
- `tests/history.test.js`: separación de historiales, límite de turnos, orden de operaciones por conversación y recuperación tras fallo.
- `tests/eco-pausa.test.js`: detección de eco, mensajes no coincidentes y vencimiento de pausa.
- `tests/groq-error.test.js`: extracción segura de texto de respuestas simuladas de Groq y rechazo de formatos incompletos/no textuales.

La lista anterior describe los archivos inspeccionados; no representa un conteo actualizado de pruebas ni una nueva ejecución local.

## Configuración documentada

La guía `CONFIGURAR-ASISTENTE-PERSONAL-GROQ.md` indica que el servicio aislado debe usar:

- `PERSONAL_ASSISTANT_ONLY=true`
- `WHATSAPP_TOKEN`
- `WHATSAPP_VERIFY_TOKEN`
- `META_APP_SECRET`
- `GROQ_API_KEY`
- `PERSONAL_WHATSAPP_PHONE_NUMBER_ID`
- `GROQ_MODEL` opcional; valor predeterminado `openai/gpt-oss-20b`

Los valores secretos deben cargarse solo en la configuración privada del servicio. El código por sí solo no habilita la coexistencia de WhatsApp ni registra un número en Meta. Hay que confirmar el alta oficial, el ID correcto y los permisos del token antes de enviar mensajes desde esa línea.

## Hallazgos operativos de Render (2026-10-28)

En los logs revisados del servicio `nexoai-personal` se observaron eventos `Webhook POST recibido`, `Mensajes recibidos` y registros `Mensaje enviado a …` dirigidos al número terminado en 084.

También se observó un error HTTP 429 de Groq por límite temporal de tokens por minuto. Esto puede causar una respuesta de respaldo o impedir generar la respuesta prevista. Un log de envío es evidencia de que el código registró un intento, no confirmación de entrega/lectura en el teléfono.

No almacenar aquí IDs internos de organizaciones, request IDs, claves ni contenido privado de mensajes.

## Pendientes y criterios para cerrar

1. Volver a verificar el estado actual de la rama, el commit desplegado y el resultado del workflow en GitHub.
2. Revisar el manejo de 429 de Groq: espera/reintento limitado cuando sea seguro, mensaje de respaldo claro y protección contra respuestas duplicadas.
3. Integrar memoria persistente y probar que sobrevive a reinicios. Evaluar opciones y costo antes de crear recursos pagos; obtener autorización explícita antes de crearlos.
4. Implementar transcripción real de audio y probar audio válido, vacío, no compatible y fallos de transcripción.
5. Validar variables requeridas al arrancar y documentar errores de configuración sin revelar secretos.
6. Ejecutar pruebas de extremo a extremo controladas en el servicio aislado, comprobando entrada, respuesta, número/ID de origen y recepción real.
7. Confirmar con Meta si la línea personal terminada en 789 puede usarse mediante la modalidad oficial habilitada. No inferir que está activa solo porque el servidor funciona.
8. Verificar que los cambios no afecten el flujo comercial ni el servicio `nexoai-whatsapp`.
9. Crear una guía reproducible para instalación, pruebas, despliegue, reversión y soporte antes de comercializar la app.

## Plantilla para registrar cada nueva prueba

Para cada ejecución nueva, agregar una entrada con:

- Fecha/hora y zona horaria:
- Rama y commit exacto:
- Entorno (local/CI/Render aislado):
- Comando o workflow:
- Objetivo:
- Datos usados (confirmar que son ficticios y no contienen secretos):
- Resultado: aprobado/fallido/no ejecutado:
- Número de pruebas aprobadas/fallidas:
- Enlace a ejecución/log sanitizado:
- Hallazgo:
- Cambio realizado (si corresponde):
- Riesgos o pendientes:
- Próximo paso y autorización requerida:

## Criterio para reutilización comercial

Conservar esta bitácora junto al código de pruebas. Antes de ofrecer el producto a clientes, repetir las pruebas desde un commit identificado, archivar los resultados, comprobar privacidad y aislamiento por usuario, verificar el coste de infraestructura/modelo y documentar recuperación, límites y soporte. No afirmar que la aplicación está lista para producción hasta cerrar las pruebas pendientes.
