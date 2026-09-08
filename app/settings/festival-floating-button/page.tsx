"use client";

import {
  ArrowClockwise,
  CheckCircle,
  Confetti,
  Eye,
  EyeSlash,
  Info,
  SpinnerGap,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { AdminLoginNotice } from "../../components/AdminLoginNotice";
import { apiFetch, getErrorText } from "../../lib/api";
import { ADMIN_SESSION_EVENT, getAdminSession } from "../../lib/auth";
import {
  FESTIVAL_FLOATING_BUTTON_ENDPOINT,
  type FestivalFloatingButtonSetting,
  createFestivalFloatingButtonPatchBody,
  parseFestivalFloatingButtonSetting,
} from "../../lib/festival-floating-button";
import styles from "./festival-floating-button.module.css";

type LoadState = "idle" | "loading" | "ready" | "error";
type Feedback = {
  tone: "success" | "error";
  title: string;
  message: string;
};

const updatedAtFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "long",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

function formatUpdatedAt(value: string | null) {
  if (value === null) return "아직 변경 기록 없음";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "변경 시각 확인 불가" : updatedAtFormatter.format(date);
}

export default function FestivalFloatingButtonPage() {
  const [setting, setSetting] = useState<FestivalFloatingButtonSetting | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [retryTarget, setRetryTarget] = useState<boolean | null>(null);

  const loadController = useRef<AbortController | null>(null);
  const saveController = useRef<AbortController | null>(null);
  const mutationInProgress = useRef(false);

  const loadSetting = useCallback(async () => {
    loadController.current?.abort();
    const controller = new AbortController();
    loadController.current = controller;
    setSetting(null);
    setLoadState("loading");
    setLoadError("");
    setFeedback(null);
    setRetryTarget(null);

    try {
      const payload = await apiFetch<unknown>(FESTIVAL_FLOATING_BUTTON_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      setSetting(parseFestivalFloatingButtonSetting(payload));
      setLoadState("ready");
    } catch (error) {
      if (controller.signal.aborted) return;
      setSetting(null);
      setLoadState("error");
      setLoadError(getErrorText(error));
    } finally {
      if (loadController.current === controller) loadController.current = null;
    }
  }, []);

  useEffect(() => {
    const handleSessionChange = () => {
      if (getAdminSession()) {
        void loadSetting();
        return;
      }

      loadController.current?.abort();
      saveController.current?.abort();
      mutationInProgress.current = false;
      setSetting(null);
      setLoadState("idle");
      setLoadError("");
      setSaving(false);
      setFeedback(null);
      setRetryTarget(null);
    };

    const timeoutId = window.setTimeout(handleSessionChange, 0);
    window.addEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
      loadController.current?.abort();
      saveController.current?.abort();
    };
  }, [loadSetting]);

  const updateVisibility = useCallback(async (target: boolean) => {
    if (
      loadState !== "ready" ||
      setting === null ||
      saving ||
      mutationInProgress.current
    ) {
      return;
    }

    mutationInProgress.current = true;
    const controller = new AbortController();
    saveController.current = controller;
    setSaving(true);
    setFeedback(null);

    try {
      const payload = await apiFetch<unknown>(FESTIVAL_FLOATING_BUTTON_ENDPOINT, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createFestivalFloatingButtonPatchBody(target)),
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;

      const savedSetting = parseFestivalFloatingButtonSetting(payload);
      setSetting(savedSetting);
      setRetryTarget(null);
      setFeedback({
        tone: "success",
        title: savedSetting.visible ? "버튼을 표시하도록 저장했습니다." : "버튼을 숨기도록 저장했습니다.",
        message: "앱을 다시 열거나 홈 화면에 다시 들어오면 변경된 상태가 적용됩니다.",
      });
    } catch (error) {
      if (controller.signal.aborted) return;
      setRetryTarget(target);
      setFeedback({
        tone: "error",
        title: "변경 내용을 저장하지 못했습니다.",
        message: `${getErrorText(error)} 현재 상태는 바뀌지 않았습니다.`,
      });
    } finally {
      if (saveController.current === controller) saveController.current = null;
      mutationInProgress.current = false;
      setSaving(false);
    }
  }, [loadState, saving, setting]);

  const isVisible = setting?.visible ?? false;
  const switchDisabled = loadState !== "ready" || setting === null || saving;

  return (
    <AdminLoginNotice returnTo="/settings/festival-floating-button">
      <div className={styles.page}>
        {feedback && (
          <section
            className={`${styles.feedback} ${feedback.tone === "success" ? styles.successFeedback : styles.errorFeedback}`}
            role={feedback.tone === "error" ? "alert" : "status"}
          >
            {feedback.tone === "success" ? (
              <CheckCircle size={21} weight="fill" aria-hidden="true" />
            ) : (
              <WarningCircle size={21} weight="fill" aria-hidden="true" />
            )}
            <div>
              <strong>{feedback.title}</strong>
              <p>{feedback.message}</p>
            </div>
            {feedback.tone === "error" && retryTarget !== null && (
              <button
                className={styles.retryFeedbackButton}
                type="button"
                onClick={() => void updateVisibility(retryTarget)}
                disabled={saving}
              >
                <ArrowClockwise size={15} aria-hidden="true" />
                다시 저장
              </button>
            )}
            <button
              className={styles.dismissButton}
              type="button"
              onClick={() => setFeedback(null)}
              aria-label="알림 닫기"
            >
              <X size={17} aria-hidden="true" />
            </button>
          </section>
        )}

        <section className={styles.hero} aria-labelledby="festival-control-title">
          <div className={styles.heroIcon} aria-hidden="true">
            <Confetti size={30} weight="duotone" />
          </div>
          <div>
            <span className={styles.eyebrow}>홈 화면 노출 관리</span>
            <h2 id="festival-control-title">축제 플로팅 버튼</h2>
            <p>앱 홈의 대동제 바로가기 버튼만 제어합니다</p>
          </div>
          <span className={styles.instantBadge}>변경 즉시 저장</span>
        </section>

        <section className={styles.panel} aria-labelledby="visibility-title">
          <div className={styles.panelHeader}>
            <div className={styles.panelHeading}>
              <span className={styles.panelIcon} aria-hidden="true">
                {isVisible ? <Eye size={20} /> : <EyeSlash size={20} />}
              </span>
              <div>
                <h3 id="visibility-title">홈 바로가기 노출</h3>
                <p>현재 저장된 상태를 확인하고 바로 변경할 수 있습니다.</p>
              </div>
            </div>
          </div>

          {loadState === "loading" || loadState === "idle" ? (
            <div className={styles.loadingState} role="status">
              <SpinnerGap className={styles.spinner} size={22} aria-hidden="true" />
              <div>
                <strong>현재 노출 상태를 확인하고 있습니다.</strong>
                <p>상태를 불러온 뒤 스위치를 사용할 수 있습니다.</p>
              </div>
            </div>
          ) : loadState === "error" ? (
            <div className={styles.loadError} role="alert">
              <WarningCircle size={24} weight="fill" aria-hidden="true" />
              <div>
                <strong>현재 상태를 불러오지 못했습니다.</strong>
                <p>{loadError} 상태를 확인하기 전에는 변경할 수 없습니다.</p>
              </div>
              <button type="button" onClick={() => void loadSetting()}>
                <ArrowClockwise size={16} aria-hidden="true" />
                다시 시도
              </button>
            </div>
          ) : setting ? (
            <div className={styles.panelBody}>
              <div className={styles.controlRow}>
                <div className={styles.controlCopy}>
                  <span className={`${styles.statusDot} ${isVisible ? styles.visibleDot : ""}`} aria-hidden="true" />
                  <div>
                    <strong>{isVisible ? "앱 홈에 표시 중" : "앱 홈에서 숨김"}</strong>
                    <p>
                      {isVisible
                        ? "대동제 바로가기 버튼이 앱 홈에 표시되도록 설정되어 있습니다."
                        : "대동제 바로가기 버튼이 앱 홈에 표시되지 않도록 설정되어 있습니다."}
                    </p>
                  </div>
                </div>

                <div className={styles.switchArea}>
                  <button
                    className={styles.switch}
                    type="button"
                    role="switch"
                    aria-checked={isVisible}
                    aria-label="축제 플로팅 버튼 노출"
                    disabled={switchDisabled}
                    onClick={() => void updateVisibility(!setting.visible)}
                  >
                    <span className={styles.switchThumb} />
                  </button>
                  <span>{isVisible ? "켜짐" : "꺼짐"}</span>
                </div>
              </div>

              <div className={styles.metaRow}>
                <span>마지막 변경</span>
                <strong>{formatUpdatedAt(setting.updatedAt)}</strong>
              </div>

              {saving && (
                <div className={styles.savingState} role="status">
                  <SpinnerGap className={styles.spinner} size={17} aria-hidden="true" />
                  변경 내용을 저장하고 있습니다. 완료될 때까지 잠시 기다려 주세요.
                </div>
              )}
            </div>
          ) : null}
        </section>

        <section className={styles.scopeNote} aria-labelledby="scope-note-title">
          <span className={styles.noteIcon} aria-hidden="true"><Info size={20} /></span>
          <div>
            <h3 id="scope-note-title">이 설정이 바꾸는 범위</h3>
            <p>
              버튼을 숨겨도 대동제 화면은 다른 경로에서 계속 열 수 있습니다.
              팝업 노출과 대동제 화면의 내용에는 영향을 주지 않습니다.
            </p>
          </div>
        </section>
      </div>
    </AdminLoginNotice>
  );
}
