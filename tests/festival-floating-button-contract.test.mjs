import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  FESTIVAL_FLOATING_BUTTON_ENDPOINT,
  createFestivalFloatingButtonPatchBody,
  parseFestivalFloatingButtonSetting,
} from "../app/lib/festival-floating-button.ts";
import {
  createApiHeaders,
  isAdminApiPath,
} from "../app/lib/request-headers.ts";

const root = new URL("../", import.meta.url);
const pageUrl = new URL("app/settings/festival-floating-button/page.tsx", root);
const appShellUrl = new URL("app/components/AppShell.tsx", root);

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

function resolvePath(node) {
  const current = unwrap(node);
  if (
    ts.isStringLiteral(current) ||
    ts.isNoSubstitutionTemplateLiteral(current)
  ) {
    return current.text;
  }
  if (
    ts.isIdentifier(current) &&
    current.text === "FESTIVAL_FLOATING_BUTTON_ENDPOINT"
  ) {
    return FESTIVAL_FLOATING_BUTTON_ENDPOINT;
  }
  return current.getText();
}

function collectApiRequests(sourceFile) {
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
        node,
        path: resolvePath(node.arguments[0]),
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

function isFunctionLike(node) {
  return ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node);
}

function containingFunction(node) {
  let current = node.parent;
  while (current && !isFunctionLike(current)) current = current.parent;
  assert.ok(current, "PATCH 요청을 실행하는 함수가 필요합니다.");
  return current;
}

function collectCalls(node, predicate) {
  const calls = [];
  function visit(current) {
    if (ts.isCallExpression(current) && predicate(current)) calls.push(current);
    ts.forEachChild(current, visit);
  }
  visit(node);
  return calls;
}

function findCatchClauses(node) {
  const clauses = [];
  function visit(current) {
    if (ts.isCatchClause(current)) clauses.push(current);
    ts.forEachChild(current, visit);
  }
  visit(node);
  return clauses;
}

function visibleCopy(sourceFile) {
  const values = [];
  const visibleAttributes = new Set([
    "alt",
    "aria-label",
    "placeholder",
    "title",
  ]);

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
  return values.join("\n").replaceAll(/\s+/g, " ").trim();
}

