import assert from "node:assert/strict";
import { test } from "node:test";
import {
  confirmDestructive,
  createTask,
  handleAssistantIntent,
  requestTempCleanup,
  sanitizeTasks,
} from "../lib/tools/assistant";

test("asistente añade y lista tareas", () => {
  const added = handleAssistantIntent("añade tarea: entregar ensayo UNAD", []);
  assert.equal(added.applicable, true);
  assert.ok(added.tasks?.length === 1);
  const listed = handleAssistantIntent("lista tareas", added.tasks || []);
  assert.match(listed.answer, /ensayo UNAD/i);
});

test("asistente pide confirmación antes de borrar temporales", () => {
  const ask = handleAssistantIntent("limpia temporales", []);
  assert.equal(ask.applicable, true);
  assert.ok(ask.pending);
  assert.match(ask.answer, /Confirmación requerida/i);
  const done = confirmDestructive(requestTempCleanup());
  assert.match(done, /lista blanca/i);
});

test("sanitizeTasks limpia entradas rotas", () => {
  const tasks = sanitizeTasks([
    { id: "1", title: "ok", done: false, createdAt: 1 },
    { id: 2, title: "bad" },
    null,
  ]);
  assert.equal(tasks.length, 1);
  assert.equal(createTask("x").done, false);
});
