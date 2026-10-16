import { randomUUID } from 'node:crypto'
import type { z } from 'zod'
import { ServiceTemplateSchema } from '../../shared/schema'
import {
  TemplateCommand,
  type TemplateSource,
  type TemplateAction,
} from '../../shared/service-template'
import type { CueItem, CueBindingSchema } from '../../shared/service-plan'
import type { RepositoryState } from './repository'
import type { Presentation } from '../../src/types'
import { DEFAULT_STYLE } from '../../shared/model'
export type ServiceTemplate = z.infer<typeof ServiceTemplateSchema>
const clone = <T>(value: T): T => structuredClone(value)
type Binding = z.infer<typeof CueBindingSchema>
function libraryMaterial(state: RepositoryState, source: TemplateSource) {
  if (source.kind === 'presentation') {
    const p = state.library.find((p) => p.id === source.id)
    if (
      !p ||
      (p.revision || 0) !== source.revision ||
      !p.slides.some((slide) => slide.id === source.slideId)
    )
      throw new Error('선택한 원곡/자료가 바뀌었습니다. 다시 선택해주세요.')
    return { presentation: p, slideId: source.slideId }
  }
  const r = state.outputResources.find((r) => r.id === source.id && !r.deletedAt)
  if (
    !r ||
    r.revision !== source.revision ||
    (r.kind === 'pdf'
      ? !source.page || source.page > r.pageCount
      : source.page !== undefined || source.rotation !== undefined)
  )
    throw new Error('선택한 외부 자료가 바뀌었습니다. 다시 선택해주세요.')
  return { resource: r, page: source.page, rotation: source.rotation }
}
function addFixed(target: ServiceTemplate, material: ReturnType<typeof libraryMaterial>): Binding {
  if ('presentation' in material && material.presentation) {
    const p = { ...clone(material.presentation), id: 'template_' + randomUUID(), revision: 0 }
    target.presentations.push(p)
    return { kind: 'presentation', presentationId: p.id, slideId: material.slideId! }
  }
  const resource = { ...clone(material.resource!), id: randomUUID(), revision: 0 }
  target.resources.push(resource)
  return {
    kind: 'resource',
    resourceId: resource.id,
    ...(resource.kind === 'pdf' ? { page: material.page!, rotation: material.rotation || 0 } : {}),
  }
}
function serviceMaterial(
  state: RepositoryState,
  listId: string,
  cue: CueItem,
): ReturnType<typeof libraryMaterial> {
  const list = state.setlists.find((list) => list.id === listId)!
  if (cue.kind === 'song') {
    const p = state.setlistSongs.find(
      (entry) =>
        entry.presentation.id ===
        list.items.find((row) => row.id === cue.songItemId)?.presentationId,
    )?.presentation
    if (!p?.slides.length) throw new Error('빈 찬양은 고정 자료로 저장할 수 없습니다.')
    return { presentation: p, slideId: p.slides[0].id }
  }
  const binding = cue.binding
  if (binding?.kind === 'presentation') {
    const p = state.cuePresentations.find(
      (entry) =>
        entry.ownerSetlistId === listId && entry.presentation.id === binding.presentationId,
    )?.presentation
    if (p) return { presentation: p, slideId: binding.slideId }
  }
  if (binding?.kind === 'resource') {
    const r = state.cueResources.find(
      (entry) => entry.ownerSetlistId === listId && entry.resource.id === binding.resourceId,
    )?.resource
    if (r) return { resource: r, page: binding.page, rotation: binding.rotation }
  }
  throw new Error('고정 자료를 먼저 연결해주세요.')
}
export function copyTemplate(source: ServiceTemplate): ServiceTemplate {
  const copy = clone(source),
    presentationIds = new Map(copy.presentations.map((p) => [p.id, 'template_' + randomUUID()])),
    resourceIds = new Map(copy.resources.map((r) => [r.id, randomUUID()]))
  copy.id = randomUUID()
  copy.revision = 0
  delete copy.deletedAt
  delete copy.lastUsedAt
  copy.createdAt = copy.updatedAt = new Date().toISOString()
  copy.presentations = copy.presentations.map((p) => ({
    ...p,
    id: presentationIds.get(p.id)!,
    revision: 0,
  }))
  copy.resources = copy.resources.map((r) => ({ ...r, id: resourceIds.get(r.id)!, revision: 0 }))
  for (const item of copy.items) {
    item.id = randomUUID()
    if (item.binding?.kind === 'presentation')
      item.binding.presentationId = presentationIds.get(item.binding.presentationId)!
    else if (item.binding?.kind === 'resource')
      item.binding.resourceId = resourceIds.get(item.binding.resourceId)!
  }
  return copy
}
function trimMaterials(template: ServiceTemplate) {
  template.presentations = template.presentations.filter((p) =>
    template.items.some(
      (item) => item.binding?.kind === 'presentation' && item.binding.presentationId === p.id,
    ),
  )
  template.resources = template.resources.filter((r) =>
    template.items.some(
      (item) => item.binding?.kind === 'resource' && item.binding.resourceId === r.id,
    ),
  )
}
export function mutateTemplate(state: RepositoryState, raw: unknown) {
  const command = TemplateCommand.parse(raw),
    now = new Date().toISOString()
  if (command.action === 'save-from-service') {
    if (state.serviceTemplates.length >= 200)
      throw new Error('템플릿은 휴지통 포함200개까지 보관할 수 있습니다.')
    const list = state.setlists.find((list) => list.id === command.setlistId && !list.deletedAt)
    if (!list?.servicePlan || list.revision !== command.expectedRevision)
      throw new Error('예배 내용이 바뀌었습니다. 다시 저장해주세요.')
    if (
      list.servicePlan.items.length > 1000 ||
      new Set(command.fixedCueIds).size !== command.fixedCueIds.length ||
      command.fixedCueIds.some((id) => !list.servicePlan!.items.some((cue) => cue.id === id))
    )
      throw new Error('템플릿 순서/고정 자료를 확인해주세요.')
    const template: ServiceTemplate = {
      id: randomUUID(),
      revision: 0,
      name: command.name,
      description: command.description,
      timezone: list.servicePlan.timezone,
      createdAt: now,
      updatedAt: now,
      items: [],
      presentations: [],
      resources: [],
    }
    for (const cue of list.servicePlan.items) {
      const fixed = command.fixedCueIds.includes(cue.id)
      template.items.push({
        id: randomUUID(),
        kind: cue.kind,
        title: cue.title,
        durationSeconds: cue.durationSeconds,
        enter: clone(cue.enter),
        timer: clone(cue.timer),
        leader: command.includeLeaders ? cue.leader : undefined,
        operatorNote: command.includeOperatorNotes ? cue.operatorNote : undefined,
        stageNote: command.includeStageNotes ? cue.stageNote : undefined,
        materialMode: fixed ? 'fixed' : 'slot',
        slotName: fixed ? undefined : cue.title.slice(0, 100),
        required: cue.kind === 'song' || cue.enter.visual === 'bound',
        ...(fixed ? { binding: addFixed(template, serviceMaterial(state, list.id, cue)) } : {}),
      })
    }
    state.serviceTemplates.push(ServiceTemplateSchema.parse(template))
    return
  }
  const template = state.serviceTemplates.find(
    (entry) => entry.id === command.id && (command.action === 'restore' || !entry.deletedAt),
  )
  if (!template || template.revision !== command.expectedRevision)
    throw new Error('템플릿이 바뀌었습니다. 다시 열어주세요.')
  if (command.action === 'duplicate') {
    if (state.serviceTemplates.length >= 200)
      throw new Error('템플릿은200개까지 보관할 수 있습니다.')
    const copy = copyTemplate(template)
    copy.name = (copy.name + ' 복사본').slice(0, 100)
    state.serviceTemplates.push(copy)
    return
  }
  if (command.action === 'delete' || command.action === 'restore') {
    if (command.action === 'delete') template.deletedAt = now
    else delete template.deletedAt
    template.revision++
    template.updatedAt = now
    return
  }
  if (command.action === 'update') {
    template.name = command.name
    template.description = command.description
    template.items = clone(command.items)
    for (const item of template.items) {
      if (item.materialMode === 'slot') delete item.binding
      else if (command.sources[item.id])
        item.binding = addFixed(template, libraryMaterial(state, command.sources[item.id]))
    }
    if (
      Object.keys(command.sources).some(
        (id) => !template.items.some((item) => item.id === id && item.materialMode === 'fixed'),
      )
    )
      throw new Error('고정 자료의 대상 순서를 확인해주세요.')
    trimMaterials(template)
    template.revision++
    template.updatedAt = now
    ServiceTemplateSchema.parse(template)
    return
  }
  if (command.action === 'instantiate') instantiate(state, template, command, now)
}
function instantiate(
  state: RepositoryState,
  template: ServiceTemplate,
  command: Extract<TemplateAction, { action: 'instantiate' }>,
  now: string,
) {
  if (
    state.activeSetlistId !== command.expectedActiveId ||
    (state.setlists.find((list) => list.id === state.activeSetlistId)?.revision ?? null) !==
      command.expectedActiveRevision
  )
    throw new Error('현재 예배가 바뀌었습니다. 새 예배 만들기를 다시 열어주세요.')
  if (
    Object.keys(command.slots).some(
      (id) => !template.items.some((item) => item.id === id && item.materialMode === 'slot'),
    )
  )
    throw new Error('템플릿 슬롯을 확인해주세요.')
  const list: RepositoryState['setlists'][number] = {
    id: randomUUID(),
    revision: 0,
    title: command.title,
    date: command.date,
    createdAt: now,
    updatedAt: now,
    lastOpenedAt: now,
    items: [],
    servicePlan: {
      version: 1,
      timezone: template.timezone,
      plannedStartAt: command.plannedStartAt,
      items: [],
    },
  }
  for (const item of template.items) {
    const cue: CueItem = {
      id: randomUUID(),
      kind: item.kind,
      title: item.title,
      leader: item.leader,
      durationSeconds: item.durationSeconds,
      operatorNote: item.operatorNote,
      stageNote: item.stageNote,
      enter: clone(item.enter),
      timer: clone(item.timer),
    }
    const source = command.slots[item.id]
    const binding = item.binding
    let material: ReturnType<typeof libraryMaterial> | undefined
    if (item.materialMode === 'slot' && source) material = libraryMaterial(state, source)
    else if (item.materialMode === 'fixed' && binding?.kind === 'presentation')
      material = {
        presentation: template.presentations.find((p) => p.id === binding.presentationId)!,
        slideId: binding.slideId,
      }
    else if (item.materialMode === 'fixed' && binding?.kind === 'resource')
      material = {
        resource: template.resources.find((r) => r.id === binding.resourceId)!,
        page: binding.page,
        rotation: binding.rotation,
      }
    if (cue.kind === 'song') {
      if (material && !material.presentation)
        throw new Error('찬양 슬롯에는 슬라이드 자료를 선택해주세요.')
      const presentation: Presentation = material?.presentation
        ? { ...clone(material.presentation), id: 'setlist_' + randomUUID(), revision: 0 }
        : {
            id: 'setlist_' + randomUUID(),
            title: cue.title,
            slides: [],
            globalSlideStyle: clone(DEFAULT_STYLE),
            createdAt: now,
            updatedAt: now,
            revision: 0,
          }
      if (material?.presentation && material.slideId !== material.presentation.slides[0]?.id)
        throw new Error('찬양 슬롯은 첫 슬라이드부터 연결해주세요.')
      if (material?.presentation && item.materialMode === 'slot')
        cue.title = material.presentation.title.slice(0, 200)
      const row = { id: randomUUID(), presentationId: presentation.id }
      state.setlistSongs.push({ presentation })
      list.items.push(row)
      cue.songItemId = row.id
      cue.materialPending = !material || undefined
    } else if (material?.presentation) {
      const p = { ...clone(material.presentation), id: 'cue_' + randomUUID(), revision: 0 }
      state.cuePresentations.push({ ownerSetlistId: list.id, presentation: p })
      cue.binding = { kind: 'presentation', presentationId: p.id, slideId: material.slideId! }
    } else if (material?.resource) {
      const r = { ...clone(material.resource), id: randomUUID(), revision: 0 }
      state.cueResources.push({ ownerSetlistId: list.id, resource: r })
      cue.binding = {
        kind: 'resource',
        resourceId: r.id,
        ...(r.kind === 'pdf' ? { page: material.page!, rotation: material.rotation || 0 } : {}),
      }
    } else if (item.required || cue.enter.visual === 'bound') cue.materialPending = true
    list.servicePlan!.items.push(cue)
  }
  state.setlists.push(list)
  state.activeSetlistId = list.id
  state.playlist = clone(list.items)
  template.lastUsedAt = now
  template.revision++
  template.updatedAt = now
}
