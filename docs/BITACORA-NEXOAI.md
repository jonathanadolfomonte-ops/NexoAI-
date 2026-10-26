# NexoAI: bitácora y manual para replicar el asistente de WhatsApp

Objetivo: dejar documentado todo el proceso (pasos, errores y soluciones) para repetirlo con cada cliente nuevo y poder vender NexoAI como producto.
Última actualización: 25/10/2026. Este documento no contiene claves, tokens ni secretos: esos valores van solo en las variables de entorno del servicio.

## 1. Qué es NexoAI

Asistente virtual de WhatsApp (API oficial de Meta) con inteligencia artificial. Dos productos:

- **NexoAI para negocios:** atiende clientes, muestra catálogo, deriva a una persona y avisa al dueño. Ejemplo en producción: Moda Florencia y Kiosco Mayra.
- **NexoAI personal (Lindsy):** asistente personal de uso cotidiano que atiende a quien escribe a un número y deriva al dueño cuando hace falta.

## 2. Arquitectura

- Una **app de Meta** (caso de uso WhatsApp) y una **cuenta de WhatsApp Business (WABA)** con uno o más números en la Cloud API.
- Un **usuario del sistema** de Meta con token permanente, asignado a la cuenta de WhatsApp.
- Un **servicio web en Render** por producto (Node.js), con la ruta `/webhook`:
  - `GET /webhook`: verificación de Meta con el verify token.
  - `POST /webhook`: mensajes y estados, con validación de firma (`X-Hub-Signature-256`).
- Modelos de IA: Claude (negocios) y Groq (Lindsy personal).
- Planilla de Google con Apps Script para registrar conversaciones.
- Código en GitHub: `main` para negocios, una rama aparte para el asistente personal.

Variables de entorno típicas (solo nombres): `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, claves de los modelos de IA, `OWNER_WHATSAPP_NUMBER`, `WEBHOOK_PLANILLA_URL`, `PLANILLA_CLAVE`.

## 3. Pasos para un cliente nuevo

1. Crear la app en Meta con el caso de uso WhatsApp y recibir el mensaje de prueba.
2. Conseguir un número que **no esté en WhatsApp** (si lo está, hay que desvincularlo o borrar la cuenta) y registrarlo en la Cloud API. Verificarlo con el código por SMS o llamada.
3. Crear el usuario del sistema, asignarle la app y la cuenta de WhatsApp, generar el token permanente y guardarlo en un lugar privado.
4. Crear el servicio en Render desde el repositorio, cargar las variables de entorno y esperar el estado Live.
5. En Meta, configurar el webhook con la URL `https://<servicio>.onrender.com/webhook` y el verify token, y suscribir el campo `messages`.
6. Suscribir la app a la **cuenta de WhatsApp que realmente tiene el número** (ver error 3).
7. Probar con un "Hola" desde otro teléfono y revisar los logs de Render.
8. Cargar catálogo, textos y reglas del negocio. Probar derivación a una persona y avisos al dueño.
9. Antes de vender: plan de Render que no se duerma, verificación del negocio en Meta, política de privacidad y plantillas aprobadas (sección 6).

## 4. Errores encontrados y cómo se resolvieron

