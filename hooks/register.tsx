import { atom, read, update } from 'claude-code'
import type { Elements, EngineInterface, Register } from 'claude-code'

import type { Agent, Convo, Frog, Mark, Mate, Note, OpenList, Picked, FoxyView, StageRow, Tale, Task, TaskStage } from '../types'

// Foxy's map is a file of the project, so any project that keeps one gets the pane:
// { goal, updated, stages: [{ title, items: [{ t, s, note?, was? }] }] }
// s is one of: done | doing | todo | owner (waits for the owner's decision).
// `was` is what a step was before the pane marked it done, so a second press puts it back.
// `who` names the agent a step belongs to, by the key of an entry in the top-level `agents`.
// `sub` is what a step is made of: its own small steps, each with a state and an agent.
type Sub = { t: string; s: string; was?: string; who?: string }
type Item = { t: string; s: string; note?: string; was?: string; who?: string; sub?: Sub[] }
type AgentDef = { key: string; name: string; cli?: string; session?: string }
type Stage = { title: string; items: Item[] }
// `side` holds what came up in the conversation and is not part of the goal (tooling, this
// pane itself): listed apart, under its own heading, and never counted in the percent.
// `focus` is what the conversation is working on right now, and whether that is side work.
type FoxyMap = { goal: string; updated?: string; stages: Stage[]; side?: Item[]; agents?: AgentDef[]; focus?: { t: string; side?: boolean } }
type Loaded = { view: FoxyView; tasks: TaskStage[]; side: Task[]; crew: Agent[]; path: string }

const PANE = 'foxy'
const TITLE = 'فوكسي'
const FILES = ['docs/FOXY.json', 'FOXY.json']
const MOST = 5
const GREEN = '#3FCF8E'
const AMBER = '#F5A524'
const BLUE = '#5B9BF5'
const MINT = '#54BAA7'
const NAVY = '#1F2A4B'
const GREY = '#8A93A8'
// The drawings take their colours from these names, so one picture reads on a light pane and
// on a dark one: the light values stand first, the dark ones (the brand's own) under the query.
const TG = 'var(--g)'
const TA = 'var(--a)'
const TB = 'var(--b)'
const TM = 'var(--m)'
const TQ = 'var(--q)'
const CARD = 'var(--card)'
const LINE = 'var(--line)'
const HI = 'var(--hi)'
const LO = 'var(--lo)'
const INK = 'var(--ink)'
const THEME =
  '<style>svg{--g:#12905A;--m:#1B8A78;--a:#B56A00;--b:#2B6BD6;--q:#6B7489;--card:#EEF2FA;--line:#CBD5EA;--hi:#1F2A4B;--lo:#56628A;--ink:#FFFFFF}' +
  `@media (prefers-color-scheme: dark){svg{--g:${GREEN};--m:${MINT};--a:${AMBER};--b:${BLUE};--q:${GREY};--card:${NAVY};--line:#33406A;--hi:#FFFFFF;--lo:#B9C2DD;--ink:${NAVY}}}</style>`
const FONT = "system-ui, -apple-system, 'Segoe UI', Tahoma, sans-serif"
const DOT: Record<string, string> = { done: '✅', doing: '🟢', owner: '🟠', todo: '🔵' }
const WORD: Record<string, string> = { done: 'خلص', doing: 'جارٍ', owner: 'ينتظر قرارك', todo: 'للفريق' }
const FILTERS = [
  { value: 'open', label: 'المفتوح فقط' },
  { value: 'all', label: 'كل الخطوات' },
  { value: 'owner', label: 'ينتظر قرارك 🟠' },
  { value: 'todo', label: 'للفريق 🔵' },
  { value: 'done', label: 'خلص ✅' },
]

const blank = (text: string): FoxyView => ({
  text, board: text, status: '', goal: text, percent: 0, done: 0, waits: 0, ours: 0, now: '', stages: [], lists: [], updated: '',
})
const EMPTY = blank('ما في ملف لفوكسي في هذا المشروع. اكتب /foxy ويقرا المشروع ويصنعه بروحه.')
const NONE: Loaded = { view: EMPTY, tasks: [], side: [], crew: [], path: '' }
const SIDE = 'خارج المشروع'
const TABS = [
  { id: 'overview', label: 'نظرة عامة' },
  { id: 'tasks', label: 'المهام' },
  { id: 'team', label: 'الفريق' },
  { id: 'side', label: SIDE },
  { id: 'notes', label: 'رسائل' },
  { id: 'foxy', label: TITLE },
  { id: 'marks', label: 'المحفوظة' },
]
const SHAPE =
  '{ "goal": string, "updated": "YYYY-MM-DD", "stages": [{ "title": string, "items": [{ "t": string, "s": "done"|"doing"|"todo"|"owner", "note"?: string, "who"?: string, "sub"?: [{ "t", "s", "who"? }] }] }], "side": [items not part of the goal], "agents": [{ "key", "name", "cli"?, "session"? }], "focus": { "t": string, "side": boolean } }'
// What /foxy asks of the model in a project that has no map yet: read, weigh, and write one.
export const makeNow = (path: string): string =>
  [
    `Create Foxy's map of this project now, at ${path}, without asking the user anything.`,
    'Never ask the user whether to create it: just do it. Apart from that one file the project is read only for this: change no other file.',
    'Build it from this conversation alone, which you already hold: the goal, what is finished, what is in progress and what waits on the user. Open no file for it. Only when the conversation says too little to name a goal and its stages (a new conversation), read at most three short project files (README, CLAUDE.md, one plan or task list) and nothing more.',
    `Write it in the user's language with this shape: ${SHAPE}.`,
    '`s` owner = waits on the user. 5-9 stages, short titles, statuses true to what you found (never guessed as done).',
    'Then reply with one short line saying it is ready; do not list the file back.',
  ].join(' ')
const rule = (path: string): string =>
  [
    `Foxy's map of this project is kept in ${path}, and a pane shows it to the user live, so it must always be current.`,
    'In the same turn that a step is finished, started, blocked on the user, added or dropped, or a release ships: re-read the file (the user changes it from the pane), then update that step\'s `s` (done | doing | todo | owner) and the top-level `updated` date.',
    'Work that is not part of the project\'s goal (side topics raised in the conversation, such as tooling or this pane) goes in the top-level `side` list, with the same fields, not in a stage.',
    'Before the final reply of EVERY turn, record what the turn worked on: set the top-level `focus` to { "t": "<a few words, in the user\'s language>", "side": true|false } (side = not part of the project\'s goal), and when it is side work add it to `side` or update its item (`s`: doing while it is in progress, done once the user confirmed it, owner while it waits for the user).',
    'Never rewrite the file from memory.',
  ].join(' ')
// Where the map is made when a project has none.
const outside = FILES[0] ?? 'docs/FOXY.json'
const places = (): string[] => FILES
const found = async ($: EngineInterface): Promise<{ text?: string; path: string }> => {
  for (const path of places()) {
    const text = await $.fs.read(path).catch(() => undefined)
    if (typeof text === 'string') return { text, path }
  }

  return { path: '' }
}
const view = atom({ plugin: 'foxy', key: 'view' } as const, EMPTY)
// Two looks of the same board. 'colour' is the dashboard: a drawing, two menus and the
// steps as buttons. 'plain' is one Markdown block. `/foxy plain` goes back to it, so a
// look a surface will not paint is one command away from the one it will.
const look = atom({ plugin: 'foxy', key: 'look' } as const, 'colour')
const tasks = atom({ plugin: 'foxy', key: 'tasks' } as const, [])
// The strip above the prompt: on until `/foxy bar` turns it off, and on again by the same.
const bar = atom({ plugin: 'foxy', key: 'bar' } as const, 'on')
const side = atom({ plugin: 'foxy', key: 'side' } as const, [])
const crew = atom({ plugin: 'foxy', key: 'crew' } as const, [])
// The frog on the strip: what it says, what it is doing (an act runs as a few frames, each a
// redraw), whether it has grown out of the strip, and when it last spoke on its own.
const QUIET: Frog = { line: '', act: 'idle', frame: 0, isBig: false, said: 0 }
const frog = atom({ plugin: 'foxy', key: 'frog' } as const, QUIET)
// Lines fetched from the address the option names: the owner edits one file on the web and
// every fox that reads it says the new lines within ten minutes. Kept apart from the bank.
const remote = atom({ plugin: 'foxy', key: 'remote' } as const, [])
// Lines the model writes once an hour from the project and the news: ideas, tips, headlines.
const smart = atom({ plugin: 'foxy', key: 'smart' } as const, [])
// The room's messages as last fetched, newest last; the long text behind a line (a headline's
// story), by the line; and the one the fox tab shows now.
const notes = atom({ plugin: 'foxy', key: 'notes' } as const, [])
const tales = atom({ plugin: 'foxy', key: 'tales' } as const, {})
const tale = atom({ plugin: 'foxy', key: 'tale' } as const, { line: '', text: '' })
// The room this user is in: its key, kept between sessions in the plugin's own store. Made or
// joined from the messages tab itself; there is nothing to set anywhere else.
// Who is in the room, as the server last said: here now or not, and how far each has fetched
// and read. A message of mine is delivered once another has fetched it, read once one has read it.
const mates = atom({ plugin: 'foxy', key: 'mates' } as const, [])
// The quarter of an hour the blessing was last said in: kept in the session's state, so a
// reload of the code neither skips a quarter nor says it twice.
const blessed = atom({ plugin: 'foxy', key: 'blessed' } as const, 0)
// The five minutes in which the fox last said what the conversation is on.
const told = atom({ plugin: 'foxy', key: 'told' } as const, 0)
// The last call to prayer the fox gave (its time, ms), so a reload never calls the same one twice.
const adhan = atom({ plugin: 'foxy', key: 'adhan' } as const, 0)
// Conversations kept to come back to, kept for every session in the plugin's own store, and the
// latest conversations on this machine to pick them from.
const marks = atom({ plugin: 'foxy', key: 'marks' } as const, [])
const convos = atom({ plugin: 'foxy', key: 'convos' } as const, [])
const past = atom({ plugin: 'foxy', key: 'past' } as const, '')
const den = atom({ plugin: 'foxy', key: 'den' } as const, '')
const picked = atom({ plugin: 'foxy', key: 'picked' } as const, { stage: 'now', filter: 'open', tab: 'overview', open: '' })

const isDone = (stage: Stage) => stage.items.length > 0 && stage.items.every(item => item.s === 'done')
const count = (items: Item[], status: string) => items.filter(item => item.s === status).length
const cells = (done: number, total: number, width: number) => (total === 0 ? 0 : Math.round((done / total) * width))
const squares = (done: number, total: number, width: number) => {
  const full = cells(done, total, width)

  return '🟩'.repeat(full) + '⬜'.repeat(width - full)
}

export const draw = (map: FoxyMap): FoxyView => {
  const items = map.stages.flatMap(stage => stage.items)
  const done = count(items, 'done')
  const waits = count(items, 'owner')
  const left = items.length - done - waits
  const percent = items.length === 0 ? 0 : Math.floor((done / items.length) * 100)
  // The stage we are in is where the work is: the one with a step in progress; else the first
  // unfinished one that still has work for the team; else the first unfinished one. A stage
  // whose only open steps wait on the owner does not hold the work back from the next.
  const open = (stage: Stage) => stage.items.filter(item => item.s !== 'done')
  const busy = map.stages.findIndex(stage => stage.items.some(item => item.s === 'doing'))
  const ours = map.stages.findIndex(stage => open(stage).some(item => item.s !== 'owner'))
  const at = busy >= 0 ? busy : ours >= 0 ? ours : map.stages.findIndex(stage => !isDone(stage))
  const stage = at < 0 ? undefined : map.stages[at]
  const now = stage ? `المرحلة ${at + 1} من ${map.stages.length} | ${stage.title}` : 'اكتمل الهدف'
  const stages: StageRow[] = map.stages.map((one, index) => ({
    title: one.title,
    done: count(one.items, 'done'),
    total: one.items.length,
    state: isDone(one) ? 'done' : index === at ? 'now' : 'later',
  }))
  const heads = [
    ['doing', 'جارٍ الآن'],
    ['owner', 'ينتظر قرارك'],
    ['todo', 'للفريق'],
  ] as const
  const lists: OpenList[] = heads.flatMap(([kind, head]) => {
    const open = (stage?.items ?? []).filter(item => item.s === kind).map(item => item.t)

    return open.length === 0 ? [] : [{ head, kind, items: open.slice(0, MOST), more: Math.max(0, open.length - MOST) }]
  })
  const text = [
    `${map.goal}: ${percent}%`,
    now,
    `خلص ${done} | ينتظرك ${waits} | للفريق ${left}`,
    ...stages.map(row => `${row.state === 'done' ? '✓' : row.state === 'now' ? '▶' : '○'} ${row.title} ${row.done}/${row.total}`),
    ...lists.flatMap(list => [`${list.head}:`, ...list.items.map(item => `- ${item}`)]),
  ].join('\n')
  const status = at < 0 ? `${percent}%` : `${percent}% | مرحلة ${at + 1}/${map.stages.length}`
  const made = {
    text, status, board: '', goal: map.goal, percent, done, waits, ours: left, now, stages, lists, updated: map.updated ?? '',
    focus: typeof map.focus?.t === 'string' ? map.focus.t : '',
    isFocusSide: map.focus?.side === true,
  }

  return { ...made, board: board(made) }
}

// The plain look. The pane lays its lines out left to right, so a mixed line is written
// word first, mark and number after: it is then one right-to-left run and reads in order.
export const board = (now: FoxyView): string => {
  if (now.stages.length === 0) return now.text
  const rows = now.stages.map(row => {
    const title = row.state === 'now' ? `▶ **${row.title}**` : row.state === 'done' ? `✅ ${row.title}` : row.title

    return `${squares(row.done, row.total, 5)} ${row.done}/${row.total} ${title}`
  })
  const lines = [
    `*${now.goal}*`,
    '',
    `# ${now.percent}%`,
    squares(now.percent, 100, 10),
    '',
    `**الآن:** ${now.now}`,
    '',
    `خلص 🟢 **${now.done}** ｜ ينتظرك 🟠 **${now.waits}** ｜ للفريق 🔵 **${now.ours}**`,
    '',
    '---',
    '',
    rows.join('  \n'),
  ]
  now.lists.forEach(list => {
    lines.push('', `**${list.head} ${DOT[list.kind]} ${list.items.length + list.more}**`, '')
    list.items.forEach(item => lines.push(`- ${item}`))
    if (list.more > 0) lines.push(`- و${list.more} أخرى`)
  })
  if (now.updated !== '') lines.push('', `آخر تحديث ${now.updated}`)

  return lines.join('\n')
}

const safe = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)

export const amount = (tokens: number) =>
  tokens >= 1e6 ? `${(tokens / 1e6).toFixed(1)} مليون` : tokens >= 1e3 ? `${Math.round(tokens / 1e3)} ألف` : String(tokens)

