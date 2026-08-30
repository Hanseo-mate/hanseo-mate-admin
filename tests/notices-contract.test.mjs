import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";
import {
  MAX_NOTICE_IMAGE_SIZE,
  createNoticeMultipartBody,
  parseAdminNotice,
  parseAdminNoticePage,
  validateNoticeAttachment,
  validateNoticeImage,
} from "../app/lib/notices.ts";
import {
  createApiHeaders,
  isAdminApiPath,
} from "../app/lib/request-headers.ts";

const root = new URL("../", import.meta.url);
const helperUrl = new URL("app/lib/notices.ts", root);
const newPageUrl = new URL("app/notices/new/page.tsx", root);
const managePageUrl = new URL("app/notices/manage/page.tsx", root);

const imageFields = {
  id: "number",
  fileName: "string",
  imageUrl: "string",
  contentType: "string",
  fileSize: "number",
  createdAt: "string",
  updatedAt: "string",
};

const attachmentFields = {
  id: "number",
  fileName: "string",
  downloadUrl: "string",
  contentType: "string",
  fileSize: "number",
  createdAt: "string",
  updatedAt: "string",
};

const noticeFields = {
  id: "number",
  title: "string",
  author: "string",
  content: "string",
  viewCount: "number",
  createdAt: "string",
  updatedAt: "string",
  images: "NoticeImage[]",
  attachments: "NoticeAttachment[]",
};

const pageFields = {
  items: "AdminNotice[]",
  page: "number",
  size: "number",
  totalPages: "number",
  totalElements: "number",
  hasNext: "boolean",
};

