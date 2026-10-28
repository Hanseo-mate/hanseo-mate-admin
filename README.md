# 한서메이트 관리자

학생회 공지, 시스템 공지, 일정, 버스 시간표, 캠퍼스맵, 홈 포스터, 앱 팝업, 앱 업데이트 정책, 동아리와 학사 자료를 관리하는 한서메이트 운영 콘솔입니다.

## 화면

- `/` 실제 운영 데이터 대시보드
- `/notices/manage` 학생회 공지 목록·상세·수정·삭제
- `/notices/new` 학생회 공지 등록
- `/system-notices/manage` 시스템 공지 조회·등록·수정·삭제
- `/calendars/manage` 학생회 일정 월간 조회·등록·수정·삭제
- `/bus-schedules/manage` 버스 시간표 조회·등록·교체
- `/campus-map/manage` 캠퍼스 장소 조회·등록·전체수정·삭제
- `/posters/manage` 홈 포스터 이미지·클릭 링크 등록·교체·삭제
- `/popups/manage` 앱 팝업 조회·등록·수정·삭제
- `/settings/festival-floating-button` 앱 홈의 대동제 플로팅 버튼 노출 제어
- `/settings/home-message` 전체 사용자에게 표시할 메인페이지 메시지 조회·저장·해제
- `/settings/links` 외부 링크 조회·등록·수정·삭제
- `/settings/app-updates` iOS·Android 스토어 앱 업데이트 정책 조회·초안·게시·예약·롤백·감사 이력
- `/clubs/manage` 동아리 목록·상세·소개·이미지 관리
- `/clubs/new` 동아리 기본 등록
- `/courses/major` 전공 강의시간표 Excel 업로드
- `/courses/general` 교양 강의시간표 Excel 업로드
- `/courses/equivalent` 동일교과목 Excel 업로드
- `/courses/cross-major` 타학과 전공인정 Excel 업로드

관리자 화면은 문서에 명시된 운영 API만 사용합니다. 전체 검색, 최근 관리자 활동, 업로드 이력, 차트처럼 서버가 제공하지 않는 데이터는 화면에 만들지 않습니다.

## 실행

```bash
npm install
npm run dev
```

API 기본 주소는 `https://api.hsmate.win`이며 `.env.local`에서 바꿀 수 있습니다.

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.hsmate.win
```

## 검증과 배포

```bash
npm run lint
npx tsc --noEmit --incremental false
npm run build
node --test tests/*.test.mjs
npm run deploy:firebase
```

Firebase 프로젝트와 Hosting 사이트 ID는 `hsmate-admin`입니다.

## 운영 전 확인 사항

운영 API는 HTTPS를 사용합니다. 실제 CRUD 운영 전 다음 항목을 확인합니다.

1. 운영 API에서 `https://hsmate-admin.web.app` Origin을 허용하고, 관리자 요청의 `Authorization` 및 `Content-Type` 헤더와 GET·POST·PUT·DELETE 메서드의 CORS 사전 요청을 허용
2. 서버 측 관리자 인증과 권한 검사
