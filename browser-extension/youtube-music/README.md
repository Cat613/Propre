# ProPre 유튜브 뮤직 연결 확장

상태: 연결 확장·앱 브리지 구현, 현재 Mac/Chrome에서 앨범 자동 연결·첫 재생 확인 / 배포 설치 수용 전.

## 개발 설치

1. macOS에서 현재 ProPre 개발 빌드 또는 이 소스를 포함한 앱을 실행한다.
2. Chrome의 확장 프로그램 관리 화면에서 개발자 모드를 켜고 이 폴더를 `압축해제된 확장 프로그램 로드`로 선택한다.
3. 확장 팝업의 확장 ID를 복사한다. ProPre의 `미디어 → 음악 → 브라우저 연결`에 입력하고 `연결 프로그램 설정`을 실행한다. 사용자 Chrome의 NativeMessagingHosts에 이 확장 ID만 허용하는 manifest와 사용자 데이터 폴더의 helper launcher를 등록한다. 앱 실행만으로 사용자 Chrome 설정을 등록하지 않는다.
4. 확장 설치/다시 로드 후 기존 유튜브 뮤직 탭을 먼저 새로고침한다. Chrome에서 `music.youtube.com`에 직접 로그인하고 음악을 준비한다. 앱에 링크를 등록하고 `Chrome에서 준비`를 누르면 새 탭이 자동으로 연결된다. 직접 연 탭은 확장 팝업의 `이 탭을 ProPre에 연결`로 수동 연결할 수도 있다.
5. 앱에서 연결 상태·곡/재생목록 대상을 확인한다. 등록 링크와 실제 대상이 다르거나 상태를 읽지 못하면 재생을 비활성화한다. 링크 저장·연결만으로 음악을 자동 재생하지 않는다.

확장 개발 설치는 일반 사용자 배포가 아니다. unpacked 확장 경로가 달라지면 확장 ID가 바뀔 수 있으므로 앱에서 다시 설정한다. 앱 위치를 바꾸면 연결 프로그램을 다시 설정한다. 일반 배포는 확장 ID 고정·Chrome 배포·macOS 패키지/helper 실행을 별도로 검증해야 한다. 시스템 Node 설치를 요구하지 않고 앱의 Electron 실행물로 helper를 실행한다.

## 동작 범위

실제 웹 페이지의 video 요소와 플레이어 제목/대상 링크를 읽고 명시적 play/pause를 요청한다. 사이트가 DOM을 바꾸거나 로그인/콘텐츠/자동재생 정책으로 재생을 막으면 실패할 수 있다. 공식 YouTube Music 원격 재생 API 구현이 아니다. 계정 쿠키·암호·스트림·광고를 수집하거나 변경하지 않는다. native host credential은 사용자 전용 파일 권한으로 보호하고 로그/프로젝트/백업에 포함하지 않는다.

브라우저 연결이 끊겨도 음악은 계속 재생될 수 있다. 앱 전체 중지 성공과 외부 중단 미확인을 구분한다. 서비스 이용·공연/송출 권한과 실제 Google 로그인·광고·지역 호환성은 운영 환경에서 별도 확인한다.

## 제거·복구

Chrome에서 확장을 제거하고, 앱 사용자 데이터 폴더의 `music-host.sh`, `music-host.json`, 그리고 `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.propre.music.json`을 제거하면 연결 설정을 해제할 수 있다. 음악을 먼저 브라우저에서 멈춘다. 앱 이동·ID 변경 후에는 기존 파일을 수동 편집하지 않고 앱의 연결 프로그램 설정으로 다시 등록한다.

## 로컬 자동 검사

`tests/music.test.ts`는 native socket 인증·관측·대상 불일치·단절·수동 확인과 저장/파일 왕복을 검사한다. `tests/music-extension.test.ts`는 합성 DOM에서 지연 play·새 pause·문서 불일치·명령 만료를 검사한다. 실제 유튜브 뮤직 재생 또는 Chrome 확장 설치 성공의 증거는 아니다.

## 탭에 연결할 수 없는 오류

`Could not establish connection. Receiving end does not exist.`는 해당 탭에서 content script가 응답하지 않는 상태다. 확장 설치/다시 로드 전부터 열려 있던 music.youtube.com 탭을 새로고침하고 그 탭에서 다시 연결한다. 계속되면 chrome://extensions에서 확장이 켜져 있는지, music.youtube.com 사이트 접근이 허용돼 있는지 확인하고 확장 다시 로드→탭 새로고침 순서로 진행한다. Native host 설정 완료와 탭 연결 완료는 별개이며 이 오류만으로 host 등록 실패라고 단정하지 않는다. [Chrome 공식 다시 로드 기준](https://developer.chrome.com/docs/extensions/get-started/tutorial/hello-world#reload).


앨범·재생목록 페이지를 연결한 후 ProPre에서 재생하면, 헤더의 재생 버튼을 통해 실제 곡을 로드하고 시작합니다. Chrome에서 먼저 재생할 필요는 없습니다. 연결·상태 확인만으로는 재생하지 않습니다. 초기 로드 중 중지 및 시간 만료 후 늦은 재생도 차단합니다. 앱의 `Chrome에서 준비`로 페이지를 열면 탭 연결도 자동으로 수행합니다. 확장 설치·연결 프로그램 설정은 처음 한 번 필요합니다. 일반 방문한 음악 탭은 자동으로 연결하지 않습니다.