// The drawing of the dashboard: a card with the ring, three counters, the stages as a
// ladder, and the agents of the conversation. Right to left throughout: every text is
// anchored at its right end, the ring and the step marks stand at the right edge, the bars
// at the left. `chosen` is the stage the menu shows (none for the side list), lit so the
// drawing and the steps under it are read as one.
export const chart = (now: FoxyView, chosen: number, hasLadder = true): string => {
  const W = 360
  const ROW = 30
  // a row under the card says what the conversation is on now; everything below moves down by it
  const focus = typeof now.focus === 'string' ? now.focus : ''
  const F = focus === '' ? 0 : 38
  const TOP = 172 + F
  const H = hasLadder ? TOP + now.stages.length * ROW + 6 : TOP - 10
  const RING = 2 * Math.PI * 30
  const rtl = (x: number, y: number, size: number, fill: string, text: string, weight = 400) =>
    `<text x="${x}" y="${y}" direction="rtl" text-anchor="start" font-size="${size}" font-weight="${weight}" fill="${fill}">${safe(text)}</text>`
  const parts = now.now.split(' | ')
  const head = [
    `<rect x="0.5" y="0.5" width="${W - 1}" height="95" rx="16" fill="${CARD}" stroke="${LINE}"/>`,
    `<circle cx="312" cy="48" r="30" fill="none" stroke="${LINE}" stroke-width="8"/>`,
    `<circle cx="312" cy="48" r="30" fill="none" stroke="${TM}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${((RING * now.percent) / 100).toFixed(1)} ${RING.toFixed(1)}" transform="rotate(-90 312 48)"/>`,
    `<text x="312" y="54" text-anchor="middle" font-size="17" font-weight="700" fill="${HI}">${now.percent}%</text>`,
    rtl(264, 30, 11, LO, cut(now.goal, 44)),
    rtl(264, 54, 13, HI, parts[0] ?? '', 700),
    rtl(264, 78, 15, TM, cut(parts[1] ?? '', 26), 700),
    ...(focus === ''
      ? []
      : [
          `<rect x="0.5" y="104.5" width="359" height="28" rx="14" fill="${now.isFocusSide ? TA : TM}" fill-opacity="0.16" stroke="${now.isFocusSide ? TA : TM}"/>`,
          `<circle cx="344" cy="118.5" r="4.5" fill="${now.isFocusSide ? TA : TM}"/>`,
          rtl(332, 123, 12, now.isFocusSide ? TA : TM, cut(`نشتغل الآن على: ${focus}`, now.isFocusSide ? 36 : 50), 700),
          // side work is said by the colour and by its own tag at the far end, so the text is not cut for it
          ...(now.isFocusSide ? [rtl(88, 122.5, 10.5, TA, SIDE, 700)] : []),
        ]),
  ]
  const tiles = [
    { x: 248, n: now.done, label: 'خلص', tone: TG },
    { x: 124, n: now.waits, label: 'ينتظرك', tone: TA },
    { x: 0, n: now.ours, label: 'للفريق', tone: TB },
  ].flatMap(tile => [
    `<rect x="${tile.x + 0.5}" y="${108.5 + F}" width="111" height="48" rx="12" fill="${tile.tone}" fill-opacity="0.14" stroke="${tile.tone}"/>`,
    `<text x="${tile.x + 20}" y="${140 + F}" font-size="22" font-weight="700" fill="${tile.tone}">${tile.n}</text>`,
    rtl(tile.x + 98, 138 + F, 13, tile.tone, tile.label, 700),
  ])
  const ladder = now.stages.flatMap((row, index) => {
    const y = TOP + index * ROW
    const tone = row.state === 'done' ? TG : row.state === 'now' ? TM : TQ
    const fill = row.total === 0 ? 0 : Math.round((row.done / row.total) * 84)
    const mark =
      row.state === 'done'
        ? `<circle cx="346" cy="${y + 15}" r="10" fill="${TG}"/><path d="M341 ${y + 15} l4 4 l6 -8" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<circle cx="346" cy="${y + 15}" r="10" fill="${row.state === 'now' ? TM : 'none'}" stroke="${tone}" stroke-width="1.5"/><text x="346" y="${y + 19}" text-anchor="middle" font-size="11" font-weight="700" fill="${row.state === 'now' ? INK : TQ}">${index + 1}</text>`

    return [
      index === chosen ? `<rect x="0" y="${y + 1}" width="${W}" height="${ROW - 2}" rx="9" fill="${TM}" fill-opacity="0.16"/>` : '',
      index < now.stages.length - 1 ? `<path d="M346 ${y + 25} v10" stroke="${TQ}" stroke-opacity="0.5" stroke-width="1.5"/>` : '',
      mark,
      rtl(328, y + 20, 13, row.state === 'later' ? TQ : tone, cut(row.title, 24), row.state === 'now' ? 700 : 500),
      `<rect x="8" y="${y + 11}" width="84" height="8" rx="4" fill="${TQ}" fill-opacity="0.3"/>`,
      fill > 0 ? `<rect x="8" y="${y + 11}" width="${fill}" height="8" rx="4" fill="${row.state === 'later' ? TB : tone}"/>` : '',
      `<text x="100" y="${y + 19}" font-size="11" fill="${TQ}">${row.done}/${row.total}</text>`,
    ]
  })
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${THEME}`,
    ...head,
    ...tiles,
    ...(hasLadder ? ladder : []),
    '</svg>',
  ].join('')
}

// One row of the ladder as a drawing of its own, the approved row exactly: the mark in its
// disc at the right, the name, the bar and the count at the left, and the rail running
// through so the rows read as one ladder when stacked. The row that is open is lit. The
// left end (the first GUTTER units) is left empty: the button that opens the row sits over it.
export const rowChart = (row: StageRow, index: number, isLast: boolean, isSeen: boolean): string => {
  const W = 360
  const ROW = 30
  const GUTTER = 52
  const tone = row.state === 'done' ? TG : row.state === 'now' ? TM : TQ
  const fill = row.total === 0 ? 0 : Math.round((row.done / row.total) * 84)
  const rtl = (x: number, y: number, size: number, fillColor: string, text: string, weight = 400) =>
    `<text x="${x}" y="${y}" direction="rtl" text-anchor="start" font-size="${size}" font-weight="${weight}" fill="${fillColor}">${safe(text)}</text>`
  const mark =
    row.state === 'done'
      ? `<circle cx="346" cy="15" r="10" fill="${TG}"/><path d="M341 15 l4 4 l6 -8" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<circle cx="346" cy="15" r="10" fill="${row.state === 'now' ? TM : 'none'}" stroke="${tone}" stroke-width="1.5"/><text x="346" y="19" text-anchor="middle" font-size="11" font-weight="700" fill="${row.state === 'now' ? INK : TQ}">${index + 1}</text>`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${ROW}" viewBox="0 0 ${W} ${ROW}" font-family="${FONT}">${THEME}`,
    isSeen ? `<rect x="${GUTTER}" y="1" width="${W - GUTTER}" height="${ROW - 2}" rx="9" fill="${TM}" fill-opacity="0.16"/>` : '',
    index > 0 ? `<path d="M346 0 v5" stroke="${TQ}" stroke-opacity="0.5" stroke-width="1.5"/>` : '',
    isLast ? '' : `<path d="M346 25 v5" stroke="${TQ}" stroke-opacity="0.5" stroke-width="1.5"/>`,
    mark,
    rtl(328, 20, 13, row.state === 'later' ? TQ : tone, cut(row.title, 24), row.state === 'now' ? 700 : 500),
    `<rect x="${GUTTER + 8}" y="11" width="84" height="8" rx="4" fill="${TQ}" fill-opacity="0.3"/>`,
    fill > 0 ? `<rect x="${GUTTER + 8}" y="11" width="${fill}" height="8" rx="4" fill="${row.state === 'later' ? TB : tone}"/>` : '',
    `<text x="${GUTTER + 100}" y="19" font-size="11" fill="${TQ}">${row.total}/${row.done}</text>`,
    '</svg>',
  ].join('')
}

// Deterministic noise, so the dither does not shimmer between redraws.
const noise = (x: number, y: number): number => {
  const v = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453

  return v - Math.floor(v)
}

// Which fox a teammate is, from its name: the manager wears a crown, the executor a hard
// hat, the designer a beret, the voice a headset; anyone else a scarf in a colour of its own.
export const costumeOf = (name: string, key: string): string =>
  /مدير|manager/i.test(name) || key === 'manager'
    ? 'manager'
    : /نفّ?ذ|exec/i.test(name) || key === 'exec'
      ? 'exec'
      : /مصمّ?م|design/i.test(name) || key === 'design'
        ? 'design'
        : /صوت|voice/i.test(name) || key === 'voice'
          ? 'voice'
          : `guest${[...key].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 4}`

// The fox as pixels, facing us from the waist up: ears with dark tips, a round head with
// cream cheeks and muzzle, two eyes and a nose, a body with a cream chest, two paws, and
// what the costume gives it: a hat and something in a paw. 16 wide, 15 tall, the hat above.
// Asleep the eyes close and a "z" floats; the paws step in two groups while at work. An act
// is a class that plays once on the redraw that sets it. All motion is CSS the compositor runs.
export const pixelFox = (x: number, y: number, scale: number, awake: boolean, act: Frog['act'], costume = ''): string => {
  const O = '#E5484D'
  const D = '#A8262B'
  const C = '#FFE9CF'
  const K = '#2B1D14'
  const px = (gx: number, gy: number, w: number, h: number, c: string) => `<rect x="${gx}" y="${gy}" width="${w}" height="${h}" fill="${c}"/>`
  const head = [
    px(2, 0, 2, 1, D), px(12, 0, 2, 1, D), px(2, 1, 2, 2, O), px(12, 1, 2, 2, O),
    px(3, 3, 10, 1, O), px(2, 4, 12, 4, O), px(3, 8, 10, 1, O),
    px(4, 5, 3, 3, C), px(9, 5, 3, 3, C), px(6, 7, 4, 2, C),
    awake ? px(5, 5, 1, 1, K) + px(10, 5, 1, 1, K) : px(4, 6, 2, 1, K) + px(10, 6, 2, 1, K),
    px(7, 7, 2, 1, K),
  ].join('')
  const body = [px(4, 9, 8, 5, O), px(6, 9, 4, 4, C), px(3, 10, 1, 3, O), px(12, 10, 1, 3, O)].join('')
  const la = px(3, 13, 2, 2, D)
  const lb = px(11, 13, 2, 2, D)
  const hat =
    costume === 'manager'
      ? px(4, -2, 1, 1, AMBER) + px(7, -2, 2, 1, AMBER) + px(11, -2, 1, 1, AMBER) + px(4, -1, 8, 1, AMBER)
      : costume === 'exec'
        ? px(4, -2, 8, 1, '#F2C94C') + px(3, -1, 10, 1, '#F2C94C') + px(2, 0, 12, 1, '#D9A826')
        : costume === 'design'
          ? px(3, -1, 9, 1, '#9B6BFF') + px(4, -2, 7, 1, '#9B6BFF') + px(11, -3, 1, 1, '#9B6BFF')
          : costume === 'voice'
            ? px(3, -1, 10, 1, '#D7DCE8') + px(1, 3, 1, 4, '#D7DCE8') + px(14, 3, 1, 4, '#D7DCE8') + px(14, 7, 1, 1, '#D7DCE8') + px(13, 8, 1, 1, '#F06C8C')
            : ''
  const scarf = ['#54BAA7', '#5B9BF5', '#F06C8C', '#F5A524'][Number(costume.replace('guest', '')) % 4]
  const prop =
    costume === 'manager'
      ? px(13, 9, 3, 4, '#D7DCE8') + px(14, 10, 1, 1, GREY) + px(14, 11, 1, 1, GREY)
      : costume === 'exec'
        ? px(14, 8, 1, 5, '#8B5A2B') + px(13, 7, 3, 2, '#9AA3B2')
        : costume === 'design'
          ? px(14, 8, 1, 5, '#8B5A2B') + px(14, 7, 1, 1, '#9B6BFF')
          : costume.startsWith('guest')
            ? px(4, 9, 8, 1, scarf) + px(11, 10, 1, 2, scarf)
            : ''
  const sleep = awake ? '' : `<text x="15" y="-2" font-size="4" font-weight="700" fill="${GREY}" class="zz">z</text>`

  return [
    `<g transform="translate(${x} ${y}) scale(${scale})" shape-rendering="crispEdges">`,
    `<g class="fx${awake ? ' run' : ''}${act === 'idle' ? '' : ` act-${act}`}">`,
    `<g class="bd">${head}${body}${hat}${prop}</g><g class="la">${la}</g><g class="lb">${lb}</g>${sleep}`,
    '</g></g>',
  ].join('')
}

const FOX_CSS = `<style>
.run .la{animation:st .5s steps(1) infinite}.run .lb{animation:st .5s steps(1) infinite -.25s}
.run .bd{animation:bob .5s steps(1) infinite -.125s}
.fx g{transform-box:fill-box}
@keyframes st{50%{transform:translateY(-1px)}}@keyframes bob{50%{transform:translateY(1px)}}
.act-jump{animation:hop .6s ease-out 1}@keyframes hop{30%{transform:translateY(-6px)}60%{transform:translateY(0)}80%{transform:translateY(-2px)}}
.act-spin{animation:turn .6s ease-in-out 1}@keyframes turn{50%{transform:scaleX(-1)}}
.act-dance{animation:sway .6s ease-in-out 1}@keyframes sway{25%{transform:rotate(-10deg)}75%{transform:rotate(10deg)}}
.act-tongue{animation:nod .6s ease-in-out 1}@keyframes nod{50%{transform:translateY(2px) scaleY(.85)}}
.zz{animation:rise 2s ease-in-out infinite}@keyframes rise{50%{transform:translateY(-2px);opacity:.3}}
@media (prefers-reduced-motion: reduce){.fx,.fx g,.zz{animation:none!important}}
</style>`

// The agents of this conversation, one row each: a live dot (lit while its session writes),
// the name, how many of its steps are done as a bar, and what it has spent.
export const teamChart = (team: Agent[]): string => {
  const W = 360
  const H = 30 + team.length * 34
  const rtl = (x: number, y: number, size: number, fill: string, text: string, weight = 400) =>
    `<text x="${x}" y="${y}" direction="rtl" text-anchor="start" font-size="${size}" font-weight="${weight}" fill="${fill}">${safe(text)}</text>`
  const rows = team.flatMap((one, index) => {
    const y = 26 + index * 34
    const fill = one.total === 0 ? 0 : Math.round((one.done / one.total) * 96)

    return [
      `<rect x="0" y="${y}" width="${W}" height="30" rx="9" fill="${TQ}" fill-opacity="0.1"/>`,
      pixelFox(328, y + 6, 1.45, one.isActive, 'idle', one.costume ?? costumeOf(one.name, one.key)),
      rtl(320, y + 20, 13, one.isActive ? TG : LO, cut(one.name, 11), 700),
      `<rect x="72" y="${y + 11}" width="96" height="8" rx="4" fill="${TQ}" fill-opacity="0.3"/>`,
      fill > 0 ? `<rect x="${168 - fill}" y="${y + 11}" width="${fill}" height="8" rx="4" fill="${TM}"/>` : '',
      rtl(228, y + 19, 11, TQ, one.total === 0 ? 'بلا خطوات' : `${one.done} من ${one.total}`),
      `<text x="10" y="${y + 20}" font-size="12" font-weight="700" fill="${TA}">${amount(one.tokens)}</text>`,
    ]
  })

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${THEME}`,
    FOX_CSS,
    rtl(W, 16, 12, TQ, 'الفريق في هذه المحادثة', 700),
    `<text x="0" y="16" font-size="11" fill="${TQ}">tokens</text>`,
    ...rows,
    '</svg>',
  ].join('')
}

// The room's head row, drawn: its key at the right, and at the left the two signs every app
// uses, each in its own plate: a door with an arrow going out (leave) and two sheets, one over
// the other (copy). The presses land on two buttons laid over the plates.
const ROOM_COPY_X = 64
export const roomHead = (key: string): string => {
  const W = 360
  const H = 28
  const plate = (x: number) => `<rect x="${x}" y="1" width="44" height="26" rx="8" fill="${TQ}" fill-opacity="0.2"/>`
  const line = `fill="none" stroke="${HI}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"`

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${THEME}`,
    plate(0),
    `<g transform="translate(6 0)"><path d="M15 6.5 h-5.5 a1.5 1.5 0 0 0 -1.5 1.5 v12 a1.5 1.5 0 0 0 1.5 1.5 h5.5" ${line}/><path d="M13.5 14 h11 M20.5 10 l4 4 l-4 4" ${line}/></g>`,
    plate(ROOM_COPY_X),
    `<g transform="translate(${ROOM_COPY_X + 14} 0)"><rect x="2" y="5.5" width="10" height="13" rx="2" ${line}/><path d="M6 22.5 h8.5 a1.5 1.5 0 0 0 1.5 -1.5 v-10.5" ${line}/></g>`,
    `<text x="${W}" y="19" direction="rtl" text-anchor="start" font-size="13" fill="${TQ}">${safe(key)}</text>`,
    '</svg>',
  ].join('')
}

// A person's picture where there is none to fetch: the first letters of the first and last
// names in a disc of the name's own colour, as Claude itself shows its user. Foxy is the fox.
export const initials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(word => word !== '')
  const first = [...(words[0] ?? '')][0] ?? ''
  const last = words.length > 1 ? ([...(words[words.length - 1] ?? '')][0] ?? '') : ''

  return `${first}${last}`.toUpperCase()
}
const FACES = ['#5B9BF5', '#9B6BFF', '#F06C8C', '#2FA58E', '#D98A1F']
const face = (cx: number, cy: number, name: string, isOn = true): string =>
  name === TITLE
    ? pixelFox(cx - 11, cy - 9, 1.4, isOn, 'idle', 'manager')
    : `<circle cx="${cx}" cy="${cy}" r="12" fill="${FACES[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % FACES.length]}"${isOn ? '' : ' fill-opacity="0.45"'}/><text x="${cx}" y="${cy + 3.6}" text-anchor="middle" font-size="${/[A-Z]/.test(initials(name)) ? 9.5 : 11}" font-weight="700" fill="#FFFFFF">${safe(initials(name))}</text>`
