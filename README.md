# NexoAI-

Asistente inteligente para atención al cliente y automatización de negocios.

NexoAI atiende por **WhatsApp** a los clientes de un comercio: recibe sus mensajes, consulta a **Claude** (Anthropic) con las reglas del negocio y responde en el momento, en español rioplatense y con mensajes cortos.

## Cómo funciona

```
Cliente escribe por WhatsApp
        ↓
Meta avisa al servidor (POST /webhook)
        ↓
El servidor valida la firma y consulta a Claude
con las reglas de instrucciones-negocio.md
        ↓
La respuesta vuelve al cliente por WhatsApp
```

- Recuerda los **últimos 10 mensajes** de cada conversación (en memoria: se borra si el servidor se reinicia).
- Si el cliente manda algo que no es texto (audio, imagen), le avisa que por ahora solo lee mensajes de texto.
- Valida que cada mensaje venga realmente de Meta (firma HMAC con `META_APP_SECRET`).
- No inventa precios, stock ni plazos: si no está en las instrucciones, deriva a una persona real.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `server.js` | Servidor Express: webhook de WhatsApp + conexión con Claude |
| `instrucciones-negocio.md` | Reglas, tono y datos del negocio que sigue el asistente (**completar los campos `[COMPLETAR]`**) |
| `GUIA-WHATSAPP.md` | Guía paso a paso para conectar con WhatsApp Cloud API y publicar en Render |
| `.env.example` | Lista de variables de entorno necesarias (sin valores reales) |
| `index.html` | Demo visual del chat. Es solo una maqueta: **no** se conecta todavía con Claude ni con WhatsApp |
| `package.json` | Dependencias y comando de inicio |

## Puesta en marcha

Requisitos: **Node.js 20 o superior**, una clave de la API de Anthropic y una app de Meta con WhatsApp configurado.

1. Instalar dependencias:
   ```bash
   npm install
   ```
2. Copiar `.env.example` como `.env` y completar los valores.
3. Completar `instrucciones-negocio.md` con los datos reales del negocio.
4. Iniciar:
   ```bash
   npm start
   ```
5. Conectar el webhook en Meta y publicar el servidor. Todo el detalle está en [`GUIA-WHATSAPP.md`](GUIA-WHATSAPP.md).

## Variables de entorno

Obligatorias (si falta alguna, el servidor no arranca y avisa cuál):

- `ANTHROPIC_API_KEY`: clave de la API de Anthropic.
- `WHATSAPP_TOKEN`: token de acceso de Meta.
- `WHATSAPP_PHONE_NUMBER_ID`: ID del número de WhatsApp.
- `WHATSAPP_VERIFY_TOKEN`: clave larga inventada por vos, la misma que se carga en Meta.
- `META_APP_SECRET`: *App Secret* de la app de Meta.

Opcionales:

- `PORT` (por defecto 3000).
- `CLAUDE_MODEL` (por defecto `claude-sonnet-5-5`).
- `WHATSAPP_API_VERSION` (por defecto `v21.0`).

## Seguridad

⚠️ Este repositorio es **público**. Nunca subas el archivo `.env` ni ninguna clave. Si una clave se filtra, regenerala de inmediato en el panel de Meta o de Anthropic.

## Estado

Versión inicial (0.1.0). Próximos pasos posibles: guardar las conversaciones de forma persistente, cargar productos y precios desde una planilla, y conectar la demo web con el asistente.
