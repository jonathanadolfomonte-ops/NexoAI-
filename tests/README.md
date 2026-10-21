# Pruebas aisladas del asistente personal Groq

## Alcance y seguridad

Estas pruebas usan datos ficticios y proveedores simulados. No levantan Express, no llaman a Meta, WhatsApp, Claude ni Groq, no hacen solicitudes de red y no envían mensajes reales. Tampoco modifican Render, Meta ni la rama `main`.

Hay dos niveles de pruebas:
- Pruebas unitarias de funciones puras en `src/logic/nexoai-core.js`.
- Simulación de flujo en `src/testing/message-flow-harness.js`, con clientes Groq/Claude falsos y una función `send` que solo registra mensajes en memoria.

**Límite importante:** el arnés de integración es una simulación aislada y todavía no está conectado a `server.js`. Sirve para comprobar el comportamiento esperado del enrutamiento y los errores sin efectos externos, pero no demuestra que el servidor real esté integrado o funcione correctamente en producción. Integrar el arnés o refactorizar el servidor requiere revisión y aprobación separadas.

## Requisitos

- Node.js 20 o superior.
- Ejecutar los comandos desde la raíz del repositorio y dentro de esta rama de pruebas.

## Ejecutar todas las pruebas

```bash
node --test tests/*.test.js
```

Los archivos de prueba actuales son:
- `tests/routing.test.js`
- `tests/history.test.js`
- `tests/eco-pausa.test.js`
- `tests/groq-error.test.js`
- `tests/integration-simulation.test.js`

El test de simulación comprueba:
1. El número personal usa solo Groq.
2. Los demás números usan solo Claude.
3. Un error de Groq no deriva la consulta a Claude.
4. Un error de Claude no llama a Groq.
5. La ausencia de Groq produce un aviso seguro sin invocar Claude.
6. Un formato de número no equivalente no se interpreta como personal.
7. Una respuesta vacía se reemplaza por un mensaje alternativo.
8. El envío ficticio solo registra datos en memoria.

## Próximos controles antes de integrar

1. Ejecutar la batería completa en el entorno de la rama y revisar el resumen final.
2. Revisar cobertura de casos límite.
3. Diseñar pruebas del webhook real con dependencias inyectadas o servidor de pruebas, sin credenciales reales.
4. Revisar cualquier refactor de `server.js` por separado, sin desplegar.
5. Solicitar aprobación explícita antes de cambiar Render, Meta o producción.
