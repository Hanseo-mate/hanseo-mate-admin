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

test("creates poster preview URLs inside an effect and revokes the effect-owned URL", async () => {
  const source = await readPosterPage();
  const sourceFile = ts.createSourceFile(
    pageUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let posterImageFunction;

  function findPosterImage(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "PosterImage"
    ) {
      posterImageFunction = node;
      return;
    }
    ts.forEachChild(node, findPosterImage);
  }

  findPosterImage(sourceFile);
  assert.ok(posterImageFunction, "포스터 미리보기 컴포넌트가 필요합니다.");

  const componentSource = posterImageFunction.getText(sourceFile);
  assert.doesNotMatch(
    componentSource,
    /useMemo\s*\([\s\S]*?URL\.createObjectURL/,
    "렌더링 중 만든 URL은 React 개발 모드의 effect 정리 과정에서 너무 일찍 해제될 수 있습니다.",
  );

  const effectMatch = componentSource.match(
    /useEffect\s*\(\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[\s*file\s*\]\s*\)/,
  );
  assert.ok(effectMatch, "선택한 파일이 바뀔 때 미리보기 URL을 만드는 effect가 필요합니다.");

  const effectSource = effectMatch[1];
  const createdUrl = effectSource.match(
    /const\s+([A-Za-z_$][\w$]*)\s*=\s*URL\.createObjectURL\(\s*file\s*\)/,
  );
  assert.ok(createdUrl, "effect 안에서 선택한 파일의 미리보기 URL을 만들어야 합니다.");

  const urlName = createdUrl[1];
  assert.match(
    effectSource,
    new RegExp(`\\bimageRef\\.current\\.src\\s*=\\s*${urlName}\\b`),
    "effect에서 만든 URL을 미리보기 이미지에 연결해야 합니다.",
  );
  assert.match(
    effectSource,
    new RegExp(`return\\s*\\(\\)\\s*=>\\s*URL\\.revokeObjectURL\\(\\s*${urlName}\\s*\\)`),
    "effect 정리 함수는 해당 effect에서 만든 URL만 해제해야 합니다.",
  );
});

test("returns a canceled replacement preview to the server poster image", async () => {
  const source = await readPosterPage();
  const sourceFile = ts.createSourceFile(
    pageUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let posterImageFunction;

  function findPosterImage(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name?.text === "PosterImage"
    ) {
      posterImageFunction = node;
      return;
    }
    ts.forEachChild(node, findPosterImage);
  }

  findPosterImage(sourceFile);
  assert.ok(posterImageFunction, "포스터 미리보기 컴포넌트가 필요합니다.");

  const componentSource = posterImageFunction.getText(sourceFile);
  assert.match(
    componentSource,
    /<img\s+ref=\{imageRef\}\s+src=\{file\s*\?\s*undefined\s*:\s*imageUrl\}/,
    "교체 선택을 취소하면 이미 해제된 미리보기 URL이 아니라 서버 포스터 이미지로 돌아가야 합니다.",
  );
});

test("resets both poster file inputs and connects new and replacement files to previews", async () => {
  const source = await readPosterPage();
  const fileInputs = [...source.matchAll(/<input\b[\s\S]*?type=["']file["'][\s\S]*?\/>/g)]
    .map((match) => match[0]);

  assert.equal(fileInputs.length, 2, "신규 등록과 이미지 교체용 파일 선택창이 각각 필요합니다.");
  for (const input of fileInputs) {
    assert.match(
      input,
      /onClick=\{\(event\)\s*=>\s*\{\s*event\.currentTarget\.value\s*=\s*["']["'];?\s*\}\}/,
      "같은 사진도 다시 선택할 수 있도록 파일 선택창 값을 초기화해야 합니다.",
    );
  }

  assert.match(source, /<PosterImage\s+file=\{newFile\}/);
  assert.match(source, /<PosterImage[\s\S]*?file=\{replacementFile\}/);
  assert.match(source, /onChange=\{\(event\)\s*=>\s*chooseNewFile\(/);
  assert.match(source, /onChange=\{\(event\)\s*=>\s*chooseReplacement\(/);
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
