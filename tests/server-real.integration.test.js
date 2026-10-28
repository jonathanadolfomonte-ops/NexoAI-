import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("../", import.meta.url));
const serverPath = path.join(repoRoot, "server.js");
const preloadPath = fileURLToPath(new URL("./fixtures/block-external-fetch.mjs", import.meta.url));
const TEST_SECRET = "meta-app-secret-ficticio-solo-pruebas";
const VERIFY_TOKEN = "verify-token-ficticio";
const PERSONAL_NUMBER = "5493815550123";
const COMMERCIAL_NUMBER = "5493815550999";

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

function readLog(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

async function waitForLog(file, predicate, expectedCount = 1, timeoutMs = 3000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const matching = readLog(file).filter(predicate);
    if (matching.length >= expectedCount) return readLog(file);
    await delay(25);
  }
  throw new Error("No se observó la salida simulada esperada. Registro: " + JSON.stringify(readLog(file)));
}

async function startServer(t, options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "nexoai-server-integration-"));
  const logFile = path.join(tempDir, "outbound.jsonl");
  const port = await freePort();
  const env = {
    ...process.env,
    PORT: String(port),
    WHATSAPP_TOKEN: "token-whatsapp-ficticio",
    WHATSAPP_PHONE_NUMBER_ID: "PHONE_ID_FICTICIO",
    WHATSAPP_VERIFY_TOKEN: VERIFY_TOKEN,
    META_APP_SECRET: TEST_SECRET,
    ANTHROPIC_API_KEY: "clave-anthropic-ficticia",
    GROQ_API_KEY: "clave-groq-ficticia",
    PERSONAL_WHATSAPP_NUMBER: PERSONAL_NUMBER,
    PERSONAL_WHATSAPP_PHONE_NUMBER_ID: options.personalPhoneNumberId || "",
    OWNER_WHATSAPP_NUMBER: "",
    TEST_OUTBOUND_LOG: logFile,
    TEST_GROQ_MODE: options.groqMode || "ok",
    TEST_CLAUDE_MODE: options.claudeMode || "ok",
    NODE_OPTIONS: "--import=" + preloadPath
  };
  if (options.personalOnly) {
    env.PERSONAL_ASSISTANT_ONLY = "true";
    env.PERSONAL_WHATSAPP_PHONE_NUMBER_ID = options.personalPhoneNumberId || "PHONE_ID_PERSONAL_FICTICIO";
    delete env.WHATSAPP_PHONE_NUMBER_ID;
    delete env.ANTHROPIC_API_KEY;
  } else {
    env.PERSONAL_ASSISTANT_ONLY = "false";
  }
  delete env.WEBHOOK_PLANILLA_URL;
  delete env.PLANILLA_CLAVE;

  const child = spawn(process.execPath, [serverPath], {
    cwd: repoRoot, env, stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => { output += chunk.toString(); });
  child.stderr.on("data", (chunk) => { output += chunk.toString(); });

  const baseUrl = "http://127.0.0.1:" + port;
  let ready = false;
  const end = Date.now() + 7000;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error("El servidor de prueba terminó antes de iniciar:\n" + output);
    try {
      const response = await fetch(baseUrl + "/");
      if (response.ok) { ready = true; break; }
    } catch {}
    await delay(50);
  }
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error("El servidor de prueba no inició a tiempo:\n" + output);
  }

  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await Promise.race([
        new Promise((resolve) => child.once("exit", resolve)),
        delay(1500)
      ]);
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  });
  return { baseUrl, logFile, output: () => output };
}

function payloadFor({ from, id, text = "mensaje ficticio", phoneNumberId = "PHONE_ID_FICTICIO" }) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "WABA_FICTICIA",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "0000000000", phone_number_id: phoneNumberId },
          contacts: [{ profile: { name: "Cliente de prueba" }, wa_id: from }],
          messages: [{
            from, id, timestamp: "1792530000", type: "text", text: { body: text }
          }]
        }
      }]
    }]
  };
}

async function postWebhook(baseUrl, payload, options = {}) {
  const rawBody = JSON.stringify(payload);
  const validSignature = "sha256=" + crypto.createHmac("sha256", TEST_SECRET).update(rawBody).digest("hex");
  return fetch(baseUrl + "/webhook", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": options.signature === false ? "sha256=firma-invalida" : validSignature
    },
    body: rawBody
  });
}

