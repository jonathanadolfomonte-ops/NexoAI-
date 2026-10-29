# Cómo dar de alta un cliente nuevo (NexoAI)

Todo lo propio de un negocio vive en `clientes/<id-del-cliente>/`. El código no cambia.

1. Copiar `clientes/_plantilla/` a `clientes/<id>/` (id en minúsculas, números y guiones).
2. Editar `negocio.json`: saludo, y uno o más negocios (`id`, `nombre`, `descripcion`, `palabras`).
   - Con **un** negocio no hay menú: el bot saluda y sigue directo.
   - Con 2 a 9 negocios el bot muestra un menú numerado y entiende también palabras clave.
   - `palabras` es una expresión regular simple separada por `|` (sin acentos, en minúsculas).
3. Completar `instrucciones-negocio.md` (rubro, horarios, pagos, reglas, contacto del dueño).
4. Opcional: `fotos/` (archivos .jpg; el bot las pide con `[[FOTO]] nombre`) y `app/` (PWA instalable del cliente).
   Si faltan, se usan las de la raíz del proyecto.
5. Crear el servicio en Render y cargar las variables: `CLIENTE=<id>`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`,
   `WHATSAPP_VERIFY_TOKEN`, `META_APP_SECRET`, `ANTHROPIC_API_KEY`, `PUBLIC_BASE_URL`, y las del dueño
   (aviso de pedidos) y de la planilla si las usa.
6. Registrar el webhook en Meta con la URL del servicio y probar con un "Hola".

Si `CLIENTE` no existe o el `negocio.json` está mal armado, el servidor no arranca y el error dice qué corregir.
