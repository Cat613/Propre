# 프로프리 앱 아이콘

2026-10-16 · macOS Dock·응용 프로그램용

- `icon.png`: 투명 여백을 포함한 1254×1254 원본. 이미지 생성 도구로 제작한 남색 타일·흰색 P·파란 송출 화면 심볼이다.
- `icon.icns`: 원본에서 만든 macOS용 16–1024px 표현 묶음. 원본을 변경한 뒤 macOS에서 `npm run icon:build`로 다시 생성한다.
- `package.json`의 `build.mac.icon`이 ICNS를 참조한다. electron-builder가 앱 번들의 `Contents/Resources/icon.icns` 및 Info.plist에 반영한다.
- 개발 실행에서는 `electron/main.ts`가 준비 완료 뒤 같은 원본 PNG를 Dock에 설정한다. 사용자 데이터 폴더 이름은 변경하지 않는다.

이미지를 다시 제작할 때 원본의 투명 배경을 유지한다. 크기 변환에는 macOS의 sips/iconutil을 사용하며 추가 npm 의존성은 없다.
