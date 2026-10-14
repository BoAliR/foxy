import { expect, test } from 'claude-code/testing'

import { amount, board, chart, draw, flip, rowChart, stageChart, strip, subChart, teamChart, pixelFox, lines, choose, costumeOf, parseLines, parseTitles, thinkPrompt, driftPrompt, parseVerdict, parseThought, isNewer, isOurs, isRoom, BLESSING, nameIn, makeNow, newKey, ticks, isCall, replyPrompt, matesChart, clock, chatChart, initials, wrap, roomHead, hourLine, focusLine, ago, markCard, fresh, NAHJ, arrowPlate, prayerList } from './register'

const MAP = {
  goal: 'هدف',
  stages: [
    { title: 'أولى', items: [{ t: 'أ', s: 'done' }, { t: 'ب', s: 'done' }] },
    { title: 'ثانية', items: [{ t: 'ج', s: 'done' }, { t: 'د', s: 'owner', note: 'ملاحظة' }] },
    { title: 'ثالثة', items: [{ t: 'هـ', s: 'todo' }, { t: 'و', s: 'todo' }] },
  ],
}
const TASKS = MAP.stages.map(stage => ({
  title: stage.title,
  items: stage.items.map(item => ({
    t: item.t,
    s: item.s,
    note: 'note' in item ? String(item.note) : '',
    sub: item.s === 'owner' ? [{ t: 'قرار', s: 'done' }, { t: 'تنفيذ', s: 'todo' }] : [],
  })),
}))
const PANE = { plugin: 'foxy', component: 'Pane', requestId: 'foxy' } as const

test('the percent counts done items, and the stage we are in is where the team has work, not one that only waits on the owner', async () => {
  const view = draw(MAP)
  expect(view.status).toBe('50% | مرحلة 3/3')
  expect([view.percent, view.done, view.waits, view.ours]).toEqual([50, 3, 1, 2])
  expect(view.now).toBe('المرحلة 3 من 3 | ثالثة')
  expect(view.stages.map(row => row.state)).toEqual(['done', 'later', 'now'])
  // a step in progress wins over everything
  const busy = draw({ goal: 'g', stages: [{ title: 'a', items: [{ t: '1', s: 'todo' }] }, { title: 'b', items: [{ t: '2', s: 'doing' }] }] })
  expect(busy.now).toBe('المرحلة 2 من 2 | b')
  // only the owner's steps left anywhere: the first unfinished stage
  expect(draw({ goal: 'g', stages: [{ title: 'a', items: [{ t: '1', s: 'owner' }] }] }).now).toBe('المرحلة 1 من 1 | a')
})

test('a finished map says so', async () => {
  const view = draw({ goal: 'هدف', stages: [{ title: 'أولى', items: [{ t: 'أ', s: 'done' }] }] })
  expect(view.status).toBe('100%')
  expect(view.now).toBe('اكتمل الهدف')
})

test('the plain board has no table and reads word first', async () => {
  const text = board(draw(MAP))
  expect(text.split('\n').some(line => line.startsWith('|'))).toBe(false)
  expect(text.includes('خلص 🟢 **3** ｜ ينتظرك 🟠 **1** ｜ للفريق 🔵 **2**')).toBe(true)
})

const CREW = [
  { key: 'exec', name: 'المنفّذ', cli: '', done: 3, total: 4, tokens: 18616316, isActive: true },
  { key: 'design', name: 'المصمّم', cli: '', done: 0, total: 0, tokens: 7400, isActive: false },
]

test('the overview drawing is one right-to-left svg: ring, counters, a row per stage', async () => {
  const svg = chart(draw(MAP), 1)
  expect(svg.startsWith('<svg ')).toBe(true)
  expect(svg.endsWith('</svg>')).toBe(true)
  expect(svg.includes('>50%<')).toBe(true)
  expect(svg.split('direction="rtl"').length - 1).toBe(3 + 3 + 3)
  expect(svg.includes('<script')).toBe(false)
})

test('the team drawing has a row per agent: its share as a bar and what it spent', async () => {
  const svg = teamChart(CREW)
  expect(svg.includes('>18.6 مليون<')).toBe(true)
  expect(svg.includes('>7 ألف<')).toBe(true)
  expect(svg.includes('class="fx run"') && svg.includes('class="fx"')).toBe(true)
  expect(svg.includes('#F2C94C')).toBe(true)
  expect(svg.includes('>3 من 4<')).toBe(true)
  expect(svg.includes('>بلا خطوات<')).toBe(true)
  expect(svg.includes('<rect x="96" y="')).toBe(true)
})

