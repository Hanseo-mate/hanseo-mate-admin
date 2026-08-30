import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  parseSystemNotice,
  parseSystemNotices,
  sortSystemNotices,
  validateSystemNoticeForm,
} from "../app/lib/system-notices.ts";
import {
  createApiHeaders,
  isAdminApiPath,
} from "../app/lib/request-headers.ts";

const root = new URL("../", import.meta.url);
const helperUrl = new URL("app/lib/system-notices.ts", root);
const pageUrl = new URL("app/system-notices/manage/page.tsx", root);
const endpoint = "/api/admin/system-notices";
const responseFields = {
  id: "number",
  title: "string",
  content: "string",
  createdAt: "string",
  updatedAt: "string",
};

function makeNotice(overrides = {}) {
  return {
    id: 12,
    title: "서비스 점검 안내",
    content: "8월 25일 02:00부터 03:00까지 서비스 점검을 진행합니다.",
    createdAt: "2026-08-21T14:30:00",
    updatedAt: "2026-08-21T14:30:00",
    ...overrides,
  };
}

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

function findObjectTypeFields(sourceFile, typeName) {
  let declaration;

  function visit(node) {
    if (
      (ts.isTypeAliasDeclaration(node) || ts.isInterfaceDeclaration(node)) &&
      node.name.text === typeName
    ) {
      declaration = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  assert.ok(declaration, `${typeName} 응답 타입이 필요합니다.`);
  const members = ts.isInterfaceDeclaration(declaration)
    ? declaration.members
    : ts.isTypeLiteralNode(declaration.type)
      ? declaration.type.members
      : null;
  assert.ok(members, `${typeName}은 필드가 명시된 객체 타입이어야 합니다.`);

  return Object.fromEntries(
    members
      .filter(ts.isPropertySignature)
      .map((member) => [
        propertyName(member, sourceFile),
        member.type?.getText(sourceFile) ?? "",
      ]),
  );
}

function collectStringConstants(sourceFile) {
  const constants = new Map();
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isStringLiteral(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      constants.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return constants;
}

function resolvePath(node, constants, sourceFile) {
  const current = unwrap(node);
  if (
    ts.isStringLiteral(current) ||
    ts.isNoSubstitutionTemplateLiteral(current)
  ) {
    return current.text;
  }
  if (ts.isIdentifier(current)) {
    return constants.get(current.text) ?? current.text;
  }
  if (ts.isPropertyAccessExpression(current)) return "${value}";
  if (ts.isTemplateExpression(current)) {
    let result = current.head.text;
    for (const span of current.templateSpans) {
      result += resolvePath(span.expression, constants, sourceFile);
      result += span.literal.text;
    }
    return result;
  }
  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return `${resolvePath(current.left, constants, sourceFile)}${resolvePath(current.right, constants, sourceFile)}`;
  }
  return current.getText(sourceFile);
}

function collectRequests(sourceFile) {
  const constants = collectStringConstants(sourceFile);
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
          (ts.isStringLiteral(methodNode) ||
            ts.isNoSubstitutionTemplateLiteral(methodNode))
        ) {
          method = methodNode.text;
        }
        body = properties.get("body") ?? null;
        headers = properties.get("headers") ?? null;
      }
      requests.push({
        path: resolvePath(node.arguments[0], constants, sourceFile),
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

function jsonStringifyArgument(node) {
  if (!node) return null;
  const current = unwrap(node);
  if (
    !ts.isCallExpression(current) ||
    !ts.isPropertyAccessExpression(current.expression) ||
    !ts.isIdentifier(current.expression.expression) ||
    current.expression.expression.text !== "JSON" ||
    current.expression.name.text !== "stringify" ||
    current.arguments.length !== 1
  ) {
    return null;
  }
  return current.arguments[0];
}

function hasJsonContentType(node, sourceFile) {
  const current = node ? unwrap(node) : null;
  if (!current || !ts.isObjectLiteralExpression(current)) return false;
  const value = objectProperties(current, sourceFile).get("Content-Type");
  return Boolean(
    value &&
    (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) &&
    value.text === "application/json",
  );
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

test("uses the exact documented system notice response and rejects malformed responses", async () => {
  const source = await readFile(helperUrl, "utf8");
  const sourceFile = parseSource(helperUrl.pathname, source);
  assert.deepEqual(findObjectTypeFields(sourceFile, "SystemNotice"), responseFields);

  const expected = makeNotice();
  const parsed = parseSystemNotice({ ...expected, ignoredServerField: "not documented" });
  assert.deepEqual(parsed, expected);
  assert.deepEqual(Object.keys(parsed), Object.keys(responseFields));

  for (const field of Object.keys(responseFields)) {
    const malformed = { ...expected };
    delete malformed[field];
    assert.throws(
      () => parseSystemNotice(malformed),
      /시스템 공지 정보를 확인할 수 없습니다/,
    );
  }
  assert.throws(
    () => parseSystemNotice(makeNotice({ id: 0 })),
    /시스템 공지 정보를 확인할 수 없습니다/,
  );
  assert.deepEqual(parseSystemNotices([]), []);
  assert.throws(
    () => parseSystemNotices({ items: [] }),
    /시스템 공지 목록을 확인할 수 없습니다/,
  );
});

test("sorts the complete list by creation time and then notice number, both descending", () => {
  const input = [
    makeNotice({ id: 99, createdAt: "2026-08-20T09:00:00" }),
    makeNotice({ id: 12, createdAt: "2026-08-21T14:30:00" }),
    makeNotice({ id: 13, createdAt: "2026-08-21T14:30:00" }),
  ];
  const originalOrder = input.map((notice) => notice.id);

  assert.deepEqual(sortSystemNotices(input).map((notice) => notice.id), [13, 12, 99]);
  assert.deepEqual(parseSystemNotices(input).map((notice) => notice.id), [13, 12, 99]);
  assert.deepEqual(input.map((notice) => notice.id), originalOrder);
});

test("trims only the title, preserves the original content, and enforces documented limits", () => {
  const content = "  첫 줄\n둘째 줄 😊  ";
  assert.deepEqual(
    validateSystemNoticeForm({
      title: "  서비스 점검 안내  ",
      content,
    }),
    {
      payload: {
        title: "서비스 점검 안내",
        content,
      },
    },
  );

  assert.equal(
    validateSystemNoticeForm({ title: " \n\t ", content: "본문" }).field,
    "title",
  );
  assert.equal(
    validateSystemNoticeForm({ title: "공지", content: " \n\t " }).field,
    "content",
  );

  assert.equal(
    validateSystemNoticeForm({
      title: `  ${"가".repeat(500)}  `,
      content: "본문",
    }).payload?.title.length,
    500,
  );
  assert.equal(
    validateSystemNoticeForm({ title: "가".repeat(501), content: "본문" }).field,
    "title",
  );
  assert.equal(
    validateSystemNoticeForm({ title: "공지", content: "가".repeat(100_000) }).payload?.content.length,
    100_000,
  );
  assert.equal(
    validateSystemNoticeForm({ title: "공지", content: "가".repeat(100_001) }).field,
    "content",
  );
});

test("protects the screen and implements the exact non-paginated JSON CRUD flow", async () => {
  const source = await readFile(pageUrl, "utf8");
  const sourceFile = parseSource(pageUrl.pathname, source);
  const requests = collectRequests(sourceFile);

  assert.match(source, /<AdminLoginNotice\b/);
  assert.match(source, /returnTo=["']\/system-notices\/manage["']/);
  assert.doesNotMatch(source, /(?<!api)fetch\s*\(/);

  assert.equal(
    requests.filter((request) => request.method === "GET").length,
    1,
    "명세에 없는 개별 조회나 페이지 조회 요청을 추가하면 안 됩니다.",
  );
  assert.ok(requests.some((request) => request.path === endpoint && request.method === "GET"));
  assert.ok(requests.some((request) => request.path === endpoint && request.method === "POST"));
  assert.ok(requests.some((request) => request.path === `${endpoint}/\${value}` && request.method === "PUT"));
  assert.ok(requests.some((request) => request.path === `${endpoint}/\${value}` && request.method === "DELETE"));
  assert.ok(requests.every((request) => !request.path.includes("?")));

  const mutations = requests.filter(
    (request) => request.method === "POST" || request.method === "PUT",
  );
  assert.deepEqual(mutations.map((request) => request.method).sort(), ["POST", "PUT"]);
  for (const request of mutations) {
    assert.equal(hasJsonContentType(request.headers, sourceFile), true);
    assert.ok(
      jsonStringifyArgument(request.body),
      `${request.method} 요청은 검증된 제목과 내용만 JSON으로 전송해야 합니다.`,
    );
  }

  const deletes = requests.filter((request) => request.method === "DELETE");
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].body, null);
  assert.match(source, /validateSystemNoticeForm/);
});

test("attaches administrator auth and keeps staff-facing copy free of implementation jargon", async () => {
  for (const path of [endpoint, `${endpoint}/7`]) {
    assert.equal(isAdminApiPath(path), true);
    const headers = createApiHeaders(
      path,
      { "Content-Type": "application/json" },
      "system-notice-test-token",
    );
    assert.equal(headers.get("Authorization"), "Bearer system-notice-test-token");
    assert.equal(headers.get("Accept"), "application/json");
    assert.equal(headers.get("Content-Type"), "application/json");
  }

  const source = await readFile(pageUrl, "utf8");
  const copy = visibleCopy(parseSource(pageUrl.pathname, source));
  assert.match(copy, /시스템 공지/);
  assert.match(copy, /등록/);
  assert.match(copy, /수정/);
  assert.match(copy, /삭제/);
  assert.doesNotMatch(
    copy,
    /\b(?:API|JWT|Bearer|JSON|HTTP)\b|Content-Type|ADMIN 권한|createdAt|updatedAt|페이지네이션/,
  );
  assert.doesNotMatch(copy, /시스템 공지\s*(?:ID|아이디)|작성자|조회수|첨부파일|이미지/i);
});
