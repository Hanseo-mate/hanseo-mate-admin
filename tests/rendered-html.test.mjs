import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const exportedPages = [
  { path: "out/index.html", text: "운영 대시보드" },
  { path: "out/posters/manage/index.html", text: "홈 포스터" },
  { path: "out/popups/manage/index.html", text: "팝업 관리" },
  { path: "out/settings/festival-floating-button/index.html", text: "축제 플로팅 버튼" },
  { path: "out/notices/new/index.html", text: "공지 등록" },
  { path: "out/notices/manage/index.html", text: "학생회 공지" },
  { path: "out/system-notices/manage/index.html", text: "시스템 공지" },
  { path: "out/calendars/manage/index.html", text: "학생회 일정" },
  { path: "out/bus-schedules/manage/index.html", text: "버스 시간표" },
  { path: "out/campus-map/manage/index.html", text: "캠퍼스맵" },
  { path: "out/clubs/new/index.html", text: "동아리 등록" },
  { path: "out/clubs/manage/index.html", text: "동아리 관리" },
  { path: "out/login/index.html", text: "관리자 로그인" },
  { path: "out/courses/major/index.html", text: "강의시간표 업로드" },
  { path: "out/courses/general/index.html", text: "강의시간표 업로드" },
  { path: "out/courses/equivalent/index.html", text: "동일교과목 업로드" },
  { path: "out/courses/cross-major/index.html", text: "타학과 전공인정 업로드" },
];

function visibleDocument(html) {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--.*?-->/gs, " ");
}

test("exports every requested admin route", async () => {
  for (const page of exportedPages) {
    const html = await readFile(new URL(page.path, root), "utf8");
    const visibleTextHtml = html.replace(/<!--.*?-->/g, "");
    assert.match(visibleTextHtml, /한서메이트/);
    assert.match(visibleTextHtml, new RegExp(page.text));
    assert.doesNotMatch(visibleTextHtml, /codex-preview|Your site is taking shape|SkeletonPreview/);
  }
});

test("exports the live operations dashboard instead of the old shortcut-card landing page", async () => {
  const html = await readFile(new URL("out/index.html", root), "utf8");

  assert.match(html, /운영 대시보드/);
  assert.doesNotMatch(html, /관리할 업무를 선택하세요|quick-action-grid/);
});

test("exports the new academic upload pages without developer jargon", async () => {
  for (const page of [
    { path: "out/courses/equivalent/index.html", title: "동일교과목 업로드" },
    { path: "out/courses/cross-major/index.html", title: "타학과 전공인정 업로드" },
  ]) {
    const html = await readFile(new URL(page.path, root), "utf8");
    const visibleHtml = visibleDocument(html);
    assert.match(visibleHtml, new RegExp(page.title));
    assert.match(visibleHtml, /로그인 상태를 확인하고 있습니다/);
    assert.doesNotMatch(
      visibleHtml,
      /JWT|Bearer|multipart|Content-Type|storageStatus|databaseChanged|importId|ADMIN 권한|API 주소/,
    );
  }
});

test("keeps the club list based editing workflow easy to understand", async () => {
  const source = await readFile(new URL("app/clubs/manage/page.tsx", root), "utf8");
  assert.match(source, /동아리 이름 검색/);
  assert.match(source, /목록에서 동아리를 선택하면 기존 소개와 사진을 불러옵니다/);
  assert.doesNotMatch(source, /이름 또는 ID 검색|별도 이미지 API|새 정보로 전체 입력/);
});

test("does not show implementation jargon in staff-facing copy", async () => {
  const sources = await Promise.all([
    "app/components/AppShell.tsx",
    "app/page.tsx",
    "app/login/page.tsx",
    "app/components/AdminLoginNotice.tsx",
    "app/components/CourseUploadPage.tsx",
    "app/posters/manage/page.tsx",
    "app/popups/manage/page.tsx",
    "app/settings/festival-floating-button/page.tsx",
    "app/notices/new/page.tsx",
    "app/notices/manage/page.tsx",
    "app/system-notices/manage/page.tsx",
    "app/calendars/manage/page.tsx",
    "app/bus-schedules/manage/page.tsx",
    "app/campus-map/manage/page.tsx",
    "app/clubs/new/page.tsx",
    "app/clubs/manage/page.tsx",
  ].map((path) => readFile(new URL(path, root), "utf8")));

  const combined = sources.join("\n");
  assert.doesNotMatch(
    combined,
    /동아리 관리자 API|ADMIN 권한|로그인 토큰|서버 응답 코드|업로드 ID|데이터베이스에 저장|이름 또는 ID 검색|별도 이미지 API|새 정보로 전체 입력/,
  );
});

test("exports site metadata, brand icons, and social image", async () => {
  const html = await readFile(new URL("out/index.html", root), "utf8");
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /property="og:image" content="https:\/\/hsmate-admin\.web\.app\/og\.png"/);
  assert.match(html, /rel="icon" href="\/clock-01\.png"/);
  assert.match(html, /rel="apple-touch-icon" href="\/clock-01\.png"/);
  assert.match(html, /src="\/clock-01\.png"/);
  await Promise.all([
    access(new URL("out/og.png", root)),
    access(new URL("out/clock-01.png", root)),
  ]);
});

test("keeps deployment configuration aligned with static export and the production API", async () => {
  const [firebaseConfig, nextConfig, packageJson, apiSource, envExample] = await Promise.all([
    readFile(new URL("firebase.json", root), "utf8"),
    readFile(new URL("next.config.ts", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
    readFile(new URL("app/lib/api.ts", root), "utf8"),
    readFile(new URL(".env.example", root), "utf8"),
  ]);

  assert.match(firebaseConfig, /"public": "out"/);
  assert.match(firebaseConfig, /"trailingSlash": true/);
  assert.match(firebaseConfig, /connect-src 'self' https:\/\/api\.hsmate\.win/);
  assert.match(apiSource, /"https:\/\/api\.hsmate\.win"/);
  assert.equal(envExample.trim(), "NEXT_PUBLIC_API_BASE_URL=https://api.hsmate.win");
  assert.doesNotMatch(
    firebaseConfig + apiSource + envExample,
    /http:\/\/34\.64\.250\.12:8080/,
  );
  assert.match(nextConfig, /output: "export"/);
  assert.match(packageJson, /"name": "hsmate-admin"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
