export type MainCategory = "CITY_BUS" | "COMMUTER_BUS" | "SCHOOL_BUS";

export type SubCategory =
  | "TAEAN_TO_AIRFIELD"
  | "AIRFIELD_TO_TAEAN"
  | "HANSEO_TO_SEOSAN"
  | "COMMUTE_TO_SCHOOL"
  | "COMMUTE_FROM_SCHOOL"
  | "NEARBY_TO_SCHOOL"
  | "NEARBY_FROM_SCHOOL"
  | "CAMPUS_SHUTTLE"
  | "SEOSAN_CIRCULAR"
  | "NAEPO_SAPGYO_CIRCULAR";

export type BusSchedule = {
  id: number;
  mainCategory: MainCategory;
  subCategory: SubCategory;
  imageUrl: string;
  updatedAt: string;
};

export type BusScheduleSlot = {
  mainCategory: MainCategory;
  subCategory: SubCategory;
  label: string;
};

export type BusScheduleGroup = {
  mainCategory: MainCategory;
  label: string;
  description: string;
  slots: readonly BusScheduleSlot[];
};

export const BUS_SCHEDULE_GROUPS: readonly BusScheduleGroup[] = [
  {
    mainCategory: "CITY_BUS",
    label: "시내버스",
    description: "태안·비행장·서산을 오가는 시내버스 시간표입니다.",
    slots: [
      { mainCategory: "CITY_BUS", subCategory: "TAEAN_TO_AIRFIELD", label: "태안 → 비행장" },
      { mainCategory: "CITY_BUS", subCategory: "AIRFIELD_TO_TAEAN", label: "비행장 → 태안" },
      { mainCategory: "CITY_BUS", subCategory: "HANSEO_TO_SEOSAN", label: "한서대 → 서산" },
    ],
  },
];

export const BUS_SCHEDULE_SLOTS = BUS_SCHEDULE_GROUPS.flatMap((group) => group.slots);

// API가 기존 통근·셔틀 데이터를 함께 반환해도 목록 전체가 실패하지 않게 한다.
// 관리 화면에서 노출·업로드하는 구간은 BUS_SCHEDULE_GROUPS의 시내버스 3개만 사용한다.
const supportedSchedulePairs: readonly Pick<BusScheduleSlot, "mainCategory" | "subCategory">[] = [
  ...BUS_SCHEDULE_SLOTS,
  { mainCategory: "COMMUTER_BUS", subCategory: "COMMUTE_TO_SCHOOL" },
  { mainCategory: "COMMUTER_BUS", subCategory: "COMMUTE_FROM_SCHOOL" },
  { mainCategory: "SCHOOL_BUS", subCategory: "NEARBY_TO_SCHOOL" },
  { mainCategory: "SCHOOL_BUS", subCategory: "NEARBY_FROM_SCHOOL" },
  { mainCategory: "SCHOOL_BUS", subCategory: "CAMPUS_SHUTTLE" },
  { mainCategory: "SCHOOL_BUS", subCategory: "SEOSAN_CIRCULAR" },
  { mainCategory: "SCHOOL_BUS", subCategory: "NAEPO_SAPGYO_CIRCULAR" },
];

const mainCategories = new Set<MainCategory>(["CITY_BUS", "COMMUTER_BUS", "SCHOOL_BUS"]);
const subCategoryToMain = new Map<SubCategory, MainCategory>(
  supportedSchedulePairs.map((slot) => [slot.subCategory, slot.mainCategory]),
);
const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?$/;
const allowedImageTypes = new Set(["image/jpeg", "image/png", "image/gif"]);
const allowedImageExtension = /\.(?:jpe?g|png|gif)$/i;

function userFacingError(message: string) {
  const error = new Error(message);
  error.name = "UserFacingError";
  return error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isMainCategory(value: unknown): value is MainCategory {
  return typeof value === "string" && mainCategories.has(value as MainCategory);
}

function isSubCategory(value: unknown): value is SubCategory {
  return typeof value === "string" && subCategoryToMain.has(value as SubCategory);
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

export function isValidBusSchedulePair(
  mainCategory: MainCategory,
  subCategory: SubCategory,
) {
  return subCategoryToMain.get(subCategory) === mainCategory;
}

export function busScheduleKey(mainCategory: MainCategory, subCategory: SubCategory) {
  return `${mainCategory}:${subCategory}`;
}

export function parseBusSchedule(value: unknown): BusSchedule {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.id) ||
    Number(value.id) < 1 ||
    !isMainCategory(value.mainCategory) ||
    !isSubCategory(value.subCategory) ||
    !isValidBusSchedulePair(value.mainCategory, value.subCategory) ||
    typeof value.imageUrl !== "string" ||
    !value.imageUrl.trim() ||
    !isLocalDateTime(value.updatedAt)
  ) {
    throw userFacingError("버스 시간표 정보를 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
  }

  return {
    id: Number(value.id),
    mainCategory: value.mainCategory,
    subCategory: value.subCategory,
    imageUrl: value.imageUrl,
    updatedAt: value.updatedAt,
  };
}

export function parseBusSchedules(value: unknown): BusSchedule[] {
  if (!Array.isArray(value)) {
    throw userFacingError("버스 시간표 목록을 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.");
  }
  return value.map(parseBusSchedule);
}

export function validateBusScheduleImage(
  image: Pick<File, "name" | "size" | "type">,
): string | null {
  if (image.size === 0) return "내용이 없는 사진은 등록할 수 없습니다.";
  if (!allowedImageExtension.test(image.name)) {
    return "JPG, JPEG, PNG, GIF 형식의 사진만 선택할 수 있습니다.";
  }
  if (image.type && !allowedImageTypes.has(image.type)) {
    return "JPG, JPEG, PNG, GIF 형식의 사진만 선택할 수 있습니다.";
  }
  return null;
}

export function createBusScheduleUploadBody({
  image,
  mainCategory,
  subCategory,
}: {
  image: File;
  mainCategory: MainCategory;
  subCategory: SubCategory;
}) {
  if (!isValidBusSchedulePair(mainCategory, subCategory)) {
    throw userFacingError("버스 종류와 운행 구간을 다시 확인해 주세요.");
  }
  const imageError = validateBusScheduleImage(image);
  if (imageError) throw userFacingError(imageError);

  const body = new FormData();
  body.append("image", image, image.name);
  body.append("mainCategory", mainCategory);
  body.append("subCategory", subCategory);
  return body;
}
