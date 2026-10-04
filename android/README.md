# Readiz Music Android 0.3.1

휴대전화와 Android TV에서 같은 `com.readiz.music` APK를 사용한다. 웹 화면은 `https://music.readiz.com/`에서 받고, Android 재생은 Media3 `PlaybackService`가 담당한다.

## 설치와 업데이트

- 최신 정식 APK: **https://music.readiz.com/app.apk**
- 실행·백그라운드 복귀 때마다 `/android-update.json`을 확인한다. 새 버전이 있으면 업데이트/나중에를 표시하며 재생 중에는 안내를 미룬다. 나중에를 눌러도 다음 앱 진입에 다시 확인한다.
- 업데이트를 선택하면 파일의 크기·SHA-256·패키지 ID·versionCode를 확인하고 Android 설치 화면을 연다. Android 8 이상에서 출처 허용이 필요하면 설정으로 안내하고 돌아온 뒤 설치를 계속한다. Android 시스템의 설치 확인은 필요하다.
- 기존 0.2.0에는 업데이트 기능이 없으므로 이번 버전은 직접 설치해야 한다. 기존 디버그 APK와 정식 APK는 서명이 달라 **디버그 앱 삭제 후 정식 앱 설치**가 필요하다. 이때 앱에 저장한 앨범 선택 설정이 초기화된다. 이후 정식 버전은 같은 키로 업데이트한다.
- 정식 서명키는 저장소 밖 `~/.config/readiz-music/android-signing/`에 보관한다. 이 디렉터리를 안전하게 백업해야 하며 TV 서명키를 공유하지 않는다. 키가 일부만 있으면 빌드를 중단한다.

## 알림과 백그라운드 재생

[Media3 MediaSessionService](https://developer.android.com/media/media3/session/background-playback)가 알림창·잠금화면·헤드셋에 재생 상태와 제목·앨범아트를 제공한다. 이전 곡, 재생/일시정지, 다음 곡, 재생 위치를 시스템 미디어 세션과 연결한다. 실제 표시 형태는 Android 버전에 따른다.

큐와 반복/자동 다음 곡 설정을 서비스가 소유하므로 화면 꺼짐과 다른 앱 이동 중에도 곡을 이어간다. 앱을 다시 열거나 웹 화면이 재생성되면 서비스의 곡·위치·큐를 받아 복원하며 웹 audio는 재생하지 않는다. 오디오 포커스와 이어폰 분리를 처리한다. TV에서 종료를 확정하면 큐를 비우고 알림을 종료한다. 음악 재생 중 최근 앱 목록에서 화면만 없애도 서비스는 유지한다. 시스템이 프로세스를 종료하거나 기기를 재부팅한 뒤에는 자동 재생하지 않는다.

브리지는 AndroidX WebKit 메시지 포트를 사용하며 HTTPS 음악 원점의 메인 프레임만 접근한다. 재생 URL도 `/music/` 아래로 제한한다. 외부 링크는 외부 브라우저에서 열고 인증서 오류는 차단한다. 오래된 WebView에 메시지 포트 기능이 없으면 기존 웹 플레이어로 동작하므로 Android System WebView를 갱신해야 네이티브 알림을 쓸 수 있다.

## 빌드와 배포

JDK 17, Android SDK 36, build-tools 35.0.0, Gradle 8.13이 필요하다. 로컬에서는 TV 프로젝트가 설치한 **Gradle 실행기만** 재사용한다. 다른 환경에서는 `MUSIC_GRADLE_BIN`, `JAVA_HOME`, `ANDROID_HOME`을 지정한다.

```sh
npm run build:apk        # 정식 서명, lint, 단위 테스트, APK + 메타데이터
npm run build:apk:debug  # 개발/에뮬레이터 확인용
# 의도한 소스 커밋 후
npm run deploy:local
```

정식 빌드는 `output/android/readiz-music.apk`와 `.apk.json`을 만든다. 웹 빌드는 실제 APK와 메타데이터의 해시·크기가 일치해야 공개 산출물에 `app.apk`/`android-update.json`을 넣는다. 정적 배포는 웹·APK·메타데이터를 같은 릴리스에 복사한 뒤 `current` 링크를 원자적으로 전환한다. APK가 없는 로컬/CI 웹 빌드는 허용하지만 운영 배포는 APK 누락이나 불일치를 거부한다.

TV의 리모컨, Leanback 실행기·배너, TV 화면 진입과 폴드·회전 시 Activity 유지 정책은 유지한다. 삼성 TV WGT는 [별도 Tizen 안내](../tizen/README.md)를 따른다. 단위 테스트·브라우저·에뮬레이터 결과와 실제 휴대전화/TV의 절전·블루투스·설치 확인은 구분한다.

## 앱 로그인

0.3.1부터 Discord 로그인은 시작 주소부터 외부 브라우저에서 연다. 이전 버전은 WebView에 state 쿠키를 만든 후 Discord만 브라우저로 넘겨 콜백에서 쿠키 검증에 실패할 수 있었다. 로그인 완료 화면의 **뮤직앱으로 돌아가기**를 누르면 앱 내부 세션을 저장하고 음악 추가 화면을 연다.

앱은 임의 verifier를 비공개 설정에 저장하고 SHA-256 challenge만 시작 주소에 전달한다. 서버는 기존 브라우저 state 쿠키와 계정 허용 목록을 검증한 뒤 2분짜리 일회용 ticket을 발급한다. `com.readiz.music://auth`에는 ticket만 들어가고, 이를 가로채도 verifier 없이는 세션을 받을 수 없다. 고정 HTTPS 경로에서 ticket과 verifier를 교환한 뒤 Secure/HttpOnly 세션 쿠키를 WebView에 저장한다. OAuth 토큰과 세션 쿠키는 앱 복귀 주소에 넣지 않는다. Android가 브라우저 로그인 중 앱을 종료해도 verifier는 12분 동안 유지한다.

0.3.0 정식 앱에서는 앱을 다시 열어 표시되는 업데이트로 설치할 수 있다. 0.3.1도 같은 정식 서명 키를 사용한다. 서버 인증·교환 테스트와 Android 단위 테스트는 모의 계정으로 검증하며, 실제 Discord 계정의 휴대전화 로그인 성공을 뜻하지 않는다.