test('token amounts read short', async () => {
  expect([amount(950), amount(7400), amount(1190296)]).toEqual(['950', '7 ألف', '1.2 مليون'])
})

test('a press marks a step done and a second press puts it back', async () => {
  const once = flip(MAP, 1, 1, '2026-01-01')
  expect(once.stages[1]?.items[1]).toEqual({ t: 'د', s: 'done', note: 'ملاحظة', was: 'owner' })
  expect(draw(once).percent).toBe(66)
  const twice = flip(once, 1, 1, '2026-01-02')
  expect(twice.stages[1]?.items[1]).toEqual({ t: 'د', s: 'owner', note: 'ملاحظة' })
  expect(twice.updated).toBe('2026-01-02')
})

test('a press on a sub-step turns it, and the step follows its sub-steps', async () => {
  const map = { goal: 'g', stages: [{ title: 'a', items: [{ t: 'x', s: 'owner', sub: [{ t: '1', s: 'done' }, { t: '2', s: 'todo' }] }] }] }
  const once = flip(map, 0, 0, '2026-01-01', 1)
  expect(once.stages[0]?.items[0]).toEqual({ t: 'x', s: 'done', was: 'owner', sub: [{ t: '1', s: 'done' }, { t: '2', s: 'done', was: 'todo' }] })
  const back = flip(once, 0, 0, '2026-01-02', 0)
  expect(back.stages[0]?.items[0]?.s).toBe('owner')
  expect(back.stages[0]?.items[0]?.sub?.[0]).toEqual({ t: '1', s: 'todo' })
})

test('side work is kept apart: pressed on its own list and never counted', async () => {
  const map = { ...MAP, side: [{ t: 'أداة', s: 'todo' }] }
  expect(draw(map).percent).toBe(50)
  const once = flip(map, -1, 0, '2026-01-01')
  expect(once.side).toEqual([{ t: 'أداة', s: 'done', was: 'todo' }])
  expect(once.stages).toEqual(map.stages)
  expect(draw(once).percent).toBe(50)
})

const SIDE = [{ t: 'أداة', s: 'todo', note: '' }]

const BASE = { view: draw(MAP), look: 'colour', tasks: TASKS, side: SIDE, crew: CREW }
const tabs = ['overview', 'team', 'notes', 'marks']

test('the tabs (tasks are read under their stage, so they have none), and the overview is the drawing alone', async $ => {
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface, props: { foxyTest: BASE } })
    for (const tab of tabs) expect(await ui.find({ key: `foxy-tab-${tab}` })).toBeDefined()
    for (const tab of ['tasks', 'side', 'foxy']) expect(await ui.find({ key: `foxy-tab-${tab}` })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /المراحل 3 \| الخطوات 6/ })).toBeDefined()
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    expect(await ui.find({ key: 'foxy-step-1-1' })).toBeUndefined()
    expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
    await ui.unmount()
  }
})

test('the tasks tab lists the stage we are in; a step opens on its sub-steps', async $ => {
  const shut = await $.ui.mount({ ...PANE, surface: 'desktop', props: { foxyTest: { ...BASE, picked: { stage: '1', filter: 'open', tab: 'tasks' } } } })
  expect(await shut.find({ key: 'foxy-stage' })).toBeDefined()
  expect(await shut.find({ key: 'foxy-filter' })).toBeDefined()
  expect(await shut.find({ key: 'foxy-step-1-1' })).toBeDefined()
  expect(await shut.find({ key: 'foxy-step-1-0' })).toBeUndefined()
  expect(await shut.find({ key: 'foxy-step-1-1-sub-0' })).toBeUndefined()
  await shut.unmount()
  const open = await $.ui.mount({ ...PANE, surface: 'desktop', props: { foxyTest: { ...BASE, picked: { stage: '1', filter: 'open', tab: 'tasks', open: 'step-1-1' } } } })
  expect(await open.find({ key: 'foxy-step-1-1-sub-0' })).toBeDefined()
  expect(await open.find({ key: 'foxy-step-1-1-sub-1' })).toBeDefined()
  expect(await open.find({ key: 'foxy-step-1-1-mark' })).toBeDefined()
  await open.unmount()
})

