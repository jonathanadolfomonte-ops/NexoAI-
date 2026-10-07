# Guía: conectar NexoAI con WhatsApp

## Cómo funciona
Cliente escribe por WhatsApp → Meta avisa a este servidor (`/webhook`) → el servidor consulta a Claude con las reglas de `instrucciones-negocio.md` → la respuesta vuelve al cliente por WhatsApp.

## Paso 1: completar las instrucciones del negocio
Editá `instrucciones-negocio.md` y reemplazá todo lo que dice `[COMPLETAR]` (productos, precios, horarios, envíos, pagos).

## Paso 2: crear la app en Meta
1. Entrá a developers.facebook.com con tu cuenta de Facebook y creá una app de tipo **Business**.
2. Agregá el producto **WhatsApp**.
3. En *WhatsApp > Configuración de la API* vas a ver un **número de prueba gratuito**, el **Phone number ID** y un **token temporal** (dura 24 horas).
4. Agregá tu número personal como destinatario de prueba. Así podés escribirle al número de prueba desde tu WhatsApp y probar todo sin tocar tu línea.
5. En *Configuración de la app > Básica* copiá el **App Secret**.

## Paso 3: publicar el servidor (ejemplo con Render)
1. Creá una cuenta en render.com y un **Web Service** conectado a este repo.
2. Build command: `npm install`. Start command: `npm start`.
3. Cargá las variables de `.env.example` en el panel de Render:
   - `ANTHROPIC_API_KEY`: tu clave de la consola de Anthropic.
   - `WHATSAPP_TOKEN`: el token de Meta.
   - `WHATSAPP_PHONE_NUMBER_ID`: el ID del número.
   - `WHATSAPP_VERIFY_TOKEN`: una clave larga que inventes vos.
   - `META_APP_SECRET`: el App Secret.
4. Anotá la URL pública que te da Render, por ejemplo `https://nexoai.onrender.com`.

## Paso 4: conectar el webhook
En Meta, *WhatsApp > Configuración > Webhook*:
- URL de devolución de llamada: `https://TU-URL/webhook`
- Token de verificación: el mismo `WHATSAPP_VERIFY_TOKEN`
- Suscribite al campo **messages**.

## Paso 5: probar
Escribile "Hola" al número de prueba desde tu WhatsApp. Deberías recibir la respuesta de NexoAI.

## Para usar un número propio de verdad
- Un número que ya está en la app clásica de WhatsApp **no se puede usar a la vez con la API**, salvo que lo des de baja en la app. Meta también ofrece una modalidad de convivencia con la app WhatsApp Business; revisá en la documentación de Meta si está disponible para tu caso.
- Lo más prolijo es usar una línea dedicada solo al negocio.
- El token temporal vence a las 24 horas: para producción creá un **usuario del sistema** en el Administrador de negocios de Meta y generá un token permanente.

## Seguridad
- El repo es público: **nunca** subas claves ni el archivo `.env`.
- Si alguna clave se filtra, regenerala de inmediato en el panel de Meta o de Anthropic.
