export const APP_UPDATE_POLICIES_ENDPOINT = "/api/admin/app-update-policies";
export const APP_UPDATE_AUDIT_LOGS_ENDPOINT = `${APP_UPDATE_POLICIES_ENDPOINT}/audit-logs`;
export const HANSEOMATE_IOS_APP_STORE_ID = "6804946491";
export const HANSEOMATE_ANDROID_PACKAGE_ID = "com.hanseomate.app";

export const APP_UPDATE_PLATFORMS = ["IOS", "ANDROID"] as const;
export const APP_UPDATE_POLICY_STATUSES = [
  "DRAFT",
  "SCHEDULED",
  "ACTIVE",
  "SUPERSEDED",
  "CANCELLED",
] as const;
export const APP_UPDATE_ACTIONS = ["NONE", "OPTIONAL", "REQUIRED"] as const;

export type AppPlatform = typeof APP_UPDATE_PLATFORMS[number];
export type AppUpdatePolicyStatus = typeof APP_UPDATE_POLICY_STATUSES[number];
export type AppUpdateAction = typeof APP_UPDATE_ACTIONS[number];
export type PublishMode = "IMMEDIATE" | "SCHEDULED";

export interface AppUpdatePolicy {
  id: number;
  revision: number;
  platform: AppPlatform;
  latestVersion: string;
  latestBuild: number;
  forceUpdateEnabled: boolean;
  minimumSupportedBuild: number | null;
  optionalUpdateEnabled: boolean;
  storeUrl: string;
  title: string;
  message: string;
  status: AppUpdatePolicyStatus;
  effectiveAt: string | null;
  storeAvailabilityConfirmedAt: string | null;
  storeAvailabilityConfirmedBy: number | null;
  createdBy: number;
  updatedBy: number;
  publishedBy: number | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
}

export interface AppUpdatePolicyPage {
  items: AppUpdatePolicy[];
  page: number;
  size: number;
  totalPages: number;
  totalElements: number;
  hasNext: boolean;
}

export interface AppUpdatePreviewResult {
  build: number;
  action: AppUpdateAction;
}

export interface AppUpdatePreview {
  policyId: number;
  revision: number;
  results: AppUpdatePreviewResult[];
}

export interface AppUpdateAuditLog {
  id: number | string | null;
  policyId: number;
  revision: number;
  eventType: string;
  success: boolean;
  beforePolicy: AppUpdatePolicy | null;
  afterPolicy: AppUpdatePolicy | null;
  actorId: number;
  publishedBy: number | null;
  occurredAt: string;
  publishedAt: string | null;
  reason: string;
  requestIp: string;
  userAgent: string;
  requestId: string;
}

export interface AppUpdateAuditLogPage {
  items: AppUpdateAuditLog[];
  page: number;
  size: number;
  totalPages: number;
  totalElements: number;
  hasNext: boolean;
}

export type AppUpdatePolicyForm = {
  platform: AppPlatform;
  latestVersion: string;
  latestBuild: string;
  forceUpdateEnabled: boolean;
  minimumSupportedBuild: string;
  optionalUpdateEnabled: boolean;
  storeUrl: string;
  title: string;
  message: string;
  reason: string;
};

export type AppUpdatePolicyFormField = keyof AppUpdatePolicyForm;
export type AppUpdatePolicyFieldErrors = Partial<Record<AppUpdatePolicyFormField, string>>;

export type AppUpdatePolicyDraftValues = {
  latestVersion: string;
  latestBuild: number;
  forceUpdateEnabled: boolean;
  minimumSupportedBuild: number | null;
  optionalUpdateEnabled: boolean;
  storeUrl: string;
  title: string;
  message: string;
};

export type AppUpdatePolicyCreateRequest = AppUpdatePolicyDraftValues & {
  platform: AppPlatform;
  reason: string;
};

export type AppUpdatePolicyUpdateRequest = AppUpdatePolicyDraftValues & {
  revision: number;
  reason: string;
};

