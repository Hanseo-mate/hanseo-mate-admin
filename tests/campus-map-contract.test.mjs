import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const helperUrl = new URL("../app/lib/campus-map.ts", import.meta.url);
const helperSource = await readFile(helperUrl, "utf8");
const pageSource = await readFile(
  new URL("../app/campus-map/manage/page.tsx", import.meta.url),
  "utf8",
);
const executableSource = helperSource.replace(
  'import { ApiError, apiFetch, getErrorText } from "./api";',
  `export class ApiError extends Error {
    status: number;
    payload: unknown;
    constructor(message: string, status = 0, payload: unknown = null) {
      super(message);
      this.name = "ApiError";
      this.status = status;
      this.payload = payload;
    }
  }
  const getErrorText = (error: unknown) =>
    error instanceof Error && (error.name === "ApiError" || error.name === "UserFacingError")
      ? error.message
      : "요청을 처리하는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.";
  const apiFetch = (path: string, init: RequestInit = {}) =>
    (globalThis as typeof globalThis & { __campusMapApiFetch: Function })
      .__campusMapApiFetch(path, init);`,
);
const transpiled = ts.transpileModule(executableSource, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: helperUrl.pathname,
}).outputText;
const campusMap = await import(
  `data:text/javascript;base64,${Buffer.from(transpiled).toString("base64")}`
);

function makeCafe(overrides = {}) {
  return {
    placeId: 2,
    campusCode: "SEOSAN",
    placeName: "가배앤빈",
    category: "CAFE",
    categoryName: "카페",
    oneLineDescription: "한서대학교 대정문 인근 카페",
    address: "충청남도 서산시 해미면 대곡리",
    imageUrl: "https://api.example.com/uploads/campus-places/example.jpg",
    latitude: 36.691166,
    longitude: 126.574659,
    ...overrides,
  };
}

function makeLectureBuilding(overrides = {}) {
  return {
    placeId: 83,
    campusCode: "SEOSAN",
    placeName: "공학관",
    category: "LECTURE_BUILDING",
    categoryName: "교내시설",
    oneLineDescription: "공학 계열 강의와 실습이 진행되는 건물",
    imageUrl: "https://api.example.com/uploads/campus-places/building.jpg",
    latitude: 36.690884,
    longitude: 126.585761,
    lectureBuildingDetails: {
      location: "서산캠퍼스 공학관",
      floorCount: 5,
      hasElevator: true,
      departments: ["컴퓨터공학과", "항공소프트웨어공학과"],
      majorFacilities: ["전산실습실", "학과사무실"],
    },
    ...overrides,
  };
}

function makeCafeForm(overrides = {}) {
  return {
    campusCode: "SEOSAN",
    placeName: "  가배앤빈  ",
    latitude: "36.691166",
    longitude: "126.574659",
    category: "CAFE",
    oneLineDescription: "  대정문 인근 카페  ",
    address: "  충청남도 서산시 해미면 대곡리  ",
    imageUrl: " https://api.example.com/uploads/campus-places/example.jpg ",
    location: "",
    floorCount: "",
    hasElevator: false,
    majorFacilities: [""],
    ...overrides,
  };
}

test("keeps the documented campus and category values and parses the places wrapper", () => {
  assert.deepEqual(campusMap.campusOptions, [
    { value: "SEOSAN", label: "서산캠퍼스" },
    { value: "TAEAN", label: "태안캠퍼스" },
  ]);
  assert.deepEqual(campusMap.categoryOptions, [
    { value: "RESTAURANT", label: "음식점" },
    { value: "CAFE", label: "카페" },
    { value: "LECTURE_BUILDING", label: "교내시설" },
    { value: "CONVENIENCE_FACILITY", label: "편의시설" },
  ]);

  const expected = makeCafe();
  assert.deepEqual(
    campusMap.parseCampusMapPlaceSummaries({ places: [expected] }),
    [expected],
  );
  assert.throws(
    () => campusMap.parseCampusMapPlaceSummaries([expected]),
    /장소 목록/,
  );
  assert.equal(
    campusMap.parseCampusMapPlaceSummary(makeCafe({ categoryName: "카페 및 베이커리" })).categoryName,
    "카페 및 베이커리",
  );
});

