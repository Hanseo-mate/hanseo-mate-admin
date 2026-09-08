"use client";

import {
  ArrowClockwise,
  Buildings,
  CheckCircle,
  ImageSquare,
  MagnifyingGlass,
  MapPin,
  MapTrifold,
  Plus,
  Trash,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AdminLoginNotice } from "../../components/AdminLoginNotice";
import { ConfirmDialog } from "../../components/ConfirmDialog";
import { UnsavedChangesDialog } from "../../components/UnsavedChangesDialog";
import { ADMIN_SESSION_EVENT, getAdminSession } from "../../lib/auth";
import {
  CAMPUS_MAP_IMAGE_ACCEPT,
  type CampusCode,
  type CampusMapPlaceDetail,
  type CampusMapPlaceForm,
  type CampusMapPlaceSummary,
  type CampusPlaceCategory,
  campusMapPlaceDetailToForm,
  campusPlaceFormToRequest,
  campusOptions,
  categoryOptions,
  createCampusPlace,
  deleteCampusPlace,
  fetchCampusPlace,
  fetchCampusPlaces,
  getCampusMapErrorText,
  initialCampusPlaceForm,
  updateCampusPlace,
  uploadCampusPlaceImage,
  validateCampusPlaceForm,
  validateCampusPlaceImage,
} from "../../lib/campus-map";
import styles from "../campus-map.module.css";

type LoadState = "idle" | "loading" | "ready" | "error";
type DetailState = "idle" | "loading" | "ready" | "error";
type BusyAction = "create" | "update" | "delete" | "image" | "";
type CampusFilter = "ALL" | CampusCode;
type CategoryFilter = "ALL" | CampusPlaceCategory;
type Feedback = {
  tone: "success" | "info" | "error";
  title: string;
  message: string;
};
type FieldErrors = Partial<Record<keyof CampusMapPlaceForm, string>>;
type Filters = {
  campusFilter: CampusFilter;
  categoryFilter: CategoryFilter;
};
type PendingAction =
  | { kind: "select"; place: CampusMapPlaceSummary }
  | { kind: "create" }
  | { kind: "refresh" }
  | { kind: "filter"; filters: Filters }
  | null;

const TEXT_LIMIT = 255;
const IMAGE_URL_LIMIT = 2_048;
const ARRAY_LIMIT = 50;
const coordinatePattern = /^-?(?:\d+|\d*\.\d+)$/;

function freshInitialForm(): CampusMapPlaceForm {
  return {
    ...initialCampusPlaceForm,
    majorFacilities: [...initialCampusPlaceForm.majorFacilities],
  };
}

function formBaseline(form: CampusMapPlaceForm) {
  return JSON.stringify(form);
}

function optionLabel<T extends string>(
  options: readonly { value: T; label: string }[],
  value: T,
) {
  return options.find((option) => option.value === value)?.label ?? value;
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function textError(value: string, label: string) {
  if (!value.trim()) return `${label}을(를) 입력해 주세요.`;
  if (value.trim().length > TEXT_LIMIT) return `${label}은(는) ${TEXT_LIMIT}자 이하로 입력해 주세요.`;
  return "";
}

function coordinateError(value: string, label: string, min: number, max: number) {
  const normalized = value.trim();
  if (!normalized) return `${label}을(를) 입력해 주세요.`;
  if (!coordinatePattern.test(normalized)) return `${label}은(는) 숫자로 입력해 주세요.`;
  const fraction = normalized.split(".")[1] ?? "";
  if (fraction.length > 9) return `${label}은(는) 소수점 아래 9자리까지 입력할 수 있습니다.`;
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < min || number > max) {
    return `${label}은(는) ${min}부터 ${max} 사이여야 합니다.`;
  }
  return "";
}

function listError(values: string[], label: string) {
  if (values.length < 1) return `${label}을(를) 1개 이상 입력해 주세요.`;
  if (values.length > ARRAY_LIMIT) return `${label}은(는) ${ARRAY_LIMIT}개까지 입력할 수 있습니다.`;

  const normalized = values.map((value) => value.trim());
  if (normalized.some((value) => !value)) return `비어 있는 ${label} 항목을 채워 주세요.`;
  if (normalized.some((value) => value.length > TEXT_LIMIT)) {
    return `${label} 항목은 각각 ${TEXT_LIMIT}자 이하로 입력해 주세요.`;
  }
  if (new Set(normalized).size !== normalized.length) return `중복된 ${label} 항목을 정리해 주세요.`;
  return "";
}

function imageUrlError(value: string) {
  if (!value.trim()) return "대표 사진을 선택한 뒤 먼저 업로드해 주세요.";
  if (value.length > IMAGE_URL_LIMIT) return "대표 사진 주소가 너무 깁니다. 사진을 다시 업로드해 주세요.";
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("invalid protocol");
  } catch {
    return "대표 사진 주소를 확인할 수 없습니다. 사진을 다시 업로드해 주세요.";
  }
  return "";
}

function validateFields(form: CampusMapPlaceForm): FieldErrors {
  const errors: FieldErrors = {};
  const placeName = textError(form.placeName, "장소 이름");
  const description = textError(form.oneLineDescription, "한 줄 설명");
  const latitude = coordinateError(form.latitude, "위도", -90, 90);
  const longitude = coordinateError(form.longitude, "경도", -180, 180);
  const imageUrl = imageUrlError(form.imageUrl);

  if (placeName) errors.placeName = placeName;
  if (description) errors.oneLineDescription = description;
  if (latitude) errors.latitude = latitude;
  if (longitude) errors.longitude = longitude;
  if (imageUrl) errors.imageUrl = imageUrl;

  if (form.category === "LECTURE_BUILDING") {
    const location = textError(form.location, "건물 위치");
    const floorCount = form.floorCount.trim();
    const facilities = listError(form.majorFacilities, "주요 시설");

    if (location) errors.location = location;
    const parsedFloorCount = Number(floorCount);
    if (!floorCount || !Number.isFinite(parsedFloorCount) || parsedFloorCount < 1) {
      errors.floorCount = "층수는 1 이상의 숫자로 입력해 주세요.";
    }
    if (facilities) errors.majorFacilities = facilities;
  } else {
    const address = textError(form.address, "주소");
    if (address) errors.address = address;
  }

  return errors;
}

