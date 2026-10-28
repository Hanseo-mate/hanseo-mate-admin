export const HOME_MESSAGE_ENDPOINT = "/api/admin/home-message";
export const HOME_MESSAGE_MAX_LENGTH = 500;

export type HomeMessageSetting = {
  message: string;
};

export function parseHomeMessageSetting(value: unknown): HomeMessageSetting {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).message !== "string"
  ) {
    throw new Error("메인페이지 메시지 응답 형식이 올바르지 않습니다.");
  }

  return { message: (value as Record<string, string>).message };
}

export function validateHomeMessage(value: string) {
  if (value.length > HOME_MESSAGE_MAX_LENGTH) {
    return "메시지는 500자 이하로 입력해 주세요.";
  }
  return "";
}
