import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  APP_UPDATE_AUDIT_EVENT_TYPES,
  APP_UPDATE_AUDIT_LOGS_ENDPOINT,
  APP_UPDATE_POLICIES_ENDPOINT,
  appUpdateRelaxationError,
  appUpdatePublishSafetyError,
  appUpdatePreviewBuilds,
  copyAppUpdateWording,
  createAppUpdatePolicyCreateRequest,
  createAppUpdatePolicyRelaxRequest,
  createAppUpdatePolicyUpdateRequest,
  emptyAppUpdatePolicyForm,
  isAppUpdateRelaxation,
  kstDateTimeToUtcIso,
  parseAppUpdateAuditLogPage,
  parseAppUpdatePolicy,
  parseAppUpdatePolicyPage,
  parseAppUpdatePreview,
  validateAppStoreUrl,
  validateAppUpdatePolicyRelaxRequest,
  validateAppUpdatePolicySet,
  validateAppUpdatePolicyForm,
} from "../app/lib/app-update-policies.ts";

const root = new URL("../", import.meta.url);

function policy(overrides = {}) {
  return {
    id: 17,
    revision: 3,
    platform: "IOS",
    latestVersion: "1.3",
    latestBuild: 29,
    forceUpdateEnabled: true,
    minimumSupportedBuild: 28,
    optionalUpdateEnabled: true,
    storeUrl: "https://apps.apple.com/kr/app/id6804946491",
    title: "업데이트가 필요해요",
    message: "안정적인 서비스 이용을 위해 최신 버전을 설치해 주세요.",
    status: "ACTIVE",
    effectiveAt: "2026-09-09T04:00:00Z",
    storeAvailabilityConfirmedAt: "2026-09-09T03:59:00Z",
    storeAvailabilityConfirmedBy: 2,
    createdBy: 1,
    updatedBy: 2,
    publishedBy: 2,
    createdAt: "2026-09-08T04:00:00Z",
    updatedAt: "2026-09-09T04:00:00Z",
    publishedAt: "2026-09-09T04:00:00Z",
    ...overrides,
  };
}

function validForm(platform = "IOS") {
  return {
    ...emptyAppUpdatePolicyForm(platform),
    latestVersion: "1.4",
    latestBuild: "30",
    forceUpdateEnabled: true,
    minimumSupportedBuild: "29",
    optionalUpdateEnabled: true,
    storeUrl: platform === "IOS"
      ? "https://apps.apple.com/kr/app/id6804946491"
      : "https://play.google.com/store/apps/details?id=com.hanseomate.app",
    title: "업데이트가 필요해요",
    message: "안정적인 서비스 이용을 위해 최신 버전을 설치해 주세요.",
    reason: "스토어 배포가 완료되어 새 빌드를 적용합니다.",
  };
}

test("uses the documented administrator endpoints", () => {
  assert.equal(APP_UPDATE_POLICIES_ENDPOINT, "/api/admin/app-update-policies");
  assert.equal(APP_UPDATE_AUDIT_LOGS_ENDPOINT, "/api/admin/app-update-policies/audit-logs");
});

test("parses policy pages while preserving platform and immutable history fields", () => {
  const parsed = parseAppUpdatePolicyPage({
    items: [policy()],
    page: 0,
    size: 20,
    totalPages: 1,
    totalElements: 1,
    hasNext: false,
  });
  assert.equal(parsed.items[0].platform, "IOS");
  assert.equal(parsed.items[0].status, "ACTIVE");
  assert.equal(parsed.items[0].revision, 3);
  assert.equal(parsed.items[0].minimumSupportedBuild, 28);

  const springPage = parseAppUpdatePolicyPage({
    content: [policy({ id: 18, platform: "ANDROID", storeUrl: "https://play.google.com/store/apps/details?id=com.hanseomate.app" })],
    number: 0,
    size: 20,
    totalPages: 1,
    totalElements: 1,
  });
  assert.equal(springPage.items[0].platform, "ANDROID");
  assert.equal(springPage.hasNext, false);
});

