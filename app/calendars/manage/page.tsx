"use client";

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
import { apiFetch, getErrorText } from "../../lib/api";
import { ADMIN_SESSION_EVENT, getAdminSession } from "../../lib/auth";

type CalendarItem = {
  id: number;
  startDate: string;
  endDate: string;
  title: string;
};

type CalendarForm = Pick<CalendarItem, "startDate" | "endDate" | "title">;
type LoadState = "idle" | "loading" | "ready" | "error";
type Feedback = { tone: "success" | "error"; title: string; message: string };
type PendingAction =
  | { kind: "select"; item: CalendarItem }
  | { kind: "refresh" }
  | null;

const CALENDAR_ENDPOINT = "/api/admin/calendars";
const emptyForm: CalendarForm = { startDate: "", endDate: "", title: "" };
const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  weekday: "short",
  timeZone: "UTC",
});
const shortDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  weekday: "short",
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

function formatShortDate(value: string) {
  return isValidDate(value) ? shortDateFormatter.format(toUtcDate(value)) : "날짜 확인 필요";
}

function formatDateRange(startDate: string, endDate: string) {
  if (startDate === endDate) return formatDate(startDate);
  return `${formatDate(startDate)} - ${formatDate(endDate)}`;
}

function CalendarFields({
  form,
  disabled,
  prefix,
  onChange,
}: {
  form: CalendarForm;
  disabled: boolean;
  prefix: string;
  onChange: <K extends keyof CalendarForm>(key: K, value: CalendarForm[K]) => void;
}) {
  return (
    <fieldset className="editor-fieldset" disabled={disabled}>
      <div className="calendar-form">
        <div className="calendar-date-grid">
          <label className="field-group" htmlFor={`${prefix}-start-date`}>
            <span className="field-label">시작일 <em>필수</em></span>
            <input
              id={`${prefix}-start-date`}
              type="date"
              value={form.startDate}
              onChange={(event) => onChange("startDate", event.target.value)}
              required
            />
          </label>

          <label className="field-group" htmlFor={`${prefix}-end-date`}>
            <span className="field-label">종료일 <em>필수</em></span>
            <input
              id={`${prefix}-end-date`}
              type="date"
              min={form.startDate || undefined}
              value={form.endDate}
              onChange={(event) => onChange("endDate", event.target.value)}
              required
            />
          </label>
        </div>

        <label className="field-group" htmlFor={`${prefix}-title`}>
          <span className="field-label">
            일정 제목 <em>필수</em>
            <small className={`calendar-character-count ${form.title.length > 500 ? "limit-over" : ""}`}>
              {form.title.length} / 500
            </small>
          </span>
          <input
            id={`${prefix}-title`}
            type="text"
            maxLength={500}
            value={form.title}
            placeholder="예: 2학기 개강총회"
            onChange={(event) => onChange("title", event.target.value)}
            required
          />
        </label>

      </div>
    </fieldset>
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
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const listController = useRef<AbortController | null>(null);
  const selectedIdRef = useRef<number | null>(null);
  const mutationInProgress = useRef(false);
  const editorRef = useRef<HTMLElement | null>(null);

  const isBusy = Boolean(busyAction);
  const isEditDirty = Boolean(selected) && JSON.stringify(editForm) !== editBaseline;
  const isCreateDirty = JSON.stringify(createForm) !== JSON.stringify(emptyForm);

  const selectedDateRange = useMemo(
    () => selected ? formatDateRange(selected.startDate, selected.endDate) : "",
    [selected],
  );

  const clearSelection = useCallback(() => {
    selectedIdRef.current = null;
    setSelected(null);
    setEditForm({ ...emptyForm });
    setEditBaseline(JSON.stringify(emptyForm));
    setDeleteOpen(false);
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
    setFeedback(null);
  }

  function setEditField<K extends keyof CalendarForm>(key: K, value: CalendarForm[K]) {
    setEditForm((current) => ({ ...current, [key]: value }));
    setFeedback(null);
  }

  function selectItem(item: CalendarItem) {
    const nextForm = formFromItem(item);
    selectedIdRef.current = item.id;
    setSelected(item);
    setEditForm(nextForm);
    setEditBaseline(JSON.stringify(nextForm));
    setFeedback(null);

    window.requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 900px)").matches) {
        editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  function requestSelection(item: CalendarItem) {
    if (selected?.id === item.id) return;
    if (isEditDirty) {
      setPendingAction({ kind: "select", item });
      return;
    }
    selectItem(item);
  }

  function requestRefresh() {
    if (isEditDirty) {
      setPendingAction({ kind: "refresh" });
      return;
    }
    void loadCalendars();
  }

  function confirmPendingAction() {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;
    if (action.kind === "select") {
      selectItem(action.item);
      return;
    }
    void loadCalendars();
  }

  async function createCalendar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationInProgress.current) return;

    setFeedback(null);
    const { payload, message } = validateForm(createForm);
    if (!payload) {
      setFeedback({ tone: "error", title: "새 일정을 등록할 수 없습니다.", message: message ?? "입력한 날짜와 제목을 확인해 주세요." });
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
      setFeedback({ tone: "success", title: "새 일정을 등록했습니다.", message: "학생회 일정 목록에 바로 반영되었습니다." });
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
    const { payload, message } = validateForm(editForm);
    if (!payload) {
      setFeedback({ tone: "error", title: "수정 사항을 저장할 수 없습니다.", message: message ?? "입력한 날짜와 제목을 확인해 주세요." });
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
      setFeedback({ tone: "success", title: "일정을 수정했습니다.", message: "변경한 날짜와 제목이 반영되었습니다." });
    } catch (error) {
      setFeedback({ tone: "error", title: "일정을 수정하지 못했습니다.", message: getCalendarErrorText(error) });
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
      setFeedback({ tone: "error", title: "일정을 삭제하지 못했습니다.", message: getCalendarErrorText(error) });
      setDeleteOpen(false);
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  function resetEditForm() {
    if (!selected) return;
    const nextForm = formFromItem(selected);
    setEditForm(nextForm);
    setFeedback(null);
  }

  return (
    <AdminLoginNotice returnTo="/calendars/manage">
      <div className="calendar-management-page stack-lg">
        {feedback && (
          <div
            className={`calendar-feedback feedback feedback-${feedback.tone} page-feedback`}
            role={feedback.tone === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            <strong>{feedback.title}</strong>
            <span>{feedback.message}</span>
          </div>
        )}

        <section className="panel calendar-create-panel" aria-labelledby="calendar-create-title">
          <div className="panel-heading panel-heading-border">
            <div>
              <span className="eyebrow dark">새 일정</span>
              <h2 id="calendar-create-title">학생회 일정 등록</h2>
              <p>학생들이 확인할 행사나 학사 일정을 입력해 주세요.</p>
            </div>
          </div>

          <div className="calendar-create-layout">
            <form onSubmit={createCalendar} aria-busy={busyAction === "create" || undefined}>
              <CalendarFields
                form={createForm}
                disabled={isBusy}
                prefix="calendar-create"
                onChange={setCreateField}
              />
              <div className="form-actions form-actions-end calendar-form-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    setCreateForm({ ...emptyForm });
                    setFeedback(null);
                  }}
                  disabled={isBusy || !isCreateDirty}
                >
                  입력 지우기
                </button>
                <button className="button button-primary" type="submit" disabled={isBusy}>
                  {busyAction === "create" ? "등록 중..." : "새 일정 등록"}
                </button>
              </div>
            </form>

            <aside className="calendar-form-guide" aria-label="일정 작성 안내">
              <span className="eyebrow dark">작성 안내</span>
              <h3>날짜에 맞춰 편하게 등록하세요.</h3>
              <ul>
                <li>하루 일정은 시작일과 종료일을 같게 선택하면 됩니다.</li>
                <li>같은 날짜에도 여러 일정을 등록할 수 있습니다.</li>
                <li>여러 날에 걸친 일정이나 서로 겹치는 일정도 등록할 수 있습니다.</li>
              </ul>
            </aside>
          </div>
        </section>

        <div className="calendar-workspace">
          <aside className="panel calendar-list-panel" aria-labelledby="calendar-list-title">
            <div className="calendar-list-heading panel-heading panel-heading-border">
              <div>
                <span className="eyebrow dark">등록된 일정</span>
                <h2 id="calendar-list-title">학생회 일정 목록</h2>
                <p>수정할 일정을 선택해 주세요.</p>
              </div>
              <span className="badge badge-neutral" aria-live="polite">
                {listState === "ready" ? `${calendars.length}개` : "확인 중"}
              </span>
            </div>

            <div className="calendar-list-tools">
              <button
                className="button button-secondary"
                type="button"
                onClick={requestRefresh}
                disabled={isBusy || listState === "loading"}
              >
                {listState === "loading" ? "불러오는 중..." : "목록 새로고침"}
              </button>
            </div>

            <div className="calendar-list" aria-live="polite" aria-busy={listState === "loading" || undefined}>
              {listState === "idle" && (
                <div className="calendar-state" role="status">
                  <strong>로그인 상태를 확인하고 있습니다.</strong>
                  <p>잠시만 기다려 주세요.</p>
                </div>
              )}
              {listState === "loading" && (
                <div className="calendar-state" role="status">
                  <span className="upload-spinner" aria-hidden="true" />
                  <strong>일정 목록을 불러오고 있습니다.</strong>
                  <p>등록된 일정을 날짜순으로 정리하고 있습니다.</p>
                </div>
              )}
              {listState === "error" && (
                <div className="calendar-state calendar-state-error" role="alert">
                  <strong>일정 목록을 불러오지 못했습니다.</strong>
                  <p>{listError}</p>
                  <button className="button button-secondary" type="button" onClick={() => void loadCalendars()} disabled={isBusy}>
                    다시 시도
                  </button>
                </div>
              )}
              {listState === "ready" && calendars.length === 0 && (
                <div className="calendar-state calendar-empty-state" role="status">
                  <span aria-hidden="true">+</span>
                  <strong>아직 등록된 일정이 없습니다.</strong>
                  <p>위 입력란에서 첫 일정을 등록해 주세요.</p>
                </div>
              )}
              {listState === "ready" && calendars.map((item) => (
                <button
                  className={`calendar-list-item ${selected?.id === item.id ? "selected" : ""}`}
                  type="button"
                  key={item.id}
                  aria-pressed={selected?.id === item.id}
                  aria-label={`${item.title}, ${formatDateRange(item.startDate, item.endDate)}`}
                  onClick={() => requestSelection(item)}
                  disabled={isBusy}
                >
                  <span className="calendar-date-badge" aria-hidden="true">
                    <strong>{formatShortDate(item.startDate)}</strong>
                    <small>{item.startDate === item.endDate ? "하루 일정" : `~ ${formatShortDate(item.endDate)}`}</small>
                  </span>
                  <span className="calendar-list-copy">
                    <strong>{item.title}</strong>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section ref={editorRef} className="panel calendar-editor-panel" aria-labelledby="calendar-editor-title">
            {!selected ? (
              <div className="calendar-state calendar-editor-empty">
                <span aria-hidden="true">←</span>
                <h2 id="calendar-editor-title">수정할 일정을 선택해 주세요.</h2>
                <p>왼쪽 목록에서 일정을 고르면 등록된 날짜와 제목을 바로 확인할 수 있습니다.</p>
              </div>
            ) : (
              <>
                <div className="calendar-editor-summary panel-heading panel-heading-border">
                  <div>
                    <span className="eyebrow dark">일정 수정</span>
                    <h2 id="calendar-editor-title">{selected.title}</h2>
                    <p>{selectedDateRange}</p>
                  </div>
                  {isEditDirty && <span className="badge badge-warning">저장하지 않은 변경</span>}
                </div>

                <form onSubmit={updateCalendar} aria-busy={busyAction === "save" || undefined}>
                  <CalendarFields
                    form={editForm}
                    disabled={isBusy}
                    prefix="calendar-edit"
                    onChange={setEditField}
                  />
                  <div className="form-actions form-actions-end calendar-form-actions">
                    <button className="button button-secondary" type="button" onClick={resetEditForm} disabled={isBusy || !isEditDirty}>
                      변경 취소
                    </button>
                    <button className="button button-primary" type="submit" disabled={isBusy || !isEditDirty}>
                      {busyAction === "save" ? "저장 중..." : "수정 사항 저장"}
                    </button>
                  </div>
                </form>

                <div className="danger-zone calendar-delete-zone">
                  <div>
                    <span className="eyebrow danger-text">주의</span>
                    <h3>일정 삭제</h3>
                    <p>삭제한 일정은 다시 되돌릴 수 없습니다.</p>
                  </div>
                  <button className="button button-danger" type="button" onClick={() => setDeleteOpen(true)} disabled={isBusy}>
                    이 일정 삭제
                  </button>
                </div>
              </>
            )}
          </section>
        </div>

        <ConfirmDialog
          open={deleteOpen}
          title={`“${selected?.title && selected.title.length > 30 ? `${selected.title.slice(0, 30)}…` : selected?.title ?? "선택한 일정"}” 일정을 삭제할까요?`}
          description="삭제하면 되돌릴 수 없습니다. 선택한 일정이 맞는지 한 번 더 확인해 주세요."
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
          title="저장하지 않은 변경을 버릴까요?"
          description="다른 일정을 선택하거나 목록을 새로 불러오면 지금 고친 정보는 사라집니다."
          confirmLabel="변경 버리기"
          busy={false}
          onCancel={() => setPendingAction(null)}
          onConfirm={confirmPendingAction}
        />
      </div>
    </AdminLoginNotice>
  );
}
