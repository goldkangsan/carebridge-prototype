# CareBridge · 케어브릿지

**서울대학교 산업공학과 「헬스케어 서비스 혁신」 수업 팀 프로젝트**

CareBridge는 비응급 전원·회송 결정 이후부터 수용기관의 첫 진료 회신과 의뢰기관 확인까지 시연하는 서비스 프로토타입입니다. 기관 탐색·수용 문의·정보 보완 과정의 반복 업무를 줄이고, 환자·보호자와 의료기관 사이의 연계를 지원하는 흐름을 설계했습니다.

Course project for Healthcare Service Innovation, Department of Industrial Engineering, Seoul National University.

**[프로토타입 체험하기](https://carebridge-prototype-gilt.vercel.app)**

## 실행

Node.js 22 이상. 추가 라이브러리와 API 키 없이 `npm run dev`로 실행한 뒤 http://127.0.0.1:4175 를 엽니다.

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

GitHub에는 소스를 보관하고 Vercel에서 화면과 API를 함께 실행합니다. Vercel 설정은 framework Other, build command `npm run build`, output directory `public`, Node.js 22입니다. 외부 데이터베이스나 비밀 키는 필요하지 않습니다.

- `web/`: 화면과 합성 데이터 모델
- `worker/api.mjs`: 공통 Request/Response API
- `api/`: Vercel 서버 함수 진입점
- `public/`: 생성된 정적 파일 (Git 제외)
- `tests/`: 자동 테스트

## 시연 데이터와 한계

실제 환자 정보를 입력하지 마세요. 환자·기관·처방·비용·수용 응답은 가상입니다. 기관 응답은 모의 커넥터이며 EMR/HIRA/LLM/병상/예약/문자에 연결하지 않습니다. AI 생성 사진은 공통 환경 예시로, 실제 병원 사진이나 품질을 나타내지 않습니다.

서버 API는 문서의 입력 항목과 상태 전환 조건을 점검합니다. OSRM API는 고정 가상 좌표의 경로를 실제 조회하며 실시간 교통은 반영하지 않습니다. 진행 상태는 현재 브라우저에만 저장하고 서버에 보관하지 않습니다. 여러 사용자 간 동기화·의료용 로그인·임상 적합성 판단은 구현하지 않았습니다.

## 사진·경로 출처

시설 사진은 OpenAI image_gen으로 생성한 병원 대기 공간 예시입니다. 실제 의료기관과 관계없습니다.

OSRM / © OpenStreetMap contributors. API 문서: https://project-osrm.org/docs/v5.24.0/api/ . 공개 데모 서버는 가용성을 보장하지 않으며 장애 시 조회 실패로 표시합니다.
