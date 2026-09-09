const LEGACY_API_HOSTNAME = "34.64.250.12";
const LEGACY_API_PORT = "8080";

export function normalizeApiResourceUrl(value: string, apiBaseUrl: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  if (
    url.protocol !== "http:" ||
    url.hostname !== LEGACY_API_HOSTNAME ||
    url.port !== LEGACY_API_PORT
  ) {
    return value;
  }

  return `${apiBaseUrl}${url.pathname}${url.search}${url.hash}`;
}

export function normalizeApiPayload(
  value: unknown,
  apiBaseUrl: string,
  fieldName?: string,
): unknown {
  // Click destinations are user data, not API-hosted assets. Rewriting them
  // would silently change where a poster sends the user.
  if (typeof value === "string") {
    return fieldName === "linkUrl" ? value : normalizeApiResourceUrl(value, apiBaseUrl);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeApiPayload(entry, apiBaseUrl, fieldName));
  }
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      normalizeApiPayload(entry, apiBaseUrl, key),
    ]),
  );
}
