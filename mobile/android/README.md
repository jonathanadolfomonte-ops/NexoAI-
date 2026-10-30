# Lindsy ProMax para Android

Primera base nativa de Android, independiente del servidor comercial de NexoAI.

## Estado actual

- Proyecto Android nativo con Kotlin y Gradle.
- Compatible desde Android 6.0 (API 23); objetivo de compilación Android 15 (API 35).
- Pantalla inicial adaptable al tamaño disponible.
- Botón de prueba que utiliza el motor de texto a voz instalado en el dispositivo.
- Saludo en español de Argentina cuando el motor ofrece esa variante; usa español genérico como alternativa.
- Cierre explícito del motor de voz al salir de la pantalla.
- Compilación automática del APK de prueba mediante GitHub Actions.

## Límites deliberados de esta primera versión

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

El APK de depuración se genera en:

`app/build/outputs/apk/debug/app-debug.apk`

En GitHub, el workflow **Lindsy Android build** compila esta app y publica el APK como artefacto cuando termina correctamente.

## Próxima etapa

Probar instalación y voz en el Motorola y en la tablet. Después de validar esta base, agregar reconocimiento de voz con permiso contextual y una sesión visible iniciada por el usuario.
