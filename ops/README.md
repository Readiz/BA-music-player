# Readiz Music 운영

원본 저장소 `Readiz/BA-music-player`를 음악 서비스와 후속 앱의 독립 프로젝트로 유지한다. 운영 체크아웃은 `/Users/readiz/workspace/openclaw/BA-music-player`다. new-home은 바로가기와 기존 주소의 리다이렉트만 관리한다.

## 도메인과 배포

- 대표 주소: `https://music.readiz.com/`.
- Cloudflare DNS: `music` CNAME → `mac.readiz.com`, **DNS only**, TTL Auto. TV와 같은 Mac/Caddy 운영 경로다. Cloudflare가 권한 DNS를 담당하고 앱 HTTPS는 Caddy가 처리한다. 음원·카탈로그는 기존 GitHub Pages인 `blog.readiz.com/BA-music-player/`에서 직접 제공한다.
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

일반 정적 업데이트에는 Caddy reload가 필요 없다. 릴리스의 모든 파일을 복사한 뒤 `current` 심볼릭 링크를 원자적으로 바꾼다. 롤백은 배포 결과의 `previous` 경로로 임시 심볼릭 링크를 만든 뒤 `current`를 rename으로 교체한다. 음원 경로를 재사용하므로 최대 한 시간의 브라우저 음원 캐시를 고려한다. HTML·JS·목록·매니페스트·서비스 워커는 매번 재검증한다.

공개 출력은 허용 목록으로 구성하며 `.git`, `node_modules`, Android 소스·서명키, 스크립트, 운영 문서는 배포하지 않는다. `file_server`는 없는 앱 경로를 404로 반환한다. 기존 `/music/*` 주소는 Pages로 307 이동하며 최종 Pages 응답이 Range를 지원한다. 유튜브 추가 API는 별도 Node 데몬(127.0.0.1:4525)에서 실행한다. 홈페이지 서버 재시작은 필요 없다.

## 확인 기준

1. 권한 DNS, 공용 DNS, 로컬 DNS의 `music.readiz.com` 목적지를 각각 확인한다.
2. 인증서 검증을 켠 HTTPS 200과 `app-config.json`의 커밋·곡 수를 확인한다.
3. 기존 음원 주소가 Pages로 307 이동하고, 최종 Pages에 `Range: bytes=0-1023`를 요청하면 206 및 `Content-Range`를 반환하는지 확인한다.
4. 브라우저에서 앨범 선택 → 재생 → 일시정지 → 다음 곡, 모바일 폭, 아이콘·파형을 확인한다.
5. 기존 `/showcase/Demos/BAMusicPlayer/`가 새 주소로 이동하는지 확인한다.

`npm run build` 후 `npm run dev`로 `127.0.0.1:4523`에서 같은 공개 출력만 볼 수 있다. 기존 `scripts/verify-albums.js`, `verify-startup.js`, `verify-background.js`는 Playwright CLI `run-code`용이다.

## 설치와 이전

매니페스트·앱 아이콘·서비스 워커를 제공한다. 지원 브라우저에서는 설치 버튼 또는 브라우저 메뉴의 홈 화면 추가를 사용한다. 오프라인 상태에서는 연결 안내를 표시하며 음원 전체를 미리 내려받지 않는다. 서비스 워커 업데이트는 다음 실행에 적용되어 재생 중인 화면을 강제로 새로고침하지 않는다.

브라우저 설정은 원점별이므로 `blog.readiz.com`에서 저장한 앨범 선택은 새 도메인으로 자동 이동하지 않는다. 첫 방문은 기존 기본값인 Blue Archive·무작위 모드이며 자동 재생하지 않는다. 이전 GitHub Pages 주소도 보존한다.

## TV 패키지 배포

