# Readiz Music 운영

## 맥 라이브러리와 NAS 복구 (1.5.6)

- 공개 원점은 `https://music.readiz.com/`입니다. 맥 라이브러리는 `~/.local/share/readiz-music/library/current`이고 NAS 백업은 `/Volumes/readiz_private/cl_backup/readiz-music`입니다. `MUSIC_LIBRARY_ROOT`, `MUSIC_NAS_ROOT`, `MUSIC_NAS_MOUNT`로 경로를 지정할 수 있습니다.
- `npm run library:publish`는 체크아웃의 음원·목록·파형·곡명을 검사하고 기존 온라인 추가곡도 보존합니다. 음원은 SHA-256 객체로 한 번씩 저장하고, 작은 목록 스냅샷을 따로 보관합니다. 맥 공개 스냅샷은 객체를 하드 링크하므로 배포마다 전체 음원을 복제하지 않습니다.
- NAS가 실제로 마운트됐는지 확인한 뒤 모든 음원 크기·해시와 목록을 검증합니다. NAS가 끊겼을 때 같은 이름의 로컬 폴더에 백업하지 않습니다. 백업이 완료돼야 맥 `current`를 원자적으로 전환하며, 실패하면 기존 공개 목록을 유지합니다. 백업 객체와 과거 목록은 자동 삭제하지 않습니다.
- `npm run library:verify`는 현재 맥과 NAS 사본 전체의 크기·SHA-256·목록을 다시 검사합니다. `library-info.json`에는 현재 곡 수·용량·최근 백업 검증 시각만 공개하며 NAS 경로나 인증 정보는 포함하지 않습니다.
- 복구는 NAS를 연결하고 `npm run library:restore`를 실행합니다. 특정 목록으로 복구할 때는 `npm run library:restore -- <40자리 revision>`을 사용합니다. NAS 객체와 목록만으로 비어 있는 맥 저장소를 재구성하며 검증 후 공개 링크를 전환합니다. 별도 복구 경로는 `MUSIC_LIBRARY_ROOT=/복구/경로 npm run library:restore`로 시험할 수 있습니다.
- 배포는 의도한 변경을 커밋한 뒤 `npm test`, `npm run deploy:local` 순서로 수행합니다. 최초 전환에는 `ops/music.Caddyfile`과 홈페이지 Caddy CSP를 validate/reload합니다. 공개 카탈로그·음원은 Caddy가 직접 제공하며 HTTP Range·CORS를 지원합니다. `/api/*` 인증은 기존대로 유지합니다.
- GitHub Pages 빌드에도 음원은 넣지 않습니다. 기존 저장소에 보관된 음원과 Git 이력은 유지하지만 새 온라인 추가곡의 원본은 맥/NAS가 관리합니다. 최신 전체 라이브러리는 NAS에서 복원하며 GitHub 체크아웃만으로 최신 온라인 추가곡을 복구할 수 없습니다.

원본 저장소 `Readiz/BA-music-player`를 음악 서비스와 후속 앱의 독립 프로젝트로 유지한다. 운영 체크아웃은 `/Users/readiz/workspace/openclaw/BA-music-player`다. new-home은 바로가기와 기존 주소의 리다이렉트만 관리한다.

## 도메인과 배포

- 대표 주소: `https://music.readiz.com/`.
- Cloudflare DNS: `music` CNAME → `mac.readiz.com`, **DNS only**, TTL Auto. TV와 같은 Mac/Caddy 운영 경로다. Cloudflare가 권한 DNS를 담당하고 앱 HTTPS는 Caddy가 처리한다. 음원·카탈로그도 맥의 별도 라이브러리 저장소에서 직접 제공하며 NAS에 같은 복구 사본을 보관한다.
- 기존에는 전용 `music` 레코드가 없어서 와일드카드를 통해 `cafe24.readiz.com`으로 해석되었다. 새 `music` CNAME만 추가하며 다른 호스트와 와일드카드는 변경하지 않는다. DNS 롤백은 추가한 전용 `music` 레코드를 삭제하는 방식이다.
- 게이트웨이 `/opt/homebrew/etc/Caddyfile`에 이 저장소의 `ops/music.Caddyfile`을 import한다.
- 정적 릴리스: `/opt/homebrew/var/www/readiz-music/releases/<시각>-<commit>/`, 운영 링크: `current`.

