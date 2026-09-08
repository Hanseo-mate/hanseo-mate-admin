"use client";

import {
  ArrowClockwise,
  CalendarBlank,
  CheckCircle,
  ImageBroken,
  ImageSquare,
  LinkSimple,
  MagnifyingGlass,
  NotePencil,
  Plus,
  Power,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  type ChangeEvent,
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AdminLoginNotice } from "../../components/AdminLoginNotice";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { UnsavedChangesDialog } from "../../components/UnsavedChangesDialog";
import { ApiError, apiFetch, getErrorText } from "../../lib/api";
import { ADMIN_SESSION_EVENT, getAdminSession } from "../../lib/auth";
import {
  POPUP_ENDPOINT,
  POPUP_IMAGE_ACCEPT,
  type AppPopupUpdateRequest,
  type PopupForm,
  createPopupMultipartBody,
  emptyPopupForm,
  formFromPopup,
  parsePopup,
  parsePopups,
  popupUpdateFormWithOriginalDateTimes,
  sortPopups,
  updatePopupMultipartBody,
  validatePopupForm,
  validatePopupImage,
} from "../../lib/popups";
import styles from "../popups.module.css";

type Popup = ReturnType<typeof parsePopup>;
type LoadState = "idle" | "loading" | "ready" | "error";
type BusyAction = "create" | "update" | "delete" | "";
type Feedback = {
  tone: "success" | "info" | "error";
  title: string;
  message: string;
};
type FieldErrors = Partial<Record<keyof PopupForm, string>>;
type PendingAction =
  | { kind: "select"; popup: Popup }
  | { kind: "create" }
  | { kind: "refresh" }
  | { kind: "toggle"; popup: Popup }
  | null;

const STATUS_LABELS: Record<Popup["status"], string> = {
  ACTIVE: "노출 중",
  SCHEDULED: "노출 예정",
  EXPIRED: "노출 종료",
  INACTIVE: "비활성",
};

const NAVIGATION_OPTIONS: Array<{
  value: PopupForm["navigationType"];
  label: string;
}> = [
  { value: "", label: "클릭 이동 없음" },
  { value: "HOME", label: "홈 화면" },
  { value: "NOTICE_LIST", label: "공지사항 목록" },
  { value: "NOTICE_DETAIL", label: "공지사항 상세" },
  { value: "CLUB_LIST", label: "동아리 목록" },
  { value: "CLUB_DETAIL", label: "동아리 상세" },
  { value: "CAFETERIA", label: "학식 화면" },
  { value: "CALENDAR", label: "학사일정 화면" },
  { value: "TIMETABLE", label: "시간표 화면" },
  { value: "CAMPUS_MAP", label: "캠퍼스맵 화면" },
  { value: "SYSTEM_NOTICE_LIST", label: "시스템 공지 목록" },
  { value: "FESTIVAL", label: "축제 화면" },
  { value: "EXTERNAL_URL", label: "외부 웹페이지" },
];

const NOTICE_TYPE_OPTIONS: Array<{
  value: PopupForm["noticeType"];
  label: string;
}> = [
  { value: "STUDENT_COUNCIL", label: "총학생회" },
  { value: "ACADEMIC", label: "학사" },
  { value: "GENERAL", label: "일반" },
  { value: "SCHOLARSHIP", label: "장학" },
  { value: "GRADUATE", label: "대학원" },
];

const FIELD_IDS: Partial<Record<keyof PopupForm, string>> = {
  title: "popup-title",
  content: "popup-content",
  navigationType: "popup-navigation-type",
  noticeId: "popup-notice-id",
  noticeType: "popup-notice-type",
  clubId: "popup-club-id",
  externalUrl: "popup-external-url",
  startsAt: "popup-starts-at",
  endsAt: "popup-ends-at",
  displayOrder: "popup-display-order",
};

function popupErrorText(error: unknown) {
  if (error instanceof ApiError && error.status === 400) {
    return "입력한 내용과 이미지, 노출 시간을 다시 확인해 주세요.";
  }
  return getErrorText(error);
}

function draftSignature(form: PopupForm, file: File | null) {
  return JSON.stringify({
    form,
    file: file
      ? {
          name: file.name,
          size: file.size,
          type: file.type,
          lastModified: file.lastModified,
        }
      : null,
  });
}

function formatLocalDateTime(value: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return "날짜 정보 없음";
  const [, year, month, day, hour, minute] = match;
  return `${year}.${month}.${day} ${hour}:${minute}`;
}

function formatPeriod(popup: Popup) {
  if (!popup.startsAt && !popup.endsAt) return "지금부터 계속 노출";
  if (!popup.startsAt && popup.endsAt) return `${formatLocalDateTime(popup.endsAt)}까지`;
  if (popup.startsAt && !popup.endsAt) return `${formatLocalDateTime(popup.startsAt)}부터`;
  return `${formatLocalDateTime(popup.startsAt!)} - ${formatLocalDateTime(popup.endsAt!)}`;
}

function contentPreview(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return text || "내용 없음";
}

function navigationLabel(popup: Popup) {
  if (!popup.navigation) return "이동 없음";
  return NAVIGATION_OPTIONS.find((option) => option.value === popup.navigation?.type)?.label ?? "앱 화면";
}

function shortTitle(value: string) {
  return value.length > 36 ? `${value.slice(0, 36)}…` : value;
}

