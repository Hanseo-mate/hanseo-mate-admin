import { ApiError, apiFetch, getErrorText } from "./api";

export const campusOptions = [
  { value: "SEOSAN", label: "서산캠퍼스" },
  { value: "TAEAN", label: "태안캠퍼스" },
] as const;

export const categoryOptions = [
  { value: "RESTAURANT", label: "음식점" },
  { value: "CAFE", label: "카페" },
  { value: "LECTURE_BUILDING", label: "교내시설" },
  { value: "CONVENIENCE_FACILITY", label: "편의시설" },
] as const;

export const CAMPUS_OPTIONS = campusOptions;
export const CAMPUS_PLACE_CATEGORY_OPTIONS = categoryOptions;

export const MAX_CAMPUS_PLACE_IMAGE_SIZE = 5 * 1024 * 1024;
export const CAMPUS_MAP_IMAGE_ACCEPT =
  ".jpg,.jpeg,.png,.gif,image/jpeg,image/png,image/gif";

export type CampusCode = (typeof campusOptions)[number]["value"];
export type CampusPlaceCategory = (typeof categoryOptions)[number]["value"];
export type NonLectureCampusPlaceCategory = Exclude<
  CampusPlaceCategory,
  "LECTURE_BUILDING"
>;

export type LectureBuildingDetails = {
  location: string;
  floorCount: number;
  hasElevator: boolean;
  operatingHours: string;
  departments: string[];
  majorFacilities: string[];
};

type CampusMapPlaceBase = {
  placeId: number;
  campusCode: CampusCode;
  placeName: string;
  category: CampusPlaceCategory;
  categoryName: string;
  oneLineDescription: string;
  address?: string;
  imageUrl: string;
  latitude: number;
  longitude: number;
};

export type CampusMapPlaceSummary = CampusMapPlaceBase;

export type CampusMapPlaceDetail =
  | (Omit<CampusMapPlaceBase, "category" | "address"> & {
    category: "LECTURE_BUILDING";
    address?: never;
    lectureBuildingDetails: LectureBuildingDetails | null;
  })
  | (Omit<CampusMapPlaceBase, "category"> & {
    category: NonLectureCampusPlaceCategory;
    lectureBuildingDetails?: never;
  });

type CampusMapPlaceRequestBase = {
  campusCode: CampusCode;
  placeName: string;
  latitude: number;
  longitude: number;
  category: CampusPlaceCategory;
  oneLineDescription: string;
  imageUrl: string;
};

export type CampusMapPlaceRequest =
  | (Omit<CampusMapPlaceRequestBase, "category"> & {
    category: "LECTURE_BUILDING";
    address?: null;
    lectureBuildingDetails: LectureBuildingDetails;
  })
  | (Omit<CampusMapPlaceRequestBase, "category"> & {
    category: NonLectureCampusPlaceCategory;
    address: string;
    lectureBuildingDetails?: never;
  });

export type CampusMapPlaceImageUploadResponse = {
  imageUrl: string;
};

export type CampusMapPlaceFilters = {
  campusCode?: CampusCode;
  category?: CampusPlaceCategory;
};

export type CampusMapPlaceForm = {
  campusCode: CampusCode;
  placeName: string;
  latitude: string;
  longitude: string;
  category: CampusPlaceCategory;
  oneLineDescription: string;
  address: string;
  imageUrl: string;
  location: string;
  floorCount: string;
  hasElevator: boolean;
  operatingHours: string;
  departments: string[];
  majorFacilities: string[];
};

export const initialCampusPlaceForm: CampusMapPlaceForm = {
  campusCode: "SEOSAN",
  placeName: "",
  latitude: "",
  longitude: "",
  category: "RESTAURANT",
  oneLineDescription: "",
  address: "",
  imageUrl: "",
  location: "",
  floorCount: "",
  hasElevator: false,
  operatingHours: "",
  departments: [""],
  majorFacilities: [""],
};

export const emptyCampusMapPlaceForm = initialCampusPlaceForm;

