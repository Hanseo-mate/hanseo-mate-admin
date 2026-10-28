import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  HOME_MESSAGE_ENDPOINT,
  HOME_MESSAGE_MAX_LENGTH,
  parseHomeMessageSetting,
  validateHomeMessage,
} from "../app/lib/home-message.ts";

const root = new URL("../", import.meta.url);

test("parses the documented home message response, including the cleared state", () => {
  assert.equal(HOME_MESSAGE_ENDPOINT, "/api/admin/home-message");
  assert.equal(HOME_MESSAGE_MAX_LENGTH, 500);
  assert.deepEqual(parseHomeMessageSetting({ message: "안녕하세요" }), { message: "안녕하세요" });
  assert.deepEqual(parseHomeMessageSetting({ message: "" }), { message: "" });
  assert.throws(() => parseHomeMessageSetting({ message: null }), /응답 형식/);
  assert.throws(() => parseHomeMessageSetting({}), /응답 형식/);
});

test("counts JavaScript UTF-16 code units before trimming", () => {
  assert.equal(validateHomeMessage("a".repeat(500)), "");
  assert.match(validateHomeMessage("a".repeat(501)), /500자/);
  assert.equal(validateHomeMessage("😀".repeat(250)), "");
  assert.match(validateHomeMessage("😀".repeat(251)), /500자/);
  assert.match(validateHomeMessage(` ${"a".repeat(500)}`), /500자/);
  assert.equal(validateHomeMessage(""), "");
});

test("the settings page reads, updates, and clears the single shared message", async () => {
  const [page, shell] = await Promise.all([
    readFile(new URL("app/settings/home-message/page.tsx", root), "utf8"),
    readFile(new URL("app/components/AppShell.tsx", root), "utf8"),
  ]);
  assert.match(page, /<AdminLoginNotice returnTo="\/settings\/home-message">/);
  assert.match(page, /apiFetch<unknown>\(HOME_MESSAGE_ENDPOINT/);
  assert.match(page, /method: "GET"/);
  assert.match(page, /method: "PUT"/);
  assert.match(page, /JSON\.stringify\(\{ message \}\)/);
  assert.match(page, /onConfirm=\{\(\) => void putMessage\(""\)\}/);
  assert.match(page, /maxLength=\{HOME_MESSAGE_MAX_LENGTH\}/);
  assert.match(page, /setSavedMessage\(setting\.message\)/);
  assert.match(page, /setDraft\(setting\.message\)/);
  assert.match(shell, /href: "\/settings\/home-message",\s*label: "메인페이지 메시지"/);
});
