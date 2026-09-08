"use client";

import {
  ArrowLeft,
  ArrowRight,
  Check,
  FileXls,
  Info,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import Link from "next/link";
import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  ApiError,
  apiFetch,
  assertBrowserApiAccess,
} from "../lib/api";
import {
  type CourseUploadKind,
  type CourseUploadResult,
  getCourseUploadIssues,
  parseCourseUploadResponse,
} from "../lib/course-uploads";
import { AdminLoginNotice } from "./AdminLoginNotice";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 150_000;
const ALLOWED_EXTENSIONS = [".xlsx", ".xlsm"] as const;

type ResultKind = "stored" | "duplicate" | "review" | "attention";

type UploadErrorState = {
  title: string;
  message: string;
  details?: string[];
  accessDenied?: boolean;
};

type CourseUploadPageProps = {
  kind: CourseUploadKind;
};

const courseConfig = {
  major: {
    label: "전공",
    navLabel: "전공 시간표",
    href: "/courses/major",
    endpoint: "/api/v1/timetables/major",
    eyebrow: "전공 시간표",
    heading: "전공 시간표 파일 업로드",
    description: "학과·전공, 학년, 분반, 담당 교수와 강의시간을 한 번에 확인해 등록합니다.",
    fileHint: "전공 강의시간표 엑셀 파일",
    submitLabel: "전공 시간표 반영하기",
    progressTitle: "엑셀 파일에서 강의 정보를 확인하고 있습니다.",
    progressDescription: "파일 확인과 강좌 정보 반영을 순서대로 진행합니다.",
    guideTitle: "전공 원본 확인",
    guideDescription: "전공 시간표 파일이 맞는지 확인해 주세요. 교양 파일은 처리되지 않습니다.",
    periodTitle: "학년도·학기 확인",
    periodDescription: "파일 안에 서로 다른 학기 정보가 섞이지 않았는지 확인해 주세요.",
  },
  general: {
    label: "교양",
    navLabel: "교양 시간표",
    href: "/courses/general",
    endpoint: "/api/v1/timetables/general-education",
    eyebrow: "교양 시간표",
    heading: "교양 시간표 파일 업로드",
    description: "교양 영역과 세부 분류, 운영기관, 강의시간을 학기별로 확인해 등록합니다.",
    fileHint: "교양 강의시간표 엑셀 파일",
    submitLabel: "교양 시간표 반영하기",
    progressTitle: "엑셀 파일에서 강의 정보를 확인하고 있습니다.",
    progressDescription: "파일 확인과 강좌 정보 반영을 순서대로 진행합니다.",
    guideTitle: "교양 원본 확인",
    guideDescription: "교양 시간표 파일이 맞는지 확인해 주세요. 전공 파일은 처리되지 않습니다.",
    periodTitle: "학년도·학기 확인",
    periodDescription: "파일 안에 서로 다른 학기 정보가 섞이지 않았는지 확인해 주세요.",
  },
  equivalent: {
    label: "동일교과목",
    navLabel: "동일교과목",
    href: "/courses/equivalent",
    endpoint: "/api/admin/course-enrichments/equivalent-courses/imports",
    eyebrow: "동일교과목 자료",
    heading: "동일교과목 파일 업로드",
    description: "같은 과목으로 인정되는 과목코드와 그룹을 학기별로 확인해 반영합니다.",
    fileHint: "동일교과목 현황 엑셀 파일",
    submitLabel: "동일교과목 반영하기",
    progressTitle: "엑셀 파일에서 동일교과목 그룹을 확인하고 있습니다.",
    progressDescription: "일련번호와 과목코드를 확인한 뒤 자료를 반영합니다.",
    guideTitle: "일련번호·과목코드 확인",
    guideDescription: "A열 일련번호, C열 7자리 과목코드, D열 과목명이 있는 파일인지 확인해 주세요.",
    periodTitle: "학년도·학기 표기 확인",
    periodDescription: "파일명, 시트명 또는 파일 안에 학년도와 학기가 적혀 있어야 합니다.",
  },
  crossMajor: {
    label: "타학과 전공인정",
    navLabel: "타학과 전공인정",
    href: "/courses/cross-major",
    endpoint: "/api/admin/course-enrichments/cross-major-recognitions/imports",
    eyebrow: "전공인정 자료",
    heading: "타학과 전공인정 파일 업로드",
    description: "다른 학과에서 수강해도 전공으로 인정되는 교과목 규칙을 연도별로 반영합니다.",
    fileHint: "타학과 전공인정 교과목 목록 엑셀 파일",
    submitLabel: "전공인정 자료 반영하기",
    progressTitle: "엑셀 파일에서 전공인정 규칙을 확인하고 있습니다.",
    progressDescription: "필수 항목과 적용연도를 확인한 뒤 자료를 반영합니다.",
    guideTitle: "필수 항목 확인",
    guideDescription: "학생 소속, 개설 소속, 과목코드, 과목명, 적용년도와 학기가 모두 있는지 확인해 주세요.",
    periodTitle: "정책연도·학기 표기 확인",
    periodDescription: "파일명, 문서 제목 또는 시트명에 정책연도와 업로드 학기가 적혀 있어야 합니다.",
  },
} as const satisfies Record<CourseUploadKind, {
  label: string;
  navLabel: string;
  href: string;
  endpoint: string;
  eyebrow: string;
  heading: string;
  description: string;
  fileHint: string;
  submitLabel: string;
  progressTitle: string;
  progressDescription: string;
  guideTitle: string;
  guideDescription: string;
  periodTitle: string;
  periodDescription: string;
}>;

