import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { musicURL } from '../../shared/music'

const execute = promisify(execFile)
const launchChrome = (file: string, args: string[]) => execute(file, args, { timeout: 10000 })

export async function openMusicInChrome(
  input: string,
  dependencies: {
    platform?: NodeJS.Platform
    launch?: (file: string, args: string[]) => Promise<unknown>
  } = {},
) {
  const target = new URL(musicURL(input))
  const marker = new URL(input).hash.match(/^#propre-connect=([a-f0-9]{64})$/)
  if (marker) target.hash = `propre-connect=${marker[1]}`
  const url = target.href
  if ((dependencies.platform ?? process.platform) !== 'darwin')
    throw new Error('Chrome에서 음악 준비는 현재 macOS에서 지원합니다.')
  try {
    // The music connector lives in Chrome, regardless of the default browser.
    await (dependencies.launch ?? launchChrome)('/usr/bin/open', ['-b', 'com.google.Chrome', url])
  } catch {
    throw new Error(
      'Google Chrome에서 링크를 열지 못했습니다. Chrome 설치 여부와 실행 상태를 확인해주세요.',
    )
  }
}
