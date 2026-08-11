import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("sends the required author with new and updated notices", async () => {
  const [newNotice, manageNotice] = await Promise.all([
    readFile(new URL("app/notices/new/page.tsx", root), "utf8"),
    readFile(new URL("app/notices/manage/page.tsx", root), "utf8"),
  ]);

  assert.match(newNotice, /JSON\.stringify\(\{\s*title:\s*trimmedTitle,\s*author:\s*trimmedAuthor,\s*content:\s*trimmedContent\s*\}\)/s);
  assert.match(manageNotice, /JSON\.stringify\(\{\s*title:\s*trimmedTitle,\s*author:\s*trimmedAuthor,\s*content:\s*trimmedContent\s*\}\)/s);
});

test("loads the administrator notice list and selected notice detail", async () => {
  const source = await readFile(
    new URL("app/notices/manage/page.tsx", root),
    "utf8",
  );

  assert.match(source, /`\/api\/admin\/notices\?page=\$\{page\}`/);
  assert.match(source, /`\/api\/admin\/notices\/\$\{[^}]+\}`/);
  assert.match(source, /items:\s*Notice\[\]/);
  assert.match(source, /totalPages:\s*number/);
  assert.match(source, /hasNext:\s*boolean/);
});

test("uses only the current timetable upload response contract", async () => {
  const source = await readFile(
    new URL("app/components/CourseUploadPage.tsx", root),
    "utf8",
  );

  assert.match(source, /AdminLoginNotice/);
  assert.match(source, /storageStatus:/);
  assert.match(source, /databaseChanged:/);
  assert.match(source, /offeringCount:/);
  assert.match(source, /reviewIssues:/);
  const responseType = source.match(/type UploadResponse = \{([\s\S]*?)\n\};/)?.[1] ?? "";
  assert.doesNotMatch(
    responseType,
    /\b(fileName|curriculumType|academicYear|semester|parseStatus|confidence|forwarded|statistics|springStatusCode):/,
  );
});
