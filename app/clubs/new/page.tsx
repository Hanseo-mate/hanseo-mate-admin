"use client";

import { Check, CheckCircle, ImageSquare, NotePencil } from "@phosphor-icons/react";
import Link from "next/link";
import { type FormEvent, useRef, useState } from "react";
import { AdminLoginNotice } from "../../components/AdminLoginNotice";
import { UnsavedChangesDialog } from "../../components/UnsavedChangesDialog";
import { getAdminSession } from "../../lib/auth";
import { apiFetch, getErrorText } from "../../lib/api";
import { clubCategories } from "../../lib/clubs";

type CreatedClub = { id: number };

export default function NewClubPage() {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [busy, setBusy] = useState(false);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [error, setError] = useState("");
  const submittingRef = useRef(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current || createdId !== null) return;
    if (!getAdminSession()) return;

    setError("");

    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("동아리 이름을 입력해 주세요.");
      return;
    }
    if (trimmedName.length > 100) {
      setError("동아리 이름은 100자 이하로 입력해 주세요.");
      return;
    }
    if (!category) {
      setError("동아리 분과를 선택해 주세요.");
      return;
    }

    submittingRef.current = true;
    setBusy(true);
    try {
      const response = await apiFetch<CreatedClub>("/api/admin/clubs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, category }),
      });
      setCreatedId(response.id);
    } catch (requestError) {
      setError(getErrorText(requestError));
    } finally {
      submittingRef.current = false;
      setBusy(false);
    }
  }

  return (
    <AdminLoginNotice returnTo="/clubs/new">
      <UnsavedChangesDialog dirty={createdId === null && Boolean(name || category)} />
      <div className="form-page-grid club-create-grid">
        <section className="panel form-panel">
        <div className="panel-heading panel-heading-border">
          <div>
            <span className="eyebrow dark">동아리 등록</span>
            <h2>동아리 기본 정보</h2>
            <p>이름과 분과를 입력해 동아리를 등록해 주세요.</p>
          </div>
        </div>

        {error && createdId === null && (
          <div className="feedback feedback-error" role="alert">
            <strong>동아리를 등록할 수 없습니다.</strong>
            <span>{error}</span>
          </div>
        )}

        {createdId !== null ? (
          <div className="creation-success" role="status">
            <div className="success-check" aria-hidden="true"><CheckCircle size={24} weight="fill" /></div>
            <div>
              <span>등록 완료</span>
              <h3>기본 정보가 저장되었습니다.</h3>
              <p>이제 한 줄 소개와 활동 내용, 대표·배경 사진을 추가해 주세요.</p>
              <Link className="button button-primary" href={`/clubs/manage?id=${createdId}`}>
                소개와 사진 등록하기
              </Link>
            </div>
          </div>
        ) : (
          <form className="admin-form" onSubmit={handleSubmit}>
          <label className="field-group">
            <span className="field-label">
              동아리 이름 <em>필수</em>
              <small className={name.length > 100 ? "limit-over" : ""}>{name.length} / 100</small>
            </span>
            <input
              type="text"
              value={name}
              maxLength={100}
              placeholder="예: 한서 사진연구회"
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              required
            />
            <small className="field-help">다른 동아리와 중복되지 않는 이름을 입력해 주세요.</small>
          </label>

          <fieldset className="field-group category-fieldset">
            <legend className="field-label">분과 <em>필수</em></legend>
            <div className="category-grid">
              {clubCategories.map((item) => (
                <label className={`category-option ${category === item.value ? "selected" : ""}`} key={item.value}>
                  <input
                    type="radio"
                    name="category"
                    value={item.value}
                    checked={category === item.value}
                    onChange={(event) => setCategory(event.target.value)}
                    disabled={busy}
                  />
                  <span className="category-radio" />
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="form-actions form-actions-end">
            <Link className="button button-secondary" href="/clubs/manage">취소</Link>
            <button className="button button-primary" type="submit" disabled={busy}>
              {busy ? "저장 중..." : "기본 정보 저장하고 다음"}
            </button>
          </div>
          </form>
        )}
        </section>

        <aside className="club-guide-card">
        <span className="eyebrow">등록 안내</span>
        <h2>등록 순서</h2>
        <ol>
          <li className="active"><span><Check size={17} weight="bold" /></span><div><strong>기본 정보</strong><small>이름과 분과 등록</small></div></li>
          <li><span><NotePencil size={17} /></span><div><strong>소개와 활동 정보</strong><small>한 줄 소개와 모집 내용 작성</small></div></li>
          <li><span><ImageSquare size={17} /></span><div><strong>대표와 배경 사진</strong><small>각 5MB 이하 사진 등록</small></div></li>
        </ol>
        <p>분과는 동아리를 등록한 뒤에는 바꿀 수 없습니다. 선택한 분과가 맞는지 꼭 확인해 주세요.</p>
        </aside>
      </div>
    </AdminLoginNotice>
  );
}