test('another stage and filter, the team tab, and the side tab', async $ => {
  const first = await $.ui.mount({ ...PANE, surface: 'desktop', props: { foxyTest: { ...BASE, picked: { stage: '0', filter: 'done', tab: 'tasks' } } } })
  expect(await first.find({ key: 'foxy-step-0-0' })).toBeDefined()
  expect(await first.find({ key: 'foxy-step-0-1' })).toBeDefined()
  expect(await first.find({ key: 'foxy-step-1-1' })).toBeUndefined()
  await first.unmount()
  const team = await $.ui.mount({ ...PANE, surface: 'desktop', props: { foxyTest: { ...BASE, crew: CREW.map(one => ({ ...one, session: 'local_x' })), picked: { stage: 'now', filter: 'open', tab: 'team' } } } })
  expect(await team.find({ type: 'Svg' })).toBeDefined()
  expect(await team.find({ key: 'foxy-open-exec' })).toBeDefined()
  expect(await team.find({ key: 'foxy-stage' })).toBeUndefined()
  await team.unmount()
  const aside = await $.ui.mount({ ...PANE, surface: 'desktop', props: { foxyTest: { ...BASE, picked: { stage: 'now', filter: 'open', tab: 'side' } } } })
  expect(await aside.find({ key: 'foxy-side-0' })).toBeDefined()
  expect(await aside.find({ key: 'foxy-step-1-1' })).toBeUndefined()
  await aside.unmount()
})

test('the phone has no menu and still draws the dashboard', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'mobile', props: { foxyTest: { view: draw(MAP), look: 'colour', tasks: TASKS } } })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ type: 'Button' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown' })).toBeUndefined()
  await ui.unmount()
})

test('the terminal has no drawing element and gets the plain look', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal', props: { foxyTest: { view: draw(MAP), look: 'colour', tasks: TASKS } } })
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()
  await ui.unmount()
})

test('the plain look and a value an older load left behind are one Markdown block', async $ => {
  for (const foxyTest of [{ view: draw(MAP), look: 'plain', tasks: TASKS }, { view: { text: 'نص قديم', status: '' }, look: 'colour' }]) {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { foxyTest } })
    expect(await ui.find({ type: 'Markdown' })).toBeDefined()
    expect(await ui.find({ type: 'Svg' })).toBeUndefined()
    await ui.unmount()
  }
})

const BAND = { plugin: 'foxy', component: 'AbovePrompt' } as const
const QUIET_STATE = { line: '', act: 'idle' as const, frame: 0, isBig: false, said: 0 }

test('the strip is one short row: title, a dithered bar with a pill and ticks, the percent, the pixel fox', async () => {
  const svg = strip(draw({ ...MAP, focus: { t: 'تطوير اللوحة', side: true } }), 600, true, QUIET_STATE)
  expect(svg.includes('width="600" height="20"')).toBe(true)
  expect(svg.includes('>50%<')).toBe(true)
  expect(svg.includes('>6/3<')).toBe(true)
  expect(svg.includes('الآن: تطوير اللوحة')).toBe(true)
  expect(svg.includes('fill="#F5A524"/>')).toBe(true)
  expect(svg.split('class="t').length - 1).toBeGreaterThan(10)
  expect(svg.includes('@keyframes tw') && svg.includes('prefers-reduced-motion')).toBe(true)
  expect(svg.includes('class="fx run"')).toBe(true)
  expect(strip(draw(MAP), 600, false, QUIET_STATE).includes('class="fx"')).toBe(true)
  expect(strip(draw(MAP), 600, false, { ...QUIET_STATE, act: 'jump' }).includes('class="fx act-jump"')).toBe(true)
})

test('the strip above the prompt is a drawing where there is one and text on the terminal', async $ => {
  const props = { hasSurvey: false, isWorking: false, bodyColumns: 100, foxyTest: { view: draw(MAP), bar: 'on' } }
  for (const surface of ['desktop', 'mobile', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface, props })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    for (const key of ['foxy-frog', 'foxy-crew', 'foxy-pane']) expect(await ui.find({ key })).toBeDefined()
    expect(await ui.find({ key: 'foxy-dismiss' })).toBeUndefined()
    await ui.unmount()
  }
  const terminal = await $.ui.mount({ ...BAND, surface: 'terminal', props })
  expect(await terminal.find({ type: 'Text', text: /50%/ })).toBeDefined()
  await terminal.unmount()
})

