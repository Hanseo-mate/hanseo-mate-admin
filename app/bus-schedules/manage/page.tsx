"use client";

import {
  ArrowClockwise,
  Bus,
  CheckCircle,
  FileImage,
  ImageSquare,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
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
import { UnsavedChangesDialog } from "../../components/UnsavedChangesDialog";
import { apiFetch, getErrorText } from "../../lib/api";
import { ADMIN_SESSION_EVENT, getAdminSession } from "../../lib/auth";
import {
  BUS_SCHEDULE_GROUPS,
  BUS_SCHEDULE_SLOTS,
  type BusSchedule,
  type BusScheduleSlot,
  type SubCategory,
  busScheduleKey,
  createBusScheduleUploadBody,
  parseBusSchedule,
  parseBusSchedules,
  validateBusScheduleImage,
} from "../../lib/bus-schedules";
import styles from "../bus-schedules.module.css";

type LoadState = "idle" | "loading" | "ready" | "error";
type Feedback = {
  tone: "success" | "error" | "info";
  title: string;
  message: string;
};
type PendingFiles = Partial<Record<SubCategory, File>>;

const BUS_SCHEDULE_LIST_ENDPOINT = "/api/bus-schedules";
const BUS_SCHEDULE_UPLOAD_ENDPOINT = "/api/admin/bus-schedules";

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

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function ScheduleImage({
  file,
  imageUrl,
  alt,
}: {
  file?: File;
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
    const objectUrl = URL.createObjectURL(file);
    imageRef.current.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (!file && !imageUrl) {
    return (
      <div className={styles.imageFallback} role="img" aria-label={`${alt}: 등록된 사진 없음`}>
        <ImageSquare size={30} aria-hidden="true" />
        <strong>등록된 시간표가 없습니다.</strong>
        <span>아래에서 사진을 선택해 주세요.</span>
      </div>
    );
  }

  if (failedSource === sourceKey) {
    return (
      <div className={styles.imageFallback} role="img" aria-label={`${alt}: 사진을 불러오지 못함`}>
        <WarningCircle size={30} aria-hidden="true" />
        <strong>시간표 사진을 불러오지 못했습니다.</strong>
        <span>새로고침한 뒤 다시 확인해 주세요.</span>
      </div>
    );
  }

  return (
    // 공개 이미지 주소는 실행 환경에 따라 달라 정적 이미지 설정을 사용할 수 없습니다.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imageRef}
      src={file ? undefined : imageUrl}
      alt={alt}
      loading="lazy"
      onLoad={() => setFailedSource(null)}
      onError={() => setFailedSource(sourceKey)}
    />
  );
}

function LoadingCards() {
  return (
    <div className={styles.loadingGrid} role="status" aria-live="polite">
      <span className={styles.visuallyHidden}>버스 시간표를 불러오고 있습니다.</span>
      {Array.from({ length: 6 }, (_, index) => (
        <div className={styles.loadingCard} aria-hidden="true" key={index}>
          <span className={styles.loadingHeading} />
          <span className={styles.loadingImage} />
          <span className={styles.loadingLine} />
        </div>
      ))}
    </div>
  );
}

export default function ManageBusSchedulesPage() {
  const [schedules, setSchedules] = useState<BusSchedule[]>([]);
  const [pendingFiles, setPendingFiles] = useState<PendingFiles>({});
  const [listState, setListState] = useState<LoadState>("idle");
  const [listError, setListError] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busySlot, setBusySlot] = useState<SubCategory | null>(null);
  const [draggingSlot, setDraggingSlot] = useState<SubCategory | null>(null);
  const [refreshConfirmOpen, setRefreshConfirmOpen] = useState(false);

  const listController = useRef<AbortController | null>(null);
  const mutationInProgress = useRef(false);
  const inputRefs = useRef<Partial<Record<SubCategory, HTMLInputElement | null>>>({});

  const isBusy = busySlot !== null;
  const hasPendingFiles = Object.keys(pendingFiles).length > 0;
  const scheduleByKey = useMemo(() => {
    const result = new Map<string, BusSchedule>();
    for (const schedule of schedules) {
      result.set(busScheduleKey(schedule.mainCategory, schedule.subCategory), schedule);
    }
    return result;
  }, [schedules]);
  const registeredCount = scheduleByKey.size;

  const loadSchedules = useCallback(async () => {
    listController.current?.abort();
    const controller = new AbortController();
    listController.current = controller;
    setListState("loading");
    setListError("");

    try {
      const response = await apiFetch<unknown>(BUS_SCHEDULE_LIST_ENDPOINT, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setSchedules(parseBusSchedules(response));
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
        void loadSchedules();
        return;
      }
      listController.current?.abort();
      setSchedules([]);
      setPendingFiles({});
      setListState("idle");
      setListError("");
      setFeedback(null);
    };

    const timeoutId = window.setTimeout(handleSessionChange, 0);
    window.addEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
      listController.current?.abort();
    };
  }, [loadSchedules]);

  useEffect(() => {
    if (!hasPendingFiles) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [hasPendingFiles]);

  function resetInput(subCategory: SubCategory) {
    const input = inputRefs.current[subCategory];
    if (input) input.value = "";
  }

  function clearAllPendingFiles() {
    setPendingFiles({});
    for (const slot of BUS_SCHEDULE_SLOTS) resetInput(slot.subCategory);
  }

  function chooseFile(slot: BusScheduleSlot, file: File | null) {
    if (!file || isBusy) return;
    const validationError = validateBusScheduleImage(file);
    if (validationError) {
      resetInput(slot.subCategory);
      setFeedback({
        tone: "error",
        title: `${slot.label} 사진을 선택할 수 없습니다.`,
        message: validationError,
      });
      return;
    }

    setPendingFiles((current) => ({ ...current, [slot.subCategory]: file }));
    setFeedback(null);
  }

  function cancelFile(slot: BusScheduleSlot) {
    setPendingFiles((current) => {
      const next = { ...current };
      delete next[slot.subCategory];
      return next;
    });
    resetInput(slot.subCategory);
    setFeedback(null);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>, slot: BusScheduleSlot) {
    event.preventDefault();
    setDraggingSlot(null);
    if (!isBusy) chooseFile(slot, event.dataTransfer.files?.[0] ?? null);
  }

  function openFilePicker(
    event: KeyboardEvent<HTMLLabelElement>,
    subCategory: SubCategory,
  ) {
    if (isBusy || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    inputRefs.current[subCategory]?.click();
  }

  async function uploadSchedule(slot: BusScheduleSlot) {
    const image = pendingFiles[slot.subCategory];
    if (!image || mutationInProgress.current) return;

    const validationError = validateBusScheduleImage(image);
    if (validationError) {
      setFeedback({
        tone: "error",
        title: `${slot.label} 시간표를 저장할 수 없습니다.`,
        message: validationError,
      });
      return;
    }

    const previous = scheduleByKey.get(busScheduleKey(slot.mainCategory, slot.subCategory));
    mutationInProgress.current = true;
    setBusySlot(slot.subCategory);
    setFeedback(null);

    try {
      const body = createBusScheduleUploadBody({
        image,
        mainCategory: slot.mainCategory,
        subCategory: slot.subCategory,
      });
      const saved = parseBusSchedule(await apiFetch<unknown>(BUS_SCHEDULE_UPLOAD_ENDPOINT, {
        method: "POST",
        body,
      }));

      setSchedules((current) => [
        ...current.filter((item) => (
          item.mainCategory !== saved.mainCategory || item.subCategory !== saved.subCategory
        )),
        saved,
      ]);
      setPendingFiles((current) => {
        const next = { ...current };
        delete next[slot.subCategory];
        return next;
      });
      resetInput(slot.subCategory);
      setListState("ready");
      setFeedback({
        tone: "success",
        title: previous ? `${slot.label} 시간표를 교체했습니다.` : `${slot.label} 시간표를 등록했습니다.`,
        message: "선택한 사진이 바로 반영되었습니다.",
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        title: previous ? `${slot.label} 시간표를 교체하지 못했습니다.` : `${slot.label} 시간표를 등록하지 못했습니다.`,
        message: getErrorText(error),
      });
    } finally {
      mutationInProgress.current = false;
      setBusySlot(null);
    }
  }

  function requestRefresh() {
    if (isBusy || listState === "loading") return;
    if (hasPendingFiles) {
      setRefreshConfirmOpen(true);
      return;
    }
    setFeedback(null);
    void loadSchedules();
  }

  return (
    <AdminLoginNotice returnTo="/bus-schedules/manage">
      <UnsavedChangesDialog dirty={hasPendingFiles} />

      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <h2>버스 시간표 관리</h2>
            <p>버스 종류와 운행 구간별 시간표 사진을 확인하고 새 사진으로 바꿀 수 있습니다.</p>
          </div>
          <button
            className={`${styles.button} ${styles.secondaryButton}`}
            type="button"
            onClick={requestRefresh}
            disabled={isBusy || listState === "loading"}
          >
            <ArrowClockwise size={17} aria-hidden="true" />
            {listState === "loading" ? "불러오는 중" : "새로고침"}
          </button>
        </header>

        <section className={styles.overview} aria-label="버스 시간표 등록 현황">
          <span className={styles.overviewIcon} aria-hidden="true"><Bus size={24} /></span>
          <div>
            <strong>전체 운행 구간을 한곳에서 관리합니다.</strong>
            <p>같은 구간에 새 사진을 적용하면 기존 시간표가 자동으로 교체됩니다.</p>
          </div>
          <span className={styles.overviewCount}>
            등록 <strong>{registeredCount}</strong> / {BUS_SCHEDULE_SLOTS.length}
          </span>
        </section>

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

        {(listState === "idle" || listState === "loading") && schedules.length === 0 ? (
          <LoadingCards />
        ) : listState === "error" && schedules.length === 0 ? (
          <section className={styles.errorState} role="alert">
            <WarningCircle size={30} aria-hidden="true" />
            <strong>버스 시간표를 불러오지 못했습니다.</strong>
            <p>{listError}</p>
            <button
              className={`${styles.button} ${styles.secondaryButton}`}
              type="button"
              onClick={() => void loadSchedules()}
            >
              다시 시도
            </button>
          </section>
        ) : (
          <>
            {listState === "error" && (
              <div className={styles.staleWarning} role="alert">
                <WarningCircle size={18} aria-hidden="true" />
                <span>최신 시간표를 불러오지 못했습니다. 현재 화면을 확인한 뒤 다시 시도해 주세요.</span>
                <button type="button" onClick={requestRefresh}>다시 시도</button>
              </div>
            )}

            {listState === "ready" && registeredCount === 0 && (
              <div className={styles.emptyNotice} role="status">
                <ImageSquare size={20} aria-hidden="true" />
                <div>
                  <strong>등록된 시간표가 없습니다.</strong>
                  <p>아래 운행 구간에서 시간표 사진을 하나씩 등록해 주세요.</p>
                </div>
              </div>
            )}

            <div className={styles.groups}>
              {BUS_SCHEDULE_GROUPS.map((group) => {
                const groupCount = group.slots.filter((slot) => (
                  scheduleByKey.has(busScheduleKey(slot.mainCategory, slot.subCategory))
                )).length;

                return (
                  <section className={styles.group} key={group.mainCategory} aria-labelledby={`bus-group-${group.mainCategory}`}>
                    <header className={styles.groupHeader}>
                      <div>
                        <span>버스 종류</span>
                        <h3 id={`bus-group-${group.mainCategory}`}>{group.label}</h3>
                        <p>{group.description}</p>
                      </div>
                      <span className={styles.groupCount}>등록 {groupCount} / {group.slots.length}</span>
                    </header>

                    <div className={styles.cardGrid}>
                      {group.slots.map((slot) => {
                        const schedule = scheduleByKey.get(busScheduleKey(slot.mainCategory, slot.subCategory));
                        const pendingFile = pendingFiles[slot.subCategory];
                        const uploading = busySlot === slot.subCategory;
                        const dragging = draggingSlot === slot.subCategory;

                        return (
                          <article className={styles.card} key={slot.subCategory} aria-busy={uploading || undefined}>
                            <header className={styles.cardHeader}>
                              <div>
                                <span>운행 구간</span>
                                <h4>{slot.label}</h4>
                              </div>
                              <span className={`${styles.statusBadge} ${schedule ? styles.registeredBadge : styles.emptyBadge}`}>
                                {schedule ? "등록됨" : "미등록"}
                              </span>
                            </header>

                            <div
                              className={`${styles.imageFrame} ${dragging ? styles.draggingFrame : ""}`}
                              onDragEnter={(event) => {
                                event.preventDefault();
                                if (!isBusy) setDraggingSlot(slot.subCategory);
                              }}
                              onDragOver={(event) => event.preventDefault()}
                              onDragLeave={(event) => {
                                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                  setDraggingSlot(null);
                                }
                              }}
                              onDrop={(event) => handleDrop(event, slot)}
                            >
                              <ScheduleImage
                                file={pendingFile}
                                imageUrl={schedule?.imageUrl}
                                alt={`${group.label} ${slot.label} 시간표`}
                              />
                              {pendingFile && <span className={styles.previewBadge}>선택한 새 사진</span>}
                              {dragging && <span className={styles.dropOverlay}>이곳에 놓아 주세요</span>}
                            </div>

                            <div className={styles.cardBody}>
                              <div className={styles.scheduleMeta}>
                                <span>마지막 변경</span>
                                <strong>
                                  {schedule
                                    ? <time dateTime={schedule.updatedAt}>{formatDateTime(schedule.updatedAt)}</time>
                                    : "아직 등록되지 않음"}
                                </strong>
                              </div>

                              {pendingFile && (
                                <div className={styles.selectedFile}>
                                  <FileImage size={19} aria-hidden="true" />
                                  <div>
                                    <strong>{pendingFile.name}</strong>
                                    <span>{formatFileSize(pendingFile.size)}</span>
                                  </div>
                                  <button
                                    type="button"
                                    aria-label={`${slot.label} 선택한 사진 취소`}
                                    onClick={() => cancelFile(slot)}
                                    disabled={isBusy}
                                  >
                                    <X size={16} aria-hidden="true" />
                                  </button>
                                </div>
                              )}

                              <div className={styles.cardActions}>
                                <label
                                  className={`${styles.button} ${styles.secondaryButton} ${styles.fileButton}`}
                                  tabIndex={isBusy ? -1 : 0}
                                  onKeyDown={(event) => openFilePicker(event, slot.subCategory)}
                                >
                                  <UploadSimple size={17} aria-hidden="true" />
                                  {pendingFile ? "다른 사진 선택" : schedule ? "시간표 교체" : "시간표 등록"}
                                  <input
                                    ref={(element) => { inputRefs.current[slot.subCategory] = element; }}
                                    type="file"
                                    accept=".jpg,.jpeg,.png,.gif,image/jpeg,image/png,image/gif"
                                    disabled={isBusy}
                                    onClick={(event) => { event.currentTarget.value = ""; }}
                                    onChange={(event) => chooseFile(slot, event.target.files?.[0] ?? null)}
                                  />
                                </label>

                                {pendingFile && (
                                  <button
                                    className={`${styles.button} ${styles.primaryButton}`}
                                    type="button"
                                    onClick={() => void uploadSchedule(slot)}
                                    disabled={isBusy}
                                  >
                                    <CheckCircle size={17} aria-hidden="true" />
                                    {uploading ? "적용하는 중" : "이 사진 적용"}
                                  </button>
                                )}
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  </section>
                );
              })}
            </div>
          </>
        )}
      </div>

      <ConfirmDialog
        open={refreshConfirmOpen}
        title="선택한 사진을 취소하고 새로고침할까요?"
        description="계속하면 아직 적용하지 않은 사진 선택이 모두 사라집니다."
        confirmLabel="사진 선택 취소하고 새로고침"
        danger
        onCancel={() => setRefreshConfirmOpen(false)}
        onConfirm={() => {
          setRefreshConfirmOpen(false);
          clearAllPendingFiles();
          setFeedback(null);
          void loadSchedules();
        }}
      />
    </AdminLoginNotice>
  );
}
