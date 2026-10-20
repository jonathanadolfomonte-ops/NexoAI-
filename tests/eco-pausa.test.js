import test from "node:test";
import assert from "node:assert/strict";
import { isPaused, shouldIgnoreEcho } from "../src/logic/nexoai-core.js";

test("ignora un eco cuyo id coincide con un mensaje enviado por el bot", () => {
  assert.equal(shouldIgnoreEcho("wamid-ficticio-1", new Set(["wamid-ficticio-1"])), true);
});

test("no ignora un eco sin id ni uno que no coincide", () => {
  const sent = new Set(["wamid-ficticio-1"]);
  assert.equal(shouldIgnoreEcho(undefined, sent), false);
  assert.equal(shouldIgnoreEcho("wamid-otro", sent), false);
});

test("considera activa una pausa solo hasta su vencimiento", () => {
  assert.equal(isPaused(2000, 1999), true);
  assert.equal(isPaused(2000, 2000), false);
  assert.equal(isPaused(2000, 2001), false);
});

test("un vencimiento inválido no pausa la conversación", () => {
  assert.equal(isPaused(undefined, 1000), false);
  assert.equal(isPaused(Number.NaN, 1000), false);
});
