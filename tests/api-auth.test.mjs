import assert from "node:assert/strict";
import test from "node:test";
import { createApiHeaders, isAdminApiPath } from "../app/lib/request-headers.ts";

test("recognizes every administrator API path", () => {
  assert.equal(isAdminApiPath("/api/admin/notices"), true);
  assert.equal(isAdminApiPath("/api/admin/notices/7"), true);
  assert.equal(isAdminApiPath("/api/admin/system-notices"), true);
  assert.equal(isAdminApiPath("/api/admin/system-notices/7"), true);
  assert.equal(isAdminApiPath("/api/admin/bus-schedules"), true);
  assert.equal(isAdminApiPath("/api/admin/campus-map/places"), true);
  assert.equal(isAdminApiPath("/api/admin/campus-map/place-images"), true);
  assert.equal(isAdminApiPath("/api/admin/popups"), true);
  assert.equal(isAdminApiPath("/api/admin/popups/7"), true);
  assert.equal(isAdminApiPath("/api/admin/popups/7/enabled"), true);
  assert.equal(isAdminApiPath("/api/bus-schedules"), false);
  assert.equal(isAdminApiPath("/api/campus-map/places"), false);
  assert.equal(isAdminApiPath("/api/admin/clubs"), true);
  assert.equal(isAdminApiPath("/api/v1/timetables/major"), true);
  assert.equal(isAdminApiPath("/api/v1/timetables/general-education"), true);
  assert.equal(
    isAdminApiPath("/api/admin/course-enrichments/equivalent-courses/imports"),
    true,
  );
  assert.equal(
    isAdminApiPath("/api/admin/course-enrichments/cross-major-recognitions/imports"),
    true,
  );
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

test("adds the saved bearer token to system notice JSON requests", () => {
  for (const path of [
    "/api/admin/system-notices",
    "/api/admin/system-notices/7",
  ]) {
    const headers = createApiHeaders(
      path,
      { "Content-Type": "application/json" },
      "system-notice-test-token",
    );

    assert.equal(headers.get("Authorization"), "Bearer system-notice-test-token");
    assert.equal(headers.get("Accept"), "application/json");
    assert.equal(headers.get("Content-Type"), "application/json");
  }
});

test("adds auth to bus schedule uploads without overriding the form boundary", () => {
  const headers = createApiHeaders(
    "/api/admin/bus-schedules",
    undefined,
    "bus-schedule-test-token",
  );

  assert.equal(headers.get("Authorization"), "Bearer bus-schedule-test-token");
  assert.equal(headers.get("Accept"), "application/json");
  assert.equal(headers.has("Content-Type"), false);
});

test("adds auth to campus place images without overriding the form boundary", () => {
  const headers = createApiHeaders(
    "/api/admin/campus-map/place-images",
    undefined,
    "campus-map-test-token",
  );

  assert.equal(headers.get("Authorization"), "Bearer campus-map-test-token");
  assert.equal(headers.get("Accept"), "application/json");
  assert.equal(headers.has("Content-Type"), false);
});

test("adds auth to popup multipart requests without overriding the form boundary", () => {
  for (const path of [
    "/api/admin/popups",
    "/api/admin/popups/7",
  ]) {
    const headers = createApiHeaders(path, undefined, "popup-test-token");

    assert.equal(headers.get("Authorization"), "Bearer popup-test-token");
    assert.equal(headers.get("Accept"), "application/json");
    assert.equal(headers.has("Content-Type"), false);
  }

  const enabledHeaders = createApiHeaders(
    "/api/admin/popups/7/enabled",
    { "Content-Type": "application/json" },
    "popup-test-token",
  );
  assert.equal(enabledHeaders.get("Authorization"), "Bearer popup-test-token");
  assert.equal(enabledHeaders.get("Accept"), "application/json");
  assert.equal(enabledHeaders.get("Content-Type"), "application/json");
});

test("keeps an explicitly supplied authorization header", () => {
  const headers = createApiHeaders(
    "/api/admin/notices",
    { Authorization: "Bearer explicit-token" },
    "saved-token",
  );

  assert.equal(headers.get("Authorization"), "Bearer explicit-token");
});

test("adds the saved bearer token to academic-data FormData uploads", () => {
  const formData = new FormData();
  formData.append("file", new Blob(["course data"]), "courses.xlsx");

  for (const path of [
    "/api/v1/timetables/major",
    "/api/v1/timetables/general-education",
    "/api/admin/course-enrichments/equivalent-courses/imports",
    "/api/admin/course-enrichments/cross-major-recognitions/imports",
  ]) {
    const requestInit = { method: "POST", body: formData };
    const headers = createApiHeaders(path, requestInit.headers, "upload-test-token");

    assert.equal(headers.get("Authorization"), "Bearer upload-test-token");
    assert.equal(headers.get("Accept"), "application/json");
    assert.equal(headers.has("Content-Type"), false);
  }
});
