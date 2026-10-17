function connectionError(message) {
  if (message?.includes('Receiving end does not exist') || message?.includes('Could not establish connection'))
    return '유튜브 뮤직 탭을 새로고침한 뒤 다시 연결해주세요. 확장을 설치하거나 다시 로드한 뒤에는 탭 새로고침이 필요합니다.'
  return message || 'ProPre를 실행하고 연결 설정을 확인해주세요.'
}
document.getElementById('extension-id').value = chrome.runtime.id
document.getElementById('bind').onclick = async () => {
  try {
    const r = await chrome.runtime.sendMessage({ action: 'bind' })
    document.getElementById('status').textContent =
      r.error ? connectionError(r.error) : '탭 연결을 요청했습니다. ProPre에서 실제 연결 상태를 확인해주세요.'
  } catch (error) {
    document.getElementById('status').textContent = connectionError(error.message)
  }
}
