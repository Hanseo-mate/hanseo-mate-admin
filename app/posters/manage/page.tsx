"use client";

import {
  ArrowClockwise,
  ArrowSquareOut,
  CheckCircle,
  ImageSquare,
  LinkSimple,
  Plus,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { AdminLoginNotice } from "../../components/AdminLoginNotice";
import { UnsavedChangesDialog } from "../../components/UnsavedChangesDialog";
import { ApiError, apiFetch, getErrorText } from "../../lib/api";
import { ADMIN_SESSION_EVENT, getAdminSession } from "../../lib/auth";
import styles from "../posters.module.css";

type Poster = {
  id: number;
  imageUrl: string;
  linkUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

type LoadState = "idle" | "loading" | "ready" | "error";
type Feedback = {
  tone: "success" | "error";
  title: string;
  message: string;
};

const POSTER_ENDPOINT = "/api/admin/home-posters";
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_LINK_URL_LENGTH = 2_048;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);
const ALLOWED_IMAGE_EXTENSION = /\.(?:jpe?g|png|gif)$/i;

function userFacingError(message: string) {
  const error = new Error(message);
  error.name = "UserFacingError";
  return error;
}

function parsePoster(value: unknown): Poster {
  const poster = value as Partial<Poster> | null;
  if (
    !poster ||
    typeof poster !== "object" ||
    !Number.isInteger(poster.id) ||
    Number(poster.id) < 1 ||
    typeof poster.imageUrl !== "string" ||
    !Object.prototype.hasOwnProperty.call(poster, "linkUrl") ||
    (poster.linkUrl !== null && (
      typeof poster.linkUrl !== "string" ||
      normalizeLinkUrl(poster.linkUrl) === null ||
      validateLinkUrl(poster.linkUrl) !== null
    )) ||
    typeof poster.createdAt !== "string" ||
    typeof poster.updatedAt !== "string"
  ) {
    throw userFacingError("포스터 정보를 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
  }
  return {
    ...poster,
    id: Number(poster.id),
    linkUrl: poster.linkUrl === null ? null : normalizeLinkUrl(poster.linkUrl as string),
  } as Poster;
}

function parsePosters(value: unknown): Poster[] {
  if (!Array.isArray(value)) {
    throw userFacingError("포스터 목록을 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
  }
  return value.map(parsePoster).sort((first, second) => first.id - second.id);
}

function validateImage(file: File): string | null {
  if (!ALLOWED_IMAGE_TYPES.has(file.type) || !ALLOWED_IMAGE_EXTENSION.test(file.name)) {
    return "JPG, JPEG, PNG, GIF 형식의 사진만 선택할 수 있습니다.";
  }
  if (file.size === 0) return "내용이 없는 사진은 등록할 수 없습니다.";
  if (file.size > MAX_FILE_SIZE) return "사진 크기는 5MB 이하여야 합니다.";
  return null;
}

function normalizeLinkUrl(value: string): string | null {
  return value.trim() || null;
}

function validateLinkUrl(value: string): string | null {
  const normalized = normalizeLinkUrl(value);
  if (normalized === null) return null;
  if (normalized.length > MAX_LINK_URL_LENGTH) {
    return "클릭 링크는 2,048자 이하로 입력해 주세요.";
  }
  if (/[\u0000-\u0020\u007f]/.test(normalized)) {
    return "공백 없이 올바른 웹 주소를 입력해 주세요.";
  }

  try {
    const url = new URL(normalized);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname) {
      return "http:// 또는 https://로 시작하는 올바른 웹 주소를 입력해 주세요.";
    }
  } catch {
    return "http:// 또는 https://로 시작하는 올바른 웹 주소를 입력해 주세요.";
  }

  return null;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "날짜 정보 없음";
  return new Intl.DateTimeFormat("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function PosterImage({
  file,
  imageUrl,
  alt,
}: {
  file?: File | null;
  imageUrl?: string;
  alt: string;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const sourceKey = file
    ? `${file.name}:${file.size}:${file.lastModified}`
    : imageUrl ?? "";
  const [failedSource, setFailedSource] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !imageRef.current) return;

    const nextObjectUrl = URL.createObjectURL(file);
    imageRef.current.src = nextObjectUrl;
    return () => URL.revokeObjectURL(nextObjectUrl);
  }, [file]);

  if (!file && !imageUrl) {
    return (
      <div className={styles.imageFallback} role="img" aria-label={`${alt}: 선택된 사진 없음`}>
        <ImageSquare size={28} aria-hidden="true" />
        <span>사진 미리보기</span>
      </div>
    );
  }

  if (failedSource === sourceKey) {
    return (
      <div className={styles.imageFallback} role="img" aria-label={`${alt}: 이미지를 불러오지 못함`}>
        <WarningCircle size={28} aria-hidden="true" />
        <span>이미지를 불러올 수 없습니다.</span>
      </div>
    );
  }

  return (
    // The endpoint returns arbitrary remote hosts and the static export cannot
    // enumerate them for next/image safely.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imageRef}
      src={file ? undefined : imageUrl}
      alt={alt}
      loading="lazy"
      onError={() => setFailedSource(sourceKey)}
    />
  );
}

