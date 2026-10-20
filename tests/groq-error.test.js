import test from "node:test";
import assert from "node:assert/strict";
import { extractGroqText } from "../src/logic/nexoai-core.js";

test("extrae y recorta el texto de una respuesta simulada de Groq", () => {
  assert.equal(
    extractGroqText({ choices: [{ message: { content: "  Hola, soy Lindsy.  " } }] }),
    "Hola, soy Lindsy."
  );
});

test("devuelve texto vacío ante una respuesta incompleta", () => {
  assert.equal(extractGroqText(undefined), "");
  assert.equal(extractGroqText({ choices: [] }), "");
  assert.equal(extractGroqText({ choices: [{ message: { content: null } }] }), "");
});

test("no convierte contenido no textual en una respuesta", () => {
  assert.equal(
    extractGroqText({ choices: [{ message: { content: { text: "hola" } } }] }),
    ""
  );
});
