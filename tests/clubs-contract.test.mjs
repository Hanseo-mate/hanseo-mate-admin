import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  clubDetailToForm,
  clubFormToUpdatePayload,
  getClubCategoryLabel,
  isValidHttpUrl,
  parseClubDetail,
  parseClubSummaries,
} from "../app/lib/clubs.ts";

test("parses the updated administrator club list response", () => {
  const clubs = parseClubSummaries([
    {
      id: 7,
      name: "한서 사진연구회",
      category: "HOBBY",
      profileImageUrl: null,
      shortDescription: "사진을 함께 배우는 동아리",
      likeCount: 12,
      topReviewTags: ["ENJOY_HOBBY", "FRIENDLY_MEMBERS", "HAS_CLUB_ROOM"],
    },
  ]);

  assert.equal(clubs.length, 1);
  assert.equal(clubs[0].id, 7);
  assert.equal(getClubCategoryLabel(clubs[0].category), "취미");
  assert.deepEqual(clubs[0].topReviewTags, ["ENJOY_HOBBY", "FRIENDLY_MEMBERS"]);
});

test("rejects unsupported categories with a user-friendly message", () => {
  assert.throws(() => parseClubSummaries([
    {
      id: 1,
      name: "잘못된 동아리",
      category: "ALL",
      profileImageUrl: null,
      shortDescription: null,
      likeCount: 0,
      topReviewTags: [],
    },
  ]), /동아리 정보를 불러오지 못했습니다/);
});

test("maps nullable public detail fields into a safe full-edit form", () => {
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
    reviewerCount: 2,
  });
  const form = clubDetailToForm(detail);

  assert.equal(form.shortDescription, "");
  assert.equal(form.introduction, "");
  assert.equal(form.activityContent, "개발 스터디");
  assert.equal(form.kakaoTalkUrl, "https://open.kakao.com/o/example");

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
  });
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