```sh
npm test
# 의도한 변경을 커밋한 후 실행한다.
npm run deploy:local
caddy validate --config /opt/homebrew/etc/Caddyfile --adapter caddyfile
caddy reload --config /opt/homebrew/etc/Caddyfile --adapter caddyfile
curl -f https://music.readiz.com/app-config.json
```

일반 정적 업데이트에는 Caddy reload가 필요 없다. 릴리스의 모든 파일을 복사한 뒤 `current` 심볼릭 링크를 원자적으로 바꾼다. 롤백은 배포 결과의 `previous` 경로로 임시 심볼릭 링크를 만든 뒤 `current`를 rename으로 교체한다. 음원 경로를 재사용하므로 음원도 ETag와 no-cache로 매번 재검증한다. HTML·JS·목록·매니페스트·서비스 워커는 매번 재검증한다.

공개 출력은 허용 목록으로 구성하며 `.git`, `node_modules`, Android 소스·서명키, 스크립트, 운영 문서는 배포하지 않는다. `file_server`는 없는 앱 경로를 404로 반환한다. `/music/*` 주소는 맥 파일 서버가 직접 제공하며 Range와 공개 음원 CORS를 지원한다. 유튜브 추가 API는 별도 Node 데몬(127.0.0.1:4525)에서 실행한다. 홈페이지 서버 재시작은 필요 없다.

## 확인 기준

1. 권한 DNS, 공용 DNS, 로컬 DNS의 `music.readiz.com` 목적지를 각각 확인한다.
2. 인증서 검증을 켠 HTTPS 200과 `app-config.json`의 커밋·곡 수를 확인한다.
3. 맥 공개 음원에 `Range: bytes=0-1023`를 요청하면 리다이렉트 없이 206 및 `Content-Range`를 반환하는지 확인하고 NAS 전체 검증도 통과하는지 확인한다.
4. 브라우저에서 앨범 선택 → 재생 → 일시정지 → 다음 곡, 모바일 폭, 아이콘·파형을 확인한다.
5. 기존 `/showcase/Demos/BAMusicPlayer/`가 새 주소로 이동하는지 확인한다.

`npm run build` 후 `npm run dev`로 `127.0.0.1:4523`에서 같은 공개 출력만 볼 수 있다. 기존 `scripts/verify-albums.js`, `verify-startup.js`, `verify-background.js`는 Playwright CLI `run-code`용이다.

## 동방 컬렉션 (1.5.5)

