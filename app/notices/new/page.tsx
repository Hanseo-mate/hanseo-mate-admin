"use client";

import { CheckCircle, ImageSquare, Paperclip, Warning } from "@phosphor-icons/react";
import Link from "next/link";
import Image from "next/image";
import {
  ChangeEvent,
  DragEvent,
  FormEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { AdminLoginNotice } from "../../components/AdminLoginNotice";
import { UnsavedChangesDialog } from "../../components/UnsavedChangesDialog";
import { apiFetch, getErrorText } from "../../lib/api";
import {
  AdminNotice,
  NOTICE_IMAGE_ACCEPT,
  createNoticeMultipartBody,
  formatNoticeFileSize,
  getNoticeFormError,
  normalizeNoticeForm,
  parseAdminNotice,
  validateNoticeAttachment,
  validateNoticeImage,
} from "../../lib/notices";

type SelectedImage = {
  id: number;
  file: File;
  previewUrl: string;
};

type SelectedAttachment = {
  id: number;
  file: File;
};

type PageError = {
  heading: string;
  message: string;
};

type FieldErrors = Partial<Record<"title" | "author" | "content", string>>;

function getNoticeErrorText(error: unknown) {
  const message = getErrorText(error);
  return /API|ADMIN|HTTPS?|CORS|token|session|server|토큰|세션|서버/i.test(message)
    ? "공지를 등록하는 중 문제가 생겼습니다. 잠시 후 다시 시도해 주세요."
    : message;
}

export default function NewNoticePage() {
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [content, setContent] = useState("");
  const [selectedImages, setSelectedImages] = useState<SelectedImage[]>([]);
  const [selectedAttachments, setSelectedAttachments] = useState<SelectedAttachment[]>([]);
  const [isImageDragging, setIsImageDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PageError | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [created, setCreated] = useState<AdminNotice | null>(null);
  const submittingRef = useRef(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const selectedImagesRef = useRef<SelectedImage[]>([]);
  const fileIdRef = useRef(0);

  const hasDraft = Boolean(
    title || author || content || selectedImages.length || selectedAttachments.length,
  );

  useEffect(() => {
    if (!hasDraft || created) return;

    function protectDraft(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", protectDraft);
    return () => window.removeEventListener("beforeunload", protectDraft);
  }, [created, hasDraft]);

  useEffect(() => {
    return () => {
      selectedImagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    };
  }, []);

  function nextFileId() {
    fileIdRef.current += 1;
    return fileIdRef.current;
  }

  function clearSelectedFiles() {
    selectedImagesRef.current.forEach((image) => URL.revokeObjectURL(image.previewUrl));
    selectedImagesRef.current = [];
    setSelectedImages([]);
    setSelectedAttachments([]);
    setIsImageDragging(false);
    if (imageInputRef.current) imageInputRef.current.value = "";
    if (attachmentInputRef.current) attachmentInputRef.current.value = "";
  }

  function clearDraft() {
    setTitle("");
    setAuthor("");
    setContent("");
    clearSelectedFiles();
    setError(null);
    setFieldErrors({});
  }

  function addImages(files: File[]) {
    if (busy || files.length === 0) return;

    const accepted: SelectedImage[] = [];
    const rejected: string[] = [];

    files.forEach((file) => {
      const validationError = validateNoticeImage(file);
      if (validationError) {
        rejected.push(`${file.name}: ${validationError}`);
        return;
      }
      accepted.push({
        id: nextFileId(),
        file,
        previewUrl: URL.createObjectURL(file),
      });
    });

    if (accepted.length > 0) {
      setSelectedImages((current) => {
        const next = [...current, ...accepted];
        selectedImagesRef.current = next;
        return next;
      });
    }

    setError(
      rejected.length > 0
        ? { heading: "사진을 추가하지 못했습니다.", message: rejected[0] }
        : null,
    );
  }

  function addAttachments(files: File[]) {
    if (busy || files.length === 0) return;

    const accepted: SelectedAttachment[] = [];
    const rejected: string[] = [];

    files.forEach((file) => {
      const validationError = validateNoticeAttachment(file);
      if (validationError) {
        rejected.push(`${file.name}: ${validationError}`);
        return;
      }
      accepted.push({ id: nextFileId(), file });
    });

    if (accepted.length > 0) {
      setSelectedAttachments((current) => [...current, ...accepted]);
    }

    setError(
      rejected.length > 0
        ? { heading: "파일을 첨부하지 못했습니다.", message: rejected[0] }
        : null,
    );
  }

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    addImages(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = "";
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    addAttachments(Array.from(event.currentTarget.files ?? []));
    event.currentTarget.value = "";
  }

  function handleImageDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsImageDragging(false);
    addImages(Array.from(event.dataTransfer.files));
  }

  function removeImage(id: number) {
    const target = selectedImagesRef.current.find((image) => image.id === id);
    if (target) URL.revokeObjectURL(target.previewUrl);
    const next = selectedImagesRef.current.filter((image) => image.id !== id);
    selectedImagesRef.current = next;
    setSelectedImages(next);
  }

  function removeAttachment(id: number) {
    setSelectedAttachments((current) => current.filter((attachment) => attachment.id !== id));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;

    setError(null);
    setCreated(null);

    const form = normalizeNoticeForm({ title, author, content });
    const formError = getNoticeFormError(form);
    if (formError) {
      const nextErrors: FieldErrors = {};
      if (!form.title) nextErrors.title = "공지 제목을 입력해 주세요.";
      else if (form.title.length > 500) nextErrors.title = "공지 제목은 500자 이하로 입력해 주세요.";
      if (!form.author) nextErrors.author = "작성자를 입력해 주세요.";
      else if (form.author.length > 100) nextErrors.author = "작성자는 100자 이하로 입력해 주세요.";
      if (!form.content.trim()) nextErrors.content = "공지 내용을 입력해 주세요.";
      setFieldErrors(nextErrors);
      setError({ heading: "입력 내용을 확인해 주세요.", message: formError });
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLInputElement | HTMLTextAreaElement>('.admin-form [aria-invalid="true"]')
          ?.focus();
      });
      return;
    }
    setFieldErrors({});

    const imageFiles = selectedImagesRef.current.map((image) => image.file);
    const attachmentFiles = selectedAttachments.map((attachment) => attachment.file);
    const hasFiles = imageFiles.length > 0 || attachmentFiles.length > 0;

    submittingRef.current = true;
    setBusy(true);
    try {
      const response = await apiFetch<unknown>("/api/admin/notices", hasFiles
        ? {
            method: "POST",
            body: createNoticeMultipartBody(form, imageFiles, attachmentFiles),
          }
        : {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(form),
          });
      const savedNotice = parseAdminNotice(response);
      clearDraft();
      setCreated(savedNotice);
    } catch (requestError) {
      setError({
        heading: "공지를 등록하지 못했습니다.",
        message: getNoticeErrorText(requestError),
      });
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <AdminLoginNotice returnTo="/notices/new">
      <UnsavedChangesDialog dirty={hasDraft && !created} />
      {created ? (
        <section className="panel form-panel narrow-panel completion-panel" role="status">
          <div className="creation-success">
            <div className="success-check" aria-hidden="true"><CheckCircle size={24} weight="fill" /></div>
            <div>
              <span>등록 완료</span>
              <h2>공지 등록이 완료되었습니다.</h2>
              <p>“{created.title}” 공지가 게시되었습니다.</p>
              <div className="form-actions">
                <Link className="button button-primary" href={`/notices/manage?id=${created.id}`}>
                  이 공지 수정·삭제
                </Link>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={() => {
                    clearDraft();
                    setCreated(null);
                  }}
                >
                  새 공지 작성
                </button>
              </div>
            </div>
          </div>
        </section>
      ) : (
        <div className="form-page-grid notice-compose-grid">
          <section className="panel form-panel">
            <div className="panel-heading panel-heading-border">
              <div>
                <span className="eyebrow dark">새 공지</span>
                <h2>공지 작성</h2>
                <p>학생들에게 전할 내용과 함께 사진이나 파일을 등록할 수 있습니다.</p>
              </div>
              <span className="badge badge-neutral">학생회</span>
            </div>

            <section className="notice-callout" role="note">
              <div className="callout-icon" aria-hidden="true"><Warning size={18} weight="fill" /></div>
              <div>
                <strong>등록하면 바로 게시됩니다.</strong>
                <p>학생들에게 공개되기 전에 내용과 첨부한 파일을 한 번 더 확인해 주세요.</p>
              </div>
            </section>

            {error && (
              <div className="feedback feedback-error" role="alert">
                <strong>{error.heading}</strong>
                <span>{error.message}</span>
              </div>
            )}

            <form className="admin-form" noValidate onSubmit={handleSubmit}>
              <label className="field-group">
                <span className="field-label">
                  제목 <em>필수</em>
                  <small className={title.length > 500 ? "limit-over" : ""}>{title.length} / 500</small>
                </span>
                <input
                  type="text"
                  value={title}
                  maxLength={500}
                  placeholder="예: 2026학년도 학생회 여름 행사 안내"
                  aria-invalid={Boolean(fieldErrors.title)}
                  aria-describedby={fieldErrors.title ? "notice-title-error" : "notice-title-help"}
                  onChange={(event) => {
                    setTitle(event.target.value);
                    setFieldErrors((current) => ({ ...current, title: undefined }));
                  }}
                  disabled={busy}
                  required
                />
                {fieldErrors.title
                  ? <small className="field-error" id="notice-title-error">{fieldErrors.title}</small>
                  : <small className="field-help" id="notice-title-help">학생들이 내용을 쉽게 알 수 있는 제목을 적어 주세요.</small>}
              </label>

              <label className="field-group">
                <span className="field-label">
                  작성자 <em>필수</em>
                  <small className={author.length > 100 ? "limit-over" : ""}>{author.length} / 100</small>
                </span>
                <input
                  type="text"
                  value={author}
                  maxLength={100}
                  placeholder="예: 제42대 학생회"
                  aria-invalid={Boolean(fieldErrors.author)}
                  aria-describedby={fieldErrors.author ? "notice-author-error" : "notice-author-help"}
                  onChange={(event) => {
                    setAuthor(event.target.value);
                    setFieldErrors((current) => ({ ...current, author: undefined }));
                  }}
                  disabled={busy}
                  required
                />
                {fieldErrors.author
                  ? <small className="field-error" id="notice-author-error">{fieldErrors.author}</small>
                  : <small className="field-help" id="notice-author-help">공지에 표시할 학생회나 담당 부서 이름을 적어 주세요.</small>}
              </label>

              <label className="field-group">
                <span className="field-label">내용 <em>필수</em><small>{content.length.toLocaleString("ko-KR")}자</small></span>
                <textarea
                  value={content}
                  rows={14}
                  placeholder={"학생들에게 전달할 내용을 입력해 주세요.\n줄바꿈은 게시 화면에 그대로 반영됩니다."}
                  aria-invalid={Boolean(fieldErrors.content)}
                  aria-describedby={fieldErrors.content ? "notice-content-error" : "notice-content-help"}
                  onChange={(event) => {
                    setContent(event.target.value);
                    setFieldErrors((current) => ({ ...current, content: undefined }));
                  }}
                  disabled={busy}
                  required
                />
                {fieldErrors.content
                  ? <small className="field-error" id="notice-content-error">{fieldErrors.content}</small>
                  : <small className="field-help" id="notice-content-help">줄바꿈도 작성한 모습 그대로 표시됩니다.</small>}
              </label>

              <div className="notice-file-grid">
                <section className="notice-file-section" aria-labelledby="notice-image-heading">
                  <div className="notice-file-section-header">
                    <div>
                      <ImageSquare size={18} aria-hidden="true" />
                      <h3 id="notice-image-heading">공지 사진</h3>
                      <p>여러 장을 선택할 수 있으며, 선택한 순서대로 함께 등록됩니다.</p>
                    </div>
                    <span>{selectedImages.length}장 선택</span>
                  </div>

                  <div
                    className={`notice-file-picker${isImageDragging ? " is-dragging" : ""}`}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      if (!busy) setIsImageDragging(true);
                    }}
                    onDragOver={(event) => event.preventDefault()}
                    onDragLeave={() => setIsImageDragging(false)}
                    onDrop={handleImageDrop}
                  >
                    <input
                      ref={imageInputRef}
                      className="sr-only"
                      id="notice-images"
                      type="file"
                      accept={NOTICE_IMAGE_ACCEPT}
                      multiple
                      disabled={busy}
                      onChange={handleImageChange}
                    />
                    <label className="notice-file-picker-copy" htmlFor="notice-images">
                      <strong>{isImageDragging ? "여기에 놓아 주세요" : "사진 선택"}</strong>
                      <span>클릭하거나 파일을 끌어다 놓으세요.</span>
                      <small>JPG, JPEG, PNG, GIF · 한 장당 5MB 이하</small>
                    </label>
                  </div>

                  {selectedImages.length > 0 && (
                    <ul className="notice-image-preview-grid" aria-label="선택한 공지 사진">
                      {selectedImages.map((image) => (
                        <li className="notice-image-preview-item" key={image.id}>
                          <Image
                            src={image.previewUrl}
                            alt={`${image.file.name} 미리보기`}
                            width={320}
                            height={220}
                            unoptimized
                          />
                          <div>
                            <strong>{image.file.name}</strong>
                            <span>{formatNoticeFileSize(image.file.size)}</span>
                          </div>
                          <button
                            className="notice-file-remove"
                            type="button"
                            onClick={() => removeImage(image.id)}
                            disabled={busy}
                            aria-label={`${image.file.name} 사진 제거`}
                          >
                            제거
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <section className="notice-file-section" aria-labelledby="notice-attachment-heading">
                  <div className="notice-file-section-header">
                    <div>
                      <Paperclip size={18} aria-hidden="true" />
                      <h3 id="notice-attachment-heading">첨부파일</h3>
                      <p>신청서, 안내문, 압축 파일 등 필요한 파일을 함께 올려 주세요.</p>
                    </div>
                    <span>{selectedAttachments.length}개 선택</span>
                  </div>

                  <div className="notice-file-picker">
                    <input
                      ref={attachmentInputRef}
                      className="sr-only"
                      id="notice-attachments"
                      type="file"
                      multiple
                      disabled={busy}
                      onChange={handleAttachmentChange}
                    />
                    <label className="notice-file-picker-copy" htmlFor="notice-attachments">
                      <strong>파일 선택</strong>
                      <span>여러 파일을 한 번에 선택할 수 있습니다.</span>
                      <small>파일 형식 제한 없음 · 내용이 없는 파일 제외</small>
                    </label>
                  </div>

                  {selectedAttachments.length > 0 && (
                    <ul className="notice-selected-files" aria-label="선택한 첨부파일">
                      {selectedAttachments.map((attachment) => (
                        <li className="notice-selected-file" key={attachment.id}>
                          <div>
                            <strong>{attachment.file.name}</strong>
                            <span>{formatNoticeFileSize(attachment.file.size)}</span>
                          </div>
                          <button
                            className="notice-file-remove"
                            type="button"
                            onClick={() => removeAttachment(attachment.id)}
                            disabled={busy}
                            aria-label={`${attachment.file.name} 첨부파일 제거`}
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
                <Link className="button button-secondary" href="/notices/manage">
                  취소
                </Link>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={clearDraft}
                  disabled={busy || !hasDraft}
                >
                  내용 비우기
                </button>
                <button className="button button-primary" type="submit" disabled={busy}>
                  {busy ? "등록 중..." : "공지 등록 및 게시"}
                </button>
              </div>
            </form>
          </section>

          <aside className="panel preview-panel">
            <div className="panel-heading panel-heading-border">
              <div>
                <span className="eyebrow dark">미리보기</span>
                <h2>게시 미리보기</h2>
              </div>
              <span className="badge badge-teal">학생회</span>
            </div>
            <article className="notice-preview">
              <div className="preview-meta">
                <span>{author.trim() || "작성자"}</span>
                <span>등록 즉시 게시</span>
              </div>
              <h3>{title.trim() || "공지 제목이 여기에 표시됩니다."}</h3>
              <p className={!content.trim() ? "placeholder" : ""}>
                {content.trim()
                  ? content
                  : "작성한 공지 내용을 미리 확인할 수 있습니다. 줄바꿈은 게시 화면에 그대로 표시됩니다."}
              </p>

              {selectedImages.length > 0 && (
                <div className="notice-preview-media" aria-label="첨부 사진 미리보기">
                  {selectedImages.map((image) => (
                    <Image
                      key={image.id}
                      src={image.previewUrl}
                      alt={image.file.name}
                      width={640}
                      height={360}
                      unoptimized
                    />
                  ))}
                </div>
              )}

              {selectedAttachments.length > 0 && (
                <div className="notice-preview-attachments">
                  <strong>첨부파일 {selectedAttachments.length}개</strong>
                  <ul>
                    {selectedAttachments.map((attachment) => (
                      <li key={attachment.id}>
                        <span>{attachment.file.name}</span>
                        <small>{formatNoticeFileSize(attachment.file.size)}</small>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </article>
            <div className="info-note">
              <strong>등록 전 확인</strong>
              <ul>
                <li>작성자는 입력한 이름으로 표시됩니다.</li>
                <li>선택한 사진과 첨부파일도 공지에 함께 표시됩니다.</li>
                <li>등록 버튼을 누르면 바로 게시됩니다.</li>
              </ul>
            </div>
          </aside>
        </div>
      )}
    </AdminLoginNotice>
  );
}
