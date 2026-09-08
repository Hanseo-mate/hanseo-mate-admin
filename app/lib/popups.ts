export const POPUP_ENDPOINT = "/api/admin/popups";

export const MAX_POPUP_IMAGE_SIZE = 5 * 1024 * 1024;
export const POPUP_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.gif,image/jpeg,image/png,image/gif";

export const POPUP_STATUSES = [
  "ACTIVE",
  "SCHEDULED",
  "EXPIRED",
  "INACTIVE",
] as const;

export const POPUP_IMAGE_ACTIONS = ["KEEP", "REPLACE", "REMOVE"] as const;

export const POPUP_NOTICE_TYPES = [
  "STUDENT_COUNCIL",
  "ACADEMIC",
  "GENERAL",
  "SCHOLARSHIP",
  "GRADUATE",
] as const;

export const POPUP_STATIC_NAVIGATION_TYPES = [
  "HOME",
  "NOTICE_LIST",
  "CLUB_LIST",
  "CAFETERIA",
  "CALENDAR",
  "TIMETABLE",
  "CAMPUS_MAP",
  "SYSTEM_NOTICE_LIST",
  "FESTIVAL",
] as const;

export const POPUP_NAVIGATION_TYPES = [
  ...POPUP_STATIC_NAVIGATION_TYPES,
  "NOTICE_DETAIL",
  "CLUB_DETAIL",
  "EXTERNAL_URL",
] as const;

export type PopupStatus = typeof POPUP_STATUSES[number];
export type PopupImageAction = typeof POPUP_IMAGE_ACTIONS[number];
export type PopupNoticeType = typeof POPUP_NOTICE_TYPES[number];
export type PopupStaticNavigationType = typeof POPUP_STATIC_NAVIGATION_TYPES[number];
export type PopupNavigationType = typeof POPUP_NAVIGATION_TYPES[number];

export type PopupNavigation =
  | null
  | {
      schemaVersion: 1;
      type: PopupStaticNavigationType;
    }
  | {
      schemaVersion: 1;
      type: "NOTICE_DETAIL";
      params: {
        noticeId: number;
        noticeType: PopupNoticeType;
      };
    }
  | {
      schemaVersion: 1;
      type: "CLUB_DETAIL";
      params: {
        clubId: number;
      };
    }
  | {
      schemaVersion: 1;
      type: "EXTERNAL_URL";
      params: {
        url: string;
      };
    };