- `touhou-arrange.json`은 2026-10-07에 확인한 공식 앨범 음원·풀 MV 30곡의 선곡 목록이다. 기존 12곡에 th06·th07·th08 원곡 기반 어레인지를 각각 6곡씩 추가했으며, 추가곡은 `originalWork`·`originalTracks`·`referenceUrl`로 원작/원곡과 확인 출처를 남긴다. `npm run import:touhou`는 영상 ID와 공식 채널 ID를 확인하고 기존 다운로드·192kbps MP3 변환·480개 피크 생성기를 사용한다. 이미 준비된 음원의 크기·SHA-256·제목·아티스트·파형이 일치하면 재다운로드하지 않는다.
- `touhou-original.json`은 공식 Team Shanghai Alice Topic의 홍마향 17곡·요요몽 20곡·영야초 21곡과 Twilight Frontier Topic의 췌몽상 OST `幻想曲抜萃` 47곡, 총 105곡의 목록이다. 췌몽상은 공식 OST 소개와 배급 플레이리스트를 대조한 Day Disc 24곡·Night Disc 23곡 전체이며 체험판·弐符·Arrange Version도 포함한다. `npm run import:touhou-original`은 영상/채널 ID, 원래 곡명, 해당 게임 사운드트랙 출처까지 확인한다. 일시 오류는 곡마다 최대 3회 재시도하며, 중단돼도 다시 실행하면 완료한 파일을 재사용한다. `music/th original/`에 저장하고 곡명에 `[th06-01]` 형식의 작품/트랙 번호를 붙인다. `originalWork`와 `trackNumber`, 원래 앨범과 공식 플레이리스트 URL을 기록하며 MP3 앨범 태그는 `th original`, 트랙/디스크 번호는 각 OST 순서로 정리한다. 췌몽상은 `[th075-01]`부터 `[th075-47]`까지 표시하며 `discNumber`·`discTotal`·`discTrackNumber`로 두 디스크의 실제 번호를 보관한다. 작품 번호 `075`를 디스크 번호로 계산하지 않는다.
- 공개 결과는 `music/동방 어레인지/yt-<영상ID>.mp3`, `musicList.json`, `imported-tracks.json`, `waveforms.json`에 함께 보관한다. 곡명·보컬/서클명·원래 앨범·공식 출처 URL/채널/영상 제목을 기록한다. 임시 자료는 무시되는 `output/import/touhou/`에만 생성한다.
- 카테고리는 폴더별로 자동 생성되며 `js/library.js`는 폴더와 별도로 manifest의 아티스트를 표시한다. `js/script.js`는 저장 경로와 앨범 선택 키를 보존하면서 카드·체크박스·Media Session·네이티브 재생 큐의 앨범명을 **Touhou**로 표시한다. 커버는 `assets/albums/touhou-arrange.jpg`, 생성 프롬프트는 `assets/albums/prompts.json`이다. 일반 웹 음악 추가는 기존 ETC를 사용한다.
- 원곡 카테고리·Media Session·네이티브 재생 큐의 앨범명은 **th original**이다. 원곡 전용 커버는 `assets/albums/touhou-original.jpg`, 생성 프롬프트는 같은 `prompts.json`에 보관한다.
- 카탈로그 검증은 ETC·동방 어레인지·th original 세 폴더의 안정된 import ID만 허용한다. 새 manifest가 기존 ETC 추가를 방해하지 않도록 같은 커밋의 API도 배포한다. 준비 후 `npm test`, `MUSIC_BUILD_TARGET=pages npm test`, 의도한 파일만 커밋·push, `npm run deploy:local`을 실행한다.
- 맥/NAS 게시 성공 뒤 공개 manifest/목록/파형과 각 MP3의 크기·SHA-256·Range 응답을 확인한다. 브라우저에서 Touhou 30곡, th original 105곡, 두 앨범 동시 선택 135곡, 아티스트·커버·파형, 실제 재생과 다음 곡, 선택 복원, 모바일·TV 표시와 재생 알림의 앨범명까지 확인한 뒤 완료로 보고한다.

### Pages 게시 단계

2026-10-07부터 Pages의 `build_type`은 `workflow`다. 플레이어 코드 배포는 음원 없는 `dist`를 `actions/upload-pages-artifact@v4`로 전송하고, 같은 workflow의 후속 job에서 `actions/deploy-pages@v4`로 게시한다. `gh-pages` 브랜치에도 동일한 결과물을 보관하지만 별도 Jekyll 작업에서 전체 음원 저장소를 다시 clone하지 않는다. Pages 플레이어가 맥의 최신 목록·음원·파형을 읽는지 확인한다. 음악 추가는 GitHub Actions를 사용하지 않는다.

`github-pages` 환경은 배포 job의 `master` 실행을 허용하며 `pages: write`와 `id-token: write`는 이 job에만 부여한다. checkout은 10분, 검사 job은 20분, 배포 job은 10분으로 제한한다. Pages 설정과 배포 workflow를 함께 바꾸며, 원복은 Pages `build_type: legacy` 및 기존 `gh-pages` 원본 설정으로 되돌리는 방식이다. [GitHub 공식 artifact 배포 계약](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).

## 설치와 이전

매니페스트·앱 아이콘·서비스 워커를 제공한다. 지원 브라우저에서는 설치 버튼 또는 브라우저 메뉴의 홈 화면 추가를 사용한다. 오프라인 상태에서는 연결 안내를 표시하며 음원 전체를 미리 내려받지 않는다. 서비스 워커 업데이트는 다음 실행에 적용되어 재생 중인 화면을 강제로 새로고침하지 않는다.

브라우저 설정은 원점별이므로 `blog.readiz.com`에서 저장한 앨범 선택은 새 도메인으로 자동 이동하지 않는다. 첫 방문은 기존 기본값인 Blue Archive·무작위 모드이며 자동 재생하지 않는다. 이전 GitHub Pages 주소도 보존한다.

## TV 패키지 배포

1.2.0부터 `npm run build`에 Chromium 63 대상 JavaScript 변환과 미서명 WGT 빌드가 포함된다. `app.wgt`, `app.wgt.sha256`, `app-start.html`, `app-config.json`의 `tv` 필드를 웹과 함께 원자적으로 배포한다. 1.3.0부터 정식 서명 APK와 검증된 업데이트 메타데이터도 같은 릴리스에 넣는다. 먼저 `npm run build:apk`를 실행하며, 고정 주소는 `/app.apk`와 `/android-update.json`이다. 디버그 APK는 공개하지 않는다. GitHub Actions도 WGT/체크섬을 별도 artifact로 보관한다.

