import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  getCourseUploadIssues,
  parseCourseUploadResponse,
} from "../app/lib/course-uploads.ts";

const root = new URL("../", import.meta.url);
const uploadComponentUrl = new URL("app/components/CourseUploadPage.tsx", root);
const uploadContractUrl = new URL("app/lib/course-uploads.ts", root);

function responseTypeFields(source, typeName) {
  const block = source.match(
    new RegExp(`export type ${typeName} = \\{([\\s\\S]*?)\\n\\};`),
  )?.[1];
  assert.ok(block, `${typeName} 응답 타입을 찾을 수 있어야 합니다.`);
  return [...block.matchAll(/^\s{2}([A-Za-z]\w*)\??:/gm)].map(
    (match) => match[1],
  );
}

test("parses the documented equivalent-course response and its issues array", () => {
  const response = {
    importId: "550e8400-e29b-41d4-a716-446655440001",
    storageStatus: "REVIEW_REQUIRED",
    databaseChanged: false,
    groupCount: 2,
    memberCount: 3,
    message: "검토가 필요한 오류가 1개 있어 활성 데이터에 반영하지 않았습니다.",
    issues: [
      {
        severity: "ERROR",
        code: "NON_CONTIGUOUS_SERIAL_REAPPEARED",
        message: "종료된 일련번호가 비연속 위치에서 다시 등장했습니다.",
        sheetName: "sheet 1",
        rowNumber: 15,
        field: "sourceSerial",
        rawValue: "1",
      },
    ],
  };

  const result = parseCourseUploadResponse("equivalent", response);

  assert.deepEqual(result, { kind: "equivalent", ...response });
  assert.deepEqual(getCourseUploadIssues(result), response.issues);
});

test("parses the documented cross-major response and its reviewIssues array", () => {
  const response = {
    importId: "550e8400-e29b-41d4-a716-446655440000",
    storageStatus: "STORED",
    databaseChanged: true,
    policyYear: 2026,
    uploadedSemester: 1,
    ruleCount: 1302,
    message: "2026학년도 타학과 전공인정 규칙 저장 완료",
    reviewIssues: [
      {
        severity: "WARNING",
        code: "DUPLICATE_RULE",
        message: "동일한 전공인정 규칙이 중복되어 첫 번째 행만 사용합니다.",
        sheetName: "타학과 전공인정 교과목 리스트",
        rowNumber: 1050,
        field: null,
        rawValue: "firstRow=1029",
      },
    ],
  };

  const result = parseCourseUploadResponse("crossMajor", response);

  assert.deepEqual(result, { kind: "crossMajor", ...response });
  assert.deepEqual(getCourseUploadIssues(result), response.reviewIssues);
});

test("rejects swapping the two enrichment issue array names", () => {
  assert.throws(
    () => parseCourseUploadResponse("equivalent", {
      importId: "equivalent-import",
      storageStatus: "STORED",
      databaseChanged: true,
      groupCount: 1,
      memberCount: 2,
      message: "저장 완료",
      reviewIssues: [],
    }),
    /동일교과목 처리 결과를 확인할 수 없습니다/,
  );

  assert.throws(
    () => parseCourseUploadResponse("crossMajor", {
      importId: "cross-major-import",
      storageStatus: "STORED",
      databaseChanged: true,
      policyYear: 2026,
      uploadedSemester: 1,
      ruleCount: 1,
      message: "저장 완료",
      issues: [],
    }),
    /타학과 전공인정 처리 결과를 확인할 수 없습니다/,
  );
});

test("keeps both enrichment response types aligned exactly with the document", async () => {
  const source = await readFile(uploadContractUrl, "utf8");

  assert.deepEqual(responseTypeFields(source, "EquivalentCourseUploadResponse"), [
    "importId",
    "storageStatus",
    "databaseChanged",
    "groupCount",
    "memberCount",
    "message",
    "issues",
  ]);
  assert.deepEqual(responseTypeFields(source, "CrossMajorRecognitionUploadResponse"), [
    "importId",
    "storageStatus",
    "databaseChanged",
    "policyYear",
    "uploadedSemester",
    "ruleCount",
    "message",
    "reviewIssues",
  ]);
});

test("classifies upload results using both storageStatus and databaseChanged", async () => {
  const source = await readFile(uploadComponentUrl, "utf8");
  const classifier = source.match(
    /function classifyResult[\s\S]*?\n}\n\nfunction isRecord/,
  )?.[0] ?? "";

  assert.match(
    classifier,
    /storageStatus === "DUPLICATE"[\s\S]*?databaseChanged === false/,
  );
  assert.match(
    classifier,
    /storageStatus === "REVIEW_REQUIRED"[\s\S]*?databaseChanged === false/,
  );
  assert.match(
    classifier,
    /storageStatus === "STORED"[\s\S]*?databaseChanged === true/,
  );
});

test("sends each enrichment Excel file to the documented endpoint as the file part", async () => {
  const source = await readFile(uploadComponentUrl, "utf8");

  for (const endpoint of [
    "/api/admin/course-enrichments/equivalent-courses/imports",
    "/api/admin/course-enrichments/cross-major-recognitions/imports",
  ]) {
    assert.ok(source.includes(endpoint), `${endpoint}를 사용해야 합니다.`);
  }

  const requestBlock = source.match(
    /const body = new FormData\(\);([\s\S]*?)setResult\(parseCourseUploadResponse/,
  )?.[1];
  assert.ok(requestBlock, "엑셀 파일 요청 구성을 확인할 수 있어야 합니다.");
  assert.match(
    requestBlock,
    /body\.append\(\s*["']file["']\s*,\s*file\s*,\s*file\.name\s*\)/,
  );
  assert.doesNotMatch(requestBlock, /Content-Type|multipart\/form-data/i);
  assert.doesNotMatch(
    requestBlock,
    /\.append\(\s*["'](?:academicYear|semester|policyYear|uploadedSemester)["']/,
  );
});

test("exposes dedicated signed-in routes with staff-friendly guidance", async () => {
  const [source, equivalentRoute, crossMajorRoute] = await Promise.all([
    readFile(uploadComponentUrl, "utf8"),
    readFile(new URL("app/courses/equivalent/page.tsx", root), "utf8"),
    readFile(new URL("app/courses/cross-major/page.tsx", root), "utf8"),
  ]);

  assert.match(equivalentRoute, /<CourseUploadPage kind=["']equivalent["']\s*\/>/);
  assert.match(crossMajorRoute, /<CourseUploadPage kind=["']crossMajor["']\s*\/>/);
  assert.match(source, /<AdminLoginNotice returnTo=\{config\.href\}>/);
  for (const route of ["/courses/equivalent", "/courses/cross-major"]) {
    assert.ok(source.includes(`href: "${route}"`), `${route} 복귀 경로가 필요합니다.`);
  }
  for (const copy of [
    "같은 과목으로 인정되는 과목코드와 그룹",
    "다른 학과에서 수강해도 전공으로 인정되는 교과목 규칙",
    "일련번호·과목코드 확인",
    "학생 소속, 개설 소속, 과목코드, 과목명, 적용년도와 학기",
  ]) {
    assert.ok(source.includes(copy), `${copy} 안내가 필요합니다.`);
  }

  const friendlyConfig = source.match(
    /const courseConfig = \{([\s\S]*?)\n\} as const satisfies/,
  )?.[1]?.replace(/^\s*endpoint:.*$/gm, "") ?? "";
  assert.doesNotMatch(
    friendlyConfig,
    /JWT|Bearer|multipart|Content-Type|storageStatus|databaseChanged|importId|ADMIN 권한/,
  );
});
