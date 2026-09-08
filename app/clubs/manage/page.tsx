"use client";

import { ArrowLeft, ImageSquare, Info } from "@phosphor-icons/react";
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
import { UnsavedChangesDialog } from "../../components/UnsavedChangesDialog";
import { ADMIN_SESSION_EVENT, getAdminSession } from "../../lib/auth";
import { apiFetch, getErrorText } from "../../lib/api";
import {
  type ClubCategory,
  type ClubDetail,
  type ClubForm,
  type ClubSummary,
  clubCategories,
  clubDetailToForm,
  clubFormToUpdatePayload,
  getClubCategoryLabel,
  getReviewTagLabel,
  initialClubForm,
  isValidHttpUrl,
  parseClubDetail,
  parseClubSummaries,
} from "../../lib/clubs";

type ImageKind = "profile" | "background";
type ConfirmTarget = ImageKind | "club" | null;
type Feedback = { tone: "success" | "error"; title: string; message: string };
type ListState = "idle" | "loading" | "ready" | "error";
type DetailState = "idle" | "loading" | "ready" | "error";
type CategoryFilter = "ALL" | ClubCategory;

const imageRules = {
  profile: { title: "대표 사진", description: "정사각형 사진 권장", endpoint: "profile-images" },
  background: { title: "배경 사진", description: "가로형 사진 권장", endpoint: "background-images" },
} as const;

const emptyFiles: Record<ImageKind, File | null> = { profile: null, background: null };
const emptyImageUrls: Record<ImageKind, string> = { profile: "", background: "" };

function validateImage(file: File) {
  if (!( ["image/jpeg", "image/png", "image/gif"] as string[]).includes(file.type)) {
    return "JPG, JPEG, PNG, GIF 사진만 선택할 수 있습니다.";
  }
  if (file.size === 0) return "내용이 없는 사진은 사용할 수 없습니다.";
  if (file.size > 5 * 1024 * 1024) return "사진 크기는 5MB 이하여야 합니다.";
  return null;
}

function ImagePreview({ file, imageUrl, alt }: { file: File | null; imageUrl: string; alt: string }) {
  const imageRef = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    if (!file || !imageRef.current) return;
    const objectUrl = URL.createObjectURL(file);
    imageRef.current.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (file || imageUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img ref={imageRef} src={file ? undefined : imageUrl} alt={alt} />;
  }
  return <div className="image-placeholder"><ImageSquare size={24} aria-hidden="true" /><small>등록된 사진 없음</small></div>;
}

