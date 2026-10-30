# Firma de distribución de Lindsy ProMax

## Estado

El proyecto admite una compilación Release firmada, pero **no contiene una clave privada**. No se genera ni se comparte una clave automáticamente. La firma de depuración anterior no es una firma de distribución.

## Secretos requeridos en GitHub

En el repositorio, dentro de Settings → Secrets and variables → Actions, deben existir estos cuatro secretos:

- `ANDROID_KEYSTORE_BASE64`: archivo keystore codificado en Base64.
- `ANDROID_KEYSTORE_PASSWORD`: contraseña del keystore.
- `ANDROID_KEY_ALIAS`: alias de la clave.
- `ANDROID_KEY_PASSWORD`: contraseña de la clave.

No escribir contraseñas ni claves privadas en el código, en commits, en Issues ni en mensajes de chat. No reutilizar una clave de otro proyecto.

## Crear y custodiar la clave

La clave de firma debe generarse en un entorno de confianza con Android Build Tools/Java (`keytool`), guardarse en un respaldo cifrado y conservarse a largo plazo. Si se pierde, no se podrá actualizar de forma normal la app instalada con esa misma identidad de firma.

Antes de generar una clave definitiva, confirmar quién custodiará el archivo y su contraseña. No generar una clave efímera en GitHub Actions ni subir el keystore como artefacto público.

## Flujo CI

El workflow compila siempre el APK Debug para pruebas. Solo compila y publica `lindsy-promax-android-release-signed` cuando los cuatro secretos están configurados. Si faltan, lo informa y no presenta un APK Debug como versión segura de distribución.

## Verificación pendiente antes de instalar

- Confirmar que el artefacto Release está firmado con la clave esperada.
- Verificar el certificado y el SHA-256 del APK.
- Revisar permisos y dependencias del paquete final.
- Probar en un dispositivo de prueba y comprobar que Play Protect no muestre una advertencia.
- No desactivar Play Protect para forzar la instalación.
