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

function findPosterResponseShapes(source) {
  const sourceFile = ts.createSourceFile(
    pageUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const candidates = [];

  function collectProperties(node) {
    const properties = node.members
      .filter(ts.isPropertySignature)
      .map((property) => {
        const name = property.name;
        const propertyName = ts.isIdentifier(name) || ts.isStringLiteral(name)
          ? name.text
          : name.getText(sourceFile);
        return {
          name: propertyName,
          optional: Boolean(property.questionToken),
          type: property.type?.getText(sourceFile) ?? "",
        };
      });
    const names = properties.map((property) => property.name);

    if (names.includes("id") && names.includes("imageUrl")) {
      candidates.push(properties);
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

function findNamedFunction(source, functionName) {
  const sourceFile = ts.createSourceFile(
    pageUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let match;

  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === functionName) {
      match = node;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(match, `${functionName} 함수가 필요합니다.`);
  return { node: match, sourceFile, text: match.getText(sourceFile) };
}

function collectMultipartFields(source, functionName) {
  const { node: functionNode, sourceFile } = findNamedFunction(source, functionName);
  const formDataNames = new Set();
  const fields = [];

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      ts.isNewExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "FormData"
    ) {
      formDataNames.add(node.name.text);
    }

    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      formDataNames.has(node.expression.expression.text) &&
      ["append", "set"].includes(node.expression.name.text) &&
      node.arguments[0] &&
      (ts.isStringLiteral(node.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(node.arguments[0]))
    ) {
      let ancestor = node.parent;
      let conditional = false;
      while (ancestor && ancestor !== functionNode) {
        if (
          ts.isIfStatement(ancestor) ||
          ts.isConditionalExpression(ancestor) ||
          (ts.isBinaryExpression(ancestor) && ancestor.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)
        ) {
          conditional = true;
          break;
        }
        ancestor = ancestor.parent;
      }
      fields.push({
        key: node.arguments[0].text,
        value: node.arguments[1]?.getText(sourceFile) ?? "",
        conditional,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(functionNode);
  return fields;
}

function evaluateNumericExpression(node) {
  if (ts.isNumericLiteral(node)) return Number(node.text.replaceAll("_", ""));
  if (ts.isParenthesizedExpression(node)) return evaluateNumericExpression(node.expression);
  if (ts.isBinaryExpression(node)) {
    const left = evaluateNumericExpression(node.left);
    const right = evaluateNumericExpression(node.right);
    if (node.operatorToken.kind === ts.SyntaxKind.AsteriskToken) return left * right;
    if (node.operatorToken.kind === ts.SyntaxKind.PlusToken) return left + right;
  }
  throw new Error(`숫자 상수 표현식을 계산할 수 없습니다: ${node.getText()}`);
}

function readNumericConstant(source, constantName) {
  const sourceFile = ts.createSourceFile(
    pageUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  let initializer;

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === constantName &&
      node.initializer
    ) {
      initializer = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(initializer, `${constantName} 상수가 필요합니다.`);
  return evaluateNumericExpression(initializer);
}

function collectUseStateNames(source) {
  const sourceFile = ts.createSourceFile(
    pageUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const names = [];

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer) &&
      ts.isIdentifier(node.initializer.expression) &&
      node.initializer.expression.text === "useState"
    ) {
      const stateName = node.name.elements[0]?.name;
      if (stateName && ts.isIdentifier(stateName)) names.push(stateName.text);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return names;
}

function collectNamedFunctionTexts(source, namePattern) {
  const sourceFile = ts.createSourceFile(
    pageUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const functions = [];

  function visit(node) {
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      namePattern.test(node.name.text)
    ) {
      functions.push(node.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return functions;
}

function findDirtyExpression(source) {
  const sourceFile = ts.createSourceFile(
    pageUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const initializers = new Map();
  let dirtyExpression = "";

  function visit(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      initializers.set(node.name.text, node.initializer.getText(sourceFile));
    }
    if (
      ts.isJsxSelfClosingElement(node) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === "UnsavedChangesDialog"
    ) {
      const dirtyAttribute = node.attributes.properties.find(
        (property) => ts.isJsxAttribute(property) && property.name.text === "dirty",
      );
      if (
        dirtyAttribute &&
        ts.isJsxAttribute(dirtyAttribute) &&
        dirtyAttribute.initializer &&
        ts.isJsxExpression(dirtyAttribute.initializer) &&
        dirtyAttribute.initializer.expression
      ) {
        dirtyExpression = dirtyAttribute.initializer.expression.getText(sourceFile);
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  assert.ok(dirtyExpression, "이탈 확인 다이얼로그에 dirty 조건을 연결해야 합니다.");
  return initializers.get(dirtyExpression) ?? dirtyExpression;
}

function collectInputElementsByType(source, inputType) {
  const sourceFile = ts.createSourceFile(
    pageUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const inputs = [];

  function visit(node) {
    if (
      ts.isJsxSelfClosingElement(node) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === "input"
    ) {
      const typeAttribute = node.attributes.properties.find(
        (property) => ts.isJsxAttribute(property) && property.name.text === "type",
      );
      if (
        typeAttribute &&
        ts.isJsxAttribute(typeAttribute) &&
        typeAttribute.initializer &&
        ts.isStringLiteral(typeAttribute.initializer) &&
        typeAttribute.initializer.text === inputType
      ) {
        inputs.push(node.getText(sourceFile));
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return inputs;
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

test("uploads poster images and optional normalized links as browser-managed multipart form data", async () => {
  const source = await readPosterPage();
  for (const functionName of ["createPoster", "replacePoster"]) {
    const fields = collectMultipartFields(source, functionName);
    const fileField = fields.find((field) => field.key === "file");
    const linkField = fields.find((field) => field.key === "linkUrl");

    assert.ok(fileField, `${functionName}은 file을 multipart 본문에 포함해야 합니다.`);
    assert.equal(fileField.conditional, false, `${functionName}의 file은 필수 필드여야 합니다.`);
    assert.ok(linkField, `${functionName}은 선택한 linkUrl을 multipart 본문에 포함해야 합니다.`);
    assert.equal(linkField.conditional, true, "빈 링크는 linkUrl 필드를 보내지 않아야 합니다.");
    assert.match(
      linkField.value,
      /(?:normalized|trimmed)/i,
      "linkUrl에는 앞뒤 공백을 정리한 값을 보내야 합니다.",
    );
  }

  for (const extension of [".jpg", ".jpeg", ".png", ".gif"]) {
    assert.ok(source.includes(extension), `${extension} 파일 지원이 필요합니다.`);
  }
  assert.equal(readNumericConstant(source, "MAX_FILE_SIZE"), 5_242_880);
  assert.match(source, /\.size\s*>\s*[A-Z_$][\w$]*/);

  assert.doesNotMatch(source, /["']Content-Type["']\s*:/i);
  assert.doesNotMatch(source, /\.set\(\s*["']Content-Type["']/i);
});

test("keeps replacement as a file-required PUT and exposes no link-only mutation endpoint", async () => {
  const source = await readPosterPage();
  const { text: replaceSource } = findNamedFunction(source, "replacePoster");
  const requests = collectPosterRequests(source);

  assert.match(replaceSource, /const\s+file\s*=\s*replacementFiles\s*\[/);
  assert.match(replaceSource, /if\s*\(\s*!file\b/);
  assert.match(replaceSource, /\.(?:append|set)\(\s*["']file["']/);
  assert.ok(
    requests.some((request) => request.method === "PUT" && request.hasBody),
    "포스터 교체는 multipart 본문이 있는 PUT이어야 합니다.",
  );
  assert.equal(
    requests.some((request) => request.method === "PATCH"),
    false,
    "링크만 수정하는 별도 endpoint를 만들지 않습니다.",
  );
});

test("normalizes optional poster links and accepts only absolute HTTP(S) URLs up to 2,048 characters", async () => {
  const source = await readPosterPage();
  const linkFunctions = collectNamedFunctionTexts(source, /link/i).join("\n");

  assert.ok(linkFunctions, "포스터 링크 정규화·검증 함수가 필요합니다.");
  assert.match(linkFunctions, /\.trim\s*\(\s*\)/, "링크의 앞뒤 공백을 제거해야 합니다.");
  assert.match(linkFunctions, /new\s+URL\s*\(/, "절대 URL 파싱으로 링크를 검증해야 합니다.");
  assert.match(linkFunctions, /["']http:["']/);
  assert.match(linkFunctions, /["']https:["']/);
  assert.match(linkFunctions, /\.hostname\b/, "유효한 호스트가 있는 URL만 허용해야 합니다.");
  assert.match(linkFunctions, /\.length\s*>\s*(?:MAX_[A-Z_]*LINK[A-Z_]*|2_?048|2048)/);
  assert.match(
    linkFunctions,
    /if\s*\(\s*(?:!\s*[A-Za-z_$][\w$]*|[A-Za-z_$][\w$]*\s*===\s*null)\s*\)\s*(?:\{|return)/,
    "빈 링크는 오류가 아닌 링크 없음으로 처리해야 합니다.",
  );
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

test("requires linkUrl on every administrator poster response and avoids developer-facing copy", async () => {
  const source = await readPosterPage();
  const responseShapes = findPosterResponseShapes(source);

  for (const responseProperties of responseShapes) {
    const responseFields = responseProperties.map((property) => property.name);
    assert.deepEqual(
      [...responseFields].sort(),
      ["createdAt", "id", "imageUrl", "linkUrl", "updatedAt"].sort(),
    );
    const linkProperty = responseProperties.find((property) => property.name === "linkUrl");
    assert.ok(linkProperty, "포스터 응답은 linkUrl을 생략하지 않아야 합니다.");
    assert.equal(linkProperty.optional, false, "linkUrl 필드는 항상 존재해야 합니다.");
    assert.match(
      linkProperty.type.replaceAll(/\s/g, ""),
      /^(?:string\|null|null\|string)$/,
      "linkUrl은 string | null이어야 합니다.",
    );
  }

  const { text: parserSource } = findNamedFunction(source, "parsePoster");
  assert.match(parserSource, /\.linkUrl\b/, "응답 파서가 linkUrl을 검증해야 합니다.");
  assert.match(parserSource, /typeof[\s\S]*?\.linkUrl\s*!==\s*["']string["']/);
  assert.match(parserSource, /\.linkUrl\s*!==\s*null/);

  const userFacingCopy = collectUserFacingCopy(source);
  assert.doesNotMatch(userFacingCopy, /\b(?:API|JWT)\b/);
  assert.doesNotMatch(userFacingCopy, /포스터\s*(?:ID|아이디|번호)/i);
});

test("shows poster link status and provides separate registration and replacement link drafts", async () => {
  const source = await readPosterPage();
  const urlInputs = collectInputElementsByType(source, "url");

  assert.equal(urlInputs.length, 2, "신규 등록과 교체 영역에 링크 URL 입력이 각각 필요합니다.");
  for (const input of urlInputs) {
    assert.match(input, /maxLength=\{(?:MAX_[A-Z_]*LINK[A-Z_]*|2_?048|2048)\}/);
    assert.match(input, /value=\{/);
    assert.match(input, /onChange=\{/);
  }

  assert.match(source, /poster\.linkUrl\b/, "등록된 URL을 포스터 카드에 표시해야 합니다.");
  assert.match(source, /클릭 이동 없음/, "링크가 없는 포스터를 명확히 표시해야 합니다.");
  assert.match(source, /링크 있음/);
  assert.match(source, /링크 없음/);
});

test("includes both new and replacement link drafts in unsaved-change protection", async () => {
  const source = await readPosterPage();
  const linkStateNames = collectUseStateNames(source).filter((name) => /link/i.test(name));
  const dirtyExpression = findDirtyExpression(source);

  assert.ok(linkStateNames.length >= 2, "신규 등록과 교체용 링크 draft 상태가 각각 필요합니다.");
  const newLinkStateNames = linkStateNames.filter((name) => /^new/i.test(name));
  assert.ok(newLinkStateNames.length >= 1, "신규 포스터 링크 draft 상태가 필요합니다.");
  for (const stateName of newLinkStateNames) {
    assert.match(
      dirtyExpression,
      new RegExp(`\\b${stateName}\\b`),
      `${stateName}을 저장 전 이탈 방지 조건에 포함해야 합니다.`,
    );
  }

  const replacementLinkStateNames = linkStateNames.filter((name) => !/^new/i.test(name));
  assert.ok(replacementLinkStateNames.length >= 1, "교체용 링크 draft 상태가 필요합니다.");
  const replacementIsDirectlyDirty = replacementLinkStateNames.some((stateName) => (
    new RegExp(`\\b${stateName}\\b`).test(dirtyExpression)
  ));
  if (!replacementIsDirectlyDirty) {
    assert.match(
      dirtyExpression,
      /\breplacementFiles\b/,
      "교체 링크 draft가 사진 선택 상태와 함께 이탈 방지에 포함되어야 합니다.",
    );
    const { text: chooseReplacementSource } = findNamedFunction(source, "chooseReplacement");
    const { text: clearReplacementSource } = findNamedFunction(source, "clearReplacement");
    for (const stateName of replacementLinkStateNames) {
      const setterName = `set${stateName[0].toUpperCase()}${stateName.slice(1)}`;
      assert.match(chooseReplacementSource, new RegExp(`\\b${setterName}\\b`));
      assert.match(clearReplacementSource, new RegExp(`\\b${setterName}\\b`));
    }
  }
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
