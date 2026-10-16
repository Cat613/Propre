import { randomUUID } from 'node:crypto'
import { StageMessageCommand, type StageMessageStatus } from '../../shared/stage-message'
import type { WindowManager } from './windows'
/** Ephemeral Main-owned state. Never added to repository, output, run history or portable files. */
export class StageMessages {
  private value: StageMessageStatus = { revision: 0, message: null, delivery: 'none', stage: null }
  private expiry?: ReturnType<typeof setTimeout>
  private confirmation?: ReturnType<typeof setTimeout>
  private receipts = new Map<string, { signature: string; value: StageMessageStatus }>()
  private sessionId = randomUUID()
  private deadline?: number
  constructor(private windows: WindowManager) {
    windows.onStageReady = () => this.replay()
    windows.onStageClosed = () => {
      if (this.value.message) this.value.delivery = 'unconfirmed'
      this.notify()
    }
    const stop = windows.onEmergencyStop
    windows.onEmergencyStop = () => {
      stop?.()
      this.clear()
    }
  }
  snapshot(): StageMessageStatus {
    const stage = this.windows.windows.get('stage')
    const bounds = stage && !stage.isDestroyed() ? stage.getContentBounds() : null
    return structuredClone({
      ...this.value,
      ...(this.deadline === undefined
        ? {}
        : { remainingMs: Math.max(0, this.deadline - performance.now()) }),
      stage: bounds ? { width: bounds.width, height: bounds.height } : null,
    })
  }
  private notify() {
    this.windows.notify('stage-message-status', this.snapshot())
  }
  private deliver() {
    const stage = this.windows.windows.get('stage')
    if (stage && !stage.isDestroyed()) stage.webContents.send('stage-message', this.snapshot())
  }
  private replay() {
    if (this.value.message && this.deadline !== undefined && this.deadline <= performance.now())
      this.clear()
    else {
      if (this.value.message) this.awaitConfirmation()
      this.deliver()
      this.notify()
    }
  }
  private awaitConfirmation() {
    clearTimeout(this.confirmation)
    this.value.delivery = 'pending'
    const id = this.value.message?.id
    this.confirmation = setTimeout(() => {
      if (id && this.value.message?.id === id) {
        this.value.delivery = 'unconfirmed'
        this.notify()
      }
    }, 3000)
    this.confirmation.unref?.()
  }
  acknowledge(id: string, revision: number, fits: boolean) {
    if (this.value.message?.id !== id || this.value.revision !== revision) return
    clearTimeout(this.confirmation)
    this.value.delivery = fits ? 'displayed' : 'unconfirmed'
    this.notify()
  }
  command(raw: unknown) {
    const command = StageMessageCommand.parse(raw)
    if (command.action === 'send') {
      const prior = this.receipts.get(command.requestId),
        signature = JSON.stringify(command)
      if (prior) {
        if (prior.signature !== signature) throw new Error('요청 ID에 다른 안내가 있습니다.')
        return structuredClone(prior.value)
      }
      if (command.expectedRevision !== this.value.revision)
        throw new Error('무대 안내가 바뀌었습니다. 현재 안내를 확인하고 다시 보내주세요.')
      if (!this.snapshot().stage) throw new Error('무대 화면을 먼저 열어주세요.')
      clearTimeout(this.expiry)
      this.deadline = command.ttl ? performance.now() + command.ttl * 1000 : undefined
      const now = Date.now()
      this.value.revision++
      this.value.message = {
        id: randomUUID(),
        sessionId: this.sessionId,
        revision: this.value.revision,
        text: command.text,
        sentAt: new Date(now).toISOString(),
        ...(command.ttl ? { expiresAt: new Date(now + command.ttl * 1000).toISOString() } : {}),
      }
      this.awaitConfirmation()
      this.deliver()
      this.notify()
      const value = this.snapshot()
      this.receipts.set(command.requestId, { signature, value })
      if (this.receipts.size > 100) this.receipts.delete(this.receipts.keys().next().value!)
      if (command.ttl) {
        this.expiry = setTimeout(() => this.clear(), command.ttl * 1000)
        this.expiry.unref?.()
      }
      return value
    }
    if (command.expectedRevision !== this.value.revision || command.id !== this.value.message?.id)
      throw new Error('무대 안내가 바뀌어 이전 지우기를 취소했습니다.')
    this.clear()
    return this.snapshot()
  }
  clear() {
    this.deadline = undefined
    clearTimeout(this.expiry)
    clearTimeout(this.confirmation)
    this.value = {
      ...this.value,
      revision: this.value.revision + 1,
      message: null,
      delivery: 'none',
    }
    this.deliver()
    this.notify()
  }
}