1.2.0부터 `npm run build`에 Chromium 63 대상 JavaScript 변환과 미서명 WGT 빌드가 포함된다. `app.wgt`, `app.wgt.sha256`, `app-start.html`, `app-config.json`의 `tv` 필드를 웹과 함께 원자적으로 배포한다. 1.3.0부터 정식 서명 APK와 검증된 업데이트 메타데이터도 같은 릴리스에 넣는다. 먼저 `npm run build:apk`를 실행하며, 고정 주소는 `/app.apk`와 `/android-update.json`이다. 디버그 APK는 공개하지 않는다. GitHub Actions도 WGT/체크섬을 별도 artifact로 보관한다.

배포 후 `/?tv=1`에서 방향키·확인·뒤로와 실제 재생을 확인하고, `/app.wgt`의 SHA-256이 빌드 산출물과 같은지 확인한다. TV 설치는 [Tizen 안내](../tizen/README.md)를 따른다. 이번 화면·패키지 배포는 Caddy나 DNS 변경이 필요 없다.


## 유튜브 추가와 GitHub 동기화 (1.4.0)

- `com.readiz.music.api` launchd → `127.0.0.1:4525`. Node 24.13.1 이상. API 릴리스는 `~/.local/share/readiz-music/api-releases/`, 실행 링크는 `api-current`다.
- 인증 설정은 `~/.config/readiz-music/discord-auth.json` (600)이다. 개인 서비스의 Discord clientId/clientSecret/redirectUri/allowedUserIds를 사용하며 origin은 `https://music.readiz.com`, sessionSecret과 storePath는 music 전용으로 둔다. 공용 콜백은 `ops/music-oauth-relay.Caddyfile`이 music state만 이 서비스로 전달한다.
- 다운로드 도구는 `~/.local/share/readiz-music/downloader/bin/yt-dlp`와 `/opt/homebrew/bin/ffmpeg`다. 기존 `gh` 로그인(저장소 Contents·Actions 쓰기 권한)을 서비스 계정에서 사용할 수 있어야 한다. `deploy:api`는 gh의 저장소 쓰기 권한을 확인한다. 토큰을 소스·plist·요청 DB에 복사하지 않는다.
- 비공개 요청 DB는 `~/.local/share/readiz-music/data/imports.sqlite`다. 임시 MP3는 `data/media/ETC/yt-<영상ID>.mp3`, 변환 중 파일은 `data/staging/`에 둔다. Caddy는 이 임시 디렉터리를 공개하지 않는다.
- GitHub Git Data API로 음원과 공개 제목만 `music-imports/<커밋>` 임시 브랜치에 업로드한다. owner, 작업 ID, 인증정보는 제외한다. `import-music.yml`의 workflow_dispatch를 호출하고 source commit/run ID를 DB에 기록한다. 재시작 시 같은 Action을 찾아 이어간다.
- Action은 영상 ID와 MP3 길이·코덱·크기를 검증한다. 오디오를 재인코딩하지 않고 태그·앨범 이미지를 제거하고 정리한 제목을 넣는다. 480개 피크를 생성하고 음원/목록/파형/공개 출처·해시 정보를 master에 함께 커밋한다. 전체 테스트를 통과한 결과만 커밋한다. GITHUB_TOKEN으로 만든 커밋은 일반 push workflow를 시작하지 않으므로 같은 Action에서 GitHub Pages도 빌드·배포한다.
- 성공한 Action 이후 master의 고정 커밋에서 기대하는 목록·메타데이터·파형을 읽는다. 기존 `https://blog.readiz.com/BA-music-player/`에서 동일한 곡과 파형이 보이고 실제 음원 크기·SHA-256도 일치할 때까지 기다린다. CDN 전파 중에는 계속 syncing이다. 음원 확인에는 임의의 외부 URL을 사용하지 않는다.
- 최종 상태는 `queued/checking/downloading/converting/syncing/ready/failed`다. ready 이전에는 track/듣기 버튼/공개 목록에 곡을 노출하지 않는다. Action 실패·시간 초과·검증 실패는 failed로 표시하며 같은 링크로 재시도한다. 재시작으로 중단된 작업은 자동 재개한다. 기존 서버 전용 ready 곡은 첫 실행 때 자동 이관한다. 완료 후 임시 MP3와 전송용 Git 브랜치를 정리한다.
- `music.readiz.com`은 UI·인증·추가 요청 API만 제공한다. `js/music-source.js`가 목록·제목·파형과 브라우저 음원을 기존 Pages에서 직접 불러온다. Pages의 CORS와 HTTPS Range 응답을 사용한다. 카탈로그에는 요청 시각 쿼리를 붙여 추가 직후 CDN 캐시 지연을 피한다.
- 기존 Android APK는 music 호스트 음원 주소만 허용하므로 queue의 상대 ID와 원래 주소는 유지한다. Caddy `/music/*`가 Pages로 307 이동시켜 최종 음원은 Pages에서 스트리밍된다. 구 버전 클라이언트용 목록·파형·`/api/library`도 Pages로 이동한다. APK를 다시 설치하지 않아도 같은 라이브러리를 사용한다.
- 기본 `npm run build`는 음원 없는 앱 릴리스다. GitHub Actions는 `MUSIC_BUILD_TARGET=pages`로 빌드해 전체 카탈로그와 음원을 gh-pages에 배포한다. 앱 서버에는 별도 음악 동기화 배포 작업이나 원본 음원 복사본이 필요 없다.
- 한 곡 30분/100MB, 다운로드 한 번에 1개, 동기화를 포함한 대기열 5개, 계정당 시간당 20곡, 누적 10GiB, 남은 공간 500MiB 제한이다. 다운로드 실행은 20분, Action 대기는 최대 45분이며 기한 초과도 재시도할 수 있다.

