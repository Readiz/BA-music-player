# BA-music-player

## 곡명 보완

`blue-archive-ost.json`은 [BA OST Index](https://ba.cnfast.top/en/track/ost/)와
[Blue Archive Wiki](https://bluearchive.fandom.com/wiki/Soundtrack)를
2026-10-04에 확인한 곡명 목록입니다. 최초 목록의 164개 제목에 추가 음원의
확인된 제목 60개를 보완했으며, 제목이 확인되지 않은 항목은 제외합니다.

플레이어는 `Blue Archive/theme_번호.ogg`처럼 이름이 없는 파일에만 이 목록의
제목을 표시합니다. 이미 이름이 있는 파일은 그대로 표시하며, 미확인 제목을
추측해서 붙이지 않습니다. 기존 음원 223개의 파일과 경로를 보존합니다.

곡명은 `decodeURIComponent`와 `textContent`로 표시해 일본어·특수문자를
보존합니다. 메타데이터를 읽을 수 없으면 기존 파일 이름으로 재생 목록을 엽니다.

## 2026-10-04 음원 추가

공개 팬 자료에서 빠져 있던 OGG 115곡(약 137MB)을 추가해 총 338곡을 제공합니다.
처음 확인한 메모리얼 로비 음악 25곡에 다른 자료에서 확인한 90곡을 더했습니다.
추가곡 중 60곡은 제목을 확인했고, 55곡은 `theme_번호`로 표시합니다.
Vol.8에서 누락됐던 16곡도 모두 포함됩니다. 번호가 같은 기존 곡, 짧은 버전과
파트별 분할 음원은 중복 추가하지 않았습니다.

- [메모리얼 로비 OST 자료](https://github.com/CelestialDomeStarPole/BlueArchive-CharacterMemorialLobbyOST-ReferenceTable): 25곡
- [BA OST Ranker 자료](https://github.com/alonzojp/BA-OST-Ranker): 9곡
- [NCW BlueArchiveMusic 자료](https://github.com/NoneColdWind/NCW-MC-BlueArchiveMusic): 81곡

`music-sources.json`에 곡 번호, 확인된 제목, 원본 저장소·커밋·경로, 파일 크기,
SHA-256, 길이와 코덱을 기록했습니다. 외부 저장소의 임의 제목은 사용하지 않았습니다.
공개 팬 업로드를 확인한 것이며, 미공개 유출 여부를 주장하지 않습니다.
음악 저작권은 원 권리자에게 있습니다.

추가 파일 전체의 OGG/Vorbis 형식, 길이, 전체 디코딩, 파일 중복을 확인한 후
목록과 파형을 생성합니다. `musicList.json`과 `lastUpdated.txt`는 배포 작업이
다시 생성하며, `waveforms.json`은 아래 명령으로 갱신해 커밋합니다.

## 폴더 선택

재생 목록 위의 **폴더**에서 전체 또는 음원 폴더를 선택합니다. 폴더 목록과 곡 수는
`musicList.json`의 실제 경로에서 자동으로 구성하며 하위 폴더는 전체 경로로 구분합니다.
현재 Blue Archive, ETC, Girls Band Cry, Kessoku Band 네 폴더를 제공합니다.

이전·다음 곡, 자동 다음 곡, 무작위 재생과 Media Session의 곡 이동은 선택한 폴더
안에서만 동작합니다. 마지막 곡 다음에는 같은 폴더의 첫 곡으로 돌아갑니다.
폴더를 바꿔도 현재 곡이 목록에 있으면 재생 위치를 유지합니다. 다른 폴더로 바꾸면
첫 곡을 선택하되 재생·일시정지 상태를 유지합니다. 선택한 폴더는 브라우저에 저장하고
다음 방문에 복원하며 자동으로 재생을 시작하지 않습니다. 저장 기능이 제한된 환경에서도
폴더 선택과 재생은 동작합니다.

## 백그라운드 재생

오디오 요소 하나를 유지하며 직접 재생합니다. 곡 전환과 자동 다음 곡은 파형
다운로드·디코딩·애니메이션을 기다리지 않습니다. 한 곡 반복은 오디오 요소의
기본 반복 기능을 사용합니다. 다른 앱이나 탭으로 전환해도 페이지에서 음악을
일시정지하지 않으며, 돌아올 때 사용자가 멈춘 음악을 임의로 재개하지 않습니다.

지원 브라우저에는 Media Session으로 곡명, 재생 상태, 재생 위치와 재생·일시정지·
이전/다음 곡·10초 이동·위치 이동을 연결합니다. 지원하지 않는 기능은 개별적으로
건너뛰며 기본 재생은 유지합니다. 운영체제가 브라우저를 종료하거나 강제로
중단한 경우까지 웹 페이지에서 재생을 보장할 수는 없습니다.

`waveforms.json`은 표시용 파형과 길이만 담습니다. 파형 자료나 라이브러리를
불러오지 못해도 음악 재생은 가능합니다. 음원을 추가하거나 교체하면 ffmpeg와
ffprobe가 설치된 환경에서 `python3 scripts/build-waveforms.py`로 다시 생성합니다.

### 브라우저 검증

구간 요청을 지원하는 로컬 서버(`npm run dev`)를 연 뒤 headed Chrome의
Playwright CLI로 접속하고 다음을 실행합니다.

```sh
playwright-cli run-code "$(cat scripts/verify-folders.js)"
playwright-cli run-code "$(cat scripts/verify-background.js)"
```

폴더 검사는 실제 폴더별 곡 수, 재생 범위·끝 경계·무작위·Media Session 이동,
폴더 변경 중 재생 상태, 선택 복원과 저장 차단 환경을 확인합니다.

현재 목록의 곡 수, 파형 로딩 실패, 실제 오디오 시간 진행, 포커스가 빠진 탭에서 다음 곡과 반복,
자동 다음 곡 해제, Media Session 핸들러, 재생 거부와 미지원 브라우저 대응을
검사합니다. Playwright가 페이지 가시성을 강제하므로 `document.hidden` 상태의
증명과는 구분합니다. 휴대폰의 실제 화면 잠금·다른 앱 전환·배터리 제한은 별도의 실기기
확인이 필요합니다.

https://blog.readiz.com/BA-music-player/