배포 후 `/?tv=1`에서 방향키·확인·뒤로와 실제 재생을 확인하고, `/app.wgt`의 SHA-256이 빌드 산출물과 같은지 확인한다. TV 설치는 [Tizen 안내](../tizen/README.md)를 따른다. 이번 화면·패키지 배포는 Caddy나 DNS 변경이 필요 없다.


## 음악 추가 진행 표시 (1.5.1)

- 추가 창을 닫아도 진행 중 요청은 2초마다 확인한다. 다시 방문하거나 새로고침하면 인증된 요청 이력을 복원하며, 상단에 현재 단계·경과 시간·완료/실패를 표시한다. 연결 오류는 재확인 안내를 표시하고 5초 후 재시도한다.
- 데스크톱·TV의 남은 화면 높이는 `.app-player`만 채운다. 상단 진행 알림은 내용 높이를 유지하여 요청 접수 뒤에도 앨범·재생 목록이 눌리지 않도록 한다.
- `/api/imports`는 `updatedAt`과 `syncStage`를 제공한다. 동기화의 전송·대기·공개 준비·파형·검사·목록 반영·공개 음원 확인 단계를 SQLite에 저장한다. 완료는 NAS 백업과 맥 공개 목록·파형·음원 검증 뒤에만 인정한다.
- `scripts/verify-import-progress.js`는 격리된 브라우저에서 창 닫기·새로고침·연결 복구·완료·실패·로그아웃·모바일 표시를 확인한다. 운영 데이터나 인증 세션을 테스트에 사용하지 않는다.

## 음악 파일 업로드 (1.5.0)

- 음악 추가에서 유튜브 링크와 파일 업로드를 선택한다. `POST /api/uploads?name=...&title=...`는 동일한 Discord 세션·Origin 검사 후 `application/octet-stream` 본문을 디스크로 스트리밍한다. 최대 100MiB, 전송 시간 10분, 계정당 동시 전송 1개이며 수신 중 작업도 전체 대기열 5개에 포함한다.
- MP3/M4A/MP4/WAV/FLAC/OGG/OPUS/AAC/WebM 파일을 지원한다. 확장자 외에 ffprobe로 오디오·30분 제한을 검사한다. 로컬 단일 미디어 형식만 허용하고 첫 오디오 스트림을 192kbps MP3로 변환한 뒤 맥 파형·NAS 백업·공개 검증 절차를 따른다.
- 원본 SHA-256을 `upload-<64hex>` ID로 사용해 파일명을 바꿔도 중복을 막는다. 공개 파일은 `music/ETC/upload-<64hex>.mp3`이며 제목은 편집할 수 있다. 원본 경로·계정 정보는 GitHub에 보내지 않는다. 공개 메타데이터에는 `sourceType: upload`를 기록한다.
- 수신 중 파일은 `data/incoming/`, 수신 완료 원본은 `data/uploads/`에 비공개로 둔다. 수신 실패는 즉시 정리하고 재시작 시 미완료 수신 파일을 제거한다. queued 원본은 재시작 후 변환하며 변환 완료 시 원본을 삭제한다. 동기화 실패 시 변환 MP3를 남기고 같은 파일을 다시 보내면 재변환 없이 재시도한다.
- 웹은 전송률을 표시하고 페이지 이탈을 안내한다. 서버 수신이 끝나면 앱을 닫아도 동기화는 계속된다. Android 파일 선택에는 APK 0.3.2 이상이 필요하며 기존 앱 로그인을 사용한다.
- 검증: `npm test`의 HTTP/인증·Origin/용량·중단·중복·재시도/실제 ffmpeg 변환 테스트, `scripts/verify-upload.js`의 격리 브라우저 파일 전송, Android chooser 단위 테스트와 release lint/build. 테스트 계정과 음원은 운영 라이브러리에 발행하지 않는다.

## 유튜브·파일 추가와 로컬 동기화 (1.5.6)

