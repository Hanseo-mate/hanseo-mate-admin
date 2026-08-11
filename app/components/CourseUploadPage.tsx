"use client";

import Link from "next/link";
import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  ApiError,
  apiFetch,
  assertBrowserApiAccess,
} from "../lib/api";
import { AdminLoginNotice } from "./AdminLoginNotice";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const UPLOAD_TIMEOUT_MS = 150_000;
const ALLOWED_EXTENSIONS = [".xlsx", ".xlsm"] as const;

type CourseKind = "major" | "general";
type ResultKind = "stored" | "duplicate" | "review" | "attention";

type UploadReviewIssue = {
  severity: "WARNING" | "ERROR" | string;
  code: string;
  message: string;
  sheetName: string | null;
  rowNumber: number | null;
  field: string | null;
  rawValue: string | null;
};

type UploadResponse = {
  importId: string;
  storageStatus: "STORED" | "DUPLICATE" | "REVIEW_REQUIRED" | string;
  databaseChanged: boolean;
  offeringCount: number;
  message: string;
  reviewIssues: UploadReviewIssue[];
};

type UploadErrorState = {
  title: string;
  message: string;
};

type CourseUploadPageProps = {
  kind: CourseKind;
};

const courseConfig = {
  major: {
    label: "전공",
    endpoint: "/api/v1/timetables/major",
    eyebrow: "전공 시간표",
    description: "학과·전공, 학년, 분반, 담당 교수와 강의시간을 한 번에 확인해 등록합니다.",
    fileHint: "전공 강의시간표 엑셀 파일",
  },
  general: {
    label: "교양",
    endpoint: "/api/v1/timetables/general-education",
    eyebrow: "교양 시간표",
    description: "교양 영역과 세부 분류, 운영기관, 강의시간을 학기별로 확인해 등록합니다.",
    fileHint: "교양 강의시간표 엑셀 파일",
  },
} as const;

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
  if (resultKind === "duplicate") return "이미 반영된 파일";
  if (resultKind === "review") return "검토 필요";
  return "다시 확인 필요";
}

const reviewFieldLabels: Record<string, string> = {
  academicYear: "학년도",
  semester: "학기",
  courseCode: "학수번호",
  courseName: "과목명",
  subjectCode: "학수번호",
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
};

function formatReviewField(field: string | null) {
  const normalized = field?.trim();
  if (!normalized) return "파일 내용";
  if (reviewFieldLabels[normalized]) return reviewFieldLabels[normalized];
  return /[가-힣]/.test(normalized) ? normalized : "파일 내용";
}