| # | Síntoma | Causa | Solución |
|---|---------|-------|----------|
| 1 | El bot responde con 403 de GitHub ("Resource not accessible by integration") al crear o actualizar archivos | Permisos de la integración sobre el repositorio | Dar permisos de escritura al repositorio o trabajar con ramas y merge manual |
| 2 | Meta no deja agregar un número ya usado en WhatsApp | El número sigue activo en la app del teléfono | Usar un número nuevo sin WhatsApp, o desconectarlo de la app antes |
| 3 | El bot dejó de responder aunque el webhook estaba verificado | La app estaba suscrita a otra cuenta de WhatsApp distinta de la que tiene el número real | Suscribir la app a la cuenta correcta y revisar que el ID de teléfono coincida |
| 4 | El webhook en Meta apuntaba a una dirección de ngrok | Quedó de las pruebas locales | Cambiarlo a la URL de Render |
| 5 | Con dos números en la misma app, el bot del negocio le respondió al número personal | El webhook de Meta es **por app**: todos los números de la app llegan a la misma URL | Opción A: reenviar desde el servicio del negocio al personal según `phone_number_id`. Opción B: webhook propio por número (override) vinculando la app al negocio en Meta |
| 6 | No se pudo poner un webhook propio por número desde la conexión de WhatsApp de Composio | Meta rechaza el cambio: la app no está vinculada a un negocio | Vincular el ID de la app en Configuración del negocio → Cuentas → Apps, o usar la opción A |
| 7 | El reenvío entre servicios devolvía 502 | El servicio destino, en plan gratis, estaba dormido | Reintentos con espera (5 intentos). Solución de fondo: plan Starter o despertador externo |
| 8 | El asistente recibía el mensaje pero no respondía: error 190 de Meta | Token inválido o vencido en el servicio | Copiar el token permanente que funciona a ese servicio y redeployar |
| 9 | Cambié una variable en Render y no se aplicó | Se guardó con "Save only" | Usar "Save, rebuild and deploy", o disparar un deploy manual |
| 10 | Deploy no arranca solo al subir a la rama | Auto-deploy apagado | Disparar el deploy a mano (API o panel de Render) |
| 11 | Un mensaje no sale porque pasaron más de 24 horas | Ventana de atención de WhatsApp (error 131047) | Responder solo dentro de 24 h; fuera de la ventana usar plantilla aprobada |
| 12 | Los avisos al dueño no llegan | Mismo límite de 24 h: el dueño debe haber escrito al número en ese lapso | Plantilla de aviso aprobada por Meta, o que el dueño escriba al número a diario |
| 13 | La planilla de Google devuelve 500 al registrar conversaciones | Pendiente de revisar (Apps Script o clave) | Revisar el despliegue de la aplicación web y la clave |

## 5. Funciones ya construidas

- Menú inicial 1/2 que elige el negocio y mantiene el contexto.
- Catálogo con nombres, talles, colores y envío de fotos por WhatsApp.
- Derivación a una persona con link `wa.me`, y aviso al dueño por WhatsApp.
- El dueño le dice al bot "decile al cliente que..." y el bot lo transmite.
- Registro de conversaciones en planilla de Google.
- Pausa del bot cuando el dueño responde a mano desde la app.
- Lindsy escribe primero por orden del dueño: el dueño le escribe "Lindsy, escribile al 3873123456 que ya llegué" desde su línea; Lindsy redacta el mensaje de su parte y lo manda. Si la persona nunca escribió (ventana de 24 h cerrada, error 131047), Lindsy manda una plantilla aprobada, guarda el mensaje como pendiente y se lo entrega apenas la persona responde. El dueño recibe aviso de cada paso.
- Lindsy personal: guía de personalidad (`guia-personalidad-lindsy.md`), reglas adicionales (`instrucciones-lindsy.md`), saludo en el primer mensaje, derivación a Jonathan con link y aviso a su línea.

## 6. Pendientes antes de vender

- Plan de hosting que no se duerma (o despertador externo).
- Verificación del negocio en Meta y política de privacidad pública.
- Plantillas propias aprobadas (presentación del asistente y avisos al dueño).
- Memoria persistente: hoy las conversaciones viven en memoria y se pierden al reiniciar.
- Una configuración por cliente (textos, catálogo, números) en vez de código a medida.
- Monitoreo y alertas (caídas, token vencido, errores 5xx).
- Rotación periódica de tokens y revisión de que no haya secretos en el repositorio.
- Pruebas automáticas actualizadas para cada producto.
- Precio, contrato y límites de uso (mensajes por mes, costo de la IA y de WhatsApp).

## 7. Reglas de oro aprendidas

1. Un número por app y por servicio, o reenvío claro por `phone_number_id`.
2. Nunca pegar tokens ni claves en chats, documentos ni repositorios.
3. Probar siempre desde **otro teléfono** distinto del dueño.
4. Mirar los logs del servicio antes de cambiar nada.
5. Todo cambio al bot en vivo pasa primero por una rama y luego se publica.

## 8. Plantillas de Meta (estado)

- `aviso_contacto_dueno` (es_AR, aprobada): "Hola, soy NexoAI… Comunícate con el número {{1}}…". Se usa hoy como apertura provisoria.
- `lindsy_primer_contacto` (es_AR, enviada a Meta el 26/10/2026, pendiente de aprobación): presentación de Lindsy "de parte de Jonathan", sin variables. Al aprobarse, se activa cargando la variable `LINDSY_PLANTILLA=lindsy_primer_contacto` en el servicio personal y redeployando.
- Aprendizaje: una plantilla con botón de respuesta rápida genera un mensaje de tipo "button", no "text"; el código debe contemplarlo antes de usar botones.