test('the strip stays out of the way: turned off, during a survey, or with no map', async $ => {
  const view = draw(MAP)
  for (const props of [
    { hasSurvey: false, isWorking: false, foxyTest: { view, bar: 'off' } },
    { hasSurvey: true, isWorking: false, foxyTest: { view, bar: 'on' } },
    { hasSurvey: false, isWorking: false, foxyTest: { view: { text: 'x', status: '' }, bar: 'on' } },
  ]) {
    // handing the draw on reaches the engine's own row, which a test has none of: the
    // mount is refused for want of one, and that refusal is the hook having stepped aside
    const handed = await $.ui.mount({ ...BAND, surface: 'desktop', props }).then(() => 'drawn', () => 'handed on')
    expect(handed).toBe('handed on')
  }
})

test('what the conversation is on now is shown in the drawing and in the strip, and marked when it is side work', async () => {
  const view = draw({ ...MAP, focus: { t: 'تطوير اللوحة', side: true } })
  expect(view.focus).toBe('تطوير اللوحة')
  expect(chart(view, 1).includes('>نشتغل الآن على: تطوير اللوحة<')).toBe(true)
  expect(chart(view, 1).includes('>خارج المشروع<')).toBe(true)
  expect(chart(draw(MAP), 1).includes('نشتغل الآن على')).toBe(false)
})

test('an opened step is drawn as coloured rows, one per sub-step, with whose it is', async () => {
  const svg = subChart(
    { t: 'x', s: 'owner', note: '', sub: [{ t: 'قرار', s: 'owner' }, { t: 'تنفيذ', s: 'todo', who: 'exec' }, { t: 'نموذج', s: 'done', who: 'design' }] },
    { exec: 'المنفّذ', design: 'المصمّم' },
  )
  expect(svg.includes('#F5A524')).toBe(true)
  expect(svg.includes('#5B9BF5')).toBe(true)
  expect(svg.includes('#3FCF8E')).toBe(true)
  expect(svg.includes('>أنت<')).toBe(true)
  expect(svg.includes('>المنفّذ<')).toBe(true)
  expect(svg.split('<circle').length - 1).toBe(3)
})

test('the overview lists each stage as a pressable row; a pressed one shows its steps drawn under it', async $ => {
  const shut = await $.ui.mount({ ...PANE, surface: 'desktop', props: { foxyTest: BASE } })
  for (const row of ['0', '1', '2']) expect(await shut.find({ key: `foxy-stage-${row}` })).toBeDefined()
  await shut.unmount()
  const open = await $.ui.mount({ ...PANE, surface: 'desktop', props: { foxyTest: { ...BASE, picked: { stage: 'now', filter: 'open', tab: 'overview', seen: '1' } } } })
  expect(await open.find({ key: 'foxy-stage-1' })).toBeDefined()
  expect(await open.find({ type: 'Markdown' })).toBeUndefined()
  await open.unmount()
})

test('a stage is drawn with its finished steps struck through and its open steps with their sub-steps', async () => {
  const svg = stageChart(
    { title: 'م', items: [{ t: 'خالصة', s: 'done', note: '' }, { t: 'مفتوحة', s: 'owner', note: '', sub: [{ t: 'قرار', s: 'done' }, { t: 'تنفيذ', s: 'todo', who: 'exec' }] }] },
    { exec: 'المنفّذ' },
  )
  expect(svg.split('text-decoration="line-through"').length - 1).toBe(2)
  expect(svg.includes('>خالصة<')).toBe(true)
  expect(svg.includes('>المنفّذ<')).toBe(true)
  expect(svg.includes('#F5A524')).toBe(true)
})

test('the head drawing can leave the stages out', async () => {
  const head = chart(draw(MAP), -1, false)
  expect(head.split('direction="rtl"').length - 1).toBe(3 + 3)
})

test('nothing in the pane is a live frame: every drawing is a still picture', async $ => {
  for (const picked of [undefined, { stage: 'now', filter: 'open', tab: 'overview', seen: '1' }]) {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { foxyTest: { ...BASE, picked } } })
    const svg = (await ui.find({ type: 'Svg' })) as { props?: { isInteractive?: boolean } } | undefined
    expect(svg).toBeDefined()
    expect(svg?.props?.isInteractive).toBeUndefined()
    await ui.unmount()
  }
  expect(chart(draw(MAP), 1).includes('<animate')).toBe(false)
})

test('each ladder row is the approved row drawn: mark, name, bar, count; the open one lit', async () => {
  const rows = draw(MAP).stages
  const shut = rowChart(rows[1]!, 1, false, false)
  const open = rowChart(rows[1]!, 1, false, true)
  expect(shut.includes('>2<') && shut.includes('>ثانية<') && shut.includes('>2/1<')).toBe(true)
  expect(shut.includes('fill-opacity="0.16"')).toBe(false)
  expect(open.includes('fill-opacity="0.16"')).toBe(true)
  expect(rowChart(rows[0]!, 0, false, false).includes('M341 15 l4 4 l6 -8')).toBe(true)
})

