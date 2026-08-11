"use client";

import Link from "next/link";
import { type ReactNode, useEffect, useState } from "react";
import {
  ADMIN_SESSION_EVENT,
  getAdminSession,
} from "../lib/auth";

type AdminLoginNoticeProps = {
  returnTo: string;
  children?: ReactNode;
};

export function AdminLoginNotice({ returnTo, children }: AdminLoginNoticeProps) {
  const [hasSession, setHasSession] = useState<boolean | null>(null);

  useEffect(() => {
    const update = () => setHasSession(Boolean(getAdminSession()));
    update();
    window.addEventListener(ADMIN_SESSION_EVENT, update);
    return () => window.removeEventListener(ADMIN_SESSION_EVENT, update);
  }, []);

  if (hasSession === null) {
    return (
      <section className="notice-callout admin-login-notice" role="status">
        <div className="callout-icon" aria-hidden="true">i</div>
        <div>
          <strong>로그인 상태를 확인하고 있습니다.</strong>
          <p>잠시만 기다려 주세요.</p>
        </div>
      </section>
    );
  }
  if (hasSession) return children ?? null;

  return (
    <section className="notice-callout admin-login-notice" role="status">
      <div className="callout-icon" aria-hidden="true">i</div>
      <div>
        <strong>관리자 로그인이 필요합니다.</strong>
        <p>로그인하면 하던 작업으로 바로 돌아올 수 있습니다.</p>
      </div>
      <Link className="button button-primary" href={`/login?returnTo=${encodeURIComponent(returnTo)}`}>
        로그인하기
      </Link>
    </section>
  );
}
