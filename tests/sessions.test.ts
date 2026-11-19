import assert from "node:assert/strict";
import test from "node:test";
import {
  createEmptySession,
  ensureSessions,
  sessionsFromThreads,
  titleFromMessages,
} from "../lib/sessions";

test("titleFromMessages usa la primera pregunta", () => {
  assert.equal(titleFromMessages([]), "Chat nuevo");
  assert.equal(
    titleFromMessages([
      { role: "assistant", content: "hola" },
      { role: "user", content: "Razas de perros pequeños" },
    ]),
    "Razas de perros pequeños",
  );
});

test("ensureSessions crea un chat si la lista está vacía", () => {
  const ensured = ensureSessions([]);
  assert.equal(ensured.sessions.length, 1);
  assert.equal(ensured.activeId, ensured.sessions[0].id);
});

test("sessionsFromThreads migra hilos antiguos", () => {
  const sessions = sessionsFromThreads({
    preguntar: [
      { role: "user", content: "hola" },
      { role: "assistant", content: "qué tal" },
    ],
  });
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].title, "hola");
  assert.equal(createEmptySession().messages.length, 0);
});