test('the pixel fox: red pixels, stepping legs while the team works, a z when asleep; lines to say', async () => {
  const awake = pixelFox(0, 0, 1, true, 'idle')
  expect(awake.includes('#E5484D') && awake.includes('class="fx run"')).toBe(true)
  expect(awake.includes('>z<')).toBe(false)
  expect(pixelFox(0, 0, 1, false, 'idle').includes('>z<')).toBe(true)
  const pool = lines(draw(MAP), CREW)
  expect(pool.length).toBeGreaterThan(10)
  expect(pool[0]).toBe('1 قرار واقفين عليك. مو مستعجل؟')
  // Latin only inside a Claude tip (a command name), never at a line's start
  expect(pool.every(line => line.startsWith('كلود:') || line.startsWith('/foxy') || !/[A-Za-z]/.test(line))).toBe(true)
  expect(pool.every(line => line.length <= 40)).toBe(true)
  expect(pixelFox(0, 0, 1, true, 'idle', 'manager').includes('#F5A524')).toBe(true)
  expect([costumeOf('مصمّم صور', 'x'), costumeOf('نفّذ الموقع', 'x'), costumeOf('اربط الطلب الصوتي', 'x'), costumeOf('Build (manager session)', 'x'), costumeOf('خادم الشركة', 'local_9b')]).toEqual(['design', 'exec', 'voice', 'manager', 'guest' + ([...'local_9b'].reduce((a, c) => a + c.charCodeAt(0), 0) % 4)])
  expect(choose(pool, 3)).toBe(pool[3])
})

test('the strip above the prompt carries the fox and its line as a button', async $ => {
  const props = { hasSurvey: false, isWorking: false, bodyColumns: 100, foxyTest: { view: draw(MAP), bar: 'on' } }
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props })
  expect(await ui.find({ key: 'foxy-frog' })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()
})

test('lines fetched from the owner\'s address: three shapes read, said first and often, bad text ignored', async () => {
  expect(parseLines('["أهلاً", " ", 3, "يا بطل"]')).toEqual(['أهلاً', 'يا بطل'])
  expect(parseLines('{"lines":["واحد","اثنين"]}')).toEqual(['واحد', 'اثنين'])
  expect(parseLines('سطر أول\nسطر ثاني\n')).toEqual(['سطر أول', 'سطر ثاني'])
  expect(parseLines('{"x":1}')).toEqual([])
  const pool = lines(draw(MAP), CREW, ['رسالة من حسين'])
  expect(pool[0]).toBe('رسالة من حسين')
  expect(pool.filter(line => line === 'رسالة من حسين').length).toBe(2)
})

test('news titles are read from RSS and Atom; the hourly prompt carries the goal, the open steps and the titles; Claude tips are in the bank', async () => {
  const rss = '<rss><channel><title>HN</title><item><title><![CDATA[One &amp; two]]></title></item><item><title>Three</title></item></channel></rss>'
  expect(parseTitles(rss)).toEqual(['One & two', 'Three'])
  const atom = '<feed><title>F</title><entry><title type="html">A&lt;b&gt;</title></entry></feed>'
  expect(parseTitles(atom)).toEqual(['A<b>'])
  const prompt = thinkPrompt(draw(MAP), ['د'], ['Three'])
  expect(prompt.includes('هدف') && prompt.includes('- Three') && prompt.includes('خطوات مفتوحة: د') && prompt.includes('JSON') && prompt.includes('تنمّر')).toBe(true)
  expect(lines(draw(MAP), CREW).some(line => line.startsWith('كلود: /compact'))).toBe(true)
})

test('Foxy weighs the last messages: the prompt carries them, the verdict is read, a bad reply is no scold', async () => {
  const prompt = driftPrompt(draw(MAP), ['شلون الطقس اليوم؟', 'وشرايك بالمباراة؟'])
  expect(prompt.includes('1. شلون الطقس اليوم؟') && prompt.includes('2. وشرايك بالمباراة؟') && prompt.includes('هدف')).toBe(true)
  expect(parseVerdict('{"off": true, "line": "لا تبربر وايد، ارجع للشغل."}')).toEqual({ off: true, line: 'لا تبربر وايد، ارجع للشغل.' })
  expect(parseVerdict('هنا كلام ثم {"off": false, "line": ""} وبعده')).toEqual({ off: false, line: '' })
  expect(parseVerdict('ما في')).toEqual({ off: false, line: '' })
})

