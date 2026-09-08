export function isAdminApiPath(path: string) {
  return path.startsWith("/api/admin/") ||
    path === "/api/v1/timetables/major" ||
    path === "/api/v1/timetables/general-education";
}

export function createApiHeaders(
  path: string,
  initialHeaders: HeadersInit | undefined,
  accessToken: string | null,
) {
  const headers = new Headers(initialHeaders);
  if (!headers.has("Accept")) {
    headers.set("Accept", "application/json");
  }
  if (isAdminApiPath(path) && accessToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return headers;
}