test("normalizes nullable legacy fields without hiding the entire 200 list", () => {
  const [legacy, newlineImage] = campusMap.parseCampusMapPlaceSummaries({
    selectedCampusCode: null,
    places: [
      makeCafe({
        oneLineDescription: null,
        address: null,
        imageUrl: null,
      }),
      makeCafe({
        placeId: 3,
        imageUrl: "https://api.example.com/place.jpg\n",
      }),
    ],
  });

  assert.equal(legacy.oneLineDescription, "");
  assert.equal(legacy.address, undefined);
  assert.equal(legacy.imageUrl, "");
  assert.equal(newlineImage.imageUrl, "https://api.example.com/place.jpg");
});

test("keeps a mixed list visible when production lecture metadata uses legacy values", () => {
  const places = campusMap.parseCampusMapPlaceSummaries({
    selectedCampusCode: null,
    places: [
      makeCafe(),
      makeLectureBuilding({ address: "충남 태안군 남면 신온리" }),
    ],
  });

  assert.equal(places.length, 2);
  assert.equal(places[1].categoryName, "교내시설");
  assert.equal(places[1].address, "충남 태안군 남면 신온리");
});

test("parses mutually exclusive detail shapes and maps a detail into the edit form", () => {
  const lecture = campusMap.parseCampusMapPlaceDetail(makeLectureBuilding());
  assert.equal(lecture.category, "LECTURE_BUILDING");
  assert.equal(lecture.address, undefined);
  assert.equal(lecture.lectureBuildingDetails.floorCount, 5);
  assert.deepEqual(lecture.lectureBuildingDetails.departments, [
    "컴퓨터공학과",
    "항공소프트웨어공학과",
  ]);

  const form = campusMap.campusMapPlaceDetailToForm(lecture);
  assert.equal(form.latitude, "36.690884");
  assert.equal(form.location, "서산캠퍼스 공학관");

  assert.throws(
    () => campusMap.parseCampusMapPlaceDetail(
      makeLectureBuilding({ lectureBuildingDetails: undefined }),
    ),
    /장소 정보를 확인할 수 없습니다/,
  );
  assert.throws(
    () => campusMap.parseCampusMapPlaceDetail(
      makeCafe({ lectureBuildingDetails: makeLectureBuilding().lectureBuildingDetails }),
    ),
    /장소 정보를 확인할 수 없습니다/,
  );
  const legacyLectureWithAddress = campusMap.parseCampusMapPlaceDetail(
    makeLectureBuilding({ address: "충남 태안군 남면" }),
  );
  assert.equal(legacyLectureWithAddress.address, undefined);

  const legacyCafe = campusMap.parseCampusMapPlaceDetail(makeCafe({
    lectureBuildingDetails: null,
  }));
  assert.equal(legacyCafe.category, "CAFE");

  const legacyLecture = campusMap.parseCampusMapPlaceDetail(makeLectureBuilding({
    address: null,
    lectureBuildingDetails: {
      ...makeLectureBuilding().lectureBuildingDetails,
      majorFacilities: [],
    },
  }));
  assert.equal(legacyLecture.address, undefined);
  assert.equal("operatingHours" in legacyLecture.lectureBuildingDetails, false);
  assert.deepEqual(legacyLecture.lectureBuildingDetails.majorFacilities, []);
  assert.deepEqual(
    campusMap.campusMapPlaceDetailToForm(legacyLecture).majorFacilities,
    [""],
  );

  const legacyLectureWithoutDetails = campusMap.parseCampusMapPlaceDetail(
    makeLectureBuilding({ lectureBuildingDetails: null }),
  );
  assert.equal(legacyLectureWithoutDetails.lectureBuildingDetails, null);
  assert.deepEqual(
    campusMap.campusMapPlaceDetailToForm(legacyLectureWithoutDetails),
    {
      ...campusMap.campusMapPlaceDetailToForm(makeLectureBuilding()),
      location: "",
      floorCount: "",
      hasElevator: false,
      majorFacilities: [""],
    },
  );
  assert.match(
    campusMap.validateCampusPlaceForm(
      campusMap.campusMapPlaceDetailToForm(legacyLectureWithoutDetails),
    ),
    /건물 위치/,
  );
});

