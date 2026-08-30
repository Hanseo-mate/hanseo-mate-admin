"use client";

import { Info } from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
  type AdminLoginResponse,
  clearAdminSession,
  getAdminSession,
  saveAdminSession,
} from "../lib/auth";
import { ApiError, apiFetch, getErrorText } from "../lib/api";

function getReturnPath() {
  const value = new URLSearchParams(window.location.search).get("returnTo");
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\")) {
    return "/";
  }

  try {
    const target = new URL(value, window.location.origin);
    return target.origin === window.location.origin
      ? `${target.pathname}${target.search}${target.hash}`
      : "/";
  } catch {
    return "/";
  }
}

function getLoginErrorText(error: unknown) {
  if (error instanceof ApiError && error.status === 401) {
    return "아이디 또는 비밀번호가 올바르지 않습니다.";
  }
  if (error instanceof ApiError && error.status === 403) {
    return "이 계정으로는 관리 기능을 사용할 수 없습니다. 담당자에게 문의해 주세요.";
  }
  const message = getErrorText(error);
  return /API|ADMIN|HTTPS?|CORS|token|session|server|토큰|세션|서버/i.test(message)
    ? "로그인 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요."
    : message;
}

export default function AdminLoginPage() {
  const router = useRouter();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [currentLoginId, setCurrentLoginId] = useState<string | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const [returnPath, setReturnPath] = useState("/");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessionNotice, setSessionNotice] = useState("");

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setCurrentLoginId(getAdminSession()?.loginId ?? null);
      setReturnPath(getReturnPath());
      if (new URLSearchParams(window.location.search).get("expired") === "1") {
        setSessionNotice("로그인이 만료되었습니다. 계속하려면 다시 로그인해 주세요.");
      }
      setSessionChecked(true);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!loginId.trim() || !password) {
      setError("아이디와 비밀번호를 입력해 주세요.");
      return;
    }

    setBusy(true);
    try {
      const response = await apiFetch<AdminLoginResponse>("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: loginId.trim(), password }),
      });
      const session = saveAdminSession(response);
      setCurrentLoginId(session.loginId);
      setPassword("");
      router.push(getReturnPath());
    } catch (requestError) {
      setError(getLoginErrorText(requestError));
    } finally {
      setBusy(false);
    }
  }

  function handleLogout() {
    clearAdminSession();
    setCurrentLoginId(null);
    setLoginId("");
    setPassword("");
  }

  return (
    <div className="login-page-grid">
      <section className="panel login-panel">
        <div className="panel-heading panel-heading-border">
          <div>
            <span className="eyebrow dark">학생회 관리</span>
            <h2>관리자 로그인</h2>
            <p>학생회에서 사용하는 계정으로 로그인해 주세요.</p>
          </div>
        </div>

        {!sessionChecked ? (
          <p className="club-list-message" role="status">로그인 상태를 확인하고 있습니다.</p>
        ) : currentLoginId ? (
          <div className="logged-in-panel" role="status">
            <div>
              <span>로그인한 계정</span>
              <strong>{currentLoginId}</strong>
              <small>작업을 마친 뒤에는 로그아웃해 주세요.</small>
            </div>
            <div className="form-actions">
              <button className="button button-secondary" type="button" onClick={handleLogout}>
                로그아웃
              </button>
              <Link className="button button-primary" href={returnPath}>
                이전 작업으로 돌아가기
              </Link>
            </div>
          </div>
        ) : (
          <form className="admin-form" onSubmit={handleSubmit}>
            {sessionNotice && (
              <div className="notice-callout" role="status">
                <div className="callout-icon" aria-hidden="true"><Info size={18} /></div>
                <div>
                  <strong>로그인이 만료되었습니다.</strong>
                  <p>{sessionNotice}</p>
                </div>
              </div>
            )}
            {error && (
              <div className="feedback feedback-error" role="alert">
                <strong>로그인할 수 없습니다.</strong>
                <span>{error}</span>
              </div>
            )}

            <label className="field-group">
              <span className="field-label">아이디 <em>필수</em></span>
              <input
                type="text"
                value={loginId}
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                placeholder="아이디 입력"
                disabled={busy}
                onChange={(event) => setLoginId(event.target.value)}
                required
              />
            </label>

            <label className="field-group">
              <span className="field-label">비밀번호 <em>필수</em></span>
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                placeholder="비밀번호"
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </label>

            <div className="form-actions form-actions-end">
              <button className="button button-primary" type="submit" disabled={busy}>
                {busy ? "로그인 중..." : "로그인"}
              </button>
            </div>
          </form>
        )}
      </section>

      <aside className="panel login-guide-panel">
        <h2>로그인 도움말</h2>
        <ol>
          <li><span>1</span><p>학생회에서 안내받은 아이디와 비밀번호를 입력해 주세요.</p></li>
          <li><span>2</span><p>공용 기기에서는 작업 후 꼭 로그아웃해 주세요.</p></li>
        </ol>
      </aside>
    </div>
  );
}
