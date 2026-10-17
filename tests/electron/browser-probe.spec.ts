import { test, expect, _electron as electron } from '@playwright/test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createServer } from 'node:http'

test('a sandbox browser keeps one renderer, form and scroll when moved between windows', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'propre-browser-probe-'))
  const server = createServer((_req, res) => {
    res.setHeader('Content-Type', 'text/html')
    res.end(
      '<body style="height:4000px;background:#abc"><input id="field"><button onclick="document.body.dataset.clicked=\'yes\'">click</button></body>',
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address() as { port: number }
  const app = await electron.launch({
    args: [path.resolve('dist-electron/main.js')],
    env: {
      ...process.env,
      PROPRE_TEST: '1',
      PROPRE_TEST_HEADLESS: '1',
      PROPRE_TEST_USER_DATA: dir,
    },
  })
  try {
    expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(dir)
    const result = await app.evaluate(async ({ BrowserWindow, WebContentsView, session }, url) => {
      const ses = session.fromPartition('propre-probe', { cache: false })
      const view = new WebContentsView({
        webPreferences: {
          session: ses,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
        },
      })
      const first = new BrowserWindow({ show: false, width: 800, height: 600 })
      const second = new BrowserWindow({ show: false, width: 800, height: 600 })
      first.contentView.addChildView(view)
      view.setBounds({ x: 0, y: 0, width: 800, height: 600 })
      try {
        await view.webContents.loadURL(url)
        await view.webContents.executeJavaScript(
          "document.querySelector('#field').value='retained';scrollTo(0,300);document.cookie='fixture=retained'",
        )
        const id = view.webContents.id
        first.contentView.removeChildView(view)
        second.contentView.addChildView(view)
        const state = await view.webContents.executeJavaScript(
          "({value:document.querySelector('#field').value,scroll:scrollY,cookie:document.cookie,bridge:typeof window.ipcRenderer,node:typeof require})",
        )
        const image = await view.webContents.capturePage(undefined, {
          stayHidden: true,
          stayAwake: true,
        })
        view.webContents.sendInputEvent({
          type: 'mouseWheel',
          x: 50,
          y: 50,
          deltaY: 100,
          deltaX: 0,
        })
        return {
          same: view.webContents.id === id,
          ...state,
          capture: !image.isEmpty(),
          size: image.getSize(),
        }
      } finally {
        view.webContents.close()
        first.destroy()
        second.destroy()
      }
    }, `http://127.0.0.1:${address.port}`)
    expect(result).toMatchObject({
      same: true,
      value: 'retained',
      scroll: 300,
      cookie: 'fixture=retained',
      bridge: 'undefined',
      node: 'undefined',
      capture: true,
    })
  } finally {
    const child = app.process()
    if (child.exitCode === null && child.signalCode === null)
      await new Promise<void>((resolve) => {
        child.once('exit', () => resolve())
        child.kill('SIGKILL')
      })
    server.closeAllConnections()
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await fs.rm(dir, { recursive: true, force: true })
  }
})
