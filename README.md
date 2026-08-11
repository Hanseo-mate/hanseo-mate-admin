# 한서메이트 관리자

학생회 공지, 동아리, 전공·교양 시간표를 관리하는 한서메이트 운영 콘솔입니다.

## 화면

- `/` 대시보드
- `/notices/new` 학생회 공지 등록
- `/notices/manage` 공지 ID 기준 수정·삭제
- `/clubs/new` 동아리 기본 등록
- `/clubs/manage` 동아리 소개·이미지·삭제 통합 관리
- `/courses/major` 전공 Excel 업로드
- `/courses/general` 교양 Excel 업로드

공지와 동아리 관리자 API에는 목록·상세 GET 명세가 없어서 수정 화면은 서버 ID와 현재 값을 직접 입력하는 방식입니다.

## 실행

```bash
npm install
npm run dev
```

API 기본 주소는 `http://34.64.250.12:8080`이며 `.env.local`에서 바꿀 수 있습니다.

```bash
NEXT_PUBLIC_API_BASE_URL=https://api.example.com
```

## 검증과 배포

```bash
npm run lint
npm run build
node --test tests/rendered-html.test.mjs
npm run deploy:firebase
```

Firebase 프로젝트와 Hosting 사이트 ID는 `hsmate-admin`입니다.

## 운영 전 필수 조치

Firebase Hosting은 HTTPS이므로 현재 HTTP API를 브라우저에서 직접 호출할 수 없습니다. 실제 CRUD 운영 전 다음 항목이 필요합니다.

1. API HTTPS 적용 또는 인증된 동일 출처 프록시 구성
2. Firebase Hosting 도메인 CORS 허용
3. 서버 측 관리자 인증과 권한 검사

현재 배포본은 HTTPS 페이지에서 HTTP API 요청을 감지하면 요청을 보내지 않고 운영자에게 설정 오류를 안내합니다.
