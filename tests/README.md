# Pruebas aisladas del asistente personal Groq

## Alcance y seguridad

Esta rama contiene dos niveles de prueba:
- Pruebas unitarias de funciones puras en `src/logic/nexoai-core.js`.
- Simulación de flujo en `src/testing/message-flow-harness.js`, con clientes falsos y envíos registrados en memoria.
- Pruebas de integración del servidor real en `tests/server-real.integration.test.js`, que inician `server.js` en un proceso local separado.

Las pruebas del servidor usan números, mensajes, secretos y claves ficticios. El archivo `tests/fixtures/block-external-fetch.mjs` intercepta las llamadas `fetch` salientes de Groq, Claude y Graph API y devuelve respuestas simuladas. Cualquier destino externo no reconocido queda bloqueado. La URL de planilla opcional se elimina del entorno de prueba.

**No se conecta a Meta, no envía mensajes reales, no usa credenciales reales y no modifica Render ni la rama `main`.** Estas pruebas validan el código del servidor bajo un entorno de dependencias simuladas; no demuestran que las credenciales o la configuración de producción estén correctas.

## Requisitos

- Node.js 20 o superior.
- Dependencias del proyecto instaladas con `npm install`.
- Ejecutar desde la raíz del repositorio en la rama `asistente-personal-groq-base-segura`.

## Ejecutar todas las pruebas

```bash
npm test
```

También se puede ejecutar directamente:

```bash
node --test tests/*.test.js
```

Archivos de prueba:
- `tests/routing.test.js`
- `tests/history.test.js`
- `tests/eco-pausa.test.js`
- `tests/groq-error.test.js`
- `tests/integration-simulation.test.js`
- `tests/server-real.integration.test.js`

## Qué cubren las pruebas del servidor real aislado

1. Inicio del servidor y ruta raíz.
2. Verificación GET del webhook con token correcto e incorrecto.
3. Rechazo de firma POST inválida sin llamadas externas.
4. Remitente personal dirigido a Groq y no a Claude.
5. Remitente comercial dirigido a Claude y no a Groq.
6. Detección de mensajes duplicados.
7. Error simulado de Groq sin derivación a Claude.
8. Envíos salientes interceptados y registrados localmente.

## Límites y próximos pasos

- El proceso de prueba inicia el `server.js` real, pero las respuestas de proveedores y WhatsApp son simuladas.
- La prueba de firma utiliza un secreto ficticio; no valida el secreto real de Meta.
- No se prueban llamadas reales a proveedores, entrega de mensajes ni la configuración del servicio Render.
- Revisar los resultados de `npm test` y cualquier fallo antes de considerar otra integración.
- No desplegar, cambiar Meta ni tocar `main` sin una autorización explícita separada.
