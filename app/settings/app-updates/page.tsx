"use client";

import {
  AndroidLogo,
  AppleLogo,
  ArrowClockwise,
  ArrowSquareOut,
  CalendarCheck,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Clock,
  ClockCounterClockwise,
  Copy,
  DeviceMobile,
  Eye,
  FloppyDisk,
  Info,
  ListBullets,
  NotePencil,
  Plus,
  Prohibit,
  RocketLaunch,
  ShieldWarning,
  SpinnerGap,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdminLoginNotice } from "../../components/AdminLoginNotice";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { UnsavedChangesDialog } from "../../components/UnsavedChangesDialog";
import { ApiError, apiFetch, getErrorText } from "../../lib/api";
import {
  ADMIN_SESSION_EVENT,
  getAdminSession,
} from "../../lib/auth";
import {
  APP_UPDATE_AUDIT_EVENT_TYPES,
  APP_UPDATE_AUDIT_LOGS_ENDPOINT,
  APP_UPDATE_PLATFORMS,
  APP_UPDATE_POLICY_STATUSES,
  APP_UPDATE_POLICIES_ENDPOINT,
  type AppPlatform,
  type AppUpdateAuditLog,
  type AppUpdateAuditLogPage,
  type AppUpdatePolicy,
  type AppUpdatePolicyFieldErrors,
  type AppUpdatePolicyForm,
  type AppUpdatePreview,
  type PublishMode,
  appUpdatePublishSafetyError,
  appUpdatePolicyFormSignature,
  appUpdatePolicyToForm,
  appUpdatePreviewBuilds,
  copyAppUpdateWording,
  createAppUpdatePolicyCreateRequest,
  createAppUpdatePolicyRelaxRequest,
  createAppUpdatePolicyUpdateRequest,
  createOperationIdempotencyKey,
  emptyAppUpdatePolicyForm,
  extractAppUpdateFieldErrors,
  isAppUpdateRelaxation,
  kstDateTimeToUtcIso,
  parseAppUpdateAuditLogPage,
  parseAppUpdatePolicy,
  parseAppUpdatePolicyPage,
  parseAppUpdatePreview,
  validateAppStoreUrl,
  validateAppUpdatePolicySet,
  validateAppUpdatePolicyForm,
  validateAppUpdatePolicyRelaxRequest,
  validateAppUpdateReason,
} from "../../lib/app-update-policies";
import styles from "./app-updates.module.css";

type LoadState = "idle" | "loading" | "ready" | "error";
type Feedback = {
  tone: "success" | "warning" | "error";
  title: string;
  message: string;
};
type PlatformPolicyState = {
  status: LoadState;
  items: AppUpdatePolicy[];
  error: string;
};
type RecentAuditState = {
  status: LoadState;
  item: AppUpdateAuditLog | null;
  error: string;
};
type EditorState = {
  mode: "create" | "edit";
  policy: AppUpdatePolicy | null;
  form: AppUpdatePolicyForm;
  baseline: string;
};
type PreviewState = {
  policy: AppUpdatePolicy;
  status: LoadState;
  data: AppUpdatePreview | null;
  selectedBuild: number | null;
  error: string;
};
type PublishDialogState = {
  policy: AppUpdatePolicy;
  activePolicyIdAtStart: number | null;
  mode: PublishMode;
  effectiveAt: string;
  storeAvailabilityConfirmed: boolean;
  reason: string;
  confirmation: string;
  idempotencyKey: string;
  retryReady: boolean;
  error: string;
};
type CancelDialogState = {
  policy: AppUpdatePolicy;
  activePolicyIdAtStart: number | null;
  reason: string;
  idempotencyKey: string;
  retryReady: boolean;
  error: string;
};
type RollbackDialogState = {
  target: AppUpdatePolicy;
  active: AppUpdatePolicy;
  scheduledPolicyIdAtStart: number | null;
  reason: string;
  confirmation: string;
  idempotencyKey: string;
  retryReady: boolean;
  error: string;
};
type RelaxDialogState = {
  policy: AppUpdatePolicy;
  active: AppUpdatePolicy;
  scheduledPolicyIdAtStart: number | null;
  storeAvailabilityConfirmed: boolean;
  reason: string;
  confirmation: string;
  idempotencyKey: string;
  retryReady: boolean;
  error: string;
};
type AuditFilters = {
  platform: AppPlatform;
  eventType: string;
  actorId: string;
  from: string;
  to: string;
};
type AuditDialogState = {
  open: boolean;
  status: LoadState;
  filters: AuditFilters;
  data: AppUpdateAuditLogPage | null;
  error: string;
};

const policyStatusLabels = {
  DRAFT: "초안",
  SCHEDULED: "예약",
  ACTIVE: "적용 중",
  SUPERSEDED: "이전 정책",
  CANCELLED: "예약 취소",
} as const;

const actionLabels = {
  NONE: "진입 허용",
  OPTIONAL: "선택 업데이트",
  REQUIRED: "강제 업데이트",
} as const;

const auditEventLabels: Record<string, string> = {
  CREATE: "초안 생성",
  UPDATE: "초안 수정",
  PUBLISH: "즉시 게시",
  SCHEDULE: "예약 게시",
  ACTIVATE: "예약 적용",
  CANCEL: "예약 취소",
  ROLLBACK: "과거 정책 롤백",
  RELAX: "강제 조건 긴급 완화",
};

const kstDateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Asia/Seoul",
  timeZoneName: "short",
});

function emptyPolicyState(): PlatformPolicyState {
  return { status: "idle", items: [], error: "" };
}

function emptyRecentAuditState(): RecentAuditState {
  return { status: "idle", item: null, error: "" };
}

function formatTimestamp(value: string | null) {
  if (value === null) return "아직 적용되지 않음";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "시각 확인 불가" : kstDateTimeFormatter.format(date);
}

function platformLabel(platform: AppPlatform) {
  return platform === "IOS" ? "iOS" : "Android";
}

function operationConfirmation(policy: Pick<AppUpdatePolicy, "platform" | "latestBuild">) {
  return `${policy.platform} ${policy.latestBuild} 적용`;
}

function policySort(first: AppUpdatePolicy, second: AppUpdatePolicy) {
  return second.id - first.id;
}

function safeApiErrorText(error: unknown) {
  if (error instanceof ApiError && error.payload && typeof error.payload === "object") {
    const message = "message" in error.payload ? error.payload.message : null;
    if (
      typeof message === "string" &&
      message.trim().length > 0 &&
      message.trim().length <= 500 &&
      !/[<>\u0000-\u001f\u007f-\u009f]/.test(message)
    ) {
      return message.trim();
    }
  }
  return getErrorText(error);
}

async function loadPolicyDetail(policyId: number, signal?: AbortSignal) {
  const payload = await apiFetch<unknown>(`${APP_UPDATE_POLICIES_ENDPOINT}/${policyId}`, {
    method: "GET",
    cache: "no-store",
    signal,
  });
  return parseAppUpdatePolicy(payload);
}

function draftValidationMode(form: AppUpdatePolicyForm, activePolicy: AppUpdatePolicy | null) {
  if (!activePolicy?.forceUpdateEnabled || activePolicy.minimumSupportedBuild === null) return "STANDARD" as const;
  if (!form.forceUpdateEnabled) return "RELAX_DRAFT" as const;
  const minimumBuild = Number(form.minimumSupportedBuild.trim());
  return Number.isSafeInteger(minimumBuild) && minimumBuild < activePolicy.minimumSupportedBuild
    ? "RELAX_DRAFT" as const
    : "STANDARD" as const;
}

function fieldLabel(field: keyof AppUpdatePolicyForm) {
  const labels: Record<keyof AppUpdatePolicyForm, string> = {
    platform: "플랫폼",
    latestVersion: "최신 표시 버전",
    latestBuild: "최신 빌드",
    forceUpdateEnabled: "강제 업데이트",
    minimumSupportedBuild: "최소 지원 빌드",
    optionalUpdateEnabled: "선택 업데이트 안내",
    storeUrl: "스토어 URL",
    title: "안내 제목",
    message: "안내문",
    reason: "내부 변경 사유",
  };
  return labels[field];
}

function policyValue(policy: AppUpdatePolicy | null, field: keyof AppUpdatePolicyForm) {
  if (!policy) return "정책 없음";
  if (field === "latestVersion") return policy.latestVersion;
  if (field === "latestBuild") return `빌드 ${policy.latestBuild}`;
  if (field === "forceUpdateEnabled") return policy.forceUpdateEnabled ? "사용" : "미사용";
  if (field === "minimumSupportedBuild") {
    return policy.minimumSupportedBuild === null ? "설정 안 함" : `빌드 ${policy.minimumSupportedBuild}`;
  }
  if (field === "optionalUpdateEnabled") return policy.optionalUpdateEnabled ? "사용" : "미사용";
  if (field === "storeUrl") return policy.storeUrl;
  if (field === "title") return policy.title;
  if (field === "message") return policy.message;
  if (field === "platform") return platformLabel(policy.platform);
  return "-";
}

function changedFields(current: AppUpdatePolicy | null, next: AppUpdatePolicy) {
  const fields: Array<keyof AppUpdatePolicyForm> = [
    "latestVersion",
    "latestBuild",
    "forceUpdateEnabled",
    "minimumSupportedBuild",
    "optionalUpdateEnabled",
    "storeUrl",
    "title",
    "message",
  ];
  return fields.filter((field) => policyValue(current, field) !== policyValue(next, field));
}

function policySnapshot(snapshot: unknown | null) {
  if (snapshot === null) return "기록 없음";
  try {
    return JSON.stringify(snapshot, null, 2) ?? "기록 없음";
  } catch {
    return "기록을 표시할 수 없습니다.";
  }
}

function samePolicyValues(first: AppUpdatePolicy, second: AppUpdatePolicy) {
  return first.platform === second.platform &&
    first.latestVersion === second.latestVersion &&
    first.latestBuild === second.latestBuild &&
    first.forceUpdateEnabled === second.forceUpdateEnabled &&
    first.minimumSupportedBuild === second.minimumSupportedBuild &&
    first.optionalUpdateEnabled === second.optionalUpdateEnabled &&
    first.storeUrl === second.storeUrl &&
    first.title === second.title &&
    first.message === second.message;
}

function relaxConfirmation(policy: Pick<AppUpdatePolicy, "platform" | "latestBuild">) {
  return `${policy.platform} ${policy.latestBuild} 긴급 완화`;
}

function isAmbiguousMutationError(error: unknown) {
  return !(error instanceof ApiError) || error.status === 0 || error.status === 408 || error.status >= 500;
}

function policyUrl(
  platform: AppPlatform,
  status: AppUpdatePolicy["status"],
  page = 0,
  size = 100,
) {
  const query = new URLSearchParams({
    platform,
    status,
    page: String(page),
    size: String(size),
  });
  return `${APP_UPDATE_POLICIES_ENDPOINT}?${query.toString()}`;
}

function appStorePlaceholder(platform: AppPlatform) {
  return platform === "IOS"
    ? "https://apps.apple.com/kr/app/id6804946491"
    : "https://play.google.com/store/apps/details?id=com.hanseomate.app";
}

function dialogDescriptionId(titleId: string) {
  return `${titleId}-description`;
}

