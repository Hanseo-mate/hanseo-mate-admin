import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const root = new URL("../", import.meta.url);
const shellUrl = new URL("app/components/AppShell.tsx", root);
const dashboardUrl = new URL("app/page.tsx", root);
const unsavedDialogUrl = new URL("app/components/UnsavedChangesDialog.tsx", root);
const authUrl = new URL("app/lib/auth.ts", root);

function navigationRegion(source) {
  const region = source.match(
    /const navigation:[\s\S]*?=\s*\[([\s\S]*?)\n\];\n\nconst pageTitles/,
  )?.[1];
  assert.ok(region, "관리자 메뉴 구성을 한곳에서 확인할 수 있어야 합니다.");
  return region;
}

function cssBlocks(source, selector) {
  const blocks = [];
  const rule = /([^{}]+)\{([^{}]*)\}/g;

  for (const match of source.matchAll(rule)) {
    const selectors = match[1].split(",").map((value) => value.trim());
    if (selectors.includes(selector)) blocks.push(match[2]);
  }
  return blocks;
}

function declarations(block) {
  return [...block.matchAll(/([\w-]+)\s*:\s*([^;{}]+);?/g)].map((match) => ({
    property: match[1].trim().toLowerCase(),
    value: match[2].trim(),
  }));
}

function customProperties(source) {
  const properties = new Map();
  for (const match of source.matchAll(/:root\s*\{([^{}]*)\}/g)) {
    const block = match[1];
    for (const declaration of declarations(block)) {
      if (declaration.property.startsWith("--")) {
        properties.set(declaration.property, declaration.value);
      }
    }
  }
  return properties;
}

function effectiveDeclaration(source, selector, names) {
  let result = null;
  for (const block of cssBlocks(source, selector)) {
    for (const declaration of declarations(block)) {
      if (names.includes(declaration.property)) result = declaration;
    }
  }
  return result;
}

function resolveCssVariables(value, properties) {
  let resolved = value;
  for (let index = 0; index < 12 && resolved.includes("var("); index += 1) {
    const next = resolved.replace(
      /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/g,
      (_match, name, fallback = "") => properties.get(name) ?? fallback,
    );
    if (next === resolved) break;
    resolved = next;
  }
  return resolved;
}