- `com.readiz.music.api` launchd → `127.0.0.1:4525`, Node 24.13.1 이상. API 릴리스는 `~/.local/share/readiz-music/api-releases/`, 실행 링크는 `api-current`입니다.
- 인증 설정은 `~/.config/readiz-music/discord-auth.json` (600)입니다. 중앙 SSO와 기존 Discord 허용 계정·Origin·업로드 제한은 유지합니다. Caddy는 임시 다운로드와 작업 DB를 공개하지 않습니다.
- 다운로드 도구는 `~/.local/share/readiz-music/downloader/bin/yt-dlp`, 오디오 도구는 `/opt/homebrew/bin/ffmpeg`입니다. 런타임에서 GitHub 토큰·Contents·Actions 권한을 사용하지 않습니다.
- 요청 DB는 `~/.local/share/readiz-music/data/imports.sqlite`입니다. 준비된 MP3는 `data/media/ETC/`, 변환 중 파일은 `data/staging/`에 둡니다. 실패한 동기화 파일은 재시도를 위해 보존합니다.
- 곡 추가는 다운로드/변환 → 깨끗한 제목 태그 → 480개 파형 → 맥 객체 검사 → NAS 백업 검사 → 공개 목록 반영 → 공개 음원 해시·Range 확인 순서입니다. 입력 음원을 태그 정리할 때 다시 손실 압축하지 않습니다.
- `queued/checking/downloading/converting/syncing/ready/failed` 상태와 `preparing/waveform/testing/backing-up/publishing/verifying` 단계를 저장합니다. NAS 백업이나 공개 검증에 실패하면 ready로 표시하지 않습니다. 중단된 요청은 재시작 때 다시 이어갑니다.
- 맥과 NAS에 검증한 파일을 설치하고 공개 확인까지 완료한 뒤 임시 MP3를 정리합니다. 사용자·작업 ID·인증 정보는 공개 목록이나 NAS 공개 음원 메타데이터에 넣지 않습니다.
- 브라우저와 홈페이지는 맥 공개 원점에서 목록·음원·파형을 읽습니다. 기존 Android의 `/music/*` 주소도 맥에서 직접 스트리밍하며 APK 재설치는 필요 없습니다. `/api/library`는 공개 메타데이터 주소로 연결합니다.
- 한 곡 30분/100MB, 동시 다운로드 1개, 전체 대기열 5개, 계정당 시간당 20곡, 누적 10GiB, 남은 공간 500MiB 제한입니다. 준비 단계 실패는 재요청하고, NAS가 복구되면 같은 준비 파일을 재사용합니다.
- 로그는 `~/.local/share/readiz-music/logs/`입니다. OAuth 코드·state·쿠키·토큰·상위 미디어 서명 URL을 출력하지 않습니다. 요청 이력·세션 DB는 개인 데이터이므로 음원 백업과 별도입니다.

Android 0.3.1의 `/api/auth/android/redeem`은 짧은 수명의 ticket과 앱 verifier를 검증한 뒤 쿠키로만 세션을 전달한다. `auth_android_success`/`auth_android_failure` 로그로 앱 내부 세션 전달 단계를 확인한다. `handoff_unknown_or_proof_mismatch`는 잘못된 증명 또는 이미 사용한 ticket, `handoff_expired`는 유효시간 초과다. 앱 브라우저 로그인 완료 화면은 캐시·참조자 전달·프레임 삽입을 금지한다. `android_oauth`/`android_handoffs`는 기존 인증 DB 안의 별도 테이블이므로 기존 브라우저 세션과 롤백용 oauth_states 스키마를 유지한다.

## 2026-10-05 개인 서비스 통합 인증

운영 인증은 `auth.readiz.com`의 단일 소유자 계정으로 통합한다. `h.readiz.com`은 별도 다중 사용자 인증을 유지한다. 기존 독립 세션/PIN 설명은 SSO 설정이 없는 로컬·복구 환경에만 적용된다. 중앙 로그인 14일, 호스트별 세션, 일회용 복귀 코드, 같은 로그인으로 연결된 서비스의 일괄 로그아웃을 적용한다. TV 앱은 중앙 로그인으로 접속 코드를 승인한다. AOA 연구 사이트는 현재의 공개 열람과 브라우저 로컬 답안 저장을 유지하며 통합 인증을 요구하지 않는다. Music 공개 재생과 홈페이지 공개 글은 그대로다. 구현·검사·배포·원복 계약은 [통합 인증 운영 문서](/Users/readiz/workspace/openclaw/newblog/ops/SSO.md)를 따른다.
