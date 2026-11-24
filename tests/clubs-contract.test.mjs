import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  clubDetailToForm,
  clubFormToUpdatePayload,
  clubRecruitmentFormToPayload,
  getClubCategoryLabel,
  initialClubRecruitmentForm,
  isValidHttpUrl,
  moveClub,
  parseClubDetail,
  parseClubListResponse,
  validateClubRecruitment,
} from "../app/lib/clubs.ts";

function summary(id, category = "ACADEMIC") {
  return {
    id,
    name: `동아리 ${id}`,
    category,
    profileImageUrl: null,
    shortDescription: null,
    likeCount: 0,
    topReviewTags: [],
  };
}

test("loads all 30 clubs from the administrator response envelope", () => {
  const response = parseClubListResponse({
    totalCount: 30,
    clubs: Array.from({ length: 30 }, (_, index) => summary(index + 1)),
  });

  assert.equal(response.totalCount, 30);
  assert.equal(response.clubs.length, 30);
  assert.deepEqual(response.clubs.map((club) => club.id), Array.from({ length: 30 }, (_, index) => index + 1));
});

test("parses category-filtered clubs and uses the server's result count", () => {
  const { totalCount, clubs } = parseClubListResponse({
    totalCount: 5,
    clubs: [{
      ...summary(7, "HOBBY"),
      name: "한서 사진연구회",
      shortDescription: "사진을 함께 배우는 동아리",
      likeCount: 12,
      topReviewTags: ["ENJOY_HOBBY", "FRIENDLY_MEMBERS", "HAS_CLUB_ROOM"],
    }],
  });

  assert.equal(totalCount, 5);
  assert.equal(clubs.length, 1);
  assert.equal(clubs[0].id, 7);
  assert.equal(Object.hasOwn(clubs[0], "displayOrder"), false);
  assert.equal(getClubCategoryLabel(clubs[0].category), "취미");
  assert.deepEqual(clubs[0].topReviewTags, ["ENJOY_HOBBY", "FRIENDLY_MEMBERS"]);
});

test("accepts an empty category response", () => {
  assert.deepEqual(parseClubListResponse({ totalCount: 0, clubs: [] }), {
    totalCount: 0,
    clubs: [],
  });
});

test("rejects malformed list envelopes with a user-friendly message", () => {
  for (const payload of [
    null,
    [],
    [summary(1)],
    {},
    { clubs: [] },
    { totalCount: 0 },
    { totalCount: 0, clubs: null },
    { totalCount: "1", clubs: [summary(1)] },
    { totalCount: -1, clubs: [] },
    { totalCount: 1.5, clubs: [summary(1)] },
    { totalCount: Infinity, clubs: [] },
    { totalCount: 1, clubs: [null] },
  ]) {
    assert.throws(() => parseClubListResponse(payload), /동아리 정보를 불러오지 못했습니다/);
  }
});

test("moves a club within the full list without losing or duplicating IDs", () => {
  const clubs = [{ id: 3 }, { id: 1 }, { id: 2 }];
  const moved = moveClub(clubs, 2, 0);
  assert.deepEqual(moved.map((club) => club.id), [2, 3, 1]);
  assert.deepEqual(clubs.map((club) => club.id), [3, 1, 2]);
  assert.deepEqual(moveClub(moved, 0, -1), moved);
});

test("keeps the server's array order without a display order field", () => {
  const { clubs } = parseClubListResponse({
    totalCount: 3,
    clubs: [3, 1, 2].map((id) => summary(id)),
  });

  assert.deepEqual(clubs.map((club) => club.id), [3, 1, 2]);
  assert.equal(clubs.every((club) => !Object.hasOwn(club, "displayOrder")), true);
});

test("rejects unsupported categories with a user-friendly message", () => {
  assert.throws(() => parseClubListResponse({
    totalCount: 1,
    clubs: [summary(1, "ALL")],
  }), /동아리 정보를 불러오지 못했습니다/);
});

test("maps nullable administrator detail fields into a safe full-edit form", () => {
  const detail = parseClubDetail({
    backgroundImageUrl: null,
    profileImageUrl: "https://example.com/profile.png",
    likeCount: 3,
    name: "멋쟁이사자처럼 한서대학교",
    shortDescription: null,
    topReviewTags: [],
    introduction: null,
    activityContent: "개발 스터디",
    instagramUrl: null,
    kakaoTalkUrl: "https://open.kakao.com/o/example",
    recruitmentContent: null,
    recruitmentStartDate: null,
    recruitmentEndDate: null,
    recruitmentUrl: null,
    recruitmentAlwaysOpen: false,
    reviewerCount: 2,
  });
  const form = clubDetailToForm(detail);

  assert.equal(form.shortDescription, "");
  assert.equal(form.introduction, "");
  assert.equal(form.activityContent, "개발 스터디");
  assert.equal(form.kakaoTalkUrl, "https://open.kakao.com/o/example");
  assert.equal(form.recruitmentStartDate, "");
  assert.equal(form.recruitmentEndDate, "");
  assert.equal(form.recruitmentUrl, "");
  assert.equal(form.recruitmentAlwaysOpen, false);

  assert.deepEqual(clubFormToUpdatePayload({
    ...form,
    name: "  새 이름  ",
    shortDescription: "  새 소개  ",
    recruitmentContent: "   ",
  }), {
    name: "새 이름",
    shortDescription: "새 소개",
    introduction: null,
    activityContent: "개발 스터디",
    instagramUrl: null,
    kakaoTalkUrl: "https://open.kakao.com/o/example",
    recruitmentContent: null,
    recruitmentStartDate: null,
    recruitmentEndDate: null,
    recruitmentUrl: null,
    recruitmentAlwaysOpen: false,
  });
});

