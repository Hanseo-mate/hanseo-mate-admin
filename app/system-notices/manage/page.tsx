"use client";

import {
  ArrowClockwise,
  BellRinging,
  CheckCircle,
  FileText,
  NotePencil,
  Plus,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AdminLoginNotice } from "../../components/AdminLoginNotice";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { UnsavedChangesDialog } from "../../components/UnsavedChangesDialog";
import { ApiError, apiFetch, getErrorText } from "../../lib/api";
import { ADMIN_SESSION_EVENT, getAdminSession } from "../../lib/auth";
import {
  type SystemNotice,
  type SystemNoticeForm,
  emptySystemNoticeForm,
  formFromSystemNotice,
  parseSystemNotice,
  parseSystemNotices,
  sortSystemNotices,
  validateSystemNoticeForm,
} from "../../lib/system-notices";
import styles from "../system-notices.module.css";

type LoadState = "idle" | "loading" | "ready" | "error";
type BusyAction = "create" | "update" | "delete" | "";
type Feedback = {
  tone: "success" | "info" | "error";
  title: string;
  message: string;
};
type FieldErrors = Partial<Record<keyof SystemNoticeForm, string>>;
type PendingAction =
  | { kind: "select"; notice: SystemNotice }
  | { kind: "create" }
  | { kind: "refresh" }
  | null;
type LoadOptions = {
  selectId?: number | null;
};

const SYSTEM_NOTICE_ENDPOINT = "/api/admin/system-notices";
const emptyFormBaseline = JSON.stringify(emptySystemNoticeForm);
const dateTimeFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatDateTime(value: string) {
  const date = new Date(value.replace(/(\.\d{3})\d+$/, "$1"));
  return Number.isNaN(date.getTime()) ? "날짜 정보 없음" : dateTimeFormatter.format(date);
}

function contentPreview(content: string) {
  const preview = content.replace(/\s+/g, " ").trim();
  return preview || "내용을 확인해 주세요.";
}

function shortTitle(title: string) {
  return title.length > 34 ? `${title.slice(0, 34)}…` : title;
}

function fieldError(field: keyof SystemNoticeForm, value: string) {
  if (field === "title") {
    const title = value.trim();
    if (!title) return "공지 제목을 입력해 주세요.";
    if (title.length > 500) return "공지 제목은 500자 이하로 입력해 주세요.";
    return "";
  }

  if (!value.trim()) return "공지 내용을 입력해 주세요.";
  if (value.length > 100_000) return "공지 내용은 100,000자 이하로 입력해 주세요.";
  return "";
}

function systemNoticeErrorText(error: unknown) {
  if (error instanceof ApiError && (error.status === 400 || error.status === 422)) {
    return "입력한 제목과 내용을 다시 확인해 주세요.";
  }
  return getErrorText(error);
}

function ListLoadingState() {
  return (
    <div className={styles.loadingState} role="status" aria-label="시스템 공지 목록을 불러오는 중">
      <span />
      <span />
      <span />
    </div>
  );
}