test("normalizes the exact non-lecture or lecture request branch", () => {
  const cafeRequest = campusMap.campusPlaceFormToRequest(makeCafeForm());
  assert.deepEqual(cafeRequest, {
    campusCode: "SEOSAN",
    placeName: "가배앤빈",
    latitude: 36.691166,
    longitude: 126.574659,
    category: "CAFE",
    oneLineDescription: "대정문 인근 카페",
    address: "충청남도 서산시 해미면 대곡리",
    imageUrl: "https://api.example.com/uploads/campus-places/example.jpg",
  });
  assert.equal("lectureBuildingDetails" in cafeRequest, false);
  assert.equal("placeNameKey" in cafeRequest, false);

  const lectureRequest = campusMap.campusPlaceFormToRequest(makeCafeForm({
    category: "LECTURE_BUILDING",
    address: "이 값은 요청에서 제외되어야 함",
    location: "  서산캠퍼스 공학관  ",
    floorCount: "5",
    hasElevator: true,
    majorFacilities: [" 전산실습실 ", "학과사무실"],
  }));
  assert.equal(lectureRequest.category, "LECTURE_BUILDING");
  assert.equal("address" in lectureRequest, false);
  assert.deepEqual(lectureRequest.lectureBuildingDetails, {
    location: "서산캠퍼스 공학관",
    floorCount: 5,
    hasElevator: true,
    majorFacilities: ["전산실습실", "학과사무실"],
  });
  assert.equal("operatingHours" in lectureRequest.lectureBuildingDetails, false);
  assert.equal("departments" in lectureRequest.lectureBuildingDetails, false);

  assert.equal(campusMap.validateCampusPlaceRequest({
    ...lectureRequest,
    address: null,
  }), null);
  assert.throws(
    () => campusMap.normalizeCampusPlaceRequest({
      ...cafeRequest,
      placeNameKey: "가배앤빈",
    }),
    /카테고리 규칙/,
  );
});

test("validates documented field, coordinate, URL, and lecture-array limits", () => {
  assert.equal(campusMap.validateCampusPlaceForm(makeCafeForm()), null);
  assert.match(
    campusMap.validateCampusPlaceForm(makeCafeForm({ address: " " })) ?? "",
    /주소/,
  );
  assert.match(
    campusMap.validateCampusPlaceForm(makeCafeForm({ latitude: "36.1234567891" })) ?? "",
    /9자리/,
  );
  assert.match(
    campusMap.validateCampusPlaceForm(makeCafeForm({ longitude: "181" })) ?? "",
    /-180 이상 180 이하/,
  );
  assert.match(
    campusMap.validateCampusPlaceForm(makeCafeForm({ imageUrl: "ftp://example.com/a.jpg" })) ?? "",
    /이미지 주소/,
  );
  assert.match(
    campusMap.validateCampusPlaceForm(makeCafeForm({
      category: "LECTURE_BUILDING",
      location: "공학관",
      floorCount: "0",
      majorFacilities: ["강의실"],
    })) ?? "",
    /1 이상/,
  );
  assert.equal(campusMap.validateCampusPlaceForm(makeCafeForm({
    category: "LECTURE_BUILDING",
    location: "공학관",
    floorCount: "1.5",
    majorFacilities: ["강의실"],
  })), null);
  assert.match(
    campusMap.validateCampusPlaceForm(makeCafeForm({
      category: "LECTURE_BUILDING",
      location: "공학관",
      floorCount: "3",
      majorFacilities: ["강의실", " 강의실 "],
    })) ?? "",
    /중복/,
  );
});

test("keeps API-managed departments out of the administrator editor", () => {
  assert.doesNotMatch(pageSource, /departments|입주 학과/);
});

