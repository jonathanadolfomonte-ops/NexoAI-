# Pruebas aisladas del asistente personal Groq

## Alcance y seguridad

Estos tests verifican funciones puras de `src/logic/nexoai-core.js`. No levantan Express, no contactan Meta, WhatsApp, Claude ni Groq, y no modifican Render ni la rama `main`.

El módulo `src/logic/nexoai-core.js` declara expresamente que todavía no está conectado a `server.js`. Por lo tanto, que estos tests pasen no demuestra que el bot real esté integrado ni que el comportamiento en producción haya cambiado.

## Requisitos

- Node.js 20 o superior.
- Ejecutar los comandos desde la raíz del repositorio y dentro de esta rama de pruebas.

## Ejecutar los tests

```bash
node --test tests/*.test.js
```

El resultado esperado actualmente es que Node.js ejecute los cuatro archivos de prueba:
- `tests/routing.test.js`
- `tests/history.test.js`
- `tests/eco-pausa.test.js`
- `tests/groq-error.test.js`

No se debe afirmar que el resultado es correcto hasta ejecutar el comando y revisar el resumen final de Node.js.

## Próximo control antes de integrar

1. Ejecutar los tests en un entorno aislado.
2. Revisar cobertura de casos límite y posibles defectos.
3. Comparar la lógica de pruebas con el flujo real de `server.js`.
4. Diseñar y revisar una integración separada, sin desplegar.
5. Solicitar aprobación explícita antes de cualquier cambio en Render, Meta o producción.