test("rejects duplicate or ambiguous platform policy state", () => {
  const active = parseAppUpdatePolicy(policy());
  assert.throws(
    () => validateAppUpdatePolicySet("IOS", [active, active]),
    /중복/,
  );
  assert.throws(
    () => validateAppUpdatePolicySet("IOS", [
      active,
      parseAppUpdatePolicy(policy({ id: 18, revision: 4 })),
    ]),
    /여러 개/,
  );
  assert.throws(
    () => validateAppUpdatePolicySet("ANDROID", [active]),
    /플랫폼/,
  );
});

test("rejects impossible force-update policy responses", () => {
  assert.throws(
    () => parseAppUpdatePolicy(policy({ forceUpdateEnabled: false, minimumSupportedBuild: 28 })),
    /최소 지원 빌드/,
  );
  assert.throws(
    () => parseAppUpdatePolicy(policy({ minimumSupportedBuild: 30, latestBuild: 29 })),
    /최신 빌드보다 큽니다/,
  );
  assert.throws(
    () => parseAppUpdatePolicy(policy({ platform: "WEB" })),
    /플랫폼/,
  );
});

test("creates exact draft requests without accepting server-owned state", () => {
  const form = validForm();
  const create = createAppUpdatePolicyCreateRequest(form);
  assert.deepEqual(create, {
    platform: "IOS",
    latestVersion: "1.4",
    latestBuild: 30,
    forceUpdateEnabled: true,
    minimumSupportedBuild: 29,
    optionalUpdateEnabled: true,
    storeUrl: "https://apps.apple.com/kr/app/id6804946491",
    title: "업데이트가 필요해요",
    message: "안정적인 서비스 이용을 위해 최신 버전을 설치해 주세요.",
    reason: "스토어 배포가 완료되어 새 빌드를 적용합니다.",
  });
  assert.equal("status" in create, false);
  assert.equal("publishedAt" in create, false);

  const update = createAppUpdatePolicyUpdateRequest(form, 4);
  assert.equal(update.revision, 4);
  assert.equal("platform" in update, false);
});

test("normalizes disabled force updates to a null minimum build", () => {
  const form = {
    ...validForm(),
    forceUpdateEnabled: false,
    minimumSupportedBuild: "999",
  };
  const result = validateAppUpdatePolicyForm(form);
  assert.equal(result.ok, true);
  assert.equal(result.values.minimumSupportedBuild, null);
});

test("validates platform-specific HTTPS store links", () => {
  assert.equal(validateAppStoreUrl("IOS", "https://apps.apple.com/kr/app/id6804946491"), null);
  assert.equal(
    validateAppStoreUrl("ANDROID", "https://play.google.com/store/apps/details?id=com.hanseomate.app"),
    null,
  );
  assert.match(validateAppStoreUrl("IOS", "https://evil.example/id6804946491"), /apps\.apple\.com/);
  assert.match(
    validateAppStoreUrl("IOS", "https://apps.apple.com/app/id1234567890"),
    /6804946491/,
  );
  assert.match(
    validateAppStoreUrl("ANDROID", "https://play.google.com/store/apps/details?id=another.app"),
    /com\.hanseomate\.app/,
  );
  assert.match(
    validateAppStoreUrl("ANDROID", "https://play.google.com/store/apps/details?id=com.hanseomate.app&hl=ko"),
    /com\.hanseomate\.app/,
  );
  assert.match(
    validateAppStoreUrl("IOS", "https://apps.apple.com/kr/app/id6804946491#details"),
    /6804946491/,
  );
  assert.match(
    validateAppStoreUrl("IOS", "https://apps.apple.com/kr/app/id6804946491/extra"),
    /6804946491/,
  );
  assert.match(validateAppStoreUrl("IOS", "javascript:alert(1)"), /HTTPS/);
  assert.match(validateAppStoreUrl("ANDROID", "https://user:pass@play.google.com/store/apps/details?id=com.hanseomate.app"), /사용자 정보/);
});