test("builds one browser-managed file part and enforces JPG/PNG/GIF at 5 MiB", () => {
  const valid = new File([new Uint8Array(5 * 1024 * 1024)], "place.jpg", {
    type: "image/jpeg",
  });
  assert.equal(campusMap.validateCampusPlaceImage(valid), null);
  const body = campusMap.createCampusPlaceImageUploadBody(valid);
  assert.deepEqual([...body.keys()], ["file"]);
  assert.ok(body.get("file") instanceof File);

  assert.match(
    campusMap.validateCampusPlaceImage(
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "place.jpg", {
        type: "image/jpeg",
      }),
    ) ?? "",
    /5 MiB/,
  );
  assert.match(
    campusMap.validateCampusPlaceImage(
      new File(["webp"], "place.webp", { type: "image/webp" }),
    ) ?? "",
    /JPG/,
  );
  assert.equal(
    campusMap.validateCampusPlaceImage(
      new File(["png"], "server-checks-the-content.data", { type: "image/png" }),
    ),
    null,
  );
});

test("shows only the documented safe campus-map 400 messages", () => {
  const duplicate = new campusMap.ApiError(
    "입력한 내용이나 선택한 파일을 확인해 주세요.",
    400,
    { message: "같은 캠퍼스에 같은 이름의 장소가 이미 있습니다." },
  );
  assert.equal(
    campusMap.getCampusMapErrorText(duplicate),
    "같은 캠퍼스에 같은 이름의 장소가 이미 있습니다.",
  );

  const unsafe = new campusMap.ApiError(
    "입력한 내용이나 선택한 파일을 확인해 주세요.",
    400,
    { message: "internal table campus_places failed" },
  );
  assert.equal(
    campusMap.getCampusMapErrorText(unsafe),
    "입력한 내용이나 선택한 파일을 확인해 주세요.",
  );
});

test("uses public GETs and exact administrator POST, PUT, DELETE, and upload requests", async () => {
  const calls = [];
  const responses = [
    { places: [makeCafe()] },
    makeCafe(),
    makeCafe({ placeId: 115 }),
    makeCafe({ oneLineDescription: "수정됨" }),
    null,
    { imageUrl: "https://api.example.com/uploads/campus-places/new.jpg" },
  ];
  globalThis.__campusMapApiFetch = async (path, init = {}) => {
    calls.push({ path, init });
    return responses.shift();
  };

  const request = campusMap.campusPlaceFormToRequest(makeCafeForm());
  assert.equal((await campusMap.fetchCampusPlaces({
    campusCode: "SEOSAN",
    category: "CAFE",
  })).length, 1);
  await campusMap.fetchCampusPlace(2);
  await campusMap.createCampusPlace(request);
  await campusMap.updateCampusPlace(2, request);
  assert.equal(await campusMap.deleteCampusPlace(2), undefined);
  const upload = await campusMap.uploadCampusPlaceImage(
    new File(["image"], "place.png", { type: "image/png" }),
  );
  assert.equal(upload.imageUrl.endsWith("/new.jpg"), true);

  assert.deepEqual(
    calls.map(({ path, init }) => ({
      path,
      method: init.method ?? "GET",
      hasBody: init.body !== undefined,
    })),
    [
      {
        path: "/api/campus-map/places?campusCode=SEOSAN&category=CAFE",
        method: "GET",
        hasBody: false,
      },
      { path: "/api/campus-map/places/2", method: "GET", hasBody: false },
      { path: "/api/admin/campus-map/places", method: "POST", hasBody: true },
      { path: "/api/admin/campus-map/places/2", method: "PUT", hasBody: true },
      { path: "/api/admin/campus-map/places/2", method: "DELETE", hasBody: false },
      { path: "/api/admin/campus-map/place-images", method: "POST", hasBody: true },
    ],
  );

  for (const call of calls.slice(2, 4)) {
    assert.deepEqual(call.init.headers, { "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(call.init.body), request);
  }
  assert.ok(calls[5].init.body instanceof FormData);
  assert.equal(calls[5].init.headers, undefined);
});