const campusCodes = new Set<string>(campusOptions.map((option) => option.value));
const campusPlaceCategories = new Set<string>(
  categoryOptions.map((option) => option.value),
);
const campusMapImageTypes = new Set(["image/jpeg", "image/png", "image/gif"]);
const decimalCoordinatePattern = /^-?\d+(?:\.\d{1,9})?$/;
const safeCampusMapApiMessages = new Set([
  "강의실 이외의 카테고리는 address가 필요합니다.",
  "강의실 카테고리에는 address를 입력할 수 없습니다.",
  "강의실 카테고리는 lectureBuildingDetails가 필요합니다.",
  "강의실 이외의 카테고리에는 lectureBuildingDetails를 입력할 수 없습니다.",
  "같은 캠퍼스에 같은 이름의 장소가 이미 있습니다.",
]);

function userFacingError(message: string) {
  const error = new Error(message);
  error.name = "UserFacingError";
  return error;
}

function invalidCampusMapData(message = "캠퍼스맵 장소 정보를 확인할 수 없습니다. 잠시 후 다시 불러와 주세요."): never {
  throw userFacingError(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getCampusMapErrorText(error: unknown) {
  if (
    error instanceof ApiError &&
    error.status === 400 &&
    isRecord(error.payload) &&
    typeof error.payload.message === "string" &&
    safeCampusMapApiMessages.has(error.payload.message)
  ) {
    return error.payload.message;
  }
  return getErrorText(error);
}

function isCampusCode(value: unknown): value is CampusCode {
  return typeof value === "string" && campusCodes.has(value);
}

function isCampusPlaceCategory(value: unknown): value is CampusPlaceCategory {
  return typeof value === "string" && campusPlaceCategories.has(value);
}

function requiredResponseString(value: unknown, maxLength = Number.POSITIVE_INFINITY) {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maxLength
  ) {
    invalidCampusMapData();
  }
  return value;
}

function nullableResponseString(
  value: unknown,
  maxLength = Number.POSITIVE_INFINITY,
) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") invalidCampusMapData();

  const normalized = value.trim();
  if (normalized.length > maxLength) invalidCampusMapData();
  return normalized;
}

function optionalResponseString(
  value: unknown,
  maxLength = Number.POSITIVE_INFINITY,
) {
  const normalized = nullableResponseString(value, maxLength);
  return normalized || undefined;
}

function positiveInteger(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    invalidCampusMapData();
  }
  return Number(value);
}

function positiveNumber(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1) {
    invalidCampusMapData();
  }
  return value;
}

function coordinate(value: unknown, minimum: number, maximum: number) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    invalidCampusMapData();
  }
  return value;
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      Boolean(url.hostname)
    );
  } catch {
    return false;
  }
}

export function isValidCampusMapImageUrl(value: string) {
  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 2_048 && isHttpUrl(normalized);
}

function parseStringArray(value: unknown) {
  if (!Array.isArray(value) || value.length > 50) {
    invalidCampusMapData();
  }

  const items = value.map((item) => requiredResponseString(item, 255));
  const normalized = items.map((item) => item.trim());
  if (new Set(normalized).size !== normalized.length) {
    invalidCampusMapData();
  }
  return items;
}

function parseLectureBuildingDetails(value: unknown): LectureBuildingDetails {
  if (
    !isRecord(value) ||
    typeof value.hasElevator !== "boolean"
  ) {
    invalidCampusMapData();
  }

  return {
    location: requiredResponseString(value.location, 255),
    floorCount: positiveNumber(value.floorCount),
    hasElevator: value.hasElevator,
    operatingHours: nullableResponseString(value.operatingHours, 255),
    departments: parseStringArray(value.departments),
    majorFacilities: parseStringArray(value.majorFacilities),
  };
}