function parseSource(path, source) {
  return ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
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

function makeImage(overrides = {}) {
  return {
    id: 2,
    fileName: "notice.png",
    imageUrl: "https://example.com/notice.png",
    contentType: "image/png",
    fileSize: 2048,
    createdAt: "2026-08-13T01:00:00Z",
    updatedAt: "2026-08-13T01:00:00Z",
    ...overrides,
  };
}

function makeAttachment(overrides = {}) {
  return {
    id: 2,
    fileName: "guide.pdf",
    downloadUrl: "https://example.com/guide.pdf",
    contentType: "application/pdf",
    fileSize: 4096,
    createdAt: "2026-08-13T01:00:00Z",
    updatedAt: "2026-08-13T01:00:00Z",
    ...overrides,
  };
}

function makeNotice(overrides = {}) {
  return {
    id: 7,
    title: "학생회 행사 안내",
    author: "학생회",
    content: "행사 내용을 확인해 주세요.",
    viewCount: 12,
    createdAt: "2026-08-13T01:00:00Z",
    updatedAt: "2026-08-13T02:00:00Z",
    images: [],
    attachments: [],
    ...overrides,
  };
}

function fileWithSize(size, name, type) {
  return new File([new Uint8Array(size)], name, { type });
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
  if (ts.isTemplateExpression(current)) {
    let result = current.head.text;
    for (const span of current.templateSpans) {
      result += "${value}";
      result += span.literal.text;
    }
    return result;
  }
  return current.getText(sourceFile);
}

function collectRequests(source, fileUrl) {
  const sourceFile = parseSource(fileUrl.pathname, source);
  const constants = new Map();
  const requests = [];

  function visitConstants(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer &&
      (ts.isStringLiteral(node.initializer) ||
        ts.isNoSubstitutionTemplateLiteral(node.initializer))
    ) {
      constants.set(node.name.text, node.initializer.text);
    }
    ts.forEachChild(node, visitConstants);
  }
  visitConstants(sourceFile);

  function collectInitOptions(node) {
    if (!node) return [null];
    const current = unwrap(node);
    if (ts.isConditionalExpression(current)) {
      return [
        ...collectInitOptions(current.whenTrue),
        ...collectInitOptions(current.whenFalse),
      ];
    }
    return [current];
  }

  function visit(node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "apiFetch" &&
      node.arguments[0]
    ) {
      for (const init of collectInitOptions(node.arguments[1])) {
        let method = "GET";
        let body = null;
        let headers = null;
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
          body = options.get("body") ?? null;
          headers = options.get("headers") ?? null;
        }
        requests.push({
          path: resolvePath(node.arguments[0], constants, sourceFile),
          method,
          body,
          headers,
          sourceFile,
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return requests;
}

function containsJsonStringify(node) {
  if (!node) return false;
  let found = false;
  function visit(current) {
    if (
      ts.isCallExpression(current) &&
      ts.isPropertyAccessExpression(current.expression) &&
      ts.isIdentifier(current.expression.expression) &&
      current.expression.expression.text === "JSON" &&
      current.expression.name.text === "stringify"
    ) {
      found = true;
      return;
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function hasJsonContentType(node, sourceFile) {
  const current = node ? unwrap(node) : null;
  if (!current || !ts.isObjectLiteralExpression(current)) return false;
  const contentType = objectProperties(current, sourceFile).get("Content-Type");
  return Boolean(
    contentType &&
    (ts.isStringLiteral(contentType) ||
      ts.isNoSubstitutionTemplateLiteral(contentType)) &&
    contentType.text === "application/json",
  );
}

function collectUserFacingCopy(source, fileUrl) {
  const sourceFile = parseSource(fileUrl.pathname, source);
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

function findVariableInitializer(sourceFile, name) {
  let initializer;
  function visit(node) {
    if (
      !initializer &&
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      initializer = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(initializer, `${name} 상태 계산이 필요합니다.`);
  return initializer;
}

function findFunctionDeclaration(sourceFile, name) {
  let declaration;
  function visit(node) {
    if (
      !declaration &&
      ts.isFunctionDeclaration(node) &&
      node.name?.text === name
    ) {
      declaration = node;
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  assert.ok(declaration, `${name} 함수가 필요합니다.`);
  return declaration;
}

function findPropertyInitializers(sourceFile, name) {
  const initializers = [];
  function visit(node) {
    if (
      ts.isPropertyAssignment(node) &&
      propertyName(node, sourceFile) === name
    ) {
      initializers.push(node.initializer);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return initializers;
}

test("declares the exact documented notice, image, attachment, and page response fields", async () => {
  const source = await readFile(helperUrl, "utf8");
  const sourceFile = parseSource(helperUrl.pathname, source);

  assert.deepEqual(findObjectTypeFields(sourceFile, "NoticeImage"), imageFields);
  assert.deepEqual(findObjectTypeFields(sourceFile, "NoticeAttachment"), attachmentFields);
  assert.deepEqual(findObjectTypeFields(sourceFile, "AdminNotice"), noticeFields);
  assert.deepEqual(findObjectTypeFields(sourceFile, "AdminNoticePage"), pageFields);
});

test("parses required media arrays and sorts each one by file number", () => {
  const parsed = parseAdminNotice(makeNotice({
    images: [makeImage({ id: 9 }), makeImage({ id: 2 })],
    attachments: [makeAttachment({ id: 8 }), makeAttachment({ id: 1 })],
    ignoredServerField: "not part of the response model",
  }));

  assert.deepEqual(Object.keys(parsed).sort(), Object.keys(noticeFields).sort());
  assert.deepEqual(parsed.images.map((image) => image.id), [2, 9]);
  assert.deepEqual(parsed.attachments.map((file) => file.id), [1, 8]);
  assert.deepEqual(Object.keys(parsed.images[0]).sort(), Object.keys(imageFields).sort());
  assert.deepEqual(Object.keys(parsed.attachments[0]).sort(), Object.keys(attachmentFields).sort());

  assert.deepEqual(parseAdminNotice(makeNotice()).images, []);
  assert.deepEqual(parseAdminNotice(makeNotice()).attachments, []);
  assert.throws(
    () => parseAdminNotice({ ...makeNotice(), images: undefined }),
    /공지 정보를 확인할 수 없습니다/,
  );
  assert.throws(
    () => parseAdminNotice({ ...makeNotice(), attachments: undefined }),
    /공지 정보를 확인할 수 없습니다/,
  );

  const page = parseAdminNoticePage({
    items: [makeNotice({ images: [makeImage({ id: 3 }), makeImage({ id: 1 })] })],
    page: 0,
    size: 10,
    totalPages: 1,
    totalElements: 1,
    hasNext: false,
  });
  assert.deepEqual(page.items[0].images.map((image) => image.id), [1, 3]);
});

test("accepts only supported non-empty notice images up to five MiB", () => {
  const nameAtLimit = `${"a".repeat(496)}.png`;
  const nameOverLimit = `${"a".repeat(497)}.png`;
  const validFiles = [
    new File(["jpg"], "photo.jpg", { type: "image/jpeg" }),
    new File(["jpeg"], "photo.jpeg", { type: "image/jpeg" }),
    new File(["png"], "photo.png", { type: "image/png" }),
    new File(["gif"], "photo.gif", { type: "image/gif" }),
    new File(["named"], nameAtLimit, { type: "image/png" }),
    fileWithSize(MAX_NOTICE_IMAGE_SIZE, "limit.png", "image/png"),
  ];
  for (const file of validFiles) assert.equal(validateNoticeImage(file), null);

  assert.match(
    validateNoticeImage(new File([], "empty.png", { type: "image/png" })) ?? "",
    /내용이 없는/,
  );
  assert.match(
    validateNoticeImage(fileWithSize(MAX_NOTICE_IMAGE_SIZE + 1, "large.png", "image/png")) ?? "",
    /5MB/,
  );
  assert.match(
    validateNoticeImage(new File(["named"], nameOverLimit, { type: "image/png" })) ?? "",
    /500/,
  );
  assert.match(
    validateNoticeImage(new File(["pdf"], "file.pdf", { type: "application/pdf" })) ?? "",
    /JPG.*JPEG.*PNG.*GIF/,
  );
  assert.match(
    validateNoticeImage(new File(["png"], "photo.png", { type: "application/octet-stream" })) ?? "",
    /JPG.*JPEG.*PNG.*GIF/,
  );
});

test("rejects empty attachments and long names without inventing type, size, or count limits", () => {
  assert.match(
    validateNoticeAttachment(new File([], "empty.any", { type: "application/x-custom" })) ?? "",
    /내용이 없는/,
  );

  const nameAtLimit = `${"a".repeat(496)}.bin`;
  const nameOverLimit = `${"a".repeat(497)}.bin`;
  assert.equal(nameAtLimit.length, 500);
  assert.equal(nameOverLimit.length, 501);
  assert.equal(
    validateNoticeAttachment(
      fileWithSize(MAX_NOTICE_IMAGE_SIZE + 1, nameAtLimit, "application/x-custom"),
    ),
    null,
  );
  assert.match(
    validateNoticeAttachment(new File(["x"], nameOverLimit, { type: "application/x-custom" })) ?? "",
    /500/,
  );
});

test("builds multipart requests with a JSON request blob and repeated file parts", async () => {
  const images = [
    new File(["one"], "one.jpg", { type: "image/jpeg" }),
    new File(["two"], "two.png", { type: "image/png" }),
    new File(["three"], "three.gif", { type: "image/gif" }),
  ];
  const attachments = [
    new File(["guide"], "guide.pdf", { type: "application/pdf" }),
    new File(["archive"], "archive.custom", { type: "application/x-custom" }),
  ];
  const request = {
    title: "공지",
    author: "학생회",
    content: "본문",
  };
  const body = createNoticeMultipartBody(request, images, attachments);

  assert.deepEqual(
    [...body.keys()],
    ["request", "images", "images", "images", "attachments", "attachments"],
  );
  const requestPart = body.get("request");
  assert.ok(requestPart instanceof Blob);
  assert.equal(requestPart.type, "application/json");
  assert.deepEqual(JSON.parse(await requestPart.text()), request);
  assert.deepEqual(
    body.getAll("images").map((value) => value.name),
    images.map((file) => file.name),
  );
  assert.deepEqual(
    body.getAll("attachments").map((value) => value.name),
    attachments.map((file) => file.name),
  );
});

test("includes retained image and attachment numbers in multipart updates", async () => {
  const request = {
    title: "수정 공지",
    author: "학생회",
    content: "수정 내용",
    retainedImageIds: [8, 2],
    retainedAttachmentIds: [],
  };
  const body = createNoticeMultipartBody(request, [], []);
  const requestPart = body.get("request");
  assert.ok(requestPart instanceof Blob);
  assert.deepEqual(JSON.parse(await requestPart.text()), request);
});

test("derives retained file numbers from every existing file not marked for deletion", async () => {
  const source = await readFile(managePageUrl, "utf8");
  const sourceFile = parseSource(managePageUrl.pathname, source);
  const retainedImages = findPropertyInitializers(sourceFile, "retainedImageIds");
  const retainedAttachments = findPropertyInitializers(sourceFile, "retainedAttachmentIds");

  assert.equal(retainedImages.length, 1);
  assert.equal(retainedAttachments.length, 1);
  const imageExpression = retainedImages[0].getText(sourceFile);
  const attachmentExpression = retainedAttachments[0].getText(sourceFile);
  assert.match(imageExpression, /notice\.images/);
  assert.match(imageExpression, /removedImageIds\.has/);
  assert.match(imageExpression, /\.filter\s*\(/);
  assert.match(imageExpression, /\.map\s*\(/);
  assert.match(attachmentExpression, /notice\.attachments/);
  assert.match(attachmentExpression, /removedAttachmentIds\.has/);
  assert.match(attachmentExpression, /\.filter\s*\(/);
  assert.match(attachmentExpression, /\.map\s*\(/);
});

test("protects both notice pages and keeps the complete administrator CRUD flow", async () => {
  const [newSource, manageSource] = await Promise.all([
    readFile(newPageUrl, "utf8"),
    readFile(managePageUrl, "utf8"),
  ]);

  assert.match(newSource, /<AdminLoginNotice\b/);
  assert.match(newSource, /returnTo=["']\/notices\/new["']/);
  assert.match(manageSource, /<AdminLoginNotice\b/);
  assert.match(manageSource, /returnTo=["']\/notices\/manage["']/);
  assert.doesNotMatch(newSource, /(?<!api)fetch\s*\(/);
  assert.doesNotMatch(manageSource, /(?<!api)fetch\s*\(/);

  const requests = [
    ...collectRequests(newSource, newPageUrl),
    ...collectRequests(manageSource, managePageUrl),
  ];
  assert.ok(requests.some((request) => request.path === "/api/admin/notices" && request.method === "POST"));
  assert.ok(requests.some((request) => request.path === "/api/admin/notices?page=${value}" && request.method === "GET"));
  assert.ok(requests.some((request) => request.path === "/api/admin/notices/${value}" && request.method === "GET"));
  assert.ok(requests.some((request) => request.path === "/api/admin/notices/${value}" && request.method === "PUT"));
  assert.ok(requests.some((request) => request.path === "/api/admin/notices/${value}" && request.method === "DELETE"));
});

test("supports JSON fallback and multipart notice mutations without forcing a multipart header", async () => {
  const [newSource, manageSource] = await Promise.all([
    readFile(newPageUrl, "utf8"),
    readFile(managePageUrl, "utf8"),
  ]);
  const requests = [
    ...collectRequests(newSource, newPageUrl),
    ...collectRequests(manageSource, managePageUrl),
  ].filter((request) => request.method === "POST" || request.method === "PUT");

  const postRequests = requests.filter((request) => request.method === "POST");
  const putRequests = requests.filter((request) => request.method === "PUT");
  assert.ok(postRequests.length >= 2, "파일 유무에 따른 POST 전송 방식이 모두 필요합니다.");
  assert.ok(putRequests.length >= 2, "파일 변경 유무에 따른 PUT 전송 방식이 모두 필요합니다.");

  for (const mutations of [postRequests, putRequests]) {
    assert.ok(
      mutations.some((request) => containsJsonStringify(request.body) && hasJsonContentType(request.headers, request.sourceFile)),
      "파일 변경이 없으면 JSON 요청을 사용해야 합니다.",
    );
    assert.ok(
      mutations.some((request) => !containsJsonStringify(request.body) && !request.headers),
      "파일이 있거나 유지 목록이 바뀌면 FormData 요청을 사용해야 합니다.",
    );
  }

  for (const source of [newSource, manageSource]) {
    assert.doesNotMatch(source, /["']Content-Type["']\s*:\s*["']multipart\/form-data/i);
    assert.doesNotMatch(source, /\.set\(\s*["']Content-Type["']\s*,\s*["']multipart\/form-data/i);
  }
});

test("adds administrator Bearer auth while leaving FormData content type to the browser", () => {
  for (const path of ["/api/admin/notices", "/api/admin/notices/7"]) {
    assert.equal(isAdminApiPath(path), true);
    const headers = createApiHeaders(path, undefined, "notice-file-test-token");
    assert.equal(headers.get("Authorization"), "Bearer notice-file-test-token");
    assert.equal(headers.get("Accept"), "application/json");
    assert.equal(headers.has("Content-Type"), false);
  }
});

test("keeps file previews, cleanup, dirty-state signals, and staff-friendly copy", async () => {
  const [newSource, manageSource] = await Promise.all([
    readFile(newPageUrl, "utf8"),
    readFile(managePageUrl, "utf8"),
  ]);
  const combined = `${newSource}\n${manageSource}`;
  const userFacingCopy = [
    collectUserFacingCopy(newSource, newPageUrl),
    collectUserFacingCopy(manageSource, managePageUrl),
  ].join("\n");

  assert.match(combined, /URL\.createObjectURL/);
  assert.match(combined, /URL\.revokeObjectURL/);
  assert.match(newSource, /미리보기/);
  assert.match(combined, /첨부파일/);
  assert.match(combined, /파일명|\.name/);
  assert.match(combined, /파일 크기|formatNoticeFileSize/);
  assert.match(combined, /retainedImageIds/);
  assert.match(combined, /retainedAttachmentIds/);

  const newSourceFile = parseSource(newPageUrl.pathname, newSource);
  const manageSourceFile = parseSource(managePageUrl.pathname, manageSource);
  const hasDraft = findVariableInitializer(newSourceFile, "hasDraft").getText(newSourceFile);
  assert.match(hasDraft, /selectedImages\.length/);
  assert.match(hasDraft, /selectedAttachments\.length/);
  const clearSelectedFiles = findFunctionDeclaration(
    newSourceFile,
    "clearSelectedFiles",
  ).getText(newSourceFile);
  assert.match(clearSelectedFiles, /URL\.revokeObjectURL/);

  const hasFileChanges = findVariableInitializer(
    manageSourceFile,
    "hasFileChanges",
  ).getText(manageSourceFile);
  for (const signal of [
    "removedImageIds.size",
    "removedAttachmentIds.size",
    "selectedImages.length",
    "selectedAttachments.length",
  ]) {
    assert.match(hasFileChanges, new RegExp(signal.replace(".", "\\.")));
  }
  const hasUnsavedChanges = findVariableInitializer(
    manageSourceFile,
    "hasUnsavedChanges",
  ).getText(manageSourceFile);
  assert.match(hasUnsavedChanges, /hasFileChanges/);
  const resetFileChanges = findVariableInitializer(
    manageSourceFile,
    "resetFileChanges",
  ).getText(manageSourceFile);
  assert.match(resetFileChanges, /URL\.revokeObjectURL/);
  assert.match(manageSource, /beforeunload/);

  assert.doesNotMatch(userFacingCopy, /\b(?:API|JWT|Bearer|FormData|multipart)\b/);
  assert.doesNotMatch(userFacingCopy, /(?:이미지|첨부파일|공지)\s*(?:ID|아이디)/i);
  assert.doesNotMatch(userFacingCopy, /서버\s*(?:경로|응답)|데이터베이스/);
});