function updateUrlPlaceId(placeId: number | null) {
  const url = new URL(window.location.href);
  if (placeId) url.searchParams.set("id", String(placeId));
  else url.searchParams.delete("id");
  window.history.replaceState(null, "", `${url.pathname}${url.search}`);
}

function PlaceImage({
  file,
  imageUrl,
  alt,
}: {
  file: File | null;
  imageUrl: string;
  alt: string;
}) {
  const imageRef = useRef<HTMLImageElement | null>(null);
  const sourceKey = file ? `${file.name}:${file.size}:${file.lastModified}` : imageUrl;
  const [failedSource, setFailedSource] = useState<string | null>(null);

  useEffect(() => {
    if (!file || !imageRef.current) return;
    const nextUrl = URL.createObjectURL(file);
    imageRef.current.src = nextUrl;
    return () => URL.revokeObjectURL(nextUrl);
  }, [file]);

  if ((!file && !imageUrl) || failedSource === sourceKey) {
    return (
      <div className={styles.imageFallback} role="img" aria-label={`${alt}: 사진 없음`}>
        {failedSource === sourceKey
          ? <WarningCircle size={30} aria-hidden="true" />
          : <ImageSquare size={30} aria-hidden="true" />}
        <strong>{failedSource === sourceKey ? "사진을 불러오지 못했습니다." : "대표 사진이 없습니다."}</strong>
        <span>{failedSource === sourceKey ? "새 사진을 선택해 주세요." : "JPG, PNG 또는 GIF 사진을 선택해 주세요."}</span>
      </div>
    );
  }

  return (
    // 사진 주소는 실행 환경에 따라 달라 정적 이미지 설정을 사용할 수 없습니다.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={imageRef}
      src={file ? undefined : imageUrl}
      alt={alt}
      onLoad={() => setFailedSource(null)}
      onError={() => setFailedSource(sourceKey)}
    />
  );
}

function ListLoadingState() {
  return (
    <div className={styles.loadingList} role="status" aria-label="캠퍼스맵 장소 목록을 불러오는 중">
      <span />
      <span />
      <span />
      <span />
    </div>
  );
}

