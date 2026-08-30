export type SystemNotice = {
  id: number;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type SystemNoticeForm = Pick<SystemNotice, "title" | "content">;

export const emptySystemNoticeForm: SystemNoticeForm = {
  title: "",
  content: "",
};

const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?$/;

function userFacingError(message: string) {
  const error = new Error(message);
  error.name = "UserFacingError";
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isLocalDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(localDateTimePattern);
  if (!match) return false;

  const [, year, month, day, hour, minute, second] = match.map(Number);
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute &&
    date.getUTCSeconds() === second;
}

export function parseSystemNotice(value: unknown): SystemNotice {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.id) ||
    Number(value.id) < 1 ||
    typeof value.title !== "string" ||
    typeof value.content !== "string" ||
    !isLocalDateTime(value.createdAt) ||
    !isLocalDateTime(value.updatedAt)
  ) {
    throw userFacingError("시스템 공지 정보를 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
  }

  return {
    id: Number(value.id),
    title: value.title,
    content: value.content,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

export function sortSystemNotices(items: SystemNotice[]) {
  return [...items].sort((first, second) => (
    second.createdAt.localeCompare(first.createdAt) ||
    second.id - first.id
  ));
}

export function parseSystemNotices(value: unknown): SystemNotice[] {
  if (!Array.isArray(value)) {
    throw userFacingError("시스템 공지 목록을 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
  }
  return sortSystemNotices(value.map(parseSystemNotice));
}

export function formFromSystemNotice(notice: SystemNotice): SystemNoticeForm {
  return {
    title: notice.title,
    content: notice.content,
  };
}

export function validateSystemNoticeForm(form: SystemNoticeForm): {
  payload?: SystemNoticeForm;
  field?: keyof SystemNoticeForm;
  message?: string;
} {
  const title = form.title.trim();

  if (!title) {
    return { field: "title", message: "공지 제목을 입력해 주세요." };
  }
  if (title.length > 500) {
    return { field: "title", message: "공지 제목은 500자 이하로 입력해 주세요." };
  }
  if (!form.content.trim()) {
    return { field: "content", message: "공지 내용을 입력해 주세요." };
  }
  if (form.content.length > 100_000) {
    return { field: "content", message: "공지 내용은 100,000자 이하로 입력해 주세요." };
  }

  return {
    payload: {
      title,
      content: form.content,
    },
  };
}