// A note's text cut into lines a bubble can hold: at the spaces, a word longer than a line cut.
export const wrap = (text: string, most: number): string[] => {
  const lines: string[] = []
  let line = ''
  text.split(/\s+/).filter(word => word !== '').forEach(word => {
    let rest = word
    while (rest.length > most) {
      if (line !== '') lines.push(line)
      lines.push(rest.slice(0, most))
      line = ''
      rest = rest.slice(most)
    }
    if (line !== '' && line.length + 1 + rest.length > most) {
      lines.push(line)
      line = rest
    } else {
      line = line === '' ? rest : `${line} ${rest}`
    }
  })
  if (line !== '') lines.push(line)

  return lines.length === 0 ? [''] : lines
}
// The room as every chat draws it: the oldest note on top, the newest at the bottom, each in
// a bubble with its writer's picture beside it. Mine stand at one side, tinted, with the hour
// and the ticks; the others' at the other side under the writer's name; Foxy's in its own tint.
export const chatChart = (mail: Note[], mine: string[], folk: Mate[]): string => {
  const W = 360
  const parts: string[] = []
  let y = 4
  mail.forEach(one => {
    const isMine = mine.includes(one.from)
    const lines = wrap(one.text, 30)
    const mark = isMine ? ticks(one.id, mine[0] ?? '', folk.filter(mate => !mine.includes(mate.name))) : ''
    const wide = Math.min(262, Math.max(86, Math.max(...lines.map(line => line.length)) * 6.9 + 24))
    const top = isMine ? y : y + 15
    const tall = 10 + lines.length * 17 + 15
    const left = isMine ? 32 : W - 32 - wide
    const tone = one.from === TITLE ? TA : isMine ? TG : TQ
    parts.push(
      face(isMine ? 14 : W - 14, top + 14, isMine ? (mine[0] ?? one.from) : one.from),
      isMine ? '' : `<text x="${W - 34}" y="${y + 10}" direction="rtl" text-anchor="start" font-size="10.5" font-weight="700" fill="${one.from === TITLE ? TA : TQ}">${safe(cut(one.from, 24))}</text>`,
      `<rect x="${left}" y="${top}" width="${wide}" height="${tall}" rx="12" fill="${tone}" fill-opacity="${isMine ? 0.18 : 0.14}" stroke="${tone}" stroke-opacity="0.35"/>`,
      ...lines.map((line, at) => `<text x="${left + wide - 12}" y="${top + 21 + at * 17}" direction="rtl" text-anchor="start" font-size="12.5" fill="${HI}">${safe(line)}</text>`),
      `<text x="${left + 10}" y="${top + tall - 7}" font-size="9.5" fill="${TQ}">${safe(clock(Number(one.at) || 0))}</text>`,
      mark === '' ? '' : `<text x="${left + 56}" y="${top + tall - 7}" font-size="10" font-weight="700" fill="${mark === '✓✓' ? TG : TQ}">${mark}</text>`,
    )
    y = top + tall + 8
  })

  return [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${y}" viewBox="0 0 ${W} ${y}" font-family="${FONT}">${THEME}`, FOX_CSS, ...parts, '</svg>'].join('')
}

// The bookmarks, drawn at the pane's own reading size and kept tight: the kept ones grouped
// under their project (its name once, in its own colour), each a row with its title and how
// long ago, and at the left the plates the presses land on (buttons laid over them, as on the
// room's head row): open and drop. The latest five are bare rows with a dot in their project's
// colour, how long ago, a star to keep and the same open. Room between the cards, light plates.
// The one this conversation is stands lit.
export const MARK_X = 48
export const ago = (then: number, now: number): string => {
  if (!then || !now || now < then) return ''
  const minutes = Math.floor((now - then) / 60000)
  if (minutes < 2) return 'الحين'
  if (minutes < 60) return `قبل ${minutes} د`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `قبل ${hours} س`
  const days = Math.floor(hours / 24)

  return days === 1 ? 'أمس' : days < 30 ? `قبل ${days} أيام` : 'من زمان'
}
export const toneOf = (name: string): string => FACES[[...name].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % FACES.length]
// The button that keeps this conversation, drawn in the star's own amber (the app's primary
// button takes the app's colour, which cannot be set): a pill with a star and the words.
export const SAVE_W = 150
// How many no-break spaces make a clear button as wide as a drawn plate of `px` CSS pixels: one is
// about 4.8 px at the pane's size (measured from the owner's screenshot, where four covered half a plate).
export const spaces = (px: number): number => Math.max(4, Math.round(px / 4.8))
export const markSave = (): string =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${SAVE_W}" height="30" viewBox="0 0 ${SAVE_W} 30" font-family="${FONT}">${THEME}`,
    `<rect x="0.5" y="0.5" width="${SAVE_W - 1}" height="29" rx="14.5" fill="${TA}" fill-opacity="0.16" stroke="${TA}" stroke-opacity="0.8"/>`,
    `<path transform="translate(${SAVE_W - 30} 7)" d="M8 0.6 l2.1 4.4 l4.8 0.6 l-3.5 3.3 l0.9 4.8 l-4.3 -2.3 l-4.3 2.3 l0.9 -4.8 l-3.5 -3.3 l4.8 -0.6 z" fill="${TA}"/>`,
    `<text x="${SAVE_W - 36}" y="20" direction="rtl" text-anchor="start" font-size="13" font-weight="700" fill="${TA}">احفظ هالمحادثة</text>`,
    '</svg>',
  ].join('')
export const markHead = (place: string, count: number): string => {
  const W = 360
  const H = 32
  const tone = toneOf(place)

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${THEME}`,
    `<rect x="${W - 4}" y="13" width="4" height="14" rx="2" fill="${tone}"/>`,
    `<text x="${W - 12}" y="25" direction="rtl" text-anchor="start" font-size="13" font-weight="700" fill="${tone}">${safe(cut(place || 'بلا مشروع', 30))}</text>`,
    `<text x="0" y="25" font-size="11" fill="${TQ}">${count}</text>`,
    '</svg>',
  ].join('')
}
export const markCard = (one: { title: string; place?: string; when?: string; isHere?: boolean }, kind: 'kept' | 'recent'): string => {
  const W = 360
  const isKept = kind === 'kept'
  // one height for both, the plates from top to bottom: the clear button laid over a plate stands
  // at the row's top, and with the plate lower it missed its upper part (owner's screenshot)
  const H = 34
  const mid = H / 2
  const place = one.place ?? ''
  const tone = toneOf(place || one.title)
  const pen = (colour: string) => `fill="none" stroke="${colour}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"`
  const plate = (x: number) => `<rect x="${x}" y="${mid - 14}" width="42" height="28" rx="8" fill="${TQ}" fill-opacity="0.1"/>`
  const side = one.isHere ? 'أنت هني' : (one.when ?? '')
  const open = (x: number) => `<g transform="translate(${x + 11} ${mid - 11})"><path d="M8 6 h-3.5 a1.5 1.5 0 0 0 -1.5 1.5 v10.5 a1.5 1.5 0 0 0 1.5 1.5 h10.5 a1.5 1.5 0 0 0 1.5 -1.5 v-3.5" ${pen(TQ)}/><path d="M11.5 4 h5.5 v5.5 M17 4 l-8 8" ${pen(TQ)}/></g>`
  const icons = isKept
    ? [plate(0), open(0), plate(MARK_X), `<path transform="translate(${MARK_X + 16} ${mid - 5})" d="M0 0 l10 10 M10 0 l-10 10" ${pen(TQ)}/>`]
    : [plate(MARK_X), open(MARK_X), plate(0), `<path transform="translate(12 ${mid - 9})" d="M9 0.7 l2.4 4.9 l5.4 0.8 l-3.9 3.8 l0.9 5.4 l-4.8 -2.6 l-4.8 2.6 l0.9 -5.4 l-3.9 -3.8 l5.4 -0.8 z" ${pen(TA)}/>`]

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${THEME}`,
    isKept
      ? `<rect x="0.5" y="2.5" width="${W - 1}" height="${H - 5}" rx="10" fill="${tone}" fill-opacity="${one.isHere ? 0.18 : 0.07}" stroke="${tone}" stroke-opacity="${one.isHere ? 0.8 : 0.22}"/>`
      : '',
    isKept ? '' : `<circle cx="${W - 8}" cy="${mid}" r="5" fill="${tone}"/>`,
    `<text x="${W - (isKept ? 14 : 20)}" y="${mid + 5}" direction="rtl" text-anchor="start" font-size="14" font-weight="${isKept ? 700 : 500}" fill="${HI}">${safe(cut(one.title || 'بلا عنوان', 24))}</text>`,
    side === '' ? '' : `<text x="${MARK_X + 54}" y="${mid + 4}" direction="rtl" text-anchor="end" font-size="11.5" fill="${one.isHere ? tone : TQ}"${one.isHere ? ' font-weight="700"' : ''}>${safe(cut(side, 12))}</text>`,
    ...icons,
    '</svg>',
  ].join('')
}

// Who is in the room, drawn: a small fox each, in a scarf of its own colour (Foxy wears the
// crown), awake while its owner is here and asleep with a "z" when not, the name under it with
// a light. Read right to left, five to a row.
export const matesChart = (folk: Mate[], me: string): string => {
  const W = 360
  const CELL = 72
  const ROW = 50
  const rows = Math.max(1, Math.ceil(folk.length / 5))
  const H = rows * ROW
  const cells = folk.flatMap((one, index) => {
    const x = W - ((index % 5) + 1) * CELL
    const y = Math.floor(index / 5) * ROW
    const name = one.name === me ? 'أنت' : (one.name.split(/\s+/)[0] ?? one.name)
    const tone = one.on ? TG : TQ

    return [
      face(x + 36, y + 17, one.name, one.on),
      `<circle cx="${x + 62}" cy="${y + 41}" r="3" fill="${one.on ? TG : 'none'}" stroke="${tone}" stroke-width="1.2"/>`,
      `<text x="${x + 55}" y="${y + 45}" direction="rtl" text-anchor="start" font-size="10.5" font-weight="${one.on ? 700 : 500}" fill="${tone}">${safe(cut(name, 9))}</text>`,
    ]
  })

  return [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${THEME}`, FOX_CSS, ...cells, '</svg>'].join('')
}

// A pressed stage, drawn: every step of it in a card. A finished step is struck through
// under a green tick; an open one stands in the colour of its state, with its own small
// steps under it, each struck once done and tagged with whose it is.
// `withSubs` false keeps a stage short (one row a step): the sub-steps are then told by a tag
// at the far end, whose turn it is and how many are done, and are opened in the tasks tab.
const stageParts = (stage: TaskStage, names: Record<string, string>, top: number, withSubs = true): { parts: string[]; end: number } => {
  const tone = (state: string) => (state === 'done' ? TG : state === 'owner' ? TA : state === 'doing' ? TM : TB)
  const rtl = (x: number, y: number, size: number, fill: string, text: string, weight: number, isStruck: boolean) =>
    `<text x="${x}" y="${y}" direction="rtl" text-anchor="start" font-size="${size}" font-weight="${weight}" fill="${fill}"${isStruck ? ' text-decoration="line-through" fill-opacity="0.6"' : ''}>${safe(text)}</text>`
  const parts: string[] = []
  let y = top
  stage.items.forEach(item => {
    const isDone = item.s === 'done'
    const mine = tone(item.s)
    parts.push(
      isDone
        ? `<circle cx="340" cy="${y + 11}" r="8" fill="${TG}"/><path d="M336 ${y + 11} l3 3 l5 -6.5" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<circle cx="340" cy="${y + 11}" r="7" fill="none" stroke="${mine}" stroke-width="2"/>`,
      rtl(324, y + 16, 12.5, isDone ? TG : mine, cut(item.t, withSubs || isDone ? 40 : 32), isDone ? 500 : 700, isDone),
    )
    const subs = item.sub ?? []
    const next = subs.find(one => one.s !== 'done')
    if (!withSubs && !isDone && next) {
      const who = next.s === 'owner' ? 'أنت' : (names[next.who ?? ''] ?? '')
      const label = `${who} ${subs.length}/${subs.length - subs.filter(one => one.s !== 'done').length}`.trim()
      const its = tone(next.s)
      const wide = 16 + label.length * 5.6
      parts.push(
        `<rect x="6" y="${y + 2}" width="${wide}" height="18" rx="9" fill="${its}" fill-opacity="0.2"/>`,
        `<text x="${6 + wide / 2}" y="${y + 15}" direction="rtl" text-anchor="middle" font-size="10" font-weight="700" fill="${its}">${safe(label)}</text>`,
      )
    }
    y += 26
    ;(isDone || !withSubs ? [] : subs).forEach(one => {
      const isOver = one.s === 'done'
      const its = tone(one.s)
      const tag = one.s === 'owner' ? 'أنت' : (names[one.who ?? ''] ?? '')
      const wide = tag === '' ? 0 : 14 + tag.length * 5.8
      parts.push(
        `<path d="M340 ${y - 4} v${14} h-10" fill="none" stroke="${TQ}" stroke-opacity="0.5"/>`,
        `<circle cx="326" cy="${y + 10}" r="3.5" fill="${its}"${isOver ? ' fill-opacity="0.6"' : ''}/>`,
        rtl(316, y + 14, 11.5, isOver ? TQ : its, cut(one.t, 34), 500, isOver),
        tag === '' || isOver ? '' : `<rect x="6" y="${y + 1}" width="${wide}" height="17" rx="8.5" fill="${its}" fill-opacity="0.2"/>`,
        tag === '' || isOver ? '' : `<text x="${6 + wide / 2}" y="${y + 13.5}" text-anchor="middle" font-size="10" font-weight="700" fill="${its}">${safe(tag)}</text>`,
      )
      y += 22
    })
  })

  return { parts, end: y }
}

export const stageChart = (stage: TaskStage, names: Record<string, string>): string => {
  const W = 360
  const { parts, end } = stageParts(stage, names, 10)
  const H = end + 8

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${THEME}`,
    `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" fill="${TQ}" fill-opacity="0.08" stroke="${TM}" stroke-opacity="0.5"/>`,
    ...parts,
    '</svg>',
  ].join('')
}

