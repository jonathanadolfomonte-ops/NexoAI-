# Clientes móviles de Lindsy ProMax

Esta carpeta queda reservada para los clientes móviles. En esta etapa solo contiene el plan; todavía no existe un APK ni un proyecto Android compilable.

## Estrategia

- Android: Kotlin nativo, comenzando con una pantalla de prueba y una sesión de voz iniciada por el usuario.
- iOS: SwiftUI en una etapa posterior, usando APIs públicas de Apple y Atajos/Siri cuando corresponda.
- Backend: contrato HTTP compartido descrito en `docs/LINDSY-PROMAX-ARQUITECTURA-MULTIPLATAFORMA.md`.

## Compatibilidad

No se asumirá que todos los Samsung, Motorola o iPhone tienen las mismas funciones. La app consultará capacidades y permisos en tiempo de ejecución. La marca del dispositivo no será el criterio principal: importan la versión del sistema, APIs, hardware, configuración y políticas del fabricante.

## Primer entregable Android

1. Proyecto Gradle/Kotlin mínimo.
2. Pantalla con botón Iniciar/Detener.
3. Permiso de micrófono solicitado en contexto.
4. Captura solo durante una sesión visible iniciada por el usuario.
5. Integración con API de prueba.
6. Respuesta mediante Android TextToSpeech.
7. Pruebas y APK generado por CI.

No se habilitarán servicios persistentes, accesibilidad, SMS, llamadas ni automatización de otras apps hasta tener una prueba básica aprobada.
