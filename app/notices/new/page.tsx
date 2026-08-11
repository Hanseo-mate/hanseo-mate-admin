"use client";

import Link from "next/link";
import { FormEvent, useRef, useState } from "react";
import { AdminLoginNotice } from "../../components/AdminLoginNotice";
import { apiFetch, getErrorText } from "../../lib/api";

type NoticeCreated = {
  id: number;
  title: string;
  author: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<NoticeCreated | null>(null);
  const submittingRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;

    setError("");
    setCreated(null);

    const trimmedTitle = title.trim();
    const trimmedAuthor = author.trim();
    const trimmedContent = content.trim();

    if (!trimmedTitle) {
      setError("공지 제목을 입력해 주세요.");
      return;
    }
    if (trimmedTitle.length > 500) {
      setError("공지 제목은 500자 이하로 입력해 주세요.");
      return;
    }
    if (!trimmedAuthor) {
      setError("작성자를 입력해 주세요.");
      return;
    }
    if (trimmedAuthor.length > 100) {
      setError("작성자는 100자 이하로 입력해 주세요.");
      return;
    }
    if (!trimmedContent) {
      setError("공지 내용을 입력해 주세요.");
      return;
    }

    submittingRef.current = true;
    setBusy(true);
    try {
      const response = await apiFetch<NoticeCreated>("/api/admin/notices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmedTitle,
          author: trimmedAuthor,
          content: trimmedContent
        }),
      });
      setCreated(response);
    } catch (requestError) {
      setError(getNoticeErrorText(requestError));
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <AdminLoginNotice returnTo="/notices/new">
      {created ? (
        <section className="panel form-panel narrow-panel completion-panel" role="status">
          <div className="creation-success">
            <div className="success-check" aria-hidden="true">✓</div>
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
                    setCreated(null);
                    setTitle("");
                    setAuthor("");
                    setContent("");
                    setError("");
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
            <p>학생들에게 전할 제목, 작성자와 내용을 작성해 주세요.</p>
          </div>
          <span className="badge badge-neutral">학생회</span>
        </div>

        <section className="notice-callout" role="note">
          <div className="callout-icon" aria-hidden="true">!</div>
          <div>
            <strong>등록하면 바로 게시됩니다.</strong>
            <p>학생들에게 공개되기 전에 제목, 작성자와 내용을 한 번 더 확인해 주세요.</p>
          </div>
        </section>

        {error && (
          <div className="feedback feedback-error" role="alert">
            <strong>공지를 등록하지 못했습니다.</strong>
            <span>{error}</span>
          </div>
        )}

        <form className="admin-form" onSubmit={handleSubmit}>
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
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy}
              required
            />
            <small className="field-help">학생들이 내용을 쉽게 알 수 있는 제목을 적어 주세요.</small>
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
              onChange={(event) => setAuthor(event.target.value)}
              disabled={busy}
              required
            />
            <small className="field-help">공지에 표시할 학생회나 담당 부서 이름을 적어 주세요.</small>
          </label>

          <label className="field-group">
            <span className="field-label">내용 <em>필수</em></span>
            <textarea
              value={content}
              rows={14}
              placeholder={"학생들에게 전달할 내용을 입력해 주세요.\n줄바꿈은 게시 화면에 그대로 반영됩니다."}
              onChange={(event) => setContent(event.target.value)}
              disabled={busy}
              required
            />
            <small className="field-help">줄바꿈도 작성한 모습 그대로 표시됩니다.</small>
          </label>

          <div className="form-actions form-actions-end">
            <button
              className="button button-secondary"
              type="button"
              onClick={() => { setTitle(""); setAuthor(""); setContent(""); setError(""); }}
              disabled={busy || (!title && !author && !content)}
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
            {content.trim() || "작성한 공지 내용을 미리 확인할 수 있습니다. 줄바꿈은 게시 화면에 그대로 표시됩니다."}
          </p>
        </article>
        <div className="info-note">
          <strong>등록 전 확인</strong>
          <ul>
            <li>작성자는 입력한 이름으로 표시됩니다.</li>
            <li>등록한 날짜와 시간이 자동으로 기록됩니다.</li>
            <li>등록 버튼을 누르면 바로 게시됩니다.</li>
          </ul>
        </div>
      </aside>
      </div>
      )}
    </AdminLoginNotice>
  );
}
