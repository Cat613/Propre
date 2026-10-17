# 데이터·저장·IPC 계약

2026-10-05 추가: [AI 연결 계약](AI-연결-설계와-계약.md). `ai-command`/`complete-ai-command`는 Main의 진행 중 요청 ID와 컨트롤 발신자를 확인한다. `check-ai-command`는 변경 직전에 세션·권한·종료 상태를 다시 확인한다. 준비 자료 저장은 expectedRevision을 Repository 트랜잭션 안에서 비교하고 현재 작업본 ID를 바꾸지 않는다. 순서 교체는 기존 참조와 SHA-256 revision으로 충돌을 검사한다. 미리보기 역할은 상태 수신·ready/rendered/error만 제공하며 기존 컨트롤·메인·모니터 권한을 확대하지 않는다. 연결 인증 파일은 백업과 Renderer 응답에서 제외한다.

갱신: 2026-10-16 · 제품 0.1.0 로컬 구현 기준 · [공통 모델](../../shared/model.ts) · [스키마](../../shared/schema.ts) · [브릿지 계약](../../shared/contracts.ts)

이 문서는 실제 구현된 계약을 기록한다. 이전 제안에서 사용한 `canvas/style/sessionId` 예시 대신 현재 소스의 `canvasWidth/canvasHeight/globalSlideStyle/version`을 사용한다.

## 자료와 영속 데이터

| 데이터 | 최종 필드·불변 조건 |
| --- | --- |
| Presentation | schemaVersion 1, 고유 id, title, slides, createdAt/updatedAt, 비음수 revision, globalSlideStyle |
| Slide | 발표 내 고유 id, text/image/video/bible, content, styles, backgroundUrl, elements, canvasWidth/Height |
| Element | 요소 내 고유 id, text/image/video/shape, 유한 x/y/width/height/zIndex, 명시 percent 또는 pixel, opacity/rotation 범위 |
| Text | elements가 있으면 배열 순서의 text가 원본. content는 표시·호환용 파생 값. 요소가 없으면 legacy content를 사용 |
| 편집 | 인라인/일괄 내용 변경은 첫 텍스트 요소에 쓰고 다른 텍스트 요소를 합친다. 이미지·영상·도형은 유지. 캔버스에서 여러 요소를 따로 편집할 수 있음 |
| Style | 자료의 globalSlideStyle + 지원 로컬 styles. 기본 프리셋 지정 시 자료 선택·첫 송출·찬양/성경 종류 전환에 자동 적용, 지정 없음은 자료의 저장 스타일 복원. 같은 종류 진행 중 직접 조정과 개별 사용자 스타일 유지. ADR-010 참조 |
| Playlist | 디스크에는 id/presentationId 참조를 기록. 현재 콘티의 곡 사본과 전체 계획의 곡 투영에서 표시를 계산. 원곡과 사본을 분리하고 누락·공유 참조를 검증 |
| Media | id/type/url/name과 에셋 등록 메타데이터. 실제 경로는 Main 내부 상대 filename, Renderer에는 등록 URL |
| Draft | 마지막 편집/선택 자료. ID별 journal와 저장 대기열은 실패·중단 때 최신 작업본을 보존 |
| Settings | Looks·크로마키·프리셋·기본 프리셋·Stage 글자 크기·AI 모델. 키 원문은 별도 보호 저장 |

단위 없는 legacy 좌표는 기존의 각 값 ≤100이면 percent였던 표시를 한 번 보존해 percent로 변환한다. 새 요소는 단위를 명시하며 pixel 요소는 논리 캔버스 크기에 맞춰 렌더링한다. 기본 캔버스는 1920×1080이며 자료가 지정한 크기도 지원한다.

## 저장 파일과 제한

`workspace-v4.json`에는 schemaVersion 4, library, playlist, setlists, setlistSongs, activeSetlistId, draft, settings, media, assets, outputResources, cuePresentations, cueResources, serviceTemplates, songReceipts, deletedLibrary, deletedMedia, 출력/모니터 장비 ID·활성 플래그를 저장한다. 전체 계획은 setlists에 연결한다. 이전 작업 공간 v1/v2/v3 원본과 백업은 보존한다. API 키는 `key-v1.json`의 OS 암호문이며 일반 문서·백업에 들어가지 않는다.

한 상태 기록과 IPC 요청은 24MiB, 발표 최대 3,000 슬라이드, 슬라이드 최대 500 요소, 라이브러리 최대 5,000 발표, 순서·에셋 최대 10,000 항목이다. 개별 미디어는 100MiB, 휴대용 파일은 200MiB다. 수량 제한과 바이트 제한을 모두 충족해야 한다.

