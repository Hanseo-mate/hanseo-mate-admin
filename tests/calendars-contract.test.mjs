import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  createApiHeaders,
  isAdminApiPath,
} from "../app/lib/request-headers.ts";

const pageUrl = new URL("../app/calendars/manage/page.tsx", import.meta.url);
const endpoint = "/api/admin/calendars";
const unifiedEndpoint = "/api/admin/calendars/all";
const requestFields = ["startDate", "endDate", "title"];
const responseFields = ["id", ...requestFields];
const removedFields = ["content", "createdAt", "updatedAt"];

async function readCalendarPage() {
  return readFile(pageUrl, "utf8");
}

function parsePage(source) {
  return ts.createSourceFile(
    pageUrl.pathname,
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

function findFunction(sourceFile, name) {
  let found;
  function visit(node) {
    if (
      !found &&
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name
    ) {
      found = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(found, `${name} 함수가 필요합니다.`);
  return found;
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
    let path = current.head.text;
    for (const span of current.templateSpans) {
      path += resolvePath(span.expression, constants, sourceFile);
      path += span.literal.text;
    }
    return path;
  }
  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return `${resolvePath(current.left, constants, sourceFile)}${resolvePath(current.right, constants, sourceFile)}`;
  }
  return current.getText(sourceFile);
}

function collectCalendarRequests(sourceFile) {
  const constants = collectStringConstants(sourceFile);
  const requests = [];

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "apiFetch" &&
      node.arguments[0]
    ) {
      const init = node.arguments[1];
      let method = "GET";
      let body;
      let headers;

      if (init && ts.isObjectLiteralExpression(init)) {
        const options = objectProperties(init, sourceFile);
        const methodNode = options.get("method");
        if (
          methodNode &&
          (ts.isStringLiteral(methodNode) ||
            ts.isNoSubstitutionTemplateLiteral(methodNode))
        ) {
          method = methodNode.text;
        }
        body = options.get("body");
        headers = options.get("headers");
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

function isJsonStringify(node) {
  if (!node) return false;
  const current = unwrap(node);
  return (
    ts.isCallExpression(current) &&
    ts.isPropertyAccessExpression(current.expression) &&
    ts.isIdentifier(current.expression.expression) &&
    current.expression.expression.text === "JSON" &&
    current.expression.name.text === "stringify" &&
    current.arguments.length === 1
  );
}

function jsonArgument(node) {
  assert.ok(isJsonStringify(node), "요청 본문은 JSON.stringify로 만들어야 합니다.");
  return unwrap(node).arguments[0];
}

function hasJsonContentType(node, sourceFile) {
  if (!node || !ts.isObjectLiteralExpression(unwrap(node))) return false;
  const headers = objectProperties(unwrap(node), sourceFile);
  const contentType = headers.get("Content-Type");
  return Boolean(
    contentType &&
    ts.isStringLiteral(contentType) &&
    contentType.text === "application/json",
  );
}

function findCalendarResponseShapes(sourceFile) {
  const shapes = [];

  function record(members) {
    const fields = members
      .filter(ts.isPropertySignature)
      .map((member) => propertyName(member, sourceFile));
    if (responseFields.every((field) => fields.includes(field))) shapes.push(fields);
  }

  function visit(node) {
    if (ts.isInterfaceDeclaration(node)) {
      record(node.members);
    } else if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
      record(node.type.members);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return shapes;
}

function findPayloadObject(validateForm, sourceFile) {
  let payload;
  function visit(node) {
    if (ts.isObjectLiteralExpression(node)) {
      const properties = objectProperties(node, sourceFile);
      const candidate = properties.get("payload");
      if (candidate && ts.isObjectLiteralExpression(unwrap(candidate))) {
        payload = unwrap(candidate);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(validateForm);
  assert.ok(payload, "검증을 마친 세 필드의 저장 데이터가 필요합니다.");
  return payload;
}

function isFormField(node, field) {
  const current = unwrap(node);
  return (
    ts.isPropertyAccessExpression(current) &&
    ts.isIdentifier(current.expression) &&
    current.expression.text === "form" &&
    current.name.text === field
  );
}

function isTrimCallForFormField(node, field) {
  const current = unwrap(node);
  return (
    ts.isCallExpression(current) &&
    ts.isPropertyAccessExpression(current.expression) &&
    current.expression.name.text === "trim" &&
    isFormField(current.expression.expression, field)
  );
}

function subtreeContains(node, predicate) {
  let found = false;
  function visit(current) {
    if (found) return;
    if (predicate(current)) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function findSortComparator(sortFunction) {
  let comparator;
  function visit(node) {
    if (
      !comparator &&
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "sort" &&
      node.arguments[0] &&
      (ts.isArrowFunction(node.arguments[0]) || ts.isFunctionExpression(node.arguments[0]))
    ) {
      comparator = node.arguments[0];
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sortFunction);
  assert.ok(comparator, "일정 정렬 기준이 필요합니다.");
  return comparator;
}

function comparatorExpression(comparator) {
  if (!ts.isBlock(comparator.body)) return unwrap(comparator.body);
  const returnStatement = comparator.body.statements.find(ts.isReturnStatement);
  assert.ok(returnStatement?.expression, "정렬 함수가 비교 결과를 반환해야 합니다.");
  return unwrap(returnStatement.expression);
}

function flattenLogicalOr(node) {
  const current = unwrap(node);
  if (
    ts.isBinaryExpression(current) &&
    current.operatorToken.kind === ts.SyntaxKind.BarBarToken
  ) {
    return [...flattenLogicalOr(current.left), ...flattenLogicalOr(current.right)];
  }
  return [current];
}

function isLocaleCompareTerm(node, firstParameter, secondParameter, field) {
  const current = unwrap(node);
  if (
    !ts.isCallExpression(current) ||
    !ts.isPropertyAccessExpression(current.expression) ||
    current.expression.name.text !== "localeCompare" ||
    current.arguments.length !== 1
  ) {
    return false;
  }

  const receiver = unwrap(current.expression.expression);
  const argument = unwrap(current.arguments[0]);
  return (
    ts.isPropertyAccessExpression(receiver) &&
    ts.isIdentifier(receiver.expression) &&
    receiver.expression.text === firstParameter &&
    receiver.name.text === field &&
    ts.isPropertyAccessExpression(argument) &&
    ts.isIdentifier(argument.expression) &&
    argument.expression.text === secondParameter &&
    argument.name.text === field
  );
}

function isNumericFieldDifference(node, firstParameter, secondParameter, field) {
  const current = unwrap(node);
  if (
    !ts.isBinaryExpression(current) ||
    current.operatorToken.kind !== ts.SyntaxKind.MinusToken
  ) {
    return false;
  }
  const left = unwrap(current.left);
  const right = unwrap(current.right);
  return (
    ts.isPropertyAccessExpression(left) &&
    ts.isIdentifier(left.expression) &&
    left.expression.text === firstParameter &&
    left.name.text === field &&
    ts.isPropertyAccessExpression(right) &&
    ts.isIdentifier(right.expression) &&
    right.expression.text === secondParameter &&
    right.name.text === field
  );
}

function collectCopy(sourceFile) {
  const copy = [];
  function visit(node) {
    if (ts.isJsxText(node)) {
      copy.push(node.text);
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      copy.push(node.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return copy.join("\n");
}

function collectRemovedFieldReferences(sourceFile) {
  const references = [];

  function record(field, node) {
    if (removedFields.includes(field)) {
      references.push({ field, text: node.getText(sourceFile) });
    }
  }

  function visit(node) {
    if (
      (ts.isPropertySignature(node) ||
        ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node) ||
        ts.isMethodSignature(node)) &&
      node.name
    ) {
      record(propertyName(node, sourceFile), node);
    } else if (ts.isPropertyAccessExpression(node)) {
      record(node.name.text, node);
    } else if (
      ts.isElementAccessExpression(node) &&
      node.argumentExpression &&
      ts.isStringLiteral(node.argumentExpression)
    ) {
      record(node.argumentExpression.text, node);
    } else if (
      (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) &&
      removedFields.includes(node.text)
    ) {
      record(node.text, node);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return references;
}

function collectJsxElementNames(sourceFile) {
  const names = [];
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      names.push(node.tagName.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

test("protects the student council calendar screen and implements the complete CRUD flow", async () => {
  const source = await readCalendarPage();
  const sourceFile = parsePage(source);
  const requests = collectCalendarRequests(sourceFile);

  assert.match(source, /<AdminLoginNotice\b/);
  assert.match(source, /returnTo=["']\/calendars\/manage["']/);
  assert.ok(requests.some((request) => request.path === unifiedEndpoint && request.method === "GET"));
  assert.ok(requests.some((request) => request.path === endpoint && request.method === "POST"));
  assert.ok(requests.some((request) => request.path === `${endpoint}/\${value}` && request.method === "PUT"));
  assert.ok(requests.some((request) => request.path === `${endpoint}/\${value}` && request.method === "DELETE"));
});

test("uses the unified read-only endpoint for school and student council calendar display", async () => {
  const source = await readCalendarPage();
  const sourceFile = parsePage(source);
  const requests = collectCalendarRequests(sourceFile);
  const unifiedRequests = requests.filter((request) => request.path === unifiedEndpoint);

  assert.deepEqual(unifiedRequests.map((request) => request.method), ["GET"]);
  assert.match(source, /type CalendarType\s*=\s*["']SCHOOL["']\s*\|\s*["']STUDENT_COUNCIL["']/);
  assert.match(source, /calendarType\s*!==\s*["']SCHOOL["']/);
  assert.match(source, /calendarType\s*!==\s*["']STUDENT_COUNCIL["']/);
  assert.match(source, /`\$\{item\.calendarType\}-\$\{item\.id\}`/);
  assert.match(source, /calendarType\s*===\s*["']STUDENT_COUNCIL["']/);
  assert.match(source, /조회 전용/);
});

test("uses the exact calendar response and full JSON request shapes from the specification", async () => {
  const sourceFile = parsePage(await readCalendarPage());
  const shapes = findCalendarResponseShapes(sourceFile);
  assert.ok(shapes.length >= 1, "일정 응답 타입이 필요합니다.");
  for (const fields of shapes) {
    assert.deepEqual([...fields].sort(), [...responseFields].sort());
  }

  const validateForm = findFunction(sourceFile, "validateForm");
  const payload = objectProperties(findPayloadObject(validateForm, sourceFile), sourceFile);
  assert.deepEqual([...payload.keys()].sort(), [...requestFields].sort());

  const mutationRequests = collectCalendarRequests(sourceFile).filter(
    (request) => request.method === "POST" || request.method === "PUT",
  );
  assert.deepEqual(mutationRequests.map((request) => request.method).sort(), ["POST", "PUT"]);
  for (const request of mutationRequests) {
    assert.ok(hasJsonContentType(request.headers, sourceFile));
    const argument = jsonArgument(request.body);
    assert.ok(ts.isIdentifier(argument) && argument.text === "payload");
  }

  assert.deepEqual(
    collectRemovedFieldReferences(sourceFile),
    [],
    "삭제된 content, createdAt, updatedAt 필드를 일정 화면에서 사용하면 안 됩니다.",
  );
  assert.equal(
    collectJsxElementNames(sourceFile).includes("textarea"),
    false,
    "일정 내용 입력란을 화면에 표시하면 안 됩니다.",
  );
});

test("keeps title and date validation faithful to the documented rules", async () => {
  const sourceFile = parsePage(await readCalendarPage());
  const validateForm = findFunction(sourceFile, "validateForm");
  const payload = objectProperties(findPayloadObject(validateForm, sourceFile), sourceFile);

  let trimmedTitleDeclaration = false;
  let titleLimitCheck = false;
  let validDateRangeCheck = false;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === "title" &&
      node.initializer &&
      isTrimCallForFormField(node.initializer, "title")
    ) {
      trimmedTitleDeclaration = true;
    }

    if (ts.isIfStatement(node)) {
      titleLimitCheck ||= subtreeContains(node.expression, (candidate) => {
        const current = unwrap(candidate);
        if (
          !ts.isBinaryExpression(current) ||
          current.operatorToken.kind !== ts.SyntaxKind.GreaterThanToken
        ) {
          return false;
        }
        const left = unwrap(current.left);
        const right = unwrap(current.right);
        return (
          ts.isPropertyAccessExpression(left) &&
          ts.isIdentifier(left.expression) &&
          left.expression.text === "title" &&
          left.name.text === "length" &&
          ts.isNumericLiteral(right) &&
          right.text === "500"
        );
      });

      validDateRangeCheck ||= subtreeContains(node.expression, (candidate) => {
        const current = unwrap(candidate);
        if (!ts.isBinaryExpression(current)) return false;
        const operator = current.operatorToken.kind;
        return (
          (operator === ts.SyntaxKind.LessThanToken &&
            isFormField(current.left, "endDate") &&
            isFormField(current.right, "startDate")) ||
          (operator === ts.SyntaxKind.GreaterThanToken &&
            isFormField(current.left, "startDate") &&
            isFormField(current.right, "endDate"))
        );
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(validateForm);

  assert.equal(trimmedTitleDeclaration, true, "제목의 앞뒤 공백을 제거해야 합니다.");
  assert.equal(titleLimitCheck, true, "제목은 500자까지만 허용해야 합니다.");
  assert.equal(validDateRangeCheck, true, "종료일은 시작일보다 빠를 수 없습니다.");

  const titleValue = payload.get("title");
  assert.ok(ts.isIdentifier(titleValue) && titleValue.text === "title");
});

test("sorts the unified list by dates, calendar type, then calendar number", async () => {
  const sourceFile = parsePage(await readCalendarPage());
  const sortFunction = findFunction(sourceFile, "sortCalendars");
  const comparator = findSortComparator(sortFunction);
  assert.equal(comparator.parameters.length, 2);

  const firstParameter = comparator.parameters[0].name.getText(sourceFile);
  const secondParameter = comparator.parameters[1].name.getText(sourceFile);
  const terms = flattenLogicalOr(comparatorExpression(comparator));

  assert.equal(terms.length, 4);
  assert.equal(isLocaleCompareTerm(terms[0], firstParameter, secondParameter, "startDate"), true);
  assert.equal(isLocaleCompareTerm(terms[1], firstParameter, secondParameter, "endDate"), true);
  assert.equal(isLocaleCompareTerm(terms[2], firstParameter, secondParameter, "calendarType"), true);
  assert.equal(isNumericFieldDifference(terms[3], firstParameter, secondParameter, "id"), true);
});

test("keeps developer terminology out of the calendar screen and attaches administrator auth", async () => {
  const sourceFile = parsePage(await readCalendarPage());
  const copy = collectCopy(sourceFile);
  assert.doesNotMatch(copy, /\b(?:API|JWT)\b/);
  assert.doesNotMatch(copy, /일정\s*(?:ID|아이디)/i);
  assert.doesNotMatch(copy, /페이지네이션/);

  for (const path of [endpoint, unifiedEndpoint, `${endpoint}/7`]) {
    assert.equal(isAdminApiPath(path), true);
    const headers = createApiHeaders(
      path,
      { "Content-Type": "application/json" },
      "calendar-test-token",
    );
    assert.equal(headers.get("Authorization"), "Bearer calendar-test-token");
    assert.equal(headers.get("Accept"), "application/json");
    assert.equal(headers.get("Content-Type"), "application/json");
  }
});