function parseCampusMapPlaceBase(value: unknown): CampusMapPlaceBase {
  if (
    !isRecord(value) ||
    !isCampusCode(value.campusCode) ||
    !isCampusPlaceCategory(value.category)
  ) {
    invalidCampusMapData();
  }

  // category is the API contract value. categoryName is presentation text and
  // has changed independently in production (for example, 강의실 -> 교내시설),
  // so a wording change must not make the entire 200 list unusable.
  const categoryName = requiredResponseString(value.categoryName).trim();

  const imageUrl = nullableResponseString(value.imageUrl, 2_048);
  if (imageUrl && !isHttpUrl(imageUrl)) {
    invalidCampusMapData();
  }

  const address = optionalResponseString(value.address, 255);

  return {
    placeId: positiveInteger(value.placeId),
    campusCode: value.campusCode,
    placeName: requiredResponseString(value.placeName, 255),
    category: value.category,
    categoryName,
    oneLineDescription: nullableResponseString(value.oneLineDescription, 255),
    ...(address === undefined ? {} : { address }),
    imageUrl,
    latitude: coordinate(value.latitude, -90, 90),
    longitude: coordinate(value.longitude, -180, 180),
  };
}

export function parseCampusMapPlaceSummary(value: unknown): CampusMapPlaceSummary {
  return parseCampusMapPlaceBase(value);
}

export function parseCampusMapPlaceListResponse(value: unknown): {
  places: CampusMapPlaceSummary[];
} {
  if (!isRecord(value) || !Array.isArray(value.places)) {
    invalidCampusMapData(
      "캠퍼스맵 장소 목록을 확인할 수 없습니다. 잠시 후 다시 불러와 주세요.",
    );
  }
  return { places: value.places.map(parseCampusMapPlaceSummary) };
}

export function parseCampusMapPlaceSummaries(value: unknown) {
  return parseCampusMapPlaceListResponse(value).places;
}

export const parseCampusMapPlaces = parseCampusMapPlaceSummaries;

export function parseCampusMapPlaceDetail(value: unknown): CampusMapPlaceDetail {
  const base = parseCampusMapPlaceBase(value);
  if (!isRecord(value)) {
    invalidCampusMapData();
  }

  if (base.category === "LECTURE_BUILDING") {
    return {
      placeId: base.placeId,
      campusCode: base.campusCode,
      placeName: base.placeName,
      category: base.category,
      categoryName: base.categoryName,
      oneLineDescription: base.oneLineDescription,
      imageUrl: base.imageUrl,
      latitude: base.latitude,
      longitude: base.longitude,
      lectureBuildingDetails: value.lectureBuildingDetails === null
        ? null
        : parseLectureBuildingDetails(value.lectureBuildingDetails),
    };
  }

  if (
    value.lectureBuildingDetails !== undefined &&
    value.lectureBuildingDetails !== null
  ) {
    invalidCampusMapData();
  }

  return {
    ...base,
    category: base.category,
  };
}

