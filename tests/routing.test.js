import test from "node:test";
import assert from "node:assert/strict";
import { normalizePhone, routeMessage } from "../src/logic/nexoai-core.js";

test("normaliza un número quitando signos y espacios", () => {
  assert.equal(normalizePhone("+54 9 381 555-0123"), "5493815550123");
});

test("dirige al flujo personal cuando los dígitos normalizados coinciden", () => {
  assert.equal(routeMessage("+54 9 381 555-0123", "5493815550123"), "personal");
});

test("mantiene el flujo comercial cuando el remitente no coincide", () => {
  assert.equal(routeMessage("5493815550124", "5493815550123"), "comercial");
});

test("si no se configura número personal, no intercepta mensajes", () => {
  assert.equal(routeMessage("5493815550123", ""), "comercial");
});

test("no adivina equivalencias entre formatos distintos", () => {
  assert.equal(routeMessage("543815550123", "5493815550123"), "comercial");
});
