export const ADMIN_SESSION_EVENT = "hsmate-admin-session-change";

const ADMIN_SESSION_KEY = "hsmate-admin-session";

export type AdminLoginResponse = {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  userId: number;
  loginId: string;
  role: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminSession = {
  accessToken: string;
  loginId: string;
  role: "ADMIN";
  expiresAt: number;
};

function notifySessionChange() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ADMIN_SESSION_EVENT));
  }
}

function removeStoredSession() {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(ADMIN_SESSION_KEY);
  } catch {
    // Storage can be unavailable in strict browser privacy modes.
  }
}

export function getAdminSession(): AdminSession | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = window.sessionStorage.getItem(ADMIN_SESSION_KEY);
    if (!raw) return null;

    const value = JSON.parse(raw) as Partial<AdminSession>;
    const valid =
      typeof value.accessToken === "string" &&
      value.accessToken.length > 0 &&
      typeof value.loginId === "string" &&
      value.loginId.length > 0 &&
      value.role === "ADMIN" &&
      typeof value.expiresAt === "number" &&
      value.expiresAt > Date.now();

    if (!valid) {
      removeStoredSession();
      return null;
    }

    return value as AdminSession;
  } catch {
    removeStoredSession();
    return null;
  }
}

export function saveAdminSession(response: AdminLoginResponse): AdminSession {
  if (response.role !== "ADMIN") {
    throw new Error("관리자 권한이 있는 계정으로 로그인해 주세요.");
  }
  if (!response.accessToken || !response.loginId) {
    throw new Error("로그인 응답에 필요한 계정 정보가 없습니다.");
  }

  const expiresIn = Number.isFinite(response.expiresIn)
    ? Math.max(0, response.expiresIn)
    : 0;
  const session: AdminSession = {
    accessToken: response.accessToken,
    loginId: response.loginId,
    role: "ADMIN",
    expiresAt: Date.now() + expiresIn * 1000,
  };

  window.sessionStorage.setItem(ADMIN_SESSION_KEY, JSON.stringify(session));
  notifySessionChange();
  return session;
}

export function clearAdminSession() {
  removeStoredSession();
  notifySessionChange();
}

export function getAdminAccessToken() {
  return getAdminSession()?.accessToken ?? null;
}