export function parseCampusMapPlaceImageUploadResponse(
  value: unknown,
): CampusMapPlaceImageUploadResponse {
  if (!isRecord(value) || typeof value.imageUrl !== "string") {
    invalidCampusMapData(
      "업로드한 장소 이미지 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
  const imageUrl = value.imageUrl.trim();
  if (!isValidCampusMapImageUrl(imageUrl)) {
    invalidCampusMapData(
      "업로드한 장소 이미지 정보를 확인할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    );
  }
  return { imageUrl };
}

export function campusMapPlaceDetailToForm(
  place: CampusMapPlaceDetail,
): CampusMapPlaceForm {
  const lectureBuildingDetails = place.category === "LECTURE_BUILDING"
    ? place.lectureBuildingDetails
    : null;

  return {
    campusCode: place.campusCode,
    placeName: place.placeName,
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    category: place.category,
    oneLineDescription: place.oneLineDescription,
    address: place.address ?? "",
    imageUrl: place.imageUrl,
    location: lectureBuildingDetails?.location ?? "",
    floorCount: lectureBuildingDetails
      ? String(lectureBuildingDetails.floorCount)
      : "",
    hasElevator: lectureBuildingDetails?.hasElevator ?? false,
    operatingHours: lectureBuildingDetails?.operatingHours ?? "",
    departments: lectureBuildingDetails?.departments.length
      ? [...lectureBuildingDetails.departments]
      : [""],
    majorFacilities: lectureBuildingDetails?.majorFacilities.length
      ? [...lectureBuildingDetails.majorFacilities]
      : [""],
  };
}

function coordinateFormError(
  value: string,
  label: string,
  minimum: number,
  maximum: number,
) {
  const normalized = value.trim();
  if (!normalized) return `${label}를 입력해 주세요.`;
  if (!decimalCoordinatePattern.test(normalized)) {
    return `${label}는 소수점 이하 9자리 이내의 숫자로 입력해 주세요.`;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    return `${label}는 ${minimum} 이상 ${maximum} 이하로 입력해 주세요.`;
  }
  return null;
}

function stringArrayFormError(items: string[], label: string) {
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    return `${label}은 1개 이상 50개 이하로 입력해 주세요.`;
  }

  const normalized = items.map((item) => item.trim());
  if (normalized.some((item) => !item)) {
    return `${label}의 빈 항목을 채우거나 삭제해 주세요.`;
  }
  if (normalized.some((item) => item.length > 255)) {
    return `${label}의 각 항목은 255자 이하로 입력해 주세요.`;
  }
  if (new Set(normalized).size !== normalized.length) {
    return `${label}에 같은 이름을 중복해서 입력할 수 없습니다.`;
  }
  return null;
}

export function validateCampusPlaceForm(form: CampusMapPlaceForm): string | null {
  if (!isCampusCode(form.campusCode)) {
    return "캠퍼스를 다시 선택해 주세요.";
  }

  const placeName = form.placeName.trim();
  if (!placeName) return "장소명을 입력해 주세요.";
  if (placeName.length > 255) return "장소명은 255자 이하로 입력해 주세요.";

  const latitudeError = coordinateFormError(form.latitude, "위도", -90, 90);
  if (latitudeError) return latitudeError;
  const longitudeError = coordinateFormError(form.longitude, "경도", -180, 180);
  if (longitudeError) return longitudeError;

  if (!isCampusPlaceCategory(form.category)) {
    return "장소 카테고리를 다시 선택해 주세요.";
  }

  const oneLineDescription = form.oneLineDescription.trim();
  if (!oneLineDescription) return "한 줄 소개를 입력해 주세요.";
  if (oneLineDescription.length > 255) {
    return "한 줄 소개는 255자 이하로 입력해 주세요.";
  }

  const imageUrl = form.imageUrl.trim();
  if (!imageUrl) return "장소 대표 이미지를 등록해 주세요.";
  if (imageUrl.length > 2_048) {
    return "장소 이미지 주소는 2,048자 이하이어야 합니다.";
  }
  if (!isHttpUrl(imageUrl)) {
    return "장소 대표 이미지 주소를 확인해 주세요.";
  }

  if (form.category !== "LECTURE_BUILDING") {
    const address = form.address.trim();
    if (!address) return "장소 주소를 입력해 주세요.";
    if (address.length > 255) return "장소 주소는 255자 이하로 입력해 주세요.";
    return null;
  }

  const location = form.location.trim();
  if (!location) return "건물 위치를 입력해 주세요.";
  if (location.length > 255) return "건물 위치는 255자 이하로 입력해 주세요.";

  const floorCount = form.floorCount.trim();
  const parsedFloorCount = Number(floorCount);
  if (
    !floorCount ||
    !Number.isFinite(parsedFloorCount) ||
    parsedFloorCount < 1
  ) {
    return "층수는 1 이상으로 입력해 주세요.";
  }

  const operatingHours = form.operatingHours.trim();
  if (!operatingHours) return "운영시간을 입력해 주세요.";
  if (operatingHours.length > 255) {
    return "운영시간은 255자 이하로 입력해 주세요.";
  }

  const departmentsError = stringArrayFormError(form.departments, "이용 학과");
  if (departmentsError) return departmentsError;
  return stringArrayFormError(form.majorFacilities, "주요시설");
}

export function campusPlaceFormToRequest(
  form: CampusMapPlaceForm,
): CampusMapPlaceRequest {
  const error = validateCampusPlaceForm(form);
  if (error) throw userFacingError(error);

  const common = {
    campusCode: form.campusCode,
    placeName: form.placeName.trim(),
    latitude: Number(form.latitude.trim()),
    longitude: Number(form.longitude.trim()),
    oneLineDescription: form.oneLineDescription.trim(),
    imageUrl: form.imageUrl.trim(),
  };

  if (form.category === "LECTURE_BUILDING") {
    return {
      ...common,
      category: form.category,
      lectureBuildingDetails: {
        location: form.location.trim(),
        floorCount: Number(form.floorCount.trim()),
        hasElevator: form.hasElevator,
        operatingHours: form.operatingHours.trim(),
        departments: form.departments.map((item) => item.trim()),
        majorFacilities: form.majorFacilities.map((item) => item.trim()),
      },
    };
  }

  return {
    ...common,
    category: form.category,
    address: form.address.trim(),
  };
}

export const campusMapPlaceFormToRequest = campusPlaceFormToRequest;

function requestToForm(request: CampusMapPlaceRequest): CampusMapPlaceForm | null {
  if (
    !isRecord(request) ||
    !isCampusCode(request.campusCode) ||
    !isCampusPlaceCategory(request.category) ||
    typeof request.placeName !== "string" ||
    typeof request.latitude !== "number" ||
    typeof request.longitude !== "number" ||
    typeof request.oneLineDescription !== "string" ||
    typeof request.imageUrl !== "string"
  ) {
    return null;
  }

  const commonKeys = [
    "campusCode",
    "placeName",
    "latitude",
    "longitude",
    "category",
    "oneLineDescription",
    "imageUrl",
  ];
  const allowedKeys = new Set(
    request.category === "LECTURE_BUILDING"
      ? [...commonKeys, "address", "lectureBuildingDetails"]
      : [...commonKeys, "address"],
  );
  if (Object.keys(request).some((key) => !allowedKeys.has(key))) {
    return null;
  }

  if (request.category === "LECTURE_BUILDING") {
    if (
      (request.address !== undefined && request.address !== null) ||
      !isRecord(request.lectureBuildingDetails) ||
      typeof request.lectureBuildingDetails.location !== "string" ||
      typeof request.lectureBuildingDetails.floorCount !== "number" ||
      typeof request.lectureBuildingDetails.hasElevator !== "boolean" ||
      typeof request.lectureBuildingDetails.operatingHours !== "string" ||
      !Array.isArray(request.lectureBuildingDetails.departments) ||
      !Array.isArray(request.lectureBuildingDetails.majorFacilities)
    ) {
      return null;
    }

    return {
      campusCode: request.campusCode,
      placeName: request.placeName,
      latitude: String(request.latitude),
      longitude: String(request.longitude),
      category: request.category,
      oneLineDescription: request.oneLineDescription,
      address: "",
      imageUrl: request.imageUrl,
      location: request.lectureBuildingDetails.location,
      floorCount: String(request.lectureBuildingDetails.floorCount),
      hasElevator: request.lectureBuildingDetails.hasElevator,
      operatingHours: request.lectureBuildingDetails.operatingHours,
      departments: request.lectureBuildingDetails.departments,
      majorFacilities: request.lectureBuildingDetails.majorFacilities,
    };
  }

  if (
    typeof request.address !== "string" ||
    request.lectureBuildingDetails !== undefined
  ) {
    return null;
  }

  return {
    ...initialCampusPlaceForm,
    campusCode: request.campusCode,
    placeName: request.placeName,
    latitude: String(request.latitude),
    longitude: String(request.longitude),
    category: request.category,
    oneLineDescription: request.oneLineDescription,
    address: request.address,
    imageUrl: request.imageUrl,
  };
}

export function validateCampusPlaceRequest(request: CampusMapPlaceRequest) {
  const form = requestToForm(request);
  return form
    ? validateCampusPlaceForm(form)
    : "장소 정보가 카테고리 규칙에 맞지 않습니다.";
}

export function normalizeCampusPlaceRequest(
  request: CampusMapPlaceRequest,
): CampusMapPlaceRequest {
  const form = requestToForm(request);
  if (!form) {
    throw userFacingError("장소 정보가 카테고리 규칙에 맞지 않습니다.");
  }
  return campusPlaceFormToRequest(form);
}

export function validateCampusPlaceImage(
  file: Pick<File, "name" | "size" | "type">,
): string | null {
  if (file.size === 0) return "내용이 없는 이미지는 등록할 수 없습니다.";
  if (file.size > MAX_CAMPUS_PLACE_IMAGE_SIZE) {
    return "장소 이미지는 5 MiB 이하이어야 합니다.";
  }
  if (file.type && !campusMapImageTypes.has(file.type)) {
    return "JPG, JPEG, PNG, GIF 형식의 이미지만 선택할 수 있습니다.";
  }
  return null;
}

export const validateCampusMapPlaceImage = validateCampusPlaceImage;

export function createCampusPlaceImageUploadBody(file: File) {
  const error = validateCampusPlaceImage(file);
  if (error) throw userFacingError(error);

  const body = new FormData();
  body.append("file", file, file.name);
  return body;
}

export const createCampusMapPlaceImageUploadBody =
  createCampusPlaceImageUploadBody;

function assertPlaceId(placeId: number) {
  if (!Number.isSafeInteger(placeId) || placeId < 1) {
    throw userFacingError("장소를 다시 선택해 주세요.");
  }
}

export async function fetchCampusPlaces(
  filters: CampusMapPlaceFilters = {},
  signal?: AbortSignal,
) {
  if (
    (filters.campusCode !== undefined && !isCampusCode(filters.campusCode)) ||
    (filters.category !== undefined &&
      !isCampusPlaceCategory(filters.category))
  ) {
    throw userFacingError("캠퍼스맵 조회 조건을 다시 선택해 주세요.");
  }

  const searchParams = new URLSearchParams();
  if (filters.campusCode) searchParams.set("campusCode", filters.campusCode);
  if (filters.category) searchParams.set("category", filters.category);
  const query = searchParams.toString();
  const response = await apiFetch<unknown>(
    `/api/campus-map/places${query ? `?${query}` : ""}`,
    { cache: "no-store", signal },
  );
  return parseCampusMapPlaceSummaries(response);
}

export async function fetchCampusPlace(
  placeId: number,
  signal?: AbortSignal,
) {
  assertPlaceId(placeId);
  const response = await apiFetch<unknown>(
    `/api/campus-map/places/${placeId}`,
    { cache: "no-store", signal },
  );
  return parseCampusMapPlaceDetail(response);
}

export async function createCampusPlace(
  request: CampusMapPlaceRequest,
  signal?: AbortSignal,
) {
  const normalizedRequest = normalizeCampusPlaceRequest(request);
  const response = await apiFetch<unknown>(
    "/api/admin/campus-map/places",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizedRequest),
      signal,
    },
  );
  return parseCampusMapPlaceDetail(response);
}