test("servidor real aislado: página raíz y verificación GET del webhook", async (t) => {
  const { baseUrl } = await startServer(t);
  const root = await fetch(baseUrl + "/");
  assert.equal(root.status, 200);
  assert.match(await root.text(), /NexoAI WhatsApp activo/);

  const verified = await fetch(baseUrl + "/webhook?hub.mode=subscribe&hub.verify_token=" +
    encodeURIComponent(VERIFY_TOKEN) + "&hub.challenge=desafio-ficticio");
  assert.equal(verified.status, 200);
  assert.equal(await verified.text(), "desafio-ficticio");

  const rejected = await fetch(baseUrl + "/webhook?hub.mode=subscribe&hub.verify_token=incorrecto&hub.challenge=x");
  assert.equal(rejected.status, 403);
});

test("servidor real aislado: rechaza firma POST inválida y no llama a proveedores ni WhatsApp", async (t) => {
  const { baseUrl, logFile } = await startServer(t);
  const response = await postWebhook(baseUrl, payloadFor({
    from: PERSONAL_NUMBER, id: "wamid.invalid-signature", text: "dato ficticio"
  }), { signature: false });
  assert.equal(response.status, 401);
  await delay(100);
  assert.deepEqual(readLog(logFile), []);
});

test("servidor real aislado: mensaje personal llama solo a Groq y el envío queda interceptado", async (t) => {
  const { baseUrl, logFile } = await startServer(t);
  const response = await postWebhook(baseUrl, payloadFor({
    from: PERSONAL_NUMBER, id: "wamid.personal-1", text: "consulta personal ficticia"
  }));
  assert.equal(response.status, 200);
  const entries = await waitForLog(logFile, (entry) => entry.kind === "whatsapp");
  assert.equal(entries.filter((entry) => entry.kind === "groq").length, 1);
  assert.equal(entries.filter((entry) => entry.kind === "claude").length, 0);
  assert.equal(entries.filter((entry) => entry.kind === "whatsapp").length, 1);
  const sent = entries.find((entry) => entry.kind === "whatsapp");
  assert.equal(sent.body.to, PERSONAL_NUMBER);
  assert.equal(sent.body.text.body, "RESPUESTA_GROQ_SIMULADA");
  assert.equal(entries.some((entry) => entry.kind === "BLOCKED_UNEXPECTED_URL"), false);
});

test("servidor real aislado: mensajes recibidos por el ID personal responden con Groq desde ese mismo ID", async (t) => {
  const personalPhoneId = "PHONE_ID_PERSONAL_FICTICIO";
  const customerNumber = "5493815550777";
  const { baseUrl, logFile } = await startServer(t, { personalPhoneNumberId: personalPhoneId });
  const response = await postWebhook(baseUrl, payloadFor({
    from: customerNumber,
    id: "wamid.personal-phone-id-1",
    text: "consulta personal recibida en la línea personal",
    phoneNumberId: personalPhoneId
  }));
  assert.equal(response.status, 200);
  const entries = await waitForLog(logFile, (entry) => entry.kind === "whatsapp");
  assert.equal(entries.filter((entry) => entry.kind === "groq").length, 1);
  assert.equal(entries.filter((entry) => entry.kind === "claude").length, 0);
  const sent = entries.find((entry) => entry.kind === "whatsapp");
  assert.equal(sent.body.to, customerNumber);
  assert.match(sent.url, new RegExp("/" + personalPhoneId + "/messages"));
  assert.equal(sent.body.text.body, "RESPUESTA_GROQ_SIMULADA");
  assert.equal(entries.some((entry) => entry.kind === "BLOCKED_UNEXPECTED_URL"), false);
});

