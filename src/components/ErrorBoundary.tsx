import { Component, type ReactNode } from 'react'
export default class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch() {
    window.ipcRenderer?.reportMediaError()
  }
  render() {
    return this.state.failed ? (
      <div className="h-screen bg-black text-white flex flex-col items-center justify-center gap-4">
        <p>화면을 복구할 준비가 되었습니다.</p>
        <button className="bg-blue-600 px-4 py-2 rounded" onClick={() => location.reload()}>
          최근 자동 저장 자료로 다시 열기
        </button>
      </div>
    ) : (
      this.props.children
    )
  }
}
