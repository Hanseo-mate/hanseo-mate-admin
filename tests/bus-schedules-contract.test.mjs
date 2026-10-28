import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  BUS_SCHEDULE_GROUPS,
  BUS_SCHEDULE_SLOTS,
  createBusScheduleUploadBody,
  isValidBusSchedulePair,
  parseBusSchedule,
  parseBusSchedules,
  validateBusScheduleImage,
} from "../app/lib/bus-schedules.ts";
import {
  createApiHeaders,
  isAdminApiPath,
} from "../app/lib/request-headers.ts";

const helperUrl = new URL("../app/lib/bus-schedules.ts", import.meta.url);
const pageUrl = new URL("../app/bus-schedules/manage/page.tsx", import.meta.url);
const listEndpoint = "/api/bus-schedules";
const uploadEndpoint = "/api/admin/bus-schedules";

function makeSchedule(overrides = {}) {
  return {
    id: 1,
    mainCategory: "CITY_BUS",
    subCategory: "HANSEO_TO_SEOSAN",
    imageUrl: "http://localhost:8080/home/images/bus/HANSEO_TO_SEOSAN_20260823_234400.png",
    updatedAt: "2026-08-23T23:44:00",
    ...overrides,
  };
}

function parseSource(path, source) {
  return ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

function propertyName(property, sourceFile) {
  if (!property.name) return "";
  if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
    return property.name.text;
  }
  return property.name.getText(sourceFile);
}