function classifyResult(result: UploadResponse): ResultKind {
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

function normalizeUploadError(error: unknown, timedOut: boolean): UploadErrorState {
  if (timedOut) {
    return {
      title: "파일 처리 시간이 초과되었습니다.",
      message: "150초 안에 처리를 완료하지 못했습니다. 잠시 후 다시 시도해 주세요.",
    };
  }

  if (error instanceof ApiError) {
    return {
      title: "파일을 처리하지 못했습니다.",
      message: error.message,
    };
  }

  return {
    title: "파일을 처리하지 못했습니다.",
    message: "일시적인 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.",
  };
}

function ResultSummary({
  result,
  kind,
  selectedFileName,
  onReset,
  onRetry,
}: {
  result: UploadResponse;
  kind: CourseKind;
  selectedFileName: string;
  onReset: () => void;
  onRetry: () => void;
}) {
  const config = courseConfig[kind];
  const resultKind = classifyResult(result);
  const issues = Array.isArray(result.reviewIssues) ? result.reviewIssues : [];
  const resultCopy = {
    stored: {
      symbol: "✓",
      eyebrow: "저장 완료",
      title: `${config.label} 시간표를 저장했습니다.`,
      description: `${formatNumber(result.offeringCount)}개 개설 강좌가 반영되었습니다.`,
    },
    duplicate: {
      symbol: "=",
      eyebrow: "이미 반영된 파일",
      title: "이 파일은 이미 시간표에 반영되어 있습니다.",
      description: "중복으로 저장하지 않았습니다. 다른 파일을 선택해 주세요.",
    },
    review: {
      symbol: "!",
      eyebrow: "검토 필요",
      title: "엑셀 파일에서 확인이 필요한 항목이 있습니다.",
      description: "아래 내용을 고친 뒤 수정한 파일을 다시 올려 주세요.",
    },
    attention: {
      symbol: "?",
      eyebrow: "다시 확인 필요",
      title: "파일 처리를 완료하지 못했습니다.",
      description: "아래 내용을 확인한 뒤 같은 파일로 다시 시도해 주세요.",
    },
  }[resultKind];

  return (
    <div className="course-result-stack">
      <section
        className={`panel course-result-hero result-${resultKind}`}
        aria-labelledby="course-result-title"
        role="status"
        aria-live="polite"
      >
        <div className="result-symbol" aria-hidden="true">{resultCopy.symbol}</div>
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
            <div><dt>시간표 구분</dt><dd>{config.label}</dd></div>
            <div><dt>처리 결과</dt><dd>{formatProcessingResult(resultKind)}</dd></div>
            <div><dt>반영된 강좌</dt><dd>{formatNumber(result.offeringCount)}개</dd></div>
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
            <span aria-hidden="true">i</span>
            <div>
              <strong>{formatProcessingResult(resultKind)}</strong>
              <p>{resultCopy.description}</p>
            </div>
          </div>
        </section>
      </div>

      {(issues.length > 0 || resultKind === "review") && (
        <section className="panel course-issues-panel" aria-labelledby="issues-title">
          <div className="panel-heading panel-heading-border issues-heading">
            <div>
              <span className="eyebrow dark">검토 필요</span>
              <h2 id="issues-title">확인할 내용</h2>
              <p>표에 적힌 시트와 행을 찾아 내용을 확인해 주세요.</p>
            </div>
            <span className="issue-count">{formatNumber(issues.length)}건</span>
          </div>

          {issues.length === 0 ? (
            <div className="empty-issues" role="status">
              <span aria-hidden="true">i</span>
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
                    <th scope="col">파일 위치</th>
                    <th scope="col">확인 항목</th>
                    <th scope="col">문제 내용</th>
                    <th scope="col">원본 값</th>
                  </tr>
                </thead>
                <tbody>
                  {issues.map((issue, index) => {
                    const severity = issue.severity === "ERROR" ? "error" : "warning";
                    return (
                      <tr key={`${issue.sheetName}-${issue.rowNumber}-${index}`}>
                        <td>
                          <span className={`issue-severity issue-${severity}`}>
                            {issue.severity === "ERROR" ? "수정 필요" : "확인 권장"}
                          </span>
                        </td>
                        <td>
                          <strong>{issue.sheetName || "시트 정보 없음"}</strong>
                          <span>
                            {typeof issue.rowNumber === "number"
                              ? `${issue.rowNumber}행`
                              : "행 정보 없음"}
                          </span>
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
  const [result, setResult] = useState<UploadResponse | null>(null);

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
      const response = await apiFetch<UploadResponse>(config.endpoint, {
        method: "POST",
        body,
        signal: controller.signal,
      });
      setResult(response);
    } catch (error) {
      setUploadError(normalizeUploadError(error, timedOut));
    } finally {
      window.clearTimeout(timeoutId);
      activeController.current = null;
      setUploading(false);
    }
  }

  return (
    <AdminLoginNotice returnTo={kind === "major" ? "/courses/major" : "/courses/general"}>
      <div className="stack-lg course-upload-page">
      <section className="course-upload-layout">
        <div className="panel course-upload-panel" aria-busy={uploading}>
          <div className="panel-heading panel-heading-border course-upload-heading">
            <div>
              <span className="eyebrow dark">{config.eyebrow}</span>
              <h2>{config.label} 시간표 파일 업로드</h2>
              <p>{config.description}</p>
              <nav className="course-type-switch" aria-label="시간표 유형 선택">
                <Link
                  className={`course-type-switch-link ${kind === "major" ? "is-active" : ""}`}
                  href="/courses/major"
                  aria-current={kind === "major" ? "page" : undefined}
                >
                  전공 시간표
                </Link>
                <Link
                  className={`course-type-switch-link ${kind === "general" ? "is-active" : ""}`}
                  href="/courses/general"
                  aria-current={kind === "general" ? "page" : undefined}
                >
                  교양 시간표
                </Link>
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
              <span>엑셀</span>
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
                <span aria-hidden="true">!</span>
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
                  ×
                </button>
              </div>
            )}
          </div>

          {uploading && (
            <div className="course-upload-progress" role="status" aria-live="polite">
              <div className="upload-spinner" aria-hidden="true" />
              <div>
                <strong>엑셀 파일에서 강의 정보를 확인하고 있습니다.</strong>
                <p>창을 닫지 말아 주세요. 완료까지 최대 2분 30초가 걸릴 수 있습니다.</p>
              </div>
              <div className="indeterminate-track" aria-hidden="true"><span /></div>
            </div>
          )}

          {uploadError && (
            <div className="course-upload-error" role="alert">
              <div className="error-symbol" aria-hidden="true">!</div>
              <div className="error-copy">
                <div className="error-title-line">
                  <strong>{uploadError.title}</strong>
                </div>
                <p>{uploadError.message}</p>
              </div>
              <div className="error-actions">
                <button className="button button-secondary" type="button" onClick={resetUpload}>
                  초기화
                </button>
                <button className="button button-primary" type="button" onClick={uploadFile}>
                  다시 시도
                </button>
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
              {uploading ? "처리 중..." : `${config.label} 시간표 반영하기`}
            </button>
          </div>
        </div>

        <aside className="panel course-upload-guide" aria-labelledby="upload-guide-title">
          <span className="eyebrow dark">업로드 안내</span>
          <h2 id="upload-guide-title">업로드 전 확인</h2>
          <ol className="upload-guide-list">
            <li>
              <span>01</span>
              <div>
                <strong>{config.label} 원본 확인</strong>
                <p>{config.label} 시간표 파일이 맞는지 확인해 주세요. 다른 유형의 파일은 처리할 수 없습니다.</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>학년도·학기 확인</strong>
                <p>파일 안에 서로 다른 학기 정보가 섞이지 않았는지 확인해 주세요.</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>결과까지 기다리기</strong>
                <p>파일 확인과 강의 정보 반영이 한 번에 진행됩니다.</p>
              </div>
            </li>
          </ol>
          <div className="upload-guide-note">
            <span aria-hidden="true">i</span>
            <p>확인 권장 항목은 등록을 막지 않지만, 수정 필요 항목이 하나라도 있으면 전체 내용이 반영되지 않습니다.</p>
          </div>
        </aside>
      </section>

      {result && (
        <ResultSummary
          result={result}
          kind={kind}
          selectedFileName={file?.name || "선택한 엑셀 파일"}
          onReset={resetUpload}
          onRetry={uploadFile}
        />
      )}
      </div>
    </AdminLoginNotice>
  );
}
