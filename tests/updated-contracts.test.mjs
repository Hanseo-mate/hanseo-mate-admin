import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { parseCourseUploadResponse } from "../app/lib/course-uploads.ts";

const root = new URL("../", import.meta.url);

test("uses only the current timetable upload response contract", async () => {
  const [component, contract] = await Promise.all([
    readFile(new URL("app/components/CourseUploadPage.tsx", root), "utf8"),
    readFile(new URL("app/lib/course-uploads.ts", root), "utf8"),
  ]);

  assert.match(component, /AdminLoginNotice/);
  const responseType = contract.match(
    /export type TimetableUploadResponse = \{([\s\S]*?)\n\};/,
  )?.[1] ?? "";
  const fields = [...responseType.matchAll(/^\s{2}([A-Za-z]\w*)\??:/gm)]
    .map((match) => match[1]);
  assert.deepEqual(fields, [
    "importId",
    "storageStatus",
    "databaseChanged",
    "offeringCount",
    "message",
    "reviewIssues",
  ]);
  assert.doesNotMatch(
    responseType,
    /\b(fileName|curriculumType|academicYear|semester|parseStatus|confidence|forwarded|statistics|springStatusCode):/,
  );

  const response = {
    importId: "a3f04b56-21b8-4da3-b6dd-2e6fd0325358",
    storageStatus: "STORED",
    databaseChanged: true,
    offeringCount: 918,
    message: "2026학년도 1학기 전공 강좌 저장 완료",
    reviewIssues: [],
  };
  assert.deepEqual(parseCourseUploadResponse("major", response), {
    kind: "major",
    ...response,
  });
});
