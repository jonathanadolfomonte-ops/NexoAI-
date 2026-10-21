import test from "node:test";
import assert from "node:assert/strict";
import { simulateIncomingMessage } from "../src/testing/message-flow-harness.js";

function fakeEnvironment({ groqResult = "respuesta Groq", claudeResult = "respuesta Claude", groqError = false, claudeError = false, groqEnabled = true } = {}) {
  const calls = { groq: [], claude: [], sent: [] };
  const groq = groqEnabled ? { async respond(text) {
    calls.groq.push(text);
    if (groqError) throw new Error("fallo Groq simulado");
    return groqResult;
  } } : null;
  const claude = { async respond(text) {
    calls.claude.push(text);
    if (claudeError) throw new Error("fallo Claude simulado");
    return claudeResult;
  } };
  const send = async (to, body) => { calls.sent.push({ to, body }); };
  return { calls, groq, claude, send };
}

const personalNumber = "5493815550123";
const commercialNumber = "5493815550999";

test("integración simulada: el número personal usa solo Groq y envía la respuesta simulada", async () => {
  const env = fakeEnvironment();
  const result = await simulateIncomingMessage({
    sender: "+54 9 381 555-0123", text: "nota personal", personalNumber,
    groq: env.groq, claude: env.claude, send: env.send,
  });
  assert.deepEqual(result, { route: "personal", provider: "groq", status: "ok" });
  assert.deepEqual(env.calls.groq, ["nota personal"]);
  assert.deepEqual(env.calls.claude, []);
  assert.equal(env.calls.sent.length, 1);
  assert.equal(env.calls.sent[0].body, "respuesta Groq");
});

test("integración simulada: otro número usa solo Claude y conserva el flujo comercial", async () => {
  const env = fakeEnvironment();
  const result = await simulateIncomingMessage({
    sender: commercialNumber, text: "consulta comercial", personalNumber,
    groq: env.groq, claude: env.claude, send: env.send,
  });
  assert.deepEqual(result, { route: "comercial", provider: "claude", status: "ok" });
  assert.deepEqual(env.calls.groq, []);
  assert.deepEqual(env.calls.claude, ["consulta comercial"]);
  assert.equal(env.calls.sent[0].body, "respuesta Claude");
});

test("error simulado de Groq no deriva la consulta a Claude", async () => {
  const env = fakeEnvironment({ groqError: true });
  const result = await simulateIncomingMessage({
    sender: personalNumber, text: "consulta personal", personalNumber,
    groq: env.groq, claude: env.claude, send: env.send,
  });
  assert.equal(result.status, "provider-error");
  assert.deepEqual(env.calls.groq, ["consulta personal"]);
  assert.deepEqual(env.calls.claude, []);
  assert.match(env.calls.sent[0].body, /problema técnico/);
});

test("error simulado de Claude no llama a Groq y devuelve disculpa comercial", async () => {
  const env = fakeEnvironment({ claudeError: true });
  const result = await simulateIncomingMessage({
    sender: commercialNumber, text: "consulta comercial", personalNumber,
    groq: env.groq, claude: env.claude, send: env.send,
  });
  assert.equal(result.status, "provider-error");
  assert.deepEqual(env.calls.groq, []);
  assert.deepEqual(env.calls.claude, ["consulta comercial"]);
  assert.match(env.calls.sent[0].body, /problema técnico/);
});

test("sin Groq configurado, el asistente personal informa el estado sin llamar a Claude", async () => {
  const env = fakeEnvironment({ groqEnabled: false });
  const result = await simulateIncomingMessage({
    sender: personalNumber, text: "hola", personalNumber,
    groq: env.groq, claude: env.claude, send: env.send,
  });
  assert.equal(result.status, "personal-disabled");
  assert.deepEqual(env.calls.claude, []);
  assert.match(env.calls.sent[0].body, /falta configurar GROQ_API_KEY/);
});

test("formato de número no equivalente cae al flujo comercial, no al personal", async () => {
  const env = fakeEnvironment();
  const result = await simulateIncomingMessage({
    sender: "543815550123", text: "hola", personalNumber,
    groq: env.groq, claude: env.claude, send: env.send,
  });
  assert.equal(result.route, "comercial");
  assert.deepEqual(env.calls.groq, []);
  assert.deepEqual(env.calls.claude, ["hola"]);
});

test("respuesta vacía del proveedor usa un mensaje alternativo sin datos externos", async () => {
  const env = fakeEnvironment({ groqResult: "   " });
  const result = await simulateIncomingMessage({
    sender: personalNumber, text: "hola", personalNumber,
    groq: env.groq, claude: env.claude, send: env.send,
  });
  assert.equal(result.status, "ok");
  assert.match(env.calls.sent[0].body, /No pude preparar una respuesta/);
});

test("el envío simulado solo registra el mensaje; no usa fetch ni credenciales reales", async () => {
  const env = fakeEnvironment();
  await simulateIncomingMessage({
    sender: commercialNumber, text: "mensaje ficticio", personalNumber,
    groq: env.groq, claude: env.claude, send: env.send,
  });
  assert.deepEqual(env.calls.sent, [{ to: commercialNumber, body: "respuesta Claude" }]);
});
