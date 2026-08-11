import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

const exportedPages = [
  { path: "out/index.html", text: "빠른 작업" },
  { path: "out/posters/manage/index.html", text: "포스터 관리" },
  { path: "out/notices/new/index.html", text: "공지 등록" },
  { path: "out/notices/manage/index.html", text: "공지 수정·삭제" },
  { path: "out/calendars/manage/index.html", text: "학생회 일정 관리" },
  { path: "out/clubs/new/index.html", text: "동아리 등록" },
  { path: "out/clubs/manage/index.html", text: "동아리 조회·수정" },
  { path: "out/login/index.html", text: "관리자 로그인" },
  { path: "out/courses/major/index.html", text: "전공 시간표 파일 업로드" },
  { path: "out/courses/general/index.html", text: "교양 시간표 파일 업로드" },
];

test("exports every requested admin route", async () => {
  for (const page of exportedPages) {
    const html = await readFile(new URL(page.path, root), "utf8");
    const visibleTextHtml = html.replace(/<!--.*?-->/g, "");
    assert.match(visibleTextHtml, /한서메이트/);
    assert.match(visibleTextHtml, new RegExp(page.text));
    assert.doesNotMatch(visibleTextHtml, /codex-preview|Your site is taking shape|SkeletonPreview/);
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
    "app/login/page.tsx",
    "app/components/AdminLoginNotice.tsx",
    "app/components/CourseUploadPage.tsx",
    "app/posters/manage/page.tsx",
    "app/notices/new/page.tsx",
    "app/notices/manage/page.tsx",
    "app/calendars/manage/page.tsx",
    "app/clubs/new/page.tsx",
    "app/clubs/manage/page.tsx",
  ].map((path) => readFile(new URL(path, root), "utf8")));

  const combined = sources.join("\n");
  assert.doesNotMatch(
    combined,
    /동아리 관리자 API|ADMIN 권한|로그인 토큰|서버 응답 코드|업로드 ID|데이터베이스에 저장|이름 또는 ID 검색|별도 이미지 API|새 정보로 전체 입력/,
  );
});

test("exports site metadata and social image", async () => {
  const html = await readFile(new URL("out/index.html", root), "utf8");
  assert.match(html, /name="robots" content="noindex, nofollow"/);
  assert.match(html, /property="og:image" content="https:\/\/hsmate-admin\.web\.app\/og\.png"/);
  await access(new URL("out/og.png", root));
});

test("keeps Firebase Hosting configuration aligned with static export", async () => {
  const [firebaseConfig, nextConfig, packageJson] = await Promise.all([
    readFile(new URL("firebase.json", root), "utf8"),
    readFile(new URL("next.config.ts", root), "utf8"),
    readFile(new URL("package.json", root), "utf8"),
  ]);

  assert.match(firebaseConfig, /"public": "out"/);
  assert.match(firebaseConfig, /"trailingSlash": true/);
  assert.match(nextConfig, /output: "export"/);
  assert.match(packageJson, /"name": "hsmate-admin"/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
});