function LightboxDialog({ poster, onClose }: { poster: Poster | null; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    if (!poster || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();

    return () => {
      if (dialog.open) dialog.close();
      previousFocus?.focus();
    };
  }, [poster]);

  if (!poster) return null;

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles.lightboxDialog}`}
      aria-labelledby="poster-lightbox-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className={styles.dialogSurface}>
        <header className={styles.dialogHeader}>
          <div>
            <span>홈 포스터 #{poster.id}</span>
            <h2 id="poster-lightbox-title">포스터 크게 보기</h2>
          </div>
          <button
            className={styles.iconButton}
            type="button"
            aria-label="확대 보기 닫기"
            data-autofocus
            onClick={onClose}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.lightboxImage}>
          <PosterImage imageUrl={poster.imageUrl} alt={`홈 포스터 ${poster.id} 확대 이미지`} />
        </div>
      </div>
    </dialog>
  );
}

function DeletePosterDialog({
  poster,
  busy,
  onCancel,
  onConfirm,
}: {
  poster: Poster | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    if (!poster || !dialogRef.current) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    dialog.showModal();
    dialog.querySelector<HTMLElement>("[data-autofocus]")?.focus();

    return () => {
      if (dialog.open) dialog.close();
      previousFocus?.focus();
    };
  }, [poster]);

  if (!poster) return null;

  return (
    <dialog
      ref={dialogRef}
      className={`${styles.dialog} ${styles.deleteDialog}`}
      aria-labelledby="delete-poster-title"
      aria-describedby="delete-poster-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      onClick={(event) => {
        if (!busy && event.target === event.currentTarget) onCancel();
      }}
    >
      <div className={styles.dialogSurface}>
        <header className={styles.dialogHeader}>
          <div>
            <span>삭제 대상 #{poster.id}</span>
            <h2 id="delete-poster-title">이 포스터를 삭제할까요?</h2>
          </div>
          <button
            className={styles.iconButton}
            type="button"
            aria-label="삭제 확인 닫기"
            data-autofocus
            onClick={onCancel}
            disabled={busy}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </header>
        <div className={styles.deletePreview}>
          <PosterImage imageUrl={poster.imageUrl} alt={`삭제할 홈 포스터 ${poster.id}`} />
        </div>
        <p className={styles.deleteDescription} id="delete-poster-description">
          삭제한 사진은 복구할 수 없습니다. 다른 포스터는 그대로 유지됩니다.
        </p>
        <div className={styles.dialogActions}>
          <button className="button button-secondary" type="button" onClick={onCancel} disabled={busy}>
            취소
          </button>
          <button className="button button-danger" type="button" onClick={onConfirm} disabled={busy}>
            <Trash size={16} aria-hidden="true" />
            {busy ? "삭제 중..." : "포스터 삭제"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

function PosterSkeletons() {
  return (
    <div className={styles.skeletonGrid} role="status" aria-live="polite">
      <span className={styles.visuallyHidden}>포스터 목록을 불러오고 있습니다.</span>
      {Array.from({ length: 4 }, (_, index) => (
        <div className={styles.skeletonCard} aria-hidden="true" key={index}>
          <span className={styles.skeletonImage} />
          <span className={styles.skeletonLine} />
          <span className={styles.skeletonLineShort} />
        </div>
      ))}
    </div>
  );
}

export default function ManagePosterPage() {
  const [posters, setPosters] = useState<Poster[]>([]);
  const [listState, setListState] = useState<LoadState>("idle");
  const [listError, setListError] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [replacementFiles, setReplacementFiles] = useState<Record<number, File | null>>({});
  const [replacementLinkUrls, setReplacementLinkUrls] = useState<Record<number, string>>({});
  const [dragging, setDragging] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Poster | null>(null);
  const [previewTarget, setPreviewTarget] = useState<Poster | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const listController = useRef<AbortController | null>(null);
  const newFileInputRef = useRef<HTMLInputElement | null>(null);
  const mutationInProgress = useRef(false);
  const isBusy = Boolean(busyAction);
  const newLinkError = validateLinkUrl(newLinkUrl);
  const hasPendingChanges = Boolean(
    newFile ||
    newLinkUrl ||
    Object.values(replacementFiles).some(Boolean) ||
    Object.keys(replacementLinkUrls).length,
  );

  useEffect(() => {
    if (!hasPendingChanges) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [hasPendingChanges]);

  const loadPosters = useCallback(async () => {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setListState("loading");
    setListError("");

    try {
      const response = await apiFetch<unknown>(POSTER_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setPosters(parsePosters(response));
      setReplacementFiles({});
      setReplacementLinkUrls({});
      setListState("ready");
    } catch (error) {
      if (controller.signal.aborted) return;
      setListState("error");
      setListError(getErrorText(error));
    } finally {
      if (listController.current === controller) listController.current = null;
    }
  }, []);

  useEffect(() => {
    const handleSessionChange = () => {
      if (getAdminSession()) {
        void loadPosters();
        return;
      }
      listController.current?.abort();
      setPosters([]);
      setListState("idle");
    };

    const timeoutId = window.setTimeout(handleSessionChange, 0);
    window.addEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
      listController.current?.abort();
    };
  }, [loadPosters]);

  function chooseNewFile(file: File | null) {
    if (!file || isBusy) return;
    const error = validateImage(file);
    if (error) {
      setNewFile(null);
      setFeedback({ tone: "error", title: "이 사진은 선택할 수 없습니다.", message: error });
      return;
    }
    setNewFile(file);
    setFeedback(null);
  }

  function chooseReplacement(poster: Poster, file: File | null) {
    if (!file || isBusy) return;
    const error = validateImage(file);
    if (error) {
      setReplacementFiles((current) => ({ ...current, [poster.id]: null }));
      setReplacementLinkUrls((current) => {
        const next = { ...current };
        delete next[poster.id];
        return next;
      });
      setFeedback({ tone: "error", title: "이 사진으로 교체할 수 없습니다.", message: error });
      return;
    }
    setReplacementFiles((current) => ({ ...current, [poster.id]: file }));
    setReplacementLinkUrls((current) => ({
      ...current,
      [poster.id]: Object.prototype.hasOwnProperty.call(current, poster.id)
        ? current[poster.id]
        : poster.linkUrl ?? "",
    }));
    setFeedback(null);
  }

  function clearReplacement(posterId: number) {
    setReplacementFiles((current) => {
      const next = { ...current };
      delete next[posterId];
      return next;
    });
    setReplacementLinkUrls((current) => {
      const next = { ...current };
      delete next[posterId];
      return next;
    });
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragging(false);
    if (!isBusy) chooseNewFile(event.dataTransfer.files?.[0] ?? null);
  }

  function openFilePicker(event: KeyboardEvent<HTMLLabelElement>) {
    if (isBusy || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    newFileInputRef.current?.click();
  }

  async function createPoster() {
    if (!newFile || mutationInProgress.current) return;
    const error = validateImage(newFile);
    if (error) {
      setFeedback({ tone: "error", title: "사진을 등록할 수 없습니다.", message: error });
      return;
    }
    if (newLinkError) {
      setFeedback({ tone: "error", title: "클릭 링크를 확인해 주세요.", message: newLinkError });
      return;
    }

    mutationInProgress.current = true;
    setBusyAction("create");
    setFeedback(null);
    const body = new FormData();
    body.append("file", newFile, newFile.name);
    const normalizedLinkUrl = normalizeLinkUrl(newLinkUrl);
    if (normalizedLinkUrl) body.append("linkUrl", normalizedLinkUrl);

    try {
      parsePoster(await apiFetch<unknown>(POSTER_ENDPOINT, { method: "POST", body }));
      setNewFile(null);
      setNewLinkUrl("");
      if (newFileInputRef.current) newFileInputRef.current.value = "";
      setFeedback({
        tone: "success",
        title: "포스터를 등록했습니다.",
        message: "관리자 포스터 목록을 새로 불러왔습니다.",
      });
      await loadPosters();
    } catch (requestError) {
      setFeedback({
        tone: "error",
        title: "포스터를 등록하지 못했습니다.",
        message: getErrorText(requestError),
      });
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  async function replacePoster(poster: Poster) {
    const file = replacementFiles[poster.id];
    if (!file || mutationInProgress.current) return;
    const error = validateImage(file);
    if (error) {
      setFeedback({ tone: "error", title: "사진을 교체할 수 없습니다.", message: error });
      return;
    }
    const replacementLinkUrl = replacementLinkUrls[poster.id] ?? poster.linkUrl ?? "";
    const linkError = validateLinkUrl(replacementLinkUrl);
    if (linkError) {
      setFeedback({ tone: "error", title: "클릭 링크를 확인해 주세요.", message: linkError });
      return;
    }

    mutationInProgress.current = true;
    setBusyAction(`replace-${poster.id}`);
    setFeedback(null);
    const body = new FormData();
    body.append("file", file, file.name);
    const normalizedLinkUrl = normalizeLinkUrl(replacementLinkUrl);
    if (normalizedLinkUrl) body.append("linkUrl", normalizedLinkUrl);

    try {
      parsePoster(await apiFetch<unknown>(`${POSTER_ENDPOINT}/${poster.id}`, {
        method: "PUT",
        body,
      }));
      setFeedback({
        tone: "success",
        title: "포스터를 교체했습니다.",
        message: normalizedLinkUrl
          ? "새 사진과 클릭 링크가 함께 반영되었습니다."
          : "새 사진을 반영하고 클릭 이동은 사용하지 않도록 설정했습니다.",
      });
      await loadPosters();
    } catch (requestError) {
      setFeedback({
        tone: "error",
        title: "포스터를 교체하지 못했습니다.",
        message: getErrorText(requestError),
      });
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  async function deletePoster() {
    if (!deleteTarget || mutationInProgress.current) return;
    const target = deleteTarget;
    mutationInProgress.current = true;
    setBusyAction(`delete-${target.id}`);
    setFeedback(null);

    try {
      await apiFetch<void>(`${POSTER_ENDPOINT}/${target.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      setFeedback({
        tone: "success",
        title: "포스터를 삭제했습니다.",
        message: "남아 있는 포스터 목록을 새로 불러왔습니다.",
      });
      await loadPosters();
    } catch (requestError) {
      setDeleteTarget(null);
      if (requestError instanceof ApiError && requestError.status === 404) {
        await loadPosters();
        setFeedback({
          tone: "error",
          title: "이미 삭제된 포스터입니다.",
          message: "최신 포스터 목록을 다시 불러왔습니다.",
        });
        return;
      }
      setFeedback({
        tone: "error",
        title: "포스터를 삭제하지 못했습니다.",
        message: getErrorText(requestError),
      });
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  return (
    <AdminLoginNotice returnTo="/posters/manage">
      <UnsavedChangesDialog dirty={hasPendingChanges} />
      <div className={styles.page}>
        {feedback && (
          <div
            className={`${styles.feedback} ${feedback.tone === "error" ? styles.feedbackError : styles.feedbackSuccess}`}
            role={feedback.tone === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {feedback.tone === "error" ? (
              <WarningCircle size={20} aria-hidden="true" />
            ) : (
              <CheckCircle size={20} aria-hidden="true" />
            )}
            <div>
              <strong>{feedback.title}</strong>
              <span>{feedback.message}</span>
            </div>
            <button type="button" aria-label="알림 닫기" onClick={() => setFeedback(null)}>
              <X size={18} aria-hidden="true" />
            </button>
          </div>
        )}

        <section className={styles.surface} aria-labelledby="poster-upload-title">
          <header className={styles.sectionHeader}>
            <div>
              <h2 id="poster-upload-title">포스터 등록</h2>
              <p>이미지 한 장과 선택적인 클릭 링크를 함께 등록합니다.</p>
            </div>
            <span className={styles.limitText}>최대 5 MiB</span>
          </header>

          <div className={styles.adminNotice} role="note">
            <WarningCircle size={19} aria-hidden="true" />
            <p>
              이 화면은 관리자 등록 데이터를 관리합니다. 실제 사용자 화면의 노출 상태는 이곳에서 확인할 수 없습니다.
            </p>
          </div>

          <div className={styles.uploadLayout}>
            <div className={styles.uploadWorkspace}>
              {!newFile ? (
                <label
                  className={`${styles.dropZone} ${dragging ? styles.dropZoneDragging : ""} ${isBusy ? styles.disabled : ""}`}
                  tabIndex={isBusy ? -1 : 0}
                  aria-disabled={isBusy}
                  onKeyDown={openFilePicker}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    if (!isBusy) setDragging(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => {
                    if (event.currentTarget === event.target) setDragging(false);
                  }}
                  onDrop={handleDrop}
                >
                  <input
                    ref={newFileInputRef}
                    className={styles.fileInput}
                    type="file"
                    accept=".jpg,.jpeg,.png,.gif,image/jpeg,image/png,image/gif"
                    disabled={isBusy}
                    aria-describedby="poster-file-rules"
                    onClick={(event) => { event.currentTarget.value = ""; }}
                    onChange={(event) => chooseNewFile(event.target.files?.[0] ?? null)}
                  />
                  <span className={styles.dropIcon} aria-hidden="true">
                    <UploadSimple size={23} />
                  </span>
                  <strong>{dragging ? "여기에 사진을 놓아 주세요" : "사진을 끌어놓거나 선택하세요"}</strong>
                  <span>가로형 이미지를 권장합니다.</span>
                  <span className={styles.selectButton}>사진 선택</span>
                </label>
              ) : (
                <div className={styles.newPreview}>
                  <div className={styles.newPreviewImage}>
                    <PosterImage file={newFile} alt="새 포스터 미리보기" />
                  </div>
                  <div className={styles.selectedFile}>
                    <ImageSquare size={20} aria-hidden="true" />
                    <div>
                      <strong>{newFile.name}</strong>
                      <span>{formatFileSize(newFile.size)}</span>
                    </div>
                    <button
                      className={styles.iconButton}
                      type="button"
                      aria-label="선택한 사진 취소"
                      onClick={() => setNewFile(null)}
                      disabled={isBusy}
                    >
                      <X size={18} aria-hidden="true" />
                    </button>
                  </div>
                  <div className={styles.uploadActions}>
                    <button className="button button-secondary" type="button" onClick={() => setNewFile(null)} disabled={isBusy}>
                      다시 선택
                    </button>
                    <button
                      className="button button-primary"
                      type="button"
                      onClick={createPoster}
                      disabled={isBusy || Boolean(newLinkError)}
                    >
                      <Plus size={16} aria-hidden="true" />
                      {busyAction === "create" ? "등록 중..." : "포스터 등록"}
                    </button>
                  </div>
                </div>
              )}

              <div className={styles.linkEditor}>
                <div className={styles.fieldHeading}>
                  <label htmlFor="new-poster-link">클릭 링크 <span>선택</span></label>
                  <small>{newLinkUrl.length.toLocaleString("ko-KR")} / 2,048</small>
                </div>
                <div className={`${styles.linkInput} ${newLinkError ? styles.linkInputError : ""}`}>
                  <LinkSimple size={17} aria-hidden="true" />
                  <input
                    id="new-poster-link"
                    type="url"
                    inputMode="url"
                    autoCapitalize="none"
                    autoComplete="url"
                    spellCheck={false}
                    value={newLinkUrl}
                    maxLength={MAX_LINK_URL_LENGTH}
                    placeholder="https://www.hanseo.ac.kr/event/1"
                    disabled={isBusy}
                    aria-invalid={Boolean(newLinkError) || undefined}
                    aria-describedby={`new-poster-link-help${newLinkError ? " new-poster-link-error" : ""}`}
                    onChange={(event) => setNewLinkUrl(event.target.value)}
                  />
                </div>
                <small id="new-poster-link-help" className={styles.fieldHelp}>
                  비워두면 포스터 사진만 표시되고, 클릭해도 이동하지 않습니다.
                </small>
                {newLinkError && (
                  <small id="new-poster-link-error" className={styles.fieldError} role="alert">
                    {newLinkError}
                  </small>
                )}
              </div>
            </div>

            <aside className={styles.rulesPanel} aria-labelledby="poster-file-rules">
              <h3 id="poster-file-rules">등록 기준</h3>
              <dl>
                <div>
                  <dt>파일 형식</dt>
                  <dd>JPG, JPEG, PNG, GIF</dd>
                </div>
                <div>
                  <dt>파일 크기</dt>
                  <dd>한 장당 5 MiB 이하</dd>
                </div>
                <div>
                  <dt>클릭 링크</dt>
                  <dd>HTTP/HTTPS, 선택 입력</dd>
                </div>
                <div>
                  <dt>등록 단위</dt>
                  <dd>요청 한 번에 한 장</dd>
                </div>
              </dl>
            </aside>
          </div>
        </section>

        <section className={styles.surface} aria-labelledby="poster-list-title">
          <header className={styles.sectionHeader}>
            <div>
              <div className={styles.titleRow}>
                <h2 id="poster-list-title">등록 포스터</h2>
                <span className={styles.count} aria-live="polite">
                  {listState === "ready" ? `${posters.length}장` : "확인 중"}
                </span>
              </div>
              <p>등록 순서대로 사진과 클릭 링크를 확인하고 함께 교체하거나 삭제할 수 있습니다.</p>
            </div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => void loadPosters()}
              disabled={isBusy || listState === "loading" || hasPendingChanges}
              title={hasPendingChanges ? "저장하지 않은 입력을 먼저 완료하거나 취소해 주세요." : undefined}
            >
              <ArrowClockwise size={16} aria-hidden="true" />
              {listState === "loading" ? "불러오는 중..." : "새로고침"}
            </button>
          </header>

          <div className={styles.listBody}>
            {listState === "idle" && (
              <div className={styles.state} role="status">
                <ImageSquare size={30} aria-hidden="true" />
                <strong>로그인 상태를 확인하고 있습니다.</strong>
                <p>잠시만 기다려 주세요.</p>
              </div>
            )}
            {listState === "loading" && <PosterSkeletons />}
            {listState === "error" && (
              <div className={`${styles.state} ${styles.errorState}`} role="alert">
                <WarningCircle size={31} aria-hidden="true" />
                <strong>포스터 목록을 불러오지 못했습니다.</strong>
                <p>{listError}</p>
                <button className="button button-secondary" type="button" onClick={() => void loadPosters()} disabled={isBusy}>
                  <ArrowClockwise size={16} aria-hidden="true" />
                  다시 시도
                </button>
              </div>
            )}
            {listState === "ready" && posters.length === 0 && (
              <div className={styles.state} role="status">
                <span className={styles.emptyIcon} aria-hidden="true"><ImageSquare size={27} /></span>
                <strong>등록된 포스터가 없습니다.</strong>
                <p>위 등록 영역에서 첫 포스터 사진을 추가할 수 있습니다.</p>
              </div>
            )}

            {listState === "ready" && posters.length > 0 && (
              <div className={styles.gallery}>
                {posters.map((poster) => {
                  const replacementFile = replacementFiles[poster.id];
                  const replacementLinkUrl = replacementLinkUrls[poster.id] ?? poster.linkUrl ?? "";
                  const replacementLinkError = validateLinkUrl(replacementLinkUrl);
                  const replacing = busyAction === `replace-${poster.id}`;
                  const deleting = busyAction === `delete-${poster.id}`;
                  return (
                    <article className={styles.card} key={poster.id} aria-busy={replacing || deleting || undefined}>
                      <div className={styles.cardHeading}>
                        <span>홈 포스터</span>
                        <strong>#{poster.id}</strong>
                      </div>

                      <button
                        className={styles.imageButton}
                        type="button"
                        onClick={() => setPreviewTarget(poster)}
                        aria-label={`홈 포스터 ${poster.id} 크게 보기`}
                      >
                        <span className={styles.cardImage}>
                          <PosterImage imageUrl={poster.imageUrl} alt={`등록된 홈 포스터 ${poster.id}`} />
                        </span>
                        <span className={styles.zoomHint} aria-hidden="true"><ImageSquare size={18} /></span>
                      </button>

                      <div className={styles.cardBody}>
                        <dl className={styles.metadata}>
                          <div>
                            <dt>등록일</dt>
                            <dd><time dateTime={poster.createdAt}>{formatDateTime(poster.createdAt)}</time></dd>
                          </div>
                          <div>
                            <dt>수정일</dt>
                            <dd><time dateTime={poster.updatedAt}>{formatDateTime(poster.updatedAt)}</time></dd>
                          </div>
                        </dl>

                        <div className={styles.linkStatus}>
                          <span className={styles.linkStatusIcon} aria-hidden="true">
                            <LinkSimple size={16} />
                          </span>
                          <div>
                            <strong>{poster.linkUrl ? "링크 있음" : "링크 없음"}</strong>
                            {poster.linkUrl ? (
                              <a
                                href={poster.linkUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={poster.linkUrl}
                              >
                                <span>{poster.linkUrl}</span>
                                <ArrowSquareOut size={14} aria-hidden="true" />
                              </a>
                            ) : (
                              <span>클릭 이동 없음</span>
                            )}
                          </div>
                        </div>

                        {replacementFile ? (
                          <div className={styles.replacementPanel}>
                            <div className={styles.replacementHeading}>
                              <strong>교체 전후 비교</strong>
                              <span>저장 전</span>
                            </div>
                            <div className={styles.compareGrid}>
                              <figure>
                                <div className={styles.compareImage}>
                                  <PosterImage imageUrl={poster.imageUrl} alt={`현재 홈 포스터 ${poster.id}`} />
                                </div>
                                <figcaption>현재 사진</figcaption>
                              </figure>
                              <figure>
                                <div className={styles.compareImage}>
                                  <PosterImage
                                    file={replacementFile}
                                    imageUrl={poster.imageUrl}
                                    alt="선택한 교체 사진"
                                  />
                                </div>
                                <figcaption>선택한 사진</figcaption>
                              </figure>
                            </div>
                            <div className={styles.replacementFile}>
                              <strong>{replacementFile.name}</strong>
                              <span>{formatFileSize(replacementFile.size)}</span>
                            </div>
                            <div className={styles.linkEditor}>
                              <div className={styles.fieldHeading}>
                                <label htmlFor={`replacement-link-${poster.id}`}>교체 후 클릭 링크 <span>선택</span></label>
                                <small>{replacementLinkUrl.length.toLocaleString("ko-KR")} / 2,048</small>
                              </div>
                              <div className={`${styles.linkInput} ${replacementLinkError ? styles.linkInputError : ""}`}>
                                <LinkSimple size={16} aria-hidden="true" />
                                <input
                                  id={`replacement-link-${poster.id}`}
                                  type="url"
                                  inputMode="url"
                                  autoCapitalize="none"
                                  autoComplete="url"
                                  spellCheck={false}
                                  value={replacementLinkUrl}
                                  maxLength={MAX_LINK_URL_LENGTH}
                                  placeholder="https://www.hanseo.ac.kr/event/1"
                                  disabled={isBusy}
                                  aria-invalid={Boolean(replacementLinkError) || undefined}
                                  aria-describedby={`replacement-link-${poster.id}-help${replacementLinkError ? ` replacement-link-${poster.id}-error` : ""}`}
                                  onChange={(event) => setReplacementLinkUrls((current) => ({
                                    ...current,
                                    [poster.id]: event.target.value,
                                  }))}
                                />
                              </div>
                              <small id={`replacement-link-${poster.id}-help`} className={styles.fieldHelp}>
                                비워두면 기존 링크를 제거하고 클릭 이동을 사용하지 않습니다.
                              </small>
                              {replacementLinkError && (
                                <small id={`replacement-link-${poster.id}-error`} className={styles.fieldError} role="alert">
                                  {replacementLinkError}
                                </small>
                              )}
                            </div>
                            <div className={styles.cardActions}>
                              <button
                                className="button button-secondary"
                                type="button"
                                onClick={() => clearReplacement(poster.id)}
                                disabled={isBusy}
                              >
                                선택 취소
                              </button>
                              <button
                                className="button button-primary"
                                type="button"
                                onClick={() => void replacePoster(poster)}
                                disabled={isBusy || Boolean(replacementLinkError)}
                              >
                                {replacing ? "교체 중..." : "사진과 링크 교체"}
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className={styles.cardActions}>
                            <label className={`button button-secondary ${styles.fileButton} ${isBusy ? styles.disabled : ""}`}>
                              이미지·링크 교체
                              <input
                                type="file"
                                accept=".jpg,.jpeg,.png,.gif,image/jpeg,image/png,image/gif"
                                disabled={isBusy}
                                onClick={(event) => { event.currentTarget.value = ""; }}
                                onChange={(event) => chooseReplacement(poster, event.target.files?.[0] ?? null)}
                              />
                            </label>
                            <button className={styles.deleteButton} type="button" onClick={() => setDeleteTarget(poster)} disabled={isBusy}>
                              <Trash size={16} aria-hidden="true" />
                              {deleting ? "삭제 중..." : "삭제"}
                            </button>
                            <small className={styles.replacementNote}>
                              링크 변경이나 제거에도 새 사진 선택이 필요합니다.
                            </small>
                          </div>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <LightboxDialog poster={previewTarget} onClose={() => setPreviewTarget(null)} />
        <DeletePosterDialog
          poster={deleteTarget}
          busy={Boolean(deleteTarget && busyAction === `delete-${deleteTarget.id}`)}
          onCancel={() => {
            if (!isBusy) setDeleteTarget(null);
          }}
          onConfirm={() => void deletePoster()}
        />
      </div>
    </AdminLoginNotice>
  );
}
