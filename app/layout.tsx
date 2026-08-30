import type { Metadata } from "next";
import "./globals.css";
import "./theme.css";
import { AppShell } from "./components/AppShell";

export const metadata: Metadata = {
  metadataBase: new URL("https://hsmate-admin.web.app"),
  title: {
    default: "한서메이트 관리자",
    template: "%s | 한서메이트 관리자",
  },
  description: "학생회 공지, 시스템 공지, 일정, 버스 시간표, 캠퍼스맵, 홈 포스터, 동아리와 학사 자료를 관리하는 한서메이트 운영 콘솔입니다.",
  applicationName: "한서메이트 관리자",
  robots: { index: false, follow: false },
  openGraph: {
    type: "website",
    locale: "ko_KR",
    siteName: "한서메이트 관리자",
    title: "한서메이트 관리자",
    description: "학생회 공지, 시스템 공지, 일정, 버스 시간표, 캠퍼스맵, 홈 포스터, 동아리와 학사 자료 관리",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "한서메이트 관리자 운영 콘솔",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "한서메이트 관리자",
    description: "학생회 공지, 시스템 공지, 일정, 버스 시간표, 캠퍼스맵, 홈 포스터, 동아리와 학사 자료 관리",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