function PopupImage({
  file,
  imageUrl,
  alt,
}: {
  file: File | null;
  imageUrl: string | null;
  alt: string;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const sourceKey = file
    ? `${file.name}:${file.size}:${file.lastModified}`
    : imageUrl ?? "";
  const [failedSource, setFailedSource] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !imageRef.current) return;
    const previewUrl = URL.createObjectURL(file);
    imageRef.current.src = previewUrl;
    return () => URL.revokeObjectURL(previewUrl);
  }, [file]);

  if (!file && !imageUrl) {
    return (
      <div className={styles.imageFallback} role="img" aria-label={`${alt}: 등록된 이미지 없음`}>
        <ImageSquare size={30} aria-hidden="true" />
        <span>등록된 이미지가 없습니다.</span>
      </div>
    );
  }

  if (failedSource === sourceKey) {
    return (
      <div className={styles.imageFallback} role="img" aria-label={`${alt}: 이미지를 불러오지 못함`}>
        <ImageBroken size={30} aria-hidden="true" />
        <span>이미지를 불러올 수 없습니다.</span>
      </div>
    );
  }

  return (
    // Images can be served from arbitrary hosts returned by the operations API.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imageRef}
      src={file ? undefined : imageUrl ?? undefined}
      alt={alt}
      onError={() => setFailedSource(sourceKey)}
    />
  );
}

