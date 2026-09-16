"use client";

import {
  ArrowClockwise,
  ArrowSquareOut,
  CheckCircle,
  LinkSimple,
  MagnifyingGlass,
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
  ADMIN_LINKS_ENDPOINT,
  LINKS_ENDPOINT,
  type LinkFieldErrors,
  type LinkForm,
  type ManagedLink,
  formFromManagedLink,
  isValidExternalLinkUrl,
  linkFormSignature,
  normalizeLinkCategory,
  parseManagedLink,
  parseManagedLinks,
  validateLinkForm,
} from "../../lib/links";
import styles from "./links.module.css";

type LoadState = "idle" | "loading" | "ready" | "error";
type BusyAction = "create" | "update" | "delete" | "";
type Feedback = {
  tone: "success" | "info" | "error";
  title: string;
  message: string;
};
type PendingAction =
  | { kind: "select"; linkId: number }
  | { kind: "create" }
  | { kind: "refresh" }
  | null;

const emptyForm: LinkForm = { name: "", url: "", category: "" };
const emptyFormBaseline = linkFormSignature(emptyForm);
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

function linkHost(value: string) {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function safeServerMessage(error: unknown) {
  if (!(error instanceof ApiError) || error.status >= 500) return getErrorText(error);
  if (typeof error.payload !== "object" || error.payload === null) return getErrorText(error);

  const message = (error.payload as Record<string, unknown>).message;
  if (
    typeof message === "string" &&
    message.length <= 300 &&
    !/[<>\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(message)
  ) {
    return message;
  }
  return getErrorText(error);
}

function ListLoadingState() {
  return (
    <div className={styles.loadingState} role="status" aria-label="링크 목록을 불러오는 중">
      <span />
      <span />
      <span />
    </div>
  );
}

export default function ManageLinksPage() {
  const [links, setLinks] = useState<ManagedLink[]>([]);
  const [listState, setListState] = useState<LoadState>("idle");
  const [listError, setListError] = useState("");
  const [selected, setSelected] = useState<ManagedLink | null>(null);
  const [form, setForm] = useState<LinkForm>({ ...emptyForm });
  const [baseline, setBaseline] = useState(emptyFormBaseline);
  const [fieldErrors, setFieldErrors] = useState<LinkFieldErrors>({});
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>("");
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");

  const listController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const mutationInProgress = useRef(false);
  const selectedIdRef = useRef<number | null>(null);
  const editorRef = useRef<HTMLElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const urlInputRef = useRef<HTMLInputElement | null>(null);
  const categoryInputRef = useRef<HTMLInputElement | null>(null);

  const isBusy = Boolean(busyAction);
  const isCreateMode = selected === null;
  const isDirty = linkFormSignature(form) !== baseline;
  const normalizedCategory = normalizeLinkCategory(form.category);
  const canPreviewUrl = isValidExternalLinkUrl(form.url);

  const categories = useMemo(
    () => Array.from(new Set(links.map((link) => link.category))).sort((a, b) => a.localeCompare(b, "ko")),
    [links],
  );
  const filteredLinks = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("ko-KR");
    return links.filter((link) => {
      const matchesCategory = !categoryFilter || link.category === categoryFilter;
      const matchesQuery = !normalizedQuery || [link.name, link.url, link.category]
        .some((value) => value.toLocaleLowerCase("ko-KR").includes(normalizedQuery));
      return matchesCategory && matchesQuery;
    });
  }, [categoryFilter, links, query]);

  const focusEditor = useCallback((focusName = false) => {
    window.requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 980px)").matches) {
        editorRef.current?.scrollIntoView({ block: "start" });
      }
      if (focusName) nameInputRef.current?.focus();
    });
  }, []);

  const enterCreateMode = useCallback((focusName = false) => {
    selectedIdRef.current = null;
    setSelected(null);
    setForm({ ...emptyForm });
    setBaseline(emptyFormBaseline);
    setFieldErrors({});
    setDeleteOpen(false);
    if (focusName) focusEditor(true);
  }, [focusEditor]);

  const enterEditMode = useCallback((link: ManagedLink, reveal = false) => {
    const nextForm = formFromManagedLink(link);
    selectedIdRef.current = link.id;
    setSelected(link);
    setForm(nextForm);
    setBaseline(linkFormSignature(nextForm));
    setFieldErrors({});
    setDeleteOpen(false);
    if (reveal) focusEditor(false);
  }, [focusEditor]);

  const loadLinks = useCallback(async (selectId?: number | null) => {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setListState("loading");
    setListError("");

    try {
      const response = await apiFetch<unknown>(LINKS_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      const nextLinks = parseManagedLinks(response);
      setLinks(nextLinks);
      setListState("ready");

      const targetId = selectId === undefined ? selectedIdRef.current : selectId;
      if (targetId !== null) {
        const refreshed = nextLinks.find((link) => link.id === targetId);
        if (refreshed) {
          enterEditMode(refreshed);
        } else {
          enterCreateMode();
          setFeedback({
            tone: "info",
            title: "선택한 링크를 찾을 수 없습니다.",
            message: "최신 목록으로 정리했습니다. 새 링크를 등록하거나 다른 링크를 선택해 주세요.",
          });
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setListState("error");
      setListError(safeServerMessage(error));
    } finally {
      if (listController.current === controller) listController.current = null;
    }
  }, [enterCreateMode, enterEditMode]);

  const loadLinkDetail = useCallback(async (linkId: number) => {
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;
    setDetailLoadingId(linkId);
    setFeedback(null);

    try {
      const response = await apiFetch<unknown>(`${LINKS_ENDPOINT}/${linkId}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      enterEditMode(parseManagedLink(response), true);
    } catch (error) {
      if (controller.signal.aborted) return;
      if (error instanceof ApiError && error.status === 404) {
        enterCreateMode();
        setFeedback({
          tone: "info",
          title: "해당 링크가 이미 삭제되었습니다.",
          message: "최신 목록을 다시 불러왔습니다.",
        });
        await loadLinks(null);
      } else {
        setFeedback({
          tone: "error",
          title: "링크 상세 정보를 불러오지 못했습니다.",
          message: safeServerMessage(error),
        });
      }
    } finally {
      if (detailController.current === controller) detailController.current = null;
      setDetailLoadingId((current) => (current === linkId ? null : current));
    }
  }, [enterCreateMode, enterEditMode, loadLinks]);

  useEffect(() => {
    const handleSessionChange = () => {
      if (getAdminSession()) {
        void loadLinks(null);
        return;
      }

      listController.current?.abort();
      detailController.current?.abort();
      setLinks([]);
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
  }, [enterCreateMode, loadLinks]);

  function updateField<K extends keyof LinkForm>(key: K, value: LinkForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const validation = validateLinkForm({ ...form, [key]: value });
      return { ...current, [key]: validation.ok ? "" : validation.errors[key] ?? "" };
    });
    setFeedback(null);
  }

  function validateFieldOnBlur(field: keyof LinkForm) {
    const validation = validateLinkForm(form);
    setFieldErrors((current) => ({
      ...current,
      [field]: validation.ok ? "" : validation.errors[field] ?? "",
    }));
  }

  function requestSelection(linkId: number) {
    if (isBusy || detailLoadingId !== null || selected?.id === linkId) return;
    if (isDirty) {
      setPendingAction({ kind: "select", linkId });
      return;
    }
    void loadLinkDetail(linkId);
  }

  function requestCreateMode() {
    if (isBusy || detailLoadingId !== null) return;
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
    if (isBusy || detailLoadingId !== null || listState === "loading") return;
    if (isDirty) {
      setPendingAction({ kind: "refresh" });
      return;
    }
    void loadLinks();
  }

  function confirmPendingAction() {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;

    if (action.kind === "select") {
      void loadLinkDetail(action.linkId);
      return;
    }
    if (action.kind === "create") {
      setFeedback(null);
      enterCreateMode(true);
      return;
    }
    setFeedback(null);
    enterCreateMode();
    void loadLinks(null);
  }

  function resetForm() {
    setFeedback(null);
    if (selected) enterEditMode(selected);
    else enterCreateMode(true);
  }

  function validatedPayload() {
    const validation = validateLinkForm(form);
    if (validation.ok) {
      setFieldErrors({});
      return validation.payload;
    }

    setFieldErrors(validation.errors);
    if (validation.errors.name) nameInputRef.current?.focus();
    else if (validation.errors.url) urlInputRef.current?.focus();
    else if (validation.errors.category) categoryInputRef.current?.focus();
    return null;
  }

  async function submitLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationInProgress.current) return;

    setFeedback(null);
    const payload = validatedPayload();
    if (!payload) return;

    mutationInProgress.current = true;
    setBusyAction(isCreateMode ? "create" : "update");
    try {
      if (isCreateMode) {
        const created = parseManagedLink(await apiFetch<unknown>(ADMIN_LINKS_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }));
        enterEditMode(created);
        setFeedback({
          tone: "success",
          title: "링크를 등록했습니다.",
          message: "새 링크가 목록에 반영되었습니다.",
        });
        await loadLinks(created.id);
      } else if (selected) {
        const original = selected;
        const updated = parseManagedLink(await apiFetch<unknown>(`${ADMIN_LINKS_ENDPOINT}/${selected.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }));
        if (updated.id !== original.id || updated.createdAt !== original.createdAt) {
          throw new Error("저장된 링크 정보가 요청과 일치하지 않습니다.");
        }
        enterEditMode(updated);
        setFeedback({
          tone: "success",
          title: "링크를 수정했습니다.",
          message: "변경한 이름, 주소, 카테고리가 저장되었습니다.",
        });
        await loadLinks(updated.id);
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        enterCreateMode();
        setFeedback({
          tone: "info",
          title: "해당 링크가 이미 삭제되었습니다.",
          message: "최신 목록을 다시 불러왔습니다.",
        });
        await loadLinks(null);
      } else {
        setFeedback({
          tone: "error",
          title: isCreateMode ? "링크를 등록하지 못했습니다." : "변경사항을 저장하지 못했습니다.",
          message: safeServerMessage(error),
        });
      }
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  async function deleteLink() {
    if (!selected || mutationInProgress.current) return;

    mutationInProgress.current = true;
    setBusyAction("delete");
    setFeedback(null);
    try {
      await apiFetch<void>(`${ADMIN_LINKS_ENDPOINT}/${selected.id}`, { method: "DELETE" });
      setDeleteOpen(false);
      enterCreateMode();
      setFeedback({
        tone: "success",
        title: "링크를 삭제했습니다.",
        message: "선택한 링크가 목록에서 영구 삭제되었습니다.",
      });
      await loadLinks(null);
    } catch (error) {
      setDeleteOpen(false);
      if (error instanceof ApiError && error.status === 404) {
        enterCreateMode();
        setFeedback({
          tone: "info",
          title: "해당 링크가 이미 삭제되었습니다.",
          message: "최신 목록을 다시 불러왔습니다.",
        });
        await loadLinks(null);
      } else {
        setFeedback({
          tone: "error",
          title: "링크를 삭제하지 못했습니다.",
          message: safeServerMessage(error),
        });
      }
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  return (
    <AdminLoginNotice returnTo="/settings/links">
      <UnsavedChangesDialog dirty={isDirty} />

      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <h2>각종 링크</h2>
            <p>학교생활에 필요한 외부 사이트를 등록하고 관리합니다.</p>
          </div>
          <div className={styles.pageActions}>
            <button
              className={`${styles.button} ${styles.secondaryButton}`}
              type="button"
              onClick={requestRefresh}
              disabled={isBusy || detailLoadingId !== null || listState === "loading"}
            >
              <ArrowClockwise size={17} aria-hidden="true" />
              {listState === "loading" ? "불러오는 중" : "새로고침"}
            </button>
            <button
              className={`${styles.button} ${styles.primaryButton}`}
              type="button"
              onClick={requestCreateMode}
              disabled={isBusy || detailLoadingId !== null}
            >
              <Plus size={17} aria-hidden="true" />
              새 링크
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
          <section className={`${styles.panel} ${styles.listPanel}`} aria-labelledby="links-list-title">
            <header className={styles.panelHeader}>
              <div>
                <span className={styles.panelIcon} aria-hidden="true"><LinkSimple size={20} /></span>
                <div>
                  <h3 id="links-list-title">링크 목록</h3>
                  <p>이름, 주소 또는 카테고리로 찾을 수 있습니다.</p>
                </div>
              </div>
              <span className={styles.countBadge}>
                {filteredLinks.length === links.length ? `${links.length}개` : `${filteredLinks.length}/${links.length}개`}
              </span>
            </header>

            <div className={styles.listControls}>
              <label className={styles.searchField}>
                <MagnifyingGlass size={17} aria-hidden="true" />
                <span className="sr-only">링크 검색</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="링크 검색"
                />
              </label>
              <label className={styles.filterField}>
                <span className="sr-only">카테고리 필터</span>
                <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                  <option value="">모든 카테고리</option>
                  {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
            </div>

            {listState === "error" && links.length > 0 && (
              <div className={styles.inlineListError} role="alert">
                <WarningCircle size={18} aria-hidden="true" />
                <span>{listError}</span>
                <button type="button" onClick={() => void loadLinks()}>다시 시도</button>
              </div>
            )}

            <div className={styles.listBody} aria-live="polite" aria-busy={listState === "loading" || undefined}>
              {(listState === "idle" || listState === "loading") && links.length === 0 ? (
                <ListLoadingState />
              ) : listState === "error" && links.length === 0 ? (
                <div className={styles.statePanel} role="alert">
                  <WarningCircle size={27} aria-hidden="true" />
                  <strong>링크 목록을 불러오지 못했습니다.</strong>
                  <p>{listError}</p>
                  <button className={`${styles.button} ${styles.secondaryButton}`} type="button" onClick={() => void loadLinks(null)}>
                    다시 시도
                  </button>
                </div>
              ) : links.length === 0 ? (
                <div className={styles.statePanel} role="status">
                  <LinkSimple size={28} aria-hidden="true" />
                  <strong>등록된 링크가 없습니다.</strong>
                  <p>학생들에게 필요한 첫 링크를 등록해 보세요.</p>
                  <button className={`${styles.button} ${styles.primaryButton}`} type="button" onClick={requestCreateMode}>
                    <Plus size={17} aria-hidden="true" /> 첫 링크 등록
                  </button>
                </div>
              ) : filteredLinks.length === 0 ? (
                <div className={styles.statePanel} role="status">
                  <MagnifyingGlass size={28} aria-hidden="true" />
                  <strong>검색 결과가 없습니다.</strong>
                  <p>검색어나 카테고리를 바꿔 보세요.</p>
                  <button className={`${styles.button} ${styles.secondaryButton}`} type="button" onClick={() => { setQuery(""); setCategoryFilter(""); }}>
                    검색 초기화
                  </button>
                </div>
              ) : (
                <ol className={styles.linkList}>
                  {filteredLinks.map((link) => {
                    const active = selected?.id === link.id;
                    const loading = detailLoadingId === link.id;
                    return (
                      <li key={link.id} className={`${styles.linkItem} ${active ? styles.activeLinkItem : ""}`}>
                        <button
                          className={styles.linkSelect}
                          type="button"
                          aria-pressed={active}
                          disabled={isBusy || detailLoadingId !== null}
                          onClick={() => requestSelection(link.id)}
                        >
                          <span className={styles.linkCopy}>
                            <span className={styles.linkTopline}>
                              <strong>{link.name}</strong>
                              <span className={styles.categoryBadge}>{link.category}</span>
                            </span>
                            <span className={styles.host}>{linkHost(link.url)}</span>
                            <time dateTime={link.updatedAt}>최근 수정 {formatDateTime(link.updatedAt)}</time>
                          </span>
                          <NotePencil size={18} aria-hidden="true" />
                          {loading && <span className={styles.loadingLabel}>불러오는 중</span>}
                        </button>
                        <a className={styles.visitLink} href={link.url} target="_blank" rel="noreferrer" aria-label={`${link.name} 새 창에서 열기`}>
                          <ArrowSquareOut size={17} aria-hidden="true" />
                        </a>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>

          <section ref={editorRef} className={`${styles.panel} ${styles.editorPanel}`} aria-labelledby="link-editor-title" tabIndex={-1}>
            <header className={styles.editorHeader}>
              <div>
                <span className={styles.modeLabel}>{isCreateMode ? "새 링크" : "링크 수정"}</span>
                <h3 id="link-editor-title">{isCreateMode ? "새 링크 등록" : "선택한 링크 수정"}</h3>
                <p>{isCreateMode ? "이름, 주소, 카테고리를 입력해 주세요." : "세 항목을 모두 확인한 뒤 저장해 주세요."}</p>
              </div>
              {isDirty && <span className={styles.unsavedBadge}>저장 전 변경</span>}
            </header>

            {!isCreateMode && selected && (
              <dl className={styles.linkMeta} aria-label="선택한 링크의 등록 정보">
                <div><dt>처음 등록</dt><dd><time dateTime={selected.createdAt}>{formatDateTime(selected.createdAt)}</time></dd></div>
                <div><dt>최근 수정</dt><dd><time dateTime={selected.updatedAt}>{formatDateTime(selected.updatedAt)}</time></dd></div>
              </dl>
            )}

            <form className={styles.form} onSubmit={submitLink} noValidate>
              <fieldset disabled={isBusy || detailLoadingId !== null}>
                <label className={styles.field} htmlFor="managed-link-name">
                  <span className={styles.fieldHeading}><span>링크 이름 <em>필수</em></span><small>{form.name.length} / 100</small></span>
                  <input
                    ref={nameInputRef}
                    id="managed-link-name"
                    name="name"
                    type="text"
                    value={form.name}
                    maxLength={100}
                    placeholder="예: 한서대학교 홈페이지"
                    aria-invalid={Boolean(fieldErrors.name) || undefined}
                    aria-describedby={fieldErrors.name ? "managed-link-name-error" : undefined}
                    onChange={(event) => updateField("name", event.target.value)}
                    onBlur={() => validateFieldOnBlur("name")}
                    required
                  />
                  {fieldErrors.name && <span id="managed-link-name-error" className={styles.fieldError}>{fieldErrors.name}</span>}
                </label>

                <label className={styles.field} htmlFor="managed-link-url">
                  <span className={styles.fieldHeading}><span>이동할 주소 <em>필수</em></span><small>{form.url.length} / 2,048</small></span>
                  <input
                    ref={urlInputRef}
                    id="managed-link-url"
                    name="url"
                    type="url"
                    inputMode="url"
                    value={form.url}
                    maxLength={2048}
                    placeholder="https://www.example.com"
                    aria-invalid={Boolean(fieldErrors.url) || undefined}
                    aria-describedby={`managed-link-url-help${fieldErrors.url ? " managed-link-url-error" : ""}`}
                    onChange={(event) => updateField("url", event.target.value)}
                    onBlur={() => validateFieldOnBlur("url")}
                    required
                  />
                  <span id="managed-link-url-help" className={styles.fieldHelp}>http:// 또는 https://로 시작하는 전체 주소를 입력해 주세요.</span>
                  {fieldErrors.url && <span id="managed-link-url-error" className={styles.fieldError}>{fieldErrors.url}</span>}
                  {canPreviewUrl && (
                    <a className={styles.previewLink} href={form.url.trim()} target="_blank" rel="noreferrer">
                      입력한 주소 확인 <ArrowSquareOut size={15} aria-hidden="true" />
                    </a>
                  )}
                </label>

                <label className={styles.field} htmlFor="managed-link-category">
                  <span className={styles.fieldHeading}><span>카테고리 <em>필수</em></span><small>{normalizedCategory.length} / 50</small></span>
                  <input
                    ref={categoryInputRef}
                    id="managed-link-category"
                    name="category"
                    type="text"
                    value={form.category}
                    maxLength={50}
                    list="managed-link-categories"
                    placeholder="예: SCHOOL 또는 학교생활"
                    aria-invalid={Boolean(fieldErrors.category) || undefined}
                    aria-describedby={`managed-link-category-help${fieldErrors.category ? " managed-link-category-error" : ""}`}
                    onChange={(event) => updateField("category", event.target.value)}
                    onBlur={() => validateFieldOnBlur("category")}
                    required
                  />
                  <datalist id="managed-link-categories">
                    {categories.map((category) => <option key={category} value={category} />)}
                  </datalist>
                  <span id="managed-link-category-help" className={styles.fieldHelp}>
                    자유롭게 입력할 수 있으며, 영문은 저장할 때 대문자로 정리됩니다.
                    {normalizedCategory && <span className={styles.categoryPreview}> 저장값: {normalizedCategory}</span>}
                  </span>
                  {fieldErrors.category && <span id="managed-link-category-error" className={styles.fieldError}>{fieldErrors.category}</span>}
                </label>
              </fieldset>

              <div className={styles.formActions}>
                {!isCreateMode && (
                  <button className={`${styles.button} ${styles.dangerButton}`} type="button" onClick={() => setDeleteOpen(true)} disabled={isBusy}>
                    <Trash size={17} aria-hidden="true" /> 삭제
                  </button>
                )}
                <span className={styles.actionSpacer} />
                <button className={`${styles.button} ${styles.secondaryButton}`} type="button" onClick={resetForm} disabled={isBusy || !isDirty}>
                  변경 취소
                </button>
                <button className={`${styles.button} ${styles.primaryButton}`} type="submit" disabled={isBusy || detailLoadingId !== null}>
                  {busyAction === "create" ? "등록 중..." : busyAction === "update" ? "저장 중..." : isCreateMode ? "링크 등록" : "변경사항 저장"}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title="이 링크를 영구 삭제할까요?"
        description={`‘${selected?.name ?? "선택한 링크"}’은 삭제 후 복구할 수 없습니다.`}
        confirmLabel="영구 삭제"
        busy={busyAction === "delete"}
        danger
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void deleteLink()}
      />
      <ConfirmDialog
        open={Boolean(pendingAction)}
        title="저장하지 않은 변경사항이 있습니다."
        description="계속하면 지금 입력한 내용이 사라집니다. 변경사항을 버릴까요?"
        confirmLabel="변경사항 버리기"
        danger
        onCancel={() => setPendingAction(null)}
        onConfirm={confirmPendingAction}
      />
    </AdminLoginNotice>
  );
}