Repository 작업은 직렬화한다. 중첩 검증과 최종 기록 성공 전에는 저장소 메모리 상태를 확정하지 않는다. `.bak1`~`.bak5`와 손상 원본 보관·유효 상태 복구가 있으며, 미래 버전·불유효 상태는 원본 보호 상태로 거절한다.

## 휴대용 .ppros

확장자는 기존과 같이 JSON이다. ZIP으로 조용히 바꾸지 않았다.

```json
{
  "format": "propre-project",
  "schemaVersion": 1,
  "kind": "presentation",
  "presentations": [],
  "assets": []
}
```

`presentations`는 위 모델을 따른다. `assets`에는 id, name, type, extension, sha256, base64 data가 들어간다. 위 예시는 단일 자료 형식 1이다. 현재 `kind: backup`은 형식 3으로 playlist, settings, media, draft와 콘티/사본·예배 계획·외부 자료·템플릿을 포함한다. `service`와 `service-template`도 형식 3이며 곡 순서 파일은 형식 1이다. 이전 백업 형식 1/2는 읽기를 유지한다. 사용자 절대 경로·보호 키는 포함하지 않는다. 가져오기는 에셋 해시·참조·유효 버전을 확인하고 충돌 에셋은 새 ID로 연결한다. 원본 파일은 수정하지 않는다.

이전 `{ title, slides }`, 배열, `{ type: library, data }`도 읽는다. 가져온 자료는 새 ID로 저장한다. 이전 file URL은 관리된 미디어만 변환하고 외부/누락 파일은 재연결용 등록으로 보관한다. 본문에 적힌 URL 텍스트와 실제 미디어 URL 필드는 구분한다. 전체 백업 복원은 명시 확인 후 현재 자료·순서·설정 교체와 화면 중단을 수행한다.

## IPC 권한

역할은 Renderer의 문자열만으로 신뢰하지 않고 Main이 생성한 창·webContents·main frame·origin으로 검사한다. generic invoke는 제공하지 않는다. 공통 API 타입의 모든 메서드가 모든 창에 노출되는 것은 아니며 preload가 역할별로 줄여 제공한다.

| 역할 | 실제 허용 범위 |
| --- | --- |
| Control | bootstrap, 자료/순서/설정 저장, 미디어 등록/복구/정리, 프로젝트/백업, 창/장비 변경, 키 상태/등록/삭제, AI/취소, 상태 발행/종료 응답 |
| Main | 자신의 ready/applied/media-error, update-screen 수신 |
| Stage | 자신의 ready/applied/media-error, update-stage 수신 |

출력 창에서 자료 저장·키 조회·다른 화면 변경, 알 수 없는 frame/role/screenId, 범용 채널·크기 초과·잘못된 중첩 입력을 거절한다. 파일 시스템 오류를 개인 경로가 든 원문으로 UI에 내보내지 않는다.

## 상태와 요청 수명

- `route-screen-update`와 `update-stage`는 검증된 전체 상태다. Main이 화면별 증가 version을 붙이고 ready 뒤 최신 상태를 재전달한다.
- StageData는 current/next Slide, 선택 자료의 globalSlideStyle, 모니터 currentFontSize/nextFontSize를 포함한다. 구절은 Slide.bibleReference다. 스타일이 없는 이전 상태는 기본 스타일로 표시하며 새 스타일은 GlobalStyle 스키마로 검증한다. 메인/모니터는 shared/presentation-style.ts의 글꼴·색상·정렬·굵기·줄 간격 규칙을 공유한다. Stage 본문 크기는 설정값 이하에서 영역에 맞추고, 구절은 별도 줄에서 방향을 따른다.
- Renderer는 오래된 version을 무시하고 DOM 반영 후 applied를 보고한다. health는 closed/loading/applied/error이며 물리 출력의 증거와 구분한다.
- 파일 작업은 success/canceled/error를 구분한다. 저장·순서·설정 실패는 호출부로 전달하며 현재 편집 내용과 실패 상태를 유지한다.
- AI는 등록 PNG/JPEG/WebP 10MiB 이하, 설정 모델, 단일 요청 ID, 45초 제한, 취소를 사용한다. Renderer가 대상 자료/슬라이드 상태를 확인하고 오래된 결과를 적용하지 않는다.
- 종료는 편집 반영·자료·설정·미디어의 기록 완료 응답을 기다리고 오류/시간 제한 때 창을 유지해 복구할 수 있게 한다.

검사 근거는 [후속 검증](../quality/2026-10-04-운영-개선-후속-검증.md), 사용자 절차는 [운영 가이드](../operations/준비-진행-종료-장애-대응.md)에 연결한다.

## 플레이리스트 파일 계약 (2026-10-05)

