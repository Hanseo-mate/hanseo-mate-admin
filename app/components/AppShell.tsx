"use client";

import type { IconProps } from "@phosphor-icons/react";
import {
  Browser,
  Broadcast,
  Bus,
  CalendarDots,
  CaretRight,
  ChatText,
  DeviceMobile,
  FlagBanner,
  ImageSquare,
  List,
  LinkSimple,
  MapTrifold,
  Megaphone,
  Plus,
  ShieldCheck,
  SignOut,
  SquaresFour,
  UploadSimple,
  UsersThree,
  X,
} from "@phosphor-icons/react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ComponentType, useEffect, useState } from "react";
import {
  ADMIN_SESSION_EVENT,
  type AdminSession,
  getAdminSession,
  requestAdminLogout,
} from "../lib/auth";

type NavigationItem = {
  href: string;
  label: string;
  icon: ComponentType<IconProps>;
  matches?: string[];
};

type NavigationGroup = {
  label: string;
  items: NavigationItem[];
};

type PageInfo = {
  title: string;
  description: string;
  section: string;
  action?: { href: string; label: string };
};

const navigation: NavigationGroup[] = [
  {
    label: "운영 현황",
    items: [{ href: "/", label: "대시보드", icon: SquaresFour }],
  },
  {
    label: "운영 관리",
    items: [
      {
        href: "/settings/app-updates",
        label: "앱 업데이트",
        icon: DeviceMobile,
      },
    ],
  },
  {
    label: "콘텐츠 운영",
    items: [
      {
        href: "/notices/manage",
        label: "학생회 공지",
        icon: Megaphone,
        matches: ["/notices/manage", "/notices/new"],
      },
      {
        href: "/system-notices/manage",
        label: "시스템 공지",
        icon: Broadcast,
      },
      {
        href: "/settings/links",
        label: "각종 링크",
        icon: LinkSimple,
      },
      {
        href: "/settings/home-message",
        label: "메인페이지 메시지",
        icon: ChatText,
      },
      { href: "/calendars/manage", label: "학생회 일정", icon: CalendarDots },
      { href: "/posters/manage", label: "홈 포스터", icon: ImageSquare },
      { href: "/popups/manage", label: "팝업 관리", icon: Browser },
      {
        href: "/settings/festival-floating-button",
        label: "축제 플로팅 버튼",
        icon: FlagBanner,
      },
    ],
  },
  {
    label: "교통 정보",
    items: [
      {
        href: "/bus-schedules/manage",
        label: "버스 시간표",
        icon: Bus,
      },
    ],
  },
  {
    label: "캠퍼스 안내",
    items: [
      {
        href: "/campus-map/manage",
        label: "캠퍼스맵",
        icon: MapTrifold,
      },
    ],
  },
  {
    label: "학사 데이터",
    items: [
      {
        href: "/courses/major",
        label: "강의시간표 업로드",
        icon: UploadSimple,
        matches: ["/courses/major", "/courses/general"],
      },
      {
        href: "/courses/equivalent",
        label: "동일교과목 업로드",
        icon: UploadSimple,
      },
      {
        href: "/courses/cross-major",
        label: "타학과 전공인정 업로드",
        icon: UploadSimple,
      },
    ],
  },
  {
    label: "동아리 운영",
    items: [
      {
        href: "/clubs/manage",
        label: "동아리 관리",
        icon: UsersThree,
        matches: ["/clubs/manage", "/clubs/new"],
      },
    ],
  },
];

