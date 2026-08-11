"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  ADMIN_SESSION_EVENT,
  type AdminSession,
  clearAdminSession,
  getAdminSession,
} from "../lib/auth";

type NavigationItem = {
  href: string;
  label: string;
};

type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

const navigation: NavigationGroup[] = [
  {
    label: "홈",
    items: [{ href: "/", label: "홈" }],
  },
  {
    label: "홈 화면 관리",
    items: [{ href: "/posters/manage", label: "포스터 관리" }],
  },
  {
    label: "공지 관리",
    items: [
      { href: "/notices/new", label: "공지 등록" },
      { href: "/notices/manage", label: "공지 수정·삭제" },
    ],
  },
  {
    label: "학생회 일정",
    items: [{ href: "/calendars/manage", label: "일정 관리" }],
  },
  {
    label: "동아리 관리",
    items: [
      { href: "/clubs/new", label: "동아리 등록" },
      { href: "/clubs/manage", label: "동아리 조회·수정" },
    ],
  },
  {
    label: "시간표 관리",
    items: [
      { href: "/courses/major", label: "전공 시간표 업로드" },
      { href: "/courses/general", label: "교양 시간표 업로드" },
    ],
  },
];

const pageTitles: Record<string, { title: string; description: string }> = {
  "/": { title: "홈", description: "필요한 관리 업무를 선택해 주세요." },
  "/posters/manage": { title: "포스터 관리", description: "한서메이트 메인 화면에 보여줄 포스터 이미지를 관리합니다." },
  "/notices/new": { title: "공지 등록", description: "학생회 공지를 작성해 등록합니다." },
  "/notices/manage": { title: "공지 수정·삭제", description: "목록에서 공지를 선택해 내용을 수정하거나 삭제합니다." },
  "/calendars/manage": { title: "학생회 일정 관리", description: "학생들에게 안내할 일정을 확인하고 등록하거나 수정합니다." },
  "/clubs/new": { title: "동아리 등록", description: "동아리 이름과 분과를 등록합니다." },
  "/clubs/manage": { title: "동아리 조회·수정", description: "목록에서 동아리를 선택해 정보와 사진을 관리합니다." },
  "/login": { title: "관리자 로그인", description: "포스터, 공지, 학생회 일정, 동아리, 시간표 관리에 사용할 계정으로 로그인합니다." },
  "/courses/major": { title: "전공 시간표 파일 업로드", description: "전공 시간표 엑셀 파일을 업로드합니다." },
  "/courses/general": { title: "교양 시간표 파일 업로드", description: "교양 시간표 엑셀 파일을 업로드합니다." },
};

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === href : pathname.startsWith(href);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const normalizedPath = pathname === "/" ? pathname : pathname.replace(/\/$/, "");
  const currentPage = pageTitles[normalizedPath] ?? pageTitles["/"];

  useEffect(() => {
    const updateSession = () => {
      setAdminSession(getAdminSession());
      setSessionChecked(true);
    };
    updateSession();
    window.addEventListener(ADMIN_SESSION_EVENT, updateSession);
    return () => window.removeEventListener(ADMIN_SESSION_EVENT, updateSession);
  }, []);

  function handleLogout() {
    clearAdminSession();
    setAdminSession(null);
  }

  return (
    <div className="admin-shell">
      <button
        className={`sidebar-scrim ${menuOpen ? "visible" : ""}`}
        type="button"
        aria-label="메뉴 닫기"
        onClick={() => setMenuOpen(false)}
      />

      <aside id="admin-sidebar" className={`sidebar ${menuOpen ? "open" : ""}`}>
        <div className="brand-block">
          <div className="brand-mark" aria-hidden="true">한</div>
          <div>
            <strong>한서메이트</strong>
            <span>학생회 관리 페이지</span>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="관리자 메뉴">
          {navigation.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              {group.items.map((item) => (
                <Link
                  className={`nav-link ${isActive(pathname, item.href) ? "active" : ""}`}
                  href={item.href}
                  key={item.href}
                  aria-current={isActive(pathname, item.href) ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          ))}
        </nav>

      </aside>

      <div className="admin-main">
        <header className="topbar">
          <div className="topbar-title">
            <button
              className="menu-button"
              type="button"
              aria-label="메뉴 열기"
              aria-expanded={menuOpen}
              aria-controls="admin-sidebar"
              onClick={() => setMenuOpen(true)}
            >
              <span />
              <span />
              <span />
            </button>
            <div>
              <h1>{currentPage.title}</h1>
              <p>{currentPage.description}</p>
            </div>
          </div>

          <div className="topbar-account">
            {!sessionChecked ? (
              <span className="topbar-account-status">로그인 확인 중...</span>
            ) : adminSession ? (
              <>
                <div className="topbar-account-copy">
                  <span>로그인한 계정</span>
                  <strong>{adminSession.loginId}</strong>
                </div>
                <button className="button button-secondary" type="button" onClick={handleLogout}>
                  로그아웃
                </button>
              </>
            ) : pathname !== "/login" ? (
              <Link className="button button-primary" href={`/login?returnTo=${encodeURIComponent(pathname)}`}>
                로그인
              </Link>
            ) : null}
          </div>
        </header>

        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