test('the drawings carry both themes: light values first, the brand\'s dark ones under the query', async () => {
  for (const svg of [chart(draw(MAP), 1), rowChart(draw(MAP).stages[0]!, 0, false, false), teamChart(CREW), stageChart(TASKS[1]!, {}), subChart(TASKS[1]!.items[1]!, {})]) {
    expect(svg.includes('prefers-color-scheme: dark') && svg.includes('--card:#EEF2FA') && svg.includes('--card:#1F2A4B')).toBe(true)
    expect(svg.includes('fill="#1F2A4B"')).toBe(false)
  }
})

test('an update is taken only for a higher version and only for the plugin\'s own files', async () => {
  expect([isNewer('1.0.1', '1.0.0'), isNewer('1.1.0', '1.0.9'), isNewer('1.0.0', '1.0.0'), isNewer('0.9.9', '1.0.0'), isNewer('x', '1.0.0')]).toEqual([true, true, false, false, false])
  expect(['hooks/register.tsx', '.claude-plugin/plugin.json', 'README.md', 'scripts/foxy-agents.cjs'].every(isOurs)).toBe(true)
  expect(['../x', 'hooks/../../x', '/etc/passwd', 'hooks/a/b.ts', 'server/foxy.py', 'publish.sh'].some(isOurs)).toBe(false)
  expect([isRoom('arya-2026'), isRoom('abc'), isRoom('غرفة'), isRoom('a b c d')]).toEqual([true, false, false, false])
})

test('the hour\'s reply is read as lines and the stories behind them; a bare array still reads', async () => {
  const got = parseThought('كلام {"lines": ["خبر: شي صار", "نكتة"], "more": {"خبر: شي صار": "القصة كاملة.", "x": 3}} انتهى')
  expect(got).toEqual({ lines: ['خبر: شي صار', 'نكتة'], more: { 'خبر: شي صار': 'القصة كاملة.' } })
  expect(parseThought('["أ", "ب"]')).toEqual({ lines: ['أ', 'ب'], more: {} })
  expect(parseThought('ما في')).toEqual({ lines: [], more: {} })
})

const NOTES = [{ id: 1, from: 'حسين', text: 'هلا', at: 1 }, { id: 2, from: 'علي', text: 'هلا والله', at: 2 }]

