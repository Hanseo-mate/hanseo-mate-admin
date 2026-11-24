export const clubCategories = [
  { value: "ACADEMIC", label: "학술", description: "전공·연구·학습 활동" },
  { value: "VOLUNTEER", label: "봉사", description: "지역사회·재능 나눔" },
  { value: "SPORTS", label: "스포츠", description: "체육·레저 활동" },
  { value: "RELIGION", label: "종교", description: "종교·신앙 활동" },
  { value: "PERFORMANCE", label: "공연", description: "음악·연극·무대 활동" },
  { value: "HOBBY", label: "취미", description: "문화·창작·교류 활동" },
] as const;

export type ClubCategory = (typeof clubCategories)[number]["value"];

export const reviewTagLabels: Record<string, string> = {
  BUILD_RESUME: "스펙 쌓기",
  ACADEMIC_PASSION: "학업 열정",
  ENJOY_HOBBY: "취미 활동",
  SOCIALIZING: "친목 활동",
  CAREER_HELPFUL: "진로 도움",
  SMALL_SCALE: "소규모",
  GROUP_ACTIVITY: "단체 활동",
  DEVELOP_SKILL: "실력 향상",
  MANY_SENIORS: "선배가 많음",
  MANY_JUNIORS: "후배가 많음",
  MANY_GATHERINGS: "모임이 많음",
  CALM_ATMOSPHERE: "차분한 분위기",
  DATING_FRIENDLY: "연애 친화적",
  FRIENDLY_MEMBERS: "친절한 구성원",
  EASY_TO_JOIN_ALONE: "혼자 참여하기 쉬움",
  SOCIABLE_MEMBERS: "사교적인 구성원",
  LARGE_SCALE: "대규모",
  STRONG_SENIORITY: "선후배 문화가 강함",
  BUSY_SCHEDULE: "일정이 바쁨",
  FLEXIBLE_ATTENDANCE: "참석이 유연함",
  HAS_FEE: "회비 있음",
  MANDATORY_EVENTS: "필수 행사 있음",
  ATTENDANCE_IMPORTANT: "출석 중요",
  MINIMUM_PERIOD: "최소 활동 기간 있음",
  HAS_CLUB_ROOM: "동아리방 있음",
  INTERVIEW_IMPORTANT: "면접 중요",
};

export type ClubSummary = {
  id: number;
  name: string;
  category: ClubCategory;
  profileImageUrl: string | null;
  shortDescription: string | null;
  likeCount: number;
  topReviewTags: string[];
};

export type ClubListResponse = {
  totalCount: number;
  clubs: ClubSummary[];
};

export type ClubDetail = {
  backgroundImageUrl: string | null;
  profileImageUrl: string | null;
  likeCount: number;
  name: string;
  shortDescription: string | null;
  topReviewTags: string[];
  introduction: string | null;
  activityContent: string | null;
  instagramUrl: string | null;
  kakaoTalkUrl: string | null;
  recruitmentContent: string | null;
  recruitmentStartDate: string | null;
  recruitmentEndDate: string | null;
  recruitmentUrl: string | null;
  recruitmentAlwaysOpen: boolean;
  reviewerCount: number;
};

export type ClubRecruitmentForm = {
  recruitmentContent: string;
  recruitmentStartDate: string;
  recruitmentEndDate: string;
  recruitmentUrl: string;
  recruitmentAlwaysOpen: boolean;
};

export const initialClubRecruitmentForm: ClubRecruitmentForm = {
  recruitmentContent: "",
  recruitmentStartDate: "",
  recruitmentEndDate: "",
  recruitmentUrl: "",
  recruitmentAlwaysOpen: false,
};

export type ClubForm = ClubRecruitmentForm & {
  name: string;
  shortDescription: string;
  introduction: string;
  activityContent: string;
  instagramUrl: string;
  kakaoTalkUrl: string;
};

export const initialClubForm: ClubForm = {
  ...initialClubRecruitmentForm,
  name: "",
  shortDescription: "",
  introduction: "",
  activityContent: "",
  instagramUrl: "",
  kakaoTalkUrl: "",
};

const categoryValues = new Set<string>(clubCategories.map((item) => item.value));
const CLUB_LOAD_ERROR_MESSAGE =
  "동아리 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.";

class ClubLoadError extends Error {
  constructor() {
    super(CLUB_LOAD_ERROR_MESSAGE);
    this.name = "UserFacingError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalidClubData(): never {
  throw new ClubLoadError();
}

function requiredString(value: unknown) {
  if (typeof value !== "string") {
    invalidClubData();
  }
  return value;
}

function nullableString(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    invalidClubData();
  }
  return value;
}

function nonNegativeNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

