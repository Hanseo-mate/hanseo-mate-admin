import assert from "node:assert/strict";
import test from "node:test";
import { createApiHeaders, isAdminApiPath } from "../app/lib/request-headers.ts";

test("recognizes every administrator API path", () => {
  assert.equal(isAdminApiPath("/api/admin/notices"), true);
  assert.equal(isAdminApiPath("/api/admin/notices/7"), true);
  assert.equal(isAdminApiPath("/api/admin/clubs"), true);
  assert.equal(isAdminApiPath("/api/v1/timetables/major"), true);
  assert.equal(isAdminApiPath("/api/v1/timetables/general-education"), true);
  assert.equal(isAdminApiPath("/api/clubs/7"), false);
  assert.equal(isAdminApiPath("/api/v1/timetables/major/preview"), false);
  assert.equal(
    isAdminApiPath("/api/v1/timetables/general-education/preview"),
    false,
  );
});

test("adds the saved bearer token to administrator notice requests", () => {
  const headers = createApiHeaders(
    "/api/admin/notices",
    { "Content-Type": "application/json" },
    "notice-test-token",
  );

  assert.equal(headers.get("Authorization"), "Bearer notice-test-token");
  assert.equal(headers.get("Accept"), "application/json");
});

test("keeps an explicitly supplied authorization header", () => {
  const headers = createApiHeaders(
    "/api/admin/notices",
    { Authorization: "Bearer explicit-token" },
    "saved-token",
  );

  assert.equal(headers.get("Authorization"), "Bearer explicit-token");
});

test("adds the saved bearer token to timetable FormData uploads", () => {
  const formData = new FormData();
  formData.append("file", new Blob(["course data"]), "courses.xlsx");

  for (const path of [
    "/api/v1/timetables/major",
    "/api/v1/timetables/general-education",
  ]) {
    const requestInit = { method: "POST", body: formData };
    const headers = createApiHeaders(path, requestInit.headers, "upload-test-token");

    assert.equal(headers.get("Authorization"), "Bearer upload-test-token");
    assert.equal(headers.get("Accept"), "application/json");
    assert.equal(headers.has("Content-Type"), false);
  }
});