export type AppUpdatePolicyFormValidation =
  | {
      ok: true;
      values: AppUpdatePolicyDraftValues;
      reason: string;
    }
  | {
      ok: false;
      errors: AppUpdatePolicyFieldErrors;
    };

const platformSet = new Set<string>(APP_UPDATE_PLATFORMS);
const statusSet = new Set<string>(APP_UPDATE_POLICY_STATUSES);
const actionSet = new Set<string>(APP_UPDATE_ACTIONS);
const unsafeTextPattern = /[\u0000-\u001f\u007f-\u009f]|[<>]/;
const positiveIntegerPattern = /^[1-9]\d*$/;
const kstDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

function userFacingError(message: string) {
  const error = new Error(message);
  error.name = "UserFacingError";
  return error;
}

function invalidPolicyData(message = "앱 업데이트 정책 정보를 확인할 수 없습니다. 잠시 후 다시 불러와 주세요."): never {
  throw userFacingError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isSafeInteger(value: unknown, minimum = 0) {
  return Number.isSafeInteger(value) && Number(value) >= minimum;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !Number.isNaN(Date.parse(value));
}

function parseRequiredTimestamp(value: unknown, field: string) {
  if (!isTimestamp(value)) invalidPolicyData(`${field} 값을 확인할 수 없습니다.`);
  return value;
}

function parseNullableTimestamp(value: unknown, field: string) {
  if (value === null) return null;
  return parseRequiredTimestamp(value, field);
}

function parsePositiveId(value: unknown, field: string) {
  if (!isSafeInteger(value, 1)) invalidPolicyData(`${field} 값은 1 이상의 정수여야 합니다.`);
  return Number(value);
}

function parseNullablePositiveId(value: unknown, field: string) {
  if (value === null) return null;
  return parsePositiveId(value, field);
}

function parseRequiredString(value: unknown, field: string) {
  if (typeof value !== "string") invalidPolicyData(`${field} 값을 확인할 수 없습니다.`);
  return value;
}

export function parseAppUpdatePolicy(value: unknown): AppUpdatePolicy {
  if (!isRecord(value)) invalidPolicyData();
  if (typeof value.platform !== "string" || !platformSet.has(value.platform)) {
    invalidPolicyData("정책 플랫폼을 확인할 수 없습니다.");
  }
  if (typeof value.status !== "string" || !statusSet.has(value.status)) {
    invalidPolicyData("정책 상태를 확인할 수 없습니다.");
  }
  if (typeof value.forceUpdateEnabled !== "boolean" || typeof value.optionalUpdateEnabled !== "boolean") {
    invalidPolicyData("정책의 업데이트 사용 여부를 확인할 수 없습니다.");
  }

  const latestBuild = parsePositiveId(value.latestBuild, "latestBuild");
  const minimumSupportedBuild = value.minimumSupportedBuild === null
    ? null
    : parsePositiveId(value.minimumSupportedBuild, "minimumSupportedBuild");

  if (!value.forceUpdateEnabled && minimumSupportedBuild !== null) {
    invalidPolicyData("강제 업데이트를 사용하지 않는 정책에 최소 지원 빌드가 설정되어 있습니다.");
  }
  if (value.forceUpdateEnabled && minimumSupportedBuild === null) {
    invalidPolicyData("강제 업데이트 정책의 최소 지원 빌드가 없습니다.");
  }
  if (minimumSupportedBuild !== null && minimumSupportedBuild > latestBuild) {
    invalidPolicyData("최소 지원 빌드가 최신 빌드보다 큽니다.");
  }

  return {
    id: parsePositiveId(value.id, "id"),
    revision: parsePositiveId(value.revision, "revision"),
    platform: value.platform as AppPlatform,
    latestVersion: parseRequiredString(value.latestVersion, "latestVersion"),
    latestBuild,
    forceUpdateEnabled: value.forceUpdateEnabled,
    minimumSupportedBuild,
    optionalUpdateEnabled: value.optionalUpdateEnabled,
    storeUrl: parseRequiredString(value.storeUrl, "storeUrl"),
    title: parseRequiredString(value.title, "title"),
    message: parseRequiredString(value.message, "message"),
    status: value.status as AppUpdatePolicyStatus,
    effectiveAt: parseNullableTimestamp(value.effectiveAt, "effectiveAt"),
    storeAvailabilityConfirmedAt: parseNullableTimestamp(
      value.storeAvailabilityConfirmedAt,
      "storeAvailabilityConfirmedAt",
    ),
    storeAvailabilityConfirmedBy: parseNullablePositiveId(
      value.storeAvailabilityConfirmedBy,
      "storeAvailabilityConfirmedBy",
    ),
    createdBy: parsePositiveId(value.createdBy, "createdBy"),
    updatedBy: parsePositiveId(value.updatedBy, "updatedBy"),
    publishedBy: parseNullablePositiveId(value.publishedBy, "publishedBy"),
    createdAt: parseRequiredTimestamp(value.createdAt, "createdAt"),
    updatedAt: parseRequiredTimestamp(value.updatedAt, "updatedAt"),
    publishedAt: parseNullableTimestamp(value.publishedAt, "publishedAt"),
  };
}

type ParsedPageEnvelope = {
  rawItems: unknown[];
  page: number;
  size: number;
  totalPages: number;
  totalElements: number;
  hasNext: boolean;
};

function parsePageEnvelope(value: unknown, itemLabel: string): ParsedPageEnvelope {
  if (Array.isArray(value)) {
    return {
      rawItems: value,
      page: 0,
      size: value.length,
      totalPages: value.length > 0 ? 1 : 0,
      totalElements: value.length,
      hasNext: false,
    };
  }
  if (!isRecord(value)) invalidPolicyData(`${itemLabel} 목록 형식을 확인할 수 없습니다.`);

  const rawItems = Array.isArray(value.items)
    ? value.items
    : Array.isArray(value.content)
      ? value.content
      : null;
  if (!rawItems) invalidPolicyData(`${itemLabel} 목록 항목을 확인할 수 없습니다.`);

  const pageValue = value.page ?? value.number ?? 0;
  const sizeValue = value.size ?? rawItems.length;
  const totalElementsValue = value.totalElements ?? rawItems.length;
  const totalPagesValue = value.totalPages ?? (rawItems.length > 0 ? 1 : 0);
  const hasNextValue = value.hasNext ?? (
    isSafeInteger(pageValue) && isSafeInteger(totalPagesValue)
      ? Number(pageValue) + 1 < Number(totalPagesValue)
      : false
  );

  if (
    !isSafeInteger(pageValue) ||
    !isSafeInteger(sizeValue) ||
    !isSafeInteger(totalElementsValue) ||
    !isSafeInteger(totalPagesValue) ||
    typeof hasNextValue !== "boolean"
  ) {
    invalidPolicyData(`${itemLabel} 목록의 페이지 정보를 확인할 수 없습니다.`);
  }

  return {
    rawItems,
    page: Number(pageValue),
    size: Number(sizeValue),
    totalPages: Number(totalPagesValue),
    totalElements: Number(totalElementsValue),
    hasNext: hasNextValue,
  };
}

export function parseAppUpdatePolicyPage(value: unknown): AppUpdatePolicyPage {
  const page = parsePageEnvelope(value, "앱 업데이트 정책");
  return {
    items: page.rawItems.map(parseAppUpdatePolicy),
    page: page.page,
    size: page.size,
    totalPages: page.totalPages,
    totalElements: page.totalElements,
    hasNext: page.hasNext,
  };
}

export function validateAppUpdatePolicySet(
  platform: AppPlatform,
  policies: readonly AppUpdatePolicy[],
) {
  const seenPolicyIds = new Set<number>();
  let activeCount = 0;
  let scheduledCount = 0;

  for (const policy of policies) {
    if (policy.platform !== platform) {
      invalidPolicyData("플랫폼이 다른 정책이 함께 조회되었습니다. 다시 불러와 주세요.");
    }
    if (seenPolicyIds.has(policy.id)) {
      invalidPolicyData("정책 목록에 중복 항목이 있습니다. 다시 불러와 주세요.");
    }
    seenPolicyIds.add(policy.id);
    if (policy.status === "ACTIVE") activeCount += 1;
    if (policy.status === "SCHEDULED") scheduledCount += 1;
  }

  if (activeCount > 1 || scheduledCount > 1) {
    invalidPolicyData("동시에 적용 중이거나 예약된 정책이 여러 개입니다. 변경 작업을 중단하고 서버 상태를 확인해 주세요.");
  }

  return [...policies];
}

export function parseAppUpdatePreview(
  value: unknown,
  expectedBuilds: readonly number[],
): AppUpdatePreview {
  if (!isRecord(value) || !Array.isArray(value.results)) {
    invalidPolicyData("게시 전 판정 결과를 확인할 수 없습니다.");
  }
  const results = value.results.map((entry) => {
    if (
      !isRecord(entry) ||
      !isSafeInteger(entry.build, 1) ||
      typeof entry.action !== "string" ||
      !actionSet.has(entry.action)
    ) {
      invalidPolicyData("게시 전 빌드 판정 결과를 확인할 수 없습니다.");
    }
    return {
      build: Number(entry.build),
      action: entry.action as AppUpdateAction,
    };
  });

  const expected = [...new Set(expectedBuilds)].sort((first, second) => first - second);
  const actual = [...new Set(results.map((entry) => entry.build))].sort((first, second) => first - second);
  if (
    expected.length === 0 ||
    expected.length !== expectedBuilds.length ||
    expected.some((build) => !isSafeInteger(build, 1)) ||
    results.length !== expected.length ||
    actual.length !== expected.length ||
    actual.some((build, index) => build !== expected[index])
  ) {
    invalidPolicyData("요청한 모든 판정 경계값의 결과를 확인할 수 없습니다. 게시하지 말고 다시 시도해 주세요.");
  }

  return {
    policyId: parsePositiveId(value.policyId, "policyId"),
    revision: parsePositiveId(value.revision, "revision"),
    results: results.sort((first, second) => first.build - second.build),
  };
}

function auditString(value: unknown, field: string, fallback = "-") {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") invalidPolicyData(`${field} 값을 확인할 수 없습니다.`);
  return value;
}

function parseAuditLog(value: unknown): AppUpdateAuditLog {
  if (!isRecord(value)) invalidPolicyData("감사 로그 항목을 확인할 수 없습니다.");
  const rawOccurredAt = value.occurredAt ?? value.createdAt ?? value.timestamp;
  const rawId = value.id ?? null;
  if (rawId !== null && typeof rawId !== "string" && !isSafeInteger(rawId, 1)) {
    invalidPolicyData("감사 로그 ID를 확인할 수 없습니다.");
  }
  if (typeof value.success !== "boolean") {
    invalidPolicyData("감사 로그 처리 결과를 확인할 수 없습니다.");
  }
  return {
    id: rawId === null ? null : rawId as number | string,
    policyId: parsePositiveId(value.policyId, "policyId"),
    revision: parsePositiveId(value.revision, "revision"),
    eventType: auditString(value.eventType, "eventType"),
    success: value.success,
    beforePolicy: value.beforePolicy === null || value.beforePolicy === undefined
      ? null
      : parseAppUpdatePolicy(value.beforePolicy),
    afterPolicy: value.afterPolicy === null || value.afterPolicy === undefined
      ? null
      : parseAppUpdatePolicy(value.afterPolicy),
    actorId: parsePositiveId(value.actorId, "actorId"),
    publishedBy: value.publishedBy === null || value.publishedBy === undefined
      ? null
      : parsePositiveId(value.publishedBy, "publishedBy"),
    occurredAt: parseRequiredTimestamp(rawOccurredAt, "occurredAt"),
    publishedAt: value.publishedAt === undefined || value.publishedAt === null
      ? null
      : parseRequiredTimestamp(value.publishedAt, "publishedAt"),
    reason: auditString(value.reason, "reason", "사유 정보 없음"),
    requestIp: auditString(value.requestIp ?? value.ip, "requestIp"),
    userAgent: auditString(value.userAgent, "userAgent"),
    requestId: auditString(value.requestId, "requestId"),
  };
}

export function parseAppUpdateAuditLogPage(value: unknown): AppUpdateAuditLogPage {
  const page = parsePageEnvelope(value, "변경 이력");
  return {
    items: page.rawItems.map(parseAuditLog),
    page: page.page,
    size: page.size,
    totalPages: page.totalPages,
    totalElements: page.totalElements,
    hasNext: page.hasNext,
  };
}

export function emptyAppUpdatePolicyForm(platform: AppPlatform): AppUpdatePolicyForm {
  return {
    platform,
    latestVersion: "",
    latestBuild: "",
    forceUpdateEnabled: false,
    minimumSupportedBuild: "",
    optionalUpdateEnabled: true,
    storeUrl: "",
    title: "업데이트가 필요해요",
    message: "",
    reason: "",
  };
}

export function appUpdatePolicyToForm(policy: AppUpdatePolicy): AppUpdatePolicyForm {
  return {
    platform: policy.platform,
    latestVersion: policy.latestVersion,
    latestBuild: String(policy.latestBuild),
    forceUpdateEnabled: policy.forceUpdateEnabled,
    minimumSupportedBuild: policy.minimumSupportedBuild === null
      ? ""
      : String(policy.minimumSupportedBuild),
    optionalUpdateEnabled: policy.optionalUpdateEnabled,
    storeUrl: policy.storeUrl,
    title: policy.title,
    message: policy.message,
    reason: "",
  };
}

export function copyAppUpdateWording(
  platform: AppPlatform,
  source: Pick<AppUpdatePolicy, "title" | "message">,
): AppUpdatePolicyForm {
  return {
    ...emptyAppUpdatePolicyForm(platform),
    title: source.title,
    message: source.message,
  };
}

function parsePositiveIntegerInput(value: string) {
  const normalized = value.trim();
  if (!positiveIntegerPattern.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function validateAppStoreUrl(platform: AppPlatform, rawValue: string): string | null {
  const value = rawValue.trim();
  if (!value) return "스토어 URL을 입력해 주세요.";
  if (value.length > 500) return "스토어 URL은 500자 이하로 입력해 주세요.";
  if (/\s|[\u0000-\u001f\u007f]/.test(value)) return "공백이나 제어 문자가 없는 HTTPS 주소를 입력해 주세요.";

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "올바른 HTTPS 주소를 입력해 주세요.";
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    return "사용자 정보가 포함되지 않은 HTTPS 주소를 입력해 주세요.";
  }

  if (platform === "IOS") {
    const appIdPathPattern = new RegExp(`/id${HANSEOMATE_IOS_APP_STORE_ID}/?$`);
    if (url.host !== "apps.apple.com" || url.hash || !appIdPathPattern.test(url.pathname)) {
      return `apps.apple.com에 있는 한서메이트 iOS 앱(ID ${HANSEOMATE_IOS_APP_STORE_ID}) 주소를 입력해 주세요.`;
    }
    return null;
  }

  if (
    url.host !== "play.google.com" ||
    url.hash ||
    url.pathname !== "/store/apps/details" ||
    url.searchParams.toString() !== `id=${HANSEOMATE_ANDROID_PACKAGE_ID}`
  ) {
    return `한서메이트 Android 앱(${HANSEOMATE_ANDROID_PACKAGE_ID})의 Google Play 주소를 입력해 주세요.`;
  }
  return null;
}

function validatePlainText(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
) {
  const normalized = value.trim();
  if (normalized.length < minimum || normalized.length > maximum) {
    return `${label}은 ${minimum}~${maximum}자로 입력해 주세요.`;
  }
  if (unsafeTextPattern.test(normalized)) {
    return `${label}에는 HTML 기호나 제어 문자를 사용할 수 없습니다.`;
  }
  return null;
}

export function validateAppUpdateReason(value: string) {
  return validatePlainText(value, "내부 변경 사유", 10, 500);
}

type ForceUpdateSettings = Pick<
  AppUpdatePolicy,
  "forceUpdateEnabled" | "minimumSupportedBuild"
>;

export function appUpdateRelaxationError(
  nextPolicy: ForceUpdateSettings,
  activePolicy: ForceUpdateSettings | null,
) {
  if (!activePolicy?.forceUpdateEnabled || activePolicy.minimumSupportedBuild === null) {
    return null;
  }
  if (!nextPolicy.forceUpdateEnabled || nextPolicy.minimumSupportedBuild === null) {
    return "현재 강제 업데이트를 해제하려면 긴급 완화·롤백을 사용해 주세요.";
  }
  if (nextPolicy.minimumSupportedBuild < activePolicy.minimumSupportedBuild) {
    return "현재 최소 지원 빌드를 낮추려면 긴급 완화·롤백을 사용해 주세요.";
  }
  return null;
}

export function appUpdatePublishSafetyError(
  nextPolicy: ForceUpdateSettings,
  activePolicy: ForceUpdateSettings | null,
) {
  const relaxationError = appUpdateRelaxationError(nextPolicy, activePolicy);
  if (relaxationError) return relaxationError;
  if (!activePolicy && nextPolicy.forceUpdateEnabled) {
    return "첫 정책은 강제 업데이트를 끈 상태로 먼저 게시해 긴급 복구 기준을 만들어 주세요.";
  }
  return null;
}

export function validateAppUpdatePolicyForm(
  form: AppUpdatePolicyForm,
  activePolicy: AppUpdatePolicy | null = null,
): AppUpdatePolicyFormValidation {
  const errors: AppUpdatePolicyFieldErrors = {};
  const latestVersion = form.latestVersion.trim();
  const latestBuild = parsePositiveIntegerInput(form.latestBuild);
  const minimumSupportedBuild = form.forceUpdateEnabled
    ? parsePositiveIntegerInput(form.minimumSupportedBuild)
    : null;
  const reason = form.reason.trim();

  if (latestVersion.length < 1 || latestVersion.length > 32 || unsafeTextPattern.test(latestVersion)) {
    errors.latestVersion = "최신 표시 버전은 HTML·제어 문자를 제외하고 1~32자로 입력해 주세요.";
  }
  if (latestBuild === null) {
    errors.latestBuild = "최신 빌드는 1 이상의 정수로 입력해 주세요.";
  }
  if (form.forceUpdateEnabled) {
    if (minimumSupportedBuild === null) {
      errors.minimumSupportedBuild = "강제 업데이트의 최소 지원 빌드를 입력해 주세요.";
    } else if (latestBuild !== null && minimumSupportedBuild > latestBuild) {
      errors.minimumSupportedBuild = "최소 지원 빌드는 최신 빌드 이하여야 합니다.";
    }
  }

  const relaxationError = appUpdateRelaxationError(
    { forceUpdateEnabled: form.forceUpdateEnabled, minimumSupportedBuild },
    activePolicy,
  );
  if (relaxationError) {
    if (form.forceUpdateEnabled) errors.minimumSupportedBuild = relaxationError;
    else errors.forceUpdateEnabled = relaxationError;
  }

  const storeUrlError = validateAppStoreUrl(form.platform, form.storeUrl);
  if (storeUrlError) errors.storeUrl = storeUrlError;
  const titleError = validatePlainText(form.title, "제목", 2, 40);
  if (titleError) errors.title = titleError;
  const messageError = validatePlainText(form.message, "안내문", 1, 300);
  if (messageError) errors.message = messageError;
  const reasonError = validateAppUpdateReason(form.reason);
  if (reasonError) errors.reason = reasonError;

  if (Object.keys(errors).length > 0 || latestBuild === null) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    values: {
      latestVersion,
      latestBuild,
      forceUpdateEnabled: form.forceUpdateEnabled,
      minimumSupportedBuild,
      optionalUpdateEnabled: form.optionalUpdateEnabled,
      storeUrl: form.storeUrl.trim(),
      title: form.title.trim(),
      message: form.message.trim(),
    },
    reason,
  };
}

export function createAppUpdatePolicyCreateRequest(
  form: AppUpdatePolicyForm,
  activePolicy: AppUpdatePolicy | null = null,
): AppUpdatePolicyCreateRequest {
  const result = validateAppUpdatePolicyForm(form, activePolicy);
  if (!result.ok) throw userFacingError("정책 입력 내용을 다시 확인해 주세요.");
  return {
    platform: form.platform,
    ...result.values,
    reason: result.reason,
  };
}

export function createAppUpdatePolicyUpdateRequest(
  form: AppUpdatePolicyForm,
  revision: number,
  activePolicy: AppUpdatePolicy | null = null,
): AppUpdatePolicyUpdateRequest {
  if (!isSafeInteger(revision, 1)) throw userFacingError("정책 revision을 확인할 수 없습니다.");
  const result = validateAppUpdatePolicyForm(form, activePolicy);
  if (!result.ok) throw userFacingError("정책 입력 내용을 다시 확인해 주세요.");
  return {
    revision,
    ...result.values,
    reason: result.reason,
  };
}

export function appUpdatePolicyFormSignature(form: AppUpdatePolicyForm) {
  return JSON.stringify(form);
}

export function appUpdatePreviewBuilds(policy: AppUpdatePolicy) {
  const builds = new Set<number>();
  if (policy.forceUpdateEnabled && policy.minimumSupportedBuild !== null) {
    if (policy.minimumSupportedBuild > 1) builds.add(policy.minimumSupportedBuild - 1);
    builds.add(policy.minimumSupportedBuild);
  }
  if (policy.latestBuild > 1) builds.add(policy.latestBuild - 1);
  builds.add(policy.latestBuild);
  return [...builds].sort((first, second) => first - second);
}

function validKstDateTimeParts(match: RegExpMatchArray) {
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    hour >= 0 && hour <= 23 &&
    minute >= 0 && minute <= 59;
}

export function kstDateTimeToUtcIso(value: string) {
  const normalized = value.trim();
  const match = normalized.match(kstDateTimePattern);
  if (!match || !validKstDateTimeParts(match)) {
    throw userFacingError("예약 날짜와 시간을 다시 확인해 주세요.");
  }
  const date = new Date(`${normalized}:00+09:00`);
  if (Number.isNaN(date.getTime())) throw userFacingError("예약 날짜와 시간을 다시 확인해 주세요.");
  return date.toISOString();
}

export function createOperationIdempotencyKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `app-update-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function extractAppUpdateFieldErrors(payload: unknown): AppUpdatePolicyFieldErrors {
  if (!isRecord(payload)) return {};
  const candidate = isRecord(payload.fieldErrors)
    ? payload.fieldErrors
    : isRecord(payload.errors)
      ? payload.errors
      : null;
  if (!candidate) return {};

  const fields = new Set<string>([
    "platform",
    "latestVersion",
    "latestBuild",
    "forceUpdateEnabled",
    "minimumSupportedBuild",
    "optionalUpdateEnabled",
    "storeUrl",
    "title",
    "message",
    "reason",
  ]);
  const errors: AppUpdatePolicyFieldErrors = {};
  for (const [field, rawMessage] of Object.entries(candidate)) {
    if (!fields.has(field)) continue;
    const message = Array.isArray(rawMessage) ? rawMessage[0] : rawMessage;
    if (typeof message === "string" && message.trim()) {
      errors[field as AppUpdatePolicyFormField] = message;
    }
  }
  return errors;
}
