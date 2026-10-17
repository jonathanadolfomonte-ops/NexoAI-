// Registro de conversaciones de NexoAI en una planilla de Google.
// Pegar en Extensiones > Apps Script de la planilla y publicar como "Aplicacion web"
// (ejecutar como: yo / acceso: cualquier persona). La CLAVE debe ser la misma que PLANILLA_CLAVE en Render.
const CLAVE = "PONER_AQUI_LA_CLAVE";

function doPost(e) {
  try {
    const d = JSON.parse(e.postData.contents);
    if (d.clave !== CLAVE) return responder({ ok: false, error: "clave incorrecta" });
    const hoja = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    hoja.appendRow([d.fecha, d.numero, d.nombre, d.texto, d.respuesta, d.estado].map(limpiar));
    return responder({ ok: true });
  } catch (err) {
    return responder({ ok: false, error: String(err) });
  }
}

// Evita que un texto que empiece con = + - @ se tome como formula
function limpiar(v) {
  const s = String(v == null ? "" : v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function responder(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
