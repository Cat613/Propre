document.getElementById('extension-id').value = chrome.runtime.id
document.getElementById('bind').onclick = async () => {
  try {
    const r = await chrome.runtime.sendMessage({ action: 'bind' })
    document.getElementById('status').textContent =
      r.error || '탭 연결을 요청했습니다. ProPre에서 실제 연결 상태를 확인해주세요.'
  } catch {
    document.getElementById('status').textContent = 'ProPre를 실행하고 연결 설정을 확인해주세요.'
  }
}