function findSwitchElement(sourceFile) {
  const matches = [];

  function hasAttribute(node, name, value) {
    return node.attributes.properties.some((property) => {
      if (!ts.isJsxAttribute(property) || property.name.text !== name) return false;
      if (value === undefined) return true;
      return property.initializer &&
        ts.isStringLiteral(property.initializer) &&
        property.initializer.text === value;
    });
  }

  function visit(node) {
    if (
      (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
      (hasAttribute(node, "role", "switch") || hasAttribute(node, "type", "checkbox"))
    ) {
      matches.push(node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.equal(matches.length, 1, "노출 상태를 제어하는 스위치 하나가 필요합니다.");
  return matches[0];
}

function resolveAttributeExpression(sourceFile, element, attributeName) {
  const attribute = element.attributes.properties.find(
    (property) =>
      ts.isJsxAttribute(property) && property.name.text === attributeName,
  );
  assert.ok(
    attribute &&
      ts.isJsxAttribute(attribute) &&
      attribute.initializer &&
      ts.isJsxExpression(attribute.initializer) &&
      attribute.initializer.expression,
    `${attributeName} 조건이 필요합니다.`,
  );

  const expression = unwrap(attribute.initializer.expression);
  if (!ts.isIdentifier(expression)) return expression.getText(sourceFile);

  let initializer;
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === expression.text &&
      node.initializer
    ) {
      initializer = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(initializer, `${expression.text} 조건의 정의를 확인할 수 없습니다.`);
  return initializer.getText(sourceFile);
}

test("exports the exact festival floating-button endpoint and validates response shape", () => {
  assert.equal(
    FESTIVAL_FLOATING_BUTTON_ENDPOINT,
    "/api/admin/settings/festival-floating-button",
  );

  assert.deepEqual(
    parseFestivalFloatingButtonSetting({
      visible: true,
      updatedAt: "2026-09-05T12:34:56",
    }),
    { visible: true, updatedAt: "2026-09-05T12:34:56" },
  );
  assert.deepEqual(
    parseFestivalFloatingButtonSetting({ visible: false, updatedAt: null }),
    { visible: false, updatedAt: null },
  );

  for (const invalid of [
    null,
    [],
    {},
    { visible: "true", updatedAt: null },
    { visible: true },
    { visible: true, updatedAt: 123 },
    { visible: true, updatedAt: "2026-02-30T12:00:00" },
  ]) {
    assert.throws(
      () => parseFestivalFloatingButtonSetting(invalid),
      /노출|응답|정보|확인/,
      `잘못된 응답을 거부해야 합니다: ${JSON.stringify(invalid)}`,
    );
  }
});

test("creates an exact boolean-only PATCH document", () => {
  assert.deepEqual(createFestivalFloatingButtonPatchBody(true), { visible: true });
  assert.deepEqual(createFestivalFloatingButtonPatchBody(false), { visible: false });
  assert.deepEqual(
    Object.keys(createFestivalFloatingButtonPatchBody(true)),
    ["visible"],
  );
});

test("classifies the setting endpoint as administrator-only and adds its bearer token", () => {
  assert.equal(isAdminApiPath(FESTIVAL_FLOATING_BUTTON_ENDPOINT), true);
  const headers = createApiHeaders(
    FESTIVAL_FLOATING_BUTTON_ENDPOINT,
    undefined,
    "festival-admin-token",
  );
  assert.equal(headers.get("Authorization"), "Bearer festival-admin-token");
});

test("protects the page and uses only exact GET and PATCH JSON requests", async () => {
  const source = await readFile(pageUrl, "utf8");
  const sourceFile = parseSource(pageUrl.pathname, source);
  const requests = collectApiRequests(sourceFile);

  assert.match(source, /<AdminLoginNotice\b/);
  assert.match(
    source,
    /returnTo=["']\/settings\/festival-floating-button["']/,
  );
  assert.equal(requests.length, 2, "설정 조회와 변경 외 API 요청을 만들지 않습니다.");
  assert.deepEqual(
    requests.map(({ path, method }) => ({ path, method })),
    [
      { path: FESTIVAL_FLOATING_BUTTON_ENDPOINT, method: "GET" },
      { path: FESTIVAL_FLOATING_BUTTON_ENDPOINT, method: "PATCH" },
    ],
  );

  const getRequest = requests[0];
  assert.equal(getRequest.body, null, "GET 요청에는 본문을 보내지 않습니다.");

  const patchRequest = requests[1];
  assert.ok(patchRequest.body, "PATCH 요청에 JSON 본문이 필요합니다.");
  assert.ok(patchRequest.headers, "PATCH 요청에 JSON Content-Type이 필요합니다.");
  assert.match(
    patchRequest.headers.getText(sourceFile),
    /["']Content-Type["']\s*:\s*["']application\/json["']/i,
  );
  assert.match(
    patchRequest.body.getText(sourceFile),
    /^JSON\.stringify\(\s*createFestivalFloatingButtonPatchBody\(/,
    "PATCH 본문은 boolean-only 계약 객체를 JSON 직렬화해야 합니다.",
  );
});

test("loads safely, exposes retry, and disables the switch while loading or saving", async () => {
  const source = await readFile(pageUrl, "utf8");
  const sourceFile = parseSource(pageUrl.pathname, source);
  const switchElement = findSwitchElement(sourceFile);
  const switchSource = switchElement.getText(sourceFile);
  const disabledExpression = resolveAttributeExpression(
    sourceFile,
    switchElement,
    "disabled",
  );
  const copy = visibleCopy(sourceFile);

  assert.match(
    disabledExpression,
    /(?:load|setting)/i,
    "초기 조회 전과 저장 중에는 스위치를 비활성화해야 합니다.",
  );
  assert.match(disabledExpression, /(?:saving|pending|busy)/i);
  assert.match(
    switchSource,
    /(?:onChange|onClick)=\{/,
    "스위치 조작 즉시 PATCH를 실행해야 합니다.",
  );
  assert.match(copy, /불러오|조회|확인/,
    "초기 조회 상태나 조회 오류를 사용자에게 알려야 합니다.");

  const retryCount = (copy.match(/다시 (?:시도|저장)/g) ?? []).length;
  assert.ok(
    retryCount >= 2,
    "초기 조회 오류와 저장 오류 모두 다시 시도할 수 있어야 합니다.",
  );
  assert.doesNotMatch(source, /<form\b/i);
  assert.doesNotMatch(source, /type=["']submit["']/i);
  assert.doesNotMatch(copy, /변경 내용 저장|저장 버튼/);
});

test("commits only the validated server response and preserves prior state on failure", async () => {
  const source = await readFile(pageUrl, "utf8");
  const sourceFile = parseSource(pageUrl.pathname, source);
  const patchRequest = collectApiRequests(sourceFile).find(
    (request) => request.method === "PATCH",
  );
  assert.ok(patchRequest, "PATCH 요청이 필요합니다.");

  const handler = containingFunction(patchRequest.node);
  const handlerText = handler.getText(sourceFile);
  const requestPosition = patchRequest.node.getStart(sourceFile);
  const settingCommits = collectCalls(handler, (call) =>
    ts.isIdentifier(call.expression) && call.expression.text === "setSetting"
  );

  assert.ok(settingCommits.length >= 1, "서버가 반환한 최종 설정을 화면에 반영해야 합니다.");
  assert.equal(
    settingCommits.some((call) => call.getStart(sourceFile) < requestPosition),
    false,
    "PATCH 성공 전에는 화면 상태를 낙관적으로 확정하지 않습니다.",
  );
  assert.ok(
    settingCommits.some((call) =>
      call.getStart(sourceFile) > requestPosition &&
      call.arguments[0] &&
      ts.isIdentifier(unwrap(call.arguments[0]))
    ),
    "PATCH 응답을 검증해 얻은 변수를 최종 화면 상태로 사용해야 합니다.",
  );
  assert.match(handlerText, /parseFestivalFloatingButtonSetting\s*\(/);

  const catches = findCatchClauses(handler);
  assert.ok(catches.length >= 1, "PATCH 실패를 처리해야 합니다.");
  for (const catchClause of catches) {
    assert.doesNotMatch(
      catchClause.getText(sourceFile),
      /\bsetSetting\s*\(/,
      "PATCH 실패 시 서버에서 확인된 이전 상태를 유지해야 합니다.",
    );
  }
});

test("shows success feedback and the exact scope explanation", async () => {
  const source = await readFile(pageUrl, "utf8");
  const sourceFile = parseSource(pageUrl.pathname, source);
  const copy = visibleCopy(sourceFile);

  assert.ok(
    copy.includes("앱 홈의 대동제 바로가기 버튼만 제어합니다"),
    "제어 범위를 설명하는 문구를 그대로 노출해야 합니다.",
  );
  assert.match(
    source,
    /(?:저장|반영)[^.\n]*(?:완료|했습니다|되었습니다)/,
    "PATCH 성공 결과를 사용자에게 알려야 합니다.",
  );
  assert.match(
    source,
    /(?:role=["']status["']|aria-live=["']polite["'])/,
    "성공 피드백은 보조 기술에도 전달되어야 합니다.",
  );
});

test("does not invent image, upload, schedule, URL, or path editing", async () => {
  const [pageSource, libSource] = await Promise.all([
    readFile(pageUrl, "utf8"),
    readFile(new URL("app/lib/festival-floating-button.ts", root), "utf8"),
  ]);
  const pageFile = parseSource(pageUrl.pathname, pageSource);
  const copy = visibleCopy(pageFile);
  const combined = `${pageSource}\n${libSource}`;

  assert.doesNotMatch(combined, /\bFormData\b|\.append\s*\(/);
  assert.doesNotMatch(pageSource, /type=["']file["']/i);
  assert.doesNotMatch(pageSource, /type=["'](?:text|url|date|datetime-local|time)["']/i);
  assert.doesNotMatch(pageSource, /<(?:textarea|select|img)\b/i);
  assert.doesNotMatch(copy, /이미지|사진|업로드|예약|노출 기간|링크 주소|URL|경로 (?:입력|편집)|딥링크/i);
});

test("adds the administrator navigation entry and page metadata", async () => {
  const source = await readFile(appShellUrl, "utf8");
  assert.match(
    source,
    /href:\s*["']\/settings\/festival-floating-button["']/,
  );
  assert.match(
    source,
    /href:\s*["']\/settings\/festival-floating-button["'][\s\S]{0,160}label:\s*["'][^"']*(?:축제|대동제)[^"']*["']/,
  );
  assert.match(
    source,
    /["']\/settings\/festival-floating-button["']\s*:\s*\{[\s\S]{0,360}title:/,
  );
});
