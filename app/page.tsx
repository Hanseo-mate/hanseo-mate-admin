"use client";

import {
  ArrowClockwise,
  ArrowRight,
  Article,
  CalendarBlank,
  CalendarCheck,
  ImagesSquare,
  Plus,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import Link from "next/link";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AdminLoginNotice } from "./components/AdminLoginNotice";
import { apiFetch, getErrorText } from "./lib/api";
import {
  type AdminNotice,
  type AdminNoticePage,
  parseAdminNoticePage,
} from "./lib/notices";
import styles from "./dashboard.module.css";

type LoadState<T> =
  | { status: "loading" }
  | { status: "ready"; data: T }
  | { status: "error"; message: string };

type CalendarItem = {
  id: number;
  startDate: string;
  endDate: string;
  title: string;
};

type Poster = {
  id: number;
  imageUrl: string;
  linkUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

const RECENT_NOTICE_LIMIT = 5;
const UPCOMING_CALENDAR_LIMIT = 5;
const POSTER_PREVIEW_LIMIT = 4;

const countFormatter = new Intl.NumberFormat("ko-KR");
const dateFormatter = new Intl.DateTimeFormat("ko-KR", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const shortDateFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  day: "numeric",
  weekday: "short",
  timeZone: "UTC",
});
const monthFormatter = new Intl.DateTimeFormat("ko-KR", {
  month: "short",
  timeZone: "UTC",
});
const dayFormatter = new Intl.DateTimeFormat("ko-KR", {
  day: "2-digit",
  timeZone: "UTC",
});