function ListSkeleton() {
  return (
    <div className={styles.listSkeleton} role="status" aria-label="팝업 목록을 불러오는 중">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

export default function ManagePopupsPage() {
  const [popups, setPopups] = useState<Popup[]>([]);
  const [listState, setListState] = useState<LoadState>("idle");
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<Popup | null>(null);
  const [detailState, setDetailState] = useState<LoadState>("ready");
  const [detailError, setDetailError] = useState("");
  const [form, setForm] = useState<PopupForm>({ ...emptyPopupForm });
  const [baseline, setBaseline] = useState(() => draftSignature(emptyPopupForm, null));
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imageError, setImageError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [busyAction, setBusyAction] = useState<BusyAction>("");
  const [toggleBusyId, setToggleBusyId] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [query, setQuery] = useState("");

  const listController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const mutationInProgress = useRef(false);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const editorRef = useRef<HTMLElement | null>(null);

  const isCreateMode = selected === null;
  const isBusy = Boolean(busyAction) || toggleBusyId !== null;
  const isDetailLocked = !isCreateMode && detailState !== "ready";
  const isDirty = draftSignature(form, imageFile) !== baseline;

  const filteredPopups = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    if (!normalizedQuery) return popups;
    return popups.filter((popup) => (
      popup.title.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
      popup.content.toLocaleLowerCase("ko-KR").includes(normalizedQuery) ||
      navigationLabel(popup).toLocaleLowerCase("ko-KR").includes(normalizedQuery)
    ));
  }, [popups, query]);

  const statusCounts = useMemo(() => ({
    ACTIVE: popups.filter((popup) => popup.status === "ACTIVE").length,
    SCHEDULED: popups.filter((popup) => popup.status === "SCHEDULED").length,
    INACTIVE: popups.filter((popup) => popup.status === "INACTIVE").length,
    EXPIRED: popups.filter((popup) => popup.status === "EXPIRED").length,
  }), [popups]);

  const clearImageInput = useCallback(() => {
    if (imageInputRef.current) imageInputRef.current.value = "";
  }, []);

  const cancelListLoad = useCallback(() => {
    if (!listController.current) return;
    listController.current.abort();
    listController.current = null;
    setListState("ready");
    setListError("");
  }, []);

  const focusEditor = useCallback((focusTitle = false) => {
    window.requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 1080px)").matches) {
        editorRef.current?.scrollIntoView({ block: "start" });
      }
      if (focusTitle) {
        document.getElementById("popup-title")?.focus();
      } else {
        editorRef.current?.focus();
      }
    });
  }, []);

  const enterCreateMode = useCallback((focusTitle = false) => {
    detailController.current?.abort();
    selectedIdRef.current = null;
    setSelected(null);
    setDetailState("ready");
    setDetailError("");
    const nextForm = { ...emptyPopupForm };
    setForm(nextForm);
    setImageFile(null);
    setImageError("");
    setFieldErrors({});
    setDeleteOpen(false);
    setBaseline(draftSignature(nextForm, null));
    clearImageInput();
    if (focusTitle) focusEditor(true);
  }, [clearImageInput, focusEditor]);

  const enterEditMode = useCallback((popup: Popup, reveal = false) => {
    selectedIdRef.current = popup.id;
    setSelected(popup);
    setDetailState("ready");
    setDetailError("");
    const nextForm = formFromPopup(popup);
    setForm(nextForm);
    setImageFile(null);
    setImageError("");
    setFieldErrors({});
    setDeleteOpen(false);
    setBaseline(draftSignature(nextForm, null));
    clearImageInput();
    if (reveal) focusEditor(false);
  }, [clearImageInput, focusEditor]);

  const loadPopups = useCallback(async () => {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setListState("loading");
    setListError("");

    try {
      const response = await apiFetch<unknown>(POPUP_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      const nextPopups = sortPopups(parsePopups(response));
      setPopups(nextPopups);
      setListState("ready");
    } catch (error) {
      if (controller.signal.aborted) return;
      setListState("error");
      setListError(popupErrorText(error));
    } finally {
      if (listController.current === controller) listController.current = null;
    }
  }, []);

  const loadPopupDetail = useCallback(async (summary: Popup, reveal = true) => {
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    selectedIdRef.current = summary.id;
    setSelected(summary);
    const summaryForm = formFromPopup(summary);
    setForm(summaryForm);
    setImageFile(null);
    setImageError("");
    setFieldErrors({});
    setBaseline(draftSignature(summaryForm, null));
    clearImageInput();
    setDetailState("loading");
    setDetailError("");
    if (reveal) focusEditor(false);

    try {
      const detail = parsePopup(await apiFetch<unknown>(`${POPUP_ENDPOINT}/${summary.id}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      }));
      if (controller.signal.aborted || selectedIdRef.current !== summary.id) return;
      enterEditMode(detail);
      setPopups((current) => sortPopups(
        current.map((popup) => popup.id === detail.id ? detail : popup),
      ));
    } catch (error) {
      if (controller.signal.aborted || selectedIdRef.current !== summary.id) return;
      if (error instanceof ApiError && error.status === 404) {
        enterCreateMode();
        setFeedback({
          tone: "info",
          title: "해당 팝업이 이미 삭제되었습니다.",
          message: "최신 목록을 다시 불러왔습니다.",
        });
        void loadPopups();
      } else {
        setDetailState("error");
        setDetailError(popupErrorText(error));
      }
    } finally {
      if (detailController.current === controller) detailController.current = null;
    }
  }, [clearImageInput, enterCreateMode, enterEditMode, focusEditor, loadPopups]);

  useEffect(() => {
    const handleSessionChange = () => {
      if (getAdminSession()) {
        void loadPopups();
        return;
      }

      listController.current?.abort();
      detailController.current?.abort();
      setPopups([]);
      setListState("idle");
      setListError("");
      setFeedback(null);
      enterCreateMode();
    };

    const timeoutId = window.setTimeout(handleSessionChange, 0);
    window.addEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
      listController.current?.abort();
      detailController.current?.abort();
    };
  }, [enterCreateMode, loadPopups]);

  function updateField<K extends keyof PopupForm>(key: K, value: PopupForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setFeedback(null);
  }

  function updateNavigationType(value: PopupForm["navigationType"]) {
    setForm((current) => ({
      ...current,
      navigationType: value,
      noticeId: "",
      noticeType: "ACADEMIC",
      clubId: "",
      externalUrl: "",
    }));
    setFieldErrors({});
    setFeedback(null);
  }

  function requestSelection(popup: Popup) {
    if (isBusy || selected?.id === popup.id) return;
    if (isDirty) {
      setPendingAction({ kind: "select", popup });
      return;
    }
    setFeedback(null);
    void loadPopupDetail(popup);
  }

  function requestCreateMode() {
    if (isBusy) return;
    if (isCreateMode && !isDirty) {
      focusEditor(true);
      return;
    }
    if (isDirty) {
      setPendingAction({ kind: "create" });
      return;
    }
    setFeedback(null);
    enterCreateMode(true);
  }

  function requestRefresh() {
    if (isBusy) return;
    if (isDirty) {
      setPendingAction({ kind: "refresh" });
      return;
    }
    setFeedback(null);
    void loadPopups();
  }

  function requestToggle(popup: Popup) {
    if (isBusy) return;
    if (selected?.id === popup.id && isDirty) {
      setPendingAction({ kind: "toggle", popup });
      return;
    }
    void togglePopup(popup);
  }

  function confirmPendingAction() {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    setFeedback(null);

    if (action.kind === "select") {
      void loadPopupDetail(action.popup);
      return;
    }
    if (action.kind === "create") {
      enterCreateMode(true);
      return;
    }
    if (action.kind === "toggle") {
      enterEditMode(action.popup);
      void togglePopup(action.popup);
      return;
    }
    if (selected) enterEditMode(selected);
    else enterCreateMode();
    void loadPopups();
  }

  function resetForm() {
    setFeedback(null);
    if (selected) enterEditMode(selected);
    else enterCreateMode(true);
  }

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    const error = validatePopupImage(file);
    if (error) {
      setImageFile(null);
      setForm((current) => current.imageAction === "REPLACE"
        ? { ...current, imageAction: "KEEP" }
        : current);
      setImageError(error);
      setFeedback(null);
      clearImageInput();
      return;
    }

    setImageFile(file);
    setImageError("");
    setFeedback(null);
    if (!isCreateMode) updateField("imageAction", "REPLACE");
  }

  function cancelSelectedImage() {
    setImageFile(null);
    setImageError("");
    clearImageInput();
    if (!isCreateMode) updateField("imageAction", "KEEP");
  }

  function removeImage() {
    setImageFile(null);
    setImageError("");
    clearImageInput();
    if (!isCreateMode) updateField("imageAction", "REMOVE");
  }

  function applyValidationErrors() {
    const validationForm = selected
      ? popupUpdateFormWithOriginalDateTimes(form, selected)
      : form;
    const result = validatePopupForm(validationForm, isCreateMode ? "create" : "update");
    if (result.payload) return result.payload;

    const field = result.field ?? "title";
    const message = result.message ?? "입력한 내용을 확인해 주세요.";
    setFieldErrors({ [field]: message });
    const fieldId = FIELD_IDS[field];
    if (fieldId) document.getElementById(fieldId)?.focus();
    return null;
  }

  async function submitPopup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationInProgress.current || isDetailLocked) return;

    setFeedback(null);
    const payload = applyValidationErrors();
    if (!payload) return;

    mutationInProgress.current = true;
    cancelListLoad();
    setBusyAction(isCreateMode ? "create" : "update");
    try {
      if (isCreateMode) {
        const body = createPopupMultipartBody(payload, imageFile ?? undefined);
        const created = parsePopup(await apiFetch<unknown>(POPUP_ENDPOINT, {
          method: "POST",
          body,
        }));
        enterEditMode(created);
        setPopups((current) => sortPopups([
          created,
          ...current.filter((popup) => popup.id !== created.id),
        ]));
        setFeedback({
          tone: "success",
          title: "팝업을 등록했습니다.",
          message: "새 팝업이 목록에 반영되었습니다.",
        });
        void loadPopups();
      } else if (selected) {
        const updatePayload = payload as AppPopupUpdateRequest;
        const body = updatePopupMultipartBody(updatePayload, imageFile ?? undefined);
        const updated = parsePopup(await apiFetch<unknown>(`${POPUP_ENDPOINT}/${selected.id}`, {
          method: "PUT",
          body,
        }));
        enterEditMode(updated);
        setPopups((current) => sortPopups(
          current.map((popup) => popup.id === updated.id ? updated : popup),
        ));
        setFeedback({
          tone: "success",
          title: "팝업을 수정했습니다.",
          message: `변경 내용을 저장했습니다. 현재 수정 버전은 ${updated.revision}입니다.`,
        });
        void loadPopups();
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        enterCreateMode();
        setFeedback({
          tone: "info",
          title: "해당 팝업이 이미 삭제되었습니다.",
          message: "최신 목록을 다시 불러왔습니다.",
        });
        void loadPopups();
      } else {
        setFeedback({
          tone: "error",
          title: isCreateMode ? "팝업을 등록하지 못했습니다." : "변경 내용을 저장하지 못했습니다.",
          message: popupErrorText(error),
        });
      }
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  async function togglePopup(popup: Popup) {
    if (toggleBusyId !== null || mutationInProgress.current) return;
    if (selectedIdRef.current === popup.id) {
      detailController.current?.abort();
      detailController.current = null;
      setDetailState("ready");
      setDetailError("");
    }
    mutationInProgress.current = true;
    cancelListLoad();
    setToggleBusyId(popup.id);
    setFeedback(null);
    const nextEnabled = !popup.enabled;

    try {
      const updated = parsePopup(await apiFetch<unknown>(`${POPUP_ENDPOINT}/${popup.id}/enabled`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled }),
      }));
      setPopups((current) => sortPopups(
        current.map((item) => item.id === updated.id ? updated : item),
      ));
      if (selectedIdRef.current === updated.id) enterEditMode(updated);
      setFeedback({
        tone: "success",
        title: nextEnabled ? "팝업을 활성화했습니다." : "팝업을 비활성화했습니다.",
        message: nextEnabled
          ? `현재 상태는 “${STATUS_LABELS[updated.status]}”입니다.`
          : "앱에서 더 이상 이 팝업을 노출하지 않습니다.",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        if (selectedIdRef.current === popup.id) enterCreateMode();
        setFeedback({
          tone: "info",
          title: "해당 팝업이 이미 삭제되었습니다.",
          message: "최신 목록을 다시 불러왔습니다.",
        });
        void loadPopups();
      } else {
        setFeedback({
          tone: "error",
          title: nextEnabled ? "팝업을 활성화하지 못했습니다." : "팝업을 비활성화하지 못했습니다.",
          message: popupErrorText(error),
        });
      }
    } finally {
      mutationInProgress.current = false;
      setToggleBusyId(null);
    }
  }

  async function deletePopup() {
    if (!selected || mutationInProgress.current) return;
    const target = selected;
    mutationInProgress.current = true;
    cancelListLoad();
    setBusyAction("delete");
    setFeedback(null);

    try {
      await apiFetch<null>(`${POPUP_ENDPOINT}/${target.id}`, { method: "DELETE" });
      setDeleteOpen(false);
      setPopups((current) => current.filter((popup) => popup.id !== target.id));
      enterCreateMode();
      setFeedback({
        tone: "success",
        title: "팝업을 삭제했습니다.",
        message: "연결된 서버 이미지가 있었다면 함께 정리됩니다.",
      });
      void loadPopups();
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        setDeleteOpen(false);
        enterCreateMode();
        setFeedback({
          tone: "info",
          title: "해당 팝업이 이미 삭제되었습니다.",
          message: "최신 목록을 다시 불러왔습니다.",
        });
        void loadPopups();
      } else {
        setDeleteOpen(false);
        setFeedback({
          tone: "error",
          title: "팝업을 삭제하지 못했습니다.",
          message: popupErrorText(error),
        });
      }
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  const displayedImageUrl = !isCreateMode && form.imageAction !== "REMOVE"
    ? selected?.imageUrl ?? null
    : null;
  const editorTitle = isCreateMode ? "새 팝업 작성" : "선택한 팝업 수정";

  return (
    <AdminLoginNotice returnTo="/popups/manage">
      <div className={styles.page}>
        <UnsavedChangesDialog dirty={isDirty} />

        <header className={styles.pageHeader}>
          <div>
            <h2>앱 시작 팝업</h2>
            <p>앱을 열 때 보여 줄 안내 내용, 이미지, 게시 기간과 클릭 이동을 관리합니다.</p>
          </div>
          <div className={styles.pageActions}>
            <button
              className={`${styles.button} ${styles.secondaryButton}`}
              type="button"
              onClick={requestRefresh}
              disabled={isBusy}
            >
              <ArrowClockwise size={17} aria-hidden="true" />
              목록 새로고침
            </button>
            <button
              className={`${styles.button} ${styles.primaryButton}`}
              type="button"
              onClick={requestCreateMode}
              disabled={isBusy}
            >
              <Plus size={17} weight="bold" aria-hidden="true" />
              새 팝업
            </button>
          </div>
        </header>

        <dl className={styles.summaryGrid} aria-label="팝업 상태 요약">
          <div>
            <dt>전체</dt>
            <dd>{listState === "idle" ? "-" : popups.length.toLocaleString("ko-KR")}</dd>
          </div>
          <div>
            <dt>현재 노출</dt>
            <dd>{statusCounts.ACTIVE.toLocaleString("ko-KR")}</dd>
          </div>
          <div>
            <dt>노출 예정</dt>
            <dd>{statusCounts.SCHEDULED.toLocaleString("ko-KR")}</dd>
          </div>
          <div>
            <dt>비활성 · 종료</dt>
            <dd>{(statusCounts.INACTIVE + statusCounts.EXPIRED).toLocaleString("ko-KR")}</dd>
          </div>
        </dl>

        {feedback && (
          <section
            className={`${styles.feedback} ${styles[`${feedback.tone}Feedback`]}`}
            role={feedback.tone === "error" ? "alert" : "status"}
          >
            {feedback.tone === "success"
              ? <CheckCircle size={21} weight="fill" aria-hidden="true" />
              : <WarningCircle size={21} weight="fill" aria-hidden="true" />}
            <div>
              <strong>{feedback.title}</strong>
              <p>{feedback.message}</p>
            </div>
            <button type="button" aria-label="안내 닫기" onClick={() => setFeedback(null)}>
              <X size={17} aria-hidden="true" />
            </button>
          </section>
        )}

        <div className={styles.workspace}>
          <section className={`${styles.panel} ${styles.listPanel}`} aria-labelledby="popup-list-title">
            <header className={styles.panelHeader}>
              <div>
                <span className={styles.panelIcon}><ImageSquare size={20} aria-hidden="true" /></span>
                <span>
                  <h3 id="popup-list-title">등록된 팝업</h3>
                  <p>항목을 선택하면 전체 내용을 확인하고 수정할 수 있습니다.</p>
                </span>
              </div>
              <span className={styles.countBadge}>{popups.length}개</span>
            </header>

            <div className={styles.searchField}>
              <MagnifyingGlass size={17} aria-hidden="true" />
              <label className="sr-only" htmlFor="popup-search">팝업 검색</label>
              <input
                id="popup-search"
                type="search"
                value={query}
                placeholder="제목, 내용, 이동 화면 검색"
                onChange={(event) => setQuery(event.target.value)}
              />
              {query && (
                <button type="button" aria-label="검색어 지우기" onClick={() => setQuery("")}>
                  <X size={15} aria-hidden="true" />
                </button>
              )}
            </div>

            {listError && (
              <div className={styles.inlineError} role="alert">
                <WarningCircle size={16} aria-hidden="true" />
                <span>{listError}</span>
                <button type="button" onClick={requestRefresh}>다시 시도</button>
              </div>
            )}

            <div className={styles.listBody}>
              {listState === "loading" && popups.length === 0 ? (
                <ListSkeleton />
              ) : filteredPopups.length === 0 ? (
                <div className={styles.emptyState}>
                  <ImageSquare size={31} aria-hidden="true" />
                  <strong>{query ? "검색 결과가 없습니다." : "등록된 팝업이 없습니다."}</strong>
                  <p>{query ? "다른 검색어로 확인해 주세요." : "새 팝업을 등록해 첫 안내를 만들어 보세요."}</p>
                  {!query && (
                    <button
                      className={`${styles.button} ${styles.primaryButton}`}
                      type="button"
                      onClick={requestCreateMode}
                    >
                      <Plus size={16} aria-hidden="true" />
                      새 팝업
                    </button>
                  )}
                </div>
              ) : (
                <ol className={styles.popupList}>
                  {filteredPopups.map((popup) => {
                    const active = selected?.id === popup.id;
                    const toggling = toggleBusyId === popup.id;
                    return (
                      <li key={popup.id} className={active ? styles.activeListItem : undefined}>
                        <button
                          className={styles.popupItem}
                          type="button"
                          aria-current={active ? "true" : undefined}
                          onClick={() => requestSelection(popup)}
                          disabled={isBusy}
                        >
                          <span className={styles.thumbnail}>
                            <PopupImage file={null} imageUrl={popup.imageUrl} alt={`${popup.title} 팝업 이미지`} />
                          </span>
                          <span className={styles.popupCopy}>
                            <span className={styles.popupTitleLine}>
                              <strong>{popup.title}</strong>
                              <span className={`${styles.statusBadge} ${styles[`status${popup.status}`]}`}>
                                {STATUS_LABELS[popup.status]}
                              </span>
                            </span>
                            <span className={styles.popupPreview}>{contentPreview(popup.content)}</span>
                            <span className={styles.popupMeta}>
                              <span><CalendarBlank size={13} aria-hidden="true" />{formatPeriod(popup)}</span>
                              <span><LinkSimple size={13} aria-hidden="true" />{navigationLabel(popup)}</span>
                              <span>순서 {popup.displayOrder}</span>
                            </span>
                          </span>
                          <NotePencil size={18} className={styles.editIcon} aria-hidden="true" />
                        </button>
                        <button
                          className={`${styles.toggleButton} ${popup.enabled ? styles.enabledToggle : ""}`}
                          type="button"
                          onClick={() => requestToggle(popup)}
                          disabled={isBusy}
                          aria-label={`${popup.title} 팝업 ${popup.enabled ? "비활성화" : "활성화"}`}
                        >
                          <Power size={15} weight="bold" aria-hidden="true" />
                          {toggling ? "변경 중" : popup.enabled ? "활성" : "비활성"}
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>

          <section
            ref={editorRef}
            className={`${styles.panel} ${styles.editorPanel}`}
            aria-labelledby="popup-editor-title"
            tabIndex={-1}
          >
            <header className={styles.editorHeader}>
              <div>
                <span className={styles.modeLabel}>{isCreateMode ? "새 팝업" : `수정 버전 ${selected.revision}`}</span>
                <h3 id="popup-editor-title">{editorTitle}</h3>
                <p>
                  {isCreateMode
                    ? "필수 내용과 노출 설정을 입력한 뒤 등록해 주세요."
                    : "내용, 이미지, 노출 기간과 클릭 이동을 한 번에 수정합니다."}
                </p>
              </div>
              {isDirty && <span className={styles.unsavedBadge}>저장 전 변경</span>}
            </header>

            {!isCreateMode && selected && (
              <dl className={styles.selectedMeta} aria-label="선택한 팝업 정보">
                <div>
                  <dt>현재 상태</dt>
                  <dd><span className={`${styles.statusBadge} ${styles[`status${selected.status}`]}`}>{STATUS_LABELS[selected.status]}</span></dd>
                </div>
                <div>
                  <dt>처음 등록</dt>
                  <dd>{formatLocalDateTime(selected.createdAt)}</dd>
                </div>
                <div>
                  <dt>최근 수정</dt>
                  <dd>{formatLocalDateTime(selected.updatedAt)}</dd>
                </div>
              </dl>
            )}

            {detailState === "loading" && (
              <div className={styles.detailNotice} role="status">
                <ArrowClockwise size={16} aria-hidden="true" />
                최신 상세 내용을 확인하고 있습니다.
              </div>
            )}
            {detailState === "error" && selected && (
              <div className={`${styles.detailNotice} ${styles.detailError}`} role="alert">
                <WarningCircle size={16} aria-hidden="true" />
                <span>{detailError}</span>
                <button type="button" onClick={() => void loadPopupDetail(selected, false)}>다시 시도</button>
              </div>
            )}

            <form className={styles.form} onSubmit={submitPopup} noValidate>
              <fieldset disabled={isBusy || isDetailLocked}>
                <section className={styles.formSection} aria-labelledby="popup-basic-section">
                  <header className={styles.sectionHeader}>
                    <span>01</span>
                    <div>
                      <h4 id="popup-basic-section">기본 내용</h4>
                      <p>제목과 본문은 앱에서 일반 텍스트와 줄바꿈으로 표시됩니다.</p>
                    </div>
                  </header>

                  <label className={styles.field} htmlFor="popup-title">
                    <span className={styles.fieldHeading}>
                      <span>제목 <em>필수</em></span>
                      <small>{form.title.length} / 200</small>
                    </span>
                    <input
                      id="popup-title"
                      name="title"
                      type="text"
                      value={form.title}
                      maxLength={200}
                      required
                      placeholder="예: 축제 기간 안내"
                      aria-invalid={Boolean(fieldErrors.title) || undefined}
                      aria-describedby={fieldErrors.title ? "popup-title-error" : undefined}
                      onChange={(event) => updateField("title", event.target.value)}
                    />
                    {fieldErrors.title && <small id="popup-title-error" className={styles.fieldError} role="alert">{fieldErrors.title}</small>}
                  </label>

                  <label className={styles.field} htmlFor="popup-content">
                    <span className={styles.fieldHeading}>
                      <span>본문 <em>필수</em></span>
                      <small>{form.content.length.toLocaleString("ko-KR")} / 100,000</small>
                    </span>
                    <textarea
                      id="popup-content"
                      name="content"
                      value={form.content}
                      maxLength={100_000}
                      required
                      placeholder={"이용자에게 전달할 안내 내용을 입력해 주세요.\n줄바꿈은 앱에서도 그대로 표시됩니다."}
                      aria-invalid={Boolean(fieldErrors.content) || undefined}
                      aria-describedby={fieldErrors.content ? "popup-content-error" : undefined}
                      onChange={(event) => updateField("content", event.target.value)}
                    />
                    {fieldErrors.content && <small id="popup-content-error" className={styles.fieldError} role="alert">{fieldErrors.content}</small>}
                  </label>
                </section>

                <section className={styles.formSection} aria-labelledby="popup-exposure-section">
                  <header className={styles.sectionHeader}>
                    <span>02</span>
                    <div>
                      <h4 id="popup-exposure-section">노출 설정</h4>
                      <p>활성 여부, 게시 기간과 여러 팝업이 함께 보일 때의 순서를 정합니다.</p>
                    </div>
                  </header>

                  <label className={styles.switchField}>
                    <input
                      name="enabled"
                      type="checkbox"
                      checked={form.enabled}
                      onChange={(event) => updateField("enabled", event.target.checked)}
                    />
                    <span className={styles.switchTrack} aria-hidden="true"><span /></span>
                    <span>
                      <strong>앱 노출 허용</strong>
                      <small>{form.enabled ? "설정한 기간에 맞춰 팝업을 노출합니다." : "기간과 관계없이 앱에 노출하지 않습니다."}</small>
                    </span>
                  </label>

                  <div className={styles.fieldGrid}>
                    <label className={styles.field} htmlFor="popup-starts-at">
                      <span className={styles.fieldHeading}><span>노출 시작</span></span>
                      <input
                        id="popup-starts-at"
                        name="startsAt"
                        type="datetime-local"
                        step="1"
                        value={form.startsAt}
                        aria-invalid={Boolean(fieldErrors.startsAt) || undefined}
                        aria-describedby={`popup-starts-at-help${fieldErrors.startsAt ? " popup-starts-at-error" : ""}`}
                        onChange={(event) => updateField("startsAt", event.target.value)}
                      />
                      <small id="popup-starts-at-help" className={styles.fieldHelp}>비워 두면 활성화 즉시 시작합니다.</small>
                      {fieldErrors.startsAt && <small id="popup-starts-at-error" className={styles.fieldError} role="alert">{fieldErrors.startsAt}</small>}
                    </label>

                    <label className={styles.field} htmlFor="popup-ends-at">
                      <span className={styles.fieldHeading}><span>노출 종료</span></span>
                      <input
                        id="popup-ends-at"
                        name="endsAt"
                        type="datetime-local"
                        step="1"
                        value={form.endsAt}
                        aria-invalid={Boolean(fieldErrors.endsAt) || undefined}
                        aria-describedby={`popup-ends-at-help${fieldErrors.endsAt ? " popup-ends-at-error" : ""}`}
                        onChange={(event) => updateField("endsAt", event.target.value)}
                      />
                      <small id="popup-ends-at-help" className={styles.fieldHelp}>비워 두면 종료 시각 없이 계속 노출합니다.</small>
                      {fieldErrors.endsAt && <small id="popup-ends-at-error" className={styles.fieldError} role="alert">{fieldErrors.endsAt}</small>}
                    </label>
                  </div>

                  <label className={`${styles.field} ${styles.orderField}`} htmlFor="popup-display-order">
                    <span className={styles.fieldHeading}><span>노출 순서 <em>필수</em></span></span>
                    <input
                      id="popup-display-order"
                      name="displayOrder"
                      type="number"
                      inputMode="numeric"
                      min="0"
                      max="9999"
                      step="1"
                      value={form.displayOrder}
                      required
                      aria-invalid={Boolean(fieldErrors.displayOrder) || undefined}
                      aria-describedby={`popup-display-order-help${fieldErrors.displayOrder ? " popup-display-order-error" : ""}`}
                      onChange={(event) => updateField("displayOrder", event.target.value)}
                    />
                    <small id="popup-display-order-help" className={styles.fieldHelp}>0부터 9,999 사이의 정수로 입력해 주세요.</small>
                    {fieldErrors.displayOrder && <small id="popup-display-order-error" className={styles.fieldError} role="alert">{fieldErrors.displayOrder}</small>}
                  </label>
                </section>

                <section className={styles.formSection} aria-labelledby="popup-navigation-section">
                  <header className={styles.sectionHeader}>
                    <span>03</span>
                    <div>
                      <h4 id="popup-navigation-section">클릭 이동</h4>
                      <p>팝업을 눌렀을 때 열 앱 화면이나 안전한 외부 웹페이지를 선택합니다.</p>
                    </div>
                  </header>

                  <label className={styles.field} htmlFor="popup-navigation-type">
                    <span className={styles.fieldHeading}><span>이동 대상 <em>필수</em></span></span>
                    <select
                      id="popup-navigation-type"
                      name="navigationType"
                      value={form.navigationType}
                      aria-invalid={Boolean(fieldErrors.navigationType) || undefined}
                      aria-describedby={`popup-navigation-help${fieldErrors.navigationType ? " popup-navigation-error" : ""}`}
                      onChange={(event) => updateNavigationType(event.target.value as PopupForm["navigationType"])}
                    >
                      {NAVIGATION_OPTIONS.map((option) => (
                        <option value={option.value} key={option.value || "none"}>{option.label}</option>
                      ))}
                    </select>
                    <small id="popup-navigation-help" className={styles.fieldHelp}>이동이 필요 없다면 “클릭 이동 없음”을 선택해 주세요.</small>
                    {fieldErrors.navigationType && <small id="popup-navigation-error" className={styles.fieldError} role="alert">{fieldErrors.navigationType}</small>}
                  </label>

                  {form.navigationType === "NOTICE_DETAIL" && (
                    <div className={styles.fieldGrid}>
                      <label className={styles.field} htmlFor="popup-notice-id">
                        <span className={styles.fieldHeading}><span>공지 번호 <em>필수</em></span></span>
                        <input
                          id="popup-notice-id"
                          name="noticeId"
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          value={form.noticeId}
                          required
                          placeholder="예: 123"
                          aria-invalid={Boolean(fieldErrors.noticeId) || undefined}
                          aria-describedby={fieldErrors.noticeId ? "popup-notice-id-error" : undefined}
                          onChange={(event) => updateField("noticeId", event.target.value)}
                        />
                        {fieldErrors.noticeId && <small id="popup-notice-id-error" className={styles.fieldError} role="alert">{fieldErrors.noticeId}</small>}
                      </label>
                      <label className={styles.field} htmlFor="popup-notice-type">
                        <span className={styles.fieldHeading}><span>공지 분류 <em>필수</em></span></span>
                        <select
                          id="popup-notice-type"
                          name="noticeType"
                          value={form.noticeType}
                          required
                          aria-invalid={Boolean(fieldErrors.noticeType) || undefined}
                          aria-describedby={fieldErrors.noticeType ? "popup-notice-type-error" : undefined}
                          onChange={(event) => updateField("noticeType", event.target.value as PopupForm["noticeType"])}
                        >
                          {NOTICE_TYPE_OPTIONS.map((option) => (
                            <option value={option.value} key={option.value}>{option.label}</option>
                          ))}
                        </select>
                        {fieldErrors.noticeType && <small id="popup-notice-type-error" className={styles.fieldError} role="alert">{fieldErrors.noticeType}</small>}
                      </label>
                    </div>
                  )}

                  {form.navigationType === "CLUB_DETAIL" && (
                    <label className={`${styles.field} ${styles.orderField}`} htmlFor="popup-club-id">
                      <span className={styles.fieldHeading}><span>동아리 번호 <em>필수</em></span></span>
                      <input
                        id="popup-club-id"
                        name="clubId"
                        type="number"
                        min="1"
                        step="1"
                        inputMode="numeric"
                        value={form.clubId}
                        required
                        placeholder="예: 10"
                        aria-invalid={Boolean(fieldErrors.clubId) || undefined}
                        aria-describedby={fieldErrors.clubId ? "popup-club-id-error" : undefined}
                        onChange={(event) => updateField("clubId", event.target.value)}
                      />
                      {fieldErrors.clubId && <small id="popup-club-id-error" className={styles.fieldError} role="alert">{fieldErrors.clubId}</small>}
                    </label>
                  )}

                  {form.navigationType === "EXTERNAL_URL" && (
                    <label className={styles.field} htmlFor="popup-external-url">
                      <span className={styles.fieldHeading}>
                        <span>외부 웹주소 <em>필수</em></span>
                        <small>{form.externalUrl.length.toLocaleString("ko-KR")} / 2,048</small>
                      </span>
                      <input
                        id="popup-external-url"
                        name="externalUrl"
                        type="url"
                        value={form.externalUrl}
                        maxLength={2048}
                        required
                        placeholder="https://www.hanseo.ac.kr"
                        aria-invalid={Boolean(fieldErrors.externalUrl) || undefined}
                        aria-describedby={`popup-external-url-help${fieldErrors.externalUrl ? " popup-external-url-error" : ""}`}
                        onChange={(event) => updateField("externalUrl", event.target.value)}
                      />
                      <small id="popup-external-url-help" className={styles.fieldHelp}>https://로 시작하는 주소만 사용할 수 있습니다.</small>
                      {fieldErrors.externalUrl && <small id="popup-external-url-error" className={styles.fieldError} role="alert">{fieldErrors.externalUrl}</small>}
                    </label>
                  )}
                </section>

                <section className={styles.formSection} aria-labelledby="popup-image-section">
                  <header className={styles.sectionHeader}>
                    <span>04</span>
                    <div>
                      <h4 id="popup-image-section">팝업 이미지</h4>
                      <p>이미지는 선택 사항이며 JPG, PNG, GIF 파일 한 장을 사용할 수 있습니다.</p>
                    </div>
                  </header>

                  <div className={styles.imageEditor}>
                    <div className={styles.imagePreview}>
                      <PopupImage
                        key={imageFile
                          ? `${imageFile.name}:${imageFile.size}:${imageFile.lastModified}`
                          : `${displayedImageUrl ?? "none"}:${form.imageAction}`}
                        file={imageFile}
                        imageUrl={displayedImageUrl}
                        alt={form.title.trim() ? `${form.title.trim()} 팝업 미리보기` : "팝업 이미지 미리보기"}
                      />
                    </div>
                    <div className={styles.imageControls}>
                      <div>
                        <strong>
                          {imageFile
                            ? imageFile.name
                            : form.imageAction === "REMOVE"
                              ? "저장하면 기존 이미지가 삭제됩니다."
                              : displayedImageUrl
                                ? "현재 등록된 이미지"
                                : "선택된 이미지 없음"}
                        </strong>
                        <p>
                          {imageFile
                            ? `${(imageFile.size / (1024 * 1024)).toFixed(2)} MB · 저장하면 이 이미지로 교체됩니다.`
                            : "파일당 최대 5 MiB까지 등록할 수 있습니다."}
                        </p>
                      </div>
                      <div className={styles.imageActions}>
                        <button
                          className={`${styles.button} ${styles.secondaryButton}`}
                          type="button"
                          aria-describedby={imageError ? "popup-image-error" : undefined}
                          onClick={() => imageInputRef.current?.click()}
                        >
                          <UploadSimple size={16} aria-hidden="true" />
                          {imageFile || displayedImageUrl ? "다른 이미지 선택" : "이미지 선택"}
                        </button>
                        {(imageFile || displayedImageUrl) && (
                          <button
                            className={`${styles.button} ${styles.secondaryButton}`}
                            type="button"
                            onClick={imageFile ? cancelSelectedImage : removeImage}
                          >
                            <X size={16} aria-hidden="true" />
                            {imageFile ? "선택 취소" : "이미지 삭제"}
                          </button>
                        )}
                        {!isCreateMode && form.imageAction === "REMOVE" && (
                          <button
                            className={`${styles.button} ${styles.secondaryButton}`}
                            type="button"
                            onClick={() => updateField("imageAction", "KEEP")}
                          >
                            삭제 취소
                          </button>
                        )}
                      </div>
                      <input
                        ref={imageInputRef}
                        hidden
                        id="popup-image"
                        name="image"
                        type="file"
                        accept={POPUP_IMAGE_ACCEPT}
                        onClick={(event) => {
                          event.currentTarget.value = "";
                        }}
                        onChange={chooseImage}
                      />
                      {imageError && <small id="popup-image-error" className={styles.fieldError} role="alert">{imageError}</small>}
                    </div>
                  </div>
                </section>
              </fieldset>

              <div className={styles.formActions}>
                {!isCreateMode && (
                  <button
                    className={`${styles.button} ${styles.dangerButton}`}
                    type="button"
                    onClick={() => setDeleteOpen(true)}
                    disabled={isBusy || isDetailLocked}
                  >
                    <Trash size={17} aria-hidden="true" />
                    팝업 삭제
                  </button>
                )}
                <span className={styles.actionSpacer} />
                <button
                  className={`${styles.button} ${styles.secondaryButton}`}
                  type="button"
                  onClick={resetForm}
                  disabled={isBusy || isDetailLocked || !isDirty}
                >
                  {isCreateMode ? "입력 지우기" : "변경 되돌리기"}
                </button>
                <button
                  className={`${styles.button} ${styles.primaryButton}`}
                  type="submit"
                  disabled={isBusy || isDetailLocked || (!isCreateMode && !isDirty)}
                >
                  {busyAction === "create"
                    ? "등록하는 중"
                    : busyAction === "update"
                      ? "저장하는 중"
                      : isCreateMode
                        ? "팝업 등록"
                        : "변경 저장"}
                </button>
              </div>
            </form>
          </section>
        </div>

        <ConfirmDialog
          open={deleteOpen}
          title={`“${shortTitle(selected?.title ?? "선택한 팝업")}”을 삭제할까요?`}
          description={isDirty
            ? "삭제하면 팝업과 저장하지 않은 변경 내용이 모두 사라지며 되돌릴 수 없습니다."
            : "삭제한 팝업과 연결 이미지는 다시 되돌릴 수 없습니다."}
          confirmLabel="팝업 삭제"
          danger
          busy={busyAction === "delete"}
          onCancel={() => {
            if (!isBusy) setDeleteOpen(false);
          }}
          onConfirm={deletePopup}
        />

        <ConfirmDialog
          open={Boolean(pendingAction)}
          title="저장하지 않은 변경 내용을 버릴까요?"
          description="계속하면 지금 입력하거나 선택한 내용이 사라집니다. 먼저 저장하려면 취소를 눌러 주세요."
          confirmLabel="변경 내용 버리기"
          danger
          onCancel={() => setPendingAction(null)}
          onConfirm={confirmPendingAction}
        />
      </div>
    </AdminLoginNotice>
  );
}