function colorChannels(value) {
  if (/\bwhite\b/i.test(value)) return [255, 255, 255];

  const hex = value.match(/#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})\b/i)?.[1];
  if (hex) {
    const normalized = hex.length === 3
      ? hex.split("").map((channel) => `${channel}${channel}`).join("")
      : hex.slice(0, 6);
    return [0, 2, 4].map((offset) => Number.parseInt(normalized.slice(offset, offset + 2), 16));
  }

  const rgb = value.match(/rgba?\(\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)\s*,\s*(\d+(?:\.\d+)?)/i);
  return rgb ? rgb.slice(1, 4).map(Number) : null;
}

function relativeLuminance(channels) {
  const linear = channels.map((channel) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function cappedListVariables(source) {
  const sourceFile = ts.createSourceFile(
    dashboardUrl.pathname,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const names = [];

  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer?.getText(sourceFile).includes(".slice(")
    ) {
      names.push(node.name.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return names;
}

test("organizes the shell around the real administrator information architecture", async () => {
  const [shell, clubNew, clubManage] = await Promise.all([
    readFile(shellUrl, "utf8"),
    readFile(new URL("app/clubs/new/page.tsx", root), "utf8"),
    readFile(new URL("app/clubs/manage/page.tsx", root), "utf8"),
  ]);
  const navigation = navigationRegion(shell);

  for (const group of ["운영 현황", "콘텐츠 운영", "교통 정보", "캠퍼스 안내", "학사 데이터"]) {
    assert.match(navigation, new RegExp(`label: ["']${group}["']`));
  }
  for (const item of [
    ["/", "대시보드"],
    ["/notices/manage", "학생회 공지"],
    ["/system-notices/manage", "시스템 공지"],
    ["/calendars/manage", "학생회 일정"],
    ["/posters/manage", "홈 포스터"],
    ["/popups/manage", "팝업 관리"],
    ["/settings/festival-floating-button", "축제 플로팅 버튼"],
    ["/bus-schedules/manage", "버스 시간표"],
    ["/campus-map/manage", "캠퍼스맵"],
    ["/courses/major", "강의시간표 업로드"],
    ["/courses/equivalent", "동일교과목 업로드"],
    ["/courses/cross-major", "타학과 전공인정 업로드"],
  ]) {
    assert.match(
      navigation,
      new RegExp(`href: ["']${item[0].replaceAll("/", "\\/")}["'],\\s*label: ["']${item[1]}["']`),
    );
  }

  assert.doesNotMatch(navigation, /도움말|전체 데이터 검색/);

  const hasDedicatedClubApi = /\/api\/admin\/clubs(?:[/?"'`]|$)/.test(`${clubNew}\n${clubManage}`);
  const exposesClubManagement = /href: ["']\/clubs\/manage["']/.test(navigation);
  assert.equal(
    exposesClubManagement,
    hasDedicatedClubApi,
    "동아리 전용 관리자 API가 저장소에 있을 때만 동아리 관리 메뉴를 노출해야 합니다.",
  );
  if (hasDedicatedClubApi) {
    assert.match(navigation, /label: ["']동아리 운영["']/);
    assert.match(navigation, /href: ["']\/clubs\/manage["'],\s*label: ["']동아리 관리["']/);
  }
});

test("protects unsaved work from links, history traversal, reloads, and logout", async () => {
  const [shell, dialog, auth] = await Promise.all([
    readFile(shellUrl, "utf8"),
    readFile(unsavedDialogUrl, "utf8"),
    readFile(authUrl, "utf8"),
  ]);

  assert.match(shell, /requestAdminLogout\(\)/);
  assert.match(auth, /ADMIN_LOGOUT_REQUEST_EVENT/);
  assert.match(auth, /new Event\(ADMIN_LOGOUT_REQUEST_EVENT,\s*\{\s*cancelable:\s*true\s*\}\)/);
  assert.match(auth, /if \(!window\.dispatchEvent\(request\)\) return false/);
  assert.match(dialog, /document\.addEventListener\("click",\s*protectInternalNavigation,\s*true\)/);
  assert.match(dialog, /addEventListener\(ADMIN_LOGOUT_REQUEST_EVENT,\s*protectLogout\)/);
  assert.match(dialog, /addEventListener\("beforeunload",\s*warnBeforeLeave\)/);
  assert.match(dialog, /event\.returnValue\s*=\s*""/);
  assert.match(dialog, /event\.navigationType\s*!==\s*"traverse"/);
  assert.match(dialog, /precommitHandler/);
});

test("loads dashboard metrics from the documented APIs without mock statistics", async () => {
  const source = await readFile(dashboardUrl, "utf8");

  assert.match(source, /^"use client";/);
  assert.match(source, /\bapiFetch\s*</);
  assert.doesNotMatch(source, /(?<!api)fetch\s*\(/);
  for (const endpoint of [
    "/api/admin/notices?page=0",
    "/api/admin/calendars",
    "/api/admin/home-posters",
  ]) {
    assert.ok(source.includes(endpoint), `${endpoint}의 실제 운영 데이터를 사용해야 합니다.`);
  }

  assert.match(source, /\btotalElements\b/);
  assert.match(source, /최근(?: 학생회)? 공지/);
  assert.match(source, /다가오는(?: 학생회)? 일정/);
  assert.match(source, /href=["'{`]\/courses\/(?:major|general)/);
  assert.match(source, /<AdminLoginNotice\b/);
  assert.match(source, /returnTo=["']\/["']/);

  assert.doesNotMatch(source, /\bconst\s+quickActions\s*=|관리할 업무를 선택하세요/);
  assert.doesNotMatch(source, /\bPromise\.all\s*\(/, "각 대시보드 API 실패를 독립적으로 처리해야 합니다.");
  assert.doesNotMatch(
    source,
    /(?:mock|sample|fake)(?:Data|Stats?|Activity)|월별 공지 증가|사용자 유입|최근 관리자 활동|업로드 성공률|시스템 상태|sparkline/i,
  );
  assert.doesNotMatch(source, /apiFetch[\s\S]{0,180}\/api\/v1\/timetables/);

  for (const name of cappedListVariables(source)) {
    assert.doesNotMatch(
      source,
      new RegExp(`countFormatter\\.format\\(\\s*${name}\\.length\\s*\\)`),
      `${name} 미리보기 제한을 전체 KPI 수치로 사용하면 안 됩니다.`,
    );
  }

  assert.match(source, /loading/i);
  assert.match(source, /error/i);
  assert.match(source, /등록된[^\n"'`]{0,30}없|예정된[^\n"'`]{0,30}없/);
});

test("keeps the shell free of fake alerts, fake profiles, and AI-service decoration", async () => {
  const [shell, dashboard] = await Promise.all([
    readFile(shellUrl, "utf8"),
    readFile(dashboardUrl, "utf8"),
  ]);
  const combined = `${shell}\n${dashboard}`;

  assert.doesNotMatch(shell, /\bBell(?:Ringing|Simple)?\b|notification|알림 센터|가짜 알림/i);
  assert.doesNotMatch(shell, /avatar|admin@example|김관리자|홍길동|최고 관리자/i);
  assert.match(shell, /adminSession\.loginId/);
  assert.doesNotMatch(shell, /<img\b[^>]*(?:profile|avatar)/i);

  assert.doesNotMatch(combined, /\b(?:Robot|Brain|Sparkle|MagicWand)\b|AI가|스마트 인사이트|챗봇/i);
  assert.doesNotMatch(navigationRegion(shell), /\p{Extended_Pictographic}/u);
});

test("uses a bright, restrained sidebar without gradients or glass effects", async () => {
  const [globals, theme, dashboard] = await Promise.all([
    readFile(new URL("app/globals.css", root), "utf8"),
    readFile(new URL("app/theme.css", root), "utf8"),
    readFile(new URL("app/dashboard.module.css", root), "utf8"),
  ]);
  const styles = `${globals}\n${theme}`;
  const sidebarBackground = effectiveDeclaration(styles, ".sidebar", ["background", "background-color"]);

  assert.ok(sidebarBackground, "사이드바 배경색을 명시해야 합니다.");
  const resolvedBackground = resolveCssVariables(
    sidebarBackground.value,
    customProperties(styles),
  );
  const channels = colorChannels(resolvedBackground);
  assert.ok(channels, `사이드바 배경색을 해석할 수 없습니다: ${resolvedBackground}`);
  assert.ok(
    relativeLuminance(channels) >= 0.75,
    `사이드바는 밝은 중성 표면이어야 합니다: ${resolvedBackground}`,
  );

  assert.match(styles, /\.sidebar\s*\{[^}]*border-right\s*:\s*1px\s+solid/is);
  const finalUiStyles = `${theme}\n${dashboard}`;
  assert.doesNotMatch(finalUiStyles, /(?:linear|radial|conic)-gradient\s*\(/i);
  const backdropValues = [...finalUiStyles.matchAll(
    /(?:-webkit-)?backdrop-filter\s*:\s*([^;{}]+)/gi,
  )].map((match) => match[1].trim());
  assert.ok(
    backdropValues.every((value) => value === "none"),
    `glass 효과를 만드는 backdrop-filter를 사용할 수 없습니다: ${backdropValues.join(", ")}`,
  );
});