function userFacingDataError(message: string) {
  const error = new Error(message);
  error.name = "UserFacingError";
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDateKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function parseCalendars(value: unknown): CalendarItem[] {
  if (!Array.isArray(value)) {
    throw userFacingDataError("일정 목록을 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !Number.isInteger(entry.id) ||
      Number(entry.id) < 1 ||
      !isDateKey(entry.startDate) ||
      !isDateKey(entry.endDate) ||
      entry.endDate < entry.startDate ||
      typeof entry.title !== "string"
    ) {
      throw userFacingDataError("일정 정보를 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
    }

    return {
      id: Number(entry.id),
      startDate: entry.startDate,
      endDate: entry.endDate,
      title: entry.title,
    };
  }).sort((first, second) => (
    first.startDate.localeCompare(second.startDate) ||
    first.endDate.localeCompare(second.endDate) ||
    first.id - second.id
  ));
}

function parsePosters(value: unknown): Poster[] {
  if (!Array.isArray(value)) {
    throw userFacingDataError("포스터 목록을 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
  }

  return value.map((entry) => {
    if (
      !isRecord(entry) ||
      !Number.isInteger(entry.id) ||
      Number(entry.id) < 1 ||
      typeof entry.imageUrl !== "string" ||
      !Object.prototype.hasOwnProperty.call(entry, "linkUrl") ||
      (entry.linkUrl !== null && typeof entry.linkUrl !== "string") ||
      typeof entry.createdAt !== "string" ||
      typeof entry.updatedAt !== "string"
    ) {
      throw userFacingDataError("포스터 정보를 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
    }

    return {
      id: Number(entry.id),
      imageUrl: entry.imageUrl,
      linkUrl: entry.linkUrl,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
    };
  }).sort((first, second) => first.id - second.id);
}

function getSeoulDateKey() {
  const parts = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Seoul",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateFromKey(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "날짜 정보 없음" : dateFormatter.format(date);
}

function formatCalendarRange(item: CalendarItem) {
  const start = shortDateFormatter.format(dateFromKey(item.startDate));
  if (item.startDate === item.endDate) return start;
  return `${start} - ${shortDateFormatter.format(dateFromKey(item.endDate))}`;
}

function MetricCard({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    <article className={styles.metricCard}>
      <div className={styles.metricHeading}>
        <span className={styles.metricIcon} aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </div>
      {children}
    </article>
  );
}

function MetricLoading({ label }: { label: string }) {
  return (
    <div className={styles.metricLoading} role="status">
      <span className={styles.visuallyHidden}>{label} 정보를 불러오고 있습니다.</span>
      <span className={styles.metricSkeleton} aria-hidden="true" />
      <span className={styles.metricSkeletonShort} aria-hidden="true" />
    </div>
  );
}

function MetricError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className={styles.metricError}>
      <strong>확인할 수 없음</strong>
      <button type="button" onClick={onRetry}>
        <ArrowClockwise size={15} weight="bold" aria-hidden="true" />
        다시 시도
      </button>
    </div>
  );
}

function PanelLoading({ message, rows = 4 }: { message: string; rows?: number }) {
  return (
    <div className={styles.loadingState} role="status" aria-live="polite">
      <span className={styles.visuallyHidden}>{message}</span>
      {Array.from({ length: rows }, (_, index) => (
        <span className={styles.loadingRow} aria-hidden="true" key={index} />
      ))}
    </div>
  );
}

function PanelError({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className={styles.stateMessage} role="alert">
      <WarningCircle size={28} weight="regular" aria-hidden="true" />
      <strong>{title}</strong>
      <p>{message}</p>
      <button className={styles.retryButton} type="button" onClick={onRetry}>
        <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
        다시 시도
      </button>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  href,
  linkLabel,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  href: string;
  linkLabel: string;
}) {
  return (
    <div className={styles.stateMessage} role="status">
      <span className={styles.emptyIcon} aria-hidden="true">{icon}</span>
      <strong>{title}</strong>
      <p>{description}</p>
      <Link className={styles.textLink} href={href}>
        {linkLabel}
        <ArrowRight size={15} weight="bold" aria-hidden="true" />
      </Link>
    </div>
  );
}

function PosterThumbnail({ poster, index }: { poster: Poster; index: number }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const failed = failedUrl === poster.imageUrl;

  return (
    <article className={styles.posterCard}>
      <div className={styles.posterFrame}>
        {failed || !poster.imageUrl ? (
          <div className={styles.brokenImage} role="img" aria-label={`홈 포스터 ${index + 1} 이미지를 불러오지 못했습니다.`}>
            <ImagesSquare size={30} weight="regular" aria-hidden="true" />
            <span>이미지를 불러올 수 없습니다.</span>
          </div>
        ) : (
          // The API supplies arbitrary remote image hosts, so next/image cannot
          // safely enumerate them in a static export configuration.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={poster.imageUrl}
            alt={`한서메이트 홈 포스터 ${index + 1}`}
            onError={() => setFailedUrl(poster.imageUrl)}
          />
        )}
      </div>
      <div className={styles.posterMeta}>
        <strong>홈 포스터 {index + 1}</strong>
        <time dateTime={poster.createdAt}>{formatDate(poster.createdAt)}</time>
      </div>
    </article>
  );
}

function DashboardContent() {
  const [notices, setNotices] = useState<LoadState<AdminNoticePage>>({ status: "loading" });
  const [calendars, setCalendars] = useState<LoadState<CalendarItem[]>>({ status: "loading" });
  const [posters, setPosters] = useState<LoadState<Poster[]>>({ status: "loading" });
  const noticesController = useRef<AbortController | null>(null);
  const calendarsController = useRef<AbortController | null>(null);
  const postersController = useRef<AbortController | null>(null);
  const today = useMemo(() => getSeoulDateKey(), []);

  const loadNotices = useCallback(async () => {
    noticesController.current?.abort();
    const controller = new AbortController();
    noticesController.current = controller;
    setNotices({ status: "loading" });

    try {
      const response = await apiFetch<unknown>("/api/admin/notices?page=0", {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setNotices({ status: "ready", data: parseAdminNoticePage(response) });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setNotices({ status: "error", message: getErrorText(error) });
      }
    } finally {
      if (noticesController.current === controller) noticesController.current = null;
    }
  }, []);

  const loadCalendars = useCallback(async () => {
    calendarsController.current?.abort();
    const controller = new AbortController();
    calendarsController.current = controller;
    setCalendars({ status: "loading" });

    try {
      const response = await apiFetch<unknown>("/api/admin/calendars", {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setCalendars({ status: "ready", data: parseCalendars(response) });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setCalendars({ status: "error", message: getErrorText(error) });
      }
    } finally {
      if (calendarsController.current === controller) calendarsController.current = null;
    }
  }, []);

  const loadPosters = useCallback(async () => {
    postersController.current?.abort();
    const controller = new AbortController();
    postersController.current = controller;
    setPosters({ status: "loading" });

    try {
      const response = await apiFetch<unknown>("/api/admin/home-posters", {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setPosters({ status: "ready", data: parsePosters(response) });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setPosters({ status: "error", message: getErrorText(error) });
      }
    } finally {
      if (postersController.current === controller) postersController.current = null;
    }
  }, []);

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadNotices();
      void loadCalendars();
      void loadPosters();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      noticesController.current?.abort();
      calendarsController.current?.abort();
      postersController.current?.abort();
    };
  }, [loadCalendars, loadNotices, loadPosters]);

  const recentNotices = useMemo(() => {
    if (notices.status !== "ready") return [];
    return [...notices.data.items]
      .sort((first, second) => second.createdAt.localeCompare(first.createdAt))
      .slice(0, RECENT_NOTICE_LIMIT);
  }, [notices]);

  const remainingCalendars = useMemo(() => {
    if (calendars.status !== "ready") return [];
    return calendars.data.filter((item) => item.endDate >= today);
  }, [calendars, today]);

  const upcomingCalendars = useMemo(
    () => remainingCalendars.slice(0, UPCOMING_CALENDAR_LIMIT),
    [remainingCalendars],
  );

  return (
    <div className={styles.dashboard}>
      <header className={styles.pageHeading}>
        <div>
          <h2>운영 대시보드</h2>
          <p>학생회 공지, 학생회 일정과 홈 포스터의 현재 상태를 확인합니다.</p>
        </div>
        <Link className={styles.primaryAction} href="/notices/new">
          <Plus size={17} weight="bold" aria-hidden="true" />
          학생회 공지 등록
        </Link>
      </header>

      <section className={styles.metricsGrid} aria-label="운영 현황 요약">
        <MetricCard icon={<Article size={20} weight="regular" />} label="학생회 공지">
          {notices.status === "loading" && <MetricLoading label="학생회 공지 수" />}
          {notices.status === "error" && <MetricError onRetry={() => void loadNotices()} />}
          {notices.status === "ready" && (
            <>
              <strong className={styles.metricValue}>{countFormatter.format(notices.data.totalElements)}<small>건</small></strong>
              <span className={styles.metricCaption}>등록된 학생회 공지 전체</span>
            </>
          )}
        </MetricCard>

        <MetricCard icon={<CalendarCheck size={20} weight="regular" />} label="남은 일정">
          {calendars.status === "loading" && <MetricLoading label="일정 수" />}
          {calendars.status === "error" && <MetricError onRetry={() => void loadCalendars()} />}
          {calendars.status === "ready" && (
            <>
              <strong className={styles.metricValue}>{countFormatter.format(remainingCalendars.length)}<small>건</small></strong>
              <span className={styles.metricCaption}>오늘 종료되지 않은 일정</span>
            </>
          )}
        </MetricCard>

        <MetricCard icon={<ImagesSquare size={20} weight="regular" />} label="홈 포스터">
          {posters.status === "loading" && <MetricLoading label="포스터 수" />}
          {posters.status === "error" && <MetricError onRetry={() => void loadPosters()} />}
          {posters.status === "ready" && (
            <>
              <strong className={styles.metricValue}>{countFormatter.format(posters.data.length)}<small>장</small></strong>
              <span className={styles.metricCaption}>현재 등록된 포스터</span>
            </>
          )}
        </MetricCard>

        <MetricCard icon={<UploadSimple size={20} weight="regular" />} label="학사 자료 반영">
          <strong className={`${styles.metricValue} ${styles.metricTextValue}`}>파일 업로드</strong>
          <div className={styles.timetableLinks}>
            <Link href="/courses/major">전공 <ArrowRight size={14} weight="bold" aria-hidden="true" /></Link>
            <Link href="/courses/general">교양 <ArrowRight size={14} weight="bold" aria-hidden="true" /></Link>
            <Link href="/courses/equivalent">동일교과목 <ArrowRight size={14} weight="bold" aria-hidden="true" /></Link>
            <Link href="/courses/cross-major">타학과 전공인정 <ArrowRight size={14} weight="bold" aria-hidden="true" /></Link>
          </div>
        </MetricCard>
      </section>

      <div className={styles.primaryGrid}>
        <section className={styles.panel} aria-labelledby="recent-notices-title">
          <div className={styles.panelHeading}>
            <div>
              <h3 id="recent-notices-title">최근 학생회 공지</h3>
              <p>가장 최근에 등록된 학생회 공지를 확인합니다.</p>
            </div>
            <Link className={styles.panelAction} href="/notices/manage">
              학생회 공지 관리
              <ArrowRight size={15} weight="bold" aria-hidden="true" />
            </Link>
          </div>

          {notices.status === "loading" && <PanelLoading message="최근 학생회 공지를 불러오고 있습니다." rows={5} />}
          {notices.status === "error" && (
            <PanelError
              title="학생회 공지를 불러오지 못했습니다."
              message={notices.message}
              onRetry={() => void loadNotices()}
            />
          )}
          {notices.status === "ready" && recentNotices.length === 0 && (
            <EmptyState
              icon={<Article size={28} weight="regular" />}
              title="등록된 학생회 공지가 없습니다."
              description="첫 학생회 공지를 등록하면 이곳에서 바로 확인할 수 있습니다."
              href="/notices/new"
              linkLabel="학생회 공지 등록"
            />
          )}
          {notices.status === "ready" && recentNotices.length > 0 && (
            <div className={styles.tableScroll}>
              <table className={styles.noticeTable}>
                <thead>
                  <tr>
                    <th scope="col">제목</th>
                    <th scope="col">작성자</th>
                    <th scope="col">파일</th>
                    <th scope="col">등록일</th>
                  </tr>
                </thead>
                <tbody>
                  {recentNotices.map((notice: AdminNotice) => {
                    const fileCount = notice.images.length + notice.attachments.length;
                    return (
                      <tr key={notice.id}>
                        <td>
                          <Link href={`/notices/manage?id=${notice.id}`}>{notice.title}</Link>
                        </td>
                        <td>{notice.author}</td>
                        <td>{fileCount > 0 ? `${countFormatter.format(fileCount)}개` : "없음"}</td>
                        <td><time dateTime={notice.createdAt}>{formatDate(notice.createdAt)}</time></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.panel} aria-labelledby="upcoming-calendars-title">
          <div className={styles.panelHeading}>
            <div>
              <h3 id="upcoming-calendars-title">다가오는 일정</h3>
              <p>오늘 이후 진행되는 학생회 일정입니다.</p>
            </div>
            <Link className={styles.panelAction} href="/calendars/manage">
              일정 관리
              <ArrowRight size={15} weight="bold" aria-hidden="true" />
            </Link>
          </div>

          {calendars.status === "loading" && <PanelLoading message="다가오는 일정을 불러오고 있습니다." rows={5} />}
          {calendars.status === "error" && (
            <PanelError
              title="일정을 불러오지 못했습니다."
              message={calendars.message}
              onRetry={() => void loadCalendars()}
            />
          )}
          {calendars.status === "ready" && upcomingCalendars.length === 0 && (
            <EmptyState
              icon={<CalendarBlank size={28} weight="regular" />}
              title="예정된 일정이 없습니다."
              description="일정 관리에서 새 학생회 일정을 등록할 수 있습니다."
              href="/calendars/manage"
              linkLabel="일정 등록"
            />
          )}
          {calendars.status === "ready" && upcomingCalendars.length > 0 && (
            <div className={styles.calendarList}>
              {upcomingCalendars.map((item) => {
                const ongoing = item.startDate <= today && item.endDate >= today;
                const start = dateFromKey(item.startDate);
                return (
                  <article className={styles.calendarItem} key={item.id}>
                    <div className={styles.calendarDate} aria-hidden="true">
                      <span>{monthFormatter.format(start)}</span>
                      <strong>{dayFormatter.format(start)}</strong>
                    </div>
                    <div className={styles.calendarCopy}>
                      <div>
                        <strong>{item.title}</strong>
                        <span className={ongoing ? styles.ongoing : styles.scheduled}>
                          {ongoing ? "진행 중" : "예정"}
                        </span>
                      </div>
                      <time dateTime={item.startDate}>{formatCalendarRange(item)}</time>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <section className={`${styles.panel} ${styles.posterPanel}`} aria-labelledby="posters-title">
        <div className={styles.panelHeading}>
          <div>
            <h3 id="posters-title">홈 포스터</h3>
            <p>한서메이트 홈 화면에 등록된 포스터를 미리 봅니다.</p>
          </div>
          <Link className={styles.panelAction} href="/posters/manage">
            포스터 관리
            <ArrowRight size={15} weight="bold" aria-hidden="true" />
          </Link>
        </div>

        {posters.status === "loading" && (
          <div className={styles.posterSkeletonGrid} role="status">
            <span className={styles.visuallyHidden}>홈 포스터를 불러오고 있습니다.</span>
            {Array.from({ length: POSTER_PREVIEW_LIMIT }, (_, index) => (
              <span className={styles.posterSkeleton} aria-hidden="true" key={index} />
            ))}
          </div>
        )}
        {posters.status === "error" && (
          <PanelError
            title="포스터를 불러오지 못했습니다."
            message={posters.message}
            onRetry={() => void loadPosters()}
          />
        )}
        {posters.status === "ready" && posters.data.length === 0 && (
          <EmptyState
            icon={<ImagesSquare size={28} weight="regular" />}
            title="등록된 포스터가 없습니다."
            description="포스터 관리에서 홈 화면에 사용할 이미지를 등록해 주세요."
            href="/posters/manage"
            linkLabel="포스터 등록"
          />
        )}
        {posters.status === "ready" && posters.data.length > 0 && (
          <>
            <div className={styles.posterSummary}>
              <span>전체 {countFormatter.format(posters.data.length)}장</span>
              {posters.data.length > POSTER_PREVIEW_LIMIT && (
                <span>앞의 {POSTER_PREVIEW_LIMIT}장을 표시합니다.</span>
              )}
            </div>
            <div className={styles.posterGrid}>
              {posters.data.slice(0, POSTER_PREVIEW_LIMIT).map((poster, index) => (
                <PosterThumbnail poster={poster} index={index} key={poster.id} />
              ))}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

export default function DashboardPage() {
  return (
    <AdminLoginNotice returnTo="/">
      <DashboardContent />
    </AdminLoginNotice>
  );
}
