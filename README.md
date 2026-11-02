# CareBridge · 케어브릿지

**서울대학교 산업공학과 「헬스케어 서비스 혁신」 수업 팀 프로젝트**

CareBridge는 비응급 전원·회송 결정 이후부터 수용기관의 첫 진료 회신과 의뢰기관 확인까지 시연하는 서비스 프로토타입입니다. 기관 탐색·수용 문의·정보 보완 과정의 반복 업무를 줄이고, 환자·보호자와 의료기관 사이의 연계를 지원하는 흐름을 설계했습니다.

Course project for Healthcare Service Innovation, Department of Industrial Engineering, Seoul National University.

**[프로토타입 체험하기](https://carebridge-prototype-gilt.vercel.app)**

## 실행

Node.js 22 이상. `npm run dev`로 실행한 뒤 http://127.0.0.1:4175 를 엽니다. 기본 시연·공개 기관 검색·경로 API는 별도 키 없이 동작합니다. 실제 AI 분석에는 활성화된 Vercel AI Gateway 계정과 서버 인증이 필요합니다.

`npm test`는 상태 전환·동의·역할·예외·HTTP API·배포 진입점을 검사합니다. `npm run build`는 정적 화면을 public/에 생성합니다.

## 시연 흐름

1. 의뢰기관에서 담당의 회송 결정을 확인하고 회송 정보를 점검합니다.
2. 환자·보호자가 선호 조건을 선택하고 기관 문의에 동의합니다.
3. 문의 생성·모의 기관 응답 수집·수용 확인 후보 공개가 자동 진행됩니다.
4. 환자가 기관을 비교·선택하고 해당 기관에 대한 정보 제공에 동의합니다.
5. 의뢰기관이 서류·이동 일정·환자 안내를 확인합니다.
6. 선택한 수용기관이 첫 진료 이행 여부를 회신합니다.
7. 의뢰기관이 회신을 확인해야 연계가 완료됩니다. 미이행은 재연계합니다.

정보 누락·수용 불가·동의 철회·추가 정보 요청·미이행 경로도 시연할 수 있습니다.

## 배포

GitHub에는 소스를 보관하고 Vercel에서 화면과 API를 함께 실행합니다. Vercel 설정은 framework Other, build command `npm run build`, output directory `public`, Node.js 22입니다. GitHub 자동 배포는 연결되어 있지 않으며 배포 소스를 직접 업로드합니다.

AI 분석은 요청별 `x-vercel-oidc-token` 또는 서버의 `AI_GATEWAY_API_KEY`를 사용합니다. 인증 정보를 브라우저에 노출하지 않습니다. AI Gateway 계정 승인·크레딧이 없으면 실제 분석을 완료한 것처럼 표시하지 않고 기본 항목 점검을 별도로 제공합니다. 2026-11-02 확인 당시 Gateway가 HTTP 403을 반환하여 계정 활성화 확인이 필요했습니다.

- `web/`: 화면과 합성 데이터 모델
- `worker/api.mjs`: 공통 Request/Response API
- `worker/integrations.mjs`: 실제 AI 문서 분석·공개 의료기관 검색
- `api/`: Vercel 서버 함수 진입점
- `public/`: 생성된 정적 파일 (Git 제외)
- `tests/`: 자동 테스트

## 시연 데이터와 한계

실제 환자 정보를 입력하지 마세요. 회송 시연의 환자·기관·처방·비용·수용 응답은 가상입니다. 기관별로 서로 다른 AI 생성 사진 5장을 사용하며 실제 병원 시설·품질을 나타내지 않습니다. 공개 기관 검색 화면의 이름·위치는 실제 OpenStreetMap 등록 정보이며 시연용 수용 문의에 사용되지 않습니다. 실제 병상·처치 역량·수용 여부는 확인되지 않습니다.

기관 응답은 모의 커넥터이며 EMR/HIRA/병상/예약/문자에 연결하지 않습니다. AI 분석은 준비된 합성 문서 두 종류만 허용하며 임의의 실제 문서나 프롬프트를 외부로 전송하지 않습니다. 실제 모델 응답을 원문과 대조하고, 미기재 항목을 추정한 결과는 거절합니다. 편집한 합성 문서는 규칙 기반 기본 점검으로 처리합니다.

서버 API는 문서의 입력 항목과 상태 전환 조건을 점검합니다. OSRM API는 고정 가상 좌표의 경로를 실제 조회하며 실시간 교통은 반영하지 않습니다. 진행 상태는 현재 브라우저에만 저장하고 서버에 보관하지 않습니다. 여러 사용자 간 동기화·의료용 로그인·임상 적합성 판단은 구현하지 않았습니다.

## 사진·경로 출처

시설 사진은 OpenAI image_gen으로 생성했습니다. 새봄: 대기 공간, 솔빛: 재활 운동실, 다온: 병원 외관, 봄길: 회복 병실, 해온: 처치 준비 공간. 생성 지시에는 인물·문자·로고·실제 기관 표시를 제외하고 비미래적인 한국 병원 환경, 자연광을 요청했습니다. 생성된 원본은 별도로 보존하며 배포용 JPEG만 web/assets에 포함합니다.

OSRM / © OpenStreetMap contributors. API 문서: https://project-osrm.org/docs/v5.24.0/api/ . 공개 데모 서버는 가용성을 보장하지 않으며 장애 시 조회 실패로 표시합니다.

공개 기관 검색: OpenStreetMap / Nominatim. [이용 정책](https://operations.osmfoundation.org/policies/nominatim/). 세 지역의 제한된 사용자 요청만 처리하고 자동완성·주기적 수집은 하지 않습니다. 애플리케이션 식별 헤더, 함수 내 1.1초 호출 간격, 6시간 메모리·배포 CDN 캐시를 적용합니다. 소규모 수업 시연용으로 사용하며 대규모 공개 운영 전에 전용 제공자와 전역 호출 제한이 필요합니다. 서버 환경 변수 `HOSPITAL_DIRECTORY_API_URL`로 제공자를 교체할 수 있습니다.

AI API: [Vercel AI Gateway OIDC](https://vercel.com/docs/ai-gateway/authentication-and-byok/oidc), 모델 `openai/gpt-4.1-mini`. 준비된 합성 문서의 검증된 응답은 24시간 배포 CDN 캐시를 사용합니다. AI 분석은 처방의 적절성이나 임상 안전성을 검증하지 않습니다.
