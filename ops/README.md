# Readiz Music 운영

원본 저장소 `Readiz/BA-music-player`를 음악 서비스와 후속 앱의 독립 프로젝트로 유지한다. 운영 체크아웃은 `/Users/readiz/workspace/openclaw/BA-music-player`다. new-home은 바로가기와 기존 주소의 리다이렉트만 관리한다.

## 도메인과 배포

- 대표 주소: `https://music.readiz.com/`.
- Cloudflare DNS: `music` CNAME → `mac.readiz.com`, **DNS only**, TTL Auto. TV와 같은 Mac/Caddy 운영 경로다. Cloudflare가 권한 DNS를 담당하고 HTTPS와 음원 Range 응답은 Caddy가 처리한다. Cloudflare Workers/Pages 배포가 아니다.
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

공개 출력은 허용 목록으로 구성하며 `.git`, `node_modules`, Android 소스·서명키, 스크립트, 운영 문서는 배포하지 않는다. `file_server`는 없는 경로를 404로 반환하며 음원 요청의 Range를 그대로 지원한다. 유튜브 추가 API는 별도 Node 데몬(127.0.0.1:4525)에서 실행한다. 홈페이지 서버 재시작은 필요 없다.

## 확인 기준

1. 권한 DNS, 공용 DNS, 로컬 DNS의 `music.readiz.com` 목적지를 각각 확인한다.
2. 인증서 검증을 켠 HTTPS 200과 `app-config.json`의 커밋·곡 수를 확인한다.
3. 실제 음원 `Range: bytes=0-1023` 요청이 206 및 `Content-Range`를 반환하는지 확인한다.
4. 브라우저에서 앨범 선택 → 재생 → 일시정지 → 다음 곡, 모바일 폭, 아이콘·파형을 확인한다.
5. 기존 `/showcase/Demos/BAMusicPlayer/`가 새 주소로 이동하는지 확인한다.

`npm run build` 후 `npm run dev`로 `127.0.0.1:4523`에서 같은 공개 출력만 볼 수 있다. 기존 `scripts/verify-albums.js`, `verify-startup.js`, `verify-background.js`는 Playwright CLI `run-code`용이다.

## 설치와 이전

매니페스트·앱 아이콘·서비스 워커를 제공한다. 지원 브라우저에서는 설치 버튼 또는 브라우저 메뉴의 홈 화면 추가를 사용한다. 오프라인 상태에서는 연결 안내를 표시하며 음원 전체를 미리 내려받지 않는다. 서비스 워커 업데이트는 다음 실행에 적용되어 재생 중인 화면을 강제로 새로고침하지 않는다.

브라우저 설정은 원점별이므로 `blog.readiz.com`에서 저장한 앨범 선택은 새 도메인으로 자동 이동하지 않는다. 첫 방문은 기존 기본값인 Blue Archive·무작위 모드이며 자동 재생하지 않는다. 이전 GitHub Pages 주소도 보존한다.

## TV 패키지 배포

1.2.0부터 `npm run build`에 Chromium 63 대상 JavaScript 변환과 미서명 WGT 빌드가 포함된다. `app.wgt`, `app.wgt.sha256`, `app-start.html`, `app-config.json`의 `tv` 필드를 웹과 함께 원자적으로 배포한다. 1.3.0부터 정식 서명 APK와 검증된 업데이트 메타데이터도 같은 릴리스에 넣는다. 먼저 `npm run build:apk`를 실행하며, 고정 주소는 `/app.apk`와 `/android-update.json`이다. 디버그 APK는 공개하지 않는다. GitHub Actions도 WGT/체크섬을 별도 artifact로 보관한다.

배포 후 `/?tv=1`에서 방향키·확인·뒤로와 실제 재생을 확인하고, `/app.wgt`의 SHA-256이 빌드 산출물과 같은지 확인한다. TV 설치는 [Tizen 안내](../tizen/README.md)를 따른다. 이번 화면·패키지 배포는 Caddy나 DNS 변경이 필요 없다.


## 유튜브 추가 API (1.3.1)

