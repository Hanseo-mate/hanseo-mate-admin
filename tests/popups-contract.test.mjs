import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  MAX_POPUP_IMAGE_SIZE,
  POPUP_ENDPOINT,
  POPUP_IMAGE_ACCEPT,
  POPUP_IMAGE_ACTIONS,
  POPUP_NAVIGATION_TYPES,
  POPUP_NOTICE_TYPES,
  POPUP_STATUSES,
  POPUP_STATIC_NAVIGATION_TYPES,
  createPopupMultipartBody,
  emptyPopupForm,
  formFromPopup,
  isPopupLocalDateTime,
  normalizePopupDateTimeInput,
  parsePopup,
  parsePopupNavigation,
  parsePopups,
  popupDateTimeInputValue,
  popupUpdateFormWithOriginalDateTimes,
  sortPopups,
  updatePopupMultipartBody,
  validatePopupExternalUrl,
  validatePopupForm,
  validatePopupImage,
} from "../app/lib/popups.ts";

const root = new URL("../", import.meta.url);
const popupPageUrl = new URL("app/popups/manage/page.tsx", root);

function parseSource(path, source) {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function unwrap(node) {
  let current = node;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function propertyName(property, sourceFile) {
  if (!property.name) return "";
  if (
    ts.isIdentifier(property.name) ||
    ts.isStringLiteral(property.name) ||
    ts.isNumericLiteral(property.name)
  ) {
    return property.name.text;
  }
  return property.name.getText(sourceFile);
}

function objectProperties(object, sourceFile) {
  const properties = new Map();
  for (const property of object.properties) {
    if (ts.isPropertyAssignment(property)) {
      properties.set(propertyName(property, sourceFile), property.initializer);
    } else if (ts.isShorthandPropertyAssignment(property)) {
      properties.set(property.name.text, property.name);
    }
  }
  return properties;
}

function resolvePopupPath(node) {
  const current = unwrap(node);
  if (
    ts.isStringLiteral(current) ||
    ts.isNoSubstitutionTemplateLiteral(current)
  ) {
    return current.text;
  }
  if (ts.isIdentifier(current)) {
    return current.text === "POPUP_ENDPOINT" ? POPUP_ENDPOINT : "${value}";
  }
  if (ts.isTemplateExpression(current)) {
    let result = current.head.text;
    for (const span of current.templateSpans) {
      result += resolvePopupPath(span.expression);
      result += span.literal.text;
    }
    return result;
  }
  return "${value}";
}

function collectPopupRequests(sourceFile) {
  const requests = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "apiFetch" &&
      node.arguments[0]
    ) {
      const init = node.arguments[1] ? unwrap(node.arguments[1]) : null;
      let method = "GET";
      let body = null;
      let headers = null;
      if (init && ts.isObjectLiteralExpression(init)) {
        const properties = objectProperties(init, sourceFile);
        const methodNode = properties.get("method");
        if (
          methodNode &&
          (ts.isStringLiteral(methodNode) || ts.isNoSubstitutionTemplateLiteral(methodNode))
        ) {
          method = methodNode.text;
        }
        body = properties.get("body") ?? null;
        headers = properties.get("headers") ?? null;
      }
      requests.push({
        path: resolvePopupPath(node.arguments[0]),
        method,
        body,
        headers,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return requests;
}

function findNamedFunction(sourceFile, name) {
  let result;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) {
      result = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(result, `${name} 함수가 필요합니다.`);
  return result;
}

function visibleCopy(sourceFile) {
  const values = [];
  const visibleAttributes = new Set(["alt", "aria-label", "placeholder", "title"]);

  function visit(node) {
    if (ts.isJsxText(node)) {
      values.push(node.text);
    } else if (
      ts.isStringLiteral(node) &&
      ts.isJsxExpression(node.parent)
    ) {
      values.push(node.text);
    } else if (
      ts.isJsxAttribute(node) &&
      visibleAttributes.has(node.name.text) &&
      node.initializer &&
      ts.isStringLiteral(node.initializer)
    ) {
      values.push(node.initializer.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return values.join("\n");
}

function makePopup(overrides = {}) {
  return {
    id: 12,
    title: "축제 기간 안내",
    content: "자세한 내용을 공지사항에서 확인해 주세요.",
    imageUrl: "https://api.example.com/uploads/app-popups/uuid.png",
    navigation: {
      schemaVersion: 1,
      type: "NOTICE_DETAIL",
      params: {
        noticeId: 123,
        noticeType: "ACADEMIC",
      },
    },
    enabled: true,
    status: "ACTIVE",
    startsAt: "2026-09-03T00:00:00",
    endsAt: "2026-09-07T23:59:59",
    displayOrder: 1,
    revision: 4,
    createdAt: "2026-09-02T14:30:00",
    updatedAt: "2026-09-03T09:10:00",
    ...overrides,
  };
}

function makeForm(overrides = {}) {
  return {
    ...emptyPopupForm,
    title: "  축제 기간 안내  ",
    content: "  첫 줄\n둘째 줄 😊  ",
    startsAt: "2026-09-03T09:00",
    endsAt: "2026-09-07T23:59",
    displayOrder: "1",
    ...overrides,
  };
}

async function requestPart(body) {
  const part = body.get("request");
  assert.ok(part instanceof Blob);
  assert.equal(part.type, "application/json");
  return JSON.parse(await part.text());
}

test("exports the documented popup contract constants", () => {
  assert.equal(POPUP_ENDPOINT, "/api/admin/popups");
  assert.equal(MAX_POPUP_IMAGE_SIZE, 5 * 1024 * 1024);
  for (const extension of [".jpg", ".jpeg", ".png", ".gif"]) {
    assert.ok(POPUP_IMAGE_ACCEPT.includes(extension));
  }
  assert.deepEqual(POPUP_STATUSES, ["ACTIVE", "SCHEDULED", "EXPIRED", "INACTIVE"]);
  assert.deepEqual(POPUP_IMAGE_ACTIONS, ["KEEP", "REPLACE", "REMOVE"]);
  assert.deepEqual(POPUP_NOTICE_TYPES, [
    "STUDENT_COUNCIL",
    "ACADEMIC",
    "GENERAL",
    "SCHOLARSHIP",
    "GRADUATE",
  ]);
  assert.deepEqual(POPUP_NAVIGATION_TYPES, [
    ...POPUP_STATIC_NAVIGATION_TYPES,
    "NOTICE_DETAIL",
    "CLUB_DETAIL",
    "EXTERNAL_URL",
  ]);
});

test("parses every documented navigation shape and null", () => {
  assert.equal(parsePopupNavigation(null), null);

  for (const type of POPUP_STATIC_NAVIGATION_TYPES) {
    assert.deepEqual(parsePopupNavigation({ schemaVersion: 1, type }), {
      schemaVersion: 1,
      type,
    });
  }

  assert.deepEqual(parsePopupNavigation({
    schemaVersion: 1,
    type: "NOTICE_DETAIL",
    params: { noticeId: 123, noticeType: "ACADEMIC" },
  }), {
    schemaVersion: 1,
    type: "NOTICE_DETAIL",
    params: { noticeId: 123, noticeType: "ACADEMIC" },
  });
  assert.deepEqual(parsePopupNavigation({
    schemaVersion: 1,
    type: "CLUB_DETAIL",
    params: { clubId: 10 },
  }), {
    schemaVersion: 1,
    type: "CLUB_DETAIL",
    params: { clubId: 10 },
  });
  assert.deepEqual(parsePopupNavigation({
    schemaVersion: 1,
    type: "EXTERNAL_URL",
    params: { url: "https://www.hanseo.ac.kr/notice/123" },
  }), {
    schemaVersion: 1,
    type: "EXTERNAL_URL",
    params: { url: "https://www.hanseo.ac.kr/notice/123" },
  });
});

test("strictly rejects undocumented navigation fields and values", () => {
  const invalidNavigations = [
    undefined,
    {},
    { schemaVersion: 2, type: "HOME" },
    { schemaVersion: 1, type: "home" },
    { schemaVersion: 1, type: "HOME", params: {} },
    { schemaVersion: 1, type: "HOME", extra: true },
    { schemaVersion: 1, type: "NOTICE_DETAIL" },
    { schemaVersion: 1, type: "NOTICE_DETAIL", params: { noticeId: 1 } },
    { schemaVersion: 1, type: "NOTICE_DETAIL", params: { noticeId: 0, noticeType: "ACADEMIC" } },
    { schemaVersion: 1, type: "NOTICE_DETAIL", params: { noticeId: "1", noticeType: "ACADEMIC" } },
    { schemaVersion: 1, type: "NOTICE_DETAIL", params: { noticeId: 1.2, noticeType: "ACADEMIC" } },
    { schemaVersion: 1, type: "NOTICE_DETAIL", params: { noticeId: 1, noticeType: "EVENT" } },
    { schemaVersion: 1, type: "NOTICE_DETAIL", params: { noticeId: 1, noticeType: "GENERAL", extra: true } },
    { schemaVersion: 1, type: "CLUB_DETAIL", params: { clubId: 0 } },
    { schemaVersion: 1, type: "CLUB_DETAIL", params: { clubId: 1, extra: true } },
    { schemaVersion: 1, type: "EXTERNAL_URL", params: { url: "http://example.com" } },
    { schemaVersion: 1, type: "EXTERNAL_URL", params: { url: "myapp://notice/1" } },
    { schemaVersion: 1, type: "EXTERNAL_URL", params: { url: "https://user@example.com" } },
    { schemaVersion: 1, type: "EXTERNAL_URL", params: { url: "https://user:pass@example.com" } },
    { schemaVersion: 1, type: "EXTERNAL_URL", params: { url: "https://example.com", extra: true } },
    { schemaVersion: 1, type: "EXTERNAL_URL", params: { url: "https://example.com", extra: true } },
  ];

  for (const navigation of invalidNavigations) {
    assert.throws(() => parsePopupNavigation(navigation), { name: "UserFacingError" });
  }
});

test("validates absolute credential-free HTTPS external URLs up to 2,048 characters", () => {
  assert.equal(validatePopupExternalUrl("https://www.hanseo.ac.kr/path?q=1#section"), null);
  assert.match(validatePopupExternalUrl(""), /입력/);
  assert.match(validatePopupExternalUrl("http://example.com"), /HTTPS/);
  assert.match(validatePopupExternalUrl("https://user@example.com"), /HTTPS/);
  assert.match(validatePopupExternalUrl("https://example.com/has space"), /HTTPS/);
  assert.match(validatePopupExternalUrl(`https://example.com/${"a".repeat(2_049)}`), /2,048/);
});

test("accepts valid LocalDateTime values and rejects zones and impossible dates", () => {
  for (const value of [
    "2026-09-03T09:00:00",
    "2024-02-29T23:59:59.123456789",
    "0000-01-01T00:00:00",
  ]) {
    assert.equal(isPopupLocalDateTime(value), true, value);
  }
  for (const value of [
    "2026-09-03T09:00",
    "2026-09-03T09:00:00Z",
    "2026-09-03T09:00:00+09:00",
    "2026-02-29T09:00:00",
    "2026-13-01T09:00:00",
    "2026-01-01T24:00:00",
    "2026-01-01T00:60:00",
  ]) {
    assert.equal(isPopupLocalDateTime(value), false, value);
  }

  assert.equal(normalizePopupDateTimeInput("2026-09-03T09:00"), "2026-09-03T09:00:00");
  assert.equal(normalizePopupDateTimeInput("2026-09-03T09:00:45"), "2026-09-03T09:00:45");
  assert.equal(normalizePopupDateTimeInput("  "), null);
  assert.equal(popupDateTimeInputValue("2026-09-03T09:00:45.123456"), "2026-09-03T09:00:45");
  assert.equal(popupDateTimeInputValue(null), "");
  assert.throws(() => normalizePopupDateTimeInput("2026-02-29T09:00"), { name: "UserFacingError" });
});

test("parses and sanitizes the documented administrator popup response", () => {
  const expected = makePopup();
  const parsed = parsePopup({ ...expected, ignoredServerField: "ignored" });
  assert.deepEqual(parsed, expected);
  assert.deepEqual(Object.keys(parsed), [
    "id",
    "title",
    "content",
    "imageUrl",
    "navigation",
    "enabled",
    "status",
    "startsAt",
    "endsAt",
    "displayOrder",
    "revision",
    "createdAt",
    "updatedAt",
  ]);

  assert.deepEqual(parsePopup(makePopup({ imageUrl: null, navigation: null, startsAt: null, endsAt: null })),
    makePopup({ imageUrl: null, navigation: null, startsAt: null, endsAt: null }));
});

test("rejects malformed popup response fields and invalid date ranges", () => {
  for (const field of Object.keys(makePopup())) {
    const malformed = makePopup();
    delete malformed[field];
    assert.throws(() => parsePopup(malformed), { name: "UserFacingError" }, field);
  }

  const invalidValues = [
    { id: 0 },
    { title: " " },
    { title: "가".repeat(201) },
    { content: " " },
    { content: "가".repeat(100_001) },
    { imageUrl: 123 },
    { enabled: "true" },
    { status: "PUBLISHED" },
    { startsAt: "2026-09-03T00:00:00Z" },
    { endsAt: "2026-09-03" },
    { startsAt: "2026-09-07T00:00:00", endsAt: "2026-09-07T00:00:00" },
    { startsAt: "2026-09-08T00:00:00", endsAt: "2026-09-07T00:00:00" },
    { displayOrder: -1 },
    { displayOrder: 10_000 },
    { revision: 0 },
    { createdAt: "2026-02-29T00:00:00" },
  ];
  for (const overrides of invalidValues) {
    assert.throws(() => parsePopup(makePopup(overrides)), { name: "UserFacingError" });
  }
});

test("sorts the complete list by createdAt then id descending without mutation", () => {
  const input = [
    makePopup({ id: 99, createdAt: "2026-09-02T14:29:59" }),
    makePopup({ id: 12, createdAt: "2026-09-02T14:30:00" }),
    makePopup({ id: 13, createdAt: "2026-09-02T14:30:00" }),
  ];
  const originalIds = input.map((popup) => popup.id);

  assert.deepEqual(sortPopups(input).map((popup) => popup.id), [13, 12, 99]);
  assert.deepEqual(parsePopups(input).map((popup) => popup.id), [13, 12, 99]);
  assert.deepEqual(input.map((popup) => popup.id), originalIds);
  assert.deepEqual(parsePopups([]), []);
  assert.throws(() => parsePopups({ items: [] }), { name: "UserFacingError" });
});

test("normalizes a popup form into the exact create payload", () => {
  const result = validatePopupForm(makeForm());
  assert.deepEqual(result, {
    payload: {
      title: "축제 기간 안내",
      content: "  첫 줄\n둘째 줄 😊  ",
      navigation: null,
      enabled: true,
      startsAt: "2026-09-03T09:00:00",
      endsAt: "2026-09-07T23:59:00",
      displayOrder: 1,
    },
  });
  assert.equal(Object.hasOwn(result.payload, "imageAction"), false);
  assert.equal(Object.hasOwn(result.payload, "linkUrl"), false);
});

test("builds exact navigation payloads from editable string fields", () => {
  assert.deepEqual(validatePopupForm(makeForm({
    navigationType: "NOTICE_DETAIL",
    noticeId: "123",
    noticeType: "SCHOLARSHIP",
  })).payload.navigation, {
    schemaVersion: 1,
    type: "NOTICE_DETAIL",
    params: { noticeId: 123, noticeType: "SCHOLARSHIP" },
  });

  assert.deepEqual(validatePopupForm(makeForm({
    navigationType: "CLUB_DETAIL",
    clubId: "10",
  })).payload.navigation, {
    schemaVersion: 1,
    type: "CLUB_DETAIL",
    params: { clubId: 10 },
  });

  assert.deepEqual(validatePopupForm(makeForm({
    navigationType: "EXTERNAL_URL",
    externalUrl: "  https://www.hanseo.ac.kr  ",
  })).payload.navigation, {
    schemaVersion: 1,
    type: "EXTERNAL_URL",
    params: { url: "https://www.hanseo.ac.kr" },
  });

  for (const type of POPUP_STATIC_NAVIGATION_TYPES) {
    assert.deepEqual(validatePopupForm(makeForm({ navigationType: type })).payload.navigation, {
      schemaVersion: 1,
      type,
    });
  }
});

test("reports the first invalid editable field and enforces documented limits", () => {
  const invalidForms = [
    [makeForm({ title: " \n " }), "title"],
    [makeForm({ title: "가".repeat(201) }), "title"],
    [makeForm({ content: " \n " }), "content"],
    [makeForm({ content: "가".repeat(100_001) }), "content"],
    [makeForm({ navigationType: "NOTICE_DETAIL", noticeId: "0", noticeType: "GENERAL" }), "noticeId"],
    [makeForm({ navigationType: "NOTICE_DETAIL", noticeId: "1.5", noticeType: "GENERAL" }), "noticeId"],
    [makeForm({ navigationType: "NOTICE_DETAIL", noticeId: "1", noticeType: "" }), "noticeType"],
    [makeForm({ navigationType: "CLUB_DETAIL", clubId: "01" }), "clubId"],
    [makeForm({ navigationType: "EXTERNAL_URL", externalUrl: "http://example.com" }), "externalUrl"],
    [makeForm({ startsAt: "2026-02-29T09:00" }), "startsAt"],
    [makeForm({ endsAt: "2026-09-03T09:00Z" }), "endsAt"],
    [makeForm({ startsAt: "2026-09-03T09:00", endsAt: "2026-09-03T09:00" }), "endsAt"],
    [makeForm({ startsAt: "2026-09-03T09:01", endsAt: "2026-09-03T09:00" }), "endsAt"],
    [makeForm({ displayOrder: "" }), "displayOrder"],
    [makeForm({ displayOrder: "1.5" }), "displayOrder"],
    [makeForm({ displayOrder: "-1" }), "displayOrder"],
    [makeForm({ displayOrder: "10000" }), "displayOrder"],
  ];

  for (const [form, field] of invalidForms) {
    const result = validatePopupForm(form);
    assert.equal(result.payload, undefined);
    assert.equal(result.field, field);
    assert.equal(typeof result.message, "string");
  }
});

test("returns an update payload with a documented image action", () => {
  const result = validatePopupForm(makeForm({ imageAction: "REMOVE" }), "update");
  assert.equal(result.payload.imageAction, "REMOVE");
  assert.deepEqual(Object.keys(result.payload), [
    "title",
    "content",
    "navigation",
    "enabled",
    "startsAt",
    "endsAt",
    "displayOrder",
    "imageAction",
  ]);

  const invalid = validatePopupForm(makeForm({ imageAction: "DELETE" }), "update");
  assert.equal(invalid.field, "imageAction");
});

test("hydrates the editable form from null, static, and parameterized navigation", () => {
  const withoutNavigation = formFromPopup(makePopup({
    imageUrl: null,
    navigation: null,
    startsAt: null,
    endsAt: null,
    displayOrder: 0,
  }));
  assert.deepEqual(withoutNavigation, {
    ...emptyPopupForm,
    title: "축제 기간 안내",
    content: "자세한 내용을 공지사항에서 확인해 주세요.",
    enabled: true,
  });

  const noticeDetail = formFromPopup(makePopup());
  assert.equal(noticeDetail.navigationType, "NOTICE_DETAIL");
  assert.equal(noticeDetail.noticeId, "123");
  assert.equal(noticeDetail.noticeType, "ACADEMIC");
  assert.equal(noticeDetail.startsAt, "2026-09-03T00:00:00");
  assert.equal(noticeDetail.endsAt, "2026-09-07T23:59:59");
  assert.equal(noticeDetail.imageAction, "KEEP");

  const external = formFromPopup(makePopup({
    navigation: {
      schemaVersion: 1,
      type: "EXTERNAL_URL",
      params: { url: "https://www.hanseo.ac.kr" },
    },
  }));
  assert.equal(external.navigationType, "EXTERNAL_URL");
  assert.equal(external.externalUrl, "https://www.hanseo.ac.kr");
});

test("preserves unchanged subsecond display times before validating a full update", () => {
  const popup = makePopup({
    startsAt: "2026-09-03T10:00:00.1",
    endsAt: "2026-09-03T10:00:00.9",
  });
  const form = { ...formFromPopup(popup), title: "수정한 제목" };

  assert.equal(validatePopupForm(form, "update").field, "endsAt");

  const result = validatePopupForm(
    popupUpdateFormWithOriginalDateTimes(form, popup),
    "update",
  );
  assert.equal(result.payload.startsAt, popup.startsAt);
  assert.equal(result.payload.endsAt, popup.endsAt);
});

test("validates popup image type, extension, non-empty data, and 5MiB limit", () => {
  assert.equal(validatePopupImage(new File(["image"], "popup.jpg", { type: "image/jpeg" })), null);
  assert.equal(validatePopupImage(new File(["image"], "popup.jpeg", { type: "image/jpeg" })), null);
  assert.equal(validatePopupImage(new File(["image"], "popup.png", { type: "image/png" })), null);
  assert.equal(validatePopupImage(new File(["image"], "popup.gif", { type: "image/gif" })), null);
  assert.match(validatePopupImage(new File([], "popup.png", { type: "image/png" })), /내용이 없는/);
  assert.match(validatePopupImage(new File(["image"], "popup.webp", { type: "image/webp" })), /JPG/);
  assert.match(validatePopupImage(new File(["image"], "popup.txt", { type: "image/png" })), /JPG/);
  assert.match(validatePopupImage(new File(["image"], "popup.jpg", { type: "text/plain" })), /JPG/);
  assert.match(validatePopupImage(new File(
    [new Uint8Array(MAX_POPUP_IMAGE_SIZE + 1)],
    "popup.png",
    { type: "image/png" },
  )), /5MiB/);
});

test("creates multipart registration data with JSON request Blob and singular optional image", async () => {
  const request = validatePopupForm(makeForm()).payload;
  const image = new File(["image"], "popup.png", { type: "image/png" });
  const withImage = createPopupMultipartBody(request, image);

  assert.deepEqual([...withImage.keys()], ["request", "image"]);
  assert.equal(withImage.get("image").name, "popup.png");
  assert.deepEqual(await requestPart(withImage), request);

  const withoutImage = createPopupMultipartBody(request);
  assert.deepEqual([...withoutImage.keys()], ["request"]);
  assert.deepEqual(await requestPart(withoutImage), request);
  assert.equal(Object.hasOwn(await requestPart(withoutImage), "imageAction"), false);
  assert.equal(Object.hasOwn(await requestPart(withoutImage), "linkUrl"), false);
});

test("rejects omitted navigation and undocumented create request fields", () => {
  const request = validatePopupForm(makeForm()).payload;
  const missingNavigation = { ...request };
  delete missingNavigation.navigation;
  assert.throws(() => createPopupMultipartBody(missingNavigation), { name: "UserFacingError" });
  assert.throws(() => createPopupMultipartBody({ ...request, linkUrl: "https://example.com" }), {
    name: "UserFacingError",
  });
});

test("enforces PUT imageAction and emits the exact multipart update JSON", async () => {
  const keepRequest = validatePopupForm(makeForm({ imageAction: "KEEP" }), "update").payload;
  const replaceRequest = { ...keepRequest, imageAction: "REPLACE" };
  const removeRequest = { ...keepRequest, imageAction: "REMOVE" };
  const image = new File(["image"], "replacement.gif", { type: "image/gif" });

  const keepBody = updatePopupMultipartBody(keepRequest);
  assert.deepEqual([...keepBody.keys()], ["request"]);
  assert.deepEqual(await requestPart(keepBody), keepRequest);

  const replaceBody = updatePopupMultipartBody(replaceRequest, image);
  assert.deepEqual([...replaceBody.keys()], ["request", "image"]);
  assert.deepEqual(await requestPart(replaceBody), replaceRequest);

  const removeBody = updatePopupMultipartBody(removeRequest);
  assert.deepEqual([...removeBody.keys()], ["request"]);
  assert.deepEqual(await requestPart(removeBody), removeRequest);

  assert.throws(() => updatePopupMultipartBody(replaceRequest), /새 이미지를 선택/);
  assert.throws(() => updatePopupMultipartBody(keepRequest, image), /함께 보낼 수 없습니다/);
  assert.throws(() => updatePopupMultipartBody(removeRequest, image), /함께 보낼 수 없습니다/);
});

test("protects the popup screen and uses all six documented administrator endpoints", async () => {
  const source = await readFile(popupPageUrl, "utf8");
  const sourceFile = parseSource(popupPageUrl.pathname, source);
  const requests = collectPopupRequests(sourceFile);

  assert.match(source, /<AdminLoginNotice\b/);
  assert.match(source, /returnTo=["']\/popups\/manage["']/);
  assert.doesNotMatch(source, /(?<!api)fetch\s*\(/);
  assert.deepEqual(
    requests.map(({ method, path }) => [method, path]),
    [
      ["GET", POPUP_ENDPOINT],
      ["GET", `${POPUP_ENDPOINT}/\${value}`],
      ["POST", POPUP_ENDPOINT],
      ["PUT", `${POPUP_ENDPOINT}/\${value}`],
      ["PATCH", `${POPUP_ENDPOINT}/\${value}/enabled`],
      ["DELETE", `${POPUP_ENDPOINT}/\${value}`],
    ],
  );
  assert.ok(requests.every(({ path }) => !path.includes("?")));
  assert.match(source, /parsePopups\(response\)/);
  assert.match(source, /parsePopup\(await apiFetch<unknown>\(`\$\{POPUP_ENDPOINT\}\/\$\{summary\.id\}`/);

  const patchRequest = requests.find(({ method }) => method === "PATCH");
  assert.ok(patchRequest?.body);
  assert.match(patchRequest.body.getText(sourceFile), /JSON\.stringify\(\{\s*enabled:\s*nextEnabled\s*\}\)/);
  assert.match(patchRequest.headers?.getText(sourceFile) ?? "", /["']Content-Type["']\s*:\s*["']application\/json["']/);

  const deleteRequest = requests.find(({ method }) => method === "DELETE");
  assert.equal(deleteRequest?.body, null);
});

test("sends popup creates and updates as browser-managed multipart requests", async () => {
  const source = await readFile(popupPageUrl, "utf8");
  const sourceFile = parseSource(popupPageUrl.pathname, source);
  const multipartRequests = collectPopupRequests(sourceFile).filter(
    ({ method }) => method === "POST" || method === "PUT",
  );

  assert.deepEqual(multipartRequests.map(({ method }) => method), ["POST", "PUT"]);
  for (const request of multipartRequests) {
    assert.ok(request.body, `${request.method} 요청에는 FormData 본문이 필요합니다.`);
    assert.equal(request.body.getText(sourceFile), "body");
    assert.equal(
      request.headers,
      null,
      `${request.method} 요청은 브라우저가 multipart boundary를 만들도록 Content-Type을 생략해야 합니다.`,
    );
  }

  assert.match(source, /createPopupMultipartBody\(payload,\s*imageFile\s*\?\?\s*undefined\)/);
  assert.match(source, /updatePopupMultipartBody\(updatePayload,\s*imageFile\s*\?\?\s*undefined\)/);
  assert.doesNotMatch(
    source,
    /["']Content-Type["']\s*:\s*["']multipart\/form-data/i,
  );
  assert.doesNotMatch(
    source,
    /\.set\(\s*["']Content-Type["']\s*,\s*["']multipart\/form-data/i,
  );
});

test("offers every navigation target and the required parameter fields", async () => {
  const source = await readFile(popupPageUrl, "utf8");
  const optionsBlock = source.match(
    /const NAVIGATION_OPTIONS:[\s\S]*?=\s*\[([\s\S]*?)\n\];/,
  )?.[1];
  assert.ok(optionsBlock, "클릭 이동 선택 목록이 필요합니다.");

  const options = [...optionsBlock.matchAll(
    /\{\s*value:\s*"([^"]*)"\s*,\s*label:\s*"([^"]+)"\s*\}/g,
  )].map((match) => [match[1], match[2]]);
  assert.deepEqual(options, [
    ["", "클릭 이동 없음"],
    ["HOME", "홈 화면"],
    ["NOTICE_LIST", "공지사항 목록"],
    ["NOTICE_DETAIL", "공지사항 상세"],
    ["CLUB_LIST", "동아리 목록"],
    ["CLUB_DETAIL", "동아리 상세"],
    ["CAFETERIA", "학식 화면"],
    ["CALENDAR", "학사일정 화면"],
    ["TIMETABLE", "시간표 화면"],
    ["CAMPUS_MAP", "캠퍼스맵 화면"],
    ["SYSTEM_NOTICE_LIST", "시스템 공지 목록"],
    ["FESTIVAL", "축제 화면"],
    ["EXTERNAL_URL", "외부 웹페이지"],
  ]);

  assert.match(
    source,
    /form\.navigationType === "NOTICE_DETAIL"[\s\S]*?id="popup-notice-id"[\s\S]*?id="popup-notice-type"/,
  );
  assert.match(
    source,
    /form\.navigationType === "CLUB_DETAIL"[\s\S]*?id="popup-club-id"/,
  );
  assert.match(
    source,
    /form\.navigationType === "EXTERNAL_URL"[\s\S]*?id="popup-external-url"/,
  );
  assert.doesNotMatch(source, /\blinkUrl\b/);
});

test("makes KEEP, REPLACE, and REMOVE image actions understandable and reversible", async () => {
  const source = await readFile(popupPageUrl, "utf8");
  const sourceFile = parseSource(popupPageUrl.pathname, source);
  const chooseImage = findNamedFunction(sourceFile, "chooseImage").getText(sourceFile);
  const cancelSelectedImage = findNamedFunction(sourceFile, "cancelSelectedImage").getText(sourceFile);
  const removeImage = findNamedFunction(sourceFile, "removeImage").getText(sourceFile);
  const popupImage = findNamedFunction(sourceFile, "PopupImage").getText(sourceFile);

  assert.match(chooseImage, /validatePopupImage\(file\)/);
  assert.match(chooseImage, /updateField\(\s*"imageAction"\s*,\s*"REPLACE"\s*\)/);
  assert.match(cancelSelectedImage, /updateField\(\s*"imageAction"\s*,\s*"KEEP"\s*\)/);
  assert.match(removeImage, /updateField\(\s*"imageAction"\s*,\s*"REMOVE"\s*\)/);
  assert.match(source, /form\.imageAction !== "REMOVE"/);
  assert.match(source, /form\.imageAction === "REMOVE"/);
  for (const label of ["이미지 선택", "다른 이미지 선택", "선택 취소", "이미지 삭제", "삭제 취소"]) {
    assert.ok(source.includes(label), `${label} 동작을 화면에서 안내해야 합니다.`);
  }

  assert.match(popupImage, /useEffect\s*\(/);
  assert.match(popupImage, /URL\.createObjectURL\(file\)/);
  assert.match(popupImage, /URL\.revokeObjectURL\(/);
  assert.match(popupImage, /src=\{file\s*\?\s*undefined\s*:\s*imageUrl\s*\?\?\s*undefined\}/);
  assert.match(
    source,
    /onClick=\{\(event\)\s*=>\s*\{\s*event\.currentTarget\.value\s*=\s*"";?\s*\}\}/,
  );
});

test("keeps popup operations in staff language and renders content as text", async () => {
  const source = await readFile(popupPageUrl, "utf8");
  const copy = visibleCopy(parseSource(popupPageUrl.pathname, source));

  assert.match(source, /<UnsavedChangesDialog\s+dirty=\{isDirty\}/);

  for (const phrase of ["앱 시작 팝업", "팝업 등록", "변경 저장", "팝업 삭제", "활성", "비활성"]) {
    assert.ok(source.includes(phrase), `${phrase} 업무 문구가 필요합니다.`);
  }
  assert.doesNotMatch(
    copy,
    /\b(?:API|JWT|Bearer|FormData|multipart|JSON|HTTP)\b|Content-Type|ADMIN 권한|schemaVersion|imageAction|linkUrl|LocalDateTime/,
  );
  assert.doesNotMatch(copy, /(?:팝업|공지|동아리)\s*(?:ID|아이디)/i);
  assert.doesNotMatch(copy, /서버\s*(?:경로|응답)|데이터베이스/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML/);
  assert.match(source, /<textarea[\s\S]*?id="popup-content"/);
});