function DialogShell({
  titleId,
  title,
  description,
  busy,
  wide = false,
  onClose,
  children,
}: {
  titleId: string;
  title: string;
  description: string;
  busy?: boolean;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(Boolean(busy));

  useEffect(() => {
    onCloseRef.current = onClose;
    busyRef.current = Boolean(busy);
  }, [busy, onClose]);

  useEffect(() => {
    if (!busy) return;
    const frameId = window.requestAnimationFrame(() => dialogRef.current?.focus());
    return () => window.cancelAnimationFrame(frameId);
  }, [busy]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";
    const frameId = window.requestAnimationFrame(() => closeButtonRef.current?.focus());

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])',
      ) ?? []).filter((element) => (
        element.getClientRects().length > 0 &&
        window.getComputedStyle(element).visibility !== "hidden"
      ));
      if (elements.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frameId);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) {
        previousFocus.focus();
      } else {
        window.requestAnimationFrame(() => {
          const fallback = document.getElementById("app-update-feedback") ??
            document.getElementById("app-update-page-title");
          fallback?.focus();
        });
      }
    };
  }, []);

  return (
    <div
      className={styles.dialogBackdrop}
      role="presentation"
      onMouseDown={() => {
        if (!busy) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className={`${styles.dialog} ${wide ? styles.wideDialog : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={dialogDescriptionId(titleId)}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className={styles.dialogHeader}>
          <div>
            <h2 id={titleId}>{title}</h2>
            <p id={dialogDescriptionId(titleId)}>{description}</p>
          </div>
          <button
            ref={closeButtonRef}
            className={styles.dialogClose}
            type="button"
            aria-label="창 닫기"
            disabled={busy}
            onClick={onClose}
          >
            <X size={19} aria-hidden="true" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ToggleField({
  checked,
  label,
  description,
  disabled,
  onChange,
}: {
  checked: boolean;
  label: string;
  description: string;
  disabled?: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className={styles.toggleField}>
      <div>
        <strong>{label}</strong>
        <p>{description}</p>
      </div>
      <button
        className={styles.toggle}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        <span />
      </button>
    </div>
  );
}

function LoadingPanel({ label }: { label: string }) {
  return (
    <div className={styles.loadingPanel} role="status">
      <SpinnerGap className={styles.spinner} size={23} aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <p>서버에서 최신 운영 상태를 확인하고 있습니다.</p>
      </div>
    </div>
  );
}

function PolicyFacts({ policy }: { policy: AppUpdatePolicy }) {
  return (
    <dl className={styles.policyFacts}>
      <div>
        <dt>최신 버전</dt>
        <dd>{policy.latestVersion} · 빌드 {policy.latestBuild}</dd>
      </div>
      <div>
        <dt>강제 업데이트</dt>
        <dd>{policy.forceUpdateEnabled ? "사용" : "미사용"}</dd>
      </div>
      <div>
        <dt>최소 지원 빌드</dt>
        <dd>{policy.minimumSupportedBuild ?? "설정 안 함"}</dd>
      </div>
      <div>
        <dt>선택 안내</dt>
        <dd>{policy.optionalUpdateEnabled ? "사용" : "미사용"}</dd>
      </div>
      <div className={styles.fullFact}>
        <dt>적용 시각</dt>
        <dd>{formatTimestamp(policy.effectiveAt)}</dd>
      </div>
    </dl>
  );
}

export default function AppUpdatesPage() {
  const [selectedPlatform, setSelectedPlatform] = useState<AppPlatform>("IOS");
  const [platformPolicies, setPlatformPolicies] = useState<Record<AppPlatform, PlatformPolicyState>>({
    IOS: emptyPolicyState(),
    ANDROID: emptyPolicyState(),
  });
  const [recentAudits, setRecentAudits] = useState<Record<AppPlatform, RecentAuditState>>({
    IOS: emptyRecentAuditState(),
    ANDROID: emptyRecentAuditState(),
  });
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorClosePending, setEditorClosePending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<AppUpdatePolicyFieldErrors>({});
  const [savingDraft, setSavingDraft] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [publishDialog, setPublishDialog] = useState<PublishDialogState | null>(null);
  const [cancelDialog, setCancelDialog] = useState<CancelDialogState | null>(null);
  const [rollbackDialog, setRollbackDialog] = useState<RollbackDialogState | null>(null);
  const [relaxDialog, setRelaxDialog] = useState<RelaxDialogState | null>(null);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [busyOperation, setBusyOperation] = useState<"publish" | "cancel" | "rollback" | "relax" | "">("");
  const [historyVisibleCount, setHistoryVisibleCount] = useState(8);
  const [auditDialog, setAuditDialog] = useState<AuditDialogState>({
    open: false,
    status: "idle",
    filters: { platform: "IOS", eventType: "", actorId: "", from: "", to: "" },
    data: null,
    error: "",
  });

  const policyControllers = useRef<Partial<Record<AppPlatform, AbortController>>>({});
  const recentAuditControllers = useRef<Partial<Record<AppPlatform, AbortController>>>({});
  const previewController = useRef<AbortController | null>(null);
  const auditController = useRef<AbortController | null>(null);
  const mutationController = useRef<AbortController | null>(null);
  const mutationInProgress = useRef(false);

  const loadPolicies = useCallback(async (platform: AppPlatform) => {
    policyControllers.current[platform]?.abort();
    const controller = new AbortController();
    policyControllers.current[platform] = controller;
    setPlatformPolicies((current) => ({
      ...current,
      [platform]: { ...current[platform], status: "loading", error: "" },
    }));

    try {
      const statusItems = await Promise.all(APP_UPDATE_POLICY_STATUSES.map(async (status) => {
        const items: AppUpdatePolicy[] = [];
        const seenPolicyIds = new Set<number>();
        let expectedTotalElements: number | null = null;
        let requestedPage = 0;

        while (true) {
          const payload = await apiFetch<unknown>(policyUrl(platform, status, requestedPage), {
            method: "GET",
            cache: "no-store",
            signal: controller.signal,
          });
          const page = parseAppUpdatePolicyPage(payload);
          if (page.page !== requestedPage) {
            throw new Error("정책 목록의 페이지 순서를 확인할 수 없습니다. 다시 불러와 주세요.");
          }
          if (expectedTotalElements === null) expectedTotalElements = page.totalElements;
          if (page.totalElements !== expectedTotalElements) {
            throw new Error("정책 목록이 조회 중 변경되었습니다. 다시 불러와 주세요.");
          }

          const matchingItems = page.items.filter(
            (policy) => policy.platform === platform && policy.status === status,
          );
          if (matchingItems.length !== page.items.length) {
            throw new Error("플랫폼 또는 상태가 다른 정책이 함께 조회되었습니다. 다시 불러와 주세요.");
          }
          if (matchingItems.some((policy) => seenPolicyIds.has(policy.id))) {
            throw new Error("정책 목록에 중복 항목이 있습니다. 다시 불러와 주세요.");
          }
          matchingItems.forEach((policy) => seenPolicyIds.add(policy.id));
          items.push(...matchingItems);

          if (!page.hasNext) {
            if (page.totalPages > requestedPage + 1) {
              throw new Error("정책 목록의 다음 페이지를 확인할 수 없습니다. 다시 불러와 주세요.");
            }
            break;
          }
          if (page.totalPages <= requestedPage + 1) {
            throw new Error("정책 목록의 페이지 정보를 확인할 수 없습니다. 다시 불러와 주세요.");
          }
          requestedPage += 1;
        }

        if (expectedTotalElements !== items.length) {
          throw new Error("정책 목록 전체를 확인할 수 없습니다. 다시 불러와 주세요.");
        }

        return items;
      }));
      if (controller.signal.aborted) return null;
      const items = validateAppUpdatePolicySet(platform, statusItems.flat()).sort(policySort);
      setPermissionDenied(false);
      setPlatformPolicies((current) => ({
        ...current,
        [platform]: { status: "ready", items, error: "" },
      }));
      return items;
    } catch (error) {
      if (controller.signal.aborted) return null;
      if (error instanceof ApiError && error.status === 403) setPermissionDenied(true);
      setPlatformPolicies((current) => ({
        ...current,
        [platform]: {
          ...current[platform],
          status: "error",
          error: safeApiErrorText(error),
        },
      }));
      return null;
    } finally {
      if (policyControllers.current[platform] === controller) {
        delete policyControllers.current[platform];
      }
    }
  }, []);

  const loadRecentAudit = useCallback(async (platform: AppPlatform) => {
    recentAuditControllers.current[platform]?.abort();
    const controller = new AbortController();
    recentAuditControllers.current[platform] = controller;
    setRecentAudits((current) => ({
      ...current,
      [platform]: { ...current[platform], status: "loading", error: "" },
    }));
    const query = new URLSearchParams({ platform, page: "0", size: "1" });

    try {
      const payload = await apiFetch<unknown>(`${APP_UPDATE_AUDIT_LOGS_ENDPOINT}?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const page = parseAppUpdateAuditLogPage(payload);
      setRecentAudits((current) => ({
        ...current,
        [platform]: { status: "ready", item: page.items[0] ?? null, error: "" },
      }));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 403) setPermissionDenied(true);
      setRecentAudits((current) => ({
        ...current,
        [platform]: { status: "error", item: null, error: safeApiErrorText(error) },
      }));
    } finally {
      if (recentAuditControllers.current[platform] === controller) {
        delete recentAuditControllers.current[platform];
      }
    }
  }, []);

  const refreshPlatform = useCallback(async (platform: AppPlatform) => {
    const items = await loadPolicies(platform);
    await loadRecentAudit(platform);
    return items;
  }, [loadPolicies, loadRecentAudit]);

  useEffect(() => {
    const activePolicyControllers = policyControllers.current;
    const activeRecentAuditControllers = recentAuditControllers.current;
    const handleSessionChange = () => {
      if (!getAdminSession()) {
        for (const platform of APP_UPDATE_PLATFORMS) {
          activePolicyControllers[platform]?.abort();
          activeRecentAuditControllers[platform]?.abort();
        }
        setPlatformPolicies({ IOS: emptyPolicyState(), ANDROID: emptyPolicyState() });
        setRecentAudits({ IOS: emptyRecentAuditState(), ANDROID: emptyRecentAuditState() });
        setPermissionDenied(false);
        setEditor(null);
        setPreview(null);
        setPublishDialog(null);
        setCancelDialog(null);
        setRollbackDialog(null);
        setRelaxDialog(null);
        return;
      }
      setPermissionDenied(false);
      for (const platform of APP_UPDATE_PLATFORMS) {
        void loadPolicies(platform);
        void loadRecentAudit(platform);
      }
    };

    const timeoutId = window.setTimeout(handleSessionChange, 0);
    window.addEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
      for (const platform of APP_UPDATE_PLATFORMS) {
        activePolicyControllers[platform]?.abort();
        activeRecentAuditControllers[platform]?.abort();
      }
      previewController.current?.abort();
      auditController.current?.abort();
      mutationController.current?.abort();
    };
  }, [loadPolicies, loadRecentAudit]);

  const currentItems = platformPolicies[selectedPlatform].items;
  const activePolicy = useMemo(
    () => currentItems.find((policy) => policy.status === "ACTIVE") ?? null,
    [currentItems],
  );
  const scheduledPolicy = useMemo(
    () => currentItems.find((policy) => policy.status === "SCHEDULED") ?? null,
    [currentItems],
  );
  const draftPolicies = useMemo(
    () => currentItems.filter((policy) => policy.status === "DRAFT"),
    [currentItems],
  );
  const previousPolicies = useMemo(
    () => currentItems.filter((policy) => policy.status === "SUPERSEDED" || policy.status === "CANCELLED"),
    [currentItems],
  );
  const otherPlatform: AppPlatform = selectedPlatform === "IOS" ? "ANDROID" : "IOS";
  const otherActivePolicy = platformPolicies[otherPlatform].items.find((policy) => policy.status === "ACTIVE") ?? null;
  const editorDirty = editor !== null && appUpdatePolicyFormSignature(editor.form) !== editor.baseline;
  const editorIsRelaxation = editor !== null && draftValidationMode(editor.form, activePolicy) === "RELAX_DRAFT";

  function switchPlatform(platform: AppPlatform) {
    if (savingDraft) return false;
    if (platform === selectedPlatform) return true;
    if (editorDirty && !window.confirm("작성 중인 내용을 버리고 다른 플랫폼으로 이동할까요?")) return false;
    setEditor(null);
    setFieldErrors({});
    setSelectedPlatform(platform);
    setHistoryVisibleCount(8);
    setFeedback(null);
    return true;
  }

  function handlePlatformTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>) {
    const currentIndex = APP_UPDATE_PLATFORMS.indexOf(selectedPlatform);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight") nextIndex = (currentIndex + 1) % APP_UPDATE_PLATFORMS.length;
    if (event.key === "ArrowLeft") nextIndex = (currentIndex - 1 + APP_UPDATE_PLATFORMS.length) % APP_UPDATE_PLATFORMS.length;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = APP_UPDATE_PLATFORMS.length - 1;
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    const nextPlatform = APP_UPDATE_PLATFORMS[nextIndex];
    if (switchPlatform(nextPlatform)) {
      window.requestAnimationFrame(() => document.getElementById(`app-update-tab-${nextPlatform.toLowerCase()}`)?.focus());
    }
  }

  function startCreate(form = emptyAppUpdatePolicyForm(selectedPlatform)) {
    if (savingDraft) return;
    setEditor({
      mode: "create",
      policy: null,
      form,
      baseline: appUpdatePolicyFormSignature(form),
    });
    setFieldErrors({});
    setFeedback(null);
    window.requestAnimationFrame(() => document.getElementById("app-update-latestVersion")?.focus());
  }

  function startFromActive() {
    if (savingDraft || !activePolicy) return;
    const form = { ...appUpdatePolicyToForm(activePolicy), reason: "" };
    startCreate(form);
  }

  function startRelaxationDraft() {
    if (savingDraft || !activePolicy?.forceUpdateEnabled) return;
    const form: AppUpdatePolicyForm = {
      ...appUpdatePolicyToForm(activePolicy),
      forceUpdateEnabled: false,
      minimumSupportedBuild: "",
      optionalUpdateEnabled: false,
      reason: "",
    };
    startCreate(form);
  }

  function startFromOtherWording() {
    if (savingDraft || !otherActivePolicy) return;
    startCreate(copyAppUpdateWording(selectedPlatform, otherActivePolicy));
  }

  function startEdit(policy: AppUpdatePolicy) {
    if (savingDraft || policy.status !== "DRAFT") return;
    const form = appUpdatePolicyToForm(policy);
    setEditor({
      mode: "edit",
      policy,
      form,
      baseline: appUpdatePolicyFormSignature(form),
    });
    setFieldErrors({});
    setFeedback(null);
    window.requestAnimationFrame(() => document.getElementById("app-update-latestVersion")?.focus());
  }

  function updateEditor<K extends keyof AppUpdatePolicyForm>(field: K, value: AppUpdatePolicyForm[K]) {
    if (savingDraft) return;
    setEditor((current) => current ? {
      ...current,
      form: { ...current.form, [field]: value },
    } : null);
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function requestEditorClose() {
    if (savingDraft) return;
    if (editorDirty) {
      setEditorClosePending(true);
      return;
    }
    setEditor(null);
    setFieldErrors({});
  }

  async function saveDraft() {
    if (
      !editor ||
      savingDraft ||
      mutationInProgress.current ||
      platformPolicies[editor.form.platform].status !== "ready"
    ) return;
    const validationMode = draftValidationMode(editor.form, activePolicy);
    const validation = validateAppUpdatePolicyForm(editor.form, activePolicy, validationMode);
    if (!validation.ok) {
      setFieldErrors(validation.errors);
      const firstField = Object.keys(validation.errors)[0];
      if (firstField) document.getElementById(`app-update-${firstField}`)?.focus();
      return;
    }

    mutationInProgress.current = true;
    setSavingDraft(true);
    setFieldErrors({});
    setFeedback(null);
    const controller = new AbortController();
    mutationController.current = controller;

    try {
      let currentDraft = editor.policy;
      if (editor.mode === "edit") {
        currentDraft = await loadPolicyDetail(editor.policy!.id, controller.signal);
        if (
          currentDraft.platform !== editor.form.platform ||
          currentDraft.status !== "DRAFT" ||
          currentDraft.revision !== editor.policy!.revision
        ) {
          throw new ApiError(
            "초안이 변경되었습니다. 최신 초안을 다시 확인해 주세요.",
            409,
            { message: "초안이 변경되었습니다. 최신 초안을 다시 확인해 주세요." },
          );
        }
      }
      const path = editor.mode === "create"
        ? APP_UPDATE_POLICIES_ENDPOINT
        : `${APP_UPDATE_POLICIES_ENDPOINT}/${currentDraft!.id}`;
      const body = editor.mode === "create"
        ? createAppUpdatePolicyCreateRequest(editor.form, activePolicy, validationMode)
        : createAppUpdatePolicyUpdateRequest(editor.form, currentDraft!.revision, activePolicy, validationMode);
      const payload = await apiFetch<unknown>(path, {
        method: editor.mode === "create" ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const savedPolicy = parseAppUpdatePolicy(payload);
      if (savedPolicy.platform !== selectedPlatform || savedPolicy.status !== "DRAFT") {
        throw new Error("저장된 초안 상태를 확인할 수 없습니다.");
      }
      if (editor.mode === "create" && savedPolicy.revision !== 1) {
        throw new Error("새 초안의 revision을 확인할 수 없습니다.");
      }
      if (editor.mode === "edit" && currentDraft && savedPolicy.revision <= currentDraft.revision) {
        throw new Error("수정된 초안의 revision이 갱신되지 않았습니다.");
      }
      const savedForm = appUpdatePolicyToForm(savedPolicy);
      setEditor({
        mode: "edit",
        policy: savedPolicy,
        form: savedForm,
        baseline: appUpdatePolicyFormSignature(savedForm),
      });
      setFeedback({
        tone: "success",
        title: "정책 초안을 저장했습니다.",
        message: "게시 전 미리보기에서 앱 안내와 빌드별 서버 판정을 확인해 주세요.",
      });
      await refreshPlatform(selectedPlatform);
    } catch (error) {
      if (controller.signal.aborted) return;
      const serverErrors = error instanceof ApiError ? extractAppUpdateFieldErrors(error.payload) : {};
      if (Object.keys(serverErrors).length > 0) setFieldErrors(serverErrors);
      if (error instanceof ApiError && error.status === 404) {
        setEditor(null);
        await refreshPlatform(selectedPlatform);
        setFeedback({
          tone: "warning",
          title: "초안을 찾을 수 없습니다.",
          message: "정책 목록을 다시 불러왔습니다. 새 초안을 선택해 주세요.",
        });
      } else if (error instanceof ApiError && error.status === 409) {
        if (editor.policy) await loadPolicyDetail(editor.policy.id).catch(() => null);
        const refreshed = await refreshPlatform(selectedPlatform);
        setFeedback({
          tone: "warning",
          title: "다른 관리자가 먼저 정책을 변경했습니다.",
          message: refreshed
            ? "최신 목록을 다시 불러왔습니다. 초안을 다시 열어 변경 내용을 확인해 주세요."
            : "최신 목록도 확인하지 못했습니다. 추가 작업 전에 목록을 다시 확인해 주세요.",
        });
      } else if (error instanceof ApiError && error.status === 403) {
        setPermissionDenied(true);
        setEditor(null);
        setFeedback({
          tone: "error",
          title: "관리자 권한이 없습니다.",
          message: safeApiErrorText(error),
        });
      } else {
        setFeedback({
          tone: "error",
          title: "정책 초안을 저장하지 못했습니다.",
          message: safeApiErrorText(error),
        });
      }
    } finally {
      if (mutationController.current === controller) mutationController.current = null;
      mutationInProgress.current = false;
      setSavingDraft(false);
    }
  }

  async function openPreview(policy: AppUpdatePolicy) {
    if (savingDraft) return;
    previewController.current?.abort();
    const controller = new AbortController();
    previewController.current = controller;
    setPreview({ policy, status: "loading", data: null, selectedBuild: null, error: "" });
    try {
      const latestPolicy = await loadPolicyDetail(policy.id, controller.signal);
      if (
        latestPolicy.platform !== policy.platform ||
        latestPolicy.status !== policy.status ||
        latestPolicy.revision !== policy.revision
      ) {
        throw new ApiError(
          "정책이 변경되었습니다. 목록에서 최신 정책을 다시 열어 주세요.",
          409,
          { message: "정책이 변경되었습니다. 목록에서 최신 정책을 다시 열어 주세요." },
        );
      }

      const requestedBuilds = appUpdatePreviewBuilds(latestPolicy);
      const payload = await apiFetch<unknown>(`${APP_UPDATE_POLICIES_ENDPOINT}/${latestPolicy.id}/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          revision: latestPolicy.revision,
          builds: requestedBuilds,
        }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const parsed = parseAppUpdatePreview(payload, requestedBuilds);
      if (parsed.policyId !== latestPolicy.id || parsed.revision !== latestPolicy.revision) {
        throw new Error("미리보기 revision이 현재 초안과 일치하지 않습니다.");
      }
      setPreview({
        policy: latestPolicy,
        status: "ready",
        data: parsed,
        selectedBuild: parsed.results[0]?.build ?? null,
        error: "",
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 404) {
        setPreview(null);
        await refreshPlatform(policy.platform);
        setFeedback({ tone: "warning", title: "정책을 찾을 수 없습니다.", message: safeApiErrorText(error) });
        return;
      }
      if (error instanceof ApiError && error.status === 403) {
        setPermissionDenied(true);
        setPreview(null);
        setFeedback({ tone: "error", title: "관리자 권한이 없습니다.", message: safeApiErrorText(error) });
        return;
      }
      if (error instanceof ApiError && error.status === 409) {
        await refreshPlatform(policy.platform);
      }
      setPreview({
        policy,
        status: "error",
        data: null,
        selectedBuild: null,
        error: safeApiErrorText(error),
      });
    } finally {
      if (previewController.current === controller) previewController.current = null;
    }
  }

  function beginPublish(policy: AppUpdatePolicy) {
    if (policy.status !== "DRAFT" || isAppUpdateRelaxation(policy, activePolicy)) return;
    setPreview(null);
    setPublishDialog({
      policy,
      activePolicyIdAtStart: activePolicy?.id ?? null,
      mode: "IMMEDIATE",
      effectiveAt: "",
      storeAvailabilityConfirmed: false,
      reason: "",
      confirmation: "",
      idempotencyKey: createOperationIdempotencyKey(),
      retryReady: false,
      error: "",
    });
  }

  async function submitPublish() {
    const dialog = publishDialog;
    if (!dialog || mutationInProgress.current) return;
    const reasonError = validateAppUpdateReason(dialog.reason);
    if (reasonError) {
      setPublishDialog((current) => current ? { ...current, error: reasonError } : null);
      return;
    }
    if (!dialog.storeAvailabilityConfirmed) {
      setPublishDialog((current) => current ? {
        ...current,
        error: "대상 국가·트랙에서 실제 설치 가능한 상태인지 확인해 주세요.",
      } : null);
      return;
    }
    if (dialog.confirmation !== operationConfirmation(dialog.policy)) {
      setPublishDialog((current) => current ? { ...current, error: "확인 문구를 정확히 입력해 주세요." } : null);
      return;
    }

    let effectiveAt: string | null = null;
    if (dialog.mode === "SCHEDULED") {
      try {
        effectiveAt = kstDateTimeToUtcIso(dialog.effectiveAt);
      } catch (error) {
        setPublishDialog((current) => current ? { ...current, error: safeApiErrorText(error) } : null);
        return;
      }
      if (!dialog.retryReady && Date.parse(effectiveAt) <= Date.now()) {
        setPublishDialog((current) => current ? { ...current, error: "예약 시각은 현재보다 미래여야 합니다." } : null);
        return;
      }
    }

    mutationInProgress.current = true;
    setBusyOperation("publish");
    const controller = new AbortController();
    mutationController.current = controller;
    let mutationSent = false;
    try {
      const platform = dialog.policy.platform;
      if (!dialog.retryReady) {
        const latestItems = await loadPolicies(platform);
        if (controller.signal.aborted) return;
        if (!latestItems) {
          setPublishDialog((current) => current ? {
            ...current,
            error: "최신 정책 상태를 확인하지 못해 게시를 중단했습니다. 다시 확인해 주세요.",
          } : null);
          return;
        }
        const listedActive = latestItems.find((item) => item.status === "ACTIVE") ?? null;
        const latestActive = listedActive
          ? await loadPolicyDetail(listedActive.id, controller.signal)
          : null;
        const latestPolicy = await loadPolicyDetail(dialog.policy.id, controller.signal);
        if (
          latestPolicy.platform !== platform ||
          latestPolicy.status !== "DRAFT" ||
          latestPolicy.revision !== dialog.policy.revision
        ) {
          throw new ApiError("초안이 변경되었습니다.", 409, {
            message: "초안이 변경되었습니다. 최신 초안을 다시 확인해 주세요.",
          });
        }
        const publishSafetyError = appUpdatePublishSafetyError(latestPolicy, latestActive);
        if (publishSafetyError) {
          setPublishDialog((current) => current ? { ...current, error: publishSafetyError } : null);
          return;
        }
      }

      mutationSent = true;
      const payload = await apiFetch<unknown>(`${APP_UPDATE_POLICIES_ENDPOINT}/${dialog.policy.id}/publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": dialog.idempotencyKey,
        },
        body: JSON.stringify({
          revision: dialog.policy.revision,
          publishMode: dialog.mode,
          effectiveAt,
          storeAvailabilityConfirmed: true,
          reason: dialog.reason.trim(),
        }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const responsePolicy = parseAppUpdatePolicy(payload);
      const expectedStatus = dialog.mode === "IMMEDIATE" ? "ACTIVE" : "SCHEDULED";
      if (
        responsePolicy.id !== dialog.policy.id ||
        responsePolicy.platform !== dialog.policy.platform ||
        responsePolicy.status !== expectedStatus
      ) {
        throw new ApiError("게시 결과 상태를 확인할 수 없습니다.");
      }
      const detail = await loadPolicyDetail(responsePolicy.id, controller.signal);
      if (detail.status !== expectedStatus || detail.revision !== responsePolicy.revision) {
        throw new ApiError("게시 후 정책 상세 상태를 확인할 수 없습니다.");
      }
      const refreshed = await refreshPlatform(platform);
      const listed = refreshed?.find((item) => item.id === detail.id);
      const activeAfter = refreshed?.find((item) => item.status === "ACTIVE") ?? null;
      const scheduledAfter = refreshed?.find((item) => item.status === "SCHEDULED") ?? null;
      const semanticSuccess = dialog.mode === "IMMEDIATE"
        ? listed?.status === "ACTIVE" && activeAfter?.id === detail.id
        : listed?.status === "SCHEDULED" && scheduledAfter?.id === detail.id &&
          (activeAfter?.id ?? null) === dialog.activePolicyIdAtStart;
      if (!semanticSuccess) throw new ApiError("게시 후 전체 정책 상태를 확인할 수 없습니다.");
      setPublishDialog(null);
      setEditor(null);
      setFeedback({
        tone: "success",
        title: dialog.mode === "IMMEDIATE" ? "새 정책을 게시했습니다." : "새 정책을 예약했습니다.",
        message: dialog.mode === "IMMEDIATE"
          ? "활성 정책 상세와 전체 목록에서 적용 상태를 확인했습니다."
          : "예약 정책 상세와 현재 활성 정책 유지 상태를 확인했습니다.",
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const platform = dialog.policy.platform;
      if (mutationSent && isAmbiguousMutationError(error)) {
        const refreshed = await refreshPlatform(platform);
        const expectedStatus = dialog.mode === "IMMEDIATE" ? "ACTIVE" : "SCHEDULED";
        const item = refreshed?.find((policy) => policy.id === dialog.policy.id);
        if (item?.status === expectedStatus) {
          setPublishDialog(null);
          setEditor(null);
          setFeedback({
            tone: "success",
            title: dialog.mode === "IMMEDIATE" ? "게시 완료를 확인했습니다." : "예약 완료를 확인했습니다.",
            message: "응답은 불명확했지만 서버의 최신 정책 상태에서 작업 완료를 확인했습니다.",
          });
        } else {
          setPublishDialog((current) => current ? {
            ...current,
            retryReady: true,
            error: `${safeApiErrorText(error)} 최신 상태에서 완료를 확인하지 못했습니다. 같은 요청으로 다시 시도할 수 있습니다.`,
          } : null);
        }
      } else if (error instanceof ApiError && error.status === 409) {
        await loadPolicyDetail(dialog.policy.id).catch(() => null);
        const refreshed = await refreshPlatform(platform);
        setPublishDialog(null);
        setFeedback({
          tone: "warning",
          title: "정책 상태가 변경되어 게시하지 않았습니다.",
          message: refreshed
            ? safeApiErrorText(error)
            : "최신 정책 상태도 확인하지 못했습니다. 추가 작업 전에 목록을 다시 확인해 주세요.",
        });
      } else if (error instanceof ApiError && error.status === 404) {
        setPublishDialog(null);
        setEditor(null);
        await refreshPlatform(platform);
        setFeedback({ tone: "warning", title: "게시할 초안을 찾을 수 없습니다.", message: safeApiErrorText(error) });
      } else if (error instanceof ApiError && error.status === 403) {
        setPermissionDenied(true);
        setPublishDialog(null);
        setFeedback({ tone: "error", title: "관리자 권한이 없습니다.", message: safeApiErrorText(error) });
      } else {
        setPublishDialog((current) => current ? {
          ...current,
          idempotencyKey: mutationSent ? createOperationIdempotencyKey() : current.idempotencyKey,
          error: safeApiErrorText(error),
        } : null);
      }
    } finally {
      if (mutationController.current === controller) mutationController.current = null;
      mutationInProgress.current = false;
      setBusyOperation("");
    }
  }

  function beginCancel(policy: AppUpdatePolicy) {
    setCancelDialog({
      policy,
      activePolicyIdAtStart: activePolicy?.id ?? null,
      reason: "",
      idempotencyKey: createOperationIdempotencyKey(),
      retryReady: false,
      error: "",
    });
  }

  async function submitCancel() {
    const dialog = cancelDialog;
    if (!dialog || mutationInProgress.current) return;
    const reasonError = validateAppUpdateReason(dialog.reason);
    if (reasonError) {
      setCancelDialog((current) => current ? { ...current, error: reasonError } : null);
      return;
    }
    mutationInProgress.current = true;
    setBusyOperation("cancel");
    const controller = new AbortController();
    mutationController.current = controller;
    let mutationSent = false;
    try {
      if (!dialog.retryReady) {
        const latest = await loadPolicyDetail(dialog.policy.id, controller.signal);
        if (latest.status !== "SCHEDULED" || latest.revision !== dialog.policy.revision) {
          throw new ApiError("예약 정책이 변경되었습니다.", 409, {
            message: "예약 정책이 변경되었습니다. 최신 상태를 다시 확인해 주세요.",
          });
        }
      }
      mutationSent = true;
      const payload = await apiFetch<unknown>(`${APP_UPDATE_POLICIES_ENDPOINT}/${dialog.policy.id}/cancel`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": dialog.idempotencyKey,
        },
        body: JSON.stringify({
          revision: dialog.policy.revision,
          reason: dialog.reason.trim(),
        }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const responsePolicy = parseAppUpdatePolicy(payload);
      if (
        responsePolicy.id !== dialog.policy.id ||
        responsePolicy.platform !== dialog.policy.platform ||
        responsePolicy.status !== "CANCELLED"
      ) {
        throw new ApiError("예약 취소 결과 상태를 확인할 수 없습니다.");
      }
      const detail = await loadPolicyDetail(responsePolicy.id, controller.signal);
      const platform = dialog.policy.platform;
      const refreshed = await refreshPlatform(platform);
      const activeAfter = refreshed?.find((policy) => policy.status === "ACTIVE") ?? null;
      if (
        !refreshed ||
        detail.status !== "CANCELLED" ||
        detail.revision !== responsePolicy.revision ||
        refreshed?.some((policy) => policy.status === "SCHEDULED") ||
        (activeAfter?.id ?? null) !== dialog.activePolicyIdAtStart
      ) {
        throw new ApiError("예약 취소 후 전체 정책 상태를 확인할 수 없습니다.");
      }
      setCancelDialog(null);
      setFeedback({
        tone: "success",
        title: "예약 정책을 취소했습니다.",
        message: "상세 상태가 CANCELLED로 바뀌고 현재 활성 정책이 유지된 것을 확인했습니다.",
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const platform = dialog.policy.platform;
      if (mutationSent && isAmbiguousMutationError(error)) {
        const refreshed = await refreshPlatform(platform);
        const item = refreshed?.find((policy) => policy.id === dialog.policy.id);
        if (item?.status === "CANCELLED") {
          setCancelDialog(null);
          setFeedback({ tone: "success", title: "예약 취소 완료를 확인했습니다.", message: "최신 서버 상태에서 CANCELLED 전환을 확인했습니다." });
        } else {
          setCancelDialog((current) => current ? {
            ...current,
            retryReady: true,
            error: `${safeApiErrorText(error)} 완료 여부를 확인하지 못해 같은 요청으로 다시 시도할 수 있습니다.`,
          } : null);
        }
      } else if (error instanceof ApiError && error.status === 409) {
        await loadPolicyDetail(dialog.policy.id).catch(() => null);
        await refreshPlatform(platform);
        setCancelDialog(null);
        setFeedback({ tone: "warning", title: "예약 상태가 변경되어 취소하지 않았습니다.", message: safeApiErrorText(error) });
      } else if (error instanceof ApiError && error.status === 404) {
        setCancelDialog(null);
        await refreshPlatform(platform);
        setFeedback({ tone: "warning", title: "예약 정책을 찾을 수 없습니다.", message: safeApiErrorText(error) });
      } else if (error instanceof ApiError && error.status === 403) {
        setPermissionDenied(true);
        setCancelDialog(null);
        setFeedback({ tone: "error", title: "관리자 권한이 없습니다.", message: safeApiErrorText(error) });
      } else {
        setCancelDialog((current) => current ? {
          ...current,
          idempotencyKey: mutationSent ? createOperationIdempotencyKey() : current.idempotencyKey,
          error: safeApiErrorText(error),
        } : null);
      }
    } finally {
      if (mutationController.current === controller) mutationController.current = null;
      mutationInProgress.current = false;
      setBusyOperation("");
    }
  }

  function beginRollback(target: AppUpdatePolicy) {
    if (!activePolicy || target.status !== "SUPERSEDED") return;
    setRollbackDialog({
      target,
      active: activePolicy,
      scheduledPolicyIdAtStart: scheduledPolicy?.id ?? null,
      reason: "",
      confirmation: "",
      idempotencyKey: createOperationIdempotencyKey(),
      retryReady: false,
      error: "",
    });
  }

  async function submitRollback() {
    const dialog = rollbackDialog;
    if (!dialog || mutationInProgress.current) return;
    const reasonError = validateAppUpdateReason(dialog.reason);
    if (reasonError) {
      setRollbackDialog((current) => current ? { ...current, error: reasonError } : null);
      return;
    }
    if (dialog.confirmation !== operationConfirmation(dialog.target)) {
      setRollbackDialog((current) => current ? { ...current, error: "확인 문구를 정확히 입력해 주세요." } : null);
      return;
    }

    mutationInProgress.current = true;
    setBusyOperation("rollback");
    const controller = new AbortController();
    mutationController.current = controller;
    let mutationSent = false;
    try {
      if (!dialog.retryReady) {
        const latestActive = await loadPolicyDetail(dialog.active.id, controller.signal);
        const latestTarget = await loadPolicyDetail(dialog.target.id, controller.signal);
        if (
          latestActive.status !== "ACTIVE" ||
          latestActive.revision !== dialog.active.revision ||
          latestTarget.status !== "SUPERSEDED" ||
          latestTarget.revision !== dialog.target.revision
        ) {
          throw new ApiError("롤백 대상이 변경되었습니다.", 409, {
            message: "현재 정책 또는 롤백 대상이 변경되었습니다. 최신 상태를 확인해 주세요.",
          });
        }
      }
      mutationSent = true;
      const payload = await apiFetch<unknown>(`${APP_UPDATE_POLICIES_ENDPOINT}/${dialog.target.id}/rollback`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": dialog.idempotencyKey,
        },
        body: JSON.stringify({
          expectedActivePolicyId: dialog.active.id,
          expectedActiveRevision: dialog.active.revision,
          reason: dialog.reason.trim(),
        }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const responsePolicy = parseAppUpdatePolicy(payload);
      if (
        responsePolicy.status !== "ACTIVE" ||
        responsePolicy.id === dialog.target.id ||
        responsePolicy.id === dialog.active.id ||
        responsePolicy.revision !== 1 ||
        !samePolicyValues(responsePolicy, dialog.target)
      ) {
        throw new ApiError("롤백 결과로 생성된 새 정책을 확인할 수 없습니다.");
      }
      const detail = await loadPolicyDetail(responsePolicy.id, controller.signal);
      const platform = dialog.target.platform;
      const refreshed = await refreshPlatform(platform);
      const activeAfter = refreshed?.find((policy) => policy.status === "ACTIVE") ?? null;
      if (
        detail.status !== "ACTIVE" || detail.id !== responsePolicy.id || detail.revision !== 1 ||
        activeAfter?.id !== responsePolicy.id ||
        refreshed?.some((policy) => policy.status === "SCHEDULED")
      ) {
        throw new ApiError("롤백 후 활성 정책 또는 예약 취소 상태를 확인할 수 없습니다.");
      }
      setRollbackDialog(null);
      setFeedback({
        tone: "success",
        title: "과거 정책으로 롤백했습니다.",
        message: `새 정책 #${responsePolicy.id} · rev 1 활성화와 남은 예약 취소를 확인했습니다.`,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const platform = dialog.target.platform;
      if (mutationSent && isAmbiguousMutationError(error)) {
        const refreshed = await refreshPlatform(platform);
        const activeAfter = refreshed?.find((policy) => policy.status === "ACTIVE") ?? null;
        if (
          activeAfter && activeAfter.id !== dialog.active.id && activeAfter.id !== dialog.target.id &&
          activeAfter.revision === 1 && samePolicyValues(activeAfter, dialog.target) &&
          !refreshed?.some((policy) => policy.status === "SCHEDULED")
        ) {
          setRollbackDialog(null);
          setFeedback({ tone: "success", title: "롤백 완료를 확인했습니다.", message: `새 정책 #${activeAfter.id} 활성화와 예약 취소를 확인했습니다.` });
        } else {
          setRollbackDialog((current) => current ? {
            ...current,
            retryReady: true,
            error: `${safeApiErrorText(error)} 완료 여부를 확인하지 못해 같은 요청으로 다시 시도할 수 있습니다.`,
          } : null);
        }
      } else if (error instanceof ApiError && error.status === 409) {
        await Promise.all([
          loadPolicyDetail(dialog.target.id).catch(() => null),
          loadPolicyDetail(dialog.active.id).catch(() => null),
        ]);
        await refreshPlatform(platform);
        setRollbackDialog(null);
        setFeedback({ tone: "warning", title: "정책 상태가 변경되어 롤백하지 않았습니다.", message: safeApiErrorText(error) });
      } else if (error instanceof ApiError && error.status === 404) {
        setRollbackDialog(null);
        await refreshPlatform(platform);
        setFeedback({ tone: "warning", title: "롤백 대상을 찾을 수 없습니다.", message: safeApiErrorText(error) });
      } else if (error instanceof ApiError && error.status === 403) {
        setPermissionDenied(true);
        setRollbackDialog(null);
        setFeedback({ tone: "error", title: "관리자 권한이 없습니다.", message: safeApiErrorText(error) });
      } else {
        setRollbackDialog((current) => current ? {
          ...current,
          idempotencyKey: mutationSent ? createOperationIdempotencyKey() : current.idempotencyKey,
          error: safeApiErrorText(error),
        } : null);
      }
    } finally {
      if (mutationController.current === controller) mutationController.current = null;
      mutationInProgress.current = false;
      setBusyOperation("");
    }
  }

  function beginRelax(policy: AppUpdatePolicy) {
    if (!activePolicy || policy.status !== "DRAFT" || !isAppUpdateRelaxation(policy, activePolicy)) return;
    setPreview(null);
    setRelaxDialog({
      policy,
      active: activePolicy,
      scheduledPolicyIdAtStart: scheduledPolicy?.id ?? null,
      storeAvailabilityConfirmed: false,
      reason: "",
      confirmation: "",
      idempotencyKey: createOperationIdempotencyKey(),
      retryReady: false,
      error: "",
    });
  }

  async function submitRelax() {
    const dialog = relaxDialog;
    if (!dialog || mutationInProgress.current) return;
    const requestError = validateAppUpdatePolicyRelaxRequest(
      dialog.policy,
      dialog.active,
      dialog.storeAvailabilityConfirmed,
      dialog.reason,
    );
    if (requestError) {
      setRelaxDialog((current) => current ? { ...current, error: requestError } : null);
      return;
    }
    if (dialog.confirmation !== relaxConfirmation(dialog.policy)) {
      setRelaxDialog((current) => current ? { ...current, error: "확인 문구를 정확히 입력해 주세요." } : null);
      return;
    }

    mutationInProgress.current = true;
    setBusyOperation("relax");
    const controller = new AbortController();
    mutationController.current = controller;
    let mutationSent = false;
    try {
      if (!dialog.retryReady) {
        const latestActive = await loadPolicyDetail(dialog.active.id, controller.signal);
        const latestDraft = await loadPolicyDetail(dialog.policy.id, controller.signal);
        if (
          latestActive.status !== "ACTIVE" || latestActive.revision !== dialog.active.revision ||
          latestDraft.status !== "DRAFT" || latestDraft.revision !== dialog.policy.revision ||
          !isAppUpdateRelaxation(latestDraft, latestActive)
        ) {
          throw new ApiError("긴급 완화 대상이 변경되었습니다.", 409, {
            message: "활성 정책 또는 완화 초안이 변경되었습니다. 최신 상태를 확인해 주세요.",
          });
        }
      }
      const body = createAppUpdatePolicyRelaxRequest(
        dialog.policy,
        dialog.active,
        true,
        dialog.reason,
      );
      mutationSent = true;
      const payload = await apiFetch<unknown>(`${APP_UPDATE_POLICIES_ENDPOINT}/${dialog.policy.id}/relax`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": dialog.idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const responsePolicy = parseAppUpdatePolicy(payload);
      if (
        responsePolicy.id !== dialog.policy.id ||
        responsePolicy.platform !== dialog.policy.platform ||
        responsePolicy.status !== "ACTIVE"
      ) {
        throw new ApiError("긴급 완화 결과 상태를 확인할 수 없습니다.");
      }
      const detail = await loadPolicyDetail(responsePolicy.id, controller.signal);
      const refreshed = await refreshPlatform(dialog.policy.platform);
      const activeAfter = refreshed?.find((policy) => policy.status === "ACTIVE") ?? null;
      if (
        detail.status !== "ACTIVE" || detail.revision !== responsePolicy.revision ||
        activeAfter?.id !== dialog.policy.id ||
        refreshed?.some((policy) => policy.status === "SCHEDULED")
      ) {
        throw new ApiError("긴급 완화 후 활성 정책 또는 예약 취소 상태를 확인할 수 없습니다.");
      }
      setRelaxDialog(null);
      setEditor(null);
      setFeedback({
        tone: "success",
        title: "강제 조건을 긴급 완화했습니다.",
        message: `정책 #${detail.id} 활성화와 같은 플랫폼의 남은 예약 취소를 확인했습니다.`,
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      const platform = dialog.policy.platform;
      if (mutationSent && isAmbiguousMutationError(error)) {
        const refreshed = await refreshPlatform(platform);
        const activeAfter = refreshed?.find((policy) => policy.status === "ACTIVE") ?? null;
        if (activeAfter?.id === dialog.policy.id && !refreshed?.some((policy) => policy.status === "SCHEDULED")) {
          setRelaxDialog(null);
          setEditor(null);
          setFeedback({ tone: "success", title: "긴급 완화 완료를 확인했습니다.", message: "활성 정책 전환과 예약 취소를 최신 서버 상태에서 확인했습니다." });
        } else {
          setRelaxDialog((current) => current ? {
            ...current,
            retryReady: true,
            error: `${safeApiErrorText(error)} 완료 여부를 확인하지 못해 같은 요청으로 다시 시도할 수 있습니다.`,
          } : null);
        }
      } else if (error instanceof ApiError && error.status === 409) {
        await Promise.all([
          loadPolicyDetail(dialog.policy.id).catch(() => null),
          loadPolicyDetail(dialog.active.id).catch(() => null),
        ]);
        await refreshPlatform(platform);
        setRelaxDialog(null);
        setFeedback({ tone: "warning", title: "정책 상태가 변경되어 완화하지 않았습니다.", message: safeApiErrorText(error) });
      } else if (error instanceof ApiError && error.status === 404) {
        setRelaxDialog(null);
        setEditor(null);
        await refreshPlatform(platform);
        setFeedback({ tone: "warning", title: "긴급 완화 대상을 찾을 수 없습니다.", message: safeApiErrorText(error) });
      } else if (error instanceof ApiError && error.status === 403) {
        setPermissionDenied(true);
        setRelaxDialog(null);
        setFeedback({ tone: "error", title: "관리자 권한이 없습니다.", message: safeApiErrorText(error) });
      } else {
        setRelaxDialog((current) => current ? {
          ...current,
          idempotencyKey: mutationSent ? createOperationIdempotencyKey() : current.idempotencyKey,
          error: safeApiErrorText(error),
        } : null);
      }
    } finally {
      if (mutationController.current === controller) mutationController.current = null;
      mutationInProgress.current = false;
      setBusyOperation("");
    }
  }

  const loadAuditPage = useCallback(async (filters: AuditFilters, page: number) => {
    auditController.current?.abort();
    const actorId = filters.actorId.trim();
    if (actorId && (!/^\d+$/.test(actorId) || Number(actorId) < 1)) {
      setAuditDialog((current) => ({ ...current, status: "error", error: "작업자 ID는 1 이상의 정수로 입력해 주세요." }));
      return;
    }

    const query = new URLSearchParams({
      platform: filters.platform,
      page: String(page),
      size: "20",
    });
    if (filters.eventType) query.set("eventType", filters.eventType);
    if (actorId) query.set("actorId", actorId);
    try {
      const fromUtc = filters.from ? kstDateTimeToUtcIso(filters.from) : "";
      const toUtc = filters.to ? kstDateTimeToUtcIso(filters.to) : "";
      if (fromUtc && toUtc && Date.parse(fromUtc) >= Date.parse(toUtc)) {
        setAuditDialog((current) => ({
          ...current,
          status: "error",
          error: "시작 시각은 종료 시각보다 빨라야 합니다.",
        }));
        return;
      }
      if (fromUtc) query.set("from", fromUtc);
      if (toUtc) query.set("to", toUtc);
    } catch (error) {
      setAuditDialog((current) => ({ ...current, status: "error", error: safeApiErrorText(error) }));
      return;
    }

    const controller = new AbortController();
    auditController.current = controller;
    setAuditDialog((current) => ({ ...current, status: "loading", error: "" }));
    try {
      const payload = await apiFetch<unknown>(`${APP_UPDATE_AUDIT_LOGS_ENDPOINT}?${query.toString()}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const data = parseAppUpdateAuditLogPage(payload);
      setAuditDialog((current) => ({ ...current, status: "ready", data, error: "" }));
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 403) setPermissionDenied(true);
      setAuditDialog((current) => ({ ...current, status: "error", error: safeApiErrorText(error) }));
    } finally {
      if (auditController.current === controller) auditController.current = null;
    }
  }, []);

  function openAuditHistory() {
    const filters: AuditFilters = {
      platform: selectedPlatform,
      eventType: "",
      actorId: "",
      from: "",
      to: "",
    };
    setAuditDialog({ open: true, status: "loading", filters, data: null, error: "" });
    void loadAuditPage(filters, 0);
  }

  const currentState = platformPolicies[selectedPlatform];
  const recentAudit = recentAudits[selectedPlatform];
  const selectedPreviewResult = preview?.data?.results.find(
    (result) => result.build === preview.selectedBuild,
  ) ?? null;

  return (
    <AdminLoginNotice returnTo="/settings/app-updates">
      <div className={styles.page}>
        {feedback && (
          <section
            id="app-update-feedback"
            className={`${styles.feedback} ${styles[`${feedback.tone}Feedback`]}`}
            role={feedback.tone === "error" ? "alert" : "status"}
            tabIndex={-1}
          >
            {feedback.tone === "success" ? (
              <CheckCircle size={22} weight="fill" aria-hidden="true" />
            ) : feedback.tone === "warning" ? (
              <WarningCircle size={22} weight="fill" aria-hidden="true" />
            ) : (
              <ShieldWarning size={22} weight="fill" aria-hidden="true" />
            )}
            <div>
              <strong>{feedback.title}</strong>
              <p>{feedback.message}</p>
            </div>
            <button type="button" aria-label="알림 닫기" onClick={() => setFeedback(null)}>
              <X size={17} aria-hidden="true" />
            </button>
          </section>
        )}

        <section className={styles.intro} aria-labelledby="app-update-page-title">
          <div className={styles.introIcon} aria-hidden="true"><DeviceMobile size={30} weight="duotone" /></div>
          <div>
            <span className={styles.eyebrow}>스토어 앱 버전 게이트</span>
            <h2 id="app-update-page-title" tabIndex={-1}>앱 업데이트 정책</h2>
            <p>설치된 네이티브 빌드를 기준으로 선택 또는 강제 업데이트를 제어합니다.</p>
          </div>
          <div className={styles.safetyBadge}>
            <ShieldWarning size={16} aria-hidden="true" />
            플랫폼별 독립 적용
          </div>
        </section>

        <section className={styles.scopeNotice} aria-label="운영 주의사항">
          <Info size={20} weight="fill" aria-hidden="true" />
          <div>
            <strong>EAS Update가 아닌 App Store·Google Play 설치 안내입니다.</strong>
            <p>스토어에서 대상 빌드를 실제로 설치할 수 있는지 확인한 뒤 게시하세요. iOS와 Android는 서로 영향을 주지 않습니다.</p>
          </div>
        </section>

        <details className={styles.quickGuide} open>
          <summary><Info size={18} weight="fill" aria-hidden="true" /> 처음 사용하는 분을 위한 3단계 가이드</summary>
          <ol className={styles.guideSteps}>
            <li><strong>초안 작성</strong><span>플랫폼을 고르고 버전·빌드·안내 문구를 저장합니다.</span></li>
            <li><strong>미리보기 확인</strong><span>빌드별로 진입 허용·선택·강제 판정이 맞는지 봅니다.</span></li>
            <li><strong>적용 방식 선택</strong><span>일반 변경은 게시, 과거 값 복원은 롤백, 강제 기준을 낮추면 긴급 완화를 사용합니다.</span></li>
          </ol>
          <p className={styles.guideNote}>초안 저장만으로는 사용자 앱에 반영되지 않습니다. 미리보기 뒤 게시·롤백·긴급 완화 중 맞는 작업을 완료해야 적용됩니다.</p>
        </details>

        {permissionDenied && (
          <section className={styles.loadError} role="alert">
            <ShieldWarning size={24} weight="fill" aria-hidden="true" />
            <div>
              <strong>이 계정에는 앱 업데이트 정책 관리 권한이 없습니다.</strong>
              <p>앱 업데이트 관리 권한이 있는 계정으로 다시 로그인하거나 시스템 관리자에게 권한을 요청해 주세요.</p>
            </div>
          </section>
        )}

        <div className={styles.platformTabs} role="tablist" aria-label="앱 플랫폼">
          {APP_UPDATE_PLATFORMS.map((platform) => {
            const policy = platformPolicies[platform].items.find((item) => item.status === "ACTIVE") ?? null;
            const selected = selectedPlatform === platform;
            return (
              <button
                key={platform}
                id={`app-update-tab-${platform.toLowerCase()}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls="app-update-platform-panel"
                tabIndex={selected ? 0 : -1}
                disabled={savingDraft}
                className={selected ? styles.activeTab : ""}
                onClick={() => switchPlatform(platform)}
                onKeyDown={handlePlatformTabKeyDown}
              >
                <span className={styles.platformIcon} aria-hidden="true">
                  {platform === "IOS" ? <AppleLogo size={20} weight="fill" /> : <AndroidLogo size={20} weight="fill" />}
                </span>
                <span>
                  <strong>{platformLabel(platform)}</strong>
                  <small>{policy ? `${policy.latestVersion} · 빌드 ${policy.latestBuild}` : "활성 정책 없음"}</small>
                </span>
                <span className={`${styles.tabStatus} ${policy ? styles.onlineStatus : ""}`}>
                  {platformPolicies[platform].status === "loading" ? "확인 중" : policy ? "적용 중" : "미설정"}
                </span>
              </button>
            );
          })}
        </div>

        <div
          className={styles.platformPanel}
          id="app-update-platform-panel"
          role="tabpanel"
          aria-labelledby={`app-update-tab-${selectedPlatform.toLowerCase()}`}
          tabIndex={0}
        >
        <div className={styles.toolbar}>
          <div>
            <span>{platformLabel(selectedPlatform)} 정책</span>
            <strong>다른 플랫폼에는 자동으로 적용되지 않습니다.</strong>
          </div>
          <div className={styles.toolbarActions}>
            <button className="button button-secondary" type="button" onClick={openAuditHistory}>
              <ListBullets size={17} aria-hidden="true" />
              변경 이력
            </button>
            <button className="button button-primary" type="button" disabled={savingDraft || currentState.status !== "ready"} onClick={() => startCreate()}>
              <Plus size={17} weight="bold" aria-hidden="true" />
              새 정책 작성
            </button>
          </div>
        </div>

        {currentState.status === "loading" && currentState.items.length === 0 ? (
          <LoadingPanel label={`${platformLabel(selectedPlatform)} 정책을 불러오는 중입니다.`} />
        ) : currentState.status === "error" && currentState.items.length === 0 ? (
          <section className={styles.loadError} role="alert">
            <WarningCircle size={27} weight="fill" aria-hidden="true" />
            <div>
              <strong>정책 현황을 불러오지 못했습니다.</strong>
              <p>{currentState.error}</p>
            </div>
            <button className="button button-secondary" type="button" onClick={() => void loadPolicies(selectedPlatform)}>
              <ArrowClockwise size={16} aria-hidden="true" />
              다시 시도
            </button>
          </section>
        ) : (
          <>
            {currentState.status === "error" && (
              <section className={styles.staleNotice} role="alert">
                <WarningCircle size={19} weight="fill" aria-hidden="true" />
                <span>최신 정책 상태를 확인하지 못해 변경 작업을 잠시 막았습니다. {currentState.error}</span>
                <button type="button" onClick={() => void loadPolicies(selectedPlatform)}>다시 확인</button>
              </section>
            )}
            <div className={styles.overviewGrid}>
              <section className={`${styles.policyCard} ${styles.activePolicyCard}`} aria-labelledby="active-policy-title">
                <div className={styles.cardHeader}>
                  <div>
                    <span className={`${styles.statusBadge} ${styles.activeStatus}`}>적용 중</span>
                    <h3 id="active-policy-title">현재 활성 정책</h3>
                  </div>
                  {currentState.status === "loading" && <SpinnerGap className={styles.spinner} size={18} aria-label="새로고침 중" />}
                </div>
                {activePolicy ? (
                  <>
                    <PolicyFacts policy={activePolicy} />
                    <div className={styles.storeLinkRow}>
                      <span>스토어 링크</span>
                      <a href={activePolicy.storeUrl} target="_blank" rel="noreferrer">
                        새 탭에서 테스트 <ArrowSquareOut size={15} aria-hidden="true" />
                      </a>
                    </div>
                    <div className={styles.cardActions}>
                      <button className="button button-secondary" type="button" disabled={savingDraft || currentState.status !== "ready"} onClick={() => void openPreview(activePolicy)}>
                        <Eye size={16} aria-hidden="true" /> 판정 미리보기
                      </button>
                      <button className="button button-secondary" type="button" disabled={savingDraft || currentState.status !== "ready"} onClick={startFromActive}>
                        <Copy size={16} aria-hidden="true" />
                        현재 값으로 초안 시작
                      </button>
                    </div>
                  </>
                ) : (
                  <div className={styles.emptyCard}>
                    <DeviceMobile size={28} aria-hidden="true" />
                    <strong>활성 정책이 없습니다.</strong>
                    <p>앱은 업데이트 안내 없이 정상 진입합니다.</p>
                  </div>
                )}
              </section>

              <section className={`${styles.policyCard} ${styles.scheduledPolicyCard}`} aria-labelledby="scheduled-policy-title">
                <div className={styles.cardHeader}>
                  <div>
                    <span className={`${styles.statusBadge} ${scheduledPolicy ? styles.scheduledStatus : styles.neutralStatus}`}>
                      {scheduledPolicy ? "예약됨" : "예약 없음"}
                    </span>
                    <h3 id="scheduled-policy-title">다음 예약 정책</h3>
                  </div>
                </div>
                {scheduledPolicy ? (
                  <>
                    <PolicyFacts policy={scheduledPolicy} />
                    <div className={styles.storeLinkRow}>
                      <span>스토어 링크</span>
                      <a href={scheduledPolicy.storeUrl} target="_blank" rel="noreferrer">
                        새 탭에서 테스트 <ArrowSquareOut size={15} aria-hidden="true" />
                      </a>
                    </div>
                    <div className={styles.cardActions}>
                      <button className="button button-secondary" type="button" disabled={savingDraft || currentState.status !== "ready"} onClick={() => void openPreview(scheduledPolicy)}>
                        <Eye size={16} aria-hidden="true" /> 판정 미리보기
                      </button>
                      <button className="button button-danger-subtle" type="button" disabled={savingDraft || currentState.status !== "ready"} onClick={() => beginCancel(scheduledPolicy)}>
                        <Prohibit size={16} aria-hidden="true" />
                        예약 취소
                      </button>
                    </div>
                  </>
                ) : (
                  <div className={styles.emptyCard}>
                    <CalendarCheck size={28} aria-hidden="true" />
                    <strong>예약된 정책이 없습니다.</strong>
                    <p>초안을 검토한 뒤 즉시 게시하거나 KST 시각으로 예약할 수 있습니다.</p>
                  </div>
                )}
              </section>
            </div>

            <section className={styles.changeSummary} aria-labelledby="latest-change-title">
              <div className={styles.sectionHeading}>
                <div className={styles.sectionIcon} aria-hidden="true"><ClockCounterClockwise size={20} /></div>
                <div>
                  <h3 id="latest-change-title">최근 변경</h3>
                  <p>서버 감사 로그에서 확인한 최근 작업자와 내부 사유입니다.</p>
                </div>
              </div>
              {recentAudit.status === "loading" ? (
                <span className={styles.mutedInline}><SpinnerGap className={styles.spinner} size={15} /> 확인 중</span>
              ) : recentAudit.status === "error" ? (
                <div className={styles.inlineError}>
                  <span>{recentAudit.error}</span>
                  <button type="button" onClick={() => void loadRecentAudit(selectedPlatform)}>다시 시도</button>
                </div>
              ) : recentAudit.item ? (
                <div className={styles.recentChangeGrid}>
                  <div><span>작업</span><strong>{auditEventLabels[recentAudit.item.eventType] ?? recentAudit.item.eventType}</strong></div>
                  <div><span>작업자</span><strong>{recentAudit.item.actorId === null ? "서버 자동 작업" : `관리자 #${recentAudit.item.actorId}`}</strong></div>
                  <div><span>시각</span><strong>{formatTimestamp(recentAudit.item.createdAt)}</strong></div>
                  <div className={styles.reasonCell}><span>내부 변경 사유</span><strong>{recentAudit.item.reason}</strong></div>
                  {recentAudit.item.failureMessage && <div className={styles.reasonCell}><span>실패 메시지</span><strong>{recentAudit.item.failureMessage}</strong></div>}
                </div>
              ) : (
                <span className={styles.mutedInline}>아직 기록된 변경 이력이 없습니다.</span>
              )}
            </section>

            <section className={styles.draftSection} aria-labelledby="draft-list-title">
              <div className={styles.sectionHeadingRow}>
                <div className={styles.sectionHeading}>
                  <div className={styles.sectionIcon} aria-hidden="true"><NotePencil size={20} /></div>
                  <div>
                    <h3 id="draft-list-title">저장된 초안</h3>
                    <p>초안만 수정할 수 있으며 게시된 정책은 새 초안으로 만들어야 합니다.</p>
                  </div>
                </div>
                <span className={styles.countBadge}>{draftPolicies.length}개</span>
              </div>
              {draftPolicies.length === 0 ? (
                <div className={styles.listEmpty}>
                  <NotePencil size={24} aria-hidden="true" />
                  <span>작성 중인 초안이 없습니다.</span>
                </div>
              ) : (
                <div className={styles.draftList}>
                  {draftPolicies.map((policy) => (
                    <article className={styles.draftItem} key={policy.id}>
                      <div className={styles.draftMain}>
                        <span className={`${styles.statusBadge} ${styles.draftStatus}`}>
                          {isAppUpdateRelaxation(policy, activePolicy) ? "긴급 완화 초안" : "초안"} · rev {policy.revision}
                        </span>
                        <h4>{policy.latestVersion} · 빌드 {policy.latestBuild}</h4>
                        <p>{policy.forceUpdateEnabled ? `최소 지원 빌드 ${policy.minimumSupportedBuild}` : "강제 업데이트 미사용"} · 선택 안내 {policy.optionalUpdateEnabled ? "사용" : "미사용"}</p>
                        <small>마지막 수정 {formatTimestamp(policy.updatedAt)} · 관리자 #{policy.updatedBy}</small>
                      </div>
                      <div className={styles.draftActions}>
                        <button className="button button-secondary" type="button" disabled={savingDraft || currentState.status !== "ready"} onClick={() => startEdit(policy)}>
                          <NotePencil size={16} aria-hidden="true" /> 계속 편집
                        </button>
                        <button className="button button-primary" type="button" disabled={savingDraft || currentState.status !== "ready"} onClick={() => void openPreview(policy)}>
                          <Eye size={16} aria-hidden="true" /> 게시 전 미리보기
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>

            <section className={styles.historySection} aria-labelledby="emergency-relax-title">
              <div className={styles.sectionHeadingRow}>
                <div className={styles.sectionHeading}>
                  <div className={styles.sectionIcon} aria-hidden="true"><ShieldWarning size={20} /></div>
                  <div>
                    <h3 id="emergency-relax-title">강제 조건 긴급 완화</h3>
                    <p>현재 최소 지원 빌드를 낮추거나 강제 업데이트를 끌 때만 사용합니다. 완화용 초안을 만든 뒤 별도 긴급 완화 절차로 적용합니다.</p>
                  </div>
                </div>
                <button
                  className="button button-danger-subtle"
                  type="button"
                  disabled={savingDraft || currentState.status !== "ready" || !activePolicy?.forceUpdateEnabled}
                  onClick={startRelaxationDraft}
                >
                  <ShieldWarning size={17} aria-hidden="true" /> 완화 초안 만들기
                </button>
              </div>
              <div className={styles.impactNote}>
                <Info size={18} aria-hidden="true" />
                <div><strong>일반 게시와 다른 작업</strong><span>긴급 완화 전용 절차</span></div>
                <p>{activePolicy?.forceUpdateEnabled ? "완료 시 같은 플랫폼의 예약 정책도 서버가 함께 취소합니다." : "현재 강제 업데이트가 꺼져 있어 완화할 조건이 없습니다."}</p>
              </div>
            </section>

            <section className={styles.historySection} aria-labelledby="policy-history-title">
              <div className={styles.sectionHeadingRow}>
                <div className={styles.sectionHeading}>
                  <div className={styles.sectionIcon} aria-hidden="true"><ClockCounterClockwise size={20} /></div>
                  <div>
                    <h3 id="policy-history-title">과거 정책 롤백</h3>
                    <p>SUPERSEDED 정책을 복제해 새 ID·revision 1의 활성 정책을 만듭니다. 긴급 완화와는 별도 작업입니다.</p>
                  </div>
                </div>
                <button className="button button-secondary" type="button" onClick={openAuditHistory}>전체 변경 이력</button>
              </div>
              {previousPolicies.length === 0 ? (
                <div className={styles.listEmpty}><Clock size={24} aria-hidden="true" /><span>이전 정책이 없습니다.</span></div>
              ) : (
                <div className={styles.historyTableWrap}>
                  <table className={styles.historyTable}>
                    <thead>
                      <tr>
                        <th>상태</th>
                        <th>버전·빌드</th>
                        <th>강제 기준</th>
                        <th>적용 시각</th>
                        <th><span className={styles.visuallyHidden}>작업</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {previousPolicies.slice(0, historyVisibleCount).map((policy) => (
                        <tr key={policy.id}>
                          <td><span className={`${styles.statusBadge} ${styles.neutralStatus}`}>{policyStatusLabels[policy.status]}</span></td>
                          <td><strong>{policy.latestVersion}</strong><span>빌드 {policy.latestBuild} · rev {policy.revision}</span></td>
                          <td>{policy.forceUpdateEnabled ? `빌드 ${policy.minimumSupportedBuild} 미만` : "사용 안 함"}</td>
                          <td>{formatTimestamp(policy.effectiveAt)}</td>
                          <td>
                            <div className={styles.draftActions}>
                              <button className="button button-secondary" type="button" disabled={savingDraft || currentState.status !== "ready"} onClick={() => void openPreview(policy)}>
                                <Eye size={15} aria-hidden="true" /> 미리보기
                              </button>
                              {policy.status === "SUPERSEDED" && activePolicy && (
                                <button className={styles.rollbackButton} type="button" disabled={savingDraft || currentState.status !== "ready"} onClick={() => beginRollback(policy)}>
                                  이 정책으로 롤백
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {previousPolicies.length > historyVisibleCount && (
                    <div className={styles.historyMore}>
                      <button className="button button-secondary" type="button" onClick={() => setHistoryVisibleCount((count) => count + 8)}>
                        이전 정책 더 보기 ({previousPolicies.length - historyVisibleCount}개 남음)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </section>

            <section className={styles.impactNote}>
              <Info size={19} aria-hidden="true" />
              <div><strong>영향 사용자</strong><span>집계 데이터 없음</span></div>
              <p>단순 확인 API 호출 횟수를 실제 사용자 수로 표시하지 않습니다.</p>
            </section>
          </>
        )}

        {editor && (
          <section className={styles.editor} aria-labelledby="policy-editor-title">
            <div className={styles.editorHeader}>
              <div>
                <span className={styles.eyebrow}>{editorIsRelaxation ? "강제 조건 긴급 완화용 초안" : editor.mode === "create" ? "새 정책 초안" : `초안 #${editor.policy?.id} · rev ${editor.policy?.revision}`}</span>
                <h3 id="policy-editor-title">{platformLabel(editor.form.platform)} {editorIsRelaxation ? "긴급 완화 초안" : "업데이트 정책"} 작성</h3>
                <p>{editorIsRelaxation ? "이 초안은 일반 게시가 아닌 긴급 완화 절차로만 적용됩니다." : "표시 버전은 안내용이며 실제 판정은 단조 증가하는 정수 빌드 번호로 처리합니다."}</p>
              </div>
              <button className={styles.editorClose} type="button" aria-label="정책 작성 닫기" disabled={savingDraft} onClick={requestEditorClose}>
                <X size={20} aria-hidden="true" />
              </button>
            </div>

            {editor.mode === "create" && otherActivePolicy && (
              <div className={styles.copyNotice}>
                <Copy size={18} aria-hidden="true" />
                <div>
                  <strong>{platformLabel(otherPlatform)} 정책의 문구만 가져올 수 있습니다.</strong>
                  <p>버전, 빌드, 스토어 URL, 적용 시각은 복사하지 않습니다.</p>
                </div>
                <button className="button button-secondary" type="button" disabled={savingDraft} onClick={startFromOtherWording}>
                  문구만 복사
                </button>
              </div>
            )}

            <fieldset className={styles.formGrid} disabled={savingDraft}>
              <legend className={styles.visuallyHidden}>앱 업데이트 정책 입력</legend>
              <div className={styles.field}>
                <span className={styles.fieldLabel} id="app-update-platform-label">플랫폼</span>
                <div className={styles.lockedField} role="group" aria-labelledby="app-update-platform-label">
                  {editor.form.platform === "IOS" ? <AppleLogo size={18} aria-hidden="true" /> : <AndroidLogo size={18} aria-hidden="true" />}
                  <strong>{platformLabel(editor.form.platform)}</strong>
                  <span><ShieldWarning size={14} aria-hidden="true" /> 초안 생성 후 변경 불가</span>
                </div>
              </div>
              <div className={styles.field}>
                <label htmlFor="app-update-latestVersion">최신 표시 버전 <span>필수 · 1~32자</span></label>
                <input
                  id="app-update-latestVersion"
                  value={editor.form.latestVersion}
                  maxLength={32}
                  aria-invalid={Boolean(fieldErrors.latestVersion)}
                  aria-describedby={fieldErrors.latestVersion ? "app-update-latestVersion-error" : undefined}
                  placeholder="예: 1.3"
                  onChange={(event) => updateEditor("latestVersion", event.target.value)}
                />
                {fieldErrors.latestVersion && <small className={styles.fieldError} id="app-update-latestVersion-error">{fieldErrors.latestVersion}</small>}
              </div>
              <div className={styles.field}>
                <label htmlFor="app-update-latestBuild">최신 빌드 <span>필수 · 1 이상 정수</span></label>
                <input
                  id="app-update-latestBuild"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={editor.form.latestBuild}
                  aria-invalid={Boolean(fieldErrors.latestBuild)}
                  aria-describedby={fieldErrors.latestBuild ? "app-update-latestBuild-error" : undefined}
                  placeholder="예: 29"
                  onChange={(event) => updateEditor("latestBuild", event.target.value)}
                />
                {fieldErrors.latestBuild && <small className={styles.fieldError} id="app-update-latestBuild-error">{fieldErrors.latestBuild}</small>}
              </div>

              <div className={styles.fullField}>
                <ToggleField
                  checked={editor.form.forceUpdateEnabled}
                  label="강제 업데이트"
                  description="최소 지원 빌드 미만 사용자의 앱 진입을 막고 스토어 설치를 요구합니다."
                  disabled={savingDraft}
                  onChange={(checked) => {
                    updateEditor("forceUpdateEnabled", checked);
                    if (!checked) updateEditor("minimumSupportedBuild", "");
                  }}
                />
              </div>

              <div className={styles.field}>
                <label htmlFor="app-update-minimumSupportedBuild">
                  최소 지원 빌드 <span>{editor.form.forceUpdateEnabled ? "필수 · 최신 빌드 이하" : "강제 업데이트 사용 시 입력"}</span>
                </label>
                <input
                  id="app-update-minimumSupportedBuild"
                  type="number"
                  min="1"
                  step="1"
                  inputMode="numeric"
                  value={editor.form.minimumSupportedBuild}
                  disabled={!editor.form.forceUpdateEnabled}
                  aria-invalid={Boolean(fieldErrors.minimumSupportedBuild)}
                  aria-describedby={fieldErrors.minimumSupportedBuild ? "app-update-minimumSupportedBuild-error" : undefined}
                  placeholder={editor.form.forceUpdateEnabled ? "예: 28" : "강제 업데이트 미사용"}
                  onChange={(event) => updateEditor("minimumSupportedBuild", event.target.value)}
                />
                {fieldErrors.minimumSupportedBuild && <small className={styles.fieldError} id="app-update-minimumSupportedBuild-error">{fieldErrors.minimumSupportedBuild}</small>}
              </div>

              <div className={styles.fullField}>
                <ToggleField
                  checked={editor.form.optionalUpdateEnabled}
                  label="선택 업데이트 안내"
                  description="강제 대상이 아니면서 최신 빌드보다 낮은 사용자에게 닫을 수 있는 안내를 표시합니다."
                  disabled={savingDraft}
                  onChange={(checked) => updateEditor("optionalUpdateEnabled", checked)}
                />
              </div>

              <div className={`${styles.field} ${styles.fullField}`}>
                <label htmlFor="app-update-storeUrl">스토어 URL <span>필수 · 플랫폼별 HTTPS 주소</span></label>
                <div className={styles.urlInputRow}>
                  <input
                    id="app-update-storeUrl"
                    type="url"
                    value={editor.form.storeUrl}
                    maxLength={500}
                    aria-invalid={Boolean(fieldErrors.storeUrl)}
                    aria-describedby={fieldErrors.storeUrl ? "app-update-storeUrl-error" : undefined}
                    placeholder={appStorePlaceholder(editor.form.platform)}
                    onChange={(event) => updateEditor("storeUrl", event.target.value)}
                  />
                  {!validateAppStoreUrl(editor.form.platform, editor.form.storeUrl) && (
                    <a className="button button-secondary" href={editor.form.storeUrl} target="_blank" rel="noreferrer">
                      링크 테스트 <ArrowSquareOut size={15} aria-hidden="true" />
                    </a>
                  )}
                </div>
                {fieldErrors.storeUrl && <small className={styles.fieldError} id="app-update-storeUrl-error">{fieldErrors.storeUrl}</small>}
              </div>

              <div className={`${styles.field} ${styles.fullField}`}>
                <label htmlFor="app-update-title">안내 제목 <span>필수 · 2~40자 · 일반 텍스트</span></label>
                <input
                  id="app-update-title"
                  value={editor.form.title}
                  maxLength={40}
                  aria-invalid={Boolean(fieldErrors.title)}
                  aria-describedby={fieldErrors.title ? "app-update-title-error" : undefined}
                  onChange={(event) => updateEditor("title", event.target.value)}
                />
                <span className={styles.characterCount}>{editor.form.title.trim().length}/40</span>
                {fieldErrors.title && <small className={styles.fieldError} id="app-update-title-error">{fieldErrors.title}</small>}
              </div>

              <div className={`${styles.field} ${styles.fullField}`}>
                <label htmlFor="app-update-message">안내문 <span>필수 · 1~300자 · 일반 텍스트</span></label>
                <textarea
                  id="app-update-message"
                  value={editor.form.message}
                  maxLength={300}
                  rows={4}
                  aria-invalid={Boolean(fieldErrors.message)}
                  aria-describedby={fieldErrors.message ? "app-update-message-error" : undefined}
                  placeholder="안정적인 서비스 이용을 위해 최신 버전을 설치해 주세요."
                  onChange={(event) => updateEditor("message", event.target.value)}
                />
                <span className={styles.characterCount}>{editor.form.message.trim().length}/300</span>
                {fieldErrors.message && <small className={styles.fieldError} id="app-update-message-error">{fieldErrors.message}</small>}
              </div>

              <div className={`${styles.field} ${styles.fullField}`}>
                <label htmlFor="app-update-reason">내부 변경 사유 <span>필수 · 10~500자 · 사용자에게 노출되지 않음</span></label>
                <textarea
                  id="app-update-reason"
                  value={editor.form.reason}
                  maxLength={500}
                  rows={3}
                  aria-invalid={Boolean(fieldErrors.reason)}
                  aria-describedby={fieldErrors.reason ? "app-update-reason-error" : undefined}
                  placeholder="예: App Store 빌드 29 배포 준비"
                  onChange={(event) => updateEditor("reason", event.target.value)}
                />
                <span className={styles.characterCount}>{editor.form.reason.trim().length}/500</span>
                {fieldErrors.reason && <small className={styles.fieldError} id="app-update-reason-error">{fieldErrors.reason}</small>}
              </div>
            </fieldset>

            <div className={styles.editorFooter}>
              <p><Info size={16} aria-hidden="true" /> 저장하면 DRAFT가 되며 사용자 앱에는 아직 적용되지 않습니다. {editorIsRelaxation && "미리보기 후 긴급 완화로 적용하세요."}</p>
              <div>
                <button className="button button-secondary" type="button" disabled={savingDraft} onClick={requestEditorClose}>닫기</button>
                <button className="button button-primary" type="button" disabled={savingDraft || currentState.status !== "ready"} onClick={() => void saveDraft()}>
                  {savingDraft ? <SpinnerGap className={styles.spinner} size={17} aria-hidden="true" /> : <FloppyDisk size={17} aria-hidden="true" />}
                  {savingDraft ? "저장 중" : "초안 저장"}
                </button>
                {editor.mode === "edit" && editor.policy && !editorDirty && (
                  <button className="button button-primary" type="button" disabled={savingDraft || currentState.status !== "ready"} onClick={() => void openPreview(editor.policy!)}>
                    <Eye size={17} aria-hidden="true" /> 게시 전 미리보기
                  </button>
                )}
              </div>
            </div>
          </section>
        )}
        </div>
      </div>

      <UnsavedChangesDialog dirty={editorDirty} />
      <ConfirmDialog
        open={editorClosePending}
        title="저장하지 않은 정책 변경사항이 있습니다."
        description="작성 화면을 닫으면 입력한 내용이 사라집니다."
        confirmLabel="변경사항 버리기"
        danger
        onCancel={() => setEditorClosePending(false)}
        onConfirm={() => {
          setEditorClosePending(false);
          setEditor(null);
          setFieldErrors({});
        }}
      />

      {preview && (
        <DialogShell
          titleId="app-update-preview-title"
          title={preview.policy.status === "DRAFT" ? "정책 적용 전 미리보기" : `${policyStatusLabels[preview.policy.status]} 정책 미리보기`}
          description="정책을 변경하지 않고 실제 앱 안내와 서버가 판정한 빌드 경계값을 확인합니다."
          wide
          onClose={() => {
            previewController.current?.abort();
            setPreview(null);
          }}
        >
          {preview.status === "loading" ? (
            <LoadingPanel label="서버에서 빌드별 판정을 확인하는 중입니다." />
          ) : preview.status === "error" ? (
            <div className={styles.dialogError} role="alert">
              <WarningCircle size={24} weight="fill" aria-hidden="true" />
              <div><strong>미리보기를 불러오지 못했습니다.</strong><p>{preview.error}</p></div>
              <button className="button button-secondary" type="button" onClick={() => void openPreview(preview.policy)}>다시 시도</button>
            </div>
          ) : preview.data ? (
            <div className={styles.previewBody}>
              <div className={styles.previewGrid}>
                <section className={styles.phonePreview} aria-labelledby="app-notice-preview-title">
                  <div className={styles.phoneChrome}><span /><strong>한서메이트</strong><span /></div>
                  {selectedPreviewResult?.action === "NONE" ? (
                    <div className={styles.noNoticePreview}>
                      <CheckCircle size={36} weight="duotone" aria-hidden="true" />
                      <h3 id="app-notice-preview-title">업데이트 안내 없음</h3>
                      <p>설치 빌드 {selectedPreviewResult.build}은 안내를 표시하지 않고 앱에 진입합니다.</p>
                    </div>
                  ) : (
                    <div className={styles.appNotice}>
                      <div className={styles.appNoticeIcon} aria-hidden="true"><RocketLaunch size={27} weight="duotone" /></div>
                      <span className={styles.previewActionLabel}>
                        {selectedPreviewResult ? actionLabels[selectedPreviewResult.action] : "서버 판정"}
                      </span>
                      <h3 id="app-notice-preview-title">{preview.policy.title}</h3>
                      <p>{preview.policy.message}</p>
                      <a href={preview.policy.storeUrl} target="_blank" rel="noreferrer">업데이트</a>
                      {selectedPreviewResult?.action === "OPTIONAL" && <span>나중에</span>}
                    </div>
                  )}
                </section>

                <section className={styles.previewDetails} aria-labelledby="server-decision-title">
                  <div className={styles.previewMeta}>
                    <div><span>플랫폼</span><strong>{platformLabel(preview.policy.platform)}</strong></div>
                    <div><span>정책 상태·revision</span><strong>{policyStatusLabels[preview.policy.status]} · rev {preview.policy.revision}</strong></div>
                    <div><span>다음 작업</span><strong>{preview.policy.status === "DRAFT" ? (isAppUpdateRelaxation(preview.policy, activePolicy) ? "긴급 완화로 적용" : "즉시·예약 게시") : "조회만 가능"}</strong></div>
                    <div><span>스토어</span><a href={preview.policy.storeUrl} target="_blank" rel="noreferrer">링크 테스트 <ArrowSquareOut size={14} /></a></div>
                  </div>
                  <h3 id="server-decision-title">서버 판정 경계값</h3>
                  <div className={styles.decisionList}>
                    {preview.data.results.map((result) => (
                      <button
                        key={result.build}
                        type="button"
                        className={preview.selectedBuild === result.build ? styles.selectedDecision : ""}
                        aria-pressed={preview.selectedBuild === result.build}
                        onClick={() => setPreview((current) => current ? { ...current, selectedBuild: result.build } : null)}
                      >
                        <span>설치 빌드 <strong>{result.build}</strong></span>
                        <span className={`${styles.decisionBadge} ${styles[`decision${result.action}`]}`}>{actionLabels[result.action]}</span>
                      </button>
                    ))}
                  </div>
                  {preview.policy.forceUpdateEnabled && preview.policy.minimumSupportedBuild === 1 && (
                    <p className={styles.boundaryNote}>최소 지원 빌드가 1이라 유효한 하한 빌드(1 미만)가 없어 빌드 0은 요청하지 않았습니다.</p>
                  )}
                </section>
              </div>

              <section className={styles.diffSection} aria-labelledby="policy-diff-title">
                <h3 id="policy-diff-title">현재 정책과 달라지는 값</h3>
                {changedFields(activePolicy, preview.policy).length === 0 ? (
                  <p className={styles.noDiff}>현재 활성 정책과 같은 값입니다.</p>
                ) : (
                  <div className={styles.diffTableWrap}>
                    <table className={styles.diffTable}>
                      <thead><tr><th>항목</th><th>현재</th><th>새 정책</th></tr></thead>
                      <tbody>
                        {changedFields(activePolicy, preview.policy).map((field) => (
                          <tr key={field}>
                            <th>{fieldLabel(field)}</th>
                            <td>{policyValue(activePolicy, field)}</td>
                            <td>{policyValue(preview.policy, field)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              <div className={styles.dialogActions}>
                <button className="button button-secondary" type="button" onClick={() => setPreview(null)}>닫기</button>
                {preview.policy.status === "DRAFT" && (
                  isAppUpdateRelaxation(preview.policy, activePolicy) ? (
                    <button className="button button-danger" type="button" disabled={!selectedPreviewResult} onClick={() => beginRelax(preview.policy)}>
                      <ShieldWarning size={17} aria-hidden="true" /> 긴급 완화 확인으로
                    </button>
                  ) : (
                    <button className="button button-primary" type="button" disabled={!selectedPreviewResult} onClick={() => beginPublish(preview.policy)}>
                      <RocketLaunch size={17} aria-hidden="true" /> 게시 설정으로
                    </button>
                  )
                )}
              </div>
            </div>
          ) : null}
        </DialogShell>
      )}

      {publishDialog && (
        <DialogShell
          titleId="app-update-publish-title"
          title="정책 게시 최종 확인"
          description="사용자 접근에 영향을 줄 수 있는 운영 작업입니다. 적용 대상과 시각을 다시 확인하세요."
          busy={busyOperation === "publish"}
          onClose={() => setPublishDialog(null)}
        >
          <div className={styles.operationBody}>
            <div className={`${styles.operationSummary} ${styles.publishSummary}`}>
              <div><span>플랫폼</span><strong>{platformLabel(publishDialog.policy.platform)}</strong></div>
              <div><span>현재 빌드</span><strong>{activePolicy ? activePolicy.latestBuild : "활성 정책 없음"}</strong></div>
              <div><span>변경 빌드</span><strong>{publishDialog.policy.latestBuild}</strong></div>
              <div>
                <span>적용 시각</span>
                <strong>{publishDialog.mode === "IMMEDIATE" ? "확인 즉시" : publishDialog.effectiveAt ? `${publishDialog.effectiveAt.replace("T", " ")} KST` : "예약 시각 입력 필요"}</strong>
              </div>
            </div>
            <fieldset className={styles.modeFieldset} disabled={busyOperation === "publish" || publishDialog.retryReady}>
              <legend>게시 방식</legend>
              <label className={publishDialog.mode === "IMMEDIATE" ? styles.selectedMode : ""}>
                <input
                  type="radio"
                  name="publish-mode"
                  value="IMMEDIATE"
                  checked={publishDialog.mode === "IMMEDIATE"}
                  onChange={() => setPublishDialog((current) => current ? { ...current, mode: "IMMEDIATE", effectiveAt: "", error: "" } : null)}
                />
                <RocketLaunch size={19} aria-hidden="true" />
                <span><strong>즉시 게시</strong><small>확인 후 바로 활성화</small></span>
              </label>
              <label className={publishDialog.mode === "SCHEDULED" ? styles.selectedMode : ""}>
                <input
                  type="radio"
                  name="publish-mode"
                  value="SCHEDULED"
                  checked={publishDialog.mode === "SCHEDULED"}
                  onChange={() => setPublishDialog((current) => current ? { ...current, mode: "SCHEDULED", error: "" } : null)}
                />
                <CalendarCheck size={19} aria-hidden="true" />
                <span><strong>예약 게시</strong><small>지정한 KST 시각에 서버에서 적용</small></span>
              </label>
            </fieldset>
            {publishDialog.mode === "SCHEDULED" && (
              <div className={styles.dialogField}>
                <label htmlFor="publish-effective-at">예약 시각 <span>KST</span></label>
                <input
                  id="publish-effective-at"
                  type="datetime-local"
                  disabled={busyOperation === "publish" || publishDialog.retryReady}
                  value={publishDialog.effectiveAt}
                  onChange={(event) => setPublishDialog((current) => current ? { ...current, effectiveAt: event.target.value, error: "" } : null)}
                />
              </div>
            )}
            <div className={styles.dialogField}>
              <label htmlFor="publish-reason">게시 사유 <span>10~500자 · 감사 로그 저장</span></label>
              <textarea
                id="publish-reason"
                rows={3}
                maxLength={500}
                disabled={busyOperation === "publish" || publishDialog.retryReady}
                value={publishDialog.reason}
                onChange={(event) => setPublishDialog((current) => current ? { ...current, reason: event.target.value, error: "" } : null)}
              />
            </div>
            <label className={styles.storeConfirmation}>
              <input
                type="checkbox"
                disabled={busyOperation === "publish" || publishDialog.retryReady}
                checked={publishDialog.storeAvailabilityConfirmed}
                onChange={(event) => setPublishDialog((current) => current ? { ...current, storeAvailabilityConfirmed: event.target.checked, error: "" } : null)}
              />
              <span>
                <strong>스토어 배포 상태를 확인했습니다.</strong>
                <small>대상 국가·트랙에서 빌드 {publishDialog.policy.latestBuild}을 실제로 설치할 수 있습니다.</small>
              </span>
            </label>
            <div className={styles.confirmPhrase}>
              <label htmlFor="publish-confirmation">계속하려면 <strong>{operationConfirmation(publishDialog.policy)}</strong> 입력</label>
              <input
                id="publish-confirmation"
                autoComplete="off"
                disabled={busyOperation === "publish" || publishDialog.retryReady}
                value={publishDialog.confirmation}
                onChange={(event) => setPublishDialog((current) => current ? { ...current, confirmation: event.target.value, error: "" } : null)}
              />
            </div>
            {publishDialog.error && <p className={styles.operationError} role="alert">{publishDialog.error}</p>}
            <div className={styles.dialogActions}>
              <button className="button button-secondary" type="button" disabled={busyOperation === "publish"} onClick={() => setPublishDialog(null)}>취소</button>
              <button className="button button-primary" type="button" disabled={busyOperation === "publish"} onClick={() => void submitPublish()}>
                {busyOperation === "publish" ? <SpinnerGap className={styles.spinner} size={17} /> : <RocketLaunch size={17} />}
                {busyOperation === "publish" ? "처리 중" : publishDialog.retryReady ? "같은 요청 다시 시도" : publishDialog.mode === "IMMEDIATE" ? "즉시 게시" : "예약 게시"}
              </button>
            </div>
          </div>
        </DialogShell>
      )}

      {cancelDialog && (
        <DialogShell
          titleId="app-update-cancel-title"
          title="예약 정책 취소"
          description="예약만 취소하며 현재 활성 정책은 변경하지 않습니다."
          busy={busyOperation === "cancel"}
          onClose={() => setCancelDialog(null)}
        >
          <div className={styles.operationBody}>
            <div className={styles.operationSummary}>
              <div><span>플랫폼</span><strong>{platformLabel(cancelDialog.policy.platform)}</strong></div>
              <div><span>예약 빌드</span><strong>{cancelDialog.policy.latestBuild}</strong></div>
              <div><span>예약 시각</span><strong>{formatTimestamp(cancelDialog.policy.effectiveAt)}</strong></div>
            </div>
            <div className={styles.dialogField}>
              <label htmlFor="cancel-reason">취소 사유 <span>필수 · 10~500자</span></label>
              <textarea id="cancel-reason" rows={4} maxLength={500} disabled={busyOperation === "cancel" || cancelDialog.retryReady} value={cancelDialog.reason} onChange={(event) => setCancelDialog((current) => current ? { ...current, reason: event.target.value, error: "" } : null)} />
            </div>
            {cancelDialog.error && <p className={styles.operationError} role="alert">{cancelDialog.error}</p>}
            <div className={styles.dialogActions}>
              <button className="button button-secondary" type="button" disabled={busyOperation === "cancel"} onClick={() => setCancelDialog(null)}>돌아가기</button>
              <button className="button button-danger" type="button" disabled={busyOperation === "cancel"} onClick={() => void submitCancel()}>
                {busyOperation === "cancel" ? <SpinnerGap className={styles.spinner} size={17} /> : <Prohibit size={17} />}
                {busyOperation === "cancel" ? "처리 중" : cancelDialog.retryReady ? "같은 요청 다시 시도" : "예약 취소"}
              </button>
            </div>
          </div>
        </DialogShell>
      )}

      {rollbackDialog && (
        <DialogShell
          titleId="app-update-rollback-title"
          title="과거 정책 롤백"
          description="과거 정책 행을 다시 활성화하지 않고, 선택한 값을 복제한 새 revision을 즉시 게시합니다."
          busy={busyOperation === "rollback"}
          onClose={() => setRollbackDialog(null)}
        >
          <div className={styles.operationBody}>
            <div className={`${styles.operationSummary} ${styles.publishSummary} ${styles.dangerSummary}`}>
              <div><span>플랫폼</span><strong>{platformLabel(rollbackDialog.target.platform)}</strong></div>
              <div><span>현재 빌드</span><strong>{rollbackDialog.active.latestBuild}</strong></div>
              <div><span>복원할 빌드</span><strong>{rollbackDialog.target.latestBuild}</strong></div>
              <div><span>적용 시각</span><strong>확인 즉시</strong></div>
            </div>
            <div className={styles.rollbackComparison}>
              <div><span>현재 최소 지원</span><strong>{rollbackDialog.active.minimumSupportedBuild ?? "설정 안 함"}</strong></div>
              <CaretRight size={18} aria-hidden="true" />
              <div><span>복원할 최소 지원</span><strong>{rollbackDialog.target.minimumSupportedBuild ?? "설정 안 함"}</strong></div>
            </div>
            <div className={styles.impactNote}>
              <Info size={18} aria-hidden="true" />
              <div>
                <strong>예약 정책 처리</strong>
                <span>{rollbackDialog.scheduledPolicyIdAtStart ? `정책 #${rollbackDialog.scheduledPolicyIdAtStart} 함께 취소` : "남은 예약 없음"}</span>
              </div>
              <p>롤백을 적용하면 같은 플랫폼의 남은 예약은 서버에서 함께 취소합니다.</p>
            </div>
            <div className={styles.dialogField}>
              <label htmlFor="rollback-reason">롤백 사유 <span>필수 · 감사 로그 저장</span></label>
              <textarea id="rollback-reason" rows={4} maxLength={500} disabled={busyOperation === "rollback" || rollbackDialog.retryReady} value={rollbackDialog.reason} onChange={(event) => setRollbackDialog((current) => current ? { ...current, reason: event.target.value, error: "" } : null)} />
            </div>
            <div className={styles.confirmPhrase}>
              <label htmlFor="rollback-confirmation">계속하려면 <strong>{operationConfirmation(rollbackDialog.target)}</strong> 입력</label>
              <input id="rollback-confirmation" autoComplete="off" disabled={busyOperation === "rollback" || rollbackDialog.retryReady} value={rollbackDialog.confirmation} onChange={(event) => setRollbackDialog((current) => current ? { ...current, confirmation: event.target.value, error: "" } : null)} />
            </div>
            {rollbackDialog.error && <p className={styles.operationError} role="alert">{rollbackDialog.error}</p>}
            <div className={styles.dialogActions}>
              <button className="button button-secondary" type="button" disabled={busyOperation === "rollback"} onClick={() => setRollbackDialog(null)}>취소</button>
              <button className="button button-danger" type="button" disabled={busyOperation === "rollback"} onClick={() => void submitRollback()}>
                {busyOperation === "rollback" ? <SpinnerGap className={styles.spinner} size={17} /> : <ShieldWarning size={17} />}
                {busyOperation === "rollback" ? "처리 중" : rollbackDialog.retryReady ? "같은 요청 다시 시도" : "새 정책으로 롤백"}
              </button>
            </div>
          </div>
        </DialogShell>
      )}

      {relaxDialog && (
        <DialogShell
          titleId="app-update-relax-title"
          title="강제 조건 긴급 완화"
          description="완화용 초안을 활성화하고 같은 플랫폼의 남은 예약 정책을 함께 취소합니다. 과거 정책 롤백과는 다른 작업입니다."
          busy={busyOperation === "relax"}
          onClose={() => setRelaxDialog(null)}
        >
          <div className={styles.operationBody}>
            <div className={`${styles.operationSummary} ${styles.publishSummary} ${styles.dangerSummary}`}>
              <div><span>플랫폼</span><strong>{platformLabel(relaxDialog.policy.platform)}</strong></div>
              <div><span>현재 강제 기준</span><strong>{relaxDialog.active.forceUpdateEnabled ? `빌드 ${relaxDialog.active.minimumSupportedBuild} 미만` : "사용 안 함"}</strong></div>
              <div><span>완화 후 기준</span><strong>{relaxDialog.policy.forceUpdateEnabled ? `빌드 ${relaxDialog.policy.minimumSupportedBuild} 미만` : "강제 해제"}</strong></div>
              <div><span>예약 처리</span><strong>{relaxDialog.scheduledPolicyIdAtStart ? `정책 #${relaxDialog.scheduledPolicyIdAtStart} 함께 취소` : "남은 예약 없음"}</strong></div>
            </div>
            <label className={styles.storeConfirmation}>
              <input
                type="checkbox"
                disabled={busyOperation === "relax" || relaxDialog.retryReady}
                checked={relaxDialog.storeAvailabilityConfirmed}
                onChange={(event) => setRelaxDialog((current) => current ? { ...current, storeAvailabilityConfirmed: event.target.checked, error: "" } : null)}
              />
              <span>
                <strong>스토어 배포 상태를 확인했습니다.</strong>
                <small>대상 국가·트랙에서 빌드 {relaxDialog.policy.latestBuild}을 실제로 설치할 수 있습니다.</small>
              </span>
            </label>
            <div className={styles.dialogField}>
              <label htmlFor="relax-reason">긴급 완화 사유 <span>필수 · 10~500자 · 감사 로그 저장</span></label>
              <textarea
                id="relax-reason"
                rows={4}
                maxLength={500}
                disabled={busyOperation === "relax" || relaxDialog.retryReady}
                value={relaxDialog.reason}
                onChange={(event) => setRelaxDialog((current) => current ? { ...current, reason: event.target.value, error: "" } : null)}
              />
            </div>
            <div className={styles.confirmPhrase}>
              <label htmlFor="relax-confirmation">계속하려면 <strong>{relaxConfirmation(relaxDialog.policy)}</strong> 입력</label>
              <input
                id="relax-confirmation"
                autoComplete="off"
                disabled={busyOperation === "relax" || relaxDialog.retryReady}
                value={relaxDialog.confirmation}
                onChange={(event) => setRelaxDialog((current) => current ? { ...current, confirmation: event.target.value, error: "" } : null)}
              />
            </div>
            {relaxDialog.error && <p className={styles.operationError} role="alert">{relaxDialog.error}</p>}
            <div className={styles.dialogActions}>
              <button className="button button-secondary" type="button" disabled={busyOperation === "relax"} onClick={() => setRelaxDialog(null)}>취소</button>
              <button className="button button-danger" type="button" disabled={busyOperation === "relax"} onClick={() => void submitRelax()}>
                {busyOperation === "relax" ? <SpinnerGap className={styles.spinner} size={17} /> : <ShieldWarning size={17} />}
                {busyOperation === "relax" ? "처리 중" : relaxDialog.retryReady ? "같은 요청 다시 시도" : "긴급 완화 적용"}
              </button>
            </div>
          </div>
        </DialogShell>
      )}

      {auditDialog.open && (
        <DialogShell
          titleId="app-update-audit-title"
          title="앱 업데이트 변경 이력"
          description="변경 전·후 값, 작업자, 내부 사유와 요청 정보를 조회합니다. 이 기록은 수정하거나 삭제할 수 없습니다."
          wide
          onClose={() => {
            auditController.current?.abort();
            setAuditDialog((current) => ({ ...current, open: false }));
          }}
        >
          <div className={styles.auditBody}>
            <div className={styles.auditFilters}>
              <label>플랫폼
                <select value={auditDialog.filters.platform} onChange={(event) => setAuditDialog((current) => ({ ...current, filters: { ...current.filters, platform: event.target.value as AppPlatform } }))}>
                  <option value="IOS">iOS</option>
                  <option value="ANDROID">Android</option>
                </select>
              </label>
              <label>작업 유형
                <select value={auditDialog.filters.eventType} onChange={(event) => setAuditDialog((current) => ({ ...current, filters: { ...current.filters, eventType: event.target.value } }))}>
                  <option value="">전체</option>
                  {APP_UPDATE_AUDIT_EVENT_TYPES.map((eventType) => (
                    <option key={eventType} value={eventType}>{auditEventLabels[eventType]}</option>
                  ))}
                </select>
              </label>
              <label>작업자 ID
                <input inputMode="numeric" placeholder="전체" value={auditDialog.filters.actorId} onChange={(event) => setAuditDialog((current) => ({ ...current, filters: { ...current.filters, actorId: event.target.value } }))} />
              </label>
              <label>시작 시각 <span>KST</span>
                <input type="datetime-local" value={auditDialog.filters.from} onChange={(event) => setAuditDialog((current) => ({ ...current, filters: { ...current.filters, from: event.target.value } }))} />
              </label>
              <label>종료 시각 <span>KST</span>
                <input type="datetime-local" value={auditDialog.filters.to} onChange={(event) => setAuditDialog((current) => ({ ...current, filters: { ...current.filters, to: event.target.value } }))} />
              </label>
              <button className="button button-primary" type="button" onClick={() => void loadAuditPage(auditDialog.filters, 0)}>필터 적용</button>
            </div>

            {auditDialog.status === "loading" ? (
              <LoadingPanel label="변경 이력을 불러오는 중입니다." />
            ) : auditDialog.status === "error" ? (
              <div className={styles.dialogError} role="alert">
                <WarningCircle size={24} weight="fill" aria-hidden="true" />
                <div><strong>변경 이력을 불러오지 못했습니다.</strong><p>{auditDialog.error}</p></div>
                <button className="button button-secondary" type="button" onClick={() => void loadAuditPage(auditDialog.filters, auditDialog.data?.page ?? 0)}>다시 시도</button>
              </div>
            ) : auditDialog.data && auditDialog.data.items.length > 0 ? (
              <>
                <div className={styles.auditList}>
                  {auditDialog.data.items.map((log, index) => (
                    <article className={styles.auditItem} key={`${log.id}-${log.createdAt}-${index}`}>
                      <div className={styles.auditItemHeader}>
                        <div>
                          <span className={`${styles.statusBadge} ${log.success ? styles.activeStatus : styles.cancelledStatus}`}>{log.success ? "성공" : "실패"}</span>
                          <h3>{auditEventLabels[log.eventType] ?? log.eventType}</h3>
                        </div>
                        <time dateTime={log.createdAt}>{formatTimestamp(log.createdAt)}</time>
                      </div>
                      <div className={styles.auditMeta}>
                        <span>정책 {log.policyId === null ? "-" : `#${log.policyId}`} · rev {log.revision ?? "-"}</span>
                        <span>플랫폼 {log.platform ? platformLabel(log.platform) : "-"}</span>
                        <span>작업자 {log.actorId === null ? "서버 자동" : `#${log.actorId}`}</span>
                        <span>게시자 {log.publishedBy ? `#${log.publishedBy}` : "-"}</span>
                        <span>게시 시각 {formatTimestamp(log.publishedAt)}</span>
                      </div>
                      <p className={styles.auditReason}><strong>내부 사유</strong>{log.reason}</p>
                      {log.failureMessage && <p className={styles.operationError} role="alert"><strong>실패 메시지</strong> {log.failureMessage}</p>}
                      <div className={styles.auditDetailsGrid}>
                        <details>
                          <summary>변경 전 정책 전체 값</summary>
                          <pre>{policySnapshot(log.beforeSnapshot)}</pre>
                        </details>
                        <details>
                          <summary>변경 후 정책 전체 값</summary>
                          <pre>{policySnapshot(log.afterSnapshot)}</pre>
                        </details>
                        <details className={styles.requestDetails}>
                          <summary>요청 정보</summary>
                          <dl>
                            <div><dt>요청 IP</dt><dd>{log.requestIp ?? "-"}</dd></div>
                            <div><dt>User-Agent</dt><dd>{log.userAgent ?? "-"}</dd></div>
                            <div><dt>request ID</dt><dd>{log.requestId}</dd></div>
                          </dl>
                        </details>
                      </div>
                    </article>
                  ))}
                </div>
                <div className={styles.pagination}>
                  <button className="button button-secondary" type="button" disabled={auditDialog.data.page <= 0} onClick={() => void loadAuditPage(auditDialog.filters, auditDialog.data!.page - 1)}>
                    <CaretLeft size={16} aria-hidden="true" /> 이전
                  </button>
                  <span>{auditDialog.data.totalPages === 0 ? 0 : auditDialog.data.page + 1} / {auditDialog.data.totalPages} 페이지 · 전체 {auditDialog.data.totalElements}건</span>
                  <button className="button button-secondary" type="button" disabled={!auditDialog.data.hasNext} onClick={() => void loadAuditPage(auditDialog.filters, auditDialog.data!.page + 1)}>
                    다음 <CaretRight size={16} aria-hidden="true" />
                  </button>
                </div>
              </>
            ) : (
              <div className={styles.auditEmpty}><ListBullets size={27} aria-hidden="true" /><strong>조건에 맞는 변경 이력이 없습니다.</strong></div>
            )}
          </div>
        </DialogShell>
      )}
    </AdminLoginNotice>
  );
}
