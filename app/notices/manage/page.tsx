"use client";

import {
  ArrowLeft,
  ArrowClockwise,
  CaretLeft,
  CaretRight,
  Eye,
  ImageBroken,
  MagnifyingGlass,
  PencilSimple,
  Plus,
  Trash,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import {
  type ChangeEvent,
  type DragEvent,
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
import { getAdminSession } from "../../lib/auth";
import {
  type AdminNotice,
  type AdminNoticePage,
  type NoticeForm,
  NOTICE_IMAGE_ACCEPT,
  createNoticeMultipartBody,
  emptyNoticeForm,
  formatNoticeFileSize,
  getNoticeFormError,
  normalizeNoticeForm,
  parseAdminNotice,
  parseAdminNoticePage,
  validateNoticeAttachment,
  validateNoticeImage,
} from "../../lib/notices";
import styles from "../notices.module.css";

type LoadState = "idle" | "loading" | "ready" | "error";
type Feedback = { tone: "success" | "error"; title: string; message: string };
type EditorIntent = "detail" | "edit";
type PendingMove =
  | { kind: "notice"; id: number; intent: EditorIntent }
  | { kind: "page"; page: number }
  | { kind: "delete"; id: number }
  | null;
type SelectedImage = { key: string; file: File; previewUrl: string };
type SelectedAttachment = { key: string; file: File };
type ExpandedImage = { src: string; fileName: string };

let selectedFileSequence = 0;

function createSelectedFileKey(file: File) {
  selectedFileSequence += 1;
  return `${file.name}-${file.size}-${file.lastModified}-${selectedFileSequence}`;
}

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

function SafeNoticeImage({
  src,
  alt,
  onOpen,
}: {
  src: string;
  alt: string;
  onOpen?: () => void;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const failed = failedSrc === src;

  if (failed) {
    return (
      <div className={styles.imageFallback} role="img" aria-label={`${alt} 이미지를 불러오지 못했습니다.`}>
        <ImageBroken size={26} weight="regular" aria-hidden="true" />
        <span>이미지를 불러올 수 없습니다.</span>
      </div>
    );
  }

  if (onOpen) {
    return (
      <button className={styles.imageOpenButton} type="button" onClick={onOpen} aria-label={`${alt} 크게 보기`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} onError={() => setFailedSrc(src)} />
      </button>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} onError={() => setFailedSrc(src)} />;
}

export default function ManageNoticePage() {
  const [pageData, setPageData] = useState<AdminNoticePage | null>(null);
  const [listState, setListState] = useState<LoadState>("idle");
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [notice, setNotice] = useState<AdminNotice | null>(null);
  const [detailState, setDetailState] = useState<LoadState>("idle");
  const [detailError, setDetailError] = useState("");
  const [editorMode, setEditorMode] = useState<EditorIntent>("detail");
  const [form, setForm] = useState<NoticeForm>({ ...emptyNoticeForm });
  const [baseline, setBaseline] = useState(JSON.stringify(emptyNoticeForm));
  const [removedImageIds, setRemovedImageIds] = useState<Set<number>>(new Set());
  const [removedAttachmentIds, setRemovedAttachmentIds] = useState<Set<number>>(new Set());
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<SelectedAttachment[]>([]);
  const [draggingImages, setDraggingImages] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingMove, setPendingMove] = useState<PendingMove>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [listQuery, setListQuery] = useState("");
  const [expandedImage, setExpandedImage] = useState<ExpandedImage | null>(null);
  const listController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const editorIntentRef = useRef<EditorIntent | null>(null);
  const imageDialogCloseRef = useRef<HTMLButtonElement | null>(null);
  const imageDialogReturnFocusRef = useRef<HTMLElement | null>(null);
  const selectedImagesRef = useRef<SelectedImage[]>([]);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);

  const isBusy = Boolean(busyAction);
  const hasFileChanges = removedImageIds.size > 0 ||
    removedAttachmentIds.size > 0 ||
    selectedImages.length > 0 ||
    selectedAttachments.length > 0;
  const hasUnsavedChanges = detailState === "ready" && (
    JSON.stringify(form) !== baseline || hasFileChanges
  );
  const selectedSummary = useMemo(
    () => pageData?.items.find((item) => item.id === selectedId) ?? notice,
    [notice, pageData, selectedId],
  );
  const visibleNotices = useMemo(() => {
    const query = listQuery.trim().toLocaleLowerCase("ko-KR");
    if (!pageData || !query) return pageData?.items ?? [];
    return pageData.items.filter((item) => (
      item.title.toLocaleLowerCase("ko-KR").includes(query) ||
      item.author.toLocaleLowerCase("ko-KR").includes(query)
    ));
  }, [listQuery, pageData]);
  const currentPageFileNoticeCount = useMemo(
    () => pageData?.items.filter((item) => item.images.length > 0 || item.attachments.length > 0).length ?? 0,
    [pageData],
  );

  const focusEditor = useCallback((intent: EditorIntent) => {
    window.requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      if (intent === "edit") {
        window.requestAnimationFrame(() => {
          editorRef.current
            ?.querySelector<HTMLInputElement>('input[name="notice-title"]')
            ?.focus();
        });
      }
    });
  }, []);

  const resetFileChanges = useCallback(() => {
    selectedImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    selectedImagesRef.current = [];
    setSelectedImages([]);
    setSelectedAttachments([]);
    setRemovedImageIds(new Set());
    setRemovedAttachmentIds(new Set());
    setDraggingImages(false);
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }, []);

  const loadNotice = useCallback(async (noticeId: number) => {
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;

    resetFileChanges();
    setSelectedId(noticeId);
    setNotice(null);
    setDetailState("loading");
    setDetailError("");
    setFeedback(null);
    updateUrlNoticeId(noticeId);

    try {
      const payload = await apiFetch<unknown>(`/api/admin/notices/${noticeId}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const response = parseAdminNotice(payload);

      const nextForm: NoticeForm = {
        title: response.title,
        author: response.author,
        content: response.content,
      };
      setNotice(response);
      setForm(nextForm);
      setBaseline(JSON.stringify(nextForm));
      setDetailState("ready");

      const requestedIntent = editorIntentRef.current;
      const intent = requestedIntent ?? "detail";
      editorIntentRef.current = null;
      setEditorMode(intent);
      if (requestedIntent || window.matchMedia("(max-width: 900px)").matches) {
        focusEditor(intent);
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setDetailState("error");
      setDetailError(getNoticeErrorText(error));
    } finally {
      if (detailController.current === controller) detailController.current = null;
    }
  }, [focusEditor, resetFileChanges]);

  const loadNotices = useCallback(async (page: number, autoSelectId?: number | null) => {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setListState("loading");
    setListError("");

    try {
      const payload = await apiFetch<unknown>(`/api/admin/notices?page=${page}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const response = parseAdminNoticePage(payload);

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

  useEffect(() => {
    if (!expandedImage) return;

    const previousOverflow = document.body.style.overflow;
    const focusFrame = window.requestAnimationFrame(() => imageDialogCloseRef.current?.focus());
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpandedImage(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);

    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = previousOverflow;
      imageDialogReturnFocusRef.current?.focus();
      imageDialogReturnFocusRef.current = null;
    };
  }, [expandedImage]);

  useEffect(() => () => {
    selectedImagesRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
  }, []);

  function clearSelection() {
    detailController.current?.abort();
    resetFileChanges();
    setSelectedId(null);
    setNotice(null);
    setDetailState("idle");
    setDetailError("");
    setEditorMode("detail");
    setForm({ ...emptyNoticeForm });
    setBaseline(JSON.stringify(emptyNoticeForm));
    updateUrlNoticeId(null);
  }

  function requestNotice(noticeId: number, intent: EditorIntent = "detail") {
    if (selectedId === noticeId) {
      if (detailState === "error") {
        editorIntentRef.current = intent;
        void loadNotice(noticeId);
      } else if (intent === "detail" && editorMode === "edit" && hasUnsavedChanges) {
        setPendingMove({ kind: "notice", id: noticeId, intent });
      } else {
        setEditorMode(intent);
        focusEditor(intent);
      }
      return;
    }
    if (hasUnsavedChanges) {
      setPendingMove({ kind: "notice", id: noticeId, intent });
      return;
    }
    editorIntentRef.current = intent;
    void loadNotice(noticeId);
  }

  function requestPage(page: number) {
    if (page < 0 || page === pageData?.page) return;
    if (hasUnsavedChanges) {
      setPendingMove({ kind: "page", page });
      return;
    }
    setListQuery("");
    clearSelection();
    void loadNotices(page);
  }

  function selectForDelete(noticeId: number) {
    setDeleteOpen(true);
    if (selectedId === noticeId) return;
    editorIntentRef.current = null;
    void loadNotice(noticeId);
  }

  function requestDelete(noticeId: number) {
    if (hasUnsavedChanges && selectedId !== noticeId) {
      setPendingMove({ kind: "delete", id: noticeId });
      return;
    }
    selectForDelete(noticeId);
  }

  function confirmMove() {
    const target = pendingMove;
    setPendingMove(null);
    if (!target) return;
    if (target.kind === "notice") {
      editorIntentRef.current = target.intent;
      void loadNotice(target.id);
      return;
    }
    if (target.kind === "delete") {
      selectForDelete(target.id);
      return;
    }
    setListQuery("");
    clearSelection();
    void loadNotices(target.page);
  }

  function setField<K extends keyof NoticeForm>(key: K, value: NoticeForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function addSelectedImages(files: File[]) {
    if (files.length === 0 || isBusy) return;
    for (const file of files) {
      const error = validateNoticeImage(file);
      if (error) {
        setFeedback({
          tone: "error",
          title: `“${file.name}” 사진을 추가할 수 없습니다.`,
          message: error,
        });
        return;
      }
    }

    const additions = files.map((file) => ({
      key: createSelectedFileKey(file),
      file,
      previewUrl: URL.createObjectURL(file),
    }));
    setSelectedImages((current) => {
      const next = [...current, ...additions];
      selectedImagesRef.current = next;
      return next;
    });
    setFeedback(null);
  }

  function chooseImages(event: ChangeEvent<HTMLInputElement>) {
    addSelectedImages(Array.from(event.target.files ?? []));
    event.target.value = "";
  }

  function dropImages(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDraggingImages(false);
    addSelectedImages(Array.from(event.dataTransfer.files));
  }

  function removeSelectedImage(key: string) {
    setSelectedImages((current) => {
      const target = current.find((item) => item.key === key);
      if (target) URL.revokeObjectURL(target.previewUrl);
      const next = current.filter((item) => item.key !== key);
      selectedImagesRef.current = next;
      return next;
    });
  }

  function chooseAttachments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length === 0 || isBusy) return;
    for (const file of files) {
      const error = validateNoticeAttachment(file);
      if (error) {
        setFeedback({
          tone: "error",
          title: `“${file.name}” 파일을 첨부할 수 없습니다.`,
          message: error,
        });
        return;
      }
    }

    setSelectedAttachments((current) => [
      ...current,
      ...files.map((file) => ({ key: createSelectedFileKey(file), file })),
    ]);
    setFeedback(null);
  }

  function toggleRemovedImage(imageId: number) {
    setRemovedImageIds((current) => {
      const next = new Set(current);
      if (next.has(imageId)) next.delete(imageId);
      else next.add(imageId);
      return next;
    });
  }

  function toggleRemovedAttachment(attachmentId: number) {
    setRemovedAttachmentIds((current) => {
      const next = new Set(current);
      if (next.has(attachmentId)) next.delete(attachmentId);
      else next.add(attachmentId);
      return next;
    });
  }

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedId || !notice || detailState !== "ready" || isBusy) return;

    setFeedback(null);
    const formError = getNoticeFormError(form);
    if (formError) {
      setFeedback({ tone: "error", title: "입력한 내용을 확인해 주세요.", message: formError });
      return;
    }
    const request = normalizeNoticeForm(form);
    const shouldSendFiles = hasFileChanges;

    setBusyAction("save");
    try {
      const payload = await apiFetch<unknown>(
        `/api/admin/notices/${selectedId}`,
        shouldSendFiles
          ? {
              method: "PUT",
              body: createNoticeMultipartBody(
                {
                  ...request,
                  retainedImageIds: notice.images
                    .filter((image) => !removedImageIds.has(image.id))
                    .map((image) => image.id),
                  retainedAttachmentIds: notice.attachments
                    .filter((attachment) => !removedAttachmentIds.has(attachment.id))
                    .map((attachment) => attachment.id),
                },
                selectedImages.map((item) => item.file),
                selectedAttachments.map((item) => item.file),
              ),
            }
          : {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(request),
            },
      );
      const response = parseAdminNotice(payload);
      const savedForm: NoticeForm = {
        title: response.title,
        author: response.author,
        content: response.content,
      };
      resetFileChanges();
      setNotice(response);
      setForm(savedForm);
      setBaseline(JSON.stringify(savedForm));
      setPageData((current) => current ? {
        ...current,
        items: current.items.map((item) => item.id === response.id ? response : item),
      } : current);
      setFeedback({
        tone: "success",
        title: "공지를 수정했습니다.",
        message: shouldSendFiles
          ? "내용과 사진, 첨부파일 변경 사항이 반영되었습니다."
          : "변경한 제목, 작성자와 내용이 반영되었습니다.",
      });
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
      if (targetPage !== (pageData?.page ?? 0)) setListQuery("");
      clearSelection();
      await loadNotices(targetPage);
      setFeedback({ tone: "success", title: "공지를 삭제했습니다.", message: "선택한 공지가 목록에서 삭제되었습니다." });
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        if (targetPage !== (pageData?.page ?? 0)) setListQuery("");
        clearSelection();
        await loadNotices(targetPage);
        setFeedback({
          tone: "success",
          title: "이미 삭제된 공지입니다.",
          message: "다른 곳에서 먼저 삭제된 항목을 목록에서 정리했습니다.",
        });
      } else {
        setFeedback({ tone: "error", title: "공지를 삭제하지 못했습니다.", message: getNoticeErrorText(error) });
      }
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
      <UnsavedChangesDialog dirty={hasUnsavedChanges} />
      <div className={`${styles.page} stack-lg`}>
        <div className={styles.workspace}>
          <section className={`panel ${styles.listPanel}`} aria-labelledby="notice-list-title">
            <header className={styles.listHeader}>
              <div>
                <p className={styles.sectionLabel}>공지 운영</p>
                <h2 id="notice-list-title">공지 목록</h2>
                <p>현재 페이지의 공지를 확인하고 상세 보기, 수정, 삭제 작업을 진행하세요.</p>
              </div>
              <div className={styles.headerActions}>
                <button
                  className={styles.secondaryButton}
                  type="button"
                  onClick={() => void loadNotices(currentPage)}
                  disabled={listState === "loading" || isBusy}
                >
                  <ArrowClockwise size={17} weight="bold" aria-hidden="true" />
                  새로고침
                </button>
                <Link className={styles.primaryButton} href="/notices/new">
                  <Plus size={17} weight="bold" aria-hidden="true" />
                  새 공지 작성
                </Link>
              </div>
            </header>

            <dl className={styles.summaryGrid} aria-label="공지 목록 요약">
              <div>
                <dt>전체</dt>
                <dd>{listState === "ready" ? (pageData?.totalElements ?? 0).toLocaleString("ko-KR") : "-"}</dd>
              </div>
              <div>
                <dt>현재 페이지</dt>
                <dd>{listState === "ready" ? `${totalPages === 0 ? 0 : currentPage + 1} / ${totalPages}` : "-"}</dd>
              </div>
              <div>
                <dt>표시 개수</dt>
                <dd>{listState === "ready" ? visibleNotices.length.toLocaleString("ko-KR") : "-"}</dd>
              </div>
              <div>
                <dt>현재 페이지 파일 포함 공지</dt>
                <dd>{listState === "ready" ? currentPageFileNoticeCount.toLocaleString("ko-KR") : "-"}</dd>
              </div>
            </dl>

            <div className={styles.searchBar}>
              <label htmlFor="current-page-notice-search">현재 페이지에서 찾기</label>
              <div className={styles.searchInputWrap}>
                <MagnifyingGlass size={18} aria-hidden="true" />
                <input
                  id="current-page-notice-search"
                  type="search"
                  value={listQuery}
                  onChange={(event) => setListQuery(event.target.value)}
                  placeholder="제목 또는 작성자 입력"
                  disabled={listState !== "ready" || (pageData?.items.length ?? 0) === 0}
                />
                {listQuery && (
                  <button type="button" onClick={() => setListQuery("")} aria-label="검색어 지우기">
                    <X size={16} weight="bold" aria-hidden="true" />
                  </button>
                )}
              </div>
              <p>서버 전체 검색이 아닌, 현재 페이지의 제목과 작성자만 필터합니다.</p>
            </div>

            <div className={styles.listResults} aria-live="polite">
              {(listState === "idle" || listState === "loading") && (
                <div className={styles.loadingState} role="status">
                  <span />
                  <span />
                  <span />
                  <p>{listState === "idle" ? "공지 목록을 준비하고 있습니다." : "최신 공지를 불러오고 있습니다."}</p>
                </div>
              )}
              {listState === "error" && (
                <div className={styles.statePanel} role="alert">
                  <strong>공지 목록을 불러오지 못했습니다.</strong>
                  <p>{listError}</p>
                  <button className={styles.secondaryButton} type="button" onClick={() => void loadNotices(currentPage)}>
                    다시 시도
                  </button>
                </div>
              )}
              {listState === "ready" && pageData?.items.length === 0 && (
                <div className={styles.statePanel}>
                  <strong>아직 등록된 공지가 없습니다.</strong>
                  <p>새 공지를 작성하면 이곳에서 상세 내용을 확인하고 관리할 수 있습니다.</p>
                  <Link className={styles.primaryButton} href="/notices/new">첫 공지 작성</Link>
                </div>
              )}
              {listState === "ready" && (pageData?.items.length ?? 0) > 0 && visibleNotices.length === 0 && (
                <div className={styles.statePanel}>
                  <strong>일치하는 공지가 없습니다.</strong>
                  <p>현재 페이지의 제목과 작성자에서 다른 검색어를 입력해 보세요.</p>
                  <button className={styles.secondaryButton} type="button" onClick={() => setListQuery("")}>검색어 지우기</button>
                </div>
              )}
              {listState === "ready" && visibleNotices.length > 0 && (
                <div className={styles.tableViewport}>
                  <table className={styles.noticeTable}>
                    <thead>
                      <tr>
                        <th scope="col">제목</th>
                        <th scope="col">작성자</th>
                        <th scope="col">이미지</th>
                        <th scope="col">첨부</th>
                        <th scope="col">조회수</th>
                        <th scope="col">등록일</th>
                        <th scope="col">수정일</th>
                        <th scope="col">작업</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleNotices.map((item) => (
                        <tr className={selectedId === item.id ? styles.selectedRow : undefined} key={item.id}>
                          <td className={styles.titleCell}>
                            <button type="button" onClick={() => requestNotice(item.id, "detail")} disabled={isBusy}>
                              {item.title}
                            </button>
                          </td>
                          <td>{item.author}</td>
                          <td className={styles.numericCell}>{item.images.length.toLocaleString("ko-KR")}</td>
                          <td className={styles.numericCell}>{item.attachments.length.toLocaleString("ko-KR")}</td>
                          <td className={styles.numericCell}>{item.viewCount.toLocaleString("ko-KR")}</td>
                          <td className={styles.dateCell}>{formatDate(item.createdAt)}</td>
                          <td className={styles.dateCell}>{formatDate(item.updatedAt)}</td>
                          <td>
                            <div className={styles.rowActions}>
                              <button type="button" onClick={() => requestNotice(item.id, "detail")} disabled={isBusy} aria-label={`${item.title} 상세 보기`}>
                                <Eye size={17} aria-hidden="true" />
                                상세
                              </button>
                              <button type="button" onClick={() => requestNotice(item.id, "edit")} disabled={isBusy} aria-label={`${item.title} 수정`}>
                                <PencilSimple size={17} aria-hidden="true" />
                                수정
                              </button>
                              <button className={styles.deleteAction} type="button" onClick={() => requestDelete(item.id)} disabled={isBusy} aria-label={`${item.title} 삭제`}>
                                <Trash size={17} aria-hidden="true" />
                                삭제
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {listState === "ready" && pageData && (
              <nav className={styles.pagination} aria-label="공지 목록 페이지">
                <button type="button" onClick={() => requestPage(currentPage - 1)} disabled={currentPage === 0 || isBusy}>
                  <CaretLeft size={17} weight="bold" aria-hidden="true" />
                  이전
                </button>
                <span aria-current="page">{totalPages === 0 ? 0 : currentPage + 1} / {totalPages}</span>
                <button type="button" onClick={() => requestPage(currentPage + 1)} disabled={!pageData.hasNext || isBusy}>
                  다음
                  <CaretRight size={17} weight="bold" aria-hidden="true" />
                </button>
              </nav>
            )}
          </section>

          <div className={`club-editor-stack ${styles.editorWorkspace}`} ref={editorRef}>
            {feedback && (
              <div className={`feedback feedback-${feedback.tone} page-feedback`} role={feedback.tone === "error" ? "alert" : "status"}>
                <strong>{feedback.title}</strong>
                <span>{feedback.message}</span>
              </div>
            )}

            {!selectedId ? (
              <section className="panel club-editor-empty">
                <span aria-hidden="true"><ArrowLeft size={24} /></span>
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
                    <div>
                      <dt>사진·첨부</dt>
                      <dd>{notice ? `사진 ${notice.images.length}장 · 파일 ${notice.attachments.length}개` : "-"}</dd>
                    </div>
                    <div>
                      <dt>조회수</dt>
                      <dd>{notice ? notice.viewCount.toLocaleString("ko-KR") : "-"}</dd>
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
                    {editorMode === "detail" ? (
                      <section className={`panel form-panel ${styles.detailPanel}`} aria-labelledby="notice-detail-heading">
                        <div className="panel-heading panel-heading-border">
                          <div>
                            <span className="eyebrow dark">공지 상세</span>
                            <h2 id="notice-detail-heading">게시된 내용</h2>
                            <p>학생회 공지에 게시된 본문과 파일을 확인합니다.</p>
                          </div>
                          <button
                            className="button button-secondary"
                            type="button"
                            onClick={() => {
                              setEditorMode("edit");
                              focusEditor("edit");
                            }}
                          >
                            <PencilSimple size={17} aria-hidden="true" />
                            수정
                          </button>
                        </div>

                        <dl className={styles.detailMeta}>
                          <div><dt>제목</dt><dd>{notice.title}</dd></div>
                          <div><dt>작성자</dt><dd>{notice.author}</dd></div>
                          <div><dt>등록일</dt><dd>{formatDateTime(notice.createdAt)}</dd></div>
                          <div><dt>수정일</dt><dd>{formatDateTime(notice.updatedAt)}</dd></div>
                        </dl>

                        <section className={styles.detailSection} aria-labelledby="notice-body-heading">
                          <h3 id="notice-body-heading">본문</h3>
                          <p className={styles.noticeBody}>{notice.content}</p>
                        </section>

                        <section className={styles.detailSection} aria-labelledby="notice-images-heading">
                          <div className={styles.detailSectionHeading}>
                            <h3 id="notice-images-heading">이미지</h3>
                            <span>{notice.images.length}장</span>
                          </div>
                          {notice.images.length > 0 ? (
                            <ul className={styles.detailImageGrid}>
                              {notice.images.map((image) => (
                                <li key={image.id}>
                                  <SafeNoticeImage
                                    src={image.imageUrl}
                                    alt={`${image.fileName} 미리보기`}
                                    onOpen={() => {
                                      imageDialogReturnFocusRef.current = document.activeElement instanceof HTMLElement
                                        ? document.activeElement
                                        : null;
                                      setExpandedImage({ src: image.imageUrl, fileName: image.fileName });
                                    }}
                                  />
                                  <strong>{image.fileName}</strong>
                                  <span>{formatNoticeFileSize(image.fileSize)}</span>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className={styles.detailEmpty}>등록된 이미지가 없습니다.</p>
                          )}
                        </section>

                        <section className={styles.detailSection} aria-labelledby="notice-attachments-heading">
                          <div className={styles.detailSectionHeading}>
                            <h3 id="notice-attachments-heading">첨부파일</h3>
                            <span>{notice.attachments.length}개</span>
                          </div>
                          {notice.attachments.length > 0 ? (
                            <ul className={styles.detailAttachmentList}>
                              {notice.attachments.map((attachment) => (
                                <li key={attachment.id}>
                                  <div>
                                    <strong>{attachment.fileName}</strong>
                                    <span>{attachment.contentType || "파일"} · {formatNoticeFileSize(attachment.fileSize)}</span>
                                  </div>
                                  <a className="button button-secondary" href={attachment.downloadUrl} download={attachment.fileName}>
                                    내려받기
                                  </a>
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className={styles.detailEmpty}>등록된 첨부파일이 없습니다.</p>
                          )}
                        </section>
                      </section>
                    ) : (
                    <form className="panel form-panel" onSubmit={handleUpdate}>
                      <div className="panel-heading panel-heading-border">
                        <div>
                          <span className="eyebrow dark">공지 수정</span>
                          <h2>공지 내용</h2>
                          <p>현재 게시된 내용과 파일을 확인하고 필요한 부분을 바꿔 주세요.</p>
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
                              name="notice-title"
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

                      <div className="notice-file-grid">
                        <section className="notice-file-section" aria-labelledby="manage-notice-images-heading">
                          <div className="notice-file-section-header">
                            <div>
                              <h3 id="manage-notice-images-heading">공지 사진</h3>
                              <p>현재 사진을 그대로 두거나, 지울 사진을 고르고 새 사진을 추가하세요.</p>
                            </div>
                            <span>현재 {notice.images.length}장 · 새로 {selectedImages.length}장</span>
                          </div>

                          {notice.images.length > 0 ? (
                            <ul className="notice-image-preview-grid" aria-label="현재 등록된 공지 사진">
                              {notice.images.map((image) => {
                                const willRemove = removedImageIds.has(image.id);
                                return (
                                  <li
                                    className={`notice-image-preview-item${willRemove ? " is-removed" : ""}`}
                                    key={image.id}
                                  >
                                    <SafeNoticeImage
                                      src={image.imageUrl}
                                      alt={`${image.fileName} 미리보기`}
                                      onOpen={() => {
                                        imageDialogReturnFocusRef.current = document.activeElement instanceof HTMLElement
                                          ? document.activeElement
                                          : null;
                                        setExpandedImage({ src: image.imageUrl, fileName: image.fileName });
                                      }}
                                    />
                                    <div>
                                      <strong>{image.fileName}</strong>
                                      <span>{formatNoticeFileSize(image.fileSize)}</span>
                                      <small className="notice-file-status">
                                        {willRemove ? "저장하면 삭제됩니다." : "현재 등록된 사진"}
                                      </small>
                                    </div>
                                    <button
                                      className="notice-file-remove"
                                      type="button"
                                      onClick={() => toggleRemovedImage(image.id)}
                                      disabled={isBusy}
                                      aria-label={willRemove ? `${image.fileName} 사진 삭제 취소` : `${image.fileName} 사진 삭제`}
                                    >
                                      {willRemove ? "되돌리기" : "삭제"}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p className="notice-files-empty">현재 등록된 사진이 없습니다.</p>
                          )}

                          <div
                            className={`notice-file-picker${draggingImages ? " is-dragging" : ""}`}
                            onDragEnter={(event) => {
                              event.preventDefault();
                              if (!isBusy) setDraggingImages(true);
                            }}
                            onDragOver={(event) => event.preventDefault()}
                            onDragLeave={() => setDraggingImages(false)}
                            onDrop={dropImages}
                          >
                            <input
                              ref={imageInputRef}
                              className="sr-only"
                              id="manage-notice-images"
                              type="file"
                              accept={NOTICE_IMAGE_ACCEPT}
                              multiple
                              disabled={isBusy}
                              onChange={chooseImages}
                            />
                            <label className="notice-file-picker-copy" htmlFor="manage-notice-images">
                              <strong>{draggingImages ? "여기에 놓아 주세요" : "새 사진 선택"}</strong>
                              <span>클릭하거나 파일을 끌어다 놓으세요.</span>
                              <small>JPG, JPEG, PNG, GIF · 한 장당 5MB 이하</small>
                            </label>
                          </div>

                          {selectedImages.length > 0 && (
                            <ul className="notice-image-preview-grid" aria-label="새로 추가할 공지 사진">
                              {selectedImages.map((image) => (
                                <li className="notice-image-preview-item" key={image.key}>
                                  <SafeNoticeImage
                                    src={image.previewUrl}
                                    alt={`${image.file.name} 미리보기`}
                                    onOpen={() => {
                                      imageDialogReturnFocusRef.current = document.activeElement instanceof HTMLElement
                                        ? document.activeElement
                                        : null;
                                      setExpandedImage({ src: image.previewUrl, fileName: image.file.name });
                                    }}
                                  />
                                  <div>
                                    <strong>{image.file.name}</strong>
                                    <span>{formatNoticeFileSize(image.file.size)}</span>
                                    <small className="notice-file-status">저장하면 추가됩니다.</small>
                                  </div>
                                  <button
                                    className="notice-file-remove"
                                    type="button"
                                    onClick={() => removeSelectedImage(image.key)}
                                    disabled={isBusy}
                                    aria-label={`${image.file.name} 새 사진 선택 취소`}
                                  >
                                    제거
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>

                        <section className="notice-file-section" aria-labelledby="manage-notice-attachments-heading">
                          <div className="notice-file-section-header">
                            <div>
                              <h3 id="manage-notice-attachments-heading">첨부파일</h3>
                              <p>현재 파일을 내려받거나, 지울 파일을 고르고 새 파일을 추가하세요.</p>
                            </div>
                            <span>현재 {notice.attachments.length}개 · 새로 {selectedAttachments.length}개</span>
                          </div>

                          {notice.attachments.length > 0 ? (
                            <ul className="notice-selected-files" aria-label="현재 등록된 첨부파일">
                              {notice.attachments.map((attachment) => {
                                const willRemove = removedAttachmentIds.has(attachment.id);
                                return (
                                  <li
                                    className={`notice-selected-file notice-existing-file${willRemove ? " is-removed" : ""}`}
                                    key={attachment.id}
                                  >
                                    <div>
                                      <strong>{attachment.fileName}</strong>
                                      <span>{formatNoticeFileSize(attachment.fileSize)}</span>
                                      <small className="notice-file-status">
                                        {willRemove ? "저장하면 삭제됩니다." : "현재 등록된 파일"}
                                      </small>
                                    </div>
                                    {!willRemove && (
                                      <a
                                        className="notice-download-link"
                                        href={attachment.downloadUrl}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        내려받기
                                      </a>
                                    )}
                                    <button
                                      className="notice-file-remove"
                                      type="button"
                                      onClick={() => toggleRemovedAttachment(attachment.id)}
                                      disabled={isBusy}
                                      aria-label={willRemove ? `${attachment.fileName} 파일 삭제 취소` : `${attachment.fileName} 파일 삭제`}
                                    >
                                      {willRemove ? "되돌리기" : "삭제"}
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : (
                            <p className="notice-files-empty">현재 등록된 첨부파일이 없습니다.</p>
                          )}

                          <div className="notice-file-picker">
                            <input
                              ref={attachmentInputRef}
                              className="sr-only"
                              id="manage-notice-attachments"
                              type="file"
                              multiple
                              disabled={isBusy}
                              onChange={chooseAttachments}
                            />
                            <label className="notice-file-picker-copy" htmlFor="manage-notice-attachments">
                              <strong>새 파일 선택</strong>
                              <span>여러 파일을 한 번에 선택할 수 있습니다.</span>
                              <small>파일 형식 제한 없음 · 내용이 없는 파일 제외</small>
                            </label>
                          </div>

                          {selectedAttachments.length > 0 && (
                            <ul className="notice-selected-files" aria-label="새로 추가할 첨부파일">
                              {selectedAttachments.map((attachment) => (
                                <li className="notice-selected-file" key={attachment.key}>
                                  <div>
                                    <strong>{attachment.file.name}</strong>
                                    <span>{formatNoticeFileSize(attachment.file.size)}</span>
                                    <small className="notice-file-status">저장하면 추가됩니다.</small>
                                  </div>
                                  <button
                                    className="notice-file-remove"
                                    type="button"
                                    onClick={() => setSelectedAttachments((current) => current.filter((item) => item.key !== attachment.key))}
                                    disabled={isBusy}
                                    aria-label={`${attachment.file.name} 새 파일 선택 취소`}
                                  >
                                    제거
                                  </button>
                                </li>
                              ))}
                            </ul>
                          )}
                        </section>
                      </div>

                      <div className="form-actions form-actions-end">
                        <button className="button button-primary" type="submit" disabled={isBusy || !hasUnsavedChanges}>
                          {busyAction === "save" ? "저장 중..." : "변경 내용 저장"}
                        </button>
                      </div>
                    </form>
                    )}

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
          description="이 작업은 공지와 연결된 이미지 및 첨부파일을 삭제하며 되돌릴 수 없습니다."
          confirmLabel="공지 삭제"
          danger
          busy={busyAction === "delete"}
          onCancel={() => setDeleteOpen(false)}
          onConfirm={handleDelete}
        />

        <ConfirmDialog
          open={Boolean(pendingMove)}
          title="저장하지 않은 변경을 버릴까요?"
          description="다른 공지나 목록으로 이동하면 지금 고친 내용과 선택한 파일이 사라집니다."
          confirmLabel="변경 버리기"
          busy={false}
          onCancel={() => setPendingMove(null)}
          onConfirm={confirmMove}
        />

        {expandedImage && (
          <div
            className={styles.imageDialogBackdrop}
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setExpandedImage(null);
            }}
          >
            <section
              className={styles.imageDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="notice-image-dialog-title"
            >
              <header>
                <div>
                  <p>공지 이미지</p>
                  <h2 id="notice-image-dialog-title">{expandedImage.fileName}</h2>
                </div>
                <button
                  ref={imageDialogCloseRef}
                  type="button"
                  onClick={() => setExpandedImage(null)}
                  aria-label="확대 이미지 닫기"
                >
                  <X size={21} weight="bold" aria-hidden="true" />
                </button>
              </header>
              <div className={styles.imageDialogBody}>
                <SafeNoticeImage src={expandedImage.src} alt={`${expandedImage.fileName} 확대 이미지`} />
              </div>
            </section>
          </div>
        )}
      </div>
    </AdminLoginNotice>
  );
}