test("preserves all recruitment fields when only the club name changes", () => {
  for (const recruitmentAlwaysOpen of [false, true]) {
    const recruitment = {
      recruitmentContent: "2026학년도 신입 부원을 모집합니다.",
      recruitmentStartDate: "2026-11-01",
      recruitmentEndDate: "2026-11-30",
      recruitmentUrl: "https://forms.example.com/club-application",
      recruitmentAlwaysOpen,
    };
    const form = clubDetailToForm(parseClubDetail({
      name: "원래 이름",
      shortDescription: "기존 소개",
      ...recruitment,
    }));
    const payload = clubFormToUpdatePayload({ ...form, name: "바뀐 이름" });

    assert.equal(payload.name, "바뀐 이름");
    for (const [key, value] of Object.entries(recruitment)) {
      assert.equal(payload[key], value, `${key} must survive a full replacement`);
    }
    assert.deepEqual(clubDetailToForm(parseClubDetail(payload)), { ...form, name: "바뀐 이름" });
  }
});

test("defaults absent recruitment values safely without coercing invalid booleans", () => {
  for (const recruitmentAlwaysOpen of [undefined, null]) {
    const form = clubDetailToForm(parseClubDetail({ name: "동아리", recruitmentAlwaysOpen }));
    assert.deepEqual(clubRecruitmentFormToPayload(form), {
      recruitmentContent: null,
      recruitmentStartDate: null,
      recruitmentEndDate: null,
      recruitmentUrl: null,
      recruitmentAlwaysOpen: false,
    });
  }
  for (const recruitmentAlwaysOpen of ["true", "false", 0, 1]) {
    assert.throws(
      () => parseClubDetail({ name: "동아리", recruitmentAlwaysOpen }),
      /동아리 정보를 불러오지 못했습니다/,
    );
  }
});

test("serializes recruitment fields explicitly for both registration and replacement", () => {
  assert.deepEqual(clubRecruitmentFormToPayload(initialClubRecruitmentForm), {
    recruitmentContent: null,
    recruitmentStartDate: null,
    recruitmentEndDate: null,
    recruitmentUrl: null,
    recruitmentAlwaysOpen: false,
  });

  assert.deepEqual(clubRecruitmentFormToPayload({
    recruitmentContent: "  함께 활동할 부원 모집  ",
    recruitmentStartDate: "2026-11-01",
    recruitmentEndDate: "2026-11-30",
    recruitmentUrl: "  https://example.com/apply  ",
    recruitmentAlwaysOpen: true,
  }), {
    recruitmentContent: "함께 활동할 부원 모집",
    recruitmentStartDate: "2026-11-01",
    recruitmentEndDate: "2026-11-30",
    recruitmentUrl: "https://example.com/apply",
    recruitmentAlwaysOpen: true,
  });
});

test("validates a fixed recruitment period while keeping dates for always-open recruitment", () => {
  const form = {
    ...initialClubRecruitmentForm,
    recruitmentStartDate: "2026-11-30",
    recruitmentEndDate: "2026-11-01",
  };
  assert.ok(validateClubRecruitment(form));
  assert.equal(validateClubRecruitment({ ...form, recruitmentEndDate: "2026-11-30" }), null);
  assert.equal(validateClubRecruitment({ ...form, recruitmentEndDate: "" }), null);
  assert.equal(validateClubRecruitment({ ...form, recruitmentStartDate: "" }), null);

  const alwaysOpenForm = { ...form, recruitmentAlwaysOpen: true };
  assert.equal(validateClubRecruitment(alwaysOpenForm), null);
  assert.equal(clubRecruitmentFormToPayload(alwaysOpenForm).recruitmentStartDate, "2026-11-30");
  assert.equal(clubRecruitmentFormToPayload(alwaysOpenForm).recruitmentEndDate, "2026-11-01");
});

test("accepts optional recruitment dates but rejects invalid calendar dates", () => {
  assert.equal(validateClubRecruitment(initialClubRecruitmentForm), null);
  assert.equal(validateClubRecruitment({ ...initialClubRecruitmentForm, recruitmentStartDate: "2028-02-29" }), null);
  for (const recruitmentStartDate of ["2026-02-29", "2026-13-01", "2026-11-31", "2026/11/24"]) {
    assert.ok(validateClubRecruitment({ ...initialClubRecruitmentForm, recruitmentStartDate }));
  }
});

test("validates recruitment links before they are submitted", () => {
  for (const recruitmentUrl of ["", "https://example.com/apply", "http://example.com/apply"]) {
    assert.equal(validateClubRecruitment({ ...initialClubRecruitmentForm, recruitmentUrl }), null);
  }
  for (const recruitmentUrl of ["ftp://example.com/apply", "javascript:alert(1)", "https://", `https://example.com/${"x".repeat(2048)}`]) {
    assert.ok(validateClubRecruitment({ ...initialClubRecruitmentForm, recruitmentUrl }));
  }
});

test("accepts only http and https links with a hostname", () => {
  assert.equal(isValidHttpUrl(""), true);
  assert.equal(isValidHttpUrl("https://instagram.com/example"), true);
  assert.equal(isValidHttpUrl("ftp://example.com"), false);
  assert.equal(isValidHttpUrl("https://"), false);
});

test("loads selected club details through the administrator endpoint", async () => {
  const source = await readFile(
    new URL("../app/clubs/manage/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /`\/api\/admin\/clubs\/\$\{club\.id\}`/);
  assert.doesNotMatch(source, /apiFetch<unknown>\(`\/api\/clubs\/\$\{club\.id\}`/);
});