test("rejects unsafe copy, weak reasons, invalid builds, and standard-flow relaxations", () => {
  const htmlForm = { ...validForm(), message: "<script>alert(1)</script>" };
  const htmlResult = validateAppUpdatePolicyForm(htmlForm);
  assert.equal(htmlResult.ok, false);
  assert.match(htmlResult.errors.message, /HTML/);

  const newlineResult = validateAppUpdatePolicyForm({
    ...validForm(),
    message: "첫 줄\n둘째 줄",
  });
  assert.equal(newlineResult.ok, false);
  assert.match(newlineResult.errors.message, /제어 문자/);

  const tabResult = validateAppUpdatePolicyForm({
    ...validForm(),
    title: "업데이트\t필요",
  });
  assert.equal(tabResult.ok, false);
  assert.match(tabResult.errors.title, /제어 문자/);

  const shortReason = validateAppUpdatePolicyForm({ ...validForm(), reason: "짧은 사유" });
  assert.equal(shortReason.ok, false);
  assert.match(shortReason.errors.reason, /10~500/);

  const invalidBuild = validateAppUpdatePolicyForm({ ...validForm(), latestBuild: "1.5" });
  assert.equal(invalidBuild.ok, false);
  assert.match(invalidBuild.errors.latestBuild, /정수/);

  const lowering = validateAppUpdatePolicyForm(
    { ...validForm(), minimumSupportedBuild: "27" },
    parseAppUpdatePolicy(policy()),
  );
  assert.equal(lowering.ok, false);
  assert.match(lowering.errors.minimumSupportedBuild, /긴급 완화·롤백/);

  const disablingForceUpdate = validateAppUpdatePolicyForm(
    { ...validForm(), forceUpdateEnabled: false, minimumSupportedBuild: "" },
    parseAppUpdatePolicy(policy()),
  );
  assert.equal(disablingForceUpdate.ok, false);
  assert.match(disablingForceUpdate.errors.forceUpdateEnabled, /긴급 완화·롤백/);
  assert.match(
    appUpdateRelaxationError(
      { forceUpdateEnabled: false, minimumSupportedBuild: null },
      parseAppUpdatePolicy(policy()),
    ),
    /긴급 완화·롤백/,
  );
  assert.equal(
    appUpdatePublishSafetyError(
      { forceUpdateEnabled: true, minimumSupportedBuild: 29 },
      null,
    ),
    null,
  );
  assert.equal(
    appUpdatePublishSafetyError(
      { forceUpdateEnabled: true, minimumSupportedBuild: 29 },
      { forceUpdateEnabled: false, minimumSupportedBuild: null },
    ),
    null,
  );
});

test("allows relaxed DRAFT creation only through the explicit relaxation validation mode", () => {
  const active = parseAppUpdatePolicy(policy());
  const relaxedForm = {
    ...validForm(),
    forceUpdateEnabled: false,
    minimumSupportedBuild: "",
    optionalUpdateEnabled: false,
    title: "업데이트 안내",
    message: "현재 버전을 계속 사용할 수 있습니다.",
    reason: "잘못 적용된 최소 지원 빌드 제한을 긴급 해제합니다.",
  };

  const standard = validateAppUpdatePolicyForm(relaxedForm, active);
  assert.equal(standard.ok, false);
  assert.match(standard.errors.forceUpdateEnabled, /긴급 완화·롤백/);

  const relaxationDraft = validateAppUpdatePolicyForm(relaxedForm, active, "RELAX_DRAFT");
  assert.equal(relaxationDraft.ok, true);
  assert.equal(relaxationDraft.values.forceUpdateEnabled, false);
  assert.equal(relaxationDraft.values.minimumSupportedBuild, null);
  assert.equal(isAppUpdateRelaxation(relaxationDraft.values, active), true);

  const request = createAppUpdatePolicyCreateRequest(relaxedForm, active, "RELAX_DRAFT");
  assert.equal(request.forceUpdateEnabled, false);
  assert.equal(request.minimumSupportedBuild, null);

  const lowerMinimumForm = {
    ...validForm(),
    minimumSupportedBuild: "27",
    reason: "차단 범위를 줄이기 위해 최소 지원 빌드를 긴급 하향합니다.",
  };
  const updateRequest = createAppUpdatePolicyUpdateRequest(
    lowerMinimumForm,
    2,
    active,
    "RELAX_DRAFT",
  );
  assert.equal(updateRequest.revision, 2);
  assert.equal(updateRequest.minimumSupportedBuild, 27);

  const notActuallyRelaxed = validateAppUpdatePolicyForm(validForm(), active, "RELAX_DRAFT");
  assert.equal(notActuallyRelaxed.ok, false);
  assert.match(notActuallyRelaxed.errors.forceUpdateEnabled, /현재 활성 정책보다 강제 조건을 낮춰야/);

  assert.match(appUpdatePublishSafetyError(relaxationDraft.values, active), /긴급 완화·롤백/);
});