const pageTitles: Record<string, PageInfo> = {
  "/": {
    title: "운영 대시보드",
    description: "학생회 콘텐츠와 학사 데이터의 현재 운영 현황을 확인합니다.",
    section: "운영 현황",
  },
  "/posters/manage": {
    title: "홈 포스터",
    description: "앱 홈 화면에 사용할 포스터 이미지와 클릭 링크를 등록하고 관리합니다.",
    section: "콘텐츠 운영",
  },
  "/popups/manage": {
    title: "팝업 관리",
    description: "앱에 노출할 팝업의 내용과 게시 기간을 등록하고 관리합니다.",
    section: "콘텐츠 운영",
  },
  "/settings/festival-floating-button": {
    title: "축제 플로팅 버튼",
    description: "앱 홈의 대동제 바로가기 버튼 노출 여부를 관리합니다.",
    section: "콘텐츠 운영",
  },
  "/settings/app-updates": {
    title: "앱 업데이트",
    description: "iOS와 Android의 최신 빌드, 최소 지원 빌드와 스토어 업데이트 정책을 관리합니다.",
    section: "운영 관리",
  },
  "/notices/new": {
    title: "학생회 공지 등록",
    description: "학생회에서 직접 게시할 공지 내용과 파일을 등록합니다.",
    section: "학생회 공지",
  },
  "/notices/manage": {
    title: "학생회 공지",
    description: "등록된 공지를 조회하고 내용과 첨부파일을 관리합니다.",
    section: "콘텐츠 운영",
    action: { href: "/notices/new", label: "학생회 공지 등록" },
  },
  "/system-notices/manage": {
    title: "시스템 공지",
    description: "앱 이용 중 안내할 점검·업데이트 소식을 등록하고 관리합니다.",
    section: "콘텐츠 운영",
  },
  "/settings/links": {
    title: "각종 링크",
    description: "학교생활에 필요한 외부 링크를 등록하고 관리합니다.",
    section: "콘텐츠 운영",
  },
  "/settings/home-message": {
    title: "메인페이지 메시지",
    description: "앱 홈에 표시할 공통 메시지를 설정합니다.",
    section: "콘텐츠 운영",
  },
  "/calendars/manage": {
    title: "학생회 일정",
    description: "학생회 일정을 날짜별로 확인하고 등록, 수정, 삭제합니다.",
    section: "콘텐츠 운영",
  },
  "/bus-schedules/manage": {
    title: "버스 시간표",
    description: "시내버스 3개 운행 구간의 시간표 사진을 등록하고 교체합니다.",
    section: "교통 정보",
  },
  "/campus-map/manage": {
    title: "캠퍼스맵",
    description: "두 캠퍼스의 음식점, 카페, 강의건물과 편의시설을 등록하고 관리합니다.",
    section: "캠퍼스 안내",
  },
  "/clubs/new": {
    title: "동아리 등록",
    description: "새 동아리의 이름과 분과를 등록합니다.",
    section: "동아리 운영",
  },
  "/clubs/manage": {
    title: "동아리 관리",
    description: "동아리 정보와 소개, 이미지를 조회하고 관리합니다.",
    section: "동아리 운영",
    action: { href: "/clubs/new", label: "동아리 등록" },
  },
  "/login": {
    title: "관리자 로그인",
    description: "관리자 권한이 있는 계정으로 로그인합니다.",
    section: "계정",
  },
  "/courses/major": {
    title: "강의시간표 업로드",
    description: "전공 또는 교양 강의시간표 파일을 분석해 강좌 데이터를 반영합니다.",
    section: "학사 데이터",
  },
  "/courses/general": {
    title: "강의시간표 업로드",
    description: "전공 또는 교양 강의시간표 파일을 분석해 강좌 데이터를 반영합니다.",
    section: "학사 데이터",
  },
  "/courses/equivalent": {
    title: "동일교과목 업로드",
    description: "서로 같은 과목으로 인정되는 교과목 정보를 엑셀 파일로 등록합니다.",
    section: "학사 데이터",
  },
  "/courses/cross-major": {
    title: "타학과 전공인정 업로드",
    description: "다른 학과 과목의 전공 인정 기준을 엑셀 파일로 등록합니다.",
    section: "학사 데이터",
  },
};

function normalizePath(pathname: string) {
  return pathname === "/" ? pathname : pathname.replace(/\/$/, "");
}

