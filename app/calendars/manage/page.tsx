"use client";

import {
  ArrowClockwise,
  CalendarBlank,
  CalendarDots,
  CaretLeft,
  CaretRight,
  CheckCircle,
  Clock,
  PencilSimple,
  Plus,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
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
import styles from "../calendar.module.css";

type CalendarItem = {
  id: number;
  startDate: string;
  endDate: string;
  title: string;
};

type CalendarForm = Pick<CalendarItem, "startDate" | "endDate" | "title">;
type LoadState = "idle" | "loading" | "ready" | "error";
type Feedback = { tone: "success" | "info" | "error"; title: string; message: string };
type EditorMode = "create" | "edit";
type PendingAction =
  | { kind: "select"; item: CalendarItem }
  | { kind: "refresh" }
  | { kind: "close-create" }
  | { kind: "close-edit" }
  | null;
type MonthView = { year: number; month: number };
type MonthDay = {
  dateKey: string;
  dayNumber: number;
  weekday: number;
  inCurrentMonth: boolean;
};

const CALENDAR_ENDPOINT = "/api/admin/calendars";
const emptyForm: CalendarForm = { startDate: "", endDate: "", title: "" };
const weekdayLabels = ["일", "월", "화", "수", "목", "금", "토"];
const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
  timeZone: "UTC",
});
const fullDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "long",
  timeZone: "UTC",
});
const monthFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  timeZone: "UTC",
});

function userFacingError(message: string) {
  const error = new Error(message);
  error.name = "UserFacingError";
  return error;
}

function getCalendarErrorText(error: unknown) {
  const message = getErrorText(error);
  return message === "입력한 내용이나 선택한 파일을 확인해 주세요."
    ? "입력한 날짜와 제목을 확인해 주세요."
    : message;
}

function isValidDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseCalendar(value: unknown): CalendarItem {
  if (!value || typeof value !== "object") {
    throw userFacingError("일정 정보를 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
  }

  const item = value as Partial<CalendarItem>;
  if (
    typeof item.id !== "number" ||
    !Number.isFinite(item.id) ||
    typeof item.startDate !== "string" ||
    typeof item.endDate !== "string" ||
    typeof item.title !== "string"
  ) {
    throw userFacingError("일정 정보를 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
  }

  return item as CalendarItem;
}

function sortCalendars(items: CalendarItem[]) {
  return [...items].sort((first, second) => (
    first.startDate.localeCompare(second.startDate) ||
    first.endDate.localeCompare(second.endDate) ||
    first.id - second.id
  ));
}

function parseCalendars(value: unknown) {
  if (!Array.isArray(value)) {
    throw userFacingError("일정 목록을 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
  }
  return sortCalendars(value.map(parseCalendar));
}

function formFromItem(item: CalendarItem): CalendarForm {
  return {
    startDate: item.startDate,
    endDate: item.endDate,
    title: item.title,
  };
}

function validateForm(form: CalendarForm): { payload?: CalendarForm; message?: string } {
  const title = form.title.trim();

  if (!title) return { message: "일정 제목을 입력해 주세요." };
  if (title.length > 500) return { message: "일정 제목은 500자 이하로 입력해 주세요." };
  if (!form.startDate || !form.endDate) return { message: "시작일과 종료일을 모두 선택해 주세요." };
  if (!isValidDate(form.startDate) || !isValidDate(form.endDate)) {
    return { message: "시작일과 종료일을 다시 확인해 주세요." };
  }
  if (form.endDate < form.startDate) {
    return { message: "종료일은 시작일과 같거나 그 이후여야 합니다." };
  }

  return {
    payload: {
      startDate: form.startDate,
      endDate: form.endDate,
      title,
    },
  };
}

function toUtcDate(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: string) {
  return isValidDate(value) ? dateFormatter.format(toUtcDate(value)) : "날짜 확인 필요";
}

function formatDateRange(startDate: string, endDate: string) {
  if (startDate === endDate) return formatDate(startDate);
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function utcDateKey(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function monthFromDate(date = new Date()): MonthView {
  return { year: date.getFullYear(), month: date.getMonth() };
}

function monthFromDateKey(value: string): MonthView {
  const date = toUtcDate(value);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

function moveMonth(view: MonthView, amount: number): MonthView {
  const date = new Date(Date.UTC(view.year, view.month + amount, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() };
}

function monthBounds(view: MonthView) {
  return {
    start: utcDateKey(view.year, view.month, 1),
    end: utcDateKey(view.year, view.month + 1, 0),
  };
}

function buildMonthDays(view: MonthView): MonthDay[] {
  const firstWeekday = new Date(Date.UTC(view.year, view.month, 1)).getUTCDay();
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(Date.UTC(view.year, view.month, index - firstWeekday + 1));
    return {
      dateKey: date.toISOString().slice(0, 10),
      dayNumber: date.getUTCDate(),
      weekday: date.getUTCDay(),
      inCurrentMonth: date.getUTCMonth() === view.month,
    };
  });
}

function eventsOnDay(items: CalendarItem[], dateKey: string) {
  return items.filter((item) => item.startDate <= dateKey && item.endDate >= dateKey);
}

function eventTiming(item: CalendarItem, todayKey: string) {
  if (item.endDate < todayKey) return "past";
  if (item.startDate <= todayKey) return "ongoing";
  return "upcoming";
}

function CalendarFields({
  form,
  disabled,
  prefix,
  errorMessage,
  onChange,
}: {
  form: CalendarForm;
  disabled: boolean;
  prefix: string;
  errorMessage: string;
  onChange: <K extends keyof CalendarForm>(key: K, value: CalendarForm[K]) => void;
}) {
  const titleError = errorMessage.includes("제목") ? errorMessage : "";
  const dateError = errorMessage && !titleError ? errorMessage : "";

  return (
    <fieldset className={styles.fieldset} disabled={disabled}>
      <div className={styles.dateFieldGrid}>
        <label className={styles.field} htmlFor={`${prefix}-start-date`}>
          <span className={styles.fieldLabel}>
            시작일 <em>필수</em>
          </span>
          <input
            className={styles.input}
            id={`${prefix}-start-date`}
            type="date"
            value={form.startDate}
            aria-invalid={Boolean(dateError) || undefined}
            onChange={(event) => onChange("startDate", event.target.value)}
            required
          />
        </label>

        <label className={styles.field} htmlFor={`${prefix}-end-date`}>
          <span className={styles.fieldLabel}>
            종료일 <em>필수</em>
          </span>
          <input
            className={styles.input}
            id={`${prefix}-end-date`}
            type="date"
            min={form.startDate || undefined}
            value={form.endDate}
            aria-invalid={Boolean(dateError) || undefined}
            onChange={(event) => onChange("endDate", event.target.value)}
            required
          />
        </label>
      </div>
      {dateError && <p className={styles.fieldError} role="alert">{dateError}</p>}

      <label className={styles.field} htmlFor={`${prefix}-title`}>
        <span className={styles.fieldLabel}>
          <span>일정 제목 <em>필수</em></span>
          <small className={form.title.length > 500 ? styles.limitOver : undefined}>
            {form.title.length} / 500
          </small>
        </span>
        <input
          className={styles.input}
          id={`${prefix}-title`}
          type="text"
          maxLength={500}
          value={form.title}
          placeholder="예: 2학기 개강총회"
          aria-invalid={Boolean(titleError) || undefined}
          onChange={(event) => onChange("title", event.target.value)}
          required
        />
        {titleError && <small className={styles.fieldError} role="alert">{titleError}</small>}
      </label>

      <p className={styles.formHint}>
        같은 날짜에 여러 일정을 등록하거나 기간이 겹치더라도 그대로 등록할 수 있습니다.
      </p>
    </fieldset>
  );
}

function CalendarEditorDialog({
  open,
  mode,
  form,
  dirty,
  busy,
  selectedDateRange,
  formError,
  feedback,
  onChange,
  onClose,
  onReset,
  onDelete,
  onSubmit,
}: {
  open: boolean;
  mode: EditorMode;
  form: CalendarForm;
  dirty: boolean;
  busy: boolean;
  selectedDateRange: string;
  formError: string;
  feedback: Feedback | null;
  onChange: <K extends keyof CalendarForm>(key: K, value: CalendarForm[K]) => void;
  onClose: () => void;
  onReset: () => void;
  onDelete: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  const dialogTitleId = `calendar-${mode}-dialog-title`;
  const dialogDescriptionId = `calendar-${mode}-dialog-description`;

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  useEffect(() => {
    if (!open) return;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const animationFrameId = window.requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (busyRef.current) return;
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusableElements = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );
      if (focusableElements.length === 0) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];
      const focusOutside = !dialogRef.current?.contains(document.activeElement);
      if (event.shiftKey && (document.activeElement === firstElement || focusOutside)) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && (document.activeElement === lastElement || focusOutside)) {
        event.preventDefault();
        firstElement.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(animationFrameId);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      const previousFocus = previousFocusRef.current;
      previousFocusRef.current = null;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  if (!open) return null;

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
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogTitleId}
        aria-describedby={dialogDescriptionId}
        aria-busy={busy || undefined}
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className={styles.dialogHeader}>
          <div className={styles.dialogHeading}>
            <span className={styles.dialogIcon} aria-hidden="true">
              {mode === "create" ? <Plus size={18} /> : <PencilSimple size={18} />}
            </span>
            <div>
              <div className={styles.dialogTitleLine}>
                <h2 id={dialogTitleId}>{mode === "create" ? "일정 등록" : "일정 수정"}</h2>
                {dirty && <span className={styles.unsavedBadge}>저장 안 된 변경</span>}
              </div>
              <p id={dialogDescriptionId}>
                {mode === "create"
                  ? "하루 일정은 시작일과 종료일을 같게 선택하세요."
                  : selectedDateRange}
              </p>
            </div>
          </div>
          <button
            className={styles.iconButton}
            type="button"
            aria-label="다이얼로그 닫기"
            onClick={onClose}
            disabled={busy}
          >
            <X size={18} />
          </button>
        </header>

        <form className={styles.dialogForm} noValidate onSubmit={onSubmit}>
          <div className={styles.dialogBody}>
            {feedback?.tone === "error" && (
              <div className={`${styles.inlineFeedback} ${styles.errorFeedback}`} role="alert">
                <WarningCircle size={18} aria-hidden="true" />
                <div>
                  <strong>{feedback.title}</strong>
                  <p>{feedback.message}</p>
                </div>
              </div>
            )}
            <CalendarFields
              form={form}
              disabled={busy}
              prefix={`calendar-${mode}`}
              errorMessage={formError}
              onChange={onChange}
            />
          </div>

          <footer className={styles.dialogFooter}>
            <div>
              {mode === "edit" && (
                <button
                  className={`${styles.button} ${styles.dangerButton}`}
                  type="button"
                  onClick={onDelete}
                  disabled={busy}
                >
                  <Trash size={17} aria-hidden="true" />
                  일정 삭제
                </button>
              )}
            </div>
            <div className={styles.dialogActions}>
              <button
                className={`${styles.button} ${styles.secondaryButton}`}
                type="button"
                onClick={onReset}
                disabled={busy || !dirty}
              >
                {mode === "create" ? "입력 지우기" : "변경 취소"}
              </button>
              <button
                className={`${styles.button} ${styles.secondaryButton}`}
                type="button"
                onClick={onClose}
                disabled={busy}
              >
                취소
              </button>
              <button
                className={`${styles.button} ${styles.primaryButton}`}
                type="submit"
                disabled={busy || (mode === "edit" && !dirty)}
              >
                {busy
                  ? mode === "create" ? "등록 중..." : "저장 중..."
                  : mode === "create" ? "일정 등록" : "변경 저장"}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}

function CalendarLoadingState() {
  return (
    <div className={styles.calendarSkeleton} role="status" aria-label="일정 달력 불러오는 중">
      {Array.from({ length: 42 }, (_, index) => <span key={index} />)}
    </div>
  );
}

function ListLoadingState() {
  return (
    <div className={styles.listSkeleton} role="status" aria-label="일정 목록 불러오는 중">
      {Array.from({ length: 5 }, (_, index) => (
        <div key={index}><span /><span /></div>
      ))}
    </div>
  );
}

export default function ManageCalendarPage() {
  const [calendars, setCalendars] = useState<CalendarItem[]>([]);
  const [listState, setListState] = useState<LoadState>("idle");
  const [listError, setListError] = useState("");
  const [createForm, setCreateForm] = useState<CalendarForm>({ ...emptyForm });
  const [selected, setSelected] = useState<CalendarItem | null>(null);
  const [editForm, setEditForm] = useState<CalendarForm>({ ...emptyForm });
  const [editBaseline, setEditBaseline] = useState(JSON.stringify(emptyForm));
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [formError, setFormError] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [editorMode, setEditorMode] = useState<EditorMode | null>(null);
  const [visibleMonth, setVisibleMonth] = useState<MonthView>(() => monthFromDate());
  const listController = useRef<AbortController | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const mutationInProgress = useRef(false);

  const todayKey = useMemo(() => toDateKey(new Date()), []);
  const isBusy = Boolean(busyAction);
  const isEditDirty = Boolean(selected) && JSON.stringify(editForm) !== editBaseline;
  const isCreateDirty = JSON.stringify(createForm) !== JSON.stringify(emptyForm);
  const selectedDateRange = useMemo(
    () => selected ? formatDateRange(selected.startDate, selected.endDate) : "",
    [selected],
  );
  const monthDays = useMemo(() => buildMonthDays(visibleMonth), [visibleMonth]);
  const bounds = useMemo(() => monthBounds(visibleMonth), [visibleMonth]);
  const monthCalendars = useMemo(
    () => calendars.filter((item) => item.startDate <= bounds.end && item.endDate >= bounds.start),
    [bounds, calendars],
  );
  const upcomingCalendars = useMemo(
    () => monthCalendars.filter((item) => item.endDate >= todayKey),
    [monthCalendars, todayKey],
  );
  const pastCalendars = useMemo(
    () => monthCalendars.filter((item) => item.endDate < todayKey),
    [monthCalendars, todayKey],
  );
  const allUpcomingCount = useMemo(
    () => calendars.filter((item) => item.endDate >= todayKey).length,
    [calendars, todayKey],
  );
  const monthTitle = monthFormatter.format(new Date(Date.UTC(visibleMonth.year, visibleMonth.month, 1)));

  const clearSelection = useCallback(() => {
    selectedIdRef.current = null;
    setSelected(null);
    setEditForm({ ...emptyForm });
    setEditBaseline(JSON.stringify(emptyForm));
    setFormError("");
    setDeleteOpen(false);
    setEditorMode(null);
  }, []);

  const loadCalendars = useCallback(async () => {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setListState("loading");
    setListError("");

    try {
      const response = await apiFetch<unknown>(CALENDAR_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      const nextCalendars = parseCalendars(response);
      setCalendars(nextCalendars);
      setListState("ready");

      const selectedId = selectedIdRef.current;
      if (selectedId !== null) {
        const refreshed = nextCalendars.find((item) => item.id === selectedId) ?? null;
        if (refreshed) {
          const nextForm = formFromItem(refreshed);
          setSelected(refreshed);
          setEditForm(nextForm);
          setEditBaseline(JSON.stringify(nextForm));
        } else {
          clearSelection();
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setListState("error");
      setListError(getCalendarErrorText(error));
    } finally {
      if (listController.current === controller) listController.current = null;
    }
  }, [clearSelection]);

  useEffect(() => {
    const handleSessionChange = () => {
      if (getAdminSession()) {
        void loadCalendars();
        return;
      }
      listController.current?.abort();
      setCalendars([]);
      setListState("idle");
      clearSelection();
    };

    const timeoutId = window.setTimeout(handleSessionChange, 0);
    window.addEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
      listController.current?.abort();
    };
  }, [clearSelection, loadCalendars]);

  useEffect(() => {
    if (!isEditDirty && !isCreateDirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [isCreateDirty, isEditDirty]);

  function setCreateField<K extends keyof CalendarForm>(key: K, value: CalendarForm[K]) {
    setCreateForm((current) => ({ ...current, [key]: value }));
    setFormError("");
    setFeedback(null);
  }

  function setEditField<K extends keyof CalendarForm>(key: K, value: CalendarForm[K]) {
    setEditForm((current) => ({ ...current, [key]: value }));
    setFormError("");
    setFeedback(null);
  }

  function openCreateDialog() {
    setCreateForm({ ...emptyForm });
    setFormError("");
    setFeedback(null);
    setEditorMode("create");
  }

  function selectItem(item: CalendarItem) {
    const nextForm = formFromItem(item);
    selectedIdRef.current = item.id;
    setSelected(item);
    setEditForm(nextForm);
    setEditBaseline(JSON.stringify(nextForm));
    setFormError("");
    setFeedback(null);
    setEditorMode("edit");
  }

  function requestSelection(item: CalendarItem) {
    if (selected?.id === item.id && !isEditDirty) {
      setEditorMode("edit");
      return;
    }
    if (isEditDirty) {
      setPendingAction({ kind: "select", item });
      return;
    }
    selectItem(item);
  }

  function requestRefresh() {
    if (isEditDirty || isCreateDirty) {
      setPendingAction({ kind: "refresh" });
      return;
    }
    void loadCalendars();
  }

  function requestDialogClose() {
    if (editorMode === "create" && isCreateDirty) {
      setPendingAction({ kind: "close-create" });
      return;
    }
    if (editorMode === "edit" && isEditDirty) {
      setPendingAction({ kind: "close-edit" });
      return;
    }
    setFormError("");
    setFeedback(null);
    setEditorMode(null);
  }

  function confirmPendingAction() {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    if (action.kind === "select") {
      selectItem(action.item);
      return;
    }
    if (action.kind === "close-create") {
      setCreateForm({ ...emptyForm });
      setFormError("");
      setFeedback(null);
      setEditorMode(null);
      return;
    }
    if (action.kind === "close-edit") {
      resetEditForm();
      setEditorMode(null);
      return;
    }
    setCreateForm({ ...emptyForm });
    setEditorMode(null);
    void loadCalendars();
  }

  async function createCalendar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationInProgress.current) return;

    setFeedback(null);
    setFormError("");
    const { payload, message } = validateForm(createForm);
    if (!payload) {
      const errorMessage = message ?? "입력한 날짜와 제목을 확인해 주세요.";
      setFormError(errorMessage);
      setFeedback({ tone: "error", title: "새 일정을 등록할 수 없습니다.", message: errorMessage });
      return;
    }

    mutationInProgress.current = true;
    setBusyAction("create");
    try {
      const created = parseCalendar(await apiFetch<unknown>(CALENDAR_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }));
      setCalendars((current) => sortCalendars([...current.filter((item) => item.id !== created.id), created]));
      setListState("ready");
      setCreateForm({ ...emptyForm });
      setVisibleMonth(monthFromDateKey(created.startDate));
      setEditorMode(null);
      setFeedback({ tone: "success", title: "새 일정을 등록했습니다.", message: "해당 월과 일정 목록에 바로 반영되었습니다." });
    } catch (error) {
      setFeedback({ tone: "error", title: "새 일정을 등록하지 못했습니다.", message: getCalendarErrorText(error) });
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  async function updateCalendar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || mutationInProgress.current || !isEditDirty) return;

    setFeedback(null);
    setFormError("");
    const { payload, message } = validateForm(editForm);
    if (!payload) {
      const errorMessage = message ?? "입력한 날짜와 제목을 확인해 주세요.";
      setFormError(errorMessage);
      setFeedback({ tone: "error", title: "수정 사항을 저장할 수 없습니다.", message: errorMessage });
      return;
    }

    mutationInProgress.current = true;
    setBusyAction("save");
    try {
      const updated = parseCalendar(await apiFetch<unknown>(`${CALENDAR_ENDPOINT}/${selected.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }));
      const savedForm = formFromItem(updated);
      setCalendars((current) => sortCalendars(current.map((item) => item.id === updated.id ? updated : item)));
      setSelected(updated);
      setEditForm(savedForm);
      setEditBaseline(JSON.stringify(savedForm));
      setVisibleMonth(monthFromDateKey(updated.startDate));
      setEditorMode(null);
      setFeedback({ tone: "success", title: "일정을 수정했습니다.", message: "변경한 날짜와 제목이 바로 반영되었습니다." });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        clearSelection();
        setFeedback({ tone: "info", title: "일정이 이미 삭제되었습니다.", message: "최신 목록을 다시 불러오겠습니다." });
        void loadCalendars();
      } else {
        setFeedback({ tone: "error", title: "일정을 수정하지 못했습니다.", message: getCalendarErrorText(error) });
      }
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  async function deleteCalendar() {
    if (!selected || mutationInProgress.current) return;
    const target = selected;

    mutationInProgress.current = true;
    setBusyAction("delete");
    setFeedback(null);
    try {
      await apiFetch<void>(`${CALENDAR_ENDPOINT}/${target.id}`, { method: "DELETE" });
      setCalendars((current) => current.filter((item) => item.id !== target.id));
      clearSelection();
      setFeedback({ tone: "success", title: "일정을 삭제했습니다.", message: "선택한 일정이 목록에서 삭제되었습니다." });
    } catch (error) {
      setDeleteOpen(false);
      if (error instanceof ApiError && error.status === 404) {
        clearSelection();
        setFeedback({ tone: "info", title: "일정이 이미 삭제되었습니다.", message: "최신 목록을 다시 불러오겠습니다." });
        void loadCalendars();
      } else {
        setFeedback({ tone: "error", title: "일정을 삭제하지 못했습니다.", message: getCalendarErrorText(error) });
      }
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  function resetEditForm() {
    if (!selected) return;
    const nextForm = formFromItem(selected);
    setEditForm(nextForm);
    setFormError("");
    setFeedback(null);
  }

  function renderListGroup(title: string, items: CalendarItem[], tone: "upcoming" | "past") {
    if (items.length === 0) return null;
    return (
      <section className={styles.listGroup} aria-labelledby={`calendar-${tone}-title`}>
        <header className={styles.listGroupHeader}>
          <h3 id={`calendar-${tone}-title`}>{title}</h3>
          <span>{items.length}개</span>
        </header>
        <div className={styles.eventList}>
          {items.map((item) => {
            const timing = eventTiming(item, todayKey);
            return (
              <button
                className={`${styles.listItem} ${selected?.id === item.id ? styles.selectedListItem : ""}`}
                type="button"
                key={item.id}
                aria-label={`${item.title}, ${formatDateRange(item.startDate, item.endDate)}, 수정`}
                onClick={() => requestSelection(item)}
                disabled={isBusy}
              >
                <span className={styles.listDate} aria-hidden="true">
                  <CalendarBlank size={17} />
                </span>
                <span className={styles.listItemCopy}>
                  <strong>{item.title}</strong>
                  <small>{formatDateRange(item.startDate, item.endDate)}</small>
                </span>
                <span className={`${styles.timingBadge} ${styles[`${timing}Badge`]}`}>
                  {timing === "past" ? "지난 일정" : timing === "ongoing" ? "진행 중" : "예정"}
                </span>
                <PencilSimple className={styles.listEditIcon} size={16} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <AdminLoginNotice returnTo="/calendars/manage">
      <UnsavedChangesDialog dirty={isCreateDirty || isEditDirty} />
      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <h2>학생회 일정</h2>
            <p>학사 일정과 행사를 월별로 확인하고 수정합니다.</p>
          </div>
          <div className={styles.pageHeaderActions}>
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
              onClick={openCreateDialog}
              disabled={isBusy}
            >
              <Plus size={17} aria-hidden="true" />
              일정 등록
            </button>
          </div>
        </header>

        <dl className={styles.summaryBar} aria-label="일정 현황">
          <div><dt>전체 일정</dt><dd>{listState === "ready" ? `${calendars.length}개` : "-"}</dd></div>
          <div><dt>예정 일정</dt><dd>{listState === "ready" ? `${allUpcomingCount}개` : "-"}</dd></div>
          <div><dt>{monthTitle}</dt><dd>{listState === "ready" ? `${monthCalendars.length}개` : "-"}</dd></div>
        </dl>

        {feedback && !editorMode && (
          <div
            className={`${styles.feedback} ${styles[`${feedback.tone}Feedback`]}`}
            role={feedback.tone === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {feedback.tone === "success"
              ? <CheckCircle size={19} aria-hidden="true" />
              : <WarningCircle size={19} aria-hidden="true" />}
            <div>
              <strong>{feedback.title}</strong>
              <p>{feedback.message}</p>
            </div>
            <button className={styles.feedbackClose} type="button" aria-label="안내 닫기" onClick={() => setFeedback(null)}>
              <X size={16} />
            </button>
          </div>
        )}

        <div className={styles.workspace}>
          <section className={styles.calendarPanel} aria-labelledby="calendar-month-title">
            <header className={styles.panelHeader}>
              <div>
                <span className={styles.panelIcon} aria-hidden="true"><CalendarDots size={19} /></span>
                <div>
                  <h3 id="calendar-month-title">{monthTitle}</h3>
                  <p>날짜별 일정 분포와 기간을 한눈에 확인하세요.</p>
                </div>
              </div>
              <div className={styles.monthControls}>
                <button
                  className={styles.iconButton}
                  type="button"
                  aria-label="이전 달"
                  onClick={() => setVisibleMonth((current) => moveMonth(current, -1))}
                >
                  <CaretLeft size={18} />
                </button>
                <button
                  className={`${styles.button} ${styles.compactButton}`}
                  type="button"
                  onClick={() => setVisibleMonth(monthFromDate())}
                >
                  오늘
                </button>
                <button
                  className={styles.iconButton}
                  type="button"
                  aria-label="다음 달"
                  onClick={() => setVisibleMonth((current) => moveMonth(current, 1))}
                >
                  <CaretRight size={18} />
                </button>
              </div>
            </header>

            <div className={styles.calendarBody} aria-busy={listState === "loading" || undefined}>
              {listState === "idle" || listState === "loading" ? (
                <CalendarLoadingState />
              ) : listState === "error" ? (
                <div className={styles.errorState} role="alert">
                  <WarningCircle size={24} aria-hidden="true" />
                  <strong>일정을 불러오지 못했습니다.</strong>
                  <p>{listError}</p>
                  <button className={`${styles.button} ${styles.secondaryButton}`} type="button" onClick={() => void loadCalendars()}>
                    다시 시도
                  </button>
                </div>
              ) : (
                <div className={styles.calendarScroller}>
                  <div className={styles.calendarInner}>
                    <div className={styles.weekdayRow} role="row">
                      {weekdayLabels.map((label, index) => (
                        <span className={index === 0 ? styles.sunday : undefined} role="columnheader" key={label}>{label}</span>
                      ))}
                    </div>
                    <div className={styles.calendarGrid} role="grid" aria-label={`${monthTitle} 일정 달력`}>
                      {monthDays.map((day) => {
                        const dayEvents = eventsOnDay(monthCalendars, day.dateKey);
                        const visibleEvents = dayEvents.slice(0, 3);
                        const isToday = day.dateKey === todayKey;
                        return (
                          <div
                            className={`${styles.calendarCell} ${!day.inCurrentMonth ? styles.outsideMonth : ""} ${isToday ? styles.todayCell : ""}`}
                            role="gridcell"
                            aria-label={`${fullDateFormatter.format(toUtcDate(day.dateKey))}, 일정 ${dayEvents.length}개`}
                            key={day.dateKey}
                          >
                            <time
                              className={`${styles.dayNumber} ${day.weekday === 0 ? styles.sunday : ""} ${isToday ? styles.todayNumber : ""}`}
                              dateTime={day.dateKey}
                              aria-current={isToday ? "date" : undefined}
                            >
                              {day.dayNumber}
                            </time>
                            <div className={styles.dayEvents}>
                              {visibleEvents.map((item) => {
                                const timing = eventTiming(item, todayKey);
                                return (
                                  <button
                                    className={`${styles.dayEvent} ${timing === "past" ? styles.pastDayEvent : ""} ${selected?.id === item.id ? styles.selectedDayEvent : ""}`}
                                    type="button"
                                    key={item.id}
                                    title={`${item.title} (${formatDateRange(item.startDate, item.endDate)})`}
                                    aria-label={`${item.title}, ${formatDateRange(item.startDate, item.endDate)}, 수정`}
                                    onClick={() => requestSelection(item)}
                                  >
                                    {item.title}
                                  </button>
                                );
                              })}
                              {dayEvents.length > visibleEvents.length && (
                                <span className={styles.moreEvents}>+{dayEvents.length - visibleEvents.length}개 더 있음</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside className={styles.listPanel} aria-labelledby="calendar-list-title">
            <header className={styles.listHeader}>
              <div>
                <h3 id="calendar-list-title">{monthTitle} 일정</h3>
                <p>일정을 누르면 수정 화면을 열 수 있습니다.</p>
              </div>
              <span className={styles.countBadge} aria-live="polite">
                {listState === "ready" ? `${monthCalendars.length}개` : "-"}
              </span>
            </header>

            <div className={styles.listBody} aria-live="polite" aria-busy={listState === "loading" || undefined}>
              {listState === "idle" || listState === "loading" ? (
                <ListLoadingState />
              ) : listState === "error" ? (
                <div className={styles.compactErrorState} role="alert">
                  <WarningCircle size={22} aria-hidden="true" />
                  <strong>목록을 확인할 수 없습니다.</strong>
                  <button type="button" onClick={() => void loadCalendars()}>다시 시도</button>
                </div>
              ) : monthCalendars.length === 0 ? (
                <div className={styles.emptyState} role="status">
                  <span aria-hidden="true"><CalendarBlank size={24} /></span>
                  <strong>이 달에 등록된 일정이 없습니다.</strong>
                  <p>필요한 일정을 등록하거나 다른 달을 확인해 보세요.</p>
                  <button className={`${styles.button} ${styles.primaryButton}`} type="button" onClick={openCreateDialog}>
                    <Plus size={17} aria-hidden="true" />
                    일정 등록
                  </button>
                </div>
              ) : (
                <div className={styles.groupedList}>
                  {renderListGroup("예정 및 진행 중", upcomingCalendars, "upcoming")}
                  {renderListGroup("지난 일정", pastCalendars, "past")}
                </div>
              )}
            </div>

            <footer className={styles.listFooter}>
              <Clock size={16} aria-hidden="true" />
              <span>예정과 지난 일정은 종료일을 기준으로 구분합니다.</span>
            </footer>
          </aside>
        </div>

        <CalendarEditorDialog
          open={Boolean(editorMode) && !deleteOpen && !pendingAction}
          mode={editorMode ?? "create"}
          form={editorMode === "edit" ? editForm : createForm}
          dirty={editorMode === "edit" ? isEditDirty : isCreateDirty}
          busy={isBusy}
          selectedDateRange={selectedDateRange}
          formError={formError}
          feedback={feedback}
          onChange={editorMode === "edit" ? setEditField : setCreateField}
          onClose={requestDialogClose}
          onReset={() => {
            if (editorMode === "edit") resetEditForm();
            else {
              setCreateForm({ ...emptyForm });
              setFormError("");
              setFeedback(null);
            }
          }}
          onDelete={() => setDeleteOpen(true)}
          onSubmit={editorMode === "edit" ? updateCalendar : createCalendar}
        />

        <ConfirmDialog
          open={deleteOpen}
          title={`“${selected?.title && selected.title.length > 30 ? `${selected.title.slice(0, 30)}…` : selected?.title ?? "선택한 일정"}” 일정을 삭제할까요?`}
          description={`${selectedDateRange || "선택한 일정"}. 삭제한 일정은 다시 되돌릴 수 없습니다.`}
          confirmLabel="일정 삭제"
          danger
          busy={busyAction === "delete"}
          onCancel={() => {
            if (!isBusy) setDeleteOpen(false);
          }}
          onConfirm={deleteCalendar}
        />

        <ConfirmDialog
          open={Boolean(pendingAction)}
          title="저장하지 안은 변경을 버릴까요?"
          description="지금 입력한 내용은 사라집니다. 계속하려면 취소를 누르세요."
          confirmLabel="변경 버리기"
          busy={false}
          onCancel={() => setPendingAction(null)}
          onConfirm={confirmPendingAction}
        />
      </div>
    </AdminLoginNotice>
  );
}