// An opened step, drawn: a card with one coloured row per sub-step. The number stands in a
// disc of the state's colour (a tick once done), then the text, then whose it is as a tag.
// The buttons under the card carry the same numbers.
export const subChart = (item: Task, names: Record<string, string>): string => {
  const W = 360
  const subs = Array.isArray(item.sub) ? item.sub : []
  const H = 14 + subs.length * 32
  const rtl = (x: number, y: number, size: number, fill: string, text: string, weight = 400) =>
    `<text x="${x}" y="${y}" direction="rtl" text-anchor="start" font-size="${size}" font-weight="${weight}" fill="${fill}">${safe(text)}</text>`
  const rows = subs.flatMap((one, index) => {
    const y = 7 + index * 32
    const tone = one.s === 'done' ? TG : one.s === 'owner' ? TA : one.s === 'doing' ? TM : TB
    const tag = one.s === 'owner' ? 'أنت' : (names[one.who ?? ''] ?? '')
    const wide = tag === '' ? 0 : 16 + tag.length * 6.4

    return [
      `<rect x="0.5" y="${y + 0.5}" width="${W - 1}" height="27" rx="9" fill="${tone}" fill-opacity="${one.s === 'done' ? 0.08 : 0.14}" stroke="${tone}" stroke-opacity="${one.s === 'done' ? 0.35 : 0.9}"/>`,
      `<circle cx="342" cy="${y + 14}" r="9" fill="${tone}"/>`,
      one.s === 'done'
        ? `<path d="M337.5 ${y + 14} l3.5 3.5 l5.5 -7" fill="none" stroke="${INK}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<text x="342" y="${y + 18}" text-anchor="middle" font-size="11" font-weight="700" fill="${INK}">${index + 1}</text>`,
      rtl(326, y + 19, 12.5, tone, cut(one.t, 30), one.s === 'done' ? 500 : 700),
      tag === '' ? '' : `<rect x="8" y="${y + 5}" width="${wide}" height="18" rx="9" fill="${tone}" fill-opacity="0.22"/>`,
      tag === '' ? '' : `<text x="${8 + wide / 2}" y="${y + 18}" text-anchor="middle" font-size="10.5" font-weight="700" fill="${tone}">${safe(tag)}</text>`,
    ]
  })

  return [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">${THEME}`, ...rows, '</svg>'].join('')
}

// The strip above the prompt, two rows, read right to left. Top: the percent, where we are,
// and what the conversation is on now (amber when it is side work). Bottom: the goal as one
// bar cut into the stages, each segment as wide as its share of the steps and filled by its
// own progress (done stages green, the one we are in lit, the rest blue), the three counters
// at the far end, and who of the team is at work right now. A still picture: it is drawn
// again whenever the file or the team changes, never animated.
// What the frog says. Three kinds, mixed: what matters now (from the data), a joke, and a
// tip about this pane or the conversation. `seed` picks, so one redraw says one thing.
const JOKES = [
  'شغلي يتحرك بدون اجتماع.',
  'المشروع يكمل بالنسبة، وأنا بالقفز.',
  'لو كل قرار نطّة، جان وصلت القمر.',
  'ما أبرمج، بس أعرف منو ما ردّ.',
  'النسبة طلعت؟ لا، بس أنا متفائل.',
  'إذا نمت، الفريق نام قبلي.',
  'كل ما تفتح اللوحة أحس إني مهم.',
  'مو كسول، في وضع توفير التوكن.',
  'شامل القفز والغمز.',
  'اضغطني وشوف شصير.',
  'اسمي فوكسي، ولا تنسى.',
  'فوكسي حاضر. منو غايب؟',
  'صرفتوا ملايين، وأنا ببلاش.',
  'أنا الوحيد اللي ما له ديدلاين.',
  'الفريق يكتب، وأنا أراقب وأقفز.',
  'القرارات عندك والتنفيذ عندنا. شفت الفرق؟',
  'النسبة ثابتة من ساعة. أنا مو مستعجل، بس هي.',
  'تضغطني أكثر ما تضغط «اعتمد».',
  'كل ما فتحت اللوحة، ما تغيّر شي. صدفة؟',
  'لو الاعتمادات نطّات، جان أنا بالقمر.',
]
// Short sayings of Imam Ali from Nahj al-Balagha (its book of wisdoms), word for word.
export const NAHJ = [
  'قيمة كل امرئ ما يحسنه.',
  'الناس أعداء ما جهلوا.',
  'إذا تمّ العقل نقص الكلام.',
  'المرء مخبوء تحت لسانه.',
  'لا غنى كالعقل، ولا فقر كالجهل.',
  'من أطال الأمل أساء العمل.',
  'ما أكثر العبر وأقل الاعتبار.',
  'من لان عوده كثفت أغصانه.',
  'الفرصة تمرّ مرّ السحاب.',
  'العلم يحرسك وأنت تحرس المال.',
].map(saying => `علي (ع): ${saying}`)
const CLAUDE_TIPS = [
  'كلود: /compact يختصر المحادثة إذا طوّلت.',
  'كلود: /clear يبدأ محادثة نظيفة.',
  'كلود: Esc مرتين يرجّعك رسالة ورا.',
  'كلود: @ قبل اسم الملف يرفقه.',
  'كلود: /model يبدّل الموديل.',
  'كلود: /cost يقولك كم صرفت.',
  'كلود: Shift+Tab يبدّل وضع الصلاحيات.',
  'كلود: # في أول الرسالة يحفظها بالذاكرة.',
  'كلود: /resume يرجّع محادثة قديمة.',
  'كلود: Esc وقت الشغل يوقفه بدون ما يضيع.',
]
const TIPS = [
  'السهم يم المرحلة يفتح مهامها.',
  'خبري له سالفة؟ اضغط كلامي.',
  '«خارج المشروع» ما ينحسب بالنسبة.',
  'تاب «الفريق» يقولك منو صرف أكثر.',
  '/foxy يفتح لوحتي، و/foxy bar يخفيني.',
  'اللي تعلّمه «خلص» ينحفظ بالملف.',
  'أنام إذا ما أحد كتب شي من دقيقتين.',
]
export const lines = (now: FoxyView, team: Agent[], fetched: string[] = []): string[] => {
  const live = team.filter(one => one.isActive).map(one => one.name)
  const top = team.slice().sort((a, b) => b.tokens - a.tokens)[0]
  const next = now.stages.find(row => row.state === 'now')
  const facts = [
    now.waits > 0 ? `${now.waits} قرار واقفين عليك. مو مستعجل؟` : 'ما في شي ينتظرك. نادر، صوّرها.',
    now.ours > 0 ? `للفريق ${now.ours} خطوات ما تحتاجك.` : '',
    live.length > 0 ? `${live.join(' و')} شغّال الحين. أراقب.` : 'الفريق هادئ. ناموا قبلي.',
    top && top.tokens > 0 ? `أكثر واحد صرف توكن: ${top.name}.` : '',
    now.percent >= 100 ? 'خلصنا! وين الحفلة؟' : now.percent >= 75 ? `باقي ${100 - now.percent}% بس.` : now.percent >= 50 ? 'عدّينا النص، والباقي عليك.' : 'يلا نشدّ حيلنا.',
    next ? `الحين في «${next.title}».` : '',
  ].filter(line => line !== '')

  // fetched lines come first and twice, so a fresh one is said soon and often
  return [...fetched, ...facts, ...fetched, ...NAHJ, ...JOKES, ...TIPS, ...CLAUDE_TIPS].filter(line => line.length <= 40)
}
export const choose = (pool: string[], seed: number): string => pool[Math.abs(Math.floor(seed)) % Math.max(1, pool.length)] ?? ''
// What the fox said lately: a line is not said again until most of the others have been.
// (Picking by the clock alone landed on the same line, for the fox looks every so many seconds.)
let saidLately: string[] = []
export const fresh = (pool: string[]): string => {
  const all = [...new Set(pool)]
  const left = all.filter(line => !saidLately.includes(line))
  const from = left.length > 0 ? left : all
  const line = from[Math.floor(Math.random() * from.length)] ?? ''
  saidLately = [line, ...saidLately].slice(0, Math.max(1, Math.floor(all.length * 0.7)))

  return line
}


// The strip above the prompt, in one short row: a dot and the title at the right, the bar
// (its fill dithered in pixels that twinkle, a pill on the fill's head with the count, a tick
// where each stage ends), the percent, and the pixel fox at the left end. One drawing, as
// wide as the band's hook says the prompt is; the fox's line and the two buttons stand
// beside it. A still picture apart from its CSS, which the compositor runs by itself.
// The pane's arrow, drawn as high as the bar: the app's own button is taller and made the whole
// strip taller with it. A plate with a solid triangle, ▶ to open and ◀ to close.
export const arrowPlate = (isOpen: boolean): string =>
  [
    `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20" viewBox="0 0 30 20">${THEME}`,
    `<rect x="0.5" y="0.5" width="29" height="19" rx="5" fill="${TQ}" fill-opacity="0.22"/>`,
    isOpen ? `<path d="M18.5 5 L10.5 10 L18.5 15 Z" fill="${HI}"/>` : `<path d="M11.5 5 L19.5 10 L11.5 15 Z" fill="${HI}"/>`,
    '</svg>',
  ].join('')
export const strip = (now: FoxyView, W: number, isWorking: boolean, state: Frog = QUIET, isBare = false): string => {
  // one text line high (20): at 24 the band seemed to keep two lines for it, a margin above and below
  const H = 20
  const BAR_H = 16
  const CELL = 3
  const FOX_W = 30
  const focus = typeof now.focus === 'string' ? now.focus : ''
  const PCT_W = 40
  const BAR_LEFT = FOX_W + PCT_W + 6
  const title = isBare ? '' : cut(focus === '' ? now.goal : `الآن: ${focus}`, Math.max(14, Math.min(44, Math.floor(W / 15))))
  const titleW = Math.round(title.length * 5.4 + 8)
  const BAR_RIGHT = isBare ? W - 2 : W - 16 - titleW - 12
  const BAR_W = Math.max(60, BAR_RIGHT - BAR_LEFT)
  const total = now.stages.reduce((sum, row) => sum + row.total, 0)
  const ratio = total === 0 ? 0 : now.done / total
  const fillW = Math.round(BAR_W * ratio)
  const color = now.percent >= 100 ? GREEN : '#F28C28'
  const y0 = (H - BAR_H) / 2
  // the dither: sparse at the tail, dense at the head; four twinkle groups out of phase
  const dots: string[] = []
  const cols = Math.floor(fillW / CELL)
  const rows = Math.floor(BAR_H / CELL)
  for (let c = 0; c < cols; c += 1) {
    const density = 0.35 + 0.6 * Math.pow(c / Math.max(1, cols), 1.2)
    for (let r = 0; r < rows; r += 1) {
      if (noise(c, r) < density) dots.push(`<rect class="t${Math.floor(noise(r, c) * 4)}" x="${BAR_W - (c + 1) * CELL + 1}" y="${r * CELL + 1}" width="2" height="2"/>`)
    }
  }
  // a tick where each stage ends, past the fill
  let gone = 0
  const ticks = now.stages.slice(0, -1).flatMap(row => {
    gone += row.total
    const atX = total === 0 ? 0 : Math.round((BAR_W * gone) / total)

    return atX > fillW + 4 ? [`<rect x="${BAR_W - atX}" y="${BAR_H / 2 - 4}" width="1.5" height="8" rx="0.75"/>`] : []
  })
  const label = `${total}/${now.done}`
  const pillW = Math.round(14 + label.length * 6.2)
  const pillX = Math.max(0, Math.min(BAR_W - pillW, BAR_W - fillW))
  const isSide = now.isFocusSide && focus !== ''

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`,
    '<style>',
    '.t{fill:#1f1f1f}.m{fill:#8a8a8a}.k{fill:#e4e4e2}.tk{fill:#b4b4b0}',
    '@media (prefers-color-scheme: dark){.t{fill:#ececec}.m{fill:#9a9a9a}.k{fill:#2c2c2c}.tk{fill:#5a5a5a}}',
    `.t0,.t1,.t2,.t3{animation:tw ${now.percent >= 100 ? 3.2 : 2.2}s ease-in-out infinite}`,
    '.t1{animation-duration:2.8s;animation-delay:-.7s}.t2{animation-duration:1.9s;animation-delay:-1.3s}.t3{animation-duration:3.3s;animation-delay:-.4s}',
    `@keyframes tw{0%,100%{opacity:1}50%{opacity:${now.percent >= 100 ? 0.8 : 0.3}}}`,
    '@media (prefers-reduced-motion: reduce){.t0,.t1,.t2,.t3{animation:none}}',
    '</style>',
    FOX_CSS,
    `<defs><clipPath id="rmClip"><rect x="0" y="0" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/></clipPath></defs>`,
    isBare ? '' : `<circle cx="${W - 7}" cy="${H / 2}" r="4" fill="${isSide ? AMBER : color}"/>`,
    `<text class="t" x="${W - 16}" y="${H / 2 + 4.5}" direction="rtl" text-anchor="start" font-size="11" font-weight="600">${safe(title)}</text>`,
    `<g transform="translate(${BAR_LEFT},${y0})">`,
    `<rect class="k" width="${BAR_W}" height="${BAR_H}" rx="${BAR_H / 2}"/>`,
    `<g clip-path="url(#rmClip)"><g fill="${color}">${dots.join('')}</g><g class="tk">${ticks.join('')}</g></g>`,
    `<rect x="${pillX}" width="${pillW}" height="${BAR_H}" rx="${BAR_H / 2}" fill="${color}"/>`,
    `<text x="${pillX + pillW / 2}" y="${BAR_H / 2 + 4}" direction="rtl" text-anchor="middle" font-size="11" font-weight="700" fill="${NAVY}">${safe(label)}</text>`,
    '</g>',
    `<text class="m" x="${FOX_W + PCT_W - 4}" y="${H / 2 + 4.5}" text-anchor="end" font-size="12.5" font-weight="600">${now.percent}%</text>`,
    pixelFox(4, 3, 1.05, isWorking, state.act, 'manager'),
    '</svg>',
  ].join('')
}

// A press on a step: done, or back to what it was. Pure, so the file is written from its answer.
const turn = (item: Item): Item => {
  const { was, ...rest } = item

  return item.s === 'done' ? { ...rest, s: was ?? 'todo' } : { ...rest, s: 'done', was: item.s }
}
// With `sub`, the press is on one of the step's own small steps; the step itself then
// follows them: done once they all are, back to what it was when one is undone.
const turnSub = (item: Item, sub: number): Item => {
  const subs = (item.sub ?? []).map((one, index) => (index === sub ? (turn(one) as Sub) : one))
  const isAll = subs.length > 0 && subs.every(one => one.s === 'done')
  const { was, ...rest } = item
  if (isAll && item.s !== 'done') return { ...rest, sub: subs, s: 'done', was: item.s }
  if (!isAll && item.s === 'done') return { ...rest, sub: subs, s: was ?? 'todo' }

  return { ...item, sub: subs }
}
// stage -1 is the side list
export const flip = (map: FoxyMap, stage: number, step: number, day: string, sub?: number): FoxyMap => {
  const act = (item: Item, index: number) => (index !== step ? item : sub === undefined ? turn(item) : turnSub(item, sub))

  return {
    ...map,
    updated: day,
    stages: map.stages.map((one, at) => (at !== stage ? one : { ...one, items: one.items.map(act) })),
    ...(stage === -1 && map.side ? { side: map.side.map(act) } : {}),
  }
}

const pick = (text: string | undefined, path: string): Loaded => {
  if (typeof text !== 'string') return NONE
  try {
    const map = JSON.parse(text) as FoxyMap
    const list: TaskStage[] = map.stages.map(stage => ({
      title: stage.title,
      items: stage.items.map(item => ({ t: item.t, s: item.s, note: item.note ?? '', sub: (item.sub ?? []).map(one => ({ t: one.t, s: one.s, who: one.who ?? '' })) })),
    }))

    const aside: Task[] = (Array.isArray(map.side) ? map.side : []).map(item => ({
      t: item.t,
      s: item.s,
      note: item.note ?? '',
      sub: (item.sub ?? []).map(one => ({ t: one.t, s: one.s, who: one.who ?? '' })),
    }))

    // each agent's share of the steps, counted from the steps themselves
    const steps: { s: string; who?: string }[] = map.stages
      .flatMap(stage => stage.items)
      .flatMap(item => (item.sub && item.sub.length > 0 ? item.sub : [item]))
    const team: Agent[] = (Array.isArray(map.agents) ? map.agents : []).map(one => {
      const mine = steps.filter(item => item.who === one.key)

      return {
        key: one.key,
        name: one.name,
        cli: one.cli ?? '',
        done: mine.filter(item => item.s === 'done').length,
        total: mine.length,
        tokens: 0,
        isActive: false,
        costume: costumeOf(one.name, one.key),
        session: one.session ?? '',
      }
    })

    return { view: draw(map), tasks: list, side: aside, crew: team, path }
  } catch {
    return { ...NONE, view: blank('تعذّرت قراءة ملف فوكسي: ليس JSON صحيحاً.') }
  }
}

// The file as last read. The pane must always show what the file says, so it is read
// again every few seconds as well as at each event; an unchanged file costs one compare.
let seen = '\u0000'
// Whether this project has a map. Where it has none Foxy does nothing at all: no measuring, no
// talking, no messages, nothing added to the model's prompt, until /foxy is run there.
let hasMap = false
const sync = async ($: EngineInterface) => {
  const got = await found($)
  hasMap = got.path !== ''
  const text = got.text ?? ''
  const now = pick(got.text, got.path)
  if (text === seen) return now
  seen = text
  await update($, view, () => now.view)
  await update($, tasks, () => now.tasks)
  await update($, side, () => now.side)
  // the share of steps comes from the file; what was spent and who is live is kept as last measured
  await update($, crew, was => {
    const olds = Array.isArray(was) ? was : []
    const named = now.crew.map(one => {
      const old = olds.find(prior => prior.key === one.key)

      return { ...one, tokens: old?.tokens ?? 0, isActive: old?.isActive ?? false }
    })
    // sessions found on this machine stay, after the named ones
    const found = olds.filter(old => old.key.startsWith('local_') && !named.some(one => one.cli === old.cli))

    return [...named, ...found]
  })
  // the strip already says the percent and the stage: the footer of every conversation stays the app's
  await $.ui.status(undefined)

  return now
}

// What each agent has spent is in its session's transcript, far past what one read may
// hold: a script of this mod totals them (it resumes where it stopped, so a run is cheap).
// An agent is live while its transcript was written in the last two minutes.
// What the address holds: a JSON array of strings, a JSON object with a `lines` array, or
// plain text with one line per row. Anything else, or a failed fetch, changes nothing.
export const parseLines = (text: string): string[] => {
  const clean = (list: unknown[]) => list.filter((one): one is string => typeof one === 'string').map(one => one.trim()).filter(one => one !== '')
  try {
    const parsed = JSON.parse(text) as unknown
    if (Array.isArray(parsed)) return clean(parsed)
    if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { lines?: unknown[] }).lines)) return clean((parsed as { lines: unknown[] }).lines)
  } catch {
    return clean(text.split(/\r?\n/))
  }

  return []
}
// The titles of an RSS or Atom feed, in order, CDATA and tags stripped.
export const parseTitles = (xml: string): string[] =>
  [...xml.matchAll(/<item>[\s\S]*?<title>([\s\S]*?)<\/title>|<entry>[\s\S]*?<title[^>]*>([\s\S]*?)<\/title>/g)]
    .map(hit => (hit[1] ?? hit[2] ?? '').replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim())
    .filter(title => title !== '')
    .slice(0, 12)

// What the model is asked, once an hour: ten short lines in the owner's dialect, from the
// project's goal and open steps and the hour's headlines. One call, no history, a small cap.
export const thinkPrompt = (now: FoxyView, open: string[], titles: string[]): string =>
  [
    'أنت فوكسي، ثعلب صغير يعيش على شريط تقدّم في محرر برمجة، تتكلم بلهجة كويتية خفيفة الدم، وتحب تتنمّر على صاحبك بأدب: سخرية ذكية خفيفة على تأخيره وقراراته المعلّقة ونسبته، بدون إهانة ولا ألفاظ، ولا تمسّ أحداً غيره.',
    `المشروع: ${now.goal}. النسبة ${now.percent}%. المرحلة الحالية: ${now.now}.`,
    open.length > 0 ? `خطوات مفتوحة: ${open.join(' | ')}.` : '',
    titles.length > 0 ? `عناوين أخبار الساعة:\n- ${titles.join('\n- ')}` : '',
    'اكتب عشر جمل فقط، كل جملة 36 حرفاً أو أقل، بدون أي حرف لاتيني أو رموز، كلها عربية:',
    '1 تبدأ بـ«فكرة:» اقتراح عملي للمشروع، 1 تبدأ بـ«تلميح:» عن استخدام كلود كود، 1 تبدأ بـ«أبوذية:» شطر من أبوذية عراقية جنوبية من تأليفك عن الشغل والصبر، 1 تبدأ بـ«موال:» شطر من موال من تأليفك، 3 تبدأ بـ«خبر:» تلخّص عنواناً من الأخبار بالعربي، و3 تنمّر مؤدّب على صاحبك من أرقام مشروعه (بدون بادئة).',
    'صاحبك يبرمج مع كلود كود، ويسوي مونتاج فيديو وتصاميم، ومن الكويت، ويتابع الفوركس. اختر من العناوين بس اللي يهمه: جديد كلود وأنثروبيك، أدوات المونتاج والتصميم والذكاء الاصطناعي، أبرز أخبار التقنية بالعالم (أجهزة وتطبيقات وشركات كبيرة)، قرارات الكويت اللي تمس يومه (عطل، دوام، خدمات، رواتب، أسعار، طقس)، وحركة الفوركس والذهب والدولار والفايدة.',
    'خبر الفوركس رقم وحقيقة بس (مثل: اليورو بأدنى مستوى من سنة)، بلا توصية ولا توقع شراء وبيع.',
    'اترك أي خبر عن ألعاب الفيديو والكونسولات (مراجعات ومواعيد وإعلانات ألعاب)، وحرب أو عسكر أو إدانات أو دبلوماسية أو جريمة أو موت أو مرض أو اجتماعات وإلغاءات وقضايا. خذ بس الأخبار المهمة. إذا ما لقيت ثلاثة تستاهل، اكتب أقل، وعوّض الباقي بأفكار وتلميحات.',
    'أجب بكائن JSON فقط، بلا أي شرح: {"lines": [الجمل العشر], "more": {"جملة الخبر كما كتبتها": "شرح الخبر بالعربي في ثلاث جمل إلى خمس"}} ولكل خبر مدخل في more، ولكل أبوذية وموال مدخل في more فيه الأبيات كاملة (الأبوذية أربعة أشطر تنتهي الثلاثة الأولى بجناس والرابع بـ«ية»)، من تأليفك لا منقولة.',
  ]
    .filter(part => part !== '')
    .join('\n')

// The last three things the user typed, and how many turns since Foxy last weighed them.
// Every third turn Foxy asks the model whether the user has drifted off the project; when
// so, it says one short polite jab (`لا تبربر وايد`) and dances. Nothing is kept beyond three.
let recent: string[] = []
let turnsSinceCheck = 0
export const driftPrompt = (now: FoxyView, latest: string[]): string =>
  [
    'أنت فوكسي، ثعلب صغير يراقب محادثة برمجة بلهجة كويتية خفيفة الدم.',
    `المشروع: ${now.goal}. المرحلة الحالية: ${now.now}.${typeof now.focus === 'string' && now.focus !== '' ? ` الشغل الحين على: ${now.focus}.` : ''}`,
    'آخر ما كتبه صاحب المشروع:',
    ...latest.map((one, index) => `${index + 1}. ${one}`),
    'اكتب له جملة وحدة بالكويتي، 36 حرفاً أو أقل، عربية بلا حروف لاتينية، بكلمات سهلة، وكل مرة جملة جديدة.',
    'إذا طلع برا الموضوع أو مو مركّز بهدفه: زفّة بسيطة ترجّعه، مثل: «ليش طلعت برا الموضوع؟» «ليش مو مركّز بهدفك؟» «لا تبربر وايد وركّز» «رجّعنا للشغل» «المشروع ينتظرك» — بدون كلمات ثقيلة مثل حاد أو انحرف.',
    'إذا بنفس الموضوع: تطنّز خفيف ومؤدّب على اللي قاعد يسويه الحين بالذات، مثل: «للحين على نفس الزر؟» «عدّلتها ثلاث مرات، ما شاء الله».',
    'أجب بـ JSON فقط: {"off": true إذا برا الموضوع وإلا false, "line": "الجملة"}',
  ].join('\n')
export const parseVerdict = (text: string): { off: boolean; line: string } => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  try {
    const got = JSON.parse(text.slice(start, end + 1)) as { off?: unknown; line?: unknown }

    return { off: got.off === true, line: typeof got.line === 'string' ? got.line.trim() : '' }
  } catch {
    return { off: false, line: '' }
  }
}
// What Foxy says on every third reply, in one small model call: a plain scold when the user
// has drifted, a light tease about what he is doing when he has not. One time in three it says
// a headline or a tip it already holds instead, and asks the model nothing.
const say = async ($: EngineInterface, line: string, act: Frog['act']) => {
  const at = await $.clock.now()
  await update($, frog, was => ({ ...(was ?? QUIET), act, frame: 0, isBig: false, line, said: at }))
  await $.clock.sleep(700)
  await update($, frog, was => ({ ...(was ?? QUIET), act: 'idle', frame: 0, isBig: false, line, said: at }))
}
const remark = async ($: EngineInterface) => {
  if (!smartLines || recent.length < 2) return
  const view0 = (await read($, view).catch(() => EMPTY)) as FoxyView
  if (!Array.isArray(view0.stages) || view0.stages.length === 0) return
  const at = await $.clock.now()
  const held = ((await read($, smart).catch(() => [])) as unknown[]).filter((one): one is string => typeof one === 'string' && /^(خبر|تلميح):/.test(one))
  if (Math.floor(at / 1000) % 3 === 0 && held.length > 0) return say($, choose(held, at), 'jump')
  const reply = await $.model.complete({ model: modelId, prompt: driftPrompt(view0, recent), maxTokens: 200, timeoutMs: 40000 }).catch(() => undefined)
  if (!reply || !reply.isAnswered) return
  const verdict = parseVerdict(reply.text)
  if (verdict.line === '' || /[A-Za-z]/.test(verdict.line) || verdict.line.length > 40) return
  await say($, verdict.line, verdict.off ? 'dance' : 'jump')
}

// The hour's reply: ten lines, and for a headline the longer story behind it, by its line.
// An older reply, a bare array of lines, is read as lines with no stories.
export const parseThought = (text: string): { lines: string[]; more: Record<string, string> } => {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  try {
    const got = JSON.parse(text.slice(start, end + 1)) as { lines?: unknown; more?: unknown }
    if (Array.isArray(got.lines)) {
      const more = Object.fromEntries(
        Object.entries(got.more && typeof got.more === 'object' ? (got.more as Record<string, unknown>) : {})
          .filter((pair): pair is [string, string] => typeof pair[1] === 'string' && pair[1].trim() !== '')
          .map(([line, story]) => [line.trim(), story.trim().slice(0, 1500)]),
      )

      return { lines: parseLines(JSON.stringify(got.lines)), more }
    }
  } catch {
    // not an object: an array may still be in it
  }
  const from = text.indexOf('[')
  const to = text.lastIndexOf(']')

  return { lines: from >= 0 && to > from ? parseLines(text.slice(from, to + 1)) : [], more: {} }
}

let rssUrl = ''
// What the owner cares for: Claude and Anthropic, the tools he edits video and designs with,
// the world's top tech headlines, what is decided in Kuwait (in Arabic), and the forex market. The model keeps
// only what touches his day, in plain facts.
const news = (q: string) => {
  const isArabic = /[\u0600-\u06FF]/.test(q)

  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${isArabic ? 'ar' : 'en-US'}&gl=${isArabic ? 'KW' : 'US'}&ceid=${isArabic ? 'KW:ar' : 'US:en'}`
}
export const FEEDS = [
  news('"Claude Code" OR Anthropic OR "Claude AI" when:7d'),
  news('"DaVinci Resolve" OR "Adobe Firefly" OR "AI video editing" OR Figma when:7d'),
  'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=en-US&gl=US&ceid=US:en',
  news('الكويت قرار OR عطلة OR مجلس الوزراء OR الطقس OR رواتب when:2d'),
  news('forex "EUR/USD" OR "gold price" OR "US dollar" OR "Fed rate" when:2d'),
]
let smartLines = true
let modelId = 'claude-sonnet-5-5'
let thought = 0
const think = async ($: EngineInterface) => {
  if (!smartLines) return
  const at = await $.clock.now()
  if (at - thought < 3600000) return
  thought = at
  const view0 = (await read($, view).catch(() => EMPTY)) as FoxyView
  if (!Array.isArray(view0.stages) || view0.stages.length === 0) return
  const all = (await read($, tasks).catch(() => [])) as TaskStage[]
  const open = (Array.isArray(all) ? all : []).flatMap(stage => stage.items).filter(item => item.s !== 'done').slice(0, 5).map(item => item.t)
  const urls = /^https?:\/\//.test(rssUrl) && !rssUrl.includes('hnrss.org') ? [rssUrl] : FEEDS
  const feeds = await Promise.all(urls.map(url => $.http.fetch(url).catch(() => undefined)))
  const titles = feeds.flatMap(feed => (feed && feed.ok ? parseTitles(feed.text).slice(0, 6) : []))
  const reply = await $.model.complete({ model: modelId, prompt: thinkPrompt(view0, open, titles), maxTokens: 1100, timeoutMs: 60000 }).catch(() => undefined)
  if (!reply || !reply.isAnswered) return
  const told = parseThought(reply.text)
  const list = told.lines.filter(line => !/[A-Za-z]/.test(line)).slice(0, 12)
  await update($, tales, () => Object.fromEntries(Object.entries(told.more).filter(([line]) => list.includes(line))))
  if (list.length > 0) await update($, smart, () => list)
}

let linesUrl = ''
const fetchLines = async ($: EngineInterface) => {
  if (!/^https?:\/\//.test(linesUrl)) return
  const got = await $.http.fetch(linesUrl).catch(() => undefined)
  if (!got || !got.ok) return
  const list = parseLines(got.text).slice(0, 40)
  const was = await read($, remote).catch(() => [])
  const old = Array.isArray(was) ? was : []
  if (list.length === old.length && list.every((one, index) => one === old[index])) return
  await update($, remote, () => list)
}

// The owner's server: it holds the published plugin and the rooms' messages.
let serverUrl = ''
let myName = ''
// Names this user's own notes may carry: the one sent now and the shorter one sent before it.
let myNames: string[] = []
let room = ''
export const isNewer = (theirs: string, mine: string): boolean => {
  const a = theirs.split('.').map(part => Number.parseInt(part, 10) || 0)
  const b = mine.split('.').map(part => Number.parseInt(part, 10) || 0)
  for (let at = 0; at < 3; at += 1) if ((a[at] ?? 0) !== (b[at] ?? 0)) return (a[at] ?? 0) > (b[at] ?? 0)

  return false
}
// Only the plugin's own kinds of file, one folder deep: nothing a path could climb out with.
export const isOurs = (path: string): boolean => /^((hooks|types|scripts|\.claude-plugin)\/[\w.-]+|README\.md)$/.test(path) && !path.includes('..')
// Every ten minutes: when the server holds a higher version, its files are fetched whole and
// then written over the plugin's own (the manifest last, so a broken fetch changes nothing),
// and the fox says so. The folder the plugin is published from is never written to.
const refresh = async ($: EngineInterface) => {
  if (!/^https:\/\//.test(serverUrl)) return
  const root = $.plugin.root
  if (await $.fs.exists(`${root}/publish.sh`).catch(() => true)) return
  const manifest = await $.fs.read(`${root}/.claude-plugin/plugin.json`).catch(() => undefined)
  if (typeof manifest !== 'string') return
  const mine = String((JSON.parse(manifest) as { version?: unknown }).version ?? '0')
  const got = await $.http.fetch(`${serverUrl}/plugin/version`).catch(() => undefined)
  if (!got || !got.ok) return
  const told = JSON.parse(got.text) as { version?: unknown; files?: unknown }
  const files = (Array.isArray(told.files) ? told.files : []).filter((one): one is string => typeof one === 'string' && isOurs(one))
  if (typeof told.version !== 'string' || !isNewer(told.version, mine) || !files.includes('.claude-plugin/plugin.json')) return
  const texts: string[] = []
  for (const file of files) {
    const one = await $.http.fetch(`${serverUrl}/plugin/files/${file}`).catch(() => undefined)
    if (!one || !one.ok || one.text === '') return
    texts.push(one.text)
  }
  const order = files.map((file, at) => ({ file, text: texts[at] ?? '' })).sort((a, b) => Number(a.file.endsWith('plugin.json')) - Number(b.file.endsWith('plugin.json')))
  for (const one of order) await $.fs.write(`${root}/${one.file}`, one.text)
  const at = await $.clock.now()
  await update($, frog, was => ({ ...(was ?? QUIET), line: 'فوكسي تحدّث، اكتب /reload-plugins', said: at }))
}

// The room: read every minute from the last message held on, and a message from someone else
// that arrived since the last look is said by the fox. The first look only fills the list.
// The name on a message is the one Claude already knows its user by: nothing to fill in.
export const nameIn = (config: string): string => {
  try {
    const account = (JSON.parse(config) as { oauthAccount?: { displayName?: unknown; fullName?: unknown } }).oauthAccount
    const name = typeof account?.fullName === 'string' && account.fullName.trim() !== '' ? account.fullName : account?.displayName

    return typeof name === 'string' ? name.trim().slice(0, 40) : ''
  } catch {
    return ''
  }
}
const whoAmI = async ($: EngineInterface) => {
  const home = (await $.env.get('HOME').catch(() => undefined)) ?? ''
  const config = await $.fs.read(`${home}/.claude.json`).catch(() => undefined)
  const user = (await $.env.get('USER').catch(() => undefined)) ?? ''
  myName = (typeof config === 'string' ? nameIn(config) : '') || String(user).slice(0, 40)
  const short = typeof config === 'string' ? (JSON.parse(config) as { oauthAccount?: { displayName?: unknown } }).oauthAccount?.displayName : undefined
  myNames = [myName, ...(typeof short === 'string' ? [short.trim()] : [])]
}
export const newKey = (seed: number): string => {
  let key = ''
  let at = Math.abs(Math.floor(seed)) || 1
  for (let n = 0; n < 10; n += 1) {
    at = (at * 1103515245 + 12345 + Math.floor(Math.random() * 1e9)) % 2147483648
    key += 'abcdefghjkmnpqrstuvwxyz23456789'[at % 31]
  }

  return `fox-${key}`
}
// Entering a room: the key is kept for every later session, the list starts over, and the
// room is read at once. An empty key leaves the room.
const enter = async ($: EngineInterface, key: string) => {
  const wanted = key.trim()
  if (wanted !== '' && !isRoom(wanted)) return
  // leaving by a slip must not lose the room: its key is kept and the tab offers the way back
  if (wanted === '' && room !== '') {
    await $.store.set('lastRoom', { key: room, host: isHost }).catch(() => undefined)
    await update($, past, () => room).catch(() => undefined)
  }
  // whoever opens a room hosts Foxy in it; joining or leaving one does not
  if (wanted === '' || wanted !== room) isHost = isHost && wanted !== '' && room === ''
  room = wanted
  hasLooked = false
  await $.store.set('room', wanted).catch(() => undefined)
  await $.store.set('host', isHost).catch(() => undefined)
  await update($, notes, () => [])
  await update($, den, () => wanted)
  if (wanted !== '') await pollNotes($).catch(() => undefined)
}
// Puts text on the clipboard and says so. The machine's own tool is asked first (it is sure);
// where there is none, the surface's clipboard is.
const copy = async ($: EngineInterface, text: string) => {
  const ran = await $.process.run(['pbcopy'], { stdin: text, timeoutMs: 5000 }).catch(() => undefined)
  const took = ran?.exitCode === 0 || (await $.ui.copy({ text }).catch(() => undefined))?.isCopied === true
  await $.ui.toast(took ? 'انسخ المفتاح.' : 'ما انسخ. انقله بإيدك.')

  return took
}
const goBack = async ($: EngineInterface) => {
  const kept = (await $.store.get('lastRoom').catch(() => undefined)) as { key?: unknown; host?: unknown } | undefined
  if (typeof kept?.key !== 'string' || !isRoom(kept.key)) {
    await $.ui.toast('ما لقيت آخر غرفة. افتح غرفة جديدة.')

    return
  }
  room = ''
  isHost = kept.host === true
  await enter($, kept.key)
  await $.ui.toast('رجعت للغرفة.')
}
const openRoom = async ($: EngineInterface) => {
  const key = newKey(await $.clock.now())
  isHost = true
  await enter($, key)
  await copy($, key)
}
export const isRoom = (key: string): boolean => /^[A-Za-z0-9_-]{4,64}$/.test(key)
let hasLooked = false
// The last note this user has had in front of him: the messages tab, drawn, sets it.
let seenUpTo = 0
// Foxy in the room: called by name, it answers in the room's own way of talking, which it reads
// off the last notes. It answers from the machine of whoever opened the room (one small model
// call a reply), and the server lets one machine only take each note.
let isHost = false
export const isCall = (note: Note): boolean => note.from !== TITLE && /فوكسي|foxy/i.test(note.text)
export const replyPrompt = (latest: Note[], asked: Note): string =>
  [
    'أنت فوكسي، ثعلب صغير وعضو في غرفة سوالف بين ربع. اسمك فوكسي وبس: لا تسمّي نفسك بأي اسم ثاني ولا تذكر اسم أي موديل أو شركة، وإذا سألوك منو أنت قل إنك فوكسي ثعلب الغرفة. لا تدّعي إنك إنسان.',
    'هذي آخر رسائل الغرفة. تعلّم منها أسلوبهم: نفس اللهجة، نفس طول الجمل، نفس المزح، ورد مثلهم كأنك واحد منهم:',
    ...latest.map(one => `${one.from}: ${one.text}`),
    `${asked.from} ناداك بهالرسالة: «${asked.text}». ردّك ينقال على شريط صغير فوق صندوق الكتابة، فالمطلوب ضحكة مو شرح: جملة وحدة خفيفة دم، 36 حرفاً أو أقل، بدون مقدمات وبدون ما تكتب اسمك في أولها.`,
  ].join('\n')
const answer = async ($: EngineInterface, held: Note[], asked: Note) => {
  const taken = await $.http
    .fetch(`${serverUrl}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, id: asked.id }) })
    .catch(() => undefined)
  if (!taken || !taken.ok || (JSON.parse(taken.text) as { ok?: unknown }).ok !== true) return
  const reply = await $.model.complete({ model: modelId, prompt: replyPrompt(held.slice(-20), asked), maxTokens: 220, timeoutMs: 40000 }).catch(() => undefined)
  const text = reply && reply.isAnswered ? reply.text.trim().replace(/^فوكسي\s*[:：]\s*/, '').slice(0, 60) : ''
  if (text === '') return
  await $.http
    .fetch(`${serverUrl}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, from: TITLE, text }) })
    .catch(() => undefined)
}
// The hour a note was written, as a chat shows it: 3:07 م.
export const clock = (seconds: number, shift = new Date(seconds * 1000).getTimezoneOffset()): string => {
  const minutes = (((Math.floor(seconds / 60) - shift) % 1440) + 1440) % 1440
  const hour = Math.floor(minutes / 60)

  return `${hour % 12 === 0 ? 12 : hour % 12}:${String(minutes % 60).padStart(2, '0')} ${hour < 12 ? 'ص' : 'م'}`
}
// One tick once someone else has fetched the note, two once someone else has read it.
export const ticks = (id: number, me: string, others: Mate[]): string => {
  const rest = others.filter(one => one.name !== me && one.name !== TITLE)

  return rest.some(one => one.seen >= id) ? '✓✓' : rest.some(one => one.got >= id) ? '✓' : ''
}
// The room is the user's, not one conversation's: entered or left in one, the others follow
// at their next look.
const follow = async ($: EngineInterface) => {
  const kept = await $.store.get('room').catch(() => undefined)
  const wanted = typeof kept === 'string' && isRoom(kept) ? kept : ''
  if (wanted === room) return
  room = wanted
  isHost = wanted !== '' && (await $.store.get('host').catch(() => false)) === true
  hasLooked = false
  await update($, notes, () => [])
  await update($, den, () => wanted)
  const before = (await $.store.get('lastRoom').catch(() => undefined)) as { key?: unknown } | undefined
  await update($, past, () => (typeof before?.key === 'string' ? before.key : ''))
}
const pollNotes = async ($: EngineInterface) => {
  await follow($).catch(() => undefined)
  if (!hasMap || !/^https:\/\//.test(serverUrl) || !isRoom(room)) return
  const was = (await read($, notes).catch(() => [])) as unknown
  const held: Note[] = Array.isArray(was) ? (was as Note[]) : []
  const last = held.reduce((most, one) => Math.max(most, Number(one.id) || 0), 0)
  const got = await $.http.fetch(`${serverUrl}/notes?room=${room}&since=${last}&who=${encodeURIComponent(myName)}&seen=${seenUpTo}`).catch(() => undefined)
  if (!got || !got.ok) return
  const told = JSON.parse(got.text) as { notes?: unknown; members?: unknown }
  const fresh = (told.notes ?? []) as Note[]
  const here: Mate[] = (Array.isArray(told.members) ? (told.members as Mate[]) : [])
    .filter(one => one && typeof one.name === 'string')
    .map(one => ({ name: one.name, on: one.on === true, got: Number(one.got) || 0, seen: Number(one.seen) || 0 }))
  const wasHere = (await read($, mates).catch(() => [])) as unknown
  // a write redraws the pane, so none when nobody moved
  if (JSON.stringify(wasHere) !== JSON.stringify(here)) await update($, mates, () => here)
  const isFirst = !hasLooked
  hasLooked = true
  if (!Array.isArray(fresh) || fresh.length === 0) return
  const all = [...held, ...fresh].slice(-50)
  await update($, notes, () => all)
  // a call no older than five minutes, on the host's machine, with the smart lines on
  const now = await $.clock.now()
  // with nobody else in the room every note is said to Foxy; with company, only a call by name
  const isAlone = !here.some(one => !myNames.includes(one.name) && one.name !== TITLE && one.on)
  const call = isHost && smartLines ? fresh.filter(one => one.from !== TITLE && (isAlone || isCall(one)) && now / 1000 - Number(one.at) < 300).pop() : undefined
  if (call) void answer($, all, call).catch(() => undefined)
  const theirs = fresh.filter(one => !myNames.includes(one.from))
  const newest = theirs[theirs.length - 1]
  if (isFirst || !newest) return
  // the point of the room: the fox on the strip says it. Its own answer bare, a friend's with the name.
  await say($, cut(newest.from === TITLE ? newest.text : `${newest.from}: ${newest.text}`, 40), newest.from === TITLE ? 'dance' : 'jump')
}
const sendNote = async ($: EngineInterface, typed: string) => {
  const text = typed.trim()
  if (text === '' || myName === '' || !isRoom(room) || !/^https:\/\//.test(serverUrl)) return
  await $.http
    .fetch(`${serverUrl}/notes`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, from: myName, text: text.slice(0, 500) }) })
    .catch(() => undefined)
  await pollNotes($)
}