export default function ManageCampusMapPage() {
  const [places, setPlaces] = useState<CampusMapPlaceSummary[]>([]);
  const [listState, setListState] = useState<LoadState>("idle");
  const [listErrorMessage, setListErrorMessage] = useState("");
  const [campusFilter, setCampusFilter] = useState<CampusFilter>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("ALL");
  const [searchQuery, setSearchQuery] = useState("");
  const [selected, setSelected] = useState<CampusMapPlaceSummary | null>(null);
  const [detail, setDetail] = useState<CampusMapPlaceDetail | null>(null);
  const [detailState, setDetailState] = useState<DetailState>("idle");
  const [detailErrorMessage, setDetailErrorMessage] = useState("");
  const [form, setForm] = useState<CampusMapPlaceForm>(() => freshInitialForm());
  const [baseline, setBaseline] = useState(() => formBaseline(freshInitialForm()));
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>("");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const listRequestId = useRef(0);
  const detailRequestId = useRef(0);
  const mutationInProgress = useRef(false);
  const selectedIdRef = useRef<number | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);

  const isBusy = Boolean(busyAction);
  const isCreateMode = selected === null;
  const isDirty = formBaseline(form) !== baseline || Boolean(imageFile);
  const filters = useMemo<Filters>(() => ({ campusFilter, categoryFilter }), [campusFilter, categoryFilter]);
  const visiblePlaces = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase("ko-KR");
    if (!query) return places;
    return places.filter((place) => (
      place.placeName.toLocaleLowerCase("ko-KR").includes(query) ||
      place.oneLineDescription.toLocaleLowerCase("ko-KR").includes(query)
    ));
  }, [places, searchQuery]);

  const focusEditor = useCallback(() => {
    window.requestAnimationFrame(() => {
      if (window.matchMedia("(max-width: 1040px)").matches) {
        editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, []);

  const resetImageInput = useCallback(() => {
    if (imageInputRef.current) imageInputRef.current.value = "";
  }, []);

  const enterCreateMode = useCallback((reveal = false) => {
    const nextForm = freshInitialForm();
    selectedIdRef.current = null;
    detailRequestId.current += 1;
    setSelected(null);
    setDetail(null);
    setDetailState("idle");
    setDetailErrorMessage("");
    setForm(nextForm);
    setBaseline(formBaseline(nextForm));
    setFieldErrors({});
    setImageFile(null);
    setDeleteOpen(false);
    resetImageInput();
    updateUrlPlaceId(null);
    if (reveal) focusEditor();
  }, [focusEditor, resetImageInput]);

  const enterEditMode = useCallback((nextDetail: CampusMapPlaceDetail, reveal = false) => {
    const nextForm = campusMapPlaceDetailToForm(nextDetail);
    selectedIdRef.current = nextDetail.placeId;
    setSelected(nextDetail);
    setDetail(nextDetail);
    setDetailState("ready");
    setDetailErrorMessage("");
    setForm(nextForm);
    setBaseline(formBaseline(nextForm));
    setFieldErrors({});
    setImageFile(null);
    setDeleteOpen(false);
    resetImageInput();
    updateUrlPlaceId(nextDetail.placeId);
    if (reveal) focusEditor();
  }, [focusEditor, resetImageInput]);

  const loadPlaceDetail = useCallback(async (
    place: CampusMapPlaceSummary,
    reveal = true,
  ) => {
    const requestId = ++detailRequestId.current;
    selectedIdRef.current = place.placeId;
    setSelected(place);
    setDetail(null);
    setDetailState("loading");
    setDetailErrorMessage("");
    setFieldErrors({});
    setImageFile(null);
    setFeedback(null);
    resetImageInput();
    updateUrlPlaceId(place.placeId);
    if (reveal) focusEditor();

    try {
      const nextDetail = await fetchCampusPlace(place.placeId);
      if (requestId !== detailRequestId.current) return;
      enterEditMode(nextDetail);
    } catch (error) {
      if (requestId !== detailRequestId.current) return;
      setDetailState("error");
      setDetailErrorMessage(getCampusMapErrorText(error));
    }
  }, [enterEditMode, focusEditor, resetImageInput]);

  const loadPlaces = useCallback(async (
    nextFilters: Filters,
    selectId?: number | null,
  ) => {
    const requestId = ++listRequestId.current;
    setListState("loading");
    setListErrorMessage("");

    const requestFilters = {
      ...(nextFilters.campusFilter === "ALL" ? {} : { campusCode: nextFilters.campusFilter }),
      ...(nextFilters.categoryFilter === "ALL" ? {} : { category: nextFilters.categoryFilter }),
    };

    try {
      const nextPlaces = await fetchCampusPlaces(requestFilters);
      if (requestId !== listRequestId.current) return;
      setPlaces(nextPlaces);
      setListState("ready");
      setSelected((current) => {
        if (!current) return null;
        return nextPlaces.find((place) => place.placeId === current.placeId) ?? current;
      });

      if (selectId !== undefined && selectId !== null) {
        const target = nextPlaces.find((place) => place.placeId === selectId);
        if (target) {
          await loadPlaceDetail(target, false);
        } else {
          enterCreateMode();
          setFeedback({
            tone: "info",
            title: "선택한 장소를 찾을 수 없습니다.",
            message: "현재 필터의 최신 목록을 표시했습니다. 다른 장소를 선택해 주세요.",
          });
        }
      }
    } catch (error) {
      if (requestId !== listRequestId.current) return;
      setListState("error");
      setListErrorMessage(getCampusMapErrorText(error));
    }
  }, [enterCreateMode, loadPlaceDetail]);

  useEffect(() => {
    const handleSessionChange = () => {
      if (getAdminSession()) {
        const value = new URLSearchParams(window.location.search).get("id");
        const requestedId = value && /^\d+$/.test(value) ? Number(value) : null;
        void loadPlaces({ campusFilter: "ALL", categoryFilter: "ALL" }, requestedId);
        return;
      }

      listRequestId.current += 1;
      detailRequestId.current += 1;
      setPlaces([]);
      setListState("idle");
      setListErrorMessage("");
      setFeedback(null);
      enterCreateMode();
    };

    const timeoutId = window.setTimeout(handleSessionChange, 0);
    window.addEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
    return () => {
      window.clearTimeout(timeoutId);
      window.removeEventListener(ADMIN_SESSION_EVENT, handleSessionChange);
      listRequestId.current += 1;
      detailRequestId.current += 1;
    };
  }, [enterCreateMode, loadPlaces]);

  useEffect(() => {
    if (!isDirty) return;
    const warnBeforeLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warnBeforeLeave);
    return () => window.removeEventListener("beforeunload", warnBeforeLeave);
  }, [isDirty]);

  function setField<K extends keyof CampusMapPlaceForm>(key: K, value: CampusMapPlaceForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setFeedback(null);
  }

  function changeCategory(category: CampusPlaceCategory) {
    setForm((current) => ({
      ...current,
      category,
      majorFacilities: category === "LECTURE_BUILDING" && current.majorFacilities.length === 0
        ? [""]
        : current.majorFacilities,
    }));
    setFieldErrors({});
    setFeedback(null);
  }

  function changeListItem(
    key: "majorFacilities",
    index: number,
    value: string,
  ) {
    setForm((current) => ({
      ...current,
      [key]: current[key].map((item, itemIndex) => itemIndex === index ? value : item),
    }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
    setFeedback(null);
  }

  function addListItem(key: "majorFacilities") {
    setForm((current) => current[key].length >= ARRAY_LIMIT
      ? current
      : { ...current, [key]: [...current[key], ""] });
  }

  function removeListItem(key: "majorFacilities", index: number) {
    setForm((current) => ({
      ...current,
      [key]: current[key].length <= 1
        ? [""]
        : current[key].filter((_, itemIndex) => itemIndex !== index),
    }));
    setFieldErrors((current) => {
      if (!current[key]) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }

  function requestSelection(place: CampusMapPlaceSummary) {
    if (isBusy || selected?.placeId === place.placeId) return;
    if (isDirty) {
      setPendingAction({ kind: "select", place });
      return;
    }
    void loadPlaceDetail(place);
  }

  function requestCreateMode() {
    if (isBusy) return;
    if (isCreateMode && !isDirty) {
      focusEditor();
      return;
    }
    if (isDirty) {
      setPendingAction({ kind: "create" });
      return;
    }
    setFeedback(null);
    enterCreateMode(true);
  }

  function requestRefresh() {
    if (isBusy || listState === "loading") return;
    if (isDirty) {
      setPendingAction({ kind: "refresh" });
      return;
    }
    setFeedback(null);
    void loadPlaces(filters, selectedIdRef.current);
  }

  function requestFilters(nextFilters: Filters) {
    if (
      nextFilters.campusFilter === campusFilter &&
      nextFilters.categoryFilter === categoryFilter
    ) return;
    if (isDirty) {
      setPendingAction({ kind: "filter", filters: nextFilters });
      return;
    }
    applyFilters(nextFilters);
  }

  function applyFilters(nextFilters: Filters) {
    setCampusFilter(nextFilters.campusFilter);
    setCategoryFilter(nextFilters.categoryFilter);
    setSearchQuery("");
    setFeedback(null);
    enterCreateMode();
    void loadPlaces(nextFilters);
  }

  function confirmPendingAction() {
    const action = pendingAction;
    setPendingAction(null);
    if (!action) return;

    if (action.kind === "select") {
      void loadPlaceDetail(action.place);
      return;
    }
    if (action.kind === "create") {
      setFeedback(null);
      enterCreateMode(true);
      return;
    }
    if (action.kind === "filter") {
      applyFilters(action.filters);
      return;
    }

    const selectedId = selectedIdRef.current;
    if (selectedId === null) enterCreateMode();
    void loadPlaces(filters, selectedId);
  }

  function resetForm() {
    setFeedback(null);
    if (detail) enterEditMode(detail);
    else enterCreateMode(true);
  }

  function chooseImage(file: File | null) {
    if (!file || isBusy) return;
    const error = validateCampusPlaceImage(file);
    if (error) {
      setFeedback({
        tone: "error",
        title: "대표 사진을 선택할 수 없습니다.",
        message: error,
      });
      setImageFile(null);
      resetImageInput();
      return;
    }
    setImageFile(file);
    setFieldErrors((current) => {
      if (!current.imageUrl) return current;
      const next = { ...current };
      delete next.imageUrl;
      return next;
    });
    setFeedback(null);
  }

  async function uploadImage() {
    if (!imageFile || mutationInProgress.current) return;
    const validationMessage = validateCampusPlaceImage(imageFile);
    if (validationMessage) {
      setFeedback({ tone: "error", title: "대표 사진을 업로드할 수 없습니다.", message: validationMessage });
      return;
    }

    mutationInProgress.current = true;
    setBusyAction("image");
    setFeedback(null);
    try {
      const response = await uploadCampusPlaceImage(imageFile);
      setForm((current) => ({ ...current, imageUrl: response.imageUrl }));
      setFieldErrors((current) => {
        const next = { ...current };
        delete next.imageUrl;
        return next;
      });
      setImageFile(null);
      resetImageInput();
      setFeedback({
        tone: "success",
        title: "대표 사진을 업로드했습니다.",
        message: "사진만 업로드된 상태입니다. 장소 등록 또는 변경 저장을 눌러 장소 정보에 반영해 주세요.",
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        title: "대표 사진을 업로드하지 못했습니다.",
        message: getCampusMapErrorText(error),
      });
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  function focusFirstError(errors: FieldErrors) {
    const firstField = Object.keys(errors)[0] as keyof CampusMapPlaceForm | undefined;
    if (!firstField) return;
    const id = firstField === "majorFacilities"
      ? `campus-map-${firstField}-0`
      : `campus-map-${firstField}`;
    window.requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  async function submitPlace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (mutationInProgress.current || detailState === "loading") return;
    setFeedback(null);

    if (imageFile) {
      setFieldErrors((current) => ({ ...current, imageUrl: "선택한 대표 사진을 먼저 업로드해 주세요." }));
      setFeedback({
        tone: "error",
        title: "대표 사진 업로드가 남아 있습니다.",
        message: "사진 영역의 업로드 버튼을 누른 뒤 장소 정보를 저장해 주세요.",
      });
      imageInputRef.current?.focus();
      return;
    }

    const nextErrors = validateFields(form);
    setFieldErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setFeedback({
        tone: "error",
        title: "입력한 장소 정보를 확인해 주세요.",
        message: "표시된 항목을 수정한 뒤 다시 저장해 주세요.",
      });
      focusFirstError(nextErrors);
      return;
    }

    const validationMessage = validateCampusPlaceForm(form);
    if (validationMessage) {
      setFeedback({
        tone: "error",
        title: "입력한 장소 정보를 확인해 주세요.",
        message: validationMessage,
      });
      return;
    }

    mutationInProgress.current = true;
    setBusyAction(isCreateMode ? "create" : "update");
    try {
      const payload = campusPlaceFormToRequest(form);
      const saved = isCreateMode
        ? await createCampusPlace(payload)
        : await updateCampusPlace(selected!.placeId, payload);
      const wasCreate = isCreateMode;
      enterEditMode(saved);
      await loadPlaces(filters);
      setFeedback({
        tone: "success",
        title: wasCreate ? "캠퍼스맵 장소를 등록했습니다." : "장소 정보를 수정했습니다.",
        message: wasCreate
          ? "새 장소가 목록에 반영되었습니다."
          : "변경한 전체 장소 정보가 저장되었습니다.",
      });
    } catch (error) {
      setFeedback({
        tone: "error",
        title: isCreateMode ? "캠퍼스맵 장소를 등록하지 못했습니다." : "장소 정보를 저장하지 못했습니다.",
        message: getCampusMapErrorText(error),
      });
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  async function deletePlace() {
    if (!selected || mutationInProgress.current) return;
    const placeName = selected.placeName;
    mutationInProgress.current = true;
    setBusyAction("delete");
    setFeedback(null);
    try {
      await deleteCampusPlace(selected.placeId);
      setDeleteOpen(false);
      enterCreateMode();
      await loadPlaces(filters);
      setFeedback({
        tone: "success",
        title: `${placeName} 장소를 삭제했습니다.`,
        message: "장소가 캠퍼스맵 목록에서 삭제되었습니다.",
      });
    } catch (error) {
      setDeleteOpen(false);
      setFeedback({
        tone: "error",
        title: "장소를 삭제하지 못했습니다.",
        message: getCampusMapErrorText(error),
      });
    } finally {
      mutationInProgress.current = false;
      setBusyAction("");
    }
  }

  const listCountLabel = listState === "ready" || places.length > 0 ? `${places.length}곳` : "-";
  const editorHeading = isCreateMode ? "새 장소 등록" : "선택한 장소 전체 수정";
  const categoryIsLectureBuilding = form.category === "LECTURE_BUILDING";

  return (
    <AdminLoginNotice returnTo="/campus-map/manage">
      <UnsavedChangesDialog dirty={isDirty} />

      <div className={styles.page}>
        <header className={styles.pageHeader}>
          <div>
            <h2>캠퍼스맵 관리</h2>
            <p>캠퍼스의 음식점, 카페, 강의실과 편의시설 위치를 등록하고 수정합니다.</p>
          </div>
          <div className={styles.pageActions}>
            <button
              className={`${styles.button} ${styles.secondaryButton}`}
              type="button"
              onClick={requestRefresh}
              disabled={isBusy || listState === "loading"}
            >
              <ArrowClockwise size={17} aria-hidden="true" />
              {listState === "loading" ? "불러오는 중" : "새로고침"}
            </button>
            <button
              className={`${styles.button} ${styles.primaryButton}`}
              type="button"
              onClick={requestCreateMode}
              disabled={isBusy}
            >
              <Plus size={17} aria-hidden="true" />
              새 장소
            </button>
          </div>
        </header>

        {feedback && (
          <div
            className={`${styles.feedback} ${styles[`${feedback.tone}Feedback`]}`}
            role={feedback.tone === "error" ? "alert" : "status"}
            aria-live="polite"
          >
            {feedback.tone === "success"
              ? <CheckCircle size={20} weight="fill" aria-hidden="true" />
              : <WarningCircle size={20} weight="fill" aria-hidden="true" />}
            <div>
              <strong>{feedback.title}</strong>
              <p>{feedback.message}</p>
            </div>
            <button type="button" aria-label="안내 닫기" onClick={() => setFeedback(null)}>
              <X size={17} aria-hidden="true" />
            </button>
          </div>
        )}

        <div className={styles.workspace}>
          <aside className={`${styles.panel} ${styles.listPanel}`} aria-labelledby="campus-map-list-title">
            <header className={styles.panelHeader}>
              <div>
                <span className={styles.panelIcon} aria-hidden="true"><MapTrifold size={20} /></span>
                <div>
                  <h3 id="campus-map-list-title">장소 목록</h3>
                  <p>장소를 선택하면 상세 정보를 불러옵니다.</p>
                </div>
              </div>
              <span className={styles.countBadge} aria-label={`조회한 장소 ${listCountLabel}`}>{listCountLabel}</span>
            </header>

            <div className={styles.listControls}>
              <label className={`${styles.controlField} ${styles.searchField}`} htmlFor="campus-map-search">
                <span>장소 검색</span>
                <span className={styles.searchInput}>
                  <MagnifyingGlass size={16} aria-hidden="true" />
                  <input
                    id="campus-map-search"
                    type="search"
                    value={searchQuery}
                    placeholder="장소 이름 또는 설명 검색"
                    onChange={(event) => setSearchQuery(event.target.value)}
                    disabled={listState === "loading"}
                  />
                </span>
              </label>
              <div className={styles.filterGrid}>
                <label className={styles.controlField} htmlFor="campus-map-campus-filter">
                  <span>캠퍼스</span>
                  <select
                    id="campus-map-campus-filter"
                    value={campusFilter}
                    onChange={(event) => requestFilters({
                      campusFilter: event.target.value as CampusFilter,
                      categoryFilter,
                    })}
                    disabled={isBusy || listState === "loading"}
                  >
                    <option value="ALL">전체 캠퍼스</option>
                    {campusOptions.map((option) => (
                      <option value={option.value} key={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.controlField} htmlFor="campus-map-category-filter">
                  <span>카테고리</span>
                  <select
                    id="campus-map-category-filter"
                    value={categoryFilter}
                    onChange={(event) => requestFilters({
                      campusFilter,
                      categoryFilter: event.target.value as CategoryFilter,
                    })}
                    disabled={isBusy || listState === "loading"}
                  >
                    <option value="ALL">전체 카테고리</option>
                    {categoryOptions.map((option) => (
                      <option value={option.value} key={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              </div>
            </div>

            {listState === "error" && places.length > 0 && (
              <div className={styles.inlineError} role="alert">
                <WarningCircle size={18} aria-hidden="true" />
                <span>{listErrorMessage}</span>
                <button type="button" onClick={() => void loadPlaces(filters)}>다시 시도</button>
              </div>
            )}

            <div className={styles.listBody} aria-live="polite" aria-busy={listState === "loading" || undefined}>
              {(listState === "idle" || listState === "loading") && places.length === 0 ? (
                <ListLoadingState />
              ) : listState === "error" && places.length === 0 ? (
                <div className={styles.statePanel} role="alert">
                  <WarningCircle size={28} aria-hidden="true" />
                  <strong>장소 목록을 불러오지 못했습니다.</strong>
                  <p>{listErrorMessage}</p>
                  <button
                    className={`${styles.button} ${styles.secondaryButton}`}
                    type="button"
                    onClick={() => void loadPlaces(filters)}
                  >
                    다시 시도
                  </button>
                </div>
              ) : places.length === 0 ? (
                <div className={styles.statePanel}>
                  <MapPin size={28} aria-hidden="true" />
                  <strong>조건에 맞는 장소가 없습니다.</strong>
                  <p>필터를 바꾸거나 첫 장소를 등록해 주세요.</p>
                  <button
                    className={`${styles.button} ${styles.primaryButton}`}
                    type="button"
                    onClick={requestCreateMode}
                  >
                    <Plus size={16} aria-hidden="true" /> 새 장소
                  </button>
                </div>
              ) : visiblePlaces.length === 0 ? (
                <div className={styles.statePanel}>
                  <MagnifyingGlass size={28} aria-hidden="true" />
                  <strong>검색 결과가 없습니다.</strong>
                  <p>장소 이름이나 설명을 다른 단어로 검색해 주세요.</p>
                </div>
              ) : (
                <ol className={styles.placeList}>
                  {visiblePlaces.map((place) => (
                    <li key={place.placeId}>
                      <button
                        className={`${styles.placeItem} ${selected?.placeId === place.placeId ? styles.activePlaceItem : ""}`}
                        type="button"
                        aria-pressed={selected?.placeId === place.placeId}
                        onClick={() => requestSelection(place)}
                        disabled={isBusy}
                      >
                        <span className={styles.placeThumbnail} aria-hidden="true">
                          {place.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={place.imageUrl} alt="" loading="lazy" />
                          ) : <MapPin size={19} />}
                        </span>
                        <span className={styles.placeCopy}>
                          <span className={styles.placeMeta}>
                            {optionLabel(campusOptions, place.campusCode)}
                            <span aria-hidden="true">/</span>
                            {place.categoryName || optionLabel(categoryOptions, place.category)}
                          </span>
                          <strong>{place.placeName}</strong>
                          <small>{place.oneLineDescription}</small>
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </aside>

          <div className={styles.editorStack} ref={editorRef}>
            {!isCreateMode && detailState === "loading" ? (
              <section className={`${styles.panel} ${styles.detailState}`} role="status">
                <div className={styles.detailSkeleton} aria-hidden="true">
                  <span /><span /><span /><span />
                </div>
                <span className={styles.visuallyHidden}>선택한 장소의 상세 정보를 불러오고 있습니다.</span>
              </section>
            ) : !isCreateMode && detailState === "error" ? (
              <section className={`${styles.panel} ${styles.detailState}`} role="alert">
                <WarningCircle size={31} aria-hidden="true" />
                <strong>장소 상세 정보를 불러오지 못했습니다.</strong>
                <p>{detailErrorMessage}</p>
                <button
                  className={`${styles.button} ${styles.secondaryButton}`}
                  type="button"
                  onClick={() => selected && void loadPlaceDetail(selected, false)}
                >
                  다시 시도
                </button>
              </section>
            ) : (
              <form className={`${styles.panel} ${styles.editorPanel}`} onSubmit={submitPlace} noValidate>
                <header className={styles.editorHeader}>
                  <div>
                    <span className={styles.modeLabel}>{isCreateMode ? "등록" : "수정"}</span>
                    <h3>{editorHeading}</h3>
                    <p>{isCreateMode
                      ? "필수 정보와 대표 사진을 준비한 뒤 장소를 등록해 주세요."
                      : "상세 조회로 불러온 기존 정보를 빠짐없이 수정합니다."}</p>
                  </div>
                  {isDirty && <span className={styles.unsavedBadge}>저장 전 변경</span>}
                </header>

                <fieldset className={styles.formFieldset} disabled={isBusy}>
                  <section className={styles.formSection} aria-labelledby="campus-map-basic-heading">
                    <div className={styles.sectionHeading}>
                      <span className={styles.sectionIcon} aria-hidden="true"><MapPin size={19} /></span>
                      <div>
                        <h4 id="campus-map-basic-heading">기본 정보</h4>
                        <p>지도에 표시할 이름, 분류와 좌표를 입력합니다.</p>
                      </div>
                    </div>

                    <div className={styles.formGrid}>
                      <label className={styles.field} htmlFor="campus-map-campusCode">
                        <span className={styles.fieldHeading}><span>캠퍼스 <em>필수</em></span></span>
                        <select
                          id="campus-map-campusCode"
                          value={form.campusCode}
                          onChange={(event) => setField("campusCode", event.target.value as CampusCode)}
                          required
                        >
                          {campusOptions.map((option) => (
                            <option value={option.value} key={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>

                      <label className={styles.field} htmlFor="campus-map-category">
                        <span className={styles.fieldHeading}><span>카테고리 <em>필수</em></span></span>
                        <select
                          id="campus-map-category"
                          value={form.category}
                          onChange={(event) => changeCategory(event.target.value as CampusPlaceCategory)}
                          required
                        >
                          {categoryOptions.map((option) => (
                            <option value={option.value} key={option.value}>{option.label}</option>
                          ))}
                        </select>
                      </label>

                      <label className={`${styles.field} ${styles.fullSpan}`} htmlFor="campus-map-placeName">
                        <span className={styles.fieldHeading}>
                          <span>장소 이름 <em>필수</em></span>
                          <small>{form.placeName.length} / {TEXT_LIMIT}</small>
                        </span>
                        <input
                          id="campus-map-placeName"
                          type="text"
                          value={form.placeName}
                          maxLength={TEXT_LIMIT}
                          placeholder="예: 한서대학교 본관"
                          aria-invalid={Boolean(fieldErrors.placeName) || undefined}
                          aria-describedby={`campus-map-placeName-help${fieldErrors.placeName ? " campus-map-placeName-error" : ""}`}
                          onChange={(event) => setField("placeName", event.target.value)}
                          required
                        />
                        <small id="campus-map-placeName-help" className={styles.fieldHelp}>이용자가 지도에서 확인할 공식 장소 이름을 입력해 주세요.</small>
                        {fieldErrors.placeName && <small id="campus-map-placeName-error" className={styles.fieldError} role="alert">{fieldErrors.placeName}</small>}
                      </label>

                      <label className={`${styles.field} ${styles.fullSpan}`} htmlFor="campus-map-oneLineDescription">
                        <span className={styles.fieldHeading}>
                          <span>한 줄 설명 <em>필수</em></span>
                          <small>{form.oneLineDescription.length} / {TEXT_LIMIT}</small>
                        </span>
                        <input
                          id="campus-map-oneLineDescription"
                          type="text"
                          value={form.oneLineDescription}
                          maxLength={TEXT_LIMIT}
                          placeholder="예: 학생지원 부서와 행정실이 있는 건물"
                          aria-invalid={Boolean(fieldErrors.oneLineDescription) || undefined}
                          aria-describedby={`campus-map-oneLineDescription-help${fieldErrors.oneLineDescription ? " campus-map-oneLineDescription-error" : ""}`}
                          onChange={(event) => setField("oneLineDescription", event.target.value)}
                          required
                        />
                        <small id="campus-map-oneLineDescription-help" className={styles.fieldHelp}>장소 목록에서 이름과 함께 표시되는 짧은 설명입니다.</small>
                        {fieldErrors.oneLineDescription && <small id="campus-map-oneLineDescription-error" className={styles.fieldError} role="alert">{fieldErrors.oneLineDescription}</small>}
                      </label>

                      <label className={styles.field} htmlFor="campus-map-latitude">
                        <span className={styles.fieldHeading}><span>위도 <em>필수</em></span></span>
                        <input
                          id="campus-map-latitude"
                          type="number"
                          inputMode="decimal"
                          value={form.latitude}
                          min={-90}
                          max={90}
                          step="0.000000001"
                          placeholder="36.691234567"
                          aria-invalid={Boolean(fieldErrors.latitude) || undefined}
                          aria-describedby={`campus-map-latitude-help${fieldErrors.latitude ? " campus-map-latitude-error" : ""}`}
                          onChange={(event) => setField("latitude", event.target.value)}
                          required
                        />
                        <small id="campus-map-latitude-help" className={styles.fieldHelp}>-90부터 90, 소수점 아래 9자리까지</small>
                        {fieldErrors.latitude && <small id="campus-map-latitude-error" className={styles.fieldError} role="alert">{fieldErrors.latitude}</small>}
                      </label>

                      <label className={styles.field} htmlFor="campus-map-longitude">
                        <span className={styles.fieldHeading}><span>경도 <em>필수</em></span></span>
                        <input
                          id="campus-map-longitude"
                          type="number"
                          inputMode="decimal"
                          value={form.longitude}
                          min={-180}
                          max={180}
                          step="0.000000001"
                          placeholder="126.584123456"
                          aria-invalid={Boolean(fieldErrors.longitude) || undefined}
                          aria-describedby={`campus-map-longitude-help${fieldErrors.longitude ? " campus-map-longitude-error" : ""}`}
                          onChange={(event) => setField("longitude", event.target.value)}
                          required
                        />
                        <small id="campus-map-longitude-help" className={styles.fieldHelp}>-180부터 180, 소수점 아래 9자리까지</small>
                        {fieldErrors.longitude && <small id="campus-map-longitude-error" className={styles.fieldError} role="alert">{fieldErrors.longitude}</small>}
                      </label>
                    </div>
                  </section>

                  <section className={styles.formSection} aria-labelledby="campus-map-location-heading">
                    <div className={styles.sectionHeading}>
                      <span className={styles.sectionIcon} aria-hidden="true"><Buildings size={19} /></span>
                      <div>
                        <h4 id="campus-map-location-heading">{categoryIsLectureBuilding ? "강의실 건물 정보" : "장소 주소"}</h4>
                        <p>{categoryIsLectureBuilding
                          ? "강의실 카테고리에는 주소 대신 건물 상세 정보를 입력합니다."
                          : "이용자가 찾아갈 수 있는 주소를 입력합니다."}</p>
                      </div>
                    </div>

                    {!categoryIsLectureBuilding ? (
                      <div className={styles.formGrid}>
                        <label className={`${styles.field} ${styles.fullSpan}`} htmlFor="campus-map-address">
                          <span className={styles.fieldHeading}>
                            <span>주소 <em>필수</em></span>
                            <small>{form.address.length} / {TEXT_LIMIT}</small>
                          </span>
                          <input
                            id="campus-map-address"
                            type="text"
                            value={form.address}
                            maxLength={TEXT_LIMIT}
                            placeholder="예: 충청남도 서산시 해미면 한서1로 46"
                            aria-invalid={Boolean(fieldErrors.address) || undefined}
                            aria-describedby={`campus-map-address-help${fieldErrors.address ? " campus-map-address-error" : ""}`}
                            onChange={(event) => setField("address", event.target.value)}
                            required
                          />
                          <small id="campus-map-address-help" className={styles.fieldHelp}>강의실이 아닌 장소는 주소가 반드시 필요합니다.</small>
                          {fieldErrors.address && <small id="campus-map-address-error" className={styles.fieldError} role="alert">{fieldErrors.address}</small>}
                        </label>
                      </div>
                    ) : (
                      <div className={styles.lectureFields}>
                        <div className={styles.formGrid}>
                          <label className={styles.field} htmlFor="campus-map-location">
                            <span className={styles.fieldHeading}>
                              <span>건물 위치 <em>필수</em></span>
                              <small>{form.location.length} / {TEXT_LIMIT}</small>
                            </span>
                            <input
                              id="campus-map-location"
                              type="text"
                              value={form.location}
                              maxLength={TEXT_LIMIT}
                              placeholder="예: 정문에서 도보 3분"
                              aria-invalid={Boolean(fieldErrors.location) || undefined}
                              aria-describedby={fieldErrors.location ? "campus-map-location-error" : undefined}
                              onChange={(event) => setField("location", event.target.value)}
                              required
                            />
                            {fieldErrors.location && <small id="campus-map-location-error" className={styles.fieldError} role="alert">{fieldErrors.location}</small>}
                          </label>

                          <label className={styles.field} htmlFor="campus-map-floorCount">
                            <span className={styles.fieldHeading}><span>층수 <em>필수</em></span></span>
                            <input
                              id="campus-map-floorCount"
                              type="number"
                              inputMode="decimal"
                              value={form.floorCount}
                              min={1}
                              step="any"
                              placeholder="예: 5"
                              aria-invalid={Boolean(fieldErrors.floorCount) || undefined}
                              aria-describedby={fieldErrors.floorCount ? "campus-map-floorCount-error" : undefined}
                              onChange={(event) => setField("floorCount", event.target.value)}
                              required
                            />
                            {fieldErrors.floorCount && <small id="campus-map-floorCount-error" className={styles.fieldError} role="alert">{fieldErrors.floorCount}</small>}
                          </label>

                          <label className={styles.field} htmlFor="campus-map-hasElevator">
                            <span className={styles.fieldHeading}><span>엘리베이터 <em>필수</em></span></span>
                            <select
                              id="campus-map-hasElevator"
                              value={form.hasElevator ? "true" : "false"}
                              onChange={(event) => setField("hasElevator", event.target.value === "true")}
                            >
                              <option value="true">있음</option>
                              <option value="false">없음</option>
                            </select>
                          </label>

                        </div>

                        {([
                          ["majorFacilities", "주요 시설", "예: 대형 강의실"],
                        ] as const).map(([key, label, placeholder]) => (
                          <div className={styles.repeatField} key={key}>
                            <div className={styles.repeatHeading}>
                              <div>
                                <strong>{label} <em>필수</em></strong>
                                <span>1개 이상, 최대 {ARRAY_LIMIT}개</span>
                              </div>
                              <button
                                className={`${styles.button} ${styles.secondaryButton} ${styles.smallButton}`}
                                type="button"
                                onClick={() => addListItem(key)}
                                disabled={form[key].length >= ARRAY_LIMIT}
                              >
                                <Plus size={15} aria-hidden="true" /> 항목 추가
                              </button>
                            </div>
                            <div
                              className={styles.repeatRows}
                              aria-describedby={fieldErrors[key] ? `campus-map-${key}-error` : undefined}
                            >
                              {form[key].map((value, index) => (
                                <div className={styles.repeatRow} key={`${key}-${index}`}>
                                  <label htmlFor={`campus-map-${key}-${index}`}>
                                    <span className={styles.visuallyHidden}>{label} {index + 1}</span>
                                    <input
                                      id={`campus-map-${key}-${index}`}
                                      type="text"
                                      value={value}
                                      maxLength={TEXT_LIMIT}
                                      placeholder={placeholder}
                                      aria-invalid={Boolean(fieldErrors[key]) || undefined}
                                      aria-describedby={fieldErrors[key] ? `campus-map-${key}-error` : undefined}
                                      onChange={(event) => changeListItem(key, index, event.target.value)}
                                      required
                                    />
                                  </label>
                                  <span className={styles.rowCount}>{value.length} / {TEXT_LIMIT}</span>
                                  <button
                                    className={styles.removeRowButton}
                                    type="button"
                                    aria-label={`${label} ${index + 1} 삭제`}
                                    onClick={() => removeListItem(key, index)}
                                    disabled={form[key].length <= 1}
                                  >
                                    <Trash size={16} aria-hidden="true" />
                                  </button>
                                </div>
                              ))}
                            </div>
                            {fieldErrors[key] && <small id={`campus-map-${key}-error`} className={styles.fieldError} role="alert">{fieldErrors[key]}</small>}
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  <section className={styles.formSection} aria-labelledby="campus-map-image-heading">
                    <div className={styles.sectionHeading}>
                      <span className={styles.sectionIcon} aria-hidden="true"><ImageSquare size={19} /></span>
                      <div>
                        <h4 id="campus-map-image-heading">대표 사진</h4>
                        <p>사진을 먼저 업로드한 뒤 장소 정보를 저장해야 최종 반영됩니다.</p>
                      </div>
                    </div>

                    <div className={`${styles.imageCard} ${fieldErrors.imageUrl ? styles.invalidImageCard : ""}`}>
                      <div className={styles.imagePreview}>
                        <PlaceImage
                          file={imageFile}
                          imageUrl={form.imageUrl}
                          alt={`${form.placeName || "캠퍼스맵 장소"} 대표 사진`}
                        />
                        {imageFile && <span className={styles.pendingImageBadge}>업로드 전</span>}
                      </div>
                      <div className={styles.imageControls}>
                        <div>
                          <strong>{imageFile ? imageFile.name : form.imageUrl ? "업로드된 대표 사진" : "대표 사진 선택 필요"}</strong>
                          <p>{imageFile
                            ? `${formatFileSize(imageFile.size)} · 업로드 버튼을 눌러 주세요.`
                            : "JPG, JPEG, PNG, GIF · 최대 5MB"}</p>
                        </div>
                        <div className={styles.imageActions}>
                          <label className={`${styles.button} ${styles.secondaryButton} ${styles.fileButton}`}>
                            <ImageSquare size={16} aria-hidden="true" />
                            사진 선택
                            <input
                              ref={imageInputRef}
                              id="campus-map-imageUrl"
                              type="file"
                              accept={CAMPUS_MAP_IMAGE_ACCEPT}
                              aria-invalid={Boolean(fieldErrors.imageUrl) || undefined}
                              aria-describedby={`campus-map-image-help${fieldErrors.imageUrl ? " campus-map-image-error" : ""}`}
                              onChange={(event) => {
                                chooseImage(event.currentTarget.files?.[0] ?? null);
                                event.currentTarget.value = "";
                              }}
                            />
                          </label>
                          <button
                            className={`${styles.button} ${styles.primaryButton}`}
                            type="button"
                            onClick={() => void uploadImage()}
                            disabled={!imageFile || isBusy}
                          >
                            <UploadSimple size={16} aria-hidden="true" />
                            {busyAction === "image" ? "업로드 중" : "사진 업로드"}
                          </button>
                          {imageFile && (
                            <button
                              className={styles.cancelImageButton}
                              type="button"
                              onClick={() => {
                                setImageFile(null);
                                resetImageInput();
                                setFeedback(null);
                              }}
                            >
                              선택 취소
                            </button>
                          )}
                        </div>
                        <small id="campus-map-image-help" className={styles.fieldHelp}>사진 업로드 후에도 아래의 장소 등록 또는 변경 저장을 눌러야 합니다.</small>
                        {fieldErrors.imageUrl && <small id="campus-map-image-error" className={styles.fieldError} role="alert">{fieldErrors.imageUrl}</small>}
                      </div>
                    </div>
                  </section>
                </fieldset>

                <div className={styles.formActions}>
                  {!isCreateMode && (
                    <button
                      className={`${styles.button} ${styles.dangerButton}`}
                      type="button"
                      onClick={() => setDeleteOpen(true)}
                      disabled={isBusy}
                    >
                      <Trash size={17} aria-hidden="true" /> 장소 삭제
                    </button>
                  )}
                  <span className={styles.actionSpacer} />
                  <button
                    className={`${styles.button} ${styles.secondaryButton}`}
                    type="button"
                    onClick={resetForm}
                    disabled={isBusy || !isDirty}
                  >
                    {isCreateMode ? "입력 지우기" : "변경 되돌리기"}
                  </button>
                  <button
                    className={`${styles.button} ${styles.primaryButton}`}
                    type="submit"
                    disabled={isBusy || (!isCreateMode && !isDirty)}
                  >
                    {busyAction === "create"
                      ? "등록하는 중"
                      : busyAction === "update"
                        ? "저장하는 중"
                        : isCreateMode
                          ? "장소 등록"
                          : "변경 저장"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>

        <ConfirmDialog
          open={deleteOpen}
          title={`“${selected?.placeName ?? "선택한 장소"}” 장소를 삭제할까요?`}
          description="삭제한 장소 정보는 되돌릴 수 없습니다. 업로드한 사진 파일은 별도로 보관될 수 있습니다."
          confirmLabel="장소 삭제"
          danger
          busy={busyAction === "delete"}
          onCancel={() => {
            if (!isBusy) setDeleteOpen(false);
          }}
          onConfirm={() => void deletePlace()}
        />

        <ConfirmDialog
          open={Boolean(pendingAction)}
          title="저장하지 않은 변경 내용을 버릴까요?"
          description="계속하면 입력한 정보와 아직 반영하지 않은 대표 사진 변경이 사라집니다."
          confirmLabel="변경 내용 버리기"
          danger
          onCancel={() => setPendingAction(null)}
          onConfirm={confirmPendingAction}
        />
      </div>
    </AdminLoginNotice>
  );
}