- `com.readiz.music.api` launchd → `127.0.0.1:4525`. Node 24.13.1 이상.
- API 릴리스: `~/.local/share/readiz-music/api-releases/`, 실행 링크 `api-current`.
- 인증 설정: `~/.config/readiz-music/discord-auth.json` (600). new-home 설정과 같은 `clientId`, `clientSecret`, `redirectUri`, `allowedUserIds`를 사용하되 `origin`은 `https://music.readiz.com`, `sessionSecret`은 새 무작위 비밀값, `storePath`는 `~/.local/share/readiz-music/auth/sessions.sqlite`의 절대 경로로 지정한다. 기존 서비스 세션을 공유하지 않는다.
- 공용 콜백을 쓸 때 `/opt/homebrew/etc/Caddyfile`의 `invest_site`에 이 저장소 `ops/music-oauth-relay.Caddyfile`을 import한다. `music_` state만 고정된 music 콜백으로 보내고 music 서버가 자체 state 쿠키와 일회성 DB 레코드를 검증한다.
- 추가 데이터: `~/.local/share/readiz-music/data/imports.sqlite`, 완성된 MP3: `data/media/ETC/yt-<영상ID>.mp3`, 비공개 임시 파일: `data/staging/`. Caddy는 정확한 MP3 경로만 공개한다. 제목은 `/api/library`로 전달하며 원본 목록과 합친 `/musicList.json`도 공개다.
- `GET /api/imports`와 `POST /api/imports`는 인증 필요. POST는 동일 Origin/JSON만 받고 입력은 허용된 유튜브 호스트의 11자 영상 ID로 정규화한다. 쿠키는 music 호스트 전용 Secure/HttpOnly/SameSite=Lax다. 인증·작업 응답은 `private, no-store`다.
- 실행 도구는 [yt-dlp](https://github.com/yt-dlp/yt-dlp) + ffmpeg. 외부 설정·플러그인을 읽지 않고 shell 없이 고정 인자로 실행한다. 30분/100MB, 동시 다운로드 1개, 대기열 5개, 계정당 시간당 20곡, 전체 저장 10GiB, 최소 남은 공간 500MiB, 실행당 20분 제한. 서비스 재시작으로 끊긴 작업은 실패 표시 후 사용자 재시도로 복구한다. 원본 음원·카탈로그는 변경하지 않는다.

최초 설치:

```sh
/opt/homebrew/bin/python3 -m venv "$HOME/.local/share/readiz-music/downloader"
"$HOME/.local/share/readiz-music/downloader/bin/python" -m pip install 'yt-dlp[default]'
# ffmpeg와 위 인증 설정을 준비한 다음 의도한 소스를 커밋한다.
npm test
npm run deploy:local
# 최초 라우트/릴레이 변경 때만 Caddy 검증·reload가 필요하다.
caddy validate --config /opt/homebrew/etc/Caddyfile --adapter caddyfile
caddy reload --config /opt/homebrew/etc/Caddyfile --adapter caddyfile
curl -f https://music.readiz.com/api/health
```

`deploy:local`은 API 릴리스를 설치·상태 검사한 뒤 정적 릴리스를 교체한다. API 시작에 실패하면 이전 API 링크와 launchd 설정을 복원한다. 이후 정적 배포에 실패했을 때는 이전 정적 릴리스가 유지되며 호환되는 새 API가 실행될 수 있으므로 `/api/health`와 `/app-config.json`의 revision을 각각 확인한다. 설정/SQLite/완성 음원은 별도 백업 대상이며 릴리스 롤백으로 삭제하지 않는다. API 로그는 `~/.local/share/readiz-music/logs/`에 있고, OAuth 쿼리·토큰·다운로드 도구의 서명 URL/진단은 기록하지 않는다.

다운로더 설치 확인 버전은 2026.8.19 (`yt-dlp-ejs` 0.8.0)이다. 업데이트는 위 가상환경의 pip로 수행하고 실제 공개 영상 다운로드·MP3 검사를 다시 확인한다. 브라우저 모의 로그인 검증은 실제 디스코드 계정 인증 완료를 뜻하지 않는다.