test('the messages tab: a field to write in where there is one, the messages, and a hint with no room', async $ => {
  const picked = { stage: 'now', filter: 'open', tab: 'notes' }
  for (const surface of ['desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface, props: { foxyTest: { ...BASE, picked, notes: NOTES, room: 'arya-2026', name: 'حسين' } } })
    for (const key of ['foxy-note-2', 'foxy-room-copy', 'foxy-room-leave']) expect(await ui.find({ key })).toBeDefined()
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    await ui.unmount()
  }
  const phone = await $.ui.mount({ ...PANE, surface: 'mobile', props: { foxyTest: { ...BASE, picked, notes: NOTES, room: 'arya-2026', name: 'حسين' } } })
  expect(await phone.find({ key: 'foxy-note-2' })).toBeUndefined()
  expect(await phone.find({ type: 'Svg' })).toBeDefined()
  await phone.unmount()
  const bare = await $.ui.mount({ ...PANE, surface: 'desktop', props: { foxyTest: { ...BASE, picked, room: '', name: '' } } })
  expect(await bare.find({ key: 'foxy-note-0' })).toBeUndefined()
  for (const key of ['foxy-room-new', 'foxy-room-join']) expect(await bare.find({ key })).toBeDefined()
  await bare.unmount()
})

test('a line with a story opens the fox tab on it, as Markdown', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { foxyTest: { ...BASE, picked: { stage: 'now', filter: 'open', tab: 'foxy' }, tale: { line: 'خبر: شي صار', text: 'القصة كاملة.' } } } })
  expect(await ui.find({ key: 'foxy-tab-foxy' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown' })).toBeDefined()
  await ui.unmount()
})

test('the blessing the fox says every ten minutes is a short Arabic line, and the hour is said at its head', async () => {
  expect([hourLine(15 * 3600000, 0), hourLine(0, 0)]).toEqual(['ترى الساعة صارت 3:00 م', 'ترى الساعة صارت 12:00 ص'])
  expect(BLESSING.length <= 36 && !/[A-Za-z0-9]/.test(BLESSING) && BLESSING.includes('محمد')).toBe(true)
})

test('the name on a message is read from what Claude knows of its user', async () => {
  expect(nameIn('{"oauthAccount":{"displayName":"x","fullName":" حسين الصايغ "}}')).toBe('حسين الصايغ')
  expect(nameIn('{"oauthAccount":{"displayName":"Short Name"}}')).toBe('Short Name')
  expect([nameIn('{}'), nameIn('not json')]).toEqual(['', ''])
})

test('with no map, /foxy has the model read the project and write the map itself, never asking whether to', async () => {
  const prompt = makeNow('docs/FOXY.json')
  expect(prompt.includes('docs/FOXY.json') && prompt.includes('without asking') && prompt.includes('Never ask the user whether to create it') && prompt.includes('"stages"')).toBe(true)
  expect(prompt.includes('from this conversation alone') && prompt.includes('at most three short project files')).toBe(true)
  expect(/roadmap/i.test(prompt)).toBe(false)
})

test('a new room key is one the server takes, and two are not the same', async () => {
  const a = newKey(1)
  const b = newKey(2)
  expect(isRoom(a) && isRoom(b) && a !== b && a.startsWith('fox-') && a.length === 14).toBe(true)
})

test('who is in the room is shown with a light, and my message is ticked once fetched and twice once read', async $ => {
  const mates = [{ name: 'حسين', on: true, got: 2, seen: 2 }, { name: 'علي', on: false, got: 1, seen: 0 }]
  expect([ticks(1, 'حسين', mates), ticks(2, 'حسين', mates), ticks(1, 'حسين', [mates[0]!])]).toEqual(['✓', '', ''])
  expect(ticks(1, 'حسين', [mates[0]!, { ...mates[1]!, seen: 1 }])).toBe('✓✓')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { foxyTest: { ...BASE, picked: { stage: 'now', filter: 'open', tab: 'notes' }, notes: NOTES, mates, room: 'arya-2026', name: 'حسين' } } })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  const drawn = matesChart([...mates, { name: 'فوكسي', on: true, got: 0, seen: 0 }], 'حسين')
  expect(drawn.includes('>أنت<') && drawn.includes('>علي<') && drawn.includes('>فوكسي<')).toBe(true)
  expect(drawn.includes('>حسين<') === false && drawn.includes('class="fx run"') && drawn.includes('prefers-color-scheme: dark')).toBe(true)
  await ui.unmount()
})

test('Foxy in the room: called by name only, answers as Foxy in the room\'s own way, and is not counted as a reader', async () => {
  const call = { id: 3, from: 'علي', text: 'فوكسي شرايك؟', at: 3 }
  expect([isCall(call), isCall({ ...call, text: 'شرايكم؟' }), isCall({ ...call, from: 'فوكسي' })]).toEqual([true, false, false])
  const prompt = replyPrompt(NOTES, call)
  expect(prompt.includes('حسين: هلا') && prompt.includes('علي: هلا والله') && prompt.includes('«فوكسي شرايك؟»') && prompt.includes('اسمك فوكسي وبس')).toBe(true)
  expect(/sonnet|claude|anthropic|سونيت|كلود/i.test(prompt)).toBe(false)
  expect(ticks(1, 'حسين', [{ name: 'فوكسي', on: true, got: 5, seen: 5 }])).toBe('')
})

test('a note carries its hour as a chat shows it', async () => {
  expect([clock(0, 0), clock(12 * 3600 + 7 * 60, 0), clock(15 * 3600 + 45 * 60, 0), clock(0, -180)]).toEqual(['12:00 ص', '12:07 م', '3:45 م', '3:00 ص'])
})