export interface AdminAppPopup {
  id: number;
  title: string;
  content: string;
  imageUrl: string | null;
  navigation: PopupNavigation;
  enabled: boolean;
  status: PopupStatus;
  startsAt: string | null;
  endsAt: string | null;
  displayOrder: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppPopupCreateRequest {
  title: string;
  content: string;
  navigation: PopupNavigation;
  enabled: boolean;
  startsAt: string | null;
  endsAt: string | null;
  displayOrder: number;
}

export interface AppPopupUpdateRequest extends AppPopupCreateRequest {
  imageAction: PopupImageAction;
}

export interface AppPopupEnabledUpdateRequest {
  enabled: boolean;
}

export type PopupForm = {
  title: string;
  content: string;
  navigationType: "" | PopupNavigationType;
  noticeId: string;
  noticeType: "" | PopupNoticeType;
  clubId: string;
  externalUrl: string;
  enabled: boolean;
  startsAt: string;
  endsAt: string;
  displayOrder: string;
  imageAction: PopupImageAction;
};

export type PopupFormField = keyof PopupForm;
export type PopupFormMode = "create" | "update";

export type PopupFormValidationResult<T> =
  | { payload: T; field?: never; message?: never }
  | { payload?: never; field: PopupFormField; message: string };

export const emptyPopupForm: PopupForm = {
  title: "",
  content: "",
  navigationType: "",
  noticeId: "",
  noticeType: "",
  clubId: "",
  externalUrl: "",
  enabled: true,
  startsAt: "",
  endsAt: "",
  displayOrder: "0",
  imageAction: "KEEP",
};

const popupStatusSet = new Set<string>(POPUP_STATUSES);
const popupImageActionSet = new Set<string>(POPUP_IMAGE_ACTIONS);
const popupNoticeTypeSet = new Set<string>(POPUP_NOTICE_TYPES);
const popupStaticNavigationTypeSet = new Set<string>(POPUP_STATIC_NAVIGATION_TYPES);
const popupNavigationTypeSet = new Set<string>(POPUP_NAVIGATION_TYPES);
const popupImageTypes = new Set(["image/jpeg", "image/png", "image/gif"]);
const popupImageExtension = /\.(?:jpe?g|png|gif)$/i;
const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?$/;
const localDateTimeInputPattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?$/;

const createRequestKeys = [
  "title",
  "content",
  "navigation",
  "enabled",
  "startsAt",
  "endsAt",
  "displayOrder",
] as const;

const updateRequestKeys = [...createRequestKeys, "imageAction"] as const;

function userFacingError(message: string) {
  const error = new Error(message);
  error.name = "UserFacingError";
  return error;
}

function invalidPopupData(message = "팝업 정보를 확인할 수 없습니다. 잠시 후 다시 불러와 주세요."): never {
  throw userFacingError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isSafeIntegerInRange(value: unknown, minimum: number, maximum = Number.MAX_SAFE_INTEGER) {
  return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number) {
  const days = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return days[month - 1] ?? 0;
}

function validLocalDateTimeMatch(match: RegExpMatchArray) {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] === undefined ? 0 : Number(match[6]);

  return month >= 1 && month <= 12 &&
    day >= 1 && day <= daysInMonth(year, month) &&
    hour >= 0 && hour <= 23 &&
    minute >= 0 && minute <= 59 &&
    second >= 0 && second <= 59;
}

export function isPopupLocalDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(localDateTimePattern);
  return Boolean(match && validLocalDateTimeMatch(match));
}

function normalizeLocalDateTimeInput(value: string) {
  const normalized = value.trim();
  if (!normalized) return { value: null as string | null };

  const match = normalized.match(localDateTimeInputPattern);
  if (!match || !validLocalDateTimeMatch(match)) {
    return { message: "날짜와 시간을 다시 확인해 주세요." };
  }

  return {
    value: match[6] === undefined ? `${normalized}:00` : normalized,
  };
}

export function normalizePopupDateTimeInput(value: string): string | null {
  const result = normalizeLocalDateTimeInput(value);
  if (result.message) throw userFacingError(result.message);
  return result.value ?? null;
}

export function popupDateTimeInputValue(value: string | null) {
  if (value === null) return "";
  if (!isPopupLocalDateTime(value)) {
    throw userFacingError("팝업 노출 시간을 확인할 수 없습니다.");
  }
  return value.replace(/\.\d{1,9}$/, "");
}

function localDateTimeSortKey(value: string) {
  const match = value.match(localDateTimePattern);
  if (!match || !validLocalDateTimeMatch(match)) invalidPopupData();
  const fraction = (match[7] ?? "").padEnd(9, "0");
  return `${value.slice(0, 19)}.${fraction}`;
}

function validExternalUrl(value: string) {
  if (!value || value.length > 2_048 || /[\u0000-\u0020\u007f]/.test(value)) return false;
  if (!/^https:\/\//i.test(value)) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password;
  } catch {
    return false;
  }
}

export function validatePopupExternalUrl(value: string) {
  if (!value.trim()) return "외부 페이지 주소를 입력해 주세요.";
  if (value.trim().length > 2_048) return "외부 페이지 주소는 2,048자 이하로 입력해 주세요.";
  if (!validExternalUrl(value.trim())) {
    return "사용자 정보가 포함되지 않은 HTTPS 주소를 입력해 주세요.";
  }
  return null;
}

