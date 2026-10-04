# Readiz Music Android 준비

TV 프로젝트처럼 웹 서비스를 독립 앱에서 열도록 `com.readiz.music` Android 프로젝트를 추가했다. `MainActivity`는 `https://music.readiz.com/`의 최신 화면을 연다. 현재 단계는 **WebView 시작 앱**이며 정식 배포·백그라운드 음악 서비스는 후속 작업이다.

## 빌드

JDK 17, Android SDK 36, Gradle 8.13이 필요하다. 로컬 스크립트는 설치되어 있는 TV용 Gradle 실행기만 재사용한다. 다른 환경에서는 `MUSIC_GRADLE_BIN`, `JAVA_HOME`, `ANDROID_HOME`을 지정한다. TV의 앱 ID·데이터·서명키는 공유하지 않는다.

```sh
npm run build:apk:debug
# output/android/readiz-music-debug.apk
```

인터넷 권한만 사용하고 HTTPS의 정확한 음악 원점만 내부 탐색한다. 외부 HTTPS 링크는 브라우저로 열고, 파일 접근·혼합 콘텐츠·JavaScript 네이티브 브리지는 사용하지 않는다. 인증서 오류는 WebView 기본 차단을 유지한다. 사용자 입력으로 재생을 시작하고 네트워크 실패 시 다시 열기를 제공한다. 회전·폴드 화면 변경 시 Activity 재생성을 피한다.

## 다음 앱 단계

1. 웹과 네이티브에서 공유할 목록은 `/app-config.json`의 `schemaVersion: 1`로 발견한다. `catalog`, `titles`, `waveforms`, `mediaBase`는 설정 문서 기준 상대 URL이다. 기존 `musicList.json` 경로를 곡 ID로 사용하며 한글·공백을 보존한다.
2. Android [Media3 MediaSessionService](https://developer.android.com/media/media3/session/background-playback)에 재생 엔진과 큐를 옮긴다. 알림·잠금화면·헤드셋·오디오 포커스·통화 중단을 함께 구현하고 WebView와 두 엔진이 동시에 재생하지 않도록 한다.
3. `com.readiz.music` 전용 릴리스 서명키를 Git 밖에서 생성·보관한다. 디버그 APK를 정식 앱으로 배포하거나 TV 서명키를 재사용하지 않는다.
4. 실기기에서 최초 재생, 화면 꺼짐, 다른 앱 이동, 절전, 네트워크 전환, 폴드·회전, 블루투스 및 프로세스 복원을 확인한 뒤 릴리스한다.

웹 Media Session과 Android 빌드 성공은 네이티브 백그라운드 재생 보장이 아니다. iOS/Tizen 패키지는 이번 범위에 포함하지 않는다. 설치형 웹앱과 Android 시작 앱은 같은 도메인·미디어 경로를 사용한다.
