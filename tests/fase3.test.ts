import assert from "node:assert/strict";
import { test } from "node:test";
import { createFocusSession, looksLikeFocusRequest, startFocusPhase } from "../lib/tools/focus";
import {
  looksLikeReminderRequest,
  parseReminderFromText,
  upcomingReminders,
} from "../lib/tools/reminders";
import { looksLikeScreenExplain, RECOMMENDED_VISION_MODEL } from "../lib/tools/screen-reader";

test("enfoque y pantalla se detectan", () => {
  assert.equal(looksLikeFocusRequest("activa pomodoro con sonido"), true);
  assert.equal(looksLikeScreenExplain("explica esta pantalla"), true);
  assert.match(RECOMMENDED_VISION_MODEL, /qwen2\.5vl/i);
});

test("parsea recordatorio simple", () => {
  assert.equal(looksLikeReminderRequest("recuérdame a las 18:30 entregar ensayo"), true);
  const rem = parseReminderFromText("recuérdame a las 18:30 entregar ensayo");
  assert.ok(rem);
  assert.match(rem!.title, /ensayo/i);
  const up = upcomingReminders([rem!], 48);
  assert.ok(up.length <= 1);
});

test("pomodoro arranca fase de trabajo", () => {
  const session = startFocusPhase(createFocusSession({ workMinutes: 25 }), "work");
  assert.equal(session.phase, "work");
  assert.ok((session.endsAt || 0) > Date.now());
});