test('the room is drawn as a chat: oldest first, a bubble each, the writer\'s picture beside it, mine with the hour and ticks', async () => {
  expect([initials('Hussain Al Sayegh'), initials('حسين الصايغ'), initials('علي'), initials('')]).toEqual(['HS', 'حا', 'ع', ''])
  expect(wrap('واحد اثنين ثلاثة', 10)).toEqual(['واحد اثنين', 'ثلاثة'])
  expect(wrap('abcdefghijkl', 5)).toEqual(['abcde', 'fghij', 'kl'])
  const mates = [{ name: 'حسين', on: true, got: 3, seen: 3 }, { name: 'علي', on: true, got: 3, seen: 1 }]
  const svg = chatChart([...NOTES, { id: 3, from: 'فوكسي', text: 'أنا هني', at: 3 }], ['حسين'], mates)
  expect(svg.indexOf('>هلا<') < svg.indexOf('>هلا والله<') && svg.indexOf('>هلا والله<') < svg.indexOf('>أنا هني<')).toBe(true)
  expect(svg.includes('>ح<') && svg.includes('>ع<') && svg.includes('class="fx run"')).toBe(true)
  expect(svg.includes('>✓✓<') && svg.split('<rect x="32"').length - 1).toBe(1)
  expect(svg.includes('>علي<') && svg.includes('>فوكسي<') && svg.includes('prefers-color-scheme: dark')).toBe(true)
})

test('the room\'s head row draws its key and the two usual signs: a door with an arrow, and two sheets', async () => {
  const svg = roomHead('fox-abc')
  expect(svg.includes('>fox-abc<') && svg.split('<rect x="0" y="1"').length - 1 === 1 && svg.includes('<rect x="64" y="1"') && svg.includes('l4 4 l-4 4') && svg.includes('width="10" height="13"')).toBe(true)
  expect(svg.includes('prefers-color-scheme: dark')).toBe(true)
})


test('the strip is the first one again: the title and its dot in the drawing, the crew count beside it, and a larger arrow that points to the pane', async $ => {
  const view = draw({ ...MAP, focus: { t: 'تطوير اللوحة', side: true } })
  const svg = strip(view, 600, false, QUIET_STATE)
  expect(svg.includes('الآن: تطوير اللوحة') && svg.includes('fill="#F5A524"/>')).toBe(true)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop', props: { hasSurvey: false, isWorking: false, bodyColumns: 100, foxyTest: { view, bar: 'on' } } })
  const arrow = (await ui.find({ key: 'foxy-pane' })) as { text?: string } | undefined
  expect(arrow).toBeDefined()
  expect(arrowPlate(false)).toContain('M11.5 5 L19.5 10 L11.5 15 Z')
  expect(await ui.find({ key: 'foxy-crew' })).toBeDefined()
  await ui.unmount()
  expect(lines(draw(MAP), CREW).some(line => line.includes('…'))).toBe(false)
})

test('the bookmarks tab lists what is kept and how to keep more', async $ => {
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop', props: { foxyTest: { ...BASE, picked: { stage: 'now', filter: 'open', tab: 'marks' } } } })
  expect(await ui.find({ type: 'Text', text: /المحفوظة/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ما حفظت شي للحين/ })).toBeDefined()
  await ui.unmount()
})

test('a kept conversation is drawn as a card with its project and how long ago', async () => {
  expect(ago(1000, 1000 + 5 * 60000)).toBe('قبل 5 د')
  expect(ago(1000, 1000 + 26 * 3600000)).toBe('أمس')
  expect(ago(0, 5000)).toBe('')
  const card = markCard({ title: 'تطوير فوكسي', place: 'foxy', when: 'قبل 5 د', isHere: true }, 'kept')
  expect(card).toContain('تطوير فوكسي')
  expect(card).toContain('أنت هني')
  expect(markCard({ title: 'موقع آريا', place: 'arya' }, 'recent')).toContain('موقع آريا')
})

test('the fox never says a line again until most of the others have been said', async () => {
  const pool = ['أ', 'ب', 'ج', 'د', 'ه', 'و', 'ز', 'ح', 'ط', 'ي']
  const said = Array.from({ length: 7 }, () => fresh(pool))
  expect(new Set(said).size).toBe(7)
})

test('every saying of Nahj al-Balagha fits the strip', async () => {
  expect(NAHJ.length).toBe(10)
  expect(NAHJ.every(line => line.length <= 40)).toBe(true)
})

test('the prayer times of Kuwait are read as moments in UTC', async () => {
  const day = Date.UTC(2026, 9, 14)
  const list = prayerList({ Fajr: '04:39', Dhuhr: '11:34 (+03)', Asr: '14:53', Maghrib: '17:34', Isha: '18:20', Sunrise: '05:49' }, day)
  expect(list.map(one => one.name)).toEqual(['الفجر', 'الظهر', 'المغرب'])
  expect(list[0]?.at).toBe(Date.UTC(2026, 9, 14, 1, 29))
  expect(list[1]?.at).toBe(Date.UTC(2026, 9, 14, 8, 34))
  expect(list[2]?.at).toBe(Date.UTC(2026, 9, 14, 14, 34))
})
