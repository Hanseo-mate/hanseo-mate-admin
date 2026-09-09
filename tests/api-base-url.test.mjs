import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeApiPayload,
  normalizeApiResourceUrl,
} from "../app/lib/api-resource-urls.ts";

const API_BASE_URL = "https://api.hsmate.win";

test("upgrades legacy API asset URLs to the configured HTTPS API", () => {
  assert.equal(
    normalizeApiResourceUrl(
      "http://34.64.250.12:8080/uploads/bus/schedule.png?version=2\n",
      API_BASE_URL,
    ),
    `${API_BASE_URL}/uploads/bus/schedule.png?version=2`,
  );
});

test("leaves unrelated resource URLs unchanged", () => {
  const resourceUrl = "https://cdn.example.com/image.png";
  assert.equal(normalizeApiResourceUrl(resourceUrl, API_BASE_URL), resourceUrl);
});

test("never rewrites poster click destinations as API asset URLs", () => {
  const linkUrl = "http://34.64.250.12:8080/events/welcome";
  assert.deepEqual(
    normalizeApiPayload(
      { imageUrl: `${linkUrl}.png`, linkUrl },
      API_BASE_URL,
    ),
    {
      imageUrl: `${API_BASE_URL}/events/welcome.png`,
      linkUrl,
    },
  );
});