test("builds the exact emergency relaxation request and rejects unsafe operations", () => {
  const active = parseAppUpdatePolicy(policy());
  const draft = parseAppUpdatePolicy(policy({
    id: 19,
    revision: 1,
    status: "DRAFT",
    forceUpdateEnabled: false,
    minimumSupportedBuild: null,
    optionalUpdateEnabled: false,
    publishedBy: null,
    publishedAt: null,
    effectiveAt: null,
    storeAvailabilityConfirmedAt: null,
    storeAvailabilityConfirmedBy: null,
  }));
  const reason = "잘못된 최소 빌드 기준으로 발생한 차단을 긴급 해제합니다.";

  assert.equal(validateAppUpdatePolicyRelaxRequest(draft, active, true, reason), null);
  assert.deepEqual(createAppUpdatePolicyRelaxRequest(draft, active, true, `  ${reason}  `), {
    revision: 1,
    expectedActivePolicyId: 17,
    expectedActiveRevision: 3,
    storeAvailabilityConfirmed: true,
    reason,
  });

  assert.throws(
    () => createAppUpdatePolicyRelaxRequest(draft, active, false, reason),
    /스토어 설치 가능 여부/,
  );
  assert.throws(
    () => createAppUpdatePolicyRelaxRequest(
      parseAppUpdatePolicy({ ...draft, id: active.id }),
      active,
      true,
      reason,
    ),
    /별도로 생성한 완화 초안/,
  );
  assert.throws(
    () => createAppUpdatePolicyRelaxRequest(
      parseAppUpdatePolicy(policy({ id: 19, revision: 1, status: "DRAFT" })),
      active,
      true,
      reason,
    ),
    /강제 조건을 낮춰야/,
  );
  assert.throws(
    () => createAppUpdatePolicyRelaxRequest(
      parseAppUpdatePolicy(policy({
        id: 19,
        revision: 1,
        status: "DRAFT",
        platform: "ANDROID",
        storeUrl: "https://play.google.com/store/apps/details?id=com.hanseomate.app",
        forceUpdateEnabled: false,
        minimumSupportedBuild: null,
      })),
      active,
      true,
      reason,
    ),
    /같은 플랫폼/,
  );
});

test("copies only wording across platforms", () => {
  const copied = copyAppUpdateWording("ANDROID", policy());
  assert.equal(copied.platform, "ANDROID");
  assert.equal(copied.title, policy().title);
  assert.equal(copied.message, policy().message);
  assert.equal(copied.latestVersion, "");
  assert.equal(copied.latestBuild, "");
  assert.equal(copied.storeUrl, "");
  assert.equal(copied.minimumSupportedBuild, "");
});