const courseKinds: CourseUploadKind[] = [
  "major",
  "general",
  "equivalent",
  "crossMajor",
];

function validateFile(file: File): string | null {
  const lowerName = file.name.toLowerCase();
  const extensionAllowed = ALLOWED_EXTENSIONS.some((extension) =>
    lowerName.endsWith(extension),
  );

  if (!extensionAllowed) {
    return ".xlsx 또는 .xlsm 형식의 엑셀 파일만 업로드할 수 있습니다.";
  }
  if (file.size === 0) {
    return "내용이 없는 파일은 업로드할 수 없습니다.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return "파일 크기는 10MB를 초과할 수 없습니다.";
  }
  return null;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function formatNumber(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toLocaleString("ko-KR")
    : "-";
}

function formatProcessingResult(resultKind: ResultKind) {
  if (resultKind === "stored") return "저장 완료";
  if (resultKind === "duplicate") return "이미 반영됨";
  if (resultKind === "review") return "검토 필요";
  return "다시 확인 필요";
}

const reviewFieldLabels: Record<string, string> = {
  academicYear: "학년도",
  semester: "학기",
  courseCode: "과목코드",
  courseName: "과목명",
  subjectCode: "과목코드",
  subjectName: "과목명",
  department: "학과",
  grade: "학년",
  division: "분반",
  professor: "담당 교수",
  instructor: "담당 교수",
  credit: "학점",
  classroom: "강의실",
  scheduleText: "강의 시간",
  classTime: "강의 시간",
  period: "교시",
  category: "교양 영역",
  sourceSerial: "일련번호",
  studentDepartment: "학생 학과",
  studentMajor: "학생 전공",
  openedDepartment: "개설 학과",
  openedMajor: "개설 전공",
  policyYear: "적용년도",
  uploadedSemester: "적용학기",
};

function formatReviewField(field: string | null) {
  const normalized = field?.trim();
  if (!normalized) return "파일 내용";
  if (reviewFieldLabels[normalized]) return reviewFieldLabels[normalized];
  return /[가-힣]/.test(normalized) ? normalized : "파일 내용";
}

function classifyResult(result: CourseUploadResult): ResultKind {
  if (result.storageStatus === "DUPLICATE" && result.databaseChanged === false) {
    return "duplicate";
  }

  if (
    result.storageStatus === "REVIEW_REQUIRED" &&
    result.databaseChanged === false
  ) {
    return "review";
  }

  if (
    result.storageStatus === "STORED" &&
    result.databaseChanged === true
  ) {
    return "stored";
  }

  return "attention";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function getErrorPayload(payload: unknown) {
  if (!isRecord(payload)) return {};
  const details = Array.isArray(payload.details)
    ? payload.details.filter((item): item is string => typeof item === "string")
    : typeof payload.details === "string"
      ? [payload.details]
      : [];
  return {
    message: typeof payload.message === "string" ? payload.message : undefined,
    details,
  };
}

function normalizeUploadError(error: unknown, timedOut: boolean): UploadErrorState {
  if (timedOut) {
    return {
      title: "파일 처리 시간이 초과되었습니다.",
      message: "150초 안에 처리를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  if (error instanceof ApiError) {
    const payload = getErrorPayload(error.payload);
    return {
      title: error.status === 403
        ? "관리자 권한이 필요합니다."
        : error.status === 422
          ? "파일 내용을 판별하지 못했습니다."
          : "파일을 처리하지 못했습니다.",
      message: payload.message || error.message,
      details: error.status === 422 ? payload.details : undefined,
      accessDenied: error.status === 403,
    };
  }

  return {
    title: "파일을 처리하지 못했습니다.",
    message: "일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  };
}

function getResultMetrics(result: CourseUploadResult) {
  if (result.kind === "equivalent") {
    return [
      { label: "동일교과목 그룹", value: `${formatNumber(result.groupCount)}개` },
      { label: "전체 과목", value: `${formatNumber(result.memberCount)}개` },
    ];
  }

  if (result.kind === "crossMajor") {
    return [
      { label: "정책연도", value: `${formatNumber(result.policyYear)}학년도` },
      { label: "업로드 학기", value: `${formatNumber(result.uploadedSemester)}학기` },
      { label: "반영된 규칙", value: `${formatNumber(result.ruleCount)}개` },
    ];
  }

  return [
    { label: "반영된 강좌", value: `${formatNumber(result.offeringCount)}개` },
  ];
}

function getResultCopy(result: CourseUploadResult, resultKind: ResultKind) {
  if (resultKind === "stored") {
    if (result.kind === "equivalent") {
      return {
        eyebrow: "저장 완료",
        title: "동일교과목을 저장했습니다.",
        description: `${formatNumber(result.groupCount)}개 그룹, ${formatNumber(result.memberCount)}개 과목이 반영되었습니다.`,
      };
    }
    if (result.kind === "crossMajor") {
      return {
        eyebrow: "저장 완료",
        title: `${formatNumber(result.policyYear)}학년도 타학과 전공인정 자료를 저장했습니다.`,
        description: `${formatNumber(result.ruleCount)}개 규칙이 반영되었습니다.`,
      };
    }
    return {
      eyebrow: "저장 완료",
      title: `${courseConfig[result.kind].label} 시간표를 저장했습니다.`,
      description: `${formatNumber(result.offeringCount)}개 개설 강좌가 반영되었습니다.`,
    };
  }

  if (resultKind === "duplicate") {
    return {
      eyebrow: "이미 반영됨",
      title: result.kind === "equivalent"
        ? "이미 같은 동일교과목 자료가 반영되어 있습니다."
        : result.kind === "crossMajor"
          ? "이미 같은 연도의 전공인정 자료가 반영되어 있습니다."
          : "이 파일은 이미 시간표에 반영되어 있습니다.",
      description: "자료를 다시 저장하지 않았습니다. 다른 파일을 선택해 주세요.",
    };
  }

  if (resultKind === "review") {
    return {
      eyebrow: "검토 필요",
      title: "엑셀 파일에서 확인이 필요한 항목이 있습니다.",
      description: "기존 자료는 그대로 유지되었습니다. 아래 내용을 고친 뒤 다시 올려 주세요.",
    };
  }

  return {
    eyebrow: "다시 확인 필요",
    title: "파일 처리를 완료하지 못했습니다.",
    description: "아래 내용을 확인한 뒤 같은 파일로 다시 시도해 주세요.",
  };
}

function ResultSummary({
  result,
  selectedFileName,
  onReset,
  onRetry,
}: {
  result: CourseUploadResult;
  selectedFileName: string;
  onReset: () => void;
  onRetry: () => void;
}) {
  const config = courseConfig[result.kind];
  const resultKind = classifyResult(result);
  const issues = getCourseUploadIssues(result);
  const metrics = getResultMetrics(result);
  const [issuePage, setIssuePage] = useState(0);
  const issuePageSize = 25;
  const issuePageCount = Math.ceil(issues.length / issuePageSize);
  const visibleIssues = useMemo(
    () => issues.slice(issuePage * issuePageSize, (issuePage + 1) * issuePageSize),
    [issuePage, issues],
  );
  const resultCopy = getResultCopy(result, resultKind);

  return (
    <div className="course-result-stack">
      <section
        className={`panel course-result-hero result-${resultKind}`}
        aria-labelledby="course-result-title"
        role="status"
        aria-live="polite"
      >
        <div className="result-symbol" aria-hidden="true">
          {resultKind === "stored" ? <Check size={24} weight="bold" /> : <WarningCircle size={24} />}
        </div>
        <div className="result-copy">
          <span className="eyebrow dark">{resultCopy.eyebrow}</span>
          <h2 id="course-result-title">{resultCopy.title}</h2>
          <p>{resultCopy.description}</p>
        </div>
        <div className="result-actions">
          {resultKind === "attention" && (
            <button className="button button-secondary" type="button" onClick={onRetry}>
              같은 파일 재시도
            </button>
          )}
          <button className="button button-primary" type="button" onClick={onReset}>
            {resultKind === "review" ? "수정한 파일 선택" : "다른 파일 업로드"}
          </button>
        </div>
      </section>

      <div className="course-result-columns">
        <section className="panel course-meta-panel" aria-labelledby="import-info-title">
          <div className="panel-heading panel-heading-border">
            <div>
              <span className="eyebrow dark">파일 결과</span>
              <h2 id="import-info-title">처리 결과</h2>
            </div>
            <span className={`status-badge status-${resultKind}`}>{formatProcessingResult(resultKind)}</span>
          </div>
          <dl className="course-meta-list">
            <div><dt>선택한 파일</dt><dd>{selectedFileName}</dd></div>
            <div><dt>자료 구분</dt><dd>{config.navLabel}</dd></div>
            <div><dt>처리 결과</dt><dd>{formatProcessingResult(resultKind)}</dd></div>
            {metrics.map((metric) => (
              <div key={metric.label}><dt>{metric.label}</dt><dd>{metric.value}</dd></div>
            ))}
          </dl>
        </section>

        <section className="panel course-statistics-panel" aria-labelledby="result-message-title">
          <div className="panel-heading panel-heading-border">
            <div>
              <span className="eyebrow dark">다음 단계</span>
              <h2 id="result-message-title">처리 안내</h2>
            </div>
          </div>
          <div className="empty-issues" role="status">
            <span aria-hidden="true"><Info size={18} /></span>
            <div>
              <strong>{formatProcessingResult(resultKind)}</strong>
              <p>{result.message || resultCopy.description}</p>
            </div>
          </div>
        </section>
      </div>

      {(issues.length > 0 || resultKind === "review") && (
        <section className="panel course-issues-panel" aria-labelledby="issues-title">
          <div className="panel-heading panel-heading-border issues-heading">
            <div>
              <span className="eyebrow dark">
                {resultKind === "review" ? "수정 필요" : "확인 권장"}
              </span>
              <h2 id="issues-title">확인할 내용</h2>
              <p>
                {resultKind === "review"
                  ? "표에 적힌 시트와 행을 수정한 뒤 파일을 다시 올려 주세요."
                  : resultKind === "stored"
                    ? "자료는 반영되었습니다. 표에 적힌 내용을 함께 확인해 주세요."
                    : "이미 반영된 자료입니다. 표에 적힌 내용을 함께 확인해 주세요."}
              </p>
            </div>
            <span className="issue-count">{formatNumber(issues.length)}건</span>
          </div>

          {issues.length === 0 ? (
            <div className="empty-issues" role="status">
              <span aria-hidden="true"><Info size={18} /></span>
              <div>
                <strong>확인할 위치가 표시되지 않았습니다.</strong>
                <p>안내 내용을 확인한 뒤 파일을 다시 올려 주세요.</p>
              </div>
            </div>
          ) : (
            <div className="issues-table-wrap">
              <table className="issues-table">
                <caption className="sr-only">엑셀 파일 검토 항목</caption>
                <thead>
                  <tr>
                    <th scope="col">구분</th>
                    <th scope="col">확인 위치</th>
                    <th scope="col">확인 항목</th>
                    <th scope="col">안내</th>
                    <th scope="col">입력된 값</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleIssues.map((issue, index) => {
                    const severity = issue.severity === "ERROR" ? "error" : "warning";
                    return (
                      <tr key={`${issue.code}-${issue.sheetName}-${issue.rowNumber}-${issuePage * issuePageSize + index}`}>
                        <td>
                          <span className={`issue-severity issue-${severity}`}>
                            {issue.severity === "ERROR" ? "수정 필요" : "확인 권장"}
                          </span>
                        </td>
                        <td>
                          <strong>{issue.sheetName || "시트 정보 없음"}</strong>
                          {typeof issue.rowNumber === "number" && <span> · {issue.rowNumber}행</span>}
                        </td>
                        <td><span>{formatReviewField(issue.field)}</span></td>
                        <td><span>{issue.message || "이 항목을 확인해 주세요."}</span></td>
                        <td><span className="raw-value">{issue.rawValue || "-"}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {issuePageCount > 1 && (
            <nav className="issues-pagination" aria-label="검토 항목 페이지">
              <span>전체 {formatNumber(issues.length)}건 중 {issuePage * issuePageSize + 1}-{Math.min((issuePage + 1) * issuePageSize, issues.length)}건</span>
              <div>
                <button type="button" onClick={() => setIssuePage((page) => Math.max(0, page - 1))} disabled={issuePage === 0}>
                  <ArrowLeft size={15} aria-hidden="true" /> 이전
                </button>
                <strong>{issuePage + 1} / {issuePageCount}</strong>
                <button type="button" onClick={() => setIssuePage((page) => Math.min(issuePageCount - 1, page + 1))} disabled={issuePage + 1 >= issuePageCount}>
                  다음 <ArrowRight size={15} aria-hidden="true" />
                </button>
              </div>
            </nav>
          )}
        </section>
      )}
    </div>
  );
}

export function CourseUploadPage({ kind }: CourseUploadPageProps) {
  const config = courseConfig[kind];
  const inputRef = useRef<HTMLInputElement>(null);
  const activeController = useRef<AbortController | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [validationMessage, setValidationMessage] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<UploadErrorState | null>(null);
  const [result, setResult] = useState<CourseUploadResult | null>(null);

  useEffect(() => {
    return () => activeController.current?.abort();
  }, []);

  function selectFile(nextFile: File) {
    const message = validateFile(nextFile);
    if (message) {
      setFile(null);
      setValidationMessage(message);
      setUploadError(null);
      setResult(null);
      return;
    }

    setFile(nextFile);
    setValidationMessage(null);
    setUploadError(null);
    setResult(null);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0];
    if (nextFile) selectFile(nextFile);
    event.target.value = "";
  }

  function handleDragOver(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    if (uploading) return;
    event.dataTransfer.dropEffect = "copy";
    setDragging(true);
  }

  function handleDragLeave(event: DragEvent<HTMLDivElement>) {
    if (
      event.relatedTarget instanceof Node &&
      event.currentTarget.contains(event.relatedTarget)
    ) {
      return;
    }
    setDragging(false);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (uploading) return;

    if (event.dataTransfer.files.length !== 1) {
      setFile(null);
      setValidationMessage("한 번에 엑셀 파일 하나만 선택해 주세요.");
      setUploadError(null);
      setResult(null);
      return;
    }

    selectFile(event.dataTransfer.files[0]);
  }

  function handleDropZoneKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (uploading || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    inputRef.current?.click();
  }

  function resetUpload() {
    if (uploading) return;
    setFile(null);
    setValidationMessage(null);
    setUploadError(null);
    setResult(null);
    setDragging(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function uploadFile() {
    if (!file || uploading) return;

    const message = validateFile(file);
    if (message) {
      setValidationMessage(message);
      return;
    }

    setUploading(true);
    setUploadError(null);
    setResult(null);
    let timedOut = false;
    const controller = new AbortController();
    activeController.current = controller;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, UPLOAD_TIMEOUT_MS);

    try {
      assertBrowserApiAccess();
      const body = new FormData();
      body.append("file", file, file.name);
      const response = await apiFetch<unknown>(config.endpoint, {
        method: "POST",
        body,
        signal: controller.signal,
      });
      setResult(parseCourseUploadResponse(kind, response));
    } catch (error) {
      setUploadError(normalizeUploadError(error, timedOut));
    } finally {
      window.clearTimeout(timeoutId);
      activeController.current = null;
      setUploading(false);
    }
  }

  return (
    <AdminLoginNotice returnTo={config.href}>
      <div className="stack-lg course-upload-page">
      <section className="course-upload-layout">
        <div className="panel course-upload-panel" aria-busy={uploading}>
          <div className="panel-heading panel-heading-border course-upload-heading">
            <div>
              <span className="eyebrow dark">{config.eyebrow}</span>
              <h2>{config.heading}</h2>
              <p>{config.description}</p>
              <nav className="course-type-switch" aria-label="학사 자료 유형 선택">
                {courseKinds.map((itemKind) => {
                  const item = courseConfig[itemKind];
                  return (
                    <Link
                      className={`course-type-switch-link ${kind === itemKind ? "is-active" : ""}`}
                      href={item.href}
                      aria-current={kind === itemKind ? "page" : undefined}
                      key={itemKind}
                    >
                      {item.navLabel}
                    </Link>
                  );
                })}
              </nav>
            </div>
            <span className="file-limit-badge">최대 10MB</span>
          </div>

          <div
            className={`course-drop-zone ${dragging ? "is-dragging" : ""} ${uploading ? "is-disabled" : ""}`}
            role="button"
            tabIndex={uploading ? -1 : 0}
            aria-disabled={uploading}
            aria-describedby="course-file-rules"
            onClick={() => !uploading && inputRef.current?.click()}
            onKeyDown={handleDropZoneKeyDown}
            onDragEnter={handleDragOver}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              className="course-file-input"
              type="file"
              accept=".xlsx,.xlsm,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel.sheet.macroEnabled.12"
              aria-label={`${config.fileHint} 선택`}
              disabled={uploading}
              onClick={(event) => event.stopPropagation()}
              onChange={handleInputChange}
            />
            <div className="drop-zone-icon" aria-hidden="true">
              <FileXls size={28} weight="regular" />
            </div>
            <div className="drop-zone-copy">
              <strong>{dragging ? "여기에 파일을 놓아 주세요" : "엑셀 파일을 끌어 놓거나 클릭해 선택하세요"}</strong>
              <span>.xlsx 또는 .xlsm 파일 1개</span>
            </div>
            <span className="button button-secondary drop-zone-button" aria-hidden="true">
              파일 선택
            </span>
          </div>

          <p className="course-file-rules" id="course-file-rules">
            지원 형식 <strong>.xlsx, .xlsm</strong>
            <span aria-hidden="true">·</span>
            파일 1개
            <span aria-hidden="true">·</span>
            최대 10MB
          </p>

          <div aria-live="polite" aria-atomic="true">
            {validationMessage && (
              <div className="inline-validation" role="alert">
                <span aria-hidden="true"><WarningCircle size={18} weight="fill" /></span>
                <p>{validationMessage}</p>
              </div>
            )}

            {file && (
              <div className="selected-course-file">
                <span className="selected-file-extension" aria-hidden="true">
                  {file.name.toLowerCase().endsWith(".xlsm") ? "XLSM" : "XLSX"}
                </span>
                <div>
                  <strong>{file.name}</strong>
                  <span>{formatFileSize(file.size)} · 업로드 준비 완료</span>
                </div>
                <button
                  className="selected-file-remove"
                  type="button"
                  aria-label={`${file.name} 선택 해제`}
                  disabled={uploading}
                  onClick={resetUpload}
                >
                  <X size={17} aria-hidden="true" />
                </button>
              </div>
            )}
          </div>

          {uploading && (
            <div className="course-upload-progress" role="status" aria-live="polite">
              <div className="upload-spinner" aria-hidden="true" />
              <div>
                <strong>{config.progressTitle}</strong>
                <p>{config.progressDescription}</p>
              </div>
              <div className="indeterminate-track" aria-hidden="true"><span /></div>
            </div>
          )}

          {uploadError && (
            <div className="course-upload-error" role="alert">
              <div className="error-symbol" aria-hidden="true"><WarningCircle size={19} weight="fill" /></div>
              <div className="error-copy">
                <div className="error-title-line">
                  <strong>{uploadError.title}</strong>
                </div>
                <p>{uploadError.message}</p>
                {(uploadError.details?.length ?? 0) > 0 && (
                  <div className="upload-error-details">
                    {uploadError.details && uploadError.details.length > 0 && (
                      <ul>{uploadError.details.map((detail, index) => <li key={`${detail}-${index}`}>{detail}</li>)}</ul>
                    )}
                  </div>
                )}
              </div>
              <div className="error-actions">
                <button className="button button-secondary" type="button" onClick={resetUpload}>
                  초기화
                </button>
                {!uploadError.accessDenied && (
                  <button className="button button-primary" type="button" onClick={uploadFile}>
                    다시 시도
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="course-upload-actions">
            <button
              className="button button-primary upload-submit-button"
              type="button"
              disabled={!file || uploading}
              onClick={uploadFile}
            >
              {uploading ? "처리 중..." : config.submitLabel}
            </button>
          </div>
        </div>

        <aside className="panel course-upload-guide" aria-labelledby="upload-guide-title">
          <span className="eyebrow dark">업로드 안내</span>
          <h2 id="upload-guide-title">업로드 전 확인</h2>
          <ol className="upload-guide-list">
            <li>
              <FileXls size={20} aria-hidden="true" />
              <div>
                <strong>{config.guideTitle}</strong>
                <p>{config.guideDescription}</p>
              </div>
            </li>
            <li>
              <Info size={20} aria-hidden="true" />
              <div>
                <strong>{config.periodTitle}</strong>
                <p>{config.periodDescription}</p>
              </div>
            </li>
            <li>
              <UploadSimple size={20} aria-hidden="true" />
              <div>
                <strong>결과까지 기다리기</strong>
                <p>파일 확인과 자료 반영이 한 번에 진행됩니다.</p>
              </div>
            </li>
          </ol>
          <div className="upload-guide-note">
            <span aria-hidden="true"><Info size={18} /></span>
            <p>확인 권장 항목은 등록을 막지 않지만, 수정 필요 항목이 하나라도 있으면 전체 내용이 반영되지 않습니다.</p>
          </div>
        </aside>
      </section>

      {result && (
        <ResultSummary
          result={result}
          selectedFileName={file?.name || "선택한 엑셀 파일"}
          onReset={resetUpload}
          onRetry={uploadFile}
        />
      )}
      </div>
    </AdminLoginNotice>
  );
}
