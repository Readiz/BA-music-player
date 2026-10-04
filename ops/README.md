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

공개 출력은 허용 목록으로 구성하며 `.git`, `node_modules`, Android 소스·APK·서명키, 스크립트, 운영 문서는 배포하지 않는다. `file_server`는 없는 경로를 404로 반환하며 음원 요청의 Range를 그대로 지원한다. 별도 Node 데몬이나 홈페이지 서버 재시작은 필요 없다.

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
