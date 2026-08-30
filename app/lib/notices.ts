export const MAX_NOTICE_IMAGE_SIZE = 5 * 1024 * 1024;
export const NOTICE_IMAGE_ACCEPT = ".jpg,.jpeg,.png,.gif,image/jpeg,image/png,image/gif";

const NOTICE_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/gif"]);
const NOTICE_IMAGE_EXTENSION = /\.(?:jpe?g|png|gif)$/i;

export type NoticeImage = {
  id: number;
  fileName: string;
  imageUrl: string;
  contentType: string;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
};

export type NoticeAttachment = {
  id: number;
  fileName: string;
  downloadUrl: string;
  contentType: string;
  fileSize: number;
  createdAt: string;
  updatedAt: string;
};

export type AdminNotice = {
  id: number;
  title: string;
  author: string;
  content: string;
  viewCount: number;
  createdAt: string;
  updatedAt: string;
  images: NoticeImage[];
  attachments: NoticeAttachment[];
};

export type AdminNoticePage = {
  items: AdminNotice[];
  page: number;
  size: number;
  totalPages: number;
  totalElements: number;
  hasNext: boolean;
};

export type NoticeForm = Pick<AdminNotice, "title" | "author" | "content">;

export type NoticeUpdateMultipartRequest = NoticeForm & {
  retainedImageIds: number[];
  retainedAttachmentIds: number[];
};

export const emptyNoticeForm: NoticeForm = {
  title: "",
  author: "",
  content: "",
};

class NoticeDataError extends Error {
  constructor() {
    super("공지 정보를 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
    this.name = "UserFacingError";
  }
}

function invalidNoticeData(): never {
  throw new NoticeDataError();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1) invalidNoticeData();
  return Number(value);
}

function nonNegativeInteger(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 0) invalidNoticeData();
  return Number(value);
}

function requiredString(value: unknown) {
  if (typeof value !== "string") invalidNoticeData();
  return value;
}

function parseNoticeImage(value: unknown): NoticeImage {
  if (!isRecord(value)) invalidNoticeData();
  return {
    id: positiveInteger(value.id),
    fileName: requiredString(value.fileName),
    imageUrl: requiredString(value.imageUrl),
    contentType: requiredString(value.contentType),
    fileSize: nonNegativeInteger(value.fileSize),
    createdAt: requiredString(value.createdAt),
    updatedAt: requiredString(value.updatedAt),
  };
}

function parseNoticeAttachment(value: unknown): NoticeAttachment {
  if (!isRecord(value)) invalidNoticeData();
  return {
    id: positiveInteger(value.id),
    fileName: requiredString(value.fileName),
    downloadUrl: requiredString(value.downloadUrl),
    contentType: requiredString(value.contentType),
    fileSize: nonNegativeInteger(value.fileSize),
    createdAt: requiredString(value.createdAt),
    updatedAt: requiredString(value.updatedAt),
  };
}

function sortedFiles<T extends { id: number }>(
  value: unknown,
  parser: (item: unknown) => T,
) {
  if (!Array.isArray(value)) invalidNoticeData();
  return value.map(parser).sort((first, second) => first.id - second.id);
}

export function parseAdminNotice(value: unknown): AdminNotice {
  if (!isRecord(value)) invalidNoticeData();
  return {
    id: positiveInteger(value.id),
    title: requiredString(value.title),
    author: requiredString(value.author),
    content: requiredString(value.content),
    viewCount: nonNegativeInteger(value.viewCount),
    createdAt: requiredString(value.createdAt),
    updatedAt: requiredString(value.updatedAt),
    images: sortedFiles(value.images, parseNoticeImage),
    attachments: sortedFiles(value.attachments, parseNoticeAttachment),
  };
}

export function parseAdminNoticePage(value: unknown): AdminNoticePage {
  if (!isRecord(value) || !Array.isArray(value.items)) invalidNoticeData();
  return {
    items: value.items.map(parseAdminNotice),
    page: nonNegativeInteger(value.page),
    size: nonNegativeInteger(value.size),
    totalPages: nonNegativeInteger(value.totalPages),
    totalElements: nonNegativeInteger(value.totalElements),
    hasNext: typeof value.hasNext === "boolean" ? value.hasNext : invalidNoticeData(),
  };
}

export function normalizeNoticeForm(form: NoticeForm): NoticeForm {
  return {
    title: form.title.trim(),
    author: form.author.trim(),
    content: form.content,
  };
}

export function getNoticeFormError(form: NoticeForm) {
  const normalized = normalizeNoticeForm(form);
  if (!normalized.title) return "공지 제목을 입력해 주세요.";
  if (normalized.title.length > 500) return "공지 제목은 500자 이하로 입력해 주세요.";
  if (!normalized.author) return "작성자를 입력해 주세요.";
  if (normalized.author.length > 100) return "작성자는 100자 이하로 입력해 주세요.";
  if (!normalized.content.trim()) return "공지 내용을 입력해 주세요.";
  return null;
}

export function validateNoticeImage(file: File) {
  if (!NOTICE_IMAGE_EXTENSION.test(file.name) || !NOTICE_IMAGE_TYPES.has(file.type)) {
    return "JPG, JPEG, PNG, GIF 형식의 이미지만 선택할 수 있습니다.";
  }
  if (file.size === 0) return "내용이 없는 이미지는 등록할 수 없습니다.";
  if (file.name.length > 500) return "이미지 파일 이름은 500자 이하로 바꾼 뒤 다시 선택해 주세요.";
  if (file.size > MAX_NOTICE_IMAGE_SIZE) return "이미지는 한 장당 5MB 이하여야 합니다.";
  return null;
}

export function validateNoticeAttachment(file: File) {
  if (file.size === 0) return "내용이 없는 파일은 첨부할 수 없습니다.";
  if (file.name.length > 500) return "파일 이름은 500자 이하로 바꾼 뒤 다시 선택해 주세요.";
  return null;
}

export function formatNoticeFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function createNoticeMultipartBody(
  request: NoticeForm | NoticeUpdateMultipartRequest,
  images: File[],
  attachments: File[],
) {
  const body = new FormData();
  body.append(
    "request",
    new Blob([JSON.stringify(request)], { type: "application/json" }),
  );
  images.forEach((file) => body.append("images", file, file.name));
  attachments.forEach((file) => body.append("attachments", file, file.name));
  return body;
}