function findResponseFields(sourceFile) {
  let declaration;
  function visit(node) {
    if (ts.isTypeAliasDeclaration(node) && node.name.text === "BusSchedule") {
      declaration = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(declaration && ts.isTypeLiteralNode(declaration.type));
  return Object.fromEntries(
    declaration.type.members
      .filter(ts.isPropertySignature)
      .map((member) => [propertyName(member, sourceFile), member.type?.getText(sourceFile)]),
  );
}

function collectRequests(sourceFile) {
  const constants = new Map();
  const requests = [];

  function visitConstants(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      constants.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, visitConstants);
  }
  visitConstants(sourceFile);

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "apiFetch" &&
      node.arguments[0]
    ) {
      const pathNode = node.arguments[0];
      const path = ts.isIdentifier(pathNode)
        ? constants.get(pathNode.text) ?? pathNode.text
        : ts.isStringLiteral(pathNode)
          ? pathNode.text
          : pathNode.getText(sourceFile);
      let method = "GET";
      let hasBody = false;
      const init = node.arguments[1];
      if (init && ts.isObjectLiteralExpression(init)) {
        for (const property of init.properties) {
          if (ts.isShorthandPropertyAssignment(property) && property.name.text === "body") {
            hasBody = true;
          }
          if (!ts.isPropertyAssignment(property)) continue;
          const name = propertyName(property, sourceFile);
          if (name === "method" && ts.isStringLiteral(property.initializer)) {
            method = property.initializer.text;
          }
          if (name === "body") hasBody = true;
        }
      }
      requests.push({ path, method, hasBody });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return requests;
}

function visibleCopy(sourceFile) {
  const values = [];
  const visibleAttributes = new Set(["alt", "aria-label", "placeholder", "title"]);
  function visit(node) {
    if (ts.isJsxText(node)) {
      values.push(node.text);
    } else if (ts.isStringLiteral(node) && ts.isJsxExpression(node.parent)) {
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

test("uses the exact five-field bus schedule response and validates server data", async () => {
  const source = await readFile(helperUrl, "utf8");
  const sourceFile = parseSource(helperUrl.pathname, source);
  assert.deepEqual(findResponseFields(sourceFile), {
    id: "number",
    mainCategory: "MainCategory",
    subCategory: "SubCategory",
    imageUrl: "string",
    updatedAt: "string",
  });

  const expected = makeSchedule();
  assert.deepEqual(parseBusSchedule({ ...expected, serverFilePath: "/private/path" }), expected);
  assert.deepEqual(Object.keys(parseBusSchedule(expected)), Object.keys(expected));
  assert.deepEqual(parseBusSchedules([]), []);
  assert.throws(() => parseBusSchedules({ items: [] }), /버스 시간표 목록/);

  for (const malformed of [
    makeSchedule({ id: 0 }),
    makeSchedule({ imageUrl: " " }),
    makeSchedule({ updatedAt: "2026-02-31T25:00:00" }),
    makeSchedule({ mainCategory: "UNKNOWN" }),
    makeSchedule({ subCategory: "UNKNOWN" }),
    makeSchedule({ mainCategory: "CITY_BUS", subCategory: "CAMPUS_SHUTTLE" }),
  ]) {
    assert.throws(() => parseBusSchedule(malformed), /버스 시간표 정보를 확인할 수 없습니다/);
  }
});

test("shows only the three city-bus routes while accepting existing API categories", () => {
  assert.deepEqual(
    BUS_SCHEDULE_GROUPS.map((group) => [
      group.mainCategory,
      group.slots.map((slot) => slot.subCategory),
    ]),
    [
      ["CITY_BUS", ["TAEAN_TO_AIRFIELD", "AIRFIELD_TO_TAEAN", "HANSEO_TO_SEOSAN"]],
    ],
  );
  assert.equal(BUS_SCHEDULE_SLOTS.length, 3);
  assert.equal(new Set(BUS_SCHEDULE_SLOTS.map((slot) => slot.subCategory)).size, 3);
  for (const slot of BUS_SCHEDULE_SLOTS) {
    assert.equal(isValidBusSchedulePair(slot.mainCategory, slot.subCategory), true);
  }
  assert.equal(isValidBusSchedulePair("COMMUTER_BUS", "COMMUTE_TO_SCHOOL"), true);
  assert.equal(isValidBusSchedulePair("SCHOOL_BUS", "CAMPUS_SHUTTLE"), true);
  assert.equal(isValidBusSchedulePair("CITY_BUS", "CAMPUS_SHUTTLE"), false);
});

test("accepts only non-empty JPG, PNG, and GIF files without inventing a size limit", () => {
  for (const file of [
    new File(["jpg"], "schedule.jpg", { type: "image/jpeg" }),
    new File(["jpeg"], "schedule.jpeg", { type: "image/jpeg" }),
    new File(["png"], "schedule.png", { type: "image/png" }),
    new File(["gif"], "schedule.gif", { type: "image/gif" }),
    new File(["png"], "schedule.png", { type: "" }),
    new File([new Uint8Array(6 * 1024 * 1024)], "large.png", { type: "image/png" }),
  ]) {
    assert.equal(validateBusScheduleImage(file), null);
  }

  assert.match(validateBusScheduleImage(new File([], "empty.png", { type: "image/png" })) ?? "", /내용이 없는/);
  assert.match(validateBusScheduleImage(new File(["webp"], "schedule.webp", { type: "image/webp" })) ?? "", /JPG/);
  assert.match(validateBusScheduleImage(new File(["fake"], "schedule.png", { type: "text/plain" })) ?? "", /JPG/);
});

test("builds the exact browser-managed upload form", () => {
  const image = new File(["image"], "schedule.png", { type: "image/png" });
  const body = createBusScheduleUploadBody({
    image,
    mainCategory: "CITY_BUS",
    subCategory: "HANSEO_TO_SEOSAN",
  });
  assert.deepEqual([...new Set(body.keys())].sort(), ["image", "mainCategory", "subCategory"].sort());
  assert.equal(body.get("mainCategory"), "CITY_BUS");
  assert.equal(body.get("subCategory"), "HANSEO_TO_SEOSAN");
  assert.ok(body.get("image") instanceof File);
  assert.throws(
    () => createBusScheduleUploadBody({
      image,
      mainCategory: "CITY_BUS",
      subCategory: "CAMPUS_SHUTTLE",
    }),
    /버스 종류와 운행 구간/,
  );
});

test("protects the page and uses only the documented list and upsert requests", async () => {
  const source = await readFile(pageUrl, "utf8");
  const sourceFile = parseSource(pageUrl.pathname, source);
  const requests = collectRequests(sourceFile);

  assert.match(source, /<AdminLoginNotice\b/);
  assert.match(source, /returnTo=["']\/bus-schedules\/manage["']/);
  assert.doesNotMatch(source, /(?<!api)fetch\s*\(/);
  assert.deepEqual(requests, [
    { path: listEndpoint, method: "GET", hasBody: false },
    { path: uploadEndpoint, method: "POST", hasBody: true },
  ]);
  assert.doesNotMatch(source, /method:\s*["'](?:PUT|DELETE|PATCH)["']/);
  assert.doesNotMatch(source, /["']Content-Type["']\s*:/i);
  assert.doesNotMatch(source, /multipart\/form-data|JSON\.stringify/);
  assert.match(source, /createBusScheduleUploadBody/);
});

test("creates and cleans up previews and keeps the staff-facing workflow easy", async () => {
  const source = await readFile(pageUrl, "utf8");
  const sourceFile = parseSource(pageUrl.pathname, source);
  const copy = visibleCopy(sourceFile);

  assert.match(source, /URL\.createObjectURL\(file\)/);
  assert.match(source, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(source, /src=\{file\s*\?\s*undefined\s*:\s*imageUrl\}/);
  assert.match(source, /event\.currentTarget\.value\s*=\s*["']["']/);
  assert.match(source, /<UnsavedChangesDialog\s+dirty=\{hasPendingFiles\}/);

  for (const phrase of [
    "버스 시간표",
    "버스 종류",
    "운행 구간",
    "시간표 사진",
    "시간표 등록",
    "시간표 교체",
    "마지막 변경",
    "등록된 시간표가 없습니다",
  ]) {
    assert.match(source, new RegExp(phrase));
  }
  assert.doesNotMatch(
    copy,
    /\b(?:API|JWT|Bearer|FormData|multipart|Enum|DB)\b|Content-Type|mainCategory|subCategory|대분류|소분류|레코드|서버 경로|물리 파일|시간표\s*(?:ID|아이디)/i,
  );
});

test("attaches administrator auth only to the upload request", () => {
  assert.equal(isAdminApiPath(uploadEndpoint), true);
  assert.equal(isAdminApiPath(listEndpoint), false);

  const adminHeaders = createApiHeaders(uploadEndpoint, undefined, "bus-schedule-test-token");
  assert.equal(adminHeaders.get("Authorization"), "Bearer bus-schedule-test-token");
  assert.equal(adminHeaders.get("Accept"), "application/json");
  assert.equal(adminHeaders.has("Content-Type"), false);

  const publicHeaders = createApiHeaders(listEndpoint, undefined, "bus-schedule-test-token");
  assert.equal(publicHeaders.has("Authorization"), false);
  assert.equal(publicHeaders.get("Accept"), "application/json");
});