export default function ManageSystemNoticesPage() {
  const [notices, setNotices] = useState<SystemNotice[]>([]);
  const [listState, setListState] = useState<LoadState>("idle");
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<SystemNotice | null>(null);
  const [form, setForm] = useState<SystemNoticeForm>({ ...emptySystemNoticeForm });
  const [baseline, setBaseline] = useState(emptyFormBaseline);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const listController = useRef<AbortController | null>(null);
  const mutationInProgress = useRef(false);
  const selectedIdRef = useRef<number | null>(null);
  const editorRef = useRef<HTMLElement | null>(null);
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const contentInputRef = useRef<HTMLTextAreaElement | null>(null);

  const isBusy = Boolean(busyAction);
  const isCreateMode = selected === null;
  const isDirty = JSON.stringify(form) !== baseline;
  const noticeCountLabel = listState === "ready" || notices.length > 0
    ? `${notices.length}개`
    : "-";
  const editorTitle = isCreateMode ? "새 시스템 공지 작성" : "선택한 공지 수정";

  const focusEditor = useCallback((focusTitle = false) => {
    window.requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 980px)").matches) {
        editorRef.current?.scrollIntoView({ block: "start" });
      }
      if (focusTitle) titleInputRef.current?.focus();
    });
  }, []);

  const enterCreateMode = useCallback((focusTitle = false) => {
    selectedIdRef.current = null;
    setSelected(null);
    setForm({ ...emptySystemNoticeForm });
    setBaseline(emptyFormBaseline);
    setFieldErrors({});
    setDeleteOpen(false);
    if (focusTitle) focusEditor(true);
  }, [focusEditor]);

  const enterEditMode = useCallback((notice: SystemNotice, reveal = false) => {
    const nextForm = formFromSystemNotice(notice);
    selectedIdRef.current = notice.id;
    setSelected(notice);
    setForm(nextForm);
    setBaseline(JSON.stringify(nextForm));
    setFieldErrors({});
    setDeleteOpen(false);
    if (reveal) focusEditor(false);
  }, [focusEditor]);

  const loadNotices = useCallback(async (options: LoadOptions = {}) => {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setListState("loading");
    setListError("");

    try {
      const response = await apiFetch<unknown>(SYSTEM_NOTICE_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      const nextNotices = sortSystemNotices(parseSystemNotices(response));
      setNotices(nextNotices);
      setListState("ready");

      const targetId = options.selectId === undefined
        ? selectedIdRef.current
        : options.selectId;
      if (targetId !== null) {
        const refreshed = nextNotices.find((notice) => notice.id === targetId);
        if (refreshed) {
          enterEditMode(refreshed);
        } else {
          enterCreateMode();
          setFeedback({
            tone: "info",
            title: "선택한 공지를 찾을 수 없습니다.",
            message: "최신 목록으로 정리했습니다. 새 공지를 작성하거나 다른 공지를 선택해 주세요.",
          });
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setListState("error");
      setListError(systemNoticeErrorText(error));
    } finally {
      if (listController.current === controller) listController.current = null;
    }
  }, [enterCreateMode, enterEditMode]);

  useEffect(() => {
    const handleSessionChange = () => {
      if (getAdminSession()) {
        void loadNotices({ selectId: null });
        return;
      }

      listController.current?.abort();
      setNotices([]);
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
    };
  }, [enterCreateMode, loadNotices]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [isDirty]);

  function updateField<K extends keyof SystemNoticeForm>(key: K, value: SystemNoticeForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => (
      current[key] ? { ...current, [key]: fieldError(key, value) } : current
    ));
    setFeedback(null);
  }

  function validateFieldOnBlur(field: keyof SystemNoticeForm) {
    const message = fieldError(field, form[field]);
    setFieldErrors((current) => ({ ...current, [field]: message }));
  }

  function requestSelection(notice: SystemNotice) {
    if (isBusy || selected?.id === notice.id) return;
    if (isDirty) {
      setPendingAction({ kind: "select", notice });
      return;
    }
    setFeedback(null);
    enterEditMode(notice, true);
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
    if (isBusy || listState === "loading") return;
    if (isDirty) {
      setPendingAction({ kind: "refresh" });
      return;
    }
    void loadNotices();
  }

  function confirmPendingAction() {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;

    setFeedback(null);
    if (action.kind === "select") {
      enterEditMode(action.notice, true);
      return;
    }
    if (action.kind === "create") {
      enterCreateMode(true);
      return;
    }

    if (selected) enterEditMode(selected);
    else enterCreateMode();
    void loadNotices();
  }

  function resetForm() {
    setFeedback(null);
    if (selected) enterEditMode(selected);
    else enterCreateMode(true);
  }

  function applyValidationErrors() {
    const result = validateSystemNoticeForm(form);
    if (result.payload) return result.payload;

    const nextErrors: FieldErrors = {};
    const titleMessage = fieldError("title", form.title);
    const contentMessage = fieldError("content", form.content);
    if (titleMessage) nextErrors.title = titleMessage;
    if (contentMessage) nextErrors.content = contentMessage;
    setFieldErrors(nextErrors);

    if (result.field === "title") titleInputRef.current?.focus();
    else if (result.field === "content") contentInputRef.current?.focus();
    return null;
  }

  async function submitNotice(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationInProgress.current) return;

    setFeedback(null);
    const payload = applyValidationErrors();
    if (!payload) return;

    mutationInProgress.current = true;
    setBusyAction(isCreateMode ? "create" : "update");
    try {
      if (isCreateMode) {
        const created = parseSystemNotice(await apiFetch<unknown>(SYSTEM_NOTICE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }));
        enterEditMode(created);
        setFeedback({
          tone: "success",
          title: "시스템 공지를 등록했습니다.",
          message: "새 공지가 목록에 반영되었습니다.",
        });
        await loadNotices({ selectId: created.id });
      } else if (selected) {
        const updated = parseSystemNotice(await apiFetch<unknown>(`${SYSTEM_NOTICE_ENDPOINT}/${selected.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }));
        enterEditMode(updated);
        setFeedback({
          tone: "success",
          title: "시스템 공지를 수정했습니다.",
          message: "변경한 제목과 내용이 저장되었습니다.",
        });
        await loadNotices({ selectId: updated.id });
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        enterCreateMode();
        setFeedback({
          tone: "info",
          title: "해당 공지가 이미 삭제되었습니다.",
          message: "최신 목록을 다시 불러왔습니다.",
        });
        await loadNotices({ selectId: null });
      } else {
        setFeedback({
          tone: "error",
          title: isCreateMode ? "시스템 공지를 등록하지 못했습니다." : "변경사항을 저장하지 못했습니다.",
          message: systemNoticeErrorText(error),
        });
      }
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  async function deleteNotice() {
    if (!selected || mutationInProgress.current) return;

    mutationInProgress.current = true;
    setBusyAction("delete");
    setFeedback(null);
    try {
      await apiFetch<void>(`${SYSTEM_NOTICE_ENDPOINT}/${selected.id}`, {
        method: "DELETE",
      });
      setDeleteOpen(false);
      enterCreateMode();
      setFeedback({
        tone: "success",
        title: "시스템 공지를 삭제했습니다.",
        message: "선택한 공지가 목록에서 삭제되었습니다.",
      });
      await loadNotices({ selectId: null });
    } catch (error) {
      setDeleteOpen(false);
      if (error instanceof ApiError && error.status === 404) {
        enterCreateMode();
        setFeedback({
          tone: "info",
          title: "해당 공지가 이미 삭제되었습니다.",
          message: "최신 목록을 다시 불러왔습니다.",
        });
        await loadNotices({ selectId: null });
      } else {
        setFeedback({
          tone: "error",
          title: "시스템 공지를 삭제하지 못했습니다.",
          message: systemNoticeErrorText(error),
        });
      }
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  return (
    <AdminLoginNotice returnTo="/system-notices/manage">
      <UnsavedChangesDialog dirty={isDirty} />

      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <h2>시스템 공지</h2>
            <p>한서메이트 이용자에게 전달할 안내를 작성하고 관리합니다.</p>
          </div>
          <div className={styles.pageActions}>
            <button
              className={`${styles.button} ${styles.secondaryButton}`}
              type="button"
              onClick={requestRefresh}
              disabled={isBusy || listState === "loading"}
            >
              <ArrowClockwise size={17} aria-hidden="true" />
              {listState === "loading" ? "불러오는 중" : "새로고침"}
            </button>
            <button
              className={`${styles.button} ${styles.primaryButton}`}
              type="button"
              onClick={requestCreateMode}
              disabled={isBusy}
            >
              <Plus size={17} aria-hidden="true" />
              새 공지
            </button>
          </div>
        </header>

        {feedback && (
          <div
            className={`${styles.feedback} ${styles[`${feedback.tone}Feedback`]}`}
            role={feedback.tone === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {feedback.tone === "success"
              ? <CheckCircle size={20} weight="fill" aria-hidden="true" />
              : <WarningCircle size={20} weight="fill" aria-hidden="true" />}
            <div>
              <strong>{feedback.title}</strong>
              <p>{feedback.message}</p>
            </div>
            <button type="button" aria-label="안내 닫기" onClick={() => setFeedback(null)}>
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        )}

        <div className={styles.workspace}>
          <section className={`${styles.panel} ${styles.listPanel}`} aria-labelledby="system-notice-list-title">
            <header className={styles.panelHeader}>
              <div>
                <span className={styles.panelIcon} aria-hidden="true"><BellRinging size={20} /></span>
                <div>
                  <h3 id="system-notice-list-title">공지 목록</h3>
                  <p>최근에 등록한 공지부터 표시됩니다.</p>
                </div>
              </div>
              <span className={styles.countBadge} aria-label={`등록된 시스템 공지 ${noticeCountLabel}`}>
                {noticeCountLabel}
              </span>
            </header>

            {listState === "error" && notices.length > 0 && (
              <div className={styles.inlineListError} role="alert">
                <WarningCircle size={18} aria-hidden="true" />
                <span>{listError}</span>
                <button type="button" onClick={() => void loadNotices()}>다시 시도</button>
              </div>
            )}

            <div
              className={styles.listBody}
              aria-live="polite"
              aria-busy={listState === "loading" || undefined}
            >
              {(listState === "idle" || listState === "loading") && notices.length === 0 ? (
                <ListLoadingState />
              ) : listState === "error" && notices.length === 0 ? (
                <div className={styles.statePanel} role="alert">
                  <WarningCircle size={27} aria-hidden="true" />
                  <strong>공지 목록을 불러오지 못했습니다.</strong>
                  <p>{listError}</p>
                  <button
                    className={`${styles.button} ${styles.secondaryButton}`}
                    type="button"
                    onClick={() => void loadNotices()}
                  >
                    다시 시도
                  </button>
                </div>
              ) : notices.length === 0 ? (
                <div className={styles.statePanel} role="status">
                  <FileText size={28} aria-hidden="true" />
                  <strong>등록된 시스템 공지가 없습니다.</strong>
                  <p>첫 공지를 작성해 이용자에게 필요한 안내를 전해 보세요.</p>
                  <button
                    className={`${styles.button} ${styles.primaryButton}`}
                    type="button"
                    onClick={requestCreateMode}
                  >
                    <Plus size={17} aria-hidden="true" />
                    첫 공지 작성
                  </button>
                </div>
              ) : (
                <ol className={styles.noticeList}>
                  {notices.map((notice) => {
                    const active = selected?.id === notice.id;
                    return (
                      <li key={notice.id}>
                        <button
                          className={`${styles.noticeItem} ${active ? styles.activeNoticeItem : ""}`}
                          type="button"
                          aria-pressed={active}
                          disabled={isBusy}
                          onClick={() => requestSelection(notice)}
                        >
                          <span className={styles.noticeCopy}>
                            <strong>{notice.title}</strong>
                            <span>{contentPreview(notice.content)}</span>
                            <time dateTime={notice.createdAt}>{formatDateTime(notice.createdAt)}</time>
                          </span>
                          <NotePencil className={styles.noticeEditIcon} size={18} aria-hidden="true" />
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
            aria-labelledby="system-notice-editor-title"
            tabIndex={-1}
          >
            <header className={styles.editorHeader}>
              <div>
                <span className={styles.modeLabel}>{isCreateMode ? "새 공지" : "공지 수정"}</span>
                <h3 id="system-notice-editor-title">{editorTitle}</h3>
                <p>
                  {isCreateMode
                    ? "제목과 내용을 입력한 뒤 등록해 주세요."
                    : "목록에서 선택한 공지의 제목과 내용을 바꿀 수 있습니다."}
                </p>
              </div>
              {isDirty && <span className={styles.unsavedBadge}>저장 전 변경</span>}
            </header>

            {!isCreateMode && selected && (
              <dl className={styles.noticeMeta} aria-label="선택한 공지의 등록 정보">
                <div>
                  <dt>처음 등록</dt>
                  <dd><time dateTime={selected.createdAt}>{formatDateTime(selected.createdAt)}</time></dd>
                </div>
                <div>
                  <dt>최근 수정</dt>
                  <dd><time dateTime={selected.updatedAt}>{formatDateTime(selected.updatedAt)}</time></dd>
                </div>
              </dl>
            )}

            <form className={styles.form} onSubmit={submitNotice} noValidate>
              <fieldset disabled={isBusy}>
                <label className={styles.field} htmlFor="system-notice-title">
                  <span className={styles.fieldHeading}>
                    <span>공지 제목 <em>필수</em></span>
                    <small>{form.title.length} / 500</small>
                  </span>
                  <input
                    ref={titleInputRef}
                    id="system-notice-title"
                    name="title"
                    type="text"
                    value={form.title}
                    maxLength={500}
                    placeholder="예: 서비스 점검 안내"
                    aria-invalid={Boolean(fieldErrors.title) || undefined}
                    aria-describedby={`system-notice-title-help${fieldErrors.title ? " system-notice-title-error" : ""}`}
                    onChange={(event) => updateField("title", event.target.value)}
                    onBlur={() => validateFieldOnBlur("title")}
                    required
                  />
                  <small id="system-notice-title-help" className={styles.fieldHelp}>
                    제목의 앞뒤 공백은 저장할 때 정리됩니다.
                  </small>
                  {fieldErrors.title && (
                    <small id="system-notice-title-error" className={styles.fieldError} role="alert">
                      {fieldErrors.title}
                    </small>
                  )}
                </label>

                <label className={styles.field} htmlFor="system-notice-content">
                  <span className={styles.fieldHeading}>
                    <span>공지 내용 <em>필수</em></span>
                    <small>{form.content.length.toLocaleString("ko-KR")} / 100,000</small>
                  </span>
                  <textarea
                    ref={contentInputRef}
                    id="system-notice-content"
                    name="content"
                    value={form.content}
                    maxLength={100_000}
                    placeholder={"이용자에게 전달할 내용을 입력해 주세요.\n줄을 나누거나 이모지를 입력해도 그대로 저장됩니다."}
                    aria-invalid={Boolean(fieldErrors.content) || undefined}
                    aria-describedby={`system-notice-content-help${fieldErrors.content ? " system-notice-content-error" : ""}`}
                    onChange={(event) => updateField("content", event.target.value)}
                    onBlur={() => validateFieldOnBlur("content")}
                    required
                  />
                  <small id="system-notice-content-help" className={styles.fieldHelp}>
                    입력한 줄바꿈과 이모지는 그대로 저장됩니다.
                  </small>
                  {fieldErrors.content && (
                    <small id="system-notice-content-error" className={styles.fieldError} role="alert">
                      {fieldErrors.content}
                    </small>
                  )}
                </label>
              </fieldset>

              <div className={styles.formActions}>
                {!isCreateMode && (
                  <button
                    className={`${styles.button} ${styles.dangerButton}`}
                    type="button"
                    onClick={() => setDeleteOpen(true)}
                    disabled={isBusy}
                  >
                    <Trash size={17} aria-hidden="true" />
                    공지 삭제
                  </button>
                )}
                <span className={styles.actionSpacer} />
                <button
                  className={`${styles.button} ${styles.secondaryButton}`}
                  type="button"
                  onClick={resetForm}
                  disabled={isBusy || !isDirty}
                >
                  {isCreateMode ? "입력 지우기" : "변경 되돌리기"}
                </button>
                <button
                  className={`${styles.button} ${styles.primaryButton}`}
                  type="submit"
                  disabled={isBusy || (!isCreateMode && !isDirty)}
                >
                  {busyAction === "create"
                    ? "등록하는 중"
                    : busyAction === "update"
                      ? "저장하는 중"
                      : isCreateMode
                        ? "공지 등록"
                        : "변경 저장"}
                </button>
              </div>
            </form>
          </section>
        </div>

        <ConfirmDialog
          open={deleteOpen}
          title={`“${shortTitle(selected?.title ?? "선택한 공지")}” 공지를 삭제할까요?`}
          description={isDirty
            ? "삭제하면 공지와 저장하지 않은 변경 내용이 모두 사라지며 되돌릴 수 없습니다."
            : "삭제한 공지는 다시 되돌릴 수 없습니다."}
          confirmLabel="공지 삭제"
          danger
          busy={busyAction === "delete"}
          onCancel={() => {
            if (!isBusy) setDeleteOpen(false);
          }}
          onConfirm={deleteNotice}
        />

        <ConfirmDialog
          open={Boolean(pendingAction)}
          title="저장하지 않은 변경 내용을 버릴까요?"
          description="계속하면 지금 입력한 내용이 사라집니다. 먼저 저장하려면 취소를 눌러 주세요."
          confirmLabel="변경 내용 버리기"
          danger
          onCancel={() => setPendingAction(null)}
          onConfirm={confirmPendingAction}
        />
      </div>
    </AdminLoginNotice>
  );
}