function reviewTags(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function clubCategory(value: unknown): ClubCategory {
  if (typeof value !== "string" || !categoryValues.has(value)) {
    invalidClubData();
  }
  return value as ClubCategory;
}

export function getClubCategoryLabel(value: ClubCategory | string) {
  return clubCategories.find((item) => item.value === value)?.label ?? value;
}

export function getReviewTagLabel(value: string) {
  return reviewTagLabels[value] ?? value;
}

export function parseClubListResponse(payload: unknown): ClubListResponse {
  if (!isRecord(payload) || !Array.isArray(payload.clubs) ||
      !Number.isInteger(payload.totalCount) || Number(payload.totalCount) < 0) {
    invalidClubData();
  }

  const clubs = payload.clubs.map((value) => {
    if (!isRecord(value)) {
      invalidClubData();
    }
    if (!Number.isInteger(value.id) || Number(value.id) < 1) {
      invalidClubData();
    }

    return {
      id: Number(value.id),
      name: requiredString(value.name),
      category: clubCategory(value.category),
      profileImageUrl: nullableString(value.profileImageUrl),
      shortDescription: nullableString(value.shortDescription),
      likeCount: nonNegativeNumber(value.likeCount),
      topReviewTags: reviewTags(value.topReviewTags).slice(0, 2),
    };
  });

  return { totalCount: Number(payload.totalCount), clubs };
}

export function moveClub<T>(clubs: readonly T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex < 0 || fromIndex >= clubs.length || toIndex < 0 || toIndex >= clubs.length) {
    return [...clubs];
  }
  const reordered = [...clubs];
  const [club] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, club);
  return reordered;
}

export function parseClubDetail(payload: unknown): ClubDetail {
  if (!isRecord(payload)) {
    invalidClubData();
  }

  return {
    backgroundImageUrl: nullableString(payload.backgroundImageUrl),
    profileImageUrl: nullableString(payload.profileImageUrl),
    likeCount: nonNegativeNumber(payload.likeCount),
    name: requiredString(payload.name),
    shortDescription: nullableString(payload.shortDescription),
    topReviewTags: reviewTags(payload.topReviewTags).slice(0, 3),
    introduction: nullableString(payload.introduction),
    activityContent: nullableString(payload.activityContent),
    instagramUrl: nullableString(payload.instagramUrl),
    kakaoTalkUrl: nullableString(payload.kakaoTalkUrl),
    recruitmentContent: nullableString(payload.recruitmentContent),
    recruitmentStartDate: nullableString(payload.recruitmentStartDate),
    recruitmentEndDate: nullableString(payload.recruitmentEndDate),
    recruitmentUrl: nullableString(payload.recruitmentUrl),
    recruitmentAlwaysOpen: nullableBoolean(payload.recruitmentAlwaysOpen),
    reviewerCount: nonNegativeNumber(payload.reviewerCount),
  };
}

export function clubDetailToForm(detail: ClubDetail): ClubForm {
  return {
    name: detail.name,
    shortDescription: detail.shortDescription ?? "",
    introduction: detail.introduction ?? "",
    activityContent: detail.activityContent ?? "",
    instagramUrl: detail.instagramUrl ?? "",
    kakaoTalkUrl: detail.kakaoTalkUrl ?? "",
    recruitmentContent: detail.recruitmentContent ?? "",
    recruitmentStartDate: detail.recruitmentStartDate ?? "",
    recruitmentEndDate: detail.recruitmentEndDate ?? "",
    recruitmentUrl: detail.recruitmentUrl ?? "",
    recruitmentAlwaysOpen: detail.recruitmentAlwaysOpen,
  };
}

function nullable(value: string) {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullableBoolean(value: unknown) {
  if (value === null || value === undefined) return false;
  if (typeof value !== "boolean") invalidClubData();
  return value;
}

export function clubRecruitmentFormToPayload(form: ClubRecruitmentForm) {
  return {
    recruitmentContent: nullable(form.recruitmentContent),
    recruitmentStartDate: nullable(form.recruitmentStartDate),
    recruitmentEndDate: nullable(form.recruitmentEndDate),
    recruitmentUrl: nullable(form.recruitmentUrl),
    recruitmentAlwaysOpen: form.recruitmentAlwaysOpen,
  };
}

function isValidDate(value: string) {
  if (!value) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function validateClubRecruitment(form: ClubRecruitmentForm): string | null {
  const payload = clubRecruitmentFormToPayload(form);
  if (!isValidDate(payload.recruitmentStartDate ?? "") ||
      !isValidDate(payload.recruitmentEndDate ?? "")) {
    return "모집 시작일과 종료일을 올바른 날짜로 입력해 주세요.";
  }
  if (!payload.recruitmentAlwaysOpen && payload.recruitmentStartDate &&
      payload.recruitmentEndDate && payload.recruitmentStartDate > payload.recruitmentEndDate) {
    return "모집 종료일은 시작일과 같거나 이후여야 합니다.";
  }
  if ((payload.recruitmentUrl?.length ?? 0) > 2048 || !isValidHttpUrl(form.recruitmentUrl)) {
    return "신청 링크는 2048자 이하의 올바른 웹 주소로 입력해 주세요. 예: https://forms.gle/...";
  }
  return null;
}

export function clubFormToUpdatePayload(form: ClubForm) {
  return {
    name: form.name.trim(),
    shortDescription: form.shortDescription.trim(),
    introduction: nullable(form.introduction),
    activityContent: nullable(form.activityContent),
    instagramUrl: nullable(form.instagramUrl),
    kakaoTalkUrl: nullable(form.kakaoTalkUrl),
    ...clubRecruitmentFormToPayload(form),
  };
}

export function isValidHttpUrl(value: string) {
  if (!value.trim()) return true;
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}