배포는 의도한 소스 커밋과 GitHub push 뒤 `npm test`, `npm run deploy:local`로 진행한다. 최초 1.4.0 전환 시 `ops/music.Caddyfile`의 Pages 리다이렉트와 CSP 허용을 위해 Caddy validate/reload도 수행한다. 동기화 중 음원은 목록에 포함되지 않는다. 진행 상태는 인증된 `/api/imports` 또는 SQLite의 status/sync_state/sync_revision으로 확인하며 사용자 ID·OAuth 비밀은 로그에 출력하지 않는다.

최종 음원 복구에는 master 체크아웃과 `MUSIC_BUILD_TARGET=pages npm run build` 및 Pages 배포만 필요하다. 요청 이력과 진행 중 작업을 이어가려면 별도로 `data/`와 인증 DB를 백업한다. 데이터베이스는 SQLite backup API로 백업하고, 동기화 실패 파일은 완료 확인 전 삭제하지 않는다. API 릴리스 롤백 시 과거 서버 전용 import 구현으로 돌아가지 않도록 주의한다.

API 로그는 `~/.local/share/readiz-music/logs/`에 있다. 인증 로그에는 auth_start/auth_success/auth_failure와 redacted flow 정보만 기록하며 OAuth 코드·state·쿠키·토큰은 출력하지 않는다. 브라우저 모의 로그인은 실제 계정 인증 완료를 뜻하지 않는다.

Android 0.3.1의 `/api/auth/android/redeem`은 짧은 수명의 ticket과 앱 verifier를 검증한 뒤 쿠키로만 세션을 전달한다. `auth_android_success`/`auth_android_failure` 로그로 앱 내부 세션 전달 단계를 확인한다. `handoff_unknown_or_proof_mismatch`는 잘못된 증명 또는 이미 사용한 ticket, `handoff_expired`는 유효시간 초과다. 앱 브라우저 로그인 완료 화면은 캐시·참조자 전달·프레임 삽입을 금지한다. `android_oauth`/`android_handoffs`는 기존 인증 DB 안의 별도 테이블이므로 기존 브라우저 세션과 롤백용 oauth_states 스키마를 유지한다.
