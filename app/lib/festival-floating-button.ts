export const FESTIVAL_FLOATING_BUTTON_ENDPOINT =
  "/api/admin/settings/festival-floating-button";

export type FestivalFloatingButtonSetting = {
  visible: boolean;
  updatedAt: string | null;
};

const dateTimePattern =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})?$/;

function userFacingError(message: string) {
  const error = new Error(message);
  error.name = "UserFacingError";
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isDateTime(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = value.match(dateTimePattern);
  if (!match || Number.isNaN(Date.parse(value))) return false;

  const [, year, month, day, hour, minute, second] = match.map(Number);
  const calendar = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  return calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day &&
    calendar.getUTCHours() === hour &&
    calendar.getUTCMinutes() === minute &&
    calendar.getUTCSeconds() === second;
}

export function parseFestivalFloatingButtonSetting(
  value: unknown,
): FestivalFloatingButtonSetting {
  if (
    !isRecord(value) ||
    typeof value.visible !== "boolean" ||
    !(value.updatedAt === null || isDateTime(value.updatedAt))
  ) {
    throw userFacingError(
      "축제 플로팅 버튼 상태를 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.",
    );
  }

  return {
    visible: value.visible,
    updatedAt: value.updatedAt,
  };
}

export function createFestivalFloatingButtonPatchBody(visible: boolean) {
  if (typeof visible !== "boolean") {
    throw userFacingError("변경할 노출 상태를 다시 확인해 주세요.");
  }
  return { visible };
}
