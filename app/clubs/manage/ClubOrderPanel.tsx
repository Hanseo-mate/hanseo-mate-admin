"use client";

import { ArrowDown, ArrowLeft, ArrowUp, DotsSixVertical } from "@phosphor-icons/react";
import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { UnsavedChangesDialog } from "../../components/UnsavedChangesDialog";
import { ApiError, apiFetch, getErrorText } from "../../lib/api";
import {
  type ClubSummary,
  getClubCategoryLabel,
  moveClub,
  parseClubSummaries,
} from "../../lib/clubs";
import styles from "./club-order.module.css";

type Feedback = { tone: "success" | "error"; title: string; message: string };
type DragPreview = { id: number; name: string; targetId: number | null; x: number; y: number };

function idsOf(clubs: readonly ClubSummary[]) {
  return clubs.map((club) => club.id);
}

function clubIdAtPoint(x: number, y: number) {
  const element = document.elementFromPoint(x, y);
  let row = element?.closest<HTMLElement>("[data-club-order-id]");
  if (!row) {
    const list = element?.closest<HTMLElement>("[data-club-order-list]");
    const rows = list?.querySelectorAll<HTMLElement>("[data-club-order-id]");
    if (rows?.length) {
      row = [...rows].reduce((nearest, candidate) => {
        const nearestDistance = Math.abs(nearest.getBoundingClientRect().top + nearest.offsetHeight / 2 - y);
        const candidateDistance = Math.abs(candidate.getBoundingClientRect().top + candidate.offsetHeight / 2 - y);
        return candidateDistance < nearestDistance ? candidate : nearest;
      });
    }
  }
  const id = Number(row?.dataset.clubOrderId);
  return row && Number.isInteger(id) && id > 0 ? id : null;
}