// What shows in the conversation when Foxy asks for a map: one short line. The order itself
// rides unseen in the model's prompt (the `foxy:make-one` section) while `wantsMap` holds.
const ASK = 'جهّز ملف فوكسي لهذا المشروع.'

// Whether a model turn is running, and whether /foxy asked for a map while one was: Foxy's own
// prompt is held until the turn ends, so it never runs over the work in hand.
let isBusy = false
let wantsMap = false
let asks = 0

// The machine's conversations, read again at most once a minute, and which one this is.
let convosAt = 0
let myLocal = ''
const loadConvos = async ($: EngineInterface, isForced = false) => {
  const at = await $.clock.now()
  if (!isForced && at - convosAt < 60000) return
  convosAt = at
  const ran = await $.process.run(['node', `${$.plugin.root}/scripts/foxy-agents.cjs`, '--all'], { timeoutMs: 20000 }).catch(() => undefined)
  if (!ran || ran.exitCode !== 0) return
  const list = (JSON.parse(ran.stdout) as Convo[]).filter(one => typeof one.local === 'string')
  const me = await $.session.id().catch(() => '')
  myLocal = list.find(one => one.cli === me)?.local ?? myLocal
  const kept = await $.store.get('marks').catch(() => [])
  await update($, marks, () => (Array.isArray(kept) ? (kept as Mark[]) : []))
  await update($, convos, () => list)
}
// The ones dropped from the kept, newest first: they stand at the top of the latest, so a drop
// is never lost (an old or archived conversation is not among the latest eight).
let dropped: Mark[] = []
const keepMark = async ($: EngineInterface, one: Mark, isKept: boolean) => {
  dropped = [...(isKept ? [] : [{ local: one.local, title: one.title, place: one.place }]), ...dropped.filter(mark => mark.local !== one.local)].slice(0, 8)
  const was = await $.store.get('marks').catch(() => [])
  const list = (Array.isArray(was) ? (was as Mark[]) : []).filter(mark => mark.local !== one.local)
  const next = isKept ? [{ local: one.local, title: one.title, place: one.place }, ...list].slice(0, 30) : list
  await $.store.set('marks', next).catch(() => undefined)
  await update($, marks, () => next)
}
const goTo = async ($: EngineInterface, local: string) => {
  if (!/^local_[0-9a-f-]+$/.test(local)) return
  await $.process.run(['open', `claude://claude.ai/epitaxy/${local}`], { timeoutMs: 10000 }).catch(() => undefined)
}