`propre-project` / `schemaVersion: 1`에 `kind: playlist`를 추가한다. 기존 presentation/backup과 확장자 `.ppros`를 유지한다. 필수 playlist는 고유 항목 ID/presentationId 참조이며 presentations에 모두 대응하고 포함 자료는 모두 순서에 사용되어야 한다. 자료 중복 본문은 포함하지 않되 같은 presentationId 반복 순서는 허용한다. assets는 참조 미디어의 SHA-256/base64/등록 메타데이터이며 곡 텍스트에 URL 모양의 문자열이 있어도 미디어 필드 참조로 해석하지 않는다. playlist 파일의 settings/media/draft 혼입과 중복 asset ID를 거절한다. 기존 파일/백업 크기 제한을 적용한다.

Control 전용 `save-playlist-file(expectedRefs)` / `load-playlist-file(expectedRefs)`를 브릿지에 추가한다. Renderer의 직렬 순서 대기열과 편집 flush를 거쳐 실행한다. 저장은 현재 참조를 비교하고 곡·참조 미디어의 사본을 만든 다음 시스템 저장창/atomicWrite를 수행한다. 불러오기는 파일을 한 번 읽고 순서 확인 후 동일 bytes를 적용한다. 시작 참조와 현재 디스크 참조의 불일치 및 잘못된 파일을 거절한다. 응답은 success/canceled/error와 성공 시 added/reused/itemCount이다.

불러오기에서 자료 내용의 정규화 서명을 비교해 같은 자료를 재사용하고 새 자료에는 새 ID/revision 0을 부여한다. 수정 시각 및 문서/슬라이드/요소 ID를 제외한 제목·슬라이드·globalSlideStyle을 비교한다. 미디어 내용이 같은 등록 자료는 재사용하고 ID가 충돌하면 새 ID 및 media 필드 URL만 치환한다. 자료 본문의 URL 문자열은 유지한다. 자료 추가·에셋 등록·순서 교체를 한 transaction으로 저장하고 순서 비교를 다시 수행한다. 실패하면 새로 만든 미디어 파일을 정리한다. 저장 성공 후 Renderer는 library/playlist/mediaBin만 갱신한다. 기존 draft/selected/active/output/settings와 편집 이력을 바꾸지 않는다. 일반 프로젝트 불러오기에서는 playlist 전용 버튼을 안내하며 전체 백업만 restore 경로를 사용한다.

## 예배별 사본과 v2 작업 공간 (2026-10-06 적용)

[콘티 보관함 계약](콘티-보관함과-예배별-곡-사본.md)을 따른다. 이 절은 2026-10-06에 도입한 workspace-v2/schemaVersion 2의 사본 계약이다. 현재 파일은 workspace-v4.json이며 v1/v2/v3 원본을 보존한다. library는 원곡, setlistSongs는 독립 곡 사본, setlists는 이름/날짜/revision/순서/휴지통, activeSetlistId는 현재 콘티다. playlist.presentationId는 사본 ID이고 현재 콘티 items와 동일하다. 원곡과 사본의 ID 중복·콘티간 공유·누락 참조·현재 순서 불일치를 거절한다. saveDraft/savePrepared는 사본을 찾아 그 사본만 저장한다. 현재 콘티를 바꾸더라도 draft/선택/송출을 바꾸지 않는다.

manage-setlist는 명령 및 revision/current ID를 검증한다. publish-setlist-song은 native 본문 확인 전후 사본/원곡 버전을 비교한 별도 원곡 갱신이다. Control만 호출할 수 있다. 백업에는 보관함/사본/현재 ID를 포함하며 이전 백업은 순서에서 사본을 만들어 복원한다. playlist 파일에는 선택 playlistName/playlistDate를 포함하고 불러오기는 원곡 등록/재사용 후 새 콘티에 사본을 만든다. 메인/모니터와 기존 AI 권한은 확대하지 않는다.

## 웹·PDF 독립 소스와 v3 작업 공간 (2026-10-12)

[상세 계약](URL-브라우저-PDF-송출-상세-설계.md)과 [검증](../quality/2026-10-12-URL-PDF-송출-검증-기록.md)을 따른다. 이 절의 도입 당시 파일은 workspace-v3.json/schemaVersion 3이었다. 현재는 workspace-v4.json으로 이전하며 기존 v1/v2/v3 원본은 보존한다. media의 image/video/audio와 별도로 outputResources에 web/pdf를 저장하며 PDF 에셋은 document/.pdf다. 당시 외부 자료 백업은 propre-project/schemaVersion 2/kind backup이었다. 현재 전체 백업은 schemaVersion 3이며 단일 자료·곡 순서는 schemaVersion 1을 유지한다.

출력 source는 Main OutputSource가 관리하고 layers snapshot은 기존 중앙 runtime 발행을 유지한다. 준비는 token/revision/generation으로 검증하며 commit/applied 뒤 상태를 통지한다. Control만 등록·준비·전환·조작할 수 있다. 외부 브라우저는 역할·preload·앱 브릿지가 없고 별도 비영속 session이다. pdf-helper는 자기 frame/origin/request ID의 ready/result만 보낼 수 있고 읽기 토큰으로 현재 요청의 PDF bytes만 받는다. output: 프로토콜은 원격 session에 등록하지 않는다. large PDF는 일반 IPC base64 대신 토큰 기반 읽기를 사용한다.