test("preserves the requested build order in server previews without calculating actions locally", () => {
  assert.deepEqual(appUpdatePreviewBuilds(parseAppUpdatePolicy(policy())), [27, 28, 29]);
  assert.deepEqual(
    appUpdatePreviewBuilds(parseAppUpdatePolicy(policy({ minimumSupportedBuild: 1, latestBuild: 2 }))),
    [1, 2],
  );
  assert.deepEqual(
    parseAppUpdatePreview({
      policyId: 17,
      revision: 3,
      results: [
        { build: 29, action: "NONE" },
        { build: 27, action: "REQUIRED" },
        { build: 28, action: "OPTIONAL" },
      ],
    }, [29, 27, 28]).results.map((entry) => [entry.build, entry.action]),
    [[29, "NONE"], [27, "REQUIRED"], [28, "OPTIONAL"]],
  );
  assert.throws(
    () => parseAppUpdatePreview({
      policyId: 17,
      revision: 3,
      results: [
        { build: 27, action: "REQUIRED" },
        { build: 29, action: "NONE" },
      ],
    }, [27, 28, 29]),
    /모든 판정 경계값/,
  );
  assert.throws(
    () => parseAppUpdatePreview({
      policyId: 17,
      revision: 3,
      results: [
        { build: 27, action: "REQUIRED" },
        { build: 29, action: "NONE" },
        { build: 28, action: "OPTIONAL" },
      ],
    }, [29, 27, 28]),
    /입력 순서대로/,
  );
  assert.throws(
    () => parseAppUpdatePreview({
      policyId: 17,
      revision: 3,
      results: [
        { build: 27, action: "REQUIRED" },
        { build: 27, action: "REQUIRED" },
        { build: 29, action: "NONE" },
      ],
    }, [27, 28, 29]),
    /입력 순서대로/,
  );
});

test("converts administrator KST reservation input to an explicit UTC instant", () => {
  assert.equal(kstDateTimeToUtcIso("2026-09-09T13:00"), "2026-09-09T04:00:00.000Z");
  assert.throws(() => kstDateTimeToUtcIso("2026-02-30T13:00"), /다시 확인/);
});

test("parses the exact append-only audit DTO including nullable system activation fields", () => {
  assert.deepEqual(APP_UPDATE_AUDIT_EVENT_TYPES, [
    "CREATE",
    "UPDATE",
    "PUBLISH",
    "SCHEDULE",
    "ACTIVATE",
    "CANCEL",
    "ROLLBACK",
    "RELAX",
  ]);

  const parsed = parseAppUpdateAuditLogPage({
    items: [{
      id: 91,
      policyId: null,
      revision: null,
      platform: null,
      eventType: "ACTIVATE",
      success: true,
      beforeSnapshot: { status: "SCHEDULED", serverOnlyField: "preserved" },
      afterSnapshot: ["arbitrary", { status: "ACTIVE" }],
      actorId: null,
      publishedBy: null,
      publishedAt: null,
      createdAt: "2026-09-09T04:00:00Z",
      reason: "예약 시각 도달로 자동 활성화",
      requestIp: null,
      userAgent: null,
      requestId: "req-123",
      failureMessage: null,
    }],
    page: 0,
    size: 20,
    totalPages: 1,
    totalElements: 1,
    hasNext: false,
  });
  assert.equal(parsed.items[0].eventType, "ACTIVATE");
  assert.equal(parsed.items[0].policyId, null);
  assert.equal(parsed.items[0].revision, null);
  assert.equal(parsed.items[0].platform, null);
  assert.equal(parsed.items[0].actorId, null);
  assert.deepEqual(parsed.items[0].beforeSnapshot, { status: "SCHEDULED", serverOnlyField: "preserved" });
  assert.deepEqual(parsed.items[0].afterSnapshot, ["arbitrary", { status: "ACTIVE" }]);
  assert.equal(parsed.items[0].createdAt, "2026-09-09T04:00:00Z");
  assert.equal(parsed.items[0].requestId, "req-123");
  assert.equal(parsed.items[0].failureMessage, null);
  assert.equal("occurredAt" in parsed.items[0], false);
  assert.equal("beforePolicy" in parsed.items[0], false);
});