// Whether the pane is open: set by our opens, cleared when anyone closes it.
let isPaneOpen = false
const openPane = async ($: EngineInterface) => {
  const placed = await $.ui.open({ id: PANE, title: TITLE }).catch(() => undefined)
  isPaneOpen = placed?.isPlaced !== false
}

let here = ''
const measure = async ($: EngineInterface) => {
  if (!hasMap) return
  // every session of this project on this machine joins the crew, named after its title
  if (here !== '') {
    const listed = await $.process.run(['node', `${$.plugin.root}/scripts/foxy-agents.cjs`, '--sessions', here], { timeoutMs: 20000 }).catch(() => undefined)
    if (listed && listed.exitCode === 0) {
      const found = JSON.parse(listed.stdout) as { local: string; cli: string; title: string; isArchived: boolean }[]
      await update($, crew, was => {
        const list = Array.isArray(was) ? was : []
        const fresh = found
          .filter(one => !one.isArchived && !list.some(old => old.cli === one.cli))
          .map(one => ({ key: one.local, name: cut(one.title, 16), cli: one.cli, done: 0, total: 0, tokens: 0, isActive: false, costume: costumeOf(one.title, one.local), session: one.local }))
        const withSession = list.map(old => (old.session ? old : { ...old, session: found.find(one => one.cli === old.cli)?.local ?? '' }))

        return fresh.length === 0 && withSession.every((one, index) => one.session === list[index]?.session) ? list : [...withSession, ...fresh]
      })
    }
  }
  const team = await read($, crew).catch(() => [])
  const ids = (Array.isArray(team) ? team : []).map(one => one.cli).filter(cli => /^[0-9a-f-]{36}$/.test(cli))
  if (ids.length === 0) return
  const ran = await $.process.run(['node', `${$.plugin.root}/scripts/foxy-agents.cjs`, ...ids], { timeoutMs: 60000 }).catch(() => undefined)
  if (!ran || ran.exitCode !== 0) return
  const rows = JSON.parse(ran.stdout) as { id: string; tokens: number; lastMs: number }[]
  const at = await $.clock.now()
  const was = await read($, crew).catch(() => [])
  const list = Array.isArray(was) ? was : []
  const next = list.map(one => {
    const row = rows.find(each => each.id === one.cli)

    return row ? { ...one, tokens: row.tokens, isActive: at - row.lastMs < 120000 } : one
  })
  // a write redraws the pane, so none when nothing moved
  const isSame = next.every((one, index) => one.tokens === list[index]?.tokens && one.isActive === list[index]?.isActive)
  if (!isSame) await update($, crew, () => next)
}

// The fox's act: a class that plays once, then still. Every act ends with a new line.
const ACTS: Frog['act'][] = ['jump', 'tongue', 'spin', 'dance']
const perform = async ($: EngineInterface, act: Frog['act'], seed: number) => {
  const view0 = (await read($, view).catch(() => EMPTY)) as FoxyView
  const team0 = (await read($, crew).catch(() => [])) as Agent[]
  const fetched0 = [...((await read($, remote).catch(() => [])) as unknown[]), ...((await read($, smart).catch(() => [])) as unknown[])]
  const line = fresh(lines(view0, Array.isArray(team0) ? team0 : [], Array.isArray(fetched0) ? (fetched0 as string[]) : []))
  // the act is a CSS animation that plays once on the redraw that sets it; one more redraw
  // after it lands leaves the fox still, with its new line
  await update($, frog, was => ({ ...(was ?? QUIET), act, frame: 0, isBig: false, line }))
  await $.clock.sleep(700)
  await update($, frog, was => ({ ...(was ?? QUIET), act: 'idle', frame: 0, isBig: false, line }))
}
// The three calls to prayer of the Shia in Kuwait City (aladhan.com, the Ja'fari reckoning, method 0),
// fetched once a day and set to the owner's calendar (تقويم الصائغ): its dawn call comes ten minutes
// before the site's Fajr; noon and sunset match. At each, for five minutes, the fox jumps and calls.
export const PRAYERS: Record<string, string> = { Fajr: 'الفجر', Dhuhr: 'الظهر', Maghrib: 'المغرب' }
const SHIFT: Record<string, number> = { Fajr: -10 }
const KUWAIT = 3 * 3600000
let prayerDay = ''
let prayerTimes: { name: string; at: number }[] = []
export const prayerList = (timings: Record<string, unknown>, dayStart: number): { name: string; at: number }[] =>
  Object.keys(PRAYERS).flatMap(key => {
    const hit = /^(\d{1,2}):(\d{2})/.exec(String(timings[key] ?? ''))
    return hit ? [{ name: PRAYERS[key] ?? key, at: dayStart + (Number(hit[1]) * 60 + Number(hit[2]) + (SHIFT[key] ?? 0)) * 60000 - KUWAIT }] : []
  })
const callToPrayer = async ($: EngineInterface, at: number): Promise<boolean> => {
  const local = new Date(at + KUWAIT)
  const day = `${String(local.getUTCDate()).padStart(2, '0')}-${String(local.getUTCMonth() + 1).padStart(2, '0')}-${local.getUTCFullYear()}`
  if (day !== prayerDay) {
    const got = await $.http.fetch(`https://api.aladhan.com/v1/timingsByCity/${day}?city=Kuwait%20City&country=Kuwait&method=0`).catch(() => undefined)
    if (!got || !got.ok) return false
    const timings = (JSON.parse(got.text) as { data?: { timings?: Record<string, unknown> } }).data?.timings ?? {}
    prayerTimes = prayerList(timings, Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()))
    prayerDay = day
  }
  const due = prayerTimes.find(one => at >= one.at && at - one.at < 300000)
  if (!due) return false
  const last = Number(await read($, adhan).catch(() => 0))
  if (last === due.at) return false
  await update($, adhan, () => due.at)
  await say($, `قوم صلّ يالله، أذّن ${due.name}`, 'jump')

  return true
}
// Now and then the frog speaks on its own: a fact, a joke or a tip, and sometimes a small act.
const chatter = async ($: EngineInterface) => {
  const at = await $.clock.now()
  if (await callToPrayer($, at).catch(() => false)) return
  if (!hasMap) return
  // on the clock's own ten minutes (:00 :10 … :50), whenever the code was loaded. At the head
  // of an hour the fox first jumps and says the hour; the blessing follows at its next look.
  const slot = Math.floor(at / 600000)
  const kept = Number(await read($, blessed).catch(() => 0))
  if (slot !== kept) {
    if (at % 3600000 < 120000 && kept !== slot - 0.5) {
      await update($, blessed, () => slot - 0.5)
      await say($, hourLine(at), 'jump')

      return
    }
    await update($, blessed, () => slot)
    await bless($)

    return
  }
  const state = (await read($, frog).catch(() => QUIET)) as Frog
  if (at - (state.said ?? 0) < 90000) return
  const seed = Math.floor(at / 1000)
  // on its own it only speaks (an act is three redraws, kept for a press)
  const act: Frog['act'] = 'idle'
  await update($, frog, was => ({ ...(was ?? QUIET), said: at }))
  if (act === 'idle') {
    const view0 = (await read($, view).catch(() => EMPTY)) as FoxyView
    const team0 = (await read($, crew).catch(() => [])) as Agent[]
    const fetched0 = [...((await read($, remote).catch(() => [])) as unknown[]), ...((await read($, smart).catch(() => [])) as unknown[])]
    await update($, frog, was => ({ ...(was ?? QUIET), line: fresh(lines(view0, Array.isArray(team0) ? team0 : [], Array.isArray(fetched0) ? (fetched0 as string[]) : [])), said: at }))
  } else {
    await perform($, act, seed)
  }
}