function parsePositiveId(value: unknown, path: string) {
  if (!isSafeIntegerInRange(value, 1)) {
    invalidPopupData(`${path}: 1 이상의 정수여야 합니다.`);
  }
  return Number(value);
}

export function parsePopupNavigation(value: unknown): PopupNavigation {
  if (value === null) return null;
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.type !== "string") {
    invalidPopupData("팝업 이동 정보를 확인할 수 없습니다.");
  }

  const type = value.type;
  if (popupStaticNavigationTypeSet.has(type)) {
    if (!hasExactKeys(value, ["schemaVersion", "type"])) {
      invalidPopupData("정적 화면 이동에는 추가 파라미터를 사용할 수 없습니다.");
    }
    return { schemaVersion: 1, type: type as PopupStaticNavigationType };
  }

  if (type === "NOTICE_DETAIL") {
    if (!hasExactKeys(value, ["schemaVersion", "type", "params"]) ||
      !isRecord(value.params) ||
      !hasExactKeys(value.params, ["noticeId", "noticeType"]) ||
      typeof value.params.noticeType !== "string" ||
      !popupNoticeTypeSet.has(value.params.noticeType)) {
      invalidPopupData("공지 상세 이동 정보를 확인할 수 없습니다.");
    }
    return {
      schemaVersion: 1,
      type,
      params: {
        noticeId: parsePositiveId(value.params.noticeId, "navigation.params.noticeId"),
        noticeType: value.params.noticeType as PopupNoticeType,
      },
    };
  }

  if (type === "CLUB_DETAIL") {
    if (!hasExactKeys(value, ["schemaVersion", "type", "params"]) ||
      !isRecord(value.params) ||
      !hasExactKeys(value.params, ["clubId"])) {
      invalidPopupData("동아리 상세 이동 정보를 확인할 수 없습니다.");
    }
    return {
      schemaVersion: 1,
      type,
      params: {
        clubId: parsePositiveId(value.params.clubId, "navigation.params.clubId"),
      },
    };
  }

  if (type === "EXTERNAL_URL") {
    if (!hasExactKeys(value, ["schemaVersion", "type", "params"]) ||
      !isRecord(value.params) ||
      !hasExactKeys(value.params, ["url"]) ||
      typeof value.params.url !== "string" ||
      !validExternalUrl(value.params.url)) {
      invalidPopupData("외부 페이지 이동 정보를 확인할 수 없습니다.");
    }
    return {
      schemaVersion: 1,
      type,
      params: { url: value.params.url },
    };
  }

  invalidPopupData("지원하지 않는 팝업 이동 유형입니다.");
}

function parseNullableLocalDateTime(value: unknown) {
  if (value === null) return null;
  return isPopupLocalDateTime(value) ? value : invalidPopupData();
}