export async function updateCampusPlace(
  placeId: number,
  request: CampusMapPlaceRequest,
  signal?: AbortSignal,
) {
  assertPlaceId(placeId);
  const normalizedRequest = normalizeCampusPlaceRequest(request);
  const response = await apiFetch<unknown>(
    `/api/admin/campus-map/places/${placeId}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(normalizedRequest),
      signal,
    },
  );
  return parseCampusMapPlaceDetail(response);
}

export async function deleteCampusPlace(
  placeId: number,
  signal?: AbortSignal,
): Promise<void> {
  assertPlaceId(placeId);
  const response = await apiFetch<null>(
    `/api/admin/campus-map/places/${placeId}`,
    { method: "DELETE", signal },
  );
  if (response !== null) {
    throw userFacingError("장소 삭제 결과를 확인할 수 없습니다. 목록을 다시 불러와 주세요.");
  }
}

export async function uploadCampusPlaceImage(
  file: File,
  signal?: AbortSignal,
) {
  const response = await apiFetch<unknown>(
    "/api/admin/campus-map/place-images",
    {
      method: "POST",
      body: createCampusPlaceImageUploadBody(file),
      signal,
    },
  );
  return parseCampusMapPlaceImageUploadResponse(response);
}

export const getCampusMapPlaces = fetchCampusPlaces;
export const getCampusMapPlace = fetchCampusPlace;
export const createCampusMapPlace = createCampusPlace;
export const updateCampusMapPlace = updateCampusPlace;
export const deleteCampusMapPlace = deleteCampusPlace;
export const uploadCampusMapPlaceImage = uploadCampusPlaceImage;
