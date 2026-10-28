"use client";

import {
  ArrowClockwise,
  CheckCircle,
  ChatText,
  FloppyDisk,
  SpinnerGap,
  Trash,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { type FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { AdminLoginNotice } from "../../components/AdminLoginNotice";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { UnsavedChangesDialog } from "../../components/UnsavedChangesDialog";
import { ApiError, apiFetch, getErrorText } from "../../lib/api";
import { ADMIN_SESSION_EVENT, getAdminSession } from "../../lib/auth";
import {
  HOME_MESSAGE_ENDPOINT,
  HOME_MESSAGE_MAX_LENGTH,
  parseHomeMessageSetting,
  validateHomeMessage,
} from "../../lib/home-message";
import styles from "./home-message.module.css";

type LoadState = "idle" | "loading" | "ready" | "error";
type Feedback = { tone: "success" | "error"; message: string };

function errorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 400 && error.payload && typeof error.payload === "object") {
    const message = (error.payload as Record<string, unknown>).message;
    if (typeof message === "string" && message.length <= 300 && !/[<>\u0000-\u001f]/.test(message)) {
      return message;
    }
  }
  return getErrorText(error);
}

export default function HomeMessagePage() {
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState("");
  const [savedMessage, setSavedMessage] = useState("");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const saveController = useRef<AbortController | null>(null);
  const mutationInProgress = useRef(false);

  const isDirty = loadState === "ready" && draft !== savedMessage;
  const validationError = validateHomeMessage(draft);

  const loadMessage = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setLoadState("loading");
    setLoadError("");
    setFeedback(null);

    try {
      const response = await apiFetch<unknown>(HOME_MESSAGE_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const setting = parseHomeMessageSetting(response);
      setSavedMessage(setting.message);
      setDraft(setting.message);
      setLoadState("ready");
    } catch (error) {
      if (controller.signal.aborted) return;
      setLoadError(errorMessage(error));
      setLoadState("error");
    } finally {
      if (loadController.current === controller) loadController.current = null;
    }
  }, []);

  useEffect(() => {
    const handleSessionChange = () => {
      if (getAdminSession()) {
        void loadMessage();
        return;
      }
      loadController.current?.abort();
      saveController.current?.abort();
      mutationInProgress.current = false;
      setLoadState("idle");
      setLoadError("");
      setSavedMessage("");
      setDraft("");
      setSaving(false);
      setClearOpen(false);
      setFeedback(null);
    };

    const timeoutId = window.setTimeout(handleSessionChange, 0);
    window.addEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
      loadController.current?.abort();
      saveController.current?.abort();
    };
  }, [loadMessage]);

  async function putMessage(message: string) {
    if (loadState !== "ready" || mutationInProgress.current) return;
    const validation = validateHomeMessage(message);
    if (validation) {
      setFeedback({ tone: "error", message: validation });
      return;
    }

    mutationInProgress.current = true;
    const controller = new AbortController();
    saveController.current = controller;
    setSaving(true);
    setFeedback(null);
    try {
      const response = await apiFetch<unknown>(HOME_MESSAGE_ENDPOINT, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message }),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      const setting = parseHomeMessageSetting(response);
      setSavedMessage(setting.message);
      setDraft(setting.message);
      setClearOpen(false);
      setFeedback({
        tone: "success",
        message: setting.message ? "메인페이지 메시지를 저장했습니다." : "메인페이지 메시지를 해제했습니다.",
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setClearOpen(false);
      setFeedback({ tone: "error", message: errorMessage(error) });
    } finally {
      if (saveController.current === controller) saveController.current = null;
      mutationInProgress.current = false;
      setSaving(false);
    }
  }

  function submitMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isDirty || saving) return;
    void putMessage(draft);
  }

  return (
    <AdminLoginNotice returnTo="/settings/home-message">
      <UnsavedChangesDialog dirty={isDirty && !saving} />
      <div className={styles.page}>
        <header className={styles.hero}>
          <span className={styles.heroIcon} aria-hidden="true"><ChatText size={27} weight="duotone" /></span>
          <div>
            <span className={styles.eyebrow}>홈 화면 운영</span>
            <h2>메인페이지 메시지</h2>
            <p>모든 사용자에게 표시할 공통 문구를 설정합니다.</p>
          </div>
          <span className={styles.scopeBadge}>전체 사용자 공통</span>
        </header>

        {feedback && (
          <div className={`${styles.feedback} ${feedback.tone === "success" ? styles.success : styles.error}`} role={feedback.tone === "error" ? "alert" : "status"}>
            {feedback.tone === "success" ? <CheckCircle size={20} weight="fill" aria-hidden="true" /> : <WarningCircle size={20} weight="fill" aria-hidden="true" />}
            <span>{feedback.message}</span>
            <button type="button" aria-label="안내 닫기" onClick={() => setFeedback(null)}><X size={17} /></button>
          </div>
        )}

        {loadState === "idle" || loadState === "loading" ? (
          <section className={styles.statePanel} role="status">
            <SpinnerGap className={styles.spinner} size={24} aria-hidden="true" />
            <div><strong>현재 메시지를 불러오고 있습니다.</strong><p>잠시만 기다려 주세요.</p></div>
          </section>
        ) : loadState === "error" ? (
          <section className={styles.statePanel} role="alert">
            <WarningCircle size={24} weight="fill" aria-hidden="true" />
            <div><strong>현재 메시지를 불러오지 못했습니다.</strong><p>{loadError}</p></div>
            <button className={styles.secondaryButton} type="button" onClick={() => void loadMessage()}>
              <ArrowClockwise size={17} aria-hidden="true" /> 다시 시도
            </button>
          </section>
        ) : (
          <div className={styles.workspace}>
            <section className={styles.panel} aria-labelledby="message-editor-title">
              <div className={styles.panelHeader}>
                <div>
                  <h3 id="message-editor-title">메시지 작성</h3>
                  <p>수정한 문구는 저장한 뒤 모든 사용자에게 적용됩니다.</p>
                </div>
                {isDirty && <span className={styles.unsavedBadge}>저장 전 변경</span>}
              </div>
              <form onSubmit={submitMessage} className={styles.form}>
                <label htmlFor="home-message-input">메인페이지에 표시할 문구</label>
                <textarea
                  id="home-message-input"
                  name="message"
                  value={draft}
                  maxLength={HOME_MESSAGE_MAX_LENGTH}
                  rows={6}
                  placeholder="예: 오늘도 한서메이트와 함께 좋은 하루 보내세요!"
                  aria-describedby="home-message-help home-message-count"
                  aria-invalid={Boolean(validationError) || undefined}
                  disabled={saving}
                  onChange={(event) => { setDraft(event.target.value); setFeedback(null); }}
                />
                <div className={styles.fieldMeta}>
                  <p id="home-message-help">앞뒤 공백과 줄바꿈은 저장할 때 정리됩니다. 문구 안의 줄바꿈은 유지됩니다.</p>
                  <span id="home-message-count">{draft.length} / {HOME_MESSAGE_MAX_LENGTH}자</span>
                </div>
                <div className={styles.actions}>
                  <button
                    className={styles.dangerButton}
                    type="button"
                    disabled={saving || !savedMessage}
                    onClick={() => setClearOpen(true)}
                  >
                    <Trash size={17} aria-hidden="true" /> 메시지 해제
                  </button>
                  <span className={styles.actionSpacer} />
                  <button className={styles.secondaryButton} type="button" disabled={saving || !isDirty} onClick={() => { setDraft(savedMessage); setFeedback(null); }}>
                    변경 취소
                  </button>
                  <button className={styles.primaryButton} type="submit" disabled={saving || !isDirty || Boolean(validationError)}>
                    {saving ? <SpinnerGap className={styles.spinner} size={17} aria-hidden="true" /> : <FloppyDisk size={17} aria-hidden="true" />}
                    {saving ? "저장 중..." : "메시지 저장"}
                  </button>
                </div>
              </form>
            </section>

            <aside className={styles.previewPanel} aria-labelledby="message-preview-title">
              <div className={styles.previewHeader}>
                <span className={styles.previewIcon} aria-hidden="true"><ChatText size={19} /></span>
                <div><h3 id="message-preview-title">현재 게시된 메시지</h3><p>마지막으로 저장된 문구입니다.</p></div>
              </div>
              {savedMessage ? (
                <p className={styles.previewText}>{savedMessage}</p>
              ) : (
                <p className={styles.emptyPreview}>설정된 메시지가 없습니다.</p>
              )}
              <p className={styles.previewNote}>변경 내용은 저장이 완료되면 여기에 반영됩니다.</p>
            </aside>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={clearOpen}
        title="메인페이지 메시지를 해제할까요?"
        description="저장된 문구가 모든 사용자 화면에서 사라집니다. 작성 중인 변경사항도 지워집니다."
        confirmLabel="메시지 해제"
        danger
        busy={saving}
        onCancel={() => setClearOpen(false)}
        onConfirm={() => void putMessage("")}
      />
    </AdminLoginNotice>
  );
}
