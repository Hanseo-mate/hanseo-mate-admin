import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  ADMIN_LINKS_ENDPOINT,
  isValidExternalLinkUrl,
  parseManagedLink,
  parseManagedLinks,
  validateLinkForm,
} from "../app/lib/links.ts";

const root = new URL("../", import.meta.url);
const pageUrl = new URL("app/settings/links/page.tsx", root);
const shellUrl = new URL("app/components/AppShell.tsx", root);

function makeLink(overrides = {}) {
  return {
    id: 7,
    name: "한서대학교 홈페이지",
    url: "https://www.hanseo.ac.kr/",
    createdAt: "2026-09-16T09:30:00.123456789",
    updatedAt: "2026-09-16T10:30:00",
    ...overrides,
  };
}

test("uses administrator endpoints for every link operation", () => {
  assert.equal(ADMIN_LINKS_ENDPOINT, "/api/admin/links");
});

test("parses the exact link response and keeps the documented ID order", () => {
  assert.deepEqual(parseManagedLink(makeLink()), makeLink());
  assert.deepEqual(
    parseManagedLinks([
      makeLink({ id: 2, updatedAt: "2026-09-16T10:00:00" }),
      makeLink({ id: 1, updatedAt: "2026-09-17T10:00:00" }),
    ]).map((link) => link.id),
    [1, 2],
  );

  assert.throws(() => parseManagedLink(makeLink({ id: 0 })), /응답 형식/);
  assert.throws(() => parseManagedLink(makeLink({ updatedAt: "2026-99-99T10:00:00" })), /응답 형식/);
  assert.throws(() => parseManagedLinks({ content: [] }), /목록 응답 형식/);
  assert.deepEqual(parseManagedLink(makeLink({ category: "legacy" })), makeLink());
});

test("trims name and URL and sends only documented fields", () => {
  const result = validateLinkForm({
    name: "  한서대학교 홈페이지  ",
    url: "  https://www.hanseo.ac.kr/path?q=1  ",
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.payload, {
    name: "한서대학교 홈페이지",
    url: "https://www.hanseo.ac.kr/path?q=1",
  });
});

test("accepts only host-based http and https links and enforces documented lengths", () => {
  assert.equal(isValidExternalLinkUrl("https://hsmate.win"), true);
  assert.equal(isValidExternalLinkUrl("http://localhost:3000/path"), true);
  assert.equal(isValidExternalLinkUrl("javascript:alert(1)"), false);
  assert.equal(isValidExternalLinkUrl("file:///tmp/test"), false);
  assert.equal(isValidExternalLinkUrl("https://"), false);

  for (const form of [
    { name: " ", url: "https://example.com" },
    { name: "a".repeat(101), url: "https://example.com" },
    { name: ` ${"a".repeat(100)}`, url: "https://example.com" },
    { name: "학교", url: "ftp://example.com" },
    { name: "학교", url: ` https://example.com/${"a".repeat(2028)}` },
  ]) {
    assert.equal(validateLinkForm(form).ok, false);
  }
});

test("implements list, detail, create, replace, and permanent delete in the administrator page", async () => {
  const [page, shell] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(shellUrl, "utf8"),
  ]);

  assert.match(page, /apiFetch<unknown>\(ADMIN_LINKS_ENDPOINT/);
  assert.doesNotMatch(page, /\bLINKS_ENDPOINT\b|adminLinksListPath|categoryFilter|managed-link-category/);
  assert.match(page, /`\$\{ADMIN_LINKS_ENDPOINT\}\/\$\{linkId\}`/);
  assert.match(page, /method: "POST"/);
  assert.match(page, /`\$\{ADMIN_LINKS_ENDPOINT\}\/\$\{selected\.id\}`/);
  assert.match(page, /method: "PUT"/);
  assert.match(page, /method: "DELETE"/);
  assert.match(page, /<AdminLoginNotice returnTo="\/settings\/links">/);
  assert.match(page, /<UnsavedChangesDialog dirty=\{isDirty\}/);
  assert.match(page, /이 링크를 영구 삭제할까요/);
  assert.doesNotMatch(page, /dangerouslySetInnerHTML/);
  assert.match(shell, /href: "\/settings\/links",\s*label: "각종 링크"/);
});
