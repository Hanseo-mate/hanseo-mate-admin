export type CourseUploadKind =
  | "major"
  | "general"
  | "equivalent"
  | "crossMajor";

export type UploadStorageStatus =
  | "STORED"
  | "DUPLICATE"
  | "REVIEW_REQUIRED";

export type CourseUploadIssue = {
  severity: "WARNING" | "ERROR" | string;
  code: string;
  message: string;
  sheetName: string | null;
  rowNumber: number | null;
  field: string | null;
  rawValue: string | null;
};

export type TimetableUploadResponse = {
  importId: string;
  storageStatus: UploadStorageStatus;
  databaseChanged: boolean;
  offeringCount: number;
  message: string;
  reviewIssues: CourseUploadIssue[];
};

export type EquivalentCourseUploadResponse = {
  importId: string;
  storageStatus: UploadStorageStatus;
  databaseChanged: boolean;
  groupCount: number;
  memberCount: number;
  message: string;
  issues: CourseUploadIssue[];
};

export type CrossMajorRecognitionUploadResponse = {
  importId: string;
  storageStatus: UploadStorageStatus;
  databaseChanged: boolean;
  policyYear: number;
  uploadedSemester: number;
  ruleCount: number;
  message: string;
  reviewIssues: CourseUploadIssue[];
};

export type CourseUploadResult =
  | (TimetableUploadResponse & { kind: "major" | "general" })
  | (EquivalentCourseUploadResponse & { kind: "equivalent" })
  | (CrossMajorRecognitionUploadResponse & { kind: "crossMajor" });

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
}

function parseStorageStatus(value: unknown): UploadStorageStatus {
  if (
    value !== "STORED" &&
    value !== "DUPLICATE" &&
    value !== "REVIEW_REQUIRED"
  ) {
    throw new Error("파일 처리 상태를 확인할 수 없습니다.");
  }
  return value;
}

function parseIssue(value: unknown): CourseUploadIssue {
  if (
    !isRecord(value) ||
    typeof value.code !== "string" ||
    typeof value.message !== "string"
  ) {
    throw new Error("확인할 항목을 불러오지 못했습니다.");
  }

  return {
    severity: typeof value.severity === "string" ? value.severity : "WARNING",
    code: value.code,
    message: value.message,
    sheetName: typeof value.sheetName === "string" ? value.sheetName : null,
    rowNumber: isFiniteNumber(value.rowNumber) && Number.isInteger(value.rowNumber) && value.rowNumber >= 1
      ? value.rowNumber
      : null,
    field: typeof value.field === "string" ? value.field : null,
    rawValue: typeof value.rawValue === "string" ? value.rawValue : null,
  };
}

function parseIssues(value: unknown, resultLabel: string) {
  if (!Array.isArray(value)) {
    throw new Error(`${resultLabel} 처리 결과를 확인할 수 없습니다.`);
  }
  return value.map(parseIssue);
}

function parseBase(value: unknown, resultLabel: string) {
  if (
    !isRecord(value) ||
    typeof value.importId !== "string" ||
    typeof value.databaseChanged !== "boolean" ||
    typeof value.message !== "string"
  ) {
    throw new Error(`${resultLabel} 처리 결과를 확인할 수 없습니다.`);
  }

  return {
    value,
    importId: value.importId,
    storageStatus: parseStorageStatus(value.storageStatus),
    databaseChanged: value.databaseChanged,
    message: value.message,
  };
}

export function parseCourseUploadResponse(
  kind: CourseUploadKind,
  response: unknown,
): CourseUploadResult {
  const resultLabel = kind === "equivalent"
    ? "동일교과목"
    : kind === "crossMajor"
      ? "타학과 전공인정"
      : "시간표";
  const base = parseBase(response, resultLabel);

  if (kind === "equivalent") {
    if (
      !isNonNegativeInteger(base.value.groupCount) ||
      !isNonNegativeInteger(base.value.memberCount)
    ) {
      throw new Error("동일교과목 처리 결과를 확인할 수 없습니다.");
    }

    return {
      kind,
      importId: base.importId,
      storageStatus: base.storageStatus,
      databaseChanged: base.databaseChanged,
      groupCount: base.value.groupCount,
      memberCount: base.value.memberCount,
      message: base.message,
      issues: parseIssues(base.value.issues, "동일교과목"),
    };
  }

  if (kind === "crossMajor") {
    if (
      !isFiniteNumber(base.value.policyYear) ||
      !Number.isInteger(base.value.policyYear) ||
      base.value.policyYear < 2000 ||
      base.value.policyYear > 2100 ||
      (base.value.uploadedSemester !== 1 && base.value.uploadedSemester !== 2) ||
      !isNonNegativeInteger(base.value.ruleCount)
    ) {
      throw new Error("타학과 전공인정 처리 결과를 확인할 수 없습니다.");
    }

    return {
      kind,
      importId: base.importId,
      storageStatus: base.storageStatus,
      databaseChanged: base.databaseChanged,
      policyYear: base.value.policyYear,
      uploadedSemester: base.value.uploadedSemester,
      ruleCount: base.value.ruleCount,
      message: base.message,
      reviewIssues: parseIssues(base.value.reviewIssues, "타학과 전공인정"),
    };
  }

  if (!isNonNegativeInteger(base.value.offeringCount)) {
    throw new Error("시간표 처리 결과를 확인할 수 없습니다.");
  }

  return {
    kind,
    importId: base.importId,
    storageStatus: base.storageStatus,
    databaseChanged: base.databaseChanged,
    offeringCount: base.value.offeringCount,
    message: base.message,
    reviewIssues: parseIssues(base.value.reviewIssues, "시간표"),
  };
}

export function getCourseUploadIssues(result: CourseUploadResult) {
  return result.kind === "equivalent" ? result.issues : result.reviewIssues;
}
