import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  createApiHeaders,
  isAdminApiPath,
} from "../app/lib/request-headers.ts";

const pageUrl = new URL("../app/posters/manage/page.tsx", import.meta.url);

async function readPosterPage() {
  return readFile(pageUrl, "utf8");
}

function collectPosterRequests(source) {
  const sourceFile = ts.createSourceFile(
    pageUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const constants = new Map();
  const requests = [];

  function propertyName(property) {
    if (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) {
      return property.name.text;
    }
    return property.name.getText(sourceFile);
  }

  function resolvePath(node) {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      return node.text;
    }
    if (ts.isIdentifier(node)) return constants.get(node.text) ?? node.getText(sourceFile);
    if (ts.isTemplateExpression(node)) {
      let result = node.head.text;
      for (const span of node.templateSpans) {
        result += ts.isIdentifier(span.expression)
          ? constants.get(span.expression.text) ?? "${value}"
          : "${value}";
        result += span.literal.text;
      }
      return result;
    }
    return node.getText(sourceFile);
  }

  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      if (ts.isStringLiteral(node.initializer) || ts.isNoSubstitutionTemplateLiteral(node.initializer)) {
        constants.set(node.name.text, node.initializer.text);
      }
    }

    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "apiFetch" &&
      node.arguments[0]
    ) {
      let method = "GET";
      let hasBody = false;
      const init = node.arguments[1];
      if (init && ts.isObjectLiteralExpression(init)) {
        for (const property of init.properties) {
          if (ts.isShorthandPropertyAssignment(property)) {
            if (property.name.text === "body") hasBody = true;
            continue;
          }
          if (!ts.isPropertyAssignment(property)) continue;
          const name = propertyName(property);
          if (name === "method" && ts.isStringLiteral(property.initializer)) {
            method = property.initializer.text;
          }
          if (name === "body") hasBody = true;
        }
      }
      requests.push({ path: resolvePath(node.arguments[0]), method, hasBody });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return requests;
}

function findPosterResponseFields(source) {
  const sourceFile = ts.createSourceFile(
    pageUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const candidates = [];

  function collectProperties(node) {
    const names = node.members
      .filter(ts.isPropertySignature)
      .map((property) => property.name)
      .filter(Boolean)
      .map((name) => {
        if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
        return name.getText(sourceFile);
      });

    if (names.includes("id") && names.includes("imageUrl")) {
      candidates.push(names);
    }
  }

  function visit(node) {
    if (ts.isInterfaceDeclaration(node)) {
      collectProperties(node);
    } else if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
      collectProperties(node.type);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(
    candidates.length >= 1,
    "id와 imageUrl을 가진 포스터 응답 타입이 필요합니다.",
  );
  return candidates;
}

function collectUserFacingCopy(source) {
  const sourceFile = ts.createSourceFile(
    pageUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
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

test("protects the poster screen and covers the complete administrator CRUD flow", async () => {
  const source = await readPosterPage();

  assert.match(source, /<AdminLoginNotice\b/);
  assert.match(source, /returnTo=["']\/posters\/manage["']/);

  const endpoint = "/api/admin/home-posters";
  const requests = collectPosterRequests(source);
  assert.ok(requests.some((request) => request.path === endpoint && request.method === "GET"));
  assert.ok(requests.some((request) => request.path === endpoint && request.method === "POST" && request.hasBody));
  assert.ok(requests.some((request) => request.path.startsWith(`${endpoint}/`) && request.method === "PUT" && request.hasBody));
  assert.ok(requests.some((request) => request.path.startsWith(`${endpoint}/`) && request.method === "DELETE"));
});

test("uploads poster images as browser-managed multipart form data", async () => {
  const source = await readPosterPage();
  const formDataKeys = [...source.matchAll(
    /\.(?:append|set)\(\s*["'`]([^"'`]+)["'`]\s*,/g,
  )].map((match) => match[1]);

  assert.ok(formDataKeys.length >= 1, "이미지 업로드용 FormData가 필요합니다.");
  assert.deepEqual([...new Set(formDataKeys)], ["file"]);

  for (const extension of [".jpg", ".jpeg", ".png", ".gif"]) {
    assert.ok(source.includes(extension), `${extension} 파일 지원이 필요합니다.`);
  }
  assert.match(source, /(?:5\s*\*\s*1024\s*\*\s*1024|5_?242_?880|5242880)/);
  assert.match(source, /\.size\s*>\s*[A-Z_$][\w$]*/);

  assert.doesNotMatch(source, /["']Content-Type["']\s*:/i);
  assert.doesNotMatch(source, /\.set\(\s*["']Content-Type["']/i);
});

test("uses only the documented poster response fields and avoids developer-facing copy", async () => {
  const source = await readPosterPage();
  const responseShapes = findPosterResponseFields(source);

  for (const responseFields of responseShapes) {
    assert.deepEqual(
      [...responseFields].sort(),
      ["createdAt", "id", "imageUrl", "updatedAt"].sort(),
    );
  }
  const userFacingCopy = collectUserFacingCopy(source);
  assert.doesNotMatch(userFacingCopy, /\b(?:API|JWT)\b/);
  assert.doesNotMatch(userFacingCopy, /포스터\s*(?:ID|아이디|번호)/i);
});

test("automatically adds the saved administrator token without overriding FormData headers", () => {
  const path = "/api/admin/home-posters";
  const formData = new FormData();
  formData.append("file", new Blob(["poster image"]), "poster.png");

  assert.equal(isAdminApiPath(path), true);

  const headers = createApiHeaders(path, undefined, "poster-test-token");
  assert.equal(headers.get("Authorization"), "Bearer poster-test-token");
  assert.equal(headers.get("Accept"), "application/json");
  assert.equal(headers.has("Content-Type"), false);
});
