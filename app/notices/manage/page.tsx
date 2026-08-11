"use client";

import Link from "next/link";
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
import { getAdminSession } from "../../lib/auth";

type Notice = {
  id: number;
  title: string;
  author: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

type NoticePage = {
  items: Notice[];
  page: number;
  size: number;
  totalPages: number;
  totalElements: number;
  hasNext: boolean;
};

type NoticeForm = Pick<Notice, "title" | "author" | "content">;
type LoadState = "idle" | "loading" | "ready" | "error";
type Feedback = { tone: "success" | "error"; title: string; message: string };
type PendingMove =
  | { kind: "notice"; id: number }
  | { kind: "page"; page: number }
  | null;

const emptyForm: NoticeForm = { title: "", author: "", content: "" };

function getNoticeErrorText(error: unknown) {
  const message = getErrorText(error);
  return /API|ADMIN|HTTPS?|CORS|token|session|server|토큰|세션|서버/i.test(message)
    ? "요청을 처리하는 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요."
    : message;
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function updateUrlNoticeId(noticeId: number | null) {
  const url = new URL(window.location.href);
  if (noticeId) url.searchParams.set("id", String(noticeId));
  else url.searchParams.delete("id");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export default function ManageNoticePage() {
  const [pageData, setPageData] = useState<NoticePage | null>(null);
  const [listState, setListState] = useState<LoadState>("idle");
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [detailState, setDetailState] = useState<LoadState>("idle");
  const [detailError, setDetailError] = useState("");
  const [form, setForm] = useState<NoticeForm>({ ...emptyForm });
  const [baseline, setBaseline] = useState(JSON.stringify(emptyForm));
  const [busyAction, setBusyAction] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingMove, setPendingMove] = useState<PendingMove>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const listController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);

  const isBusy = Boolean(busyAction);
  const hasUnsavedChanges = detailState === "ready" && JSON.stringify(form) !== baseline;
  const selectedSummary = useMemo(
    () => pageData?.items.find((item) => item.id === selectedId) ?? notice,
    [notice, pageData, selectedId],
  );

  const loadNotice = useCallback(async (noticeId: number) => {
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;

    setSelectedId(noticeId);
    setNotice(null);
    setDetailState("loading");
    setDetailError("");
    setFeedback(null);
    updateUrlNoticeId(noticeId);

    try {
      const response = await apiFetch<Notice>(`/api/admin/notices/${noticeId}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      const nextForm: NoticeForm = {
        title: response.title,
        author: response.author,
        content: response.content,
      };
      setNotice(response);
      setForm(nextForm);
      setBaseline(JSON.stringify(nextForm));
      setDetailState("ready");

      window.requestAnimationFrame(() => {
        if (window.matchMedia("(max-width: 900px)").matches) {
          editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setDetailState("error");
      setDetailError(getNoticeErrorText(error));
    } finally {
      if (detailController.current === controller) detailController.current = null;
    }
  }, []);

  const loadNotices = useCallback(async (page: number, autoSelectId?: number | null) => {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setListState("loading");
    setListError("");

    try {
      const response = await apiFetch<NoticePage>(`/api/admin/notices?page=${page}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      setPageData(response);
      setListState("ready");
      if (autoSelectId) await loadNotice(autoSelectId);
    } catch (error) {
      if (controller.signal.aborted) return;
      setListState("error");
      setListError(getNoticeErrorText(error));
    } finally {
      if (listController.current === controller) listController.current = null;
    }
  }, [loadNotice]);

  useEffect(() => {
    if (!getAdminSession()) return;

    const value = new URLSearchParams(window.location.search).get("id");
    const requestedId = value && /^\d+$/.test(value) && Number(value) > 0
      ? Number(value)
      : null;
    const timeoutId = window.setTimeout(() => {
      void loadNotices(0, requestedId);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      listController.current?.abort();
      detailController.current?.abort();
    };
  }, [loadNotices]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [hasUnsavedChanges]);

  function clearSelection() {
    detailController.current?.abort();
    setSelectedId(null);
    setNotice(null);
    setDetailState("idle");
    setDetailError("");
    setForm({ ...emptyForm });
    setBaseline(JSON.stringify(emptyForm));
    updateUrlNoticeId(null);
  }

  function requestNotice(noticeId: number) {
    if (selectedId === noticeId) {
      if (detailState === "error") void loadNotice(noticeId);
      return;
    }
    if (hasUnsavedChanges) {
      setPendingMove({ kind: "notice", id: noticeId });
      return;
    }
    void loadNotice(noticeId);
  }

  function requestPage(page: number) {
    if (page < 0 || page === pageData?.page) return;
    if (hasUnsavedChanges) {
      setPendingMove({ kind: "page", page });
      return;
    }
    clearSelection();
    void loadNotices(page);
  }

  function confirmMove() {
    const target = pendingMove;
    setPendingMove(null);
    if (!target) return;
    if (target.kind === "notice") {
      void loadNotice(target.id);
      return;
    }
    clearSelection();
    void loadNotices(target.page);
  }

  function setField<K extends keyof NoticeForm>(key: K, value: NoticeForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || detailState !== "ready" || isBusy) return;

    setFeedback(null);
    const trimmedTitle = form.title.trim();
    const trimmedAuthor = form.author.trim();
    const trimmedContent = form.content.trim();
    const nextForm: NoticeForm = {
      title: trimmedTitle,
      author: trimmedAuthor,
      content: trimmedContent,
    };

    if (!nextForm.title || nextForm.title.length > 500) {
      setFeedback({ tone: "error", title: "제목을 확인해 주세요.", message: "제목은 필수이며 500자 이하로 입력해 주세요." });
      return;
    }
    if (!nextForm.author || nextForm.author.length > 100) {
      setFeedback({ tone: "error", title: "작성자를 확인해 주세요.", message: "작성자는 필수이며 100자 이하로 입력해 주세요." });
      return;
    }
    if (!nextForm.content) {
      setFeedback({ tone: "error", title: "내용을 확인해 주세요.", message: "학생들에게 전달할 공지 내용을 입력해 주세요." });
      return;
    }

    setBusyAction("save");
    try {
      const response = await apiFetch<Notice>(`/api/admin/notices/${selectedId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          author: trimmedAuthor,
          content: trimmedContent
        }),
      });
      const savedForm: NoticeForm = {
        title: response.title,
        author: response.author,
        content: response.content,
      };
      setNotice(response);
      setForm(savedForm);
      setBaseline(JSON.stringify(savedForm));
      setPageData((current) => current ? {
        ...current,
        items: current.items.map((item) => item.id === response.id ? response : item),
      } : current);
      setFeedback({ tone: "success", title: "공지를 수정했습니다.", message: "변경한 제목, 작성자와 내용이 반영되었습니다." });
    } catch (error) {
      setFeedback({ tone: "error", title: "공지를 수정하지 못했습니다.", message: getNoticeErrorText(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleDelete() {
    if (!selectedId || isBusy) return;
    const targetPage = pageData && pageData.items.length === 1 && pageData.page > 0
      ? pageData.page - 1
      : pageData?.page ?? 0;

    setFeedback(null);
    setBusyAction("delete");
    try {
      await apiFetch<void>(`/api/admin/notices/${selectedId}`, { method: "DELETE" });
      clearSelection();
      await loadNotices(targetPage);
      setFeedback({ tone: "success", title: "공지를 삭제했습니다.", message: "선택한 공지가 목록에서 삭제되었습니다." });
    } catch (error) {
      setFeedback({ tone: "error", title: "공지를 삭제하지 못했습니다.", message: getNoticeErrorText(error) });
    } finally {
      setBusyAction("");
      setDeleteOpen(false);
    }
  }

  const currentPage = pageData?.page ?? 0;
  const totalPages = pageData?.totalPages ?? 0;
  const selectedTitle = notice?.title ?? selectedSummary?.title ?? "선택한 공지";

  return (
    <AdminLoginNotice returnTo="/notices/manage">
      <div className="stack-lg">
        <section className="notice-callout" role="note">
          <div className="callout-icon" aria-hidden="true">i</div>
          <div>
            <strong>목록에서 공지를 고르면 현재 내용을 불러옵니다.</strong>
            <p>제목과 작성자, 내용을 확인한 뒤 필요한 부분만 고쳐 저장해 주세요.</p>
          </div>
        </section>

        <div className="club-management-layout">
          <aside className="panel club-list-panel" aria-labelledby="notice-list-title">
            <div className="club-list-heading">
              <div>
                <span className="eyebrow dark">수정 대상 선택</span>
                <h2 id="notice-list-title">공지 목록</h2>
              </div>
              <span>{listState === "ready" ? `전체 ${(pageData?.totalElements ?? 0).toLocaleString("ko-KR")}개` : "-"}</span>
            </div>

            <div className="club-list-controls">
              <Link className="button button-primary club-list-refresh" href="/notices/new">새 공지 작성</Link>
              <button
                className="button button-secondary club-list-refresh"
                type="button"
                onClick={() => void loadNotices(currentPage)}
                disabled={listState === "loading" || isBusy}
              >
                {listState === "loading" ? "불러오는 중..." : "목록 새로고침"}
              </button>
            </div>

            <div className="club-list-results" aria-live="polite">
              {listState === "idle" && <p className="club-list-message">공지 목록을 준비하고 있습니다.</p>}
              {listState === "loading" && <p className="club-list-message">최신 공지부터 불러오고 있습니다.</p>}
              {listState === "error" && (
                <div className="club-list-message error">
                  <strong>공지 목록을 불러오지 못했습니다.</strong>
                  <p>{listError}</p>
                  <button type="button" onClick={() => void loadNotices(currentPage)}>다시 시도</button>
                </div>
              )}
              {listState === "ready" && pageData?.items.length === 0 && (
                <div className="club-list-message">
                  <p>아직 등록된 공지가 없습니다.</p>
                  <Link href="/notices/new">첫 공지 작성하기</Link>
                </div>
              )}

              {listState === "ready" && pageData?.items.map((item) => (
                <button
                  className={`club-list-item ${selectedId === item.id ? "selected" : ""}`}
                  type="button"
                  key={item.id}
                  aria-pressed={selectedId === item.id}
                  onClick={() => requestNotice(item.id)}
                  disabled={isBusy}
                >
                  <span className="club-list-thumbnail" aria-hidden="true">공</span>
                  <span className="club-list-copy">
                    <strong>{item.title}</strong>
                    <small>{item.author}</small>
                    <em>{formatDate(item.createdAt)}</em>
                  </span>
                </button>
              ))}
            </div>

            {listState === "ready" && (
              <div className="form-actions">
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => requestPage(currentPage - 1)}
                  disabled={currentPage === 0 || isBusy}
                  aria-label="이전 공지 목록"
                >
                  이전
                </button>
                <span className="badge badge-neutral">
                  {totalPages === 0 ? 0 : currentPage + 1} / {totalPages}
                </span>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => requestPage(currentPage + 1)}
                  disabled={!pageData?.hasNext || isBusy}
                  aria-label="다음 공지 목록"
                >
                  다음
                </button>
              </div>
            )}
          </aside>

          <div className="club-editor-stack" ref={editorRef}>
            {feedback && (
              <div className={`feedback feedback-${feedback.tone} page-feedback`} role={feedback.tone === "error" ? "alert" : "status"}>
                <strong>{feedback.title}</strong>
                <span>{feedback.message}</span>
              </div>
            )}

            {!selectedId ? (
              <section className="panel club-editor-empty">
                <span aria-hidden="true">←</span>
                <h2>수정할 공지를 선택해 주세요.</h2>
                <p>목록에서 공지를 고르면 작성한 내용을 자동으로 불러옵니다.</p>
              </section>
            ) : (
              <>
                <section className="panel selected-club-summary">
                  <div>
                    <span className="badge badge-teal">학생회 공지</span>
                    <h2>{selectedTitle}</h2>
                    <p>{notice?.author ?? selectedSummary?.author ?? "작성자 확인 중"}</p>
                  </div>
                  <dl>
                    <div>
                      <dt>등록일</dt>
                      <dd>{notice ? formatDateTime(notice.createdAt) : "-"}</dd>
                    </div>
                    <div>
                      <dt>마지막 수정</dt>
                      <dd>{notice ? formatDateTime(notice.updatedAt) : "-"}</dd>
                    </div>
                  </dl>
                </section>

                {detailState === "loading" && (
                  <section className="panel club-detail-state" role="status">
                    <strong>공지 내용을 불러오고 있습니다.</strong>
                    <p>잠시만 기다려 주세요.</p>
                  </section>
                )}

                {detailState === "error" && (
                  <section className="feedback feedback-error club-detail-state" role="alert">
                    <strong>공지 내용을 불러오지 못했습니다.</strong>
                    <span>{detailError}</span>
                    <div className="form-actions">
                      <button className="button button-secondary" type="button" onClick={() => void loadNotice(selectedId)}>
                        다시 불러오기
                      </button>
                    </div>
                  </section>
                )}

                {detailState === "ready" && notice && (
                  <>
                    <form className="panel form-panel" onSubmit={handleUpdate}>
                      <div className="panel-heading panel-heading-border">
                        <div>
                          <span className="eyebrow dark">공지 수정</span>
                          <h2>공지 내용</h2>
                          <p>현재 게시된 내용을 확인하고 필요한 부분을 고쳐 주세요.</p>
                        </div>
                        {hasUnsavedChanges && <span className="badge badge-warning">저장하지 않은 변경</span>}
                      </div>

                      <fieldset className="editor-fieldset" disabled={isBusy}>
                        <div className="admin-form">
                          <label className="field-group">
                            <span className="field-label">
                              제목 <em>필수</em>
                              <small className={form.title.length > 500 ? "limit-over" : ""}>{form.title.length} / 500</small>
                            </span>
                            <input
                              type="text"
                              value={form.title}
                              maxLength={500}
                              onChange={(event) => setField("title", event.target.value)}
                              required
                            />
                          </label>

                          <label className="field-group">
                            <span className="field-label">
                              작성자 <em>필수</em>
                              <small className={form.author.length > 100 ? "limit-over" : ""}>{form.author.length} / 100</small>
                            </span>
                            <input
                              type="text"
                              value={form.author}
                              maxLength={100}
                              onChange={(event) => setField("author", event.target.value)}
                              required
                            />
                          </label>

                          <label className="field-group">
                            <span className="field-label">내용 <em>필수</em></span>
                            <textarea
                              rows={14}
                              value={form.content}
                              onChange={(event) => setField("content", event.target.value)}
                              required
                            />
                            <small className="field-help">줄바꿈도 작성한 모습 그대로 표시됩니다.</small>
                          </label>
                        </div>
                      </fieldset>

                      <div className="form-actions form-actions-end">
                        <button className="button button-primary" type="submit" disabled={isBusy || !hasUnsavedChanges}>
                          {busyAction === "save" ? "저장 중..." : "변경 내용 저장"}
                        </button>
                      </div>
                    </form>

                    <section className="danger-zone">
                      <div>
                        <span className="eyebrow danger-text">주의</span>
                        <h2>공지 삭제</h2>
                        <p>이 공지가 완전히 삭제되며 되돌릴 수 없습니다.</p>
                      </div>
                      <button className="button button-danger" type="button" disabled={isBusy} onClick={() => setDeleteOpen(true)}>
                        이 공지 삭제
                      </button>
                    </section>
                  </>
                )}
              </>
            )}
          </div>
        </div>

        <ConfirmDialog
          open={deleteOpen}
          title={`“${selectedTitle.length > 30 ? `${selectedTitle.slice(0, 30)}…` : selectedTitle}” 공지를 삭제할까요?`}
          description="삭제하면 되돌릴 수 없습니다. 선택한 공지가 맞는지 한 번 더 확인해 주세요."
          confirmLabel="공지 삭제"
          danger
          busy={busyAction === "delete"}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={handleDelete}
        />

        <ConfirmDialog
          open={Boolean(pendingMove)}
          title="저장하지 않은 변경을 버릴까요?"
          description="다른 공지나 목록으로 이동하면 지금 고친 내용은 사라집니다."
          confirmLabel="변경 버리기"
          busy={false}
          onCancel={() => setPendingMove(null)}
          onConfirm={confirmMove}
        />
      </div>
    </AdminLoginNotice>
  );
}
