"use client";

import {
  type DragEvent,
  type KeyboardEvent,
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

type Poster = {
  id: number;
  imageUrl: string;
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
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);
const ALLOWED_IMAGE_EXTENSION = /\.(?:jpe?g|png|gif)$/i;

function userFacingError(message: string) {
  const error = new Error(message);
  error.name = "UserFacingError";
  return error;
}

function parsePoster(value: unknown): Poster {
  if (
    !value ||
    typeof value !== "object" ||
    typeof (value as Poster).id !== "number" ||
    typeof (value as Poster).imageUrl !== "string" ||
    typeof (value as Poster).createdAt !== "string" ||
    typeof (value as Poster).updatedAt !== "string"
  ) {
    throw userFacingError("포스터 정보를 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
  }
  return value as Poster;
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
  const objectUrl = useMemo(() => file ? URL.createObjectURL(file) : "", [file]);

  useEffect(() => () => {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }, [objectUrl]);

  if (!objectUrl && !imageUrl) {
    return <div className="poster-image-placeholder">사진 미리보기</div>;
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={objectUrl || imageUrl} alt={alt} />;
}

export default function ManagePosterPage() {
  const [posters, setPosters] = useState<Poster[]>([]);
  const [listState, setListState] = useState<LoadState>("idle");
  const [listError, setListError] = useState("");
  const [newFile, setNewFile] = useState<File | null>(null);
  const [replacementFiles, setReplacementFiles] = useState<Record<number, File | null>>({});
  const [dragging, setDragging] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Poster | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const listController = useRef<AbortController | null>(null);
  const newFileInputRef = useRef<HTMLInputElement | null>(null);
  const mutationInProgress = useRef(false);
  const isBusy = Boolean(busyAction);

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
      setFeedback({ tone: "error", title: "이 사진으로 교체할 수 없습니다.", message: error });
      return;
    }
    setReplacementFiles((current) => ({ ...current, [poster.id]: file }));
    setFeedback(null);
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

    mutationInProgress.current = true;
    setBusyAction("create");
    setFeedback(null);
    const body = new FormData();
    body.append("file", newFile, newFile.name);

    try {
      parsePoster(await apiFetch<unknown>(POSTER_ENDPOINT, { method: "POST", body }));
      setNewFile(null);
      if (newFileInputRef.current) newFileInputRef.current.value = "";
      setFeedback({
        tone: "success",
        title: "포스터를 등록했습니다.",
        message: "홈 화면에 보여 줄 포스터 목록을 새로 불러왔습니다.",
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

    mutationInProgress.current = true;
    setBusyAction(`replace-${poster.id}`);
    setFeedback(null);
    const body = new FormData();
    body.append("file", file, file.name);

    try {
      parsePoster(await apiFetch<unknown>(`${POSTER_ENDPOINT}/${poster.id}`, {
        method: "PUT",
        body,
      }));
      setFeedback({
        tone: "success",
        title: "포스터 이미지를 교체했습니다.",
        message: "선택한 새 사진이 반영되었습니다.",
      });
      await loadPosters();
    } catch (requestError) {
      setFeedback({
        tone: "error",
        title: "포스터 이미지를 교체하지 못했습니다.",
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
      <div className="poster-management-page stack-lg">
        {feedback && (
          <div
            className={`poster-page-feedback feedback feedback-${feedback.tone} page-feedback`}
            role={feedback.tone === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            <strong>{feedback.title}</strong>
            <span>{feedback.message}</span>
          </div>
        )}

        <section className="panel poster-upload-panel" aria-labelledby="poster-upload-title">
          <div className="poster-panel-heading panel-heading panel-heading-border">
            <div>
              <span className="eyebrow dark">새 포스터</span>
              <h2 id="poster-upload-title">포스터 사진 등록</h2>
              <p>홈 화면에 새로 보여 줄 포스터 사진을 선택해 주세요.</p>
            </div>
            <span className="file-limit-badge">사진당 최대 5MB</span>
          </div>

          <div className="poster-upload-grid">
            {!newFile ? (
              <div>
                <label
                  className={`poster-drop-zone course-drop-zone ${dragging ? "is-dragging" : ""} ${isBusy ? "is-disabled" : ""}`}
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
                    className="course-file-input"
                    type="file"
                    accept=".jpg,.jpeg,.png,.gif,image/jpeg,image/png,image/gif"
                    disabled={isBusy}
                    aria-describedby="poster-file-rules"
                    onClick={(event) => { event.currentTarget.value = ""; }}
                    onChange={(event) => chooseNewFile(event.target.files?.[0] ?? null)}
                  />
                  <span className="drop-zone-icon" aria-hidden="true"><span>사진</span></span>
                  <span className="drop-zone-copy">
                    <strong>{dragging ? "여기에 사진을 놓아 주세요" : "사진을 끌어놓거나 눌러서 선택하세요"}</strong>
                    <span>가로형 포스터 사진을 권장합니다.</span>
                  </span>
                  <span className="button button-secondary drop-zone-button" aria-hidden="true">사진 선택</span>
                </label>
                <p className="poster-file-rules course-file-rules" id="poster-file-rules">
                  <strong>지원 형식</strong> JPG · JPEG · PNG · GIF <span aria-hidden="true">·</span> <strong>최대 용량</strong> 5MB
                </p>
              </div>
            ) : (
              <div className="poster-upload-preview">
                <div className="poster-image-frame">
                  <PosterImage file={newFile} alt="새 포스터 미리보기" />
                </div>
                <div className="poster-file-meta selected-course-file">
                  <span className="selected-file-extension" aria-hidden="true">IMG</span>
                  <div>
                    <strong>{newFile.name}</strong>
                    <span>{formatFileSize(newFile.size)}</span>
                  </div>
                  <button
                    className="selected-file-remove"
                    type="button"
                    aria-label="선택한 사진 취소"
                    onClick={() => setNewFile(null)}
                    disabled={isBusy}
                  >
                    &times;
                  </button>
                </div>
                <div className="poster-upload-actions form-actions form-actions-end">
                  <button className="button button-secondary" type="button" onClick={() => setNewFile(null)} disabled={isBusy}>
                    다시 선택
                  </button>
                  <button className="button button-primary" type="button" onClick={createPoster} disabled={isBusy}>
                    {busyAction === "create" ? "등록 중..." : "이 사진 등록"}
                  </button>
                </div>
              </div>
            )}

            <aside className="poster-upload-guide" aria-label="사진 등록 안내">
              <span className="eyebrow dark">등록 전 확인</span>
              <h3>사진이 잘 보이는지 확인해 주세요.</h3>
              <ul>
                <li>JPG, JPEG, PNG, GIF 사진을 사용할 수 있습니다.</li>
                <li>사진 한 장의 크기는 5MB 이하여야 합니다.</li>
                <li>등록한 순서대로 홈 화면에 표시됩니다.</li>
              </ul>
            </aside>
          </div>
        </section>

        <section className="panel poster-list-panel" aria-labelledby="poster-list-title">
          <div className="poster-list-heading panel-heading panel-heading-border">
            <div>
              <span className="eyebrow dark">현재 포스터</span>
              <h2 id="poster-list-title">등록된 포스터</h2>
              <p>사진을 교체하거나 더 이상 쓰지 않는 포스터를 삭제할 수 있습니다.</p>
            </div>
            <div className="poster-list-tools">
              <span className="poster-count" aria-live="polite">
                {listState === "ready" ? `${posters.length}장` : "확인 중"}
              </span>
              <button
                className="button button-secondary"
                type="button"
                onClick={() => void loadPosters()}
                disabled={isBusy || listState === "loading"}
              >
                {listState === "loading" ? "불러오는 중..." : "목록 새로고침"}
              </button>
            </div>
          </div>

          {listState === "idle" && (
            <div className="poster-state" role="status">
              <strong>로그인 상태를 확인하고 있습니다.</strong>
              <p>잠시만 기다려 주세요.</p>
            </div>
          )}
          {listState === "loading" && (
            <div className="poster-state" role="status" aria-live="polite">
              <span className="upload-spinner" aria-hidden="true" />
              <strong>포스터 목록을 불러오고 있습니다.</strong>
              <p>등록된 사진을 확인하는 중입니다.</p>
            </div>
          )}
          {listState === "error" && (
            <div className="poster-state poster-state-error" role="alert">
              <strong>포스터 목록을 불러오지 못했습니다.</strong>
              <p>{listError}</p>
              <button className="button button-secondary" type="button" onClick={() => void loadPosters()} disabled={isBusy}>
                다시 시도
              </button>
            </div>
          )}
          {listState === "ready" && posters.length === 0 && (
            <div className="poster-empty-state poster-state" role="status">
              <span aria-hidden="true">+</span>
              <strong>등록된 포스터가 없습니다.</strong>
              <p>위에서 사진을 선택하면 첫 포스터를 등록할 수 있습니다.</p>
            </div>
          )}

          {listState === "ready" && posters.length > 0 && (
            <div className="poster-gallery">
              {posters.map((poster) => {
                const replacementFile = replacementFiles[poster.id];
                const replacing = busyAction === `replace-${poster.id}`;
                const deleting = busyAction === `delete-${poster.id}`;
                return (
                  <article className="poster-card" key={poster.id} aria-busy={replacing || deleting || undefined}>
                    <div className={`poster-image-frame ${replacementFile ? "poster-replace-preview" : ""}`}>
                      <PosterImage
                        file={replacementFile}
                        imageUrl={poster.imageUrl}
                        alt={replacementFile ? "교체할 포스터 미리보기" : "등록된 홈 화면 포스터"}
                      />
                      {replacementFile && <span className="poster-preview-badge">교체 전 미리보기</span>}
                    </div>

                    <div className="poster-card-body">
                      <dl className="poster-card-meta">
                        <div>
                          <dt>등록일</dt>
                          <dd><time dateTime={poster.createdAt}>{formatDateTime(poster.createdAt)}</time></dd>
                        </div>
                        <div>
                          <dt>마지막 교체일</dt>
                          <dd><time dateTime={poster.updatedAt}>{formatDateTime(poster.updatedAt)}</time></dd>
                        </div>
                      </dl>

                      {replacementFile ? (
                        <div className="poster-replace-panel">
                          <div className="poster-replace-file">
                            <strong>{replacementFile.name}</strong>
                            <span>{formatFileSize(replacementFile.size)}</span>
                          </div>
                          <div className="poster-card-actions">
                            <button
                              className="button button-secondary"
                              type="button"
                              onClick={() => setReplacementFiles((current) => ({ ...current, [poster.id]: null }))}
                              disabled={isBusy}
                            >
                              선택 취소
                            </button>
                            <button className="button button-primary" type="button" onClick={() => void replacePoster(poster)} disabled={isBusy}>
                              {replacing ? "교체 중..." : "선택한 사진으로 교체"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="poster-card-actions">
                          <label className={`button button-secondary poster-file-button ${isBusy ? "is-disabled" : ""}`}>
                            이미지 교체
                            <input
                              type="file"
                              accept=".jpg,.jpeg,.png,.gif,image/jpeg,image/png,image/gif"
                              disabled={isBusy}
                              onClick={(event) => { event.currentTarget.value = ""; }}
                              onChange={(event) => chooseReplacement(poster, event.target.files?.[0] ?? null)}
                            />
                          </label>
                          <button className="button button-danger" type="button" onClick={() => setDeleteTarget(poster)} disabled={isBusy}>
                            {deleting ? "삭제 중..." : "삭제"}
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <ConfirmDialog
          open={Boolean(deleteTarget)}
          title="이 포스터를 삭제할까요?"
          description="삭제한 포스터 사진은 다시 되돌릴 수 없습니다."
          confirmLabel="포스터 삭제"
          danger
          busy={Boolean(deleteTarget && busyAction === `delete-${deleteTarget.id}`)}
          onCancel={() => {
            if (!isBusy) setDeleteTarget(null);
          }}
          onConfirm={deletePoster}
        />
      </div>
    </AdminLoginNotice>
  );
}
