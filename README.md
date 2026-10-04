# BA-music-player

## 곡명 보완

`blue-archive-ost.json`은 [BA OST Index](https://ba.cnfast.top/en/track/ost/)의
곡명 목록을 2026-10-04에 확인한 스냅샷입니다. 이름이 있는 164곡을 OST 번호로
저장하며, 원문에서 `[UNNAMED]`인 항목은 제외합니다.

플레이어는 `Blue Archive/theme_번호.ogg`처럼 이름이 없는 파일에만 이 목록의
제목을 표시합니다. 현재 28곡의 이름을 보완합니다. 이미 이름이 있는 곡, 다른
음악과 전체 223개 음원의 경로·순서는 유지합니다. 참고 목록의 199곡은 모두
기존 음원에 포함되어 있어 이번 갱신에서 음원을 추가하지 않았습니다.

곡명은 `decodeURIComponent`와 `textContent`로 표시해 일본어·특수문자를
보존합니다. 메타데이터를 읽을 수 없으면 기존 파일 이름으로 재생 목록을 엽니다.

http://www.readiz.com/BA-music-player/
