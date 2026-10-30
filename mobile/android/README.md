# Lindsy ProMax para Android

Primera base nativa de Android, independiente del servidor comercial de NexoAI.

## Estado actual

- Proyecto Android nativo con Kotlin y Gradle.
- Compatible desde Android 6.0 (API 23); objetivo de compilación Android 15 (API 35).
- Pantalla inicial adaptable al tamaño disponible.
- Botón de prueba que utiliza el motor de texto a voz instalado en el dispositivo.
- Saludo en español de Argentina cuando el motor ofrece esa variante; usa español genérico como alternativa.
- Cierre explícito del motor de voz al salir de la pantalla.
- CI compila el APK Debug y puede compilar un APK Release firmado cuando se configuran los secretos privados descritos en [SECURITY-AND-SIGNING.md](SECURITY-AND-SIGNING.md).

## Límites deliberados

- Todavía no solicita permiso de micrófono ni escucha audio.
- No se conecta a Render ni a proveedores de IA.
- No ejecuta llamadas, mensajes, accesibilidad ni acciones sensibles.
- No inicia servicios en segundo plano.
- No modifica el webhook comercial ni requiere credenciales.

## Compilar

Desde esta carpeta, con Java 17, Android SDK y Gradle 8.7:

```bash
gradle :app:assembleDebug
```

Para distribución, consultar [SECURITY-AND-SIGNING.md](SECURITY-AND-SIGNING.md). Un APK Debug no debe confundirse con un paquete Release firmado.

## Próxima etapa

Completar la custodia de la clave de firma, producir y verificar el APK Release, y probar instalación y voz en el Motorola y en la tablet. Después de validar esta base, agregar reconocimiento de voz con permiso contextual y una sesión visible iniciada por el usuario.