function isItemActive(pathname: string, item: NavigationItem) {
  const paths = item.matches ?? [item.href];
  return paths.some((path) => path === "/" ? pathname === "/" : pathname.startsWith(path));
}

function BrandIcon() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <Image
        className="brand-mark-image"
        src="/clock-01.png"
        alt=""
        width={1024}
        height={1024}
        sizes="34px"
      />
    </span>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = normalizePath(usePathname());
  const [menuOpen, setMenuOpen] = useState(false);
  const [adminSession, setAdminSession] = useState<AdminSession | null>(null);
  const [sessionChecked, setSessionChecked] = useState(false);
  const currentPage = pageTitles[pathname] ?? {
    title: "관리자",
    description: "한서메이트 운영 업무를 관리합니다.",
    section: "관리자",
  };

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
    if (requestAdminLogout()) setAdminSession(null);
  }

  if (pathname === "/login") {
    return (
      <div className="auth-shell">
        <header className="auth-header">
          <Link className="brand-block brand-block-auth" href="/" aria-label="한서메이트 관리자 홈">
            <BrandIcon />
            <span className="brand-copy">
              <strong>한서메이트</strong>
              <small>관리자</small>
            </span>
          </Link>
        </header>
        <main className="auth-content">{children}</main>
      </div>
    );
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
        <div className="sidebar-header">
          <Link className="brand-block" href="/" aria-label="한서메이트 관리자 홈">
            <BrandIcon />
            <span className="brand-copy">
              <strong>한서메이트</strong>
              <small>관리자</small>
            </span>
          </Link>
          <button
            className="sidebar-close"
            type="button"
            aria-label="메뉴 닫기"
            onClick={() => setMenuOpen(false)}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="관리자 메뉴">
          {navigation.map((group) => (
            <div className="nav-group" key={group.label}>
              <p>{group.label}</p>
              <div className="nav-group-items">
                {group.items.map((item) => {
                  const active = isItemActive(pathname, item);
                  const Icon = item.icon;
                  return (
                    <Link
                      className={`nav-link ${active ? "active" : ""}`}
                      href={item.href}
                      key={item.href}
                      aria-current={active ? "page" : undefined}
                      onClick={() => setMenuOpen(false)}
                    >
                      <Icon size={18} weight="regular" aria-hidden="true" />
                      <span>{item.label}</span>
                      {active && <CaretRight className="nav-active-arrow" size={14} aria-hidden="true" />}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <ShieldCheck size={17} aria-hidden="true" />
          <span>관리자 전용 운영 콘솔</span>
        </div>
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
              <List size={21} aria-hidden="true" />
            </button>
            <div>
              <div className="topbar-breadcrumb">
                <span>{currentPage.section}</span>
                <CaretRight size={12} aria-hidden="true" />
                <span aria-current="page">{currentPage.title}</span>
              </div>
              <h1>{currentPage.title}</h1>
              <p>{currentPage.description}</p>
            </div>
          </div>

          <div className="topbar-actions">
            {currentPage.action && (
              <Link className="button button-primary topbar-primary-action" href={currentPage.action.href}>
                <Plus size={17} weight="bold" aria-hidden="true" />
                {currentPage.action.label}
              </Link>
            )}
            <div className="topbar-account">
              {!sessionChecked ? (
                <span className="topbar-account-status">로그인 확인 중</span>
              ) : adminSession ? (
                <>
                  <div className="topbar-account-copy">
                    <span>관리자 계정</span>
                    <strong>{adminSession.loginId}</strong>
                  </div>
                  <button
                    className="icon-button"
                    type="button"
                    onClick={handleLogout}
                    aria-label="로그아웃"
                    title="로그아웃"
                  >
                    <SignOut size={19} aria-hidden="true" />
                  </button>
                </>
              ) : (
                <Link className="button button-secondary" href={`/login?returnTo=${encodeURIComponent(pathname)}`}>
                  로그인
                </Link>
              )}
            </div>
          </div>
        </header>

        <main className="page-content">{children}</main>
      </div>
    </div>
  );
}
