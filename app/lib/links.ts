export const ADMIN_LINKS_ENDPOINT = "/api/admin/links";

export type ManagedLink = {
  id: number;
  name: string;
  url: string;
  createdAt: string;
  updatedAt: string;
};

export type LinkForm = {
  name: string;
  url: string;
};

export type LinkFieldErrors = Partial<Record<keyof LinkForm, string>>;

type ValidationResult =
  | { ok: true; payload: LinkForm }
  | { ok: false; errors: LinkFieldErrors };

const LOCAL_DATE_TIME_PATTERN =
  /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,9})?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isValidLocalDateTime(value: string) {
  if (!LOCAL_DATE_TIME_PATTERN.test(value)) return false;

  const normalized = value.replace(/(\.\d{3})\d+$/, "$1");
  const date = new Date(normalized);
  return !Number.isNaN(date.getTime());
}

export function parseManagedLink(value: unknown): ManagedLink {
  if (!isRecord(value)) {
    throw new Error("링크 응답 형식이 올바르지 않습니다.");
  }

  const { id, name, url, createdAt, updatedAt } = value;

  if (
    typeof id !== "number" ||
    !Number.isSafeInteger(id) ||
    id < 1 ||
    typeof name !== "string" ||
    typeof url !== "string" ||
    typeof createdAt !== "string" ||
    typeof updatedAt !== "string" ||
    !isValidLocalDateTime(createdAt) ||
    !isValidLocalDateTime(updatedAt)
  ) {
    throw new Error("링크 응답 형식이 올바르지 않습니다.");
  }

  return { id, name, url, createdAt, updatedAt };
}

export function parseManagedLinks(value: unknown): ManagedLink[] {
  if (!Array.isArray(value)) {
    throw new Error("링크 목록 응답 형식이 올바르지 않습니다.");
  }

  return value
    .map(parseManagedLink)
    .sort((left, right) => left.id - right.id);
}

export function isValidExternalLinkUrl(value: string) {
  try {
    const parsed = new URL(value.trim());
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      Boolean(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function validateLinkForm(form: LinkForm): ValidationResult {
  const name = form.name.trim();
  const url = form.url.trim();
  const errors: LinkFieldErrors = {};

  if (!name) {
    errors.name = "링크 이름을 입력해 주세요.";
  } else if (form.name.length > 100) {
    errors.name = "링크 이름은 100자 이하로 입력해 주세요.";
  }

  if (!url) {
    errors.url = "이동할 주소를 입력해 주세요.";
  } else if (form.url.length > 2048) {
    errors.url = "주소는 2,048자 이하로 입력해 주세요.";
  } else if (!isValidExternalLinkUrl(url)) {
    errors.url = "http:// 또는 https://로 시작하는 올바른 주소를 입력해 주세요.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return { ok: true, payload: { name, url } };
}

export function formFromManagedLink(link: ManagedLink): LinkForm {
  return {
    name: link.name,
    url: link.url,
  };
}

export function linkFormSignature(form: LinkForm) {
  return JSON.stringify(form);
}