test("servidor real aislado: modo personal arranca sin Claude ni ID comercial y responde solo desde el ID personal", async (t) => {
  const personalPhoneId = "PHONE_ID_PERSONAL_SOLO_FICTICIO";
  const customerNumber = "5493815550666";
  const { baseUrl, logFile } = await startServer(t, { personalOnly: true, personalPhoneNumberId: personalPhoneId });
  const root = await fetch(baseUrl + "/");
  assert.equal(root.status, 200);
  assert.equal(await root.text(), "NexoAI Personal activo");

  const response = await postWebhook(baseUrl, payloadFor({
    from: customerNumber,
    id: "wamid.personal-only-1",
    text: "consulta personal aislada",
    phoneNumberId: personalPhoneId
  }));
  assert.equal(response.status, 200);
  const entries = await waitForLog(logFile, (entry) => entry.kind === "whatsapp");
  assert.equal(entries.filter((entry) => entry.kind === "groq").length, 1);
  assert.equal(entries.filter((entry) => entry.kind === "claude").length, 0);
  const sent = entries.find((entry) => entry.kind === "whatsapp");
  assert.equal(sent.body.to, customerNumber);
  assert.match(sent.url, new RegExp("/" + personalPhoneId + "/messages"));
  assert.equal(sent.body.text.body, "RESPUESTA_GROQ_SIMULADA");
  assert.equal(entries.some((entry) => entry.kind === "BLOCKED_UNEXPECTED_URL"), false);
});

test("servidor real aislado: otro remitente llama solo a Claude y conserva el flujo comercial", async (t) => {
  const { baseUrl, logFile } = await startServer(t);
  const response = await postWebhook(baseUrl, payloadFor({
    from: COMMERCIAL_NUMBER, id: "wamid.commercial-1", text: "consulta comercial ficticia"
  }));
  assert.equal(response.status, 200);
  const entries = await waitForLog(logFile, (entry) => entry.kind === "whatsapp");
  assert.equal(entries.filter((entry) => entry.kind === "claude").length, 1);
  assert.equal(entries.filter((entry) => entry.kind === "groq").length, 0);
  assert.equal(entries.filter((entry) => entry.kind === "whatsapp").length, 1);
  const sent = entries.find((entry) => entry.kind === "whatsapp");
  assert.equal(sent.body.to, COMMERCIAL_NUMBER);
  assert.equal(sent.body.text.body, "RESPUESTA_CLAUDE_SIMULADA");
});

test("servidor real aislado: un mensaje duplicado no genera una segunda respuesta", async (t) => {
  const { baseUrl, logFile } = await startServer(t);
  const payload = payloadFor({
    from: COMMERCIAL_NUMBER, id: "wamid.duplicate-1", text: "mensaje duplicado ficticio"
  });
  assert.equal((await postWebhook(baseUrl, payload)).status, 200);
  await waitForLog(logFile, (entry) => entry.kind === "whatsapp");
  assert.equal((await postWebhook(baseUrl, payload)).status, 200);
  await delay(200);
  const entries = readLog(logFile);
  assert.equal(entries.filter((entry) => entry.kind === "claude").length, 1);
  assert.equal(entries.filter((entry) => entry.kind === "whatsapp").length, 1);
});

test("servidor real aislado: petición de aviso activa notificación al dueño y respuesta veraz", async (t) => {
  const customerNumber = "5493815550777";
  const ownerNumber = "5493873441084";
  const { baseUrl, logFile } = await startServer(t);
  const response = await postWebhook(baseUrl, payloadFor({
    from: customerNumber, id: "wamid.derivacion-aviso-1", text: "Avisále que me escriba."
  }));
  assert.equal(response.status, 200);
  const entries = await waitForLog(logFile, (entry) => entry.kind === "whatsapp" && entry.body?.to === customerNumber, 1);
  const ownerNotice = entries.find((entry) => entry.kind === "whatsapp" && entry.body?.to === ownerNumber);
  assert.ok(ownerNotice, "debe intentarse el envío del aviso al 084");
  assert.match(ownerNotice.body.text.body, /alguien quiere hablar con vos/i);
  assert.match(ownerNotice.body.text.body, /ACEPTO \\d{6}/);
  assert.match(ownerNotice.body.text.body, /RECHAZO \\d{6}/);
  assert.match(ownerNotice.body.text.body, new RegExp(customerNumber));
  const customerReply = entries.find((entry) => entry.kind === "whatsapp" && entry.body?.to === customerNumber);
  assert.match(customerReply.body.text.body, /aceptó el envío del aviso/i);
  assert.equal(entries.some((entry) => entry.kind === "BLOCKED_UNEXPECTED_URL"), false);
});