2026-10-13 검토 반영: PDF VisualSource는 송출에 확정한 `rotation`을 포함한다(기존 snapshot 호환을 위해 optional). PDF 썸네일 요청도 optional rotation을 검증하고 준비 패널의 회전을 사용한다. PDF 준비 위치 저장 후 `output-resources-changed`로 목록을 갱신한다. 웹 native attach 뒤에는 browser 수명과 coordinator generation을 다시 확인하며, 자동 detach는 창 표시·focus를 요청하지 않는다.

2026-10-13 준비 조작 개선: OutputResource의 optional `deletedAt`을 저장해 활성 목록에서 숨기고 PDF 원본 참조를 유지한다. 관리 명령 `restore`는 id/revision을 검증해 복원한다. `recover-deleted`는 최근 5개 저장 복사본에서 현재에 없는 자료 하나를 복원하며 PDF asset/hash를 대조한다. 현재 문서·콘티·설정은 바꾸지 않는다. 준비 창 resize는 view bounds 갱신과 준비 generation 무효화만 수행하고 재확인은 사용자 창 크기를 강제 변경하지 않는다.

## WSP 예배 운영 계약 (2026-10-16)

현재 미배포 예배 확장 묶음은 workspace-v4, portable schema3(backup/service/service-template)를 사용한다. 이전1/2/3 workspace 원본·최근 백업은 보존한다. ServicePlan의 곡 투영과 setlist.items, 독립된 소유 문서/resource/템플릿 사본을 하나의 Repository transaction으로 검증한다. 자세한 스키마/이전/실행 계약은 [WSP 공통 계약](../design/worship/예배-운영-기능-공통-계약.md), 사용자 흐름은 [운영 안내](../operations/예배-전체-순서-사용-안내.md)를 따른다.

Control 전용 typed API는 계획·자료 연결·prepare/commit·세션·점검·구간·타이머·템플릿·큐시트 출력을 제공한다. sender role/frame/origin 검사를 공통 handle 경로에 유지하고 strict payload/requestId/revision 및 source generation 검증을 각 서비스에서 수행한다. 예배 진행/중단 상태도 업데이트 설치 guard에 포함한다.

StageMessage/StageTimer는 청중 OutputSchema와 별도인 Main 소유 일시 snapshot이다. 저장 메모와 일시 전송을 구분하고 ack/TTL/F2/restart를 검사한다. 세션/점검/타이머 checkpoint는 workspace와 분리하며 실제 실행을 자동 복원하지 않는다. 인쇄는 고정 revision allowlist DTO·독립 sandbox renderer·불투명 UUID PDF job을 사용하며 전체 원본/경로/실행 상태를 전달하지 않는다. [최종 검증 및 한계](../quality/2026-10-16-큐시트-PDF-인쇄와-최종-회귀.md).

## 음악 병행·workspace-v5 / 휴대용4 (2026-10-17)

현재 개발 작업 트리는 v5/휴대용4다. 이전 v4 원본·백업을 보존해 읽고 새 파일에 기록한다. Setlist.music과 ServiceTemplate.music은 로컬 구간/음량/반복/페이드 또는 안전한 유튜브 뮤직 링크/로컬 대체 파일이다. ServicePlan1의 선택적 musicPreparationId는 같은 예배의 음악을 참조하며 복제·파일 가져오기에 재매핑한다. 과거 v4/휴대용3 절은 도입 시점 기록이고 새 기록의 형식으로 사용하지 않는다.

[현재 구현 계약](../design/music/05-미디어-통합과-송출-미리보기-구현-설계.md)을 따른다. save-music은 예배 revision과 음악 item revision을 검사하는 Control 전용 저장이다. 음악/대체 파일을 예배·템플릿·전체 백업 에셋 수집에 포함한다. 기존 개별100MiB·휴대용200MiB·상태24MiB 한도는 유지한다. 런타임 재생/준비/Undo 파일은 session pin으로 정리에서 보호한다.

music-bridge/open-music-url/show-music-extension/pin-music은 Control 전용이다. 외부 URL은 music.youtube.com의 HTTPS watch/playlist만 허용한다. 브라우저 음악 연결 인증은 사용자 전용 파일 권한으로 보호하며 워크스페이스·내보내기·로그에서 제외한다. 실제 음악은 Control 단일 요소 또는 외부 Chrome 탭에서 재생하고 Output/Stage에는 별도 요소를 생성하지 않는다. 실제 Chrome 설치/계정/DOM·음향 수용은 별도다.
