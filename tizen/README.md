# Readiz Music Tizen 실행기

웹 1.2.2 / 실행기 0.1.0. TV 프로젝트의 원격 포커스와 최상위 웹 탐색·종료 복귀 구조를 참고했다. `ReadizMU01.ReadizMusic` / package `ReadizMU01`은 음악 전용 고정 ID이며 기존 Readiz TV와 별도로 설치한다.

## 패키지와 배포

```sh
npm ci
npm test
npm run build:wgt
# 전체 웹과 WGT: npm run build
```

Python 표준 라이브러리만으로 6개 파일을 ZIP/WGT에 넣고 SHA-256을 만든다. Tizen SDK나 인증서는 빌드에 필요하지 않다. 출력은 다음과 같다.

- `dist/tizen/readiz-music-0.1.0-unsigned.wgt`
- `dist/app.wgt`, `dist/app.wgt.sha256`: 고정 다운로드 주소
- 배포 후 [WGT 다운로드](https://music.readiz.com/app.wgt), [체크섬](https://music.readiz.com/app.wgt.sha256)

TV 프로젝트에서 쓰는 Apps2Samsung Custom WGT 설치 흐름에 이 **미서명 WGT**를 넣고, 대상 TV의 Developer Mode와 기기 인증서로 서명·설치한다. 업데이트할 때 음악 앱 ID와 author 인증서를 유지한다. 이 저장소에 인증서·비밀번호를 넣지 않는다. 삼성 스토어 제출물은 아니며, hosted 앱의 스토어 배포는 [Samsung 정책](https://developer.samsung.com/smarttv/develop/faq/hosted-applications.html)을 별도로 확인해야 한다.

실행기는 `https://music.readiz.com/app-start.html?launcher=tizen`을 열고 웹앱은 `/?tv=1`로 이동한다. 웹 화면 변경은 다음 실행 때 반영된다. WGT 아이콘·권한·실행기 변경은 새 WGT를 서명·재설치해야 한다. 네트워크 장애 시 실행기에 재시도 포커스를 표시한다. 웹 페이지에 Tizen API가 없으면 종료 확인 후 보관한 history 위치로 돌아가 로컬 실행기의 종료 API를 호출한다.

## 리모컨

- 방향키: 앨범·재생 버튼·곡 목록 이동. 곡 목록 위·아래는 화면에 보이는 순서로 한 곡씩 이동한다.
- 확인: 앨범 선택, 버튼 실행, 곡 재생. 길게 눌러도 반복 실행하지 않는다.
- 왼쪽: 곡 목록에서 마지막 앨범 위치로, 앨범 오른쪽 경계에서는 마지막 플레이어/곡으로 돌아간다.
- 탐색 막대: 확인으로 탐색 모드 → 좌우 5초 이동 → 확인/뒤로 완료. 일시정지 상태를 유지한다.
- 뒤로: 탐색 중에는 탐색 완료, 그 외에는 한 번에 종료 확인. 기본 선택은 계속 듣기이며 팝업을 여는 동안 음악은 계속 재생된다. 팝업에서 뒤로/계속 듣기는 직전 포커스로 복귀한다.
- 재생/일시정지/정지, 이전/다음 곡, 빨리감기/되감기(10초): 기기가 전달하는 미디어 키를 연결한다.

TV에서는 앨범을 항상 열어 두고 상단 앨범 접기·종료 버튼을 표시하지 않는다. 처음에는 재생 버튼에 포커스를 두며, 곡 목록 맨 위에서 위로 이동하면 마지막 컨트롤로 돌아간다. 컨트롤에서 위쪽 키를 계속 눌러도 그 행에 머문다. 재생 곡 변경이 TV 곡 목록의 스크롤을 옮기지 않는다.

브라우저에서도 [TV 화면](https://music.readiz.com/?tv=1)을 볼 수 있다. TV UA는 자동 감지한다. 삼성 기본 브라우저와 설치 앱의 키 전달 방식은 다를 수 있다. [Samsung 리모컨 문서](https://developer.samsung.com/smarttv/develop/guides/user-interaction/remote-control.html).

## 지원 범위와 확인

Tizen 5.0 이상을 선언하고 JavaScript는 Chromium 63 대상으로 변환한다. TV에서도 웹과 같은 파형을 표시한다. 파형을 불러오는 동안에도 native audio와 탐색 막대로 재생·탐색할 수 있다. 오래된 엔진의 DOM `replaceChildren`, CSS `aspect-ratio`, flex gap에 TV 화면이 의존하지 않도록 했다. [Samsung 엔진 표](https://developer.samsung.com/smarttv/develop/specifications/web-engine-specifications.html).

```sh
npm run dev
# 별도 터미널에서 종료 복귀 fixture:
node scripts/preview-tizen.mjs
# 4523 페이지: Playwright CLI run-code에 scripts/verify-tv.js 전달
# 4524 페이지: Playwright CLI run-code에 scripts/verify-tizen.js 전달
```

브라우저 검증은 1280×720 / 1920×1080 포커스, 스크롤, 앨범 기억, 종료 취소, 실제 음원 재생·탐색, 모바일 레이아웃과 API가 없는 원격 페이지에서 로컬 실행기로 돌아오는 경로를 다룬다. Tizen UA와 없는 API를 모의하는 Chrome 검증은 **구형 Chromium 또는 실제 TV 검증이 아니다**.

실기기에서 남은 확인: 서명·설치, 홈 아이콘, 콜드 부팅, 리모컨 키 전달, OGG/MP3/M4A별 재생·탐색, 곡 자동 전환, 네트워크 재시도, 종료/재실행. TV를 끄거나 홈으로 나간 뒤의 백그라운드 음악 재생은 현재 보장하지 않는다.