test("servidor real aislado: ACEPTO autoriza compartir el contacto", async (t) => {
  const customerNumber = "5493815550778";
  const ownerNumber = "5493873441084";
  const personalPhoneId = "PHONE_ID_AUTORIZACION_FICTICIO";
  const { baseUrl, logFile } = await startServer(t, { personalPhoneNumberId: personalPhoneId });
  await postWebhook(baseUrl, payloadFor({ from: customerNumber, id: "wamid.autoriza-solicitud", text: "Quiero hablar con Jonathan", phoneNumberId: personalPhoneId }));
  const first = await waitForLog(logFile, (entry) => entry.kind === "whatsapp" && entry.body?.to === ownerNumber);
  const notice = first.find((entry) => entry.kind === "whatsapp" && entry.body?.to === ownerNumber);
  const code = notice.body.text.body.match(/Solicitud #(\d{6})/)?.[1];
  assert.ok(code, "el aviso debe tener un código de seis dígitos");
  await postWebhook(baseUrl, payloadFor({ from: ownerNumber, id: "wamid.autoriza-comando", text: "ACEPTO " + code, phoneNumberId: personalPhoneId }));
  const after = await waitForLog(logFile, (entry) => entry.kind === "whatsapp" && entry.body?.to === customerNumber && /Su WhatsApp/.test(entry.body.text.body));
  assert.match(after.find((entry) => entry.body?.to === customerNumber && /Su WhatsApp/.test(entry.body.text.body)).body.text.body, /wa\.me/);
});

test("servidor real aislado: RECHAZO no comparte el enlace", async (t) => {
  const customerNumber = "5493815550779";
  const ownerNumber = "5493873441084";
  const personalPhoneId = "PHONE_ID_RECHAZO_FICTICIO";
  const { baseUrl, logFile } = await startServer(t, { personalPhoneNumberId: personalPhoneId });
  await postWebhook(baseUrl, payloadFor({ from: customerNumber, id: "wamid.rechazo-solicitud", text: "Quiero hablar con Jonathan", phoneNumberId: personalPhoneId }));
  const first = await waitForLog(logFile, (entry) => entry.kind === "whatsapp" && entry.body?.to === ownerNumber);
  const notice = first.find((entry) => entry.kind === "whatsapp" && entry.body?.to === ownerNumber);
  const code = notice.body.text.body.match(/Solicitud #(\d{6})/)?.[1];
  assert.ok(code, "el aviso debe tener un código de seis dígitos");
  await postWebhook(baseUrl, payloadFor({ from: ownerNumber, id: "wamid.rechazo-comando", text: "RECHAZO " + code, phoneNumberId: personalPhoneId }));
  const after = await waitForLog(logFile, (entry) => entry.kind === "whatsapp" && entry.body?.to === customerNumber && /Jonathan está ocupado/.test(entry.body.text.body));
  assert.match(after.find((entry) => entry.body?.to === customerNumber && /Jonathan está ocupado/.test(entry.body.text.body)).body.text.body, /ocupado/i);
  assert.equal(after.some((entry) => entry.body?.to === customerNumber && /Su WhatsApp/.test(entry.body.text.body)), false);
});
test("servidor real aislado: si Groq falla, no recurre a Claude y la salida sigue simulada", async (t) => {
  const { baseUrl, logFile } = await startServer(t, { groqMode: "error" });
  const response = await postWebhook(baseUrl, payloadFor({
    from: PERSONAL_NUMBER, id: "wamid.groq-error-1", text: "consulta ficticia con error"
  }));
  assert.equal(response.status, 200);
  const entries = await waitForLog(logFile, (entry) => entry.kind === "whatsapp");
  assert.ok(entries.filter((entry) => entry.kind === "groq").length >= 1);
  assert.equal(entries.filter((entry) => entry.kind === "claude").length, 0);
  assert.match(entries.find((entry) => entry.kind === "whatsapp").body.text.body, /problema técnico/i);
  assert.equal(entries.some((entry) => entry.kind === "BLOCKED_UNEXPECTED_URL"), false);
});
