import type { CuesheetDTO, CuesheetOptions } from '../../shared/cuesheet'
export const htmlEscape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!,
  )
/** Only escaped DTO strings enter HTML; pagination is trusted host code, never user script. */
export function cuesheetHTML(dto: CuesheetDTO, options: CuesheetOptions) {
  const wide = options.orientation === 'landscape',
    width = wide ? 297 : 210,
    height = wide ? 210 : 297,
    columns = 4 + Number(options.times) + Number(options.leader)
  const cell = (text: string, className = '') => `<td class="${className}">${htmlEscape(text)}</td>`
  const rows = dto.rows
    .map(
      (row) =>
        `<tbody data-cue><tr data-primary>${cell(String(row.number), 'number')}${options.times ? cell(row.time || '미정', 'time') : ''}${cell(row.kind, 'kind')}${cell(row.title, 'title')}${options.leader ? cell(row.leader || '', 'leader') : ''}${cell(row.duration, 'duration')}</tr>${row.details.map((detail) => `<tr data-detail><td colspan="${columns}"><span class="detail-label">${htmlEscape(detail.label)} </span><span data-text>${htmlEscape(detail.text)}</span></td></tr>`).join('')}</tbody>`,
    )
    .join('')
  const time = new Date(dto.generatedAt).toLocaleString('ko-KR', {
    timeZone: dto.timezone,
    hour12: false,
  })
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src 'none'; base-uri 'none'; form-action 'none'"><title>ProPre 큐시트</title><style>
*{box-sizing:border-box}html,body{margin:0;padding:0;color:#17202c;background:white;font-family:'Apple SD Gothic Neo','Malgun Gothic','Noto Sans CJK KR',sans-serif;font-size:${options.size === 'large' ? 13 : 11}pt;line-height:1.45}body{width:${width}mm}.page{width:${width}mm;height:calc(${height}mm - .2mm);padding:12mm;display:flex;flex-direction:column;break-after:page;overflow:hidden}.page:last-child{break-after:auto}header{flex:none;margin-bottom:5mm;border-bottom:2px solid #22354a;padding-bottom:3mm}h1{font-size:20pt;line-height:1.3;overflow-wrap:anywhere;margin:0 0 2mm}header p{font-size:9pt;color:#526071;margin:0;white-space:pre-wrap;overflow-wrap:anywhere}.included{margin-top:2mm;color:#805000}.content{flex:1;min-height:0}table{width:100%;border-collapse:collapse;table-layout:fixed}thead{display:table-header-group}th{font-size:9pt;text-align:left;color:#526071;background:#eff3f7;border-bottom:1px solid #b9c4d0;padding:2mm}td{padding:2.4mm 2mm;vertical-align:top;border-bottom:1px solid #dce2e8;white-space:pre-wrap;overflow-wrap:anywhere;word-break:normal}.number{width:14mm;color:#647386;white-space:nowrap}.kind{width:18mm}.duration{width:22mm}.time{width:25mm}.leader{width:26mm}.title{font-weight:600;word-break:keep-all}[data-detail] td{font-size:.9em;padding-top:1.5mm;padding-bottom:2.4mm;background:#fafbfd}.detail-label{font-weight:600;color:#526071}footer{flex:none;margin-top:3mm;padding-top:2mm;border-top:1px solid #c9d2dd;font-size:8pt;color:#6b7684;display:flex;justify-content:space-between;gap:3mm;white-space:nowrap}#source,#prototype{position:absolute;left:-100000px;top:0;width:${width - 24}mm;visibility:hidden}@page{size:A4 ${wide ? 'landscape' : 'portrait'};margin:0}
</style></head><body><div id="prototype"><section class="page"><header><h1>${htmlEscape(dto.title)}</h1><p>${htmlEscape([dto.date || '날짜 미정', `예배 순서 ${dto.rows.length}개`, dto.timezone].join(' · '))}</p>${dto.included.length ? `<p class="included">포함 정보: ${htmlEscape(dto.included.join(' · '))}</p>` : ''}</header><div class="content"><table><colgroup><col class="number">${options.times ? '<col class="time">' : ''}<col class="kind"><col>${options.leader ? '<col class="leader">' : ''}<col class="duration"></colgroup><thead><tr><th>번호</th>${options.times ? '<th>계획 시각</th>' : ''}<th>순서</th><th>제목</th>${options.leader ? '<th>담당자</th>' : ''}<th>예상 시간</th></tr></thead><tbody></tbody></table></div><footer><span>${htmlEscape(time)} · rev ${dto.revision}</span><span data-page-number></span></footer></section></div><table id="source">${rows}</table></body></html>`
}
/** Executed inside the isolated print renderer, with no external state or input evaluation. */
export async function paginateCuesheet() {
  await document.fonts.ready
  if (document.fonts.status !== 'loaded' || !document.fonts.check('11pt sans-serif', '예배 큐시트'))
    throw new Error('font unavailable')
  const source = document.getElementById('source')!,
    prototype = document.querySelector<HTMLElement>('#prototype .page')!,
    groups = [...source.querySelectorAll<HTMLTableSectionElement>('[data-cue]')]
  let page!: HTMLElement
  let body!: HTMLTableSectionElement
  const pages: HTMLElement[] = []
  const nextPage = () => {
    page = prototype.cloneNode(true) as HTMLElement
    document.body.append(page)
    pages.push(page)
    body = page.querySelector('tbody')!
  }
  const fits = () =>
    page.querySelector('table')!.getBoundingClientRect().bottom <=
    page.querySelector('.content')!.getBoundingClientRect().bottom - 1
  const continued = (primary: HTMLElement) => {
    const copy = primary.cloneNode(true) as HTMLElement
    copy.querySelector('.title')!.textContent += ' (계속)'
    return copy
  }
  nextPage()
  for (let groupIndex = 0; groupIndex < groups.length; groupIndex++) {
    const group = groups[groupIndex],
      primary = group.querySelector<HTMLElement>('[data-primary]')!,
      head = primary.cloneNode(true) as HTMLElement
    const hadRows = body!.children.length > 0
    body!.append(head)
    if (!fits() && hadRows) {
      head.remove()
      nextPage()
      body!.append(head)
    }
    if (!fits()) throw new Error('primary overflow')
    let detailPlaced = false
    for (const original of group.querySelectorAll<HTMLElement>('[data-detail]')) {
      let remaining = original.querySelector('[data-text]')!.textContent || ''
      do {
        const row = original.cloneNode(true) as HTMLElement,
          text = row.querySelector<HTMLElement>('[data-text]')!
        text.textContent = remaining
        body!.append(row)
        if (fits()) {
          detailPlaced = true
          break
        }
        const characters = Array.from(remaining)
        let low = 0,
          high = characters.length,
          best = 0
        while (low <= high) {
          const middle = Math.floor((low + high) / 2)
          text.textContent = characters.slice(0, middle).join('')
          if (fits()) {
            best = middle
            low = middle + 1
          } else high = middle - 1
        }
        if (best === 0) {
          row.remove()
          if (!detailPlaced && head.parentElement === body && body!.children.length > 1) {
            head.remove()
            nextPage()
            body!.append(head)
          } else {
            nextPage()
            body!.append(continued(primary))
          }
          if (!fits()) throw new Error('detail overflow')
        } else {
          text.textContent = characters.slice(0, best).join('')
          remaining = characters.slice(best).join('')
          detailPlaced = true
          if (remaining) {
            nextPage()
            body!.append(continued(primary))
          }
        }
      } while (remaining)
    }
    if (groupIndex % 20 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0))
    if (pages.length > 4000) throw new Error('page limit')
  }
  source.remove()
  document.getElementById('prototype')!.remove()
  for (const [index, sheet] of pages.entries())
    sheet.querySelector('[data-page-number]')!.textContent = `${index + 1} / ${pages.length}`
  return {
    pages: pages.length,
    overflow: pages.some(
      (sheet) =>
        sheet.querySelector('table')!.getBoundingClientRect().bottom >
        sheet.querySelector('.content')!.getBoundingClientRect().bottom,
    ),
    font: getComputedStyle(document.body).fontFamily,
  }
}