test("rejects undocumented or legacy audit response shapes", () => {
  const validAudit = {
    id: 92,
    policyId: 17,
    revision: 3,
    platform: "IOS",
    eventType: "RELAX",
    success: false,
    beforeSnapshot: null,
    afterSnapshot: null,
    actorId: 7,
    publishedBy: null,
    publishedAt: null,
    createdAt: "2026-09-09T04:00:00Z",
    reason: "완화 작업 처리 실패",
    requestIp: "203.0.113.10",
    userAgent: "Admin Browser",
    requestId: "req-456",
    failureMessage: "revision이 변경되었습니다.",
  };
  const parsed = parseAppUpdateAuditLogPage([validAudit]);
  assert.equal(parsed.items[0].failureMessage, "revision이 변경되었습니다.");

  assert.throws(
    () => parseAppUpdateAuditLogPage([{ ...validAudit, eventType: "DELETE" }]),
    /작업 종류/,
  );
  assert.throws(
    () => parseAppUpdateAuditLogPage([{
      ...validAudit,
      beforeSnapshot: undefined,
      afterSnapshot: undefined,
      beforePolicy: policy(),
      afterPolicy: policy(),
      occurredAt: validAudit.createdAt,
    }]),
    /변경 전후/,
  );
  assert.throws(
    () => parseAppUpdateAuditLogPage([{ ...validAudit, actorId: 0 }]),
    /actorId/,
  );
});

test("wires every admin workflow, idempotency guard, and platform-isolated navigation", async () => {
  const [pageSource, shellSource] = await Promise.all([
    readFile(new URL("app/settings/app-updates/page.tsx", root), "utf8"),
    readFile(new URL("app/components/AppShell.tsx", root), "utf8"),
  ]);

  assert.match(shellSource, /label: "운영 관리"/);
  assert.match(shellSource, /href: "\/settings\/app-updates",\s*label: "앱 업데이트"/);
  assert.match(pageSource, /<AdminLoginNotice returnTo="\/settings\/app-updates">/);
  assert.match(pageSource, /platform:\s*filters\.platform|platform,\s*page:/);
  assert.match(pageSource, /APP_UPDATE_POLICY_STATUSES\.map/);
  assert.match(pageSource, /while \(true\)/);
  assert.match(pageSource, /appUpdatePublishSafetyError/);
  assert.match(pageSource, /fieldset className=\{styles\.formGrid\} disabled=\{savingDraft\}/);
  assert.match(pageSource, /modeFieldset\} disabled=\{busyOperation === "publish" \|\| publishDialog\.retryReady\}/);
  assert.match(pageSource, /id="app-update-feedback"/);
  assert.match(pageSource, /document\.getElementById\("app-update-feedback"\)/);
  assert.match(pageSource, /if \(elements\.length === 0\)[\s\S]*dialogRef\.current\?\.focus\(\)/);
  assert.match(pageSource, /aria-busy=\{busy \|\| undefined\}[\s\S]*tabIndex=\{-1\}/);
  assert.match(pageSource, /slice\(0, historyVisibleCount\)/);
  assert.doesNotMatch(pageSource, /previousPolicies\.slice\(0, 8\)/);
  assert.match(pageSource, /\/preview`/);
  assert.match(pageSource, /\/publish`/);
  assert.match(pageSource, /\/cancel`/);
  assert.match(pageSource, /\/rollback`/);
  assert.match(pageSource, /\/relax`/);
  assert.match(pageSource, /"Idempotency-Key"/);
  assert.match(pageSource, /error\.status === 408/);
  assert.match(pageSource, /!dialog\.retryReady && Date\.parse\(effectiveAt\) <= Date\.now\(\)/);
  assert.match(pageSource, /expectedActivePolicyId/);
  assert.match(pageSource, /expectedActiveRevision/);
  assert.match(pageSource, /storeAvailabilityConfirmed:\s*true/);
  assert.match(pageSource, /완료 여부를 확인하지 못해 같은 요청으로 다시 시도할 수 있습니다/);
  assert.match(pageSource, /문구만 복사/);
  assert.match(pageSource, /버전, 빌드, 스토어 URL, 적용 시각은 복사하지 않습니다/);
  assert.doesNotMatch(pageSource, /iOS·Android 동시 적용|IOS·ANDROID 동시 적용/);
  assert.doesNotMatch(pageSource, /dangerouslySetInnerHTML/);
});