export function ClubOrderPanel({ onClose }: { onClose: () => void }) {
  const [clubs, setClubs] = useState<ClubSummary[]>([]);
  const [savedIds, setSavedIds] = useState<number[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [loadingError, setLoadingError] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [confirmClose, setConfirmClose] = useState(false);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const requestController = useRef<AbortController | null>(null);
  const savingRef = useRef(false);
  const dragRef = useRef<DragPreview | null>(null);

  const isDirty = useMemo(
    () => state === "ready" && JSON.stringify(idsOf(clubs)) !== JSON.stringify(savedIds),
    [clubs, savedIds, state],
  );

  const loadClubs = useCallback(async () => {
    requestController.current?.abort();
    const controller = new AbortController();
    requestController.current = controller;
    setState("loading");
    setLoadingError("");

    try {
      const response = await apiFetch<unknown>("/api/admin/clubs", {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return false;
      const nextClubs = parseClubSummaries(response);
      setClubs(nextClubs);
      setSavedIds(idsOf(nextClubs));
      setState("ready");
      return true;
    } catch (error) {
      if (controller.signal.aborted) return false;
      setState("error");
      setLoadingError(getErrorText(error));
      return false;
    } finally {
      if (requestController.current === controller) requestController.current = null;
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => void loadClubs(), 0);
    return () => {
      window.clearTimeout(timeoutId);
      requestController.current?.abort();
    };
  }, [loadClubs]);

  function move(fromIndex: number, toIndex: number) {
    setClubs((current) => moveClub(current, fromIndex, toIndex));
    setFeedback(null);
  }

  function startDrag(event: ReactPointerEvent<HTMLButtonElement>, club: ClubSummary) {
    if (saving || (event.pointerType === "mouse" && event.button !== 0)) return;
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    const preview = {
      id: club.id,
      name: club.name,
      targetId: club.id,
      x: event.clientX,
      y: event.clientY,
    };
    dragRef.current = preview;
    setDragPreview(preview);
    setAnnouncement("");
  }

  function updateDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const current = dragRef.current;
    if (!current) return;
    const preview = {
      ...current,
      targetId: clubIdAtPoint(event.clientX, event.clientY),
      x: event.clientX,
      y: event.clientY,
    };
    dragRef.current = preview;
    setDragPreview(preview);
  }

  function finishDrag(event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) {
    const current = dragRef.current;
    if (!current) return;
    dragRef.current = null;
    setDragPreview(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (cancelled) return;

    const targetId = clubIdAtPoint(event.clientX, event.clientY);
    if (targetId === null || targetId === current.id) return;
    setClubs((items) => {
      const fromIndex = items.findIndex((item) => item.id === current.id);
      const toIndex = items.findIndex((item) => item.id === targetId);
      return moveClub(items, fromIndex, toIndex);
    });
    setFeedback(null);
    setAnnouncement(`${current.name}의 순서를 옮겼습니다. 저장하면 앱에 반영됩니다.`);
  }

  function requestClose() {
    if (isDirty) setConfirmClose(true);
    else onClose();
  }

  async function saveOrder() {
    if (!isDirty || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setFeedback(null);
    const clubIds = idsOf(clubs);

    try {
      await apiFetch<void>("/api/admin/clubs/order", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clubIds }),
      });
      setSavedIds(clubIds);
      const refreshed = await loadClubs();
      setFeedback({
        tone: "success",
        title: "동아리 표시 순서를 저장했습니다.",
        message: refreshed
          ? "앱의 동아리 목록에 적용할 전체 순서를 다시 확인했습니다."
          : "저장은 완료되었지만 목록을 다시 불러오지 못했습니다. 새로고침해 확인해 주세요.",
      });
    } catch (error) {
      if (error instanceof ApiError && error.status === 400) {
        const serverMessage = error.payload && typeof error.payload === "object" && "message" in error.payload
          && typeof error.payload.message === "string"
          ? error.payload.message
          : "동아리 목록이 변경되었거나 순서를 확인할 수 없습니다.";
        await loadClubs();
        setFeedback({
          tone: "error",
          title: "순서를 저장하지 못했습니다.",
          message: `${serverMessage} 최신 목록에서 순서를 다시 조정해 주세요.`,
        });
      } else {
        setFeedback({
          tone: "error",
          title: "순서를 저장하지 못했습니다.",
          message: getErrorText(error),
        });
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  return (
    <section className={`panel ${styles.panel}`} aria-labelledby="club-order-title">
      <UnsavedChangesDialog dirty={isDirty} />
      <div className={styles.heading}>
        <div>
          <span className="eyebrow dark">동아리 운영</span>
          <h2 id="club-order-title">동아리 표시 순서</h2>
          <p>손잡이를 끌어 놓거나 위·아래 버튼으로 순서를 바꿔 주세요. 앱에는 이 순서가 분과별로도 적용됩니다.</p>
        </div>
        <button className="button button-secondary" type="button" onClick={requestClose} disabled={saving}>
          <ArrowLeft size={17} aria-hidden="true" /> 동아리 관리로
        </button>
      </div>

      {feedback && (
        <div className={`feedback feedback-${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>
          <strong>{feedback.title}</strong>
          <span>{feedback.message}</span>
        </div>
      )}
      <span className="sr-only" role="status" aria-live="polite">{announcement}</span>

      {state === "loading" && <p className={styles.message} role="status">전체 동아리 목록을 불러오고 있습니다.</p>}
      {state === "error" && (
        <div className={styles.message} role="alert">
          <strong>전체 동아리 목록을 불러오지 못했습니다.</strong>
          <p>{loadingError}</p>
          <button className="button button-secondary" type="button" onClick={() => void loadClubs()}>다시 시도</button>
        </div>
      )}
      {state === "ready" && (
        <>
          <div className={styles.summary}>
            <span>전체 {clubs.length}개 동아리</span>
            {isDirty && <span className="badge badge-warning">저장하지 않은 순서</span>}
          </div>
          {clubs.length === 0 ? (
            <p className={styles.message}>등록된 동아리가 없습니다.</p>
          ) : (
            <ol className={styles.list} aria-label="동아리 표시 순서" data-club-order-list>
              {clubs.map((club, index) => (
                <li
                  className={`${styles.item} ${dragPreview?.id === club.id ? styles.dragging : ""} ${dragPreview?.targetId === club.id && dragPreview.id !== club.id ? styles.dropTarget : ""}`}
                  data-club-order-id={club.id}
                  key={club.id}
                >
                  <span className={styles.position}>{index + 1}</span>
                  <button
                    className={styles.dragHandle}
                    type="button"
                    aria-label={`${club.name} 끌어서 순서 변경`}
                    title="끌어서 순서 변경"
                    disabled={saving}
                    onPointerDown={(event) => startDrag(event, club)}
                    onPointerMove={updateDrag}
                    onPointerUp={(event) => finishDrag(event)}
                    onPointerCancel={(event) => finishDrag(event, true)}
                    onLostPointerCapture={() => { dragRef.current = null; setDragPreview(null); }}
                  >
                    <DotsSixVertical size={20} aria-hidden="true" />
                  </button>
                  <span className={styles.club}>
                    <strong>{club.name}</strong>
                    <small>{getClubCategoryLabel(club.category)}</small>
                  </span>
                  <span className={styles.controls}>
                    <button type="button" aria-label={`${club.name} 위로 이동`} title="위로 이동"
                      disabled={saving || index === 0} onClick={() => move(index, index - 1)}>
                      <ArrowUp size={18} aria-hidden="true" />
                    </button>
                    <button type="button" aria-label={`${club.name} 아래로 이동`} title="아래로 이동"
                      disabled={saving || index === clubs.length - 1} onClick={() => move(index, index + 1)}>
                      <ArrowDown size={18} aria-hidden="true" />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          )}
          {dragPreview && (
            <div className={styles.dragGhost} style={{ left: dragPreview.x + 16, top: dragPreview.y + 16 }} aria-hidden="true">
              <DotsSixVertical size={18} /> {dragPreview.name}
            </div>
          )}
          <div className={styles.actions}>
            <button className="button button-secondary" type="button" disabled={!isDirty || saving}
              onClick={() => { setClubs((current) => savedIds.map((id) => current.find((club) => club.id === id)!)); setFeedback(null); }}>
              변경 취소
            </button>
            <button className="button button-primary" type="button" disabled={!isDirty || saving}
              onClick={() => void saveOrder()}>
              {saving ? "저장 중..." : "표시 순서 저장"}
            </button>
          </div>
        </>
      )}

      <ConfirmDialog
        open={confirmClose}
        title="변경한 순서를 버릴까요?"
        description="저장하지 않은 동아리 표시 순서가 사라집니다."
        confirmLabel="변경 버리고 이동"
        busy={false}
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => { setConfirmClose(false); onClose(); }}
      />
    </section>
  );
}