export function parsePopup(value: unknown): AdminAppPopup {
  if (!isRecord(value) ||
    !isSafeIntegerInRange(value.id, 1) ||
    typeof value.title !== "string" ||
    !value.title.trim() ||
    value.title.length > 200 ||
    typeof value.content !== "string" ||
    !value.content.trim() ||
    value.content.length > 100_000 ||
    !(value.imageUrl === null || typeof value.imageUrl === "string") ||
    typeof value.enabled !== "boolean" ||
    typeof value.status !== "string" ||
    !popupStatusSet.has(value.status) ||
    !isSafeIntegerInRange(value.displayOrder, 0, 9_999) ||
    !isSafeIntegerInRange(value.revision, 1) ||
    !isPopupLocalDateTime(value.createdAt) ||
    !isPopupLocalDateTime(value.updatedAt)) {
    invalidPopupData();
  }

  const startsAt = parseNullableLocalDateTime(value.startsAt);
  const endsAt = parseNullableLocalDateTime(value.endsAt);
  if (startsAt !== null && endsAt !== null &&
    localDateTimeSortKey(startsAt) >= localDateTimeSortKey(endsAt)) {
    invalidPopupData();
  }

  return {
    id: Number(value.id),
    title: value.title,
    content: value.content,
    imageUrl: value.imageUrl,
    navigation: parsePopupNavigation(value.navigation),
    enabled: value.enabled,
    status: value.status as PopupStatus,
    startsAt,
    endsAt,
    displayOrder: Number(value.displayOrder),
    revision: Number(value.revision),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function sortPopups(items: AdminAppPopup[]) {
  return [...items].sort((first, second) => (
    second.createdAt.localeCompare(first.createdAt) ||
    second.id - first.id
  ));
}

export function parsePopups(value: unknown): AdminAppPopup[] {
  if (!Array.isArray(value)) {
    invalidPopupData("팝업 목록을 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
  }
  return sortPopups(value.map(parsePopup));
}

export function formFromPopup(popup: AdminAppPopup): PopupForm {
  const form: PopupForm = {
    ...emptyPopupForm,
    title: popup.title,
    content: popup.content,
    enabled: popup.enabled,
    startsAt: popupDateTimeInputValue(popup.startsAt),
    endsAt: popupDateTimeInputValue(popup.endsAt),
    displayOrder: String(popup.displayOrder),
  };

  if (popup.navigation === null) return form;

  form.navigationType = popup.navigation.type;
  if (popup.navigation.type === "NOTICE_DETAIL") {
    form.noticeId = String(popup.navigation.params.noticeId);
    form.noticeType = popup.navigation.params.noticeType;
  } else if (popup.navigation.type === "CLUB_DETAIL") {
    form.clubId = String(popup.navigation.params.clubId);
  } else if (popup.navigation.type === "EXTERNAL_URL") {
    form.externalUrl = popup.navigation.params.url;
  }
  return form;
}

export function popupUpdateFormWithOriginalDateTimes(
  form: PopupForm,
  popup: AdminAppPopup,
): PopupForm {
  return {
    ...form,
    startsAt: form.startsAt === popupDateTimeInputValue(popup.startsAt)
      ? popup.startsAt ?? ""
      : form.startsAt,
    endsAt: form.endsAt === popupDateTimeInputValue(popup.endsAt)
      ? popup.endsAt ?? ""
      : form.endsAt,
  };
}

type NavigationFormResult =
  | { ok: true; value: PopupNavigation }
  | { ok: false; field: PopupFormField; message: string };

function navigationFromForm(form: PopupForm): NavigationFormResult {
  const type = form.navigationType;
  if (type === "") return { ok: true, value: null };
  if (!popupNavigationTypeSet.has(type)) {
    return { ok: false, field: "navigationType", message: "클릭할 때 이동할 화면을 다시 선택해 주세요." };
  }

  if (popupStaticNavigationTypeSet.has(type)) {
    return { ok: true, value: { schemaVersion: 1, type: type as PopupStaticNavigationType } };
  }

  if (type === "NOTICE_DETAIL") {
    const noticeId = form.noticeId.trim();
    if (!/^[1-9]\d*$/.test(noticeId) || !Number.isSafeInteger(Number(noticeId))) {
      return { ok: false, field: "noticeId", message: "공지 번호는 1 이상의 정수로 입력해 주세요." };
    }
    if (!popupNoticeTypeSet.has(form.noticeType)) {
      return { ok: false, field: "noticeType", message: "공지 유형을 선택해 주세요." };
    }
    return {
      ok: true,
      value: {
        schemaVersion: 1,
        type,
        params: {
          noticeId: Number(noticeId),
          noticeType: form.noticeType as PopupNoticeType,
        },
      },
    };
  }

  if (type === "CLUB_DETAIL") {
    const clubId = form.clubId.trim();
    if (!/^[1-9]\d*$/.test(clubId) || !Number.isSafeInteger(Number(clubId))) {
      return { ok: false, field: "clubId", message: "동아리 번호는 1 이상의 정수로 입력해 주세요." };
    }
    return {
      ok: true,
      value: {
        schemaVersion: 1,
        type,
        params: { clubId: Number(clubId) },
      },
    };
  }

  const externalUrl = form.externalUrl.trim();
  const externalUrlError = validatePopupExternalUrl(externalUrl);
  if (externalUrlError) return { ok: false, field: "externalUrl", message: externalUrlError };
  return {
    ok: true,
    value: {
      schemaVersion: 1,
      type: "EXTERNAL_URL",
      params: { url: externalUrl },
    },
  };
}

function validatePopupFormInternal(
  form: PopupForm,
  mode: PopupFormMode,
): PopupFormValidationResult<AppPopupCreateRequest | AppPopupUpdateRequest> {
  const title = form.title.trim();
  if (!title) return { field: "title", message: "팝업 제목을 입력해 주세요." };
  if (title.length > 200) return { field: "title", message: "팝업 제목은 200자 이하로 입력해 주세요." };
  if (!form.content.trim()) return { field: "content", message: "팝업 내용을 입력해 주세요." };
  if (form.content.length > 100_000) {
    return { field: "content", message: "팝업 내용은 100,000자 이하로 입력해 주세요." };
  }
  if (typeof form.enabled !== "boolean") {
    return { field: "enabled", message: "활성화 여부를 다시 선택해 주세요." };
  }

  const navigation = navigationFromForm(form);
  if (!navigation.ok) {
    return { field: navigation.field, message: navigation.message };
  }

  const startsAtResult = normalizeLocalDateTimeInput(form.startsAt);
  if (startsAtResult.message) return { field: "startsAt", message: "노출 시작 날짜와 시간을 다시 확인해 주세요." };
  const endsAtResult = normalizeLocalDateTimeInput(form.endsAt);
  if (endsAtResult.message) return { field: "endsAt", message: "노출 종료 날짜와 시간을 다시 확인해 주세요." };

  const startsAt = startsAtResult.value ?? null;
  const endsAt = endsAtResult.value ?? null;
  if (startsAt !== null && endsAt !== null &&
    localDateTimeSortKey(startsAt) >= localDateTimeSortKey(endsAt)) {
    return { field: "endsAt", message: "노출 종료 시각은 시작 시각보다 늦어야 합니다." };
  }

  const displayOrderText = form.displayOrder.trim();
  if (!/^\d+$/.test(displayOrderText)) {
    return { field: "displayOrder", message: "노출 순서는 0부터 9,999 사이의 정수로 입력해 주세요." };
  }
  const displayOrder = Number(displayOrderText);
  if (!isSafeIntegerInRange(displayOrder, 0, 9_999)) {
    return { field: "displayOrder", message: "노출 순서는 0부터 9,999 사이의 정수로 입력해 주세요." };
  }

  const basePayload: AppPopupCreateRequest = {
    title,
    content: form.content,
    navigation: navigation.value,
    enabled: form.enabled,
    startsAt,
    endsAt,
    displayOrder,
  };

  if (mode === "create") return { payload: basePayload };
  if (!popupImageActionSet.has(form.imageAction)) {
    return { field: "imageAction", message: "이미지 처리 방법을 다시 선택해 주세요." };
  }
  return { payload: { ...basePayload, imageAction: form.imageAction } };
}

export function validatePopupForm(
  form: PopupForm,
  mode?: "create",
): PopupFormValidationResult<AppPopupCreateRequest>;
export function validatePopupForm(
  form: PopupForm,
  mode: "update",
): PopupFormValidationResult<AppPopupUpdateRequest>;
export function validatePopupForm(
  form: PopupForm,
  mode: PopupFormMode,
): PopupFormValidationResult<AppPopupCreateRequest | AppPopupUpdateRequest>;
export function validatePopupForm(
  form: PopupForm,
  mode: PopupFormMode = "create",
) {
  return validatePopupFormInternal(form, mode);
}

export function validatePopupImage(file: File) {
  if (!popupImageExtension.test(file.name) || !popupImageTypes.has(file.type)) {
    return "JPG, JPEG, PNG, GIF 형식의 이미지만 선택할 수 있습니다.";
  }
  if (file.size === 0) return "내용이 없는 이미지는 등록할 수 없습니다.";
  if (file.size > MAX_POPUP_IMAGE_SIZE) return "이미지는 5MiB 이하여야 합니다.";
  return null;
}

function parseCreateRequest(value: unknown): AppPopupCreateRequest {
  if (!isRecord(value) || !hasExactKeys(value, createRequestKeys) ||
    typeof value.title !== "string" ||
    typeof value.content !== "string" ||
    typeof value.enabled !== "boolean" ||
    !isSafeIntegerInRange(value.displayOrder, 0, 9_999)) {
    invalidPopupData("팝업 요청 내용을 확인해 주세요.");
  }

  const title = value.title.trim();
  if (!title || title.length > 200 || !value.content.trim() || value.content.length > 100_000) {
    invalidPopupData("팝업 제목과 내용을 확인해 주세요.");
  }

  const startsAt = parseNullableLocalDateTime(value.startsAt);
  const endsAt = parseNullableLocalDateTime(value.endsAt);
  if (startsAt !== null && endsAt !== null &&
    localDateTimeSortKey(startsAt) >= localDateTimeSortKey(endsAt)) {
    invalidPopupData("노출 종료 시각은 시작 시각보다 늦어야 합니다.");
  }

  return {
    title,
    content: value.content,
    navigation: parsePopupNavigation(value.navigation),
    enabled: value.enabled,
    startsAt,
    endsAt,
    displayOrder: Number(value.displayOrder),
  };
}

function parseUpdateRequest(value: unknown): AppPopupUpdateRequest {
  if (!isRecord(value) || !hasExactKeys(value, updateRequestKeys) ||
    typeof value.imageAction !== "string" ||
    !popupImageActionSet.has(value.imageAction)) {
    invalidPopupData("팝업 수정 요청 내용을 확인해 주세요.");
  }

  const createFields = Object.fromEntries(
    createRequestKeys.map((key) => [key, value[key]]),
  );
  return {
    ...parseCreateRequest(createFields),
    imageAction: value.imageAction as PopupImageAction,
  };
}

function validateMultipartImage(image: File | null | undefined) {
  if (!image) return;
  const error = validatePopupImage(image);
  if (error) throw userFacingError(error);
}

function popupMultipartBody(
  request: AppPopupCreateRequest | AppPopupUpdateRequest,
  image?: File | null,
) {
  const body = new FormData();
  body.append(
    "request",
    new Blob([JSON.stringify(request)], { type: "application/json" }),
  );
  if (image) body.append("image", image, image.name);
  return body;
}

export function createPopupMultipartBody(
  request: AppPopupCreateRequest,
  image?: File | null,
) {
  const normalizedRequest = parseCreateRequest(request);
  validateMultipartImage(image);
  return popupMultipartBody(normalizedRequest, image);
}

export function updatePopupMultipartBody(
  request: AppPopupUpdateRequest,
  image?: File | null,
) {
  const normalizedRequest = parseUpdateRequest(request);
  if (normalizedRequest.imageAction === "REPLACE" && !image) {
    throw userFacingError("이미지를 교체하려면 새 이미지를 선택해 주세요.");
  }
  if (normalizedRequest.imageAction !== "REPLACE" && image) {
    throw userFacingError("이미지를 유지하거나 제거할 때는 새 이미지를 함께 보낼 수 없습니다.");
  }
  validateMultipartImage(image);
  return popupMultipartBody(normalizedRequest, image);
}
