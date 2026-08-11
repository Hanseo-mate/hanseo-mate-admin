import { clearAdminSession, getAdminAccessToken } from "./auth";
import { createApiHeaders, isAdminApiPath } from "./request-headers";

export const API_BASE_URL = (
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://34.64.250.12:8080"
).replace(/\/$/, "");

export class ApiError extends Error {
  status: number;
  payload: unknown;

  constructor(message: string, status = 0, payload: unknown = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function getRequestFailureMessage(status: number, path: string) {
  if (status === 400 || status === 422) {
    return "입력한 내용이나 선택한 파일을 확인해 주세요.";
  }
  if (status === 401) {
    return path === "/api/auth/login"
      ? "아이디 또는 비밀번호를 확인해 주세요."
      : "로그인이 만료되었습니다. 다시 로그인해 주세요.";
  }
  if (status === 403) {
    return "이 작업을 진행할 권한이 없습니다.";
  }
  if (status === 404) {
    return "요청한 정보를 찾을 수 없습니다.";
  }
  if (status === 408 || status === 504) {
    return "처리 시간이 오래 걸리고 있습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (status === 409) {
    return "이미 처리된 내용이거나 현재 상태에서는 진행할 수 없습니다.";
  }
  if (status === 413) {
    return "파일 용량이 너무 큽니다. 허용된 크기 안의 파일을 선택해 주세요.";
  }
  if (status === 415) {
    return "지원하지 않는 파일 형식입니다. 파일 형식을 확인해 주세요.";
  }
  if (status === 429) {
    return "요청이 많아 잠시 처리할 수 없습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (status >= 500) {
    return "일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

export function assertBrowserApiAccess() {
  if (typeof window === "undefined") return;

  if (window.location.protocol === "https:" && API_BASE_URL.startsWith("http://")) {
    throw new ApiError(
      "현재 접속 환경에서는 요청을 보낼 수 없습니다. 시스템 담당자에게 문의해 주세요.",
    );
  }
}

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  assertBrowserApiAccess();

  const isAdminRequest = isAdminApiPath(path);
  const accessToken = isAdminRequest ? getAdminAccessToken() : null;
  const headers = createApiHeaders(path, init.headers, accessToken);

  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, { ...init, headers });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new ApiError("처리 시간이 오래 걸리고 있습니다. 잠시 후 다시 시도해 주세요.");
    }
    throw new ApiError(
      "서비스에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해 주세요.",
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload = response.status === 204
    ? null
    : contentType.includes("application/json")
      ? await response.json().catch(() => null)
      : await response.text().catch(() => null);

  if (!response.ok) {
    if (isAdminRequest && response.status === 401) {
      clearAdminSession();
    }
    throw new ApiError(
      getRequestFailureMessage(response.status, path),
      response.status,
      payload,
    );
  }

  return payload as T;
}

export function getErrorText(error: unknown): string {
  return error instanceof ApiError ||
    (error instanceof Error && error.name === "UserFacingError")
    ? error.message
    : "요청을 처리하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
}