// Every ten minutes the fox says the blessing; it stays until the fox next speaks on
// its own, a minute and a half or more.
export const BLESSING = 'اللهم صلِّ على محمد وآل محمد'
// What the fox says of the work in hand: «الآن: …», the bare words when that is too long for
// the strip, cut only when even they are.
export const focusLine = (now: FoxyView): string => {
  const focus = typeof now.focus === 'string' ? now.focus.trim() : ''
  if (focus === '') return ''

  return `الآن: ${focus}`.length <= 40 ? `الآن: ${focus}` : focus.length <= 40 ? focus : `${focus.slice(0, 39)}…`
}
export const hourLine = (ms: number, shift?: number): string => `ترى الساعة صارت ${clock(Math.floor(ms / 1000), shift)}`
const bless = async ($: EngineInterface) => {
  if (!hasMap) return
  const at = await $.clock.now()
  await update($, frog, was => ({ ...(was ?? QUIET), line: BLESSING, said: at }))
}

export const register: Register = (on, options) => {
  const given = (options ?? {}) as { linesUrl?: unknown; rssUrl?: unknown; smartLines?: unknown; model?: unknown; serverUrl?: unknown; foxyRoom?: unknown }
  serverUrl = typeof given.serverUrl === 'string' ? given.serverUrl.replace(/\/+$/, '') : ''
  room = typeof given.foxyRoom === 'string' ? given.foxyRoom.trim() : ''
  linesUrl = typeof given.linesUrl === 'string' ? given.linesUrl : ''
  rssUrl = typeof given.rssUrl === 'string' ? given.rssUrl : ''
  smartLines = given.smartLines !== false
  modelId = typeof given.model === 'string' && given.model !== '' ? given.model : 'claude-sonnet-5-5'
  on('session.start', async ($, e, next) => {
    here = String((e as { cwd?: string }).cwd ?? '')
    await $.command.register({
      name: 'foxy',
      description: 'فوكسي: مراحل المشروع والفريق، وثعلب يسولف فوق صندوق المحادثة',
      argumentHint: '[plain | colour | bar]',
    })
    await sync($)
    $.clock.every(4000, () => void sync($).catch(() => undefined))
    void measure($).catch(() => undefined)
    $.clock.every(30000, () => void measure($).catch(() => undefined))
    void fetchLines($).catch(() => undefined)
    $.clock.every(600000, () => void fetchLines($).catch(() => undefined))
    $.clock.after(20000, () => void think($).catch(() => undefined))
    $.clock.every(900000, () => void think($).catch(() => undefined))
    $.clock.after(30000, () => void refresh($).catch(() => undefined))
    $.clock.every(600000, () => void refresh($).catch(() => undefined))
    await whoAmI($).catch(() => undefined)
    // the key typed into the option, if any, else the one kept from the tab
    const kept = room !== '' ? room : await $.store.get('room').catch(() => undefined)
    room = typeof kept === 'string' && isRoom(kept) ? kept : ''
    // a room kept from before hosting was recorded was opened here: only a join records false
    isHost = room !== '' && (await $.store.get('host').catch(() => false)) !== false
    await update($, den, () => room).catch(() => undefined)
    const before = (await $.store.get('lastRoom').catch(() => undefined)) as { key?: unknown } | undefined
    await update($, past, () => (typeof before?.key === 'string' ? before.key : '')).catch(() => undefined)
    void loadConvos($, true).catch(() => undefined)
    void pollNotes($).catch(() => undefined)
    $.clock.every(30000, () => void pollNotes($).catch(() => undefined))
    void chatter($).catch(() => undefined)
    $.clock.every(45000, () => void chatter($).catch(() => undefined))
    // the strip alone shows by itself; the pane opens from the strip's arrow or with /foxy

    return next(e)
  })

  on('command.run', { command: 'foxy' }, async ($, e) => {
    const asked = e.args.trim()
    if (asked === 'plain' || asked === 'colour') await update($, look, () => asked)
    if (asked === 'bar') await update($, bar, was => (was === 'off' ? 'on' : 'off'))
    seen = '\u0000'
    const now = await sync($)
    void measure($).catch(() => undefined)
    if (asked !== 'bar') await update($, bar, () => 'on')
    await openPane($)
    // no map here: Foxy has the model read the project and write one, rather than ask for it
    if (now.path === '' && outside !== '' && now.view.text === EMPTY.text) {
      // never over a turn that is running: the map waits for it to end
      // asked for from now on: every request carries the order until the file exists, so the
      // map is made with the next reply at the latest
      wantsMap = true
      if (isBusy) return { text: 'كلود مشغول الحين. ملف فوكسي يتسوى أول ما يخلص، بدون ما أقاطعه.' }
      // a turn of its own, asked for once this command has ended (asked from inside it, none began)
      $.clock.after(1500, () => void $.prompt.submit({ text: ASK, asUser: true }).catch(() => undefined))

      return { text: 'ما في ملف لفوكسي هني. يتسوى بروحه مع أول رد من كلود.' }
    }

    return { text: now.view.text }
  })

  on('prompt.submit', async ($, e, next) => {
    const typed = String((e as { text?: unknown }).text ?? '').trim()
    const isPlugins = (e as { origin?: { kind?: string } }).origin?.kind === 'plugin'
    if (typed !== '' && !typed.startsWith('/') && !isPlugins) recent = [...recent, typed.slice(0, 300)].slice(-3)
    await sync($).catch(() => undefined)

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if ((e as { id?: string }).id === PANE) isPaneOpen = false

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    isBusy = true

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    isBusy = false
    if (wantsMap) {
      if ((await found($)).path !== '') wantsMap = false
      else if (asks < 2) {
        asks += 1
        void $.prompt.submit({ text: ASK, asUser: true }).catch(() => undefined)
      }
    }
    await sync($).catch(() => undefined)
    void measure($).catch(() => undefined)
    turnsSinceCheck += 1
    if (turnsSinceCheck >= 3) {
      turnsSinceCheck = 0
      void remark($).catch(() => undefined)
    }

    return result
  })

  // What keeps the file itself current: the model is told, in every request of a session
  // whose project has Foxy's map, to update it in the same turn the work changes.
  on('prompt.compose', async ($, e, next) => {
    const result = await next(e)
    const at = (await found($)).path
    if (at === '' && !wantsMap) return result

    return at !== ''
      ? { ...result, sections: [...result.sections, { id: 'foxy:keep-current', text: rule(at), scope: 'session' as const }] }
      : { ...result, sections: [...result.sections, { id: 'foxy:make-one', text: `The user ran /foxy. ${makeNow(outside)} Do it first in your next reply, whatever the user wrote, then carry on with what they asked.`, scope: 'session' as const }] }
  })

  // Every value from the state is taken as what it is and nothing more (a string, an array
  // checked as one), since the state outlives a reload and an older load's value of another
  // shape must draw something, never throw: a hook that throws here leaves the pane empty.
  // A surface without the drawing element gets the plain look.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const table = $.ui.resolve(e)
    const { Box, Text, Button, Markdown } = table
    // a surface's table is read by name: the terminal has no Svg, the phone no Select
    const more = table as Partial<{ Svg: Elements['desktop']['Svg']; Select: Elements['desktop']['Select']; Input: Elements['desktop']['Input'] }>
    const Input = e.surface === 'desktop' || e.surface === 'vscode' ? more.Input : undefined
    const Svg = e.surface === 'terminal' ? undefined : more.Svg
    const Select = e.surface === 'mobile' ? undefined : more.Select
    const given =
      (
        e.props as
          | { foxyTest?: { view?: FoxyView; look?: string; tasks?: TaskStage[]; picked?: Picked; side?: Task[]; crew?: Agent[]; notes?: Note[]; mates?: Mate[]; tale?: Tale; room?: string; name?: string } }
          | undefined
      )?.foxyTest ?? {}
    const kept = (given.view ?? (await read($, view).catch(() => undefined))) as Partial<FoxyView> | undefined
    const wanted = given.look ?? (await read($, look).catch(() => 'plain'))
    const text =
      typeof kept?.board === 'string' && kept.board !== '' ? kept.board : typeof kept?.text === 'string' ? kept.text : EMPTY.text
    const stages = Array.isArray(kept?.stages) ? kept.stages : []
    const rawTasks = given.tasks ?? (await read($, tasks).catch(() => []))
    const all: TaskStage[] = Array.isArray(rawTasks) ? rawTasks : []
    if (wanted !== 'colour' || !Svg || stages.length === 0 || all.length !== stages.length) {
      return (
        <Box flexDirection="column">
          <Markdown text={text} />
        </Box>
      )
    }
    const tall = Number((e.props as { scroll?: { bodyRows?: unknown } }).scroll?.bodyRows) || 0
    const wide = Number((e.props as { bodyColumns?: unknown }).bodyColumns) || 31
    const rawSide = given.side ?? (await read($, side).catch(() => []))
    const aside: Task[] = Array.isArray(rawSide) ? rawSide : []
    const rawCrew = given.crew ?? (await read($, crew).catch(() => []))
    const team: Agent[] = Array.isArray(rawCrew) ? rawCrew : []
    const rawNotes = (given.notes ?? (await read($, notes).catch(() => []))) as unknown
    const mail: Note[] = Array.isArray(rawNotes) ? (rawNotes as Note[]).filter(one => one && typeof one.text === 'string' && typeof one.from === 'string') : []
    const rawMarks = (await read($, marks).catch(() => [])) as unknown
    const keptMarks: Mark[] = Array.isArray(rawMarks) ? (rawMarks as Mark[]).filter(one => one && typeof one.local === 'string') : []
    const nowMs = await Promise.resolve().then(() => $.clock.now()).catch(() => 0)
    const rawConvos = (await read($, convos).catch(() => [])) as unknown
    const recentAll: Convo[] = Array.isArray(rawConvos) ? (rawConvos as Convo[]).filter(one => one && typeof one.local === 'string') : []
    const rawMates = (given.mates ?? (await read($, mates).catch(() => []))) as unknown
    const everyone: Mate[] = Array.isArray(rawMates) ? (rawMates as Mate[]).filter(one => one && typeof one.name === 'string') : []
    const rawTale = (given.tale ?? (await read($, tale).catch(() => undefined))) as Partial<Tale> | undefined
    const story = { line: typeof rawTale?.line === 'string' ? rawTale.line : '', text: typeof rawTale?.text === 'string' ? rawTale.text : '' }
    const rawDen = given.room ?? (await read($, den).catch(() => ''))
    const roomNow = typeof rawDen === 'string' ? rawDen : ''
    const rawPast = given.room === undefined ? await read($, past).catch(() => '') : ''
    const lastRoom = typeof rawPast === 'string' && isRoom(rawPast) ? rawPast : ''
    const me = given.name ?? myName
    const mine = given.name === undefined ? (myNames.length > 0 ? myNames : [me]) : [given.name]
    const folk = everyone.filter(one => one.name === me || !mine.includes(one.name))
    const rawPicked = (given.picked ?? (await read($, picked).catch(() => undefined))) as Partial<Picked> | undefined
    const at = stages.findIndex(row => row.state === 'now')
    const tab = TABS.some(one => one.id === rawPicked?.tab) ? String(rawPicked?.tab) : 'overview'
    const number = Number(rawPicked?.stage)
    const chosen = Number.isInteger(number) && number >= 0 && number < stages.length ? number : Math.max(0, at)
    const filter = FILTERS.some(one => one.value === rawPicked?.filter) ? String(rawPicked?.filter) : 'open'
    const opened = String(rawPicked?.open ?? '')
    const seen = String(rawPicked?.seen ?? '')
    const now: Picked = { stage: String(chosen), filter, tab, open: opened, seen }
    const pickNow = (change: Partial<Picked>) => void update($, picked, () => ({ ...now, ...change }))
    if (tab === 'marks' && given.notes === undefined) void loadConvos($).catch(() => undefined)
    if (tab === 'notes' && given.notes === undefined) {
      const newest = mail.reduce((most, one) => Math.max(most, Number(one.id) || 0), 0)
      if (newest > seenUpTo) {
        seenUpTo = newest
        void pollNotes($).catch(() => undefined)
      }
    }
    const full = { ...EMPTY, ...kept, stages } as FoxyView
    const names: Record<string, string> = Object.fromEntries(team.map(one => [one.key, one.name]))
    const seenAt = /^\d+$/.test(seen) && Number(seen) < stages.length ? Number(seen) : -1
    const seenStage = seenAt < 0 ? undefined : all[seenAt]
    const press = async (stage: number, index: number, sub?: number) => {
      const { text: source, path } = await found($)
      if (typeof source !== 'string' || path === '') return
      const next = flip(JSON.parse(source) as FoxyMap, stage, index, new Date().toISOString().slice(0, 10), sub)
      await $.fs.write(path, `${JSON.stringify(next, null, 2)}\n`)
      await sync($)
    }
    // A list of steps. A press on a step opens it: its note, its own small steps (each one
    // pressed done or undone), and the button that marks the whole step. One open at a time.
    const steps = (list: Task[], stage: number, name: string) => {
      const shown = list
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => (filter === 'all' ? true : filter === 'open' ? item.s !== 'done' : item.s === filter))

      return [
        ...(shown.length === 0 ? [<Text dimColor>لا خطوات بهذا العرض.</Text>] : []),
        ...shown.map(({ item, index }) => {
          const id = `${name}-${index}`
          const subs = Array.isArray(item.sub) ? item.sub : []
          const isOpen = opened === id
          const left = subs.filter(one => one.s !== 'done').length

          return (
            <Box key={`foxy-row-${id}`} flexDirection="column" alignItems="flex-end">
              <Button
                key={`foxy-${id}`}
                variant={isOpen ? 'primary' : 'secondary'}
                label={`${item.t}${subs.length > 0 ? ` · ${subs.length - left} من ${subs.length}` : ''} ${DOT[item.s] ?? '🔵'}`}
                dimColor={item.s === 'done' && !isOpen}
                onPress={() => pickNow({ open: isOpen ? '' : id })}
              />
              {(isOpen ? [id] : []).map(() => (
                <Box flexDirection="column" alignItems="flex-end" paddingRight={2} rowGap={0}>
                  {(item.note === '' ? [] : [item.note]).map(note => (
                    <Text dimColor wrap="wrap">{note}</Text>
                  ))}
                  {(subs.length === 0 ? [] : [subs]).map(mine => (
                    <Box flexDirection="column" alignItems="flex-end" rowGap={1}>
                      <Svg source={subChart(item, names)} alt={mine.map(one => `${one.t}: ${WORD[one.s] ?? ''}`).join(' | ')} />
                      <Box flexDirection="row-reverse" columnGap={1}>
                        {mine.map((one, at) => (
                          <Button
                            key={`foxy-${id}-sub-${at}`}
                            variant={one.s === 'done' ? 'secondary' : 'primary'}
                            label={one.s === 'done' ? `${at + 1} ↩` : `${at + 1} ✓`}
                            onPress={() => void press(stage, index, at)}
                          />
                        ))}
                      </Box>
                    </Box>
                  ))}
                  <Button
                    key={`foxy-${id}-mark`}
                    label={item.s === 'done' ? 'تراجع عن «خلص»' : 'علّم الخطوة كلها «خلص» ✅'}
                    onPress={() => void press(stage, index)}
                  />
                </Box>
              ))}
            </Box>
          )
        }),
      ]
    }
    const menu = (Select ? [Select] : []).map(Menu => (
      <Menu key="foxy-filter" label="العرض" value={filter} options={FILTERS} onSelect={value => pickNow({ filter: value, open: '' })} />
    ))
    const body =
      tab === 'overview'
        ? [
            <Svg source={chart(full, -1, false)} alt={text} />,
            // The ladder, row by row: each row the approved drawing of itself (a still picture,
            // so it scrolls smoothly and keeps its colours) at the slot's full width, and laid
            // over its empty left end the one thing that takes a press, a plain chevron button.
            // Beside the drawing a button took width from it and the right end was cut; a hotkey
            // drew its own marker; a button over the disc made a mess. The pressed row is lit
            // and its steps are drawn under it.
            <Box flexDirection="column" alignItems="flex-end" rowGap={0}>
              {stages.map((row, index) => {
                const isSeen = seenAt === index

                return (
                  <Box key={`foxy-seen-${index}`} flexDirection="column" alignItems="flex-end">
                    <Box position="relative" alignItems="flex-end">
                      <Svg source={rowChart(row, index, index === stages.length - 1, isSeen)} alt={`${index + 1}. ${row.title} ${row.done}/${row.total}`} />
                      <Box position="absolute" left={0} top={0}>
                        <Button
                          key={`foxy-stage-${index}`}
                          plain
                          label={isSeen ? '▾' : '◂'}
                          dimColor={!isSeen}
                          onPress={() => pickNow({ seen: isSeen ? '' : String(index) })}
                        />
                      </Box>
                    </Box>
                    {(isSeen && seenStage ? [seenStage] : []).map(one => (
                      <Svg source={stageChart(one, names)} alt={one.items.map(item => `${item.t}: ${WORD[item.s] ?? ''}`).join(' | ')} />
                    ))}
                  </Box>
                )
              })}
            </Box>,
            // room under the ladder: the pane measures the drawn rows a little short and cut
            // the last one; a closing line, and the tally, keep it whole
            <Box paddingBottom={2}>
              <Text dimColor>{`المراحل ${stages.length} | الخطوات ${stages.reduce((sum, row) => sum + row.total, 0)}`}</Text>
            </Box>,
          ]
        : tab === 'foxy'
          ? [<Markdown text={story.text === '' ? 'ما عندي سالفة الحين. اضغط كلامي إذا قلت خبر.' : `**${story.line}**\n\n${story.text}`} />]
          : tab === 'notes'
            ? !isRoom(roomNow)
              ? [
                  <Text wrap="wrap">سوالف بينك وبين ربعك، من هني.</Text>,
                  <Box flexDirection="row-reverse" columnGap={1} flexWrap="wrap">
                    {(lastRoom === '' ? [] : [lastRoom]).map(() => (
                      <Button key="foxy-room-back" variant="primary" label="ارجع لآخر غرفة" onPress={() => void goBack($).catch(err => $.ui.toast(`ما رجعت: ${String((err as { message?: unknown })?.message ?? err).slice(0, 60)}`))} />
                    ))}
                    <Button key="foxy-room-new" variant={lastRoom === '' ? 'primary' : 'secondary'} label="افتح غرفة جديدة" onPress={() => void openRoom($).catch(err => $.ui.toast(`ما انفتحت: ${String((err as { message?: unknown })?.message ?? err).slice(0, 60)}`))} />
                  </Box>,
                  ...(Input
                    ? [<Input key="foxy-room-join" placeholder="عندك مفتاح من ربعك؟ الصقه هني" submitLabel="ادخل" value="" onSubmit={typed => void enter($, typed).catch(() => undefined)} />]
                    : []),
                ]
              : [
                  // laid out as every chat is: the room's own key and buttons on top, then who is here,
                  // the notes oldest first, and the field to write in last, at the bottom
                  <Box position="relative" alignItems="flex-end">
                    <Svg source={roomHead(roomNow)} alt={`مفتاح الغرفة ${roomNow}`} />
                    <Box position="absolute" left={0} top={0}>
                      <Button key="foxy-room-leave" plain label={'\u00A0\u00A0\u00A0\u00A0'} onPress={() => void enter($, '').catch(() => undefined)} />
                    </Box>
                    <Box position="absolute" left={Math.round((ROOM_COPY_X / 360) * wide)} top={0}>
                      <Button key="foxy-room-copy" plain label={'\u00A0\u00A0\u00A0\u00A0'} onPress={() => void copy($, roomNow).catch(() => undefined)} />
                    </Box>
                  </Box>,
                  ...(folk.length === 0 ? [] : [<Svg source={matesChart(folk, me)} alt={folk.map(one => `${one.name} ${one.on ? '●' : '○'}`).join(' | ')} />]),
                  <Box flexGrow={1} />,
                  ...(mail.length === 0
                    ? [<Text dimColor>ما في رسائل للحين. اكتب أول وحدة تحت.</Text>]
                    : [<Svg source={chatChart(mail.slice(-12), mine, folk)} alt={mail.slice(-12).map(one => `${one.from}: ${one.text}`).join(' | ')} />]),
                  ...(Input
                    ? [<Input key={`foxy-note-${mail.length}`} placeholder="اكتب رسالة" submitLabel="إرسال" value="" onSubmit={typed => void sendNote($, typed).catch(() => undefined)} />]
                    : [<Text dimColor>الكتابة من الكمبيوتر بس.</Text>]),
                ]
        : tab === 'marks'
          ? (() => {
              // laid out as a list of saved chats is everywhere: the one to keep this chat on top,
              // the kept ones grouped under their project, and under them the latest ones with a star each
              const here = recentAll.find(one => one.local === myLocal)
              const isHereKept = here !== undefined && keptMarks.some(one => one.local === here.local)
              const isFree = (local: string) => !keptMarks.some(mark => mark.local === local)
              const back: Convo[] = dropped.filter(one => isFree(one.local)).map(one => recentAll.find(convo => convo.local === one.local) ?? { local: one.local, cli: '', title: one.title, place: one.place ?? '', lastMs: 0 })
              const others = [...back, ...recentAll.filter(one => isFree(one.local) && !back.some(convo => convo.local === one.local)).slice(0, 5)]
              const when = (local: string) => ago(recentAll.find(one => one.local === local)?.lastMs ?? 0, nowMs)
              const over = (x: number, key: string, onPress: () => void) => (
                <Box position="absolute" left={Math.round((x / 360) * wide)} top={0}>
                  <Button key={key} plain label={'\u00A0'.repeat(spaces(42 * ((wide * 8.6) / 360)))} onPress={onPress} />
                </Box>
              )

              return [
                <Box flexDirection="row-reverse" justifyContent="space-between" alignItems="center">
                  <Text bold>{keptMarks.length === 0 ? 'المحفوظة' : `المحفوظة ${keptMarks.length}`}</Text>
                  {here === undefined
                    ? <Text> </Text>
                    : isHereKept
                      ? <Text dimColor>★ هالمحادثة محفوظة</Text>
                      : (
                          <Box position="relative">
                            <Svg source={markSave()} alt="احفظ هالمحادثة" />
                            <Box position="absolute" left={0} top={0}>
                              <Button key="foxy-mark-here" plain label={'\u00A0'.repeat(spaces(SAVE_W * ((wide * 8.6) / 360)))} onPress={() => void keepMark($, here, true).catch(() => undefined)} />
                            </Box>
                          </Box>
                        )}
                </Box>,
                ...(keptMarks.length === 0
                  ? [<Text dimColor wrap="wrap">ما حفظت شي للحين. اضغط ☆ على أي محادثة.</Text>]
                  : [
                      <Box flexDirection="column" rowGap={0}>
                        {[...new Set(keptMarks.map(one => one.place ?? ''))].flatMap(place => {
                          const group = keptMarks.filter(one => (one.place ?? '') === place)

                          return [
                            <Svg key={`foxy-place-${place}`} source={markHead(place, group.length)} alt={place} />,
                            ...group.map(one => (
                              <Box key={`foxy-mark-${one.local}`} position="relative" alignItems="flex-end">
                                <Svg source={markCard({ ...one, when: when(one.local), isHere: one.local === myLocal }, 'kept')} alt={one.title} />
                                {over(0, `foxy-go-${one.local}`, () => void goTo($, one.local))}
                                {over(MARK_X, `foxy-unmark-${one.local}`, () => void keepMark($, one, false).catch(() => undefined))}
                              </Box>
                            )),
                          ]
                        })}
                      </Box>,
                    ]),
                ...(others.length === 0
                  ? []
                  : [
                      <Box paddingTop={1}>
                        <Text bold>آخر محادثاتك</Text>
                      </Box>,
                      <Box flexDirection="column">
                        {others.map(one => (
                          <Box key={`foxy-recent-${one.local}`} position="relative" alignItems="flex-end">
                            <Svg source={markCard({ ...one, when: when(one.local), isHere: one.local === myLocal }, 'recent')} alt={`${one.title} ${one.place}`} />
                            {over(0, `foxy-star-${one.local}`, () => void keepMark($, one, true).catch(() => undefined))}
                            {over(MARK_X, `foxy-peek-${one.local}`, () => void goTo($, one.local))}
                          </Box>
                        ))}
                      </Box>,
                    ]),
              ]
            })()
        : tab === 'team'
          ? [
              <Svg source={teamChart(team)} alt={team.map(one => `${one.name} ${one.done}/${one.total} ${amount(one.tokens)}`).join(' | ')} />,
              // the app opens one of its own sessions by its link; the host does the opening
              <Text dimColor>افتح محادثة:</Text>,
              <Box flexDirection="row-reverse" columnGap={1} flexWrap="wrap">
                {team
                  .filter(one => typeof one.session === 'string' && one.session !== '')
                  .map(one => (
                    <Button
                      key={`foxy-open-${one.key}`}
                      plain
                      label={`↗ ${cut(one.name, 14)}`}
                      onPress={() => void $.process.run(['open', `claude://claude.ai/epitaxy/${one.session}`], { timeoutMs: 10000 }).catch(() => undefined)}
                    />
                  ))}
              </Box>,
            ]
          : tab === 'side'
            ? [
                ...menu,
                <Text bold>{`${SIDE} | لا يُحسب في النسبة`}</Text>,
                ...steps(aside, -1, 'side'),
              ]
            : [
                <Box flexDirection="row-reverse" columnGap={1}>
                  {(Select ? [Select] : []).map(Menu => (
                    <Menu
                      key="foxy-stage"
                      label="المرحلة"
                      value={String(chosen)}
                      options={stages.map((row, index) => ({ value: String(index), label: `${index + 1}. ${row.title} (${row.done}/${row.total})` }))}
                      onSelect={value => pickNow({ stage: value, open: '' })}
                    />
                  ))}
                  {menu}
                </Box>,
                <Text bold>{`${all[chosen]?.title ?? ''} | ${stages[chosen]?.done ?? 0} من ${stages[chosen]?.total ?? 0}`}</Text>,
                ...steps(all[chosen]?.items ?? [], chosen, `step-${chosen}`),
              ]

    return (
      <Box flexDirection="column" rowGap={1} alignItems="flex-end" {...(tab === 'notes' && tall > 8 ? { minHeight: tall - 2 } : {})}>
        <Box flexDirection="row-reverse" columnGap={1} flexWrap="wrap">
          {TABS.filter(one => one.id !== 'tasks' && one.id !== 'side' && (one.id !== 'foxy' || story.text !== '')).map(one => (
            <Button
              key={`foxy-tab-${one.id}`}
              label={one.id === 'side' ? `${one.label} ${aside.length}` : one.label}
              variant={one.id === tab ? 'primary' : 'secondary'}
              onPress={() => pickNow({ tab: one.id, open: '' })}
            />
          ))}
        </Box>
        {body}
      </Box>
    )
  })

  // The strip above the prompt. It gives way to the engine's own row (a survey) and draws
  // nothing where there is no map; like the pane it takes each value only as what it is.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const given = (e.props as { foxyTest?: { view?: FoxyView; bar?: string } } | undefined)?.foxyTest ?? {}
    const kept = (given.view ?? (await read($, view).catch(() => undefined))) as Partial<FoxyView> | undefined
    const shown = given.bar ?? (await read($, bar).catch(() => 'on'))
    const stages = Array.isArray(kept?.stages) ? kept.stages : []
    if (e.props.hasSurvey || shown === 'off' || stages.length === 0) return next(e)
    const table = $.ui.resolve(e)
    const { Box, Text, Button } = table
    const more = table as Partial<{ Svg: Elements['desktop']['Svg'] }>
    const Svg = e.surface === 'terminal' ? undefined : more.Svg
    const percent = Number(kept?.percent ?? 0)
    const now = String(kept?.now ?? '')
    const rawCrew = (await read($, crew).catch(() => [])) as unknown
    const team: Agent[] = Array.isArray(rawCrew) ? rawCrew : []
    if (!Svg) {
      const full = cells(percent, 100, 20)

      return (
        <Box flexDirection="row" columnGap={1}>
          <Text color={MINT}>{'█'.repeat(full)}</Text>
          <Text dimColor>{'░'.repeat(20 - full)}</Text>
          <Text bold>{`${percent}%`}</Text>
          <Text dimColor>{now}</Text>
        </Box>
      )
    }
    const full = { ...EMPTY, ...kept, stages, percent, now } as FoxyView
    const rawFrog = (await read($, frog).catch(() => QUIET)) as Partial<Frog> | undefined
    const state: Frog = { ...QUIET, ...(rawFrog ?? {}) }
    const fetchedRaw = [...((await read($, remote).catch(() => [])) as unknown[]), ...((await read($, smart).catch(() => [])) as unknown[])]
    const fetched = fetchedRaw.filter((one): one is string => typeof one === 'string')
    const line = state.line === '' ? choose(lines(full, team, fetched), 0) : state.line
    const isWorking = team.some(one => one.isActive)
    // a press on the fox opens the pane when it is closed and closes it when it is open,
    // and the fox does its act either way
    const act = async () => {
      const at = await $.clock.now()
      const seed = Math.floor(at / 100)
      await perform($, ACTS[seed % ACTS.length] ?? 'jump', seed)
    }
    const tell = async () => {
      const held = (await read($, tales).catch(() => ({}))) as unknown
      const text = held && typeof held === 'object' ? (held as Record<string, unknown>)[line] : undefined
      if (typeof text === 'string' && text !== '') {
        await update($, tale, () => ({ line, text }))
        await update($, picked, was => ({ ...((was ?? {}) as Partial<Picked>), stage: 'now', filter: 'open', tab: 'foxy' }) as Picked)
        await openPane($)

        return
      }
      await act()
    }
    const poke = async () => {
      if (isPaneOpen) {
        isPaneOpen = false
        void $.ui.close({ id: PANE }).catch(() => undefined)
      } else {
        void openPane($)
      }
      await act()
    }
    // About 8 CSS px per reported column; the fox's line and the two buttons take the rest.
    // No floor above the slot: a row wider than it would wrap.
    // The drawing is the fox, the percent and the bar, at about half the prompt's width. The
    // title is real text beside it: it takes whatever room is truly left and cuts itself,
    // so no guess about the width can leave a hole or run one thing under another.
    const openTeam = async () => {
      await update($, picked, was => ({ ...((was ?? {}) as Partial<Picked>), stage: 'now', filter: 'open', tab: 'team' }) as Picked)
      await openPane($)
    }
    // About 8 CSS px per reported column; the fox's line and the two buttons take the rest.
    // No floor above the slot: a row wider than it would wrap.
    // Measured on the owner's screen at the normal text size: a column is 8.6 px, a letter of
    // the line about 4.7 (5 kept), its button's padding 16, the crew, the arrow and the gaps 100.
    // no title on the strip (the owner wants the room for the fox's words); the bar takes what the
    // line leaves, so a short line gives a long bar and a long line a short one
    // the button reads left to right: the line goes in a right-to-left embedding (U+202B … U+202C),
    // or a line with Latin in it (`/resume`) came out in the wrong order and its full stop at the end
    // a little more than measured per letter (6, not 4.7) and 40 px to spare: with none the line
    // wrapped onto a second row and the strip grew tall (1.1.55)
    const width = Math.max(180, Math.min(1600, (e.props.bodyColumns || 100) * 8.6 - (line.length * 6 + 16) - 140))

    return (
      // The row spans the prompt: the arrow stands at its right end, and what little the width
      // guess leaves over lies at the far left, before the fox's line.
      <Box flexDirection="row" alignItems="center" columnGap={1} width="100%">
        <Box flexDirection="row" alignItems="center" justifyContent="flex-end" flexGrow={1} minWidth={0}>
          {/* words as text, the press laid over them: a button stands taller than the bar and
              made the whole strip taller */}
          <Box position="relative">
            <Text wrap="truncate">{`\u202B${line}\u202C`}</Text>
            <Box position="absolute" left={0} top={0}>
              <Button key="foxy-frog" plain label={'\u00A0'.repeat(Math.round(line.length * 1.45) + 2)} onPress={() => void tell()} />
            </Box>
          </Box>
        </Box>
        <Svg source={strip(full, width, isWorking, state, true)} alt={`${percent}% | ${now}`} width={width} height={20} />
        <Box position="relative">
          <Text>{`×${team.length}`}</Text>
          <Box position="absolute" left={0} top={0}>
            <Button key="foxy-crew" plain label={'\u00A0\u00A0'} onPress={() => void openTeam()} />
          </Box>
        </Box>
        <Box position="relative">
          <Svg source={arrowPlate(isPaneOpen)} alt={isPaneOpen ? '◀' : '▶'} width={30} height={20} />
          <Box position="absolute" left={0} top={0}>
            <Button key="foxy-pane" plain label={'\u00A0\u00A0\u00A0'} onPress={() => void poke()} />
          </Box>
        </Box>
      </Box>
    )
  })
}
