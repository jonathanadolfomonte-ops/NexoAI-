# Lindsy ProMax — arquitectura multiplataforma

Estado: diseño inicial. No es una promesa de compatibilidad ni una aplicación móvil terminada.

## Objetivo

Construir una asistente personal de voz que comparta identidad, memoria, políticas y servicios de IA entre Android e iOS, adaptando las funciones al sistema operativo y al hardware.

## Plataformas

| Plataforma | Primera implementación | Capacidades iniciales | Límites a respetar |
|---|---|---|---|
| Android 11 (Moto G20) | App nativa Kotlin | Activación manual, captura de voz durante sesión visible, respuesta hablada | Restricciones de segundo plano, batería, permisos y APIs disponibles |
| Android moderno (Samsung Galaxy, Motorola Edge y otros) | La misma app Kotlin con detección de capacidades | Accesos rápidos, integración de asistente cuando sea compatible, servicios en primer plano permitidos | One UI y capas de fabricante pueden cambiar ahorro de batería y comportamiento |
| iOS (iPhone) | App nativa Swift/SwiftUI en etapa posterior | Sesión de voz iniciada por usuario, reproducción, Atajos/Siri donde las APIs lo permitan | iOS limita escucha permanente y automatización de otras apps; no prometer control equivalente a Android |

No se implementarán ramas de código por marca cuando una API estándar de Android resuelva el caso. Las particularidades de Samsung/Motorola se encapsularán en adaptadores opcionales y comprobables.

## Principios de diseño

1. **Un núcleo, clientes nativos:** backend y contratos compartidos; interfaz y captura de audio nativas por plataforma.
2. **Capacidades detectadas, no supuestas:** la app consulta versión de SO, permisos, disponibilidad de funciones y restricciones del fabricante.
3. **Degradación elegante:** si una función no existe, Lindsy ofrece el método alternativo disponible (botón, notificación, Atajo, etc.).
4. **Privacidad por defecto:** no hay transmisión de audio continuo. La captura se inicia por acción clara del usuario o por un mecanismo del sistema autorizado.
5. **Confirmación antes de acciones sensibles:** llamadas, mensajes, compras, cambios de cuenta, datos personales y acciones irreversibles.
6. **Proveedores intercambiables:** Groq/Gemini inicialmente; Claude u otros se agregan detrás de un adaptador del servidor.
7. **Persistencia externa:** no guardar memoria importante en el disco efímero del servicio web.
8. **Aislamiento:** este prototipo no se conecta al webhook de WhatsApp comercial ni modifica servicios existentes.

## Arquitectura lógica

```
Android (Kotlin)             iOS (SwiftUI, etapa posterior)
- UI y permisos              - UI y permisos
- captura/reproducción       - captura/reproducción
- intents / Atajos           - App Intents / Atajos
          \                    /
           HTTPS + contrato JSON
                    |
             API FastAPI
                    |
        Router de IA / herramientas
          |         |          |
        Groq      Gemini    futuros proveedores
                    |
          Memoria persistente (Postgres)
```

## Contrato inicial de conversación

Solicitud `POST /api/v1/assistant/turn`:

```json
{
  "text": "Hola, Lindsy",
  "session_id": "identificador-opaco-de-sesion",
  "client": {
    "platform": "android",
    "os_version": "11",
    "app_version": "0.1.0"
  }
}
```

Respuesta:

```json
{
  "reply": "Hola. Estoy aquí.",
  "session_id": "identificador-opaco-de-sesion",
  "speech": {
    "mode": "client_tts",
    "audio_url": null
  },
  "actions": [],
  "requires_confirmation": false
}
```

El servidor no ejecutará acciones del teléfono directamente. Devolverá propuestas tipadas; el cliente validará permisos y solicitará confirmación según la política antes de ejecutarlas.

## Matriz de capacidades

La app mantendrá una matriz calculada en tiempo de ejecución, por ejemplo:

- `manual_voice_session`
- `background_foreground_service`
- `default_assistant_role`
- `wake_word_experimental`
- `text_to_speech`
- `system_intents`
- `accessibility_automation_opt_in`
- `ios_shortcuts`

Cada capacidad debe indicar `available`, `requires_permission`, `unsupported` o `experimental`. Nunca se debe mostrar una función como disponible sin comprobarla en el dispositivo.

## Fases

### Fase 0 — diseño y seguridad
- Definir contrato de API y matriz de capacidades.
- Documentar separación de entornos y secretos.
- No desplegar ni conectar Meta.

### Fase 1 — Android mínimo en Moto G20
- Proyecto Kotlin compilable por GitHub Actions.
- Pantalla simple con botón de micrófono.
- Capturar una frase solo durante sesión iniciada por el usuario.
- Enviar texto al backend de prueba y reproducir respuesta con TextToSpeech.
- Pruebas unitarias y de API antes de instalar.

### Fase 2 — Android moderno
- Probar versiones Android actuales y dispositivos Samsung/Motorola.
- Evaluar rol de asistente, accesos rápidos, Bluetooth y servicios en primer plano.
- Medir batería, latencia y comportamiento con pantalla apagada.

### Fase 3 — memoria y herramientas
- Base de datos persistente.
- Router de proveedores y políticas de confirmación.
- Herramientas del dispositivo mediante interfaces específicas por plataforma.

### Fase 4 — iOS
- Cliente SwiftUI independiente.
- Voz iniciada por usuario, reproducción y Atajos/Siri según APIs públicas.
- Misma API y políticas del backend; sin prometer wake word continuo ni automatización global.

## Criterios de aceptación de la primera prueba

- El usuario toca un botón y concede permiso de micrófono.
- La app transcribe o envía texto de prueba de forma controlada.
- La API devuelve una respuesta.
- Android la lee en voz alta.
- La sesión puede detenerse claramente.
- No se graba ni transmite audio cuando la sesión está detenida.
- No hay llamadas, SMS, WhatsApp ni automatización de otras apps en esta primera etapa.

## Riesgos y decisiones pendientes

- Confirmar versiones exactas de Android y APIs del Moto G20.
- Elegir el método de STT que funcione con el idioma y dispositivo.
- Verificar compatibilidad y costo actuales de cada proveedor antes de contratarlos.
- Separar el despliegue FastAPI del servicio Node comercial. El `Procfile` en la raíz de este repositorio apunta a Uvicorn; por tanto, esta rama nunca debe desplegarse sobre el servicio comercial existente.
- La compilación remota por GitHub Actions es una vía posible, pero requiere workflow, SDK/Gradle compatibles y validación de artefactos.

## Fuera de alcance por ahora

- Escucha permanente garantizada con pantalla apagada.
- Grabación ambiental continua.
- Automatización desatendida de bancos o aplicaciones de terceros.
- Acciones sensibles sin confirmación.
- Publicación en tiendas.