function updateUrlClubId(clubId: number | null) {
  const url = new URL(window.location.href);
  if (clubId) url.searchParams.set("id", String(clubId));
  else url.searchParams.delete("id");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

export default function ManageClubPage() {
  const [hasSession, setHasSession] = useState<boolean | null>(null);
  const [clubs, setClubs] = useState<ClubSummary[]>([]);
  const [listState, setListState] = useState<ListState>("idle");
  const [listError, setListError] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClub, setSelectedClub] = useState<ClubSummary | null>(null);
  const [detail, setDetail] = useState<ClubDetail | null>(null);
  const [detailState, setDetailState] = useState<DetailState>("idle");
  const [detailError, setDetailError] = useState("");
  const [form, setForm] = useState<ClubForm>({ ...initialClubForm });
  const [baseline, setBaseline] = useState(JSON.stringify(initialClubForm));
  const [files, setFiles] = useState<Record<ImageKind, File | null>>({ ...emptyFiles });
  const [imageUrls, setImageUrls] = useState<Record<ImageKind, string>>({ ...emptyImageUrls });
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget>(null);
  const [pendingClub, setPendingClub] = useState<ClubSummary | null>(null);
  const listController = useRef<AbortController | null>(null);
  const detailController = useRef<AbortController | null>(null);
  const editorHeadingRef = useRef<HTMLDivElement | null>(null);

  const isTextDirty = useMemo(() => JSON.stringify(form) !== baseline, [baseline, form]);
  const hasPendingImage = Boolean(files.profile || files.background);
  const hasUnsavedChanges = isTextDirty || hasPendingImage;
  const isBusy = Boolean(busyAction);

  const loadClubDetails = useCallback(async (club: ClubSummary) => {
    detailController.current?.abort();
    const controller = new AbortController();
    detailController.current = controller;

    setSelectedClub(club);
    setDetail(null);
    setDetailState("loading");
    setDetailError("");
    setFeedback(null);
    setFiles({ ...emptyFiles });
    updateUrlClubId(club.id);

    try {
      const payload = await apiFetch<unknown>(`/api/admin/clubs/${club.id}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      const nextDetail = parseClubDetail(payload);
      const nextForm = clubDetailToForm(nextDetail);
      setDetail(nextDetail);
      setForm(nextForm);
      setBaseline(JSON.stringify(nextForm));
      setImageUrls({
        profile: nextDetail.profileImageUrl ?? "",
        background: nextDetail.backgroundImageUrl ?? "",
      });
      setDetailState("ready");

      window.requestAnimationFrame(() => {
        if (window.matchMedia("(max-width: 900px)").matches) {
          editorHeadingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setDetailState("error");
      setDetailError(getErrorText(error));
    } finally {
      if (detailController.current === controller) detailController.current = null;
    }
  }, []);

  const loadClubs = useCallback(async (filter: CategoryFilter, autoSelectId?: number | null) => {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setListState("loading");
    setListError("");

    const query = filter === "ALL" ? "" : `?category=${encodeURIComponent(filter)}`;
    try {
      const payload = await apiFetch<unknown>(`/api/admin/clubs${query}`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      const nextClubs = parseClubSummaries(payload);
      setClubs(nextClubs);
      setListState("ready");
      setSelectedClub((current) => {
        if (!current) return null;
        return nextClubs.find((item) => item.id === current.id) ?? current;
      });

      if (autoSelectId) {
        const target = nextClubs.find((item) => item.id === autoSelectId);
        if (target) {
          await loadClubDetails(target);
        } else {
          setFeedback({
            tone: "error",
            title: "선택한 동아리를 찾지 못했습니다.",
            message: "목록을 새로고침하거나 분과 필터를 전체로 바꾼 뒤 다시 확인해 주세요.",
          });
        }
      }
    } catch (error) {
      if (controller.signal.aborted) return;
      setListState("error");
      setListError(getErrorText(error));
    } finally {
      if (listController.current === controller) listController.current = null;
    }
  }, [loadClubDetails]);

  useEffect(() => {
    const updateSession = () => {
      const available = Boolean(getAdminSession());
      setHasSession(available);
      if (!available) {
        setListState("idle");
        setClubs([]);
      }
    };

    const timeoutId = window.setTimeout(() => {
      updateSession();
      if (getAdminSession()) {
        const value = new URLSearchParams(window.location.search).get("id");
        const requestedId = value && /^\d+$/.test(value) ? Number(value) : null;
        void loadClubs("ALL", requestedId);
      }
    }, 0);

    window.addEventListener(ADMIN_SESSION_EVENT, updateSession);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener(ADMIN_SESSION_EVENT, updateSession);
      listController.current?.abort();
      detailController.current?.abort();
    };
  }, [loadClubs]);

  useEffect(() => {
    if (!hasUnsavedChanges) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [hasUnsavedChanges]);

  const visibleClubs = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("ko-KR");
    if (!query) return clubs;
    return clubs.filter((club) => club.name.toLocaleLowerCase("ko-KR").includes(query));
  }, [clubs, searchQuery]);

  function setField<K extends keyof ClubForm>(key: K, value: ClubForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function requestClubSelection(club: ClubSummary) {
    if (selectedClub?.id === club.id) return;
    if (hasUnsavedChanges) {
      setPendingClub(club);
      return;
    }
    void loadClubDetails(club);
  }

  function confirmClubSelection() {
    const target = pendingClub;
    setPendingClub(null);
    if (target) void loadClubDetails(target);
  }

  function handleCategoryChange(value: CategoryFilter) {
    setCategoryFilter(value);
    setSearchQuery("");
    if (hasSession) void loadClubs(value);
  }

  async function handleDetailsSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);
    if (!selectedClub || detailState !== "ready" || !isTextDirty || isBusy) return;

    const payload = clubFormToUpdatePayload(form);
    if (!payload.name || payload.name.length > 100) {
      setFeedback({ tone: "error", title: "이름을 확인해 주세요.", message: "동아리 이름은 필수이며 100자 이하여야 합니다." });
      return;
    }
    if (!payload.shortDescription || payload.shortDescription.length > 255) {
      setFeedback({ tone: "error", title: "한 줄 소개를 확인해 주세요.", message: "한 줄 소개는 필수이며 255자 이하여야 합니다." });
      return;
    }
    if ((payload.instagramUrl?.length ?? 0) > 2048 || (payload.kakaoTalkUrl?.length ?? 0) > 2048) {
      setFeedback({ tone: "error", title: "링크가 너무 깁니다.", message: "주소를 다시 확인한 뒤 입력해 주세요." });
      return;
    }
    if (!isValidHttpUrl(form.instagramUrl) || !isValidHttpUrl(form.kakaoTalkUrl)) {
      setFeedback({ tone: "error", title: "링크를 확인해 주세요.", message: "올바른 웹 주소를 입력해 주세요. 예: https://instagram.com/..." });
      return;
    }

    const id = selectedClub.id;
    setBusyAction("details");
    try {
      await apiFetch<void>(`/api/admin/clubs/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const normalizedForm: ClubForm = {
        name: payload.name,
        shortDescription: payload.shortDescription,
        introduction: payload.introduction ?? "",
        activityContent: payload.activityContent ?? "",
        instagramUrl: payload.instagramUrl ?? "",
        kakaoTalkUrl: payload.kakaoTalkUrl ?? "",
        recruitmentContent: payload.recruitmentContent ?? "",
      };
      setForm(normalizedForm);
      setBaseline(JSON.stringify(normalizedForm));
      setDetail((current) => current ? { ...current, ...payload } : current);
      setClubs((current) => current.map((club) => club.id === id
        ? { ...club, name: payload.name, shortDescription: payload.shortDescription }
        : club));
      setSelectedClub((current) => current?.id === id
        ? { ...current, name: payload.name, shortDescription: payload.shortDescription }
        : current);
      setFeedback({ tone: "success", title: `${payload.name} 정보 저장 완료`, message: "수정한 소개와 활동 내용이 반영되었습니다." });
    } catch (error) {
      setFeedback({ tone: "error", title: "동아리 정보를 저장하지 못했습니다.", message: getErrorText(error) });
    } finally {
      setBusyAction("");
    }
  }

  function chooseImage(kind: ImageKind, file: File | null) {
    if (!file) return;
    const error = validateImage(file);
    if (error) {
      setFeedback({ tone: "error", title: `${imageRules[kind].title}를 선택할 수 없습니다.`, message: error });
      return;
    }
    setFeedback(null);
    setFiles((current) => ({ ...current, [kind]: file }));
  }

  function cancelImageSelection(kind: ImageKind) {
    setFiles((current) => ({ ...current, [kind]: null }));
  }

  async function uploadImage(kind: ImageKind) {
    const file = files[kind];
    if (!selectedClub || !file) return;

    const id = selectedClub.id;
    setBusyAction(kind);
    setFeedback(null);
    const body = new FormData();
    body.append("file", file, file.name);
    try {
      const response = await apiFetch<{ imageUrl: string }>(`/api/admin/clubs/${imageRules[kind].endpoint}/${id}`, {
        method: "PUT",
        body,
      });
      if (!response || typeof response.imageUrl !== "string") {
        throw new Error("사진 저장 결과를 확인할 수 없습니다. 다시 시도해 주세요.");
      }

      setImageUrls((current) => ({ ...current, [kind]: response.imageUrl }));
      setFiles((current) => ({ ...current, [kind]: null }));
      setDetail((current) => current ? {
        ...current,
        [kind === "profile" ? "profileImageUrl" : "backgroundImageUrl"]: response.imageUrl,
      } : current);
      if (kind === "profile") {
        setClubs((current) => current.map((club) => club.id === id
          ? { ...club, profileImageUrl: response.imageUrl }
          : club));
        setSelectedClub((current) => current?.id === id
          ? { ...current, profileImageUrl: response.imageUrl }
          : current);
      }
      setFeedback({ tone: "success", title: `${imageRules[kind].title} 변경 완료`, message: "기존 사진이 선택한 새 사진으로 바뀌었습니다." });
    } catch (error) {
      setFeedback({ tone: "error", title: `${imageRules[kind].title}를 저장하지 못했습니다.`, message: getErrorText(error) });
    } finally {
      setBusyAction("");
    }
  }

  function clearSelection() {
    detailController.current?.abort();
    setSelectedClub(null);
    setDetail(null);
    setDetailState("idle");
    setDetailError("");
    setForm({ ...initialClubForm });
    setBaseline(JSON.stringify(initialClubForm));
    setFiles({ ...emptyFiles });
    setImageUrls({ ...emptyImageUrls });
    updateUrlClubId(null);
  }

  async function executeDelete() {
    if (!selectedClub || !confirmTarget) {
      setConfirmTarget(null);
      return;
    }
    const id = selectedClub.id;
    const clubName = selectedClub.name;
    const target = confirmTarget;
    setBusyAction(`delete-${target}`);
    setFeedback(null);
    try {
      if (target === "club") {
        await apiFetch<void>(`/api/admin/clubs/${id}`, { method: "DELETE" });
        setClubs((current) => current.filter((club) => club.id !== id));
        clearSelection();
        setFeedback({ tone: "success", title: `${clubName} 삭제 완료`, message: "동아리 정보와 사진, 좋아요, 후기가 함께 삭제되었습니다." });
      } else {
        await apiFetch<void>(`/api/admin/clubs/${imageRules[target].endpoint}/${id}`, { method: "DELETE" });
        setImageUrls((current) => ({ ...current, [target]: "" }));
        setFiles((current) => ({ ...current, [target]: null }));
        setDetail((current) => current ? {
          ...current,
          [target === "profile" ? "profileImageUrl" : "backgroundImageUrl"]: null,
        } : current);
        if (target === "profile") {
          setClubs((current) => current.map((club) => club.id === id
            ? { ...club, profileImageUrl: null }
            : club));
          setSelectedClub((current) => current?.id === id
            ? { ...current, profileImageUrl: null }
            : current);
        }
        setFeedback({ tone: "success", title: `${imageRules[target].title}을 삭제했습니다.`, message: "다른 사진은 그대로 유지됩니다." });
      }
    } catch (error) {
      setFeedback({ tone: "error", title: "선택한 항목을 삭제하지 못했습니다.", message: getErrorText(error) });
    } finally {
      setBusyAction("");
      setConfirmTarget(null);
    }
  }

  const confirmIsClub = confirmTarget === "club";
  const confirmTitle = confirmIsClub
    ? `${selectedClub?.name ?? "선택한 동아리"}를 정말 삭제할까요?`
    : `${confirmTarget ? imageRules[confirmTarget].title : "사진"}을 지울까요?`;
  const confirmDescription = confirmIsClub
    ? "동아리 소개와 사진, 좋아요와 후기가 모두 사라지며 되돌릴 수 없습니다."
    : "이 사진만 지워지고 다른 사진은 그대로 유지됩니다.";

  return (
    <AdminLoginNotice returnTo="/clubs/manage">
      <UnsavedChangesDialog dirty={hasUnsavedChanges} />
      <div className="stack-lg">
      <div className="club-management-layout">
        <aside className="panel club-list-panel" aria-labelledby="club-list-title">
          <div className="club-list-heading">
            <div>
              <span className="eyebrow dark">수정 대상 선택</span>
              <h2 id="club-list-title">동아리 목록</h2>
            </div>
            <span>{listState === "ready" ? `${clubs.length}개` : "-"}</span>
          </div>

          <div className="club-list-controls">
            <label className="field-group">
              <span className="sr-only">동아리 검색</span>
              <input
                type="search"
                value={searchQuery}
                placeholder="동아리 이름 검색"
                onChange={(event) => setSearchQuery(event.target.value)}
                disabled={!hasSession || listState === "loading"}
              />
            </label>
            <label className="field-group">
              <span className="sr-only">분과 필터</span>
              <select
                value={categoryFilter}
                onChange={(event) => handleCategoryChange(event.target.value as CategoryFilter)}
                disabled={!hasSession || listState === "loading"}
              >
                <option value="ALL">전체 분과</option>
                {clubCategories.map((category) => (
                  <option value={category.value} key={category.value}>{category.label}</option>
                ))}
              </select>
            </label>
            <button
              className="button button-secondary club-list-refresh"
              type="button"
              onClick={() => void loadClubs(categoryFilter)}
              disabled={!hasSession || listState === "loading"}
            >
              {listState === "loading" ? "불러오는 중..." : "목록 새로고침"}
            </button>
          </div>

          <div className="club-list-results" aria-live="polite">
            {hasSession === null && <p className="club-list-message">로그인 상태를 확인하고 있습니다.</p>}
            {hasSession === false && (
              <div className="club-list-message">
                <p>로그인 후 동아리 목록을 불러올 수 있습니다.</p>
                <Link href="/login?returnTo=%2Fclubs%2Fmanage">관리자 로그인</Link>
              </div>
            )}
            {hasSession && listState === "loading" && <p className="club-list-message">동아리 목록을 불러오고 있습니다.</p>}
            {hasSession && listState === "error" && (
              <div className="club-list-message error">
                <strong>목록을 불러오지 못했습니다.</strong>
                <p>{listError}</p>
                <button type="button" onClick={() => void loadClubs(categoryFilter)}>다시 시도</button>
              </div>
            )}
            {hasSession && listState === "ready" && clubs.length === 0 && (
              <div className="club-list-message">
                <p>이 분과에 등록된 동아리가 없습니다.</p>
                <Link href="/clubs/new">동아리 등록</Link>
              </div>
            )}
            {hasSession && listState === "ready" && clubs.length > 0 && visibleClubs.length === 0 && (
              <p className="club-list-message">검색 조건에 맞는 동아리가 없습니다.</p>
            )}

            {visibleClubs.map((club) => (
              <button
                className={`club-list-item ${selectedClub?.id === club.id ? "selected" : ""}`}
                type="button"
                key={club.id}
                aria-pressed={selectedClub?.id === club.id}
                onClick={() => requestClubSelection(club)}
                disabled={isBusy}
              >
                <span className="club-list-thumbnail" aria-hidden="true">
                  {club.profileImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={club.profileImageUrl} alt="" />
                  ) : club.name.slice(0, 1)}
                </span>
                <span className="club-list-copy">
                  <strong>{club.name}</strong>
                  <small>{getClubCategoryLabel(club.category)}</small>
                  <em>{club.shortDescription || "한 줄 소개 미등록"}</em>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className="club-editor-stack" ref={editorHeadingRef}>
          {feedback && (
            <div className={`feedback feedback-${feedback.tone} page-feedback`} role={feedback.tone === "error" ? "alert" : "status"}>
              <strong>{feedback.title}</strong>
              <span>{feedback.message}</span>
            </div>
          )}

          {!selectedClub ? (
            <section className="panel club-editor-empty">
              <span aria-hidden="true"><ArrowLeft size={22} /></span>
              <h2>수정할 동아리를 선택하세요.</h2>
              <p>목록에서 동아리를 선택하면 기존 소개와 사진을 불러옵니다.</p>
            </section>
          ) : (
            <>
              <section className="panel selected-club-summary">
                <div>
                  <span className="badge badge-teal">{getClubCategoryLabel(selectedClub.category)}</span>
                  <h2>{selectedClub.name}</h2>
                  <p>등록한 분과는 나중에 바꿀 수 없습니다.</p>
                </div>
                <dl>
                  <div><dt>좋아요</dt><dd>{(detail?.likeCount ?? selectedClub.likeCount).toLocaleString("ko-KR")}</dd></div>
                  <div><dt>후기 작성자</dt><dd>{detail ? detail.reviewerCount.toLocaleString("ko-KR") : "-"}</dd></div>
                </dl>
                {(detail?.topReviewTags ?? selectedClub.topReviewTags).length > 0 && (
                  <div className="club-review-tags" aria-label="주요 후기 태그">
                    {(detail?.topReviewTags ?? selectedClub.topReviewTags).map((tag) => (
                      <span key={tag}>{getReviewTagLabel(tag)}</span>
                    ))}
                  </div>
                )}
              </section>

              {detailState === "loading" && (
                <section className="panel club-detail-state" role="status">
                  <strong>기존 동아리 정보를 불러오고 있습니다.</strong>
                  <p>현재 소개와 활동 내용을 확인하고 있습니다.</p>
                </section>
              )}

              {detailState === "error" && (
                <section className="feedback feedback-error club-detail-state" role="alert">
                  <strong>동아리 상세 정보를 불러오지 못했습니다.</strong>
                  <span>{detailError}</span>
                  <div className="form-actions">
                    <button className="button button-secondary" type="button" onClick={() => void loadClubDetails(selectedClub)}>
                      다시 불러오기
                    </button>
                  </div>
                </section>
              )}

              {detailState === "ready" && (
                <>
                  <form className="panel form-panel" onSubmit={handleDetailsSubmit}>
                    <div className="panel-heading panel-heading-border">
                      <div>
                        <span className="eyebrow dark">동아리 정보</span>
                        <h2>소개와 활동 내용</h2>
                        <p>필요한 내용을 고친 뒤 저장해 주세요.</p>
                      </div>
                      {isTextDirty && <span className="badge badge-warning">저장하지 않은 변경</span>}
                    </div>

                    <section className="notice-callout" role="note">
                      <div className="callout-icon" aria-hidden="true"><Info size={18} /></div>
                      <div>
                        <strong>비워서 저장한 선택 항목은 앱에서도 삭제됩니다.</strong>
                        <p>동아리 소개, 주요 활동, 링크와 모집 안내를 지울 때는 한 번 더 확인해 주세요.</p>
                      </div>
                    </section>

                    <fieldset className="editor-fieldset" disabled={isBusy}>
                      <div className="admin-form two-column-form">
                        <label className="field-group">
                          <span className="field-label">동아리 이름 <em>필수</em><small>{form.name.length} / 100</small></span>
                          <input value={form.name} maxLength={100} placeholder="동아리 이름" onChange={(event) => setField("name", event.target.value)} required />
                        </label>
                        <label className="field-group">
                          <span className="field-label">한 줄 소개 <em>필수</em><small>{form.shortDescription.length} / 255</small></span>
                          <input value={form.shortDescription} maxLength={255} placeholder="동아리를 한 문장으로 소개해 주세요." onChange={(event) => setField("shortDescription", event.target.value)} required />
                        </label>
                        <label className="field-group full-span">
                          <span className="field-label">동아리 소개 <small>선택 · 긴 글 가능</small></span>
                          <textarea rows={6} value={form.introduction} placeholder="동아리의 목표와 분위기를 소개해 주세요." onChange={(event) => setField("introduction", event.target.value)} />
                        </label>
                        <label className="field-group full-span">
                          <span className="field-label">주요 활동 <small>선택 · 긴 글 가능</small></span>
                          <textarea rows={6} value={form.activityContent} placeholder="정기 모임과 주요 활동 내용을 작성해 주세요." onChange={(event) => setField("activityContent", event.target.value)} />
                        </label>
                        <label className="field-group">
                          <span className="field-label">인스타그램 링크 <small>선택</small></span>
                          <input type="url" value={form.instagramUrl} maxLength={2048} placeholder="https://instagram.com/..." onChange={(event) => setField("instagramUrl", event.target.value)} />
                        </label>
                        <label className="field-group">
                          <span className="field-label">카카오톡 링크 <small>선택</small></span>
                          <input type="url" value={form.kakaoTalkUrl} maxLength={2048} placeholder="https://open.kakao.com/..." onChange={(event) => setField("kakaoTalkUrl", event.target.value)} />
                        </label>
                        <label className="field-group full-span">
                          <span className="field-label">모집 안내 <small>선택 · 긴 글 가능</small></span>
                          <textarea rows={7} value={form.recruitmentContent} placeholder="모집 대상, 일정, 지원 방법 등을 작성해 주세요." onChange={(event) => setField("recruitmentContent", event.target.value)} />
                        </label>
                      </div>
                    </fieldset>

                    <div className="form-actions form-actions-end">
                      <button className="button button-primary" type="submit" disabled={isBusy || !isTextDirty}>
                        {busyAction === "details" ? "저장 중..." : "변경 내용 저장"}
                      </button>
                    </div>
                  </form>

                  <section className="panel form-panel">
                    <div className="panel-heading panel-heading-border">
                      <div>
                        <span className="eyebrow dark">사진 관리</span>
                        <h2>대표·배경 사진</h2>
                        <p>JPG, JPEG, PNG, GIF 사진을 각각 새로 바꾸거나 지울 수 있습니다.</p>
                      </div>
                      {hasPendingImage && <span className="badge badge-warning">적용 전 사진 있음</span>}
                    </div>
                    <div className="image-management-grid">
                      {(Object.keys(imageRules) as ImageKind[]).map((kind) => (
                        <article className="image-management-card" key={kind}>
                          <div className={`image-preview-box ${kind}`}>
                            <ImagePreview file={files[kind]} imageUrl={imageUrls[kind]} alt={`${imageRules[kind].title} 미리보기`} />
                          </div>
                          <div className="image-card-copy">
                            <h3>{imageRules[kind].title}</h3>
                            <p>{imageRules[kind].description} · 최대 5MB</p>
                            {files[kind] && <span className="selected-file-name">{files[kind]?.name}</span>}
                          </div>
                          <div className="image-card-actions">
                            <label className="button button-secondary file-button">
                              새 사진 선택
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/gif"
                                onClick={(event) => { event.currentTarget.value = ""; }}
                                onChange={(event) => chooseImage(kind, event.target.files?.[0] ?? null)}
                                disabled={isBusy}
                              />
                            </label>
                            <button className="button button-primary" type="button" onClick={() => uploadImage(kind)} disabled={isBusy || !files[kind]}>
                              {busyAction === kind ? "적용 중..." : "선택한 사진 적용"}
                            </button>
                            {files[kind] && (
                              <button className="text-danger-button" type="button" onClick={() => cancelImageSelection(kind)} disabled={isBusy}>
                                선택 취소
                              </button>
                            )}
                            <button className="text-danger-button" type="button" onClick={() => setConfirmTarget(kind)} disabled={isBusy || !imageUrls[kind]}>
                              현재 사진 삭제
                            </button>
                          </div>
                        </article>
                      ))}
                    </div>
                  </section>

                  <section className="danger-zone">
                    <div>
                      <span className="eyebrow danger-text">주의</span>
                      <h2>동아리 삭제</h2>
                      <p>동아리 소개와 사진, 좋아요와 후기가 모두 사라지며 되돌릴 수 없습니다.</p>
                    </div>
                    <button className="button button-danger" type="button" disabled={isBusy} onClick={() => setConfirmTarget("club")}>이 동아리 삭제</button>
                  </section>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={Boolean(confirmTarget)}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmIsClub ? "동아리 삭제" : "사진 삭제"}
        danger
        busy={busyAction.startsWith("delete-")}
        onCancel={() => setConfirmTarget(null)}
        onConfirm={executeDelete}
      />

      <ConfirmDialog
        open={Boolean(pendingClub)}
        title="저장하지 않은 변경을 버릴까요?"
        description={isTextDirty && hasPendingImage
          ? "수정한 소개·활동 내용과 적용 전인 사진 선택이 모두 사라집니다."
          : isTextDirty
            ? "수정한 소개·활동 내용이 사라집니다."
            : "적용 전인 사진 선택이 사라집니다."}
        confirmLabel="변경 버리고 이동"
        busy={false}
        onCancel={() => setPendingClub(null)}
        onConfirm={confirmClubSelection}
      />
    </div>
    </AdminLoginNotice>
  );
}
