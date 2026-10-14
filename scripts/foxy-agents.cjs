// Sums what each agent's session has spent, from its transcript on this machine.
// usage: node foxy-agents.cjs <cliSessionId>...   ->   JSON [{ id, tokens, out, lastMs }]
// tokens = input + cache writes + output of every model reply, each reply counted once
// (cache reads are left out: they repeat the same context on every request).
// A transcript only grows, so the count resumes from where the last run stopped.
const fs = require('fs')
const os = require('os')
const path = require('path')

// usage: node foxy-agents.cjs --sessions <cwd>  ->  JSON [{ local, cli, title, lastMs, isArchived }]
// Every desktop session whose working directory is <cwd>, from the app's own session files.
// usage: node foxy-agents.cjs --all  ->  JSON [{ local, cli, title, place, lastMs }]
// The conversations on this machine that are not archived, the latest first (40 at most).
if (process.argv[2] === '--all') {
  const base = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions')
  const found = []
  const walk = (dir, depth) => {
    let names = []
    try { names = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const one of names) {
      const full = path.join(dir, one.name)
      if (one.isDirectory() && depth < 3) walk(full, depth + 1)
      else if (one.isFile() && /^local_[0-9a-f-]+\.json$/.test(one.name)) {
        try {
          const o = JSON.parse(fs.readFileSync(full, 'utf8'))
          if (o.isArchived || !o.sessionId) continue
          found.push({ local: o.sessionId, cli: String(o.cliSessionId || ''), title: String(o.title || ''), place: path.basename(String(o.cwd || o.originCwd || '')), lastMs: Number(o.lastActivityAt || 0) })
        } catch {}
      }
    }
  }
  walk(base, 0)
  found.sort((a, b) => b.lastMs - a.lastMs)
  process.stdout.write(JSON.stringify(found.slice(0, 40)))
  process.exit(0)
}

if (process.argv[2] === '--sessions') {
  const cwd = process.argv[3] || ''
  const base = path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude-code-sessions')
  const found = []
  const walk = (dir, depth) => {
    let names = []
    try { names = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const one of names) {
      const full = path.join(dir, one.name)
      if (one.isDirectory() && depth < 3) walk(full, depth + 1)
      else if (one.isFile() && /^local_[0-9a-f-]+\.json$/.test(one.name)) {
        try {
          const o = JSON.parse(fs.readFileSync(full, 'utf8'))
          if ((o.cwd || o.originCwd) !== cwd || !o.cliSessionId) continue
          found.push({ local: o.sessionId, cli: o.cliSessionId, title: String(o.title || ''), lastMs: Number(o.lastActivityAt || 0), isArchived: !!o.isArchived })
        } catch {}
      }
    }
  }
  walk(base, 0)
  process.stdout.write(JSON.stringify(found))
  process.exit(0)
}


const root = path.join(os.homedir(), '.claude', 'projects')
const cachePath = path.join(os.tmpdir(), 'foxy-mod-agents.json')
let cache = {}
try { cache = JSON.parse(fs.readFileSync(cachePath, 'utf8')) } catch {}

const find = id => {
  for (const dir of fs.readdirSync(root)) {
    const file = path.join(root, dir, `${id}.jsonl`)
    if (fs.existsSync(file)) return file
  }
  return undefined
}

const out = []
for (const id of process.argv.slice(2)) {
  if (!/^[0-9a-f-]{36}$/.test(id)) continue
  const file = find(id)
  if (!file) { out.push({ id, tokens: 0, out: 0, lastMs: 0 }); continue }
  const stat = fs.statSync(file)
  let was = cache[id]
  if (!was || was.file !== file || was.offset > stat.size) was = { file, offset: 0, tokens: 0, out: 0, last: '' }
  if (stat.size > was.offset) {
    const fd = fs.openSync(file, 'r')
    const chunk = Buffer.alloc(1 << 20)
    let offset = was.offset
    let rest = ''
    for (;;) {
      const read = fs.readSync(fd, chunk, 0, chunk.length, offset)
      if (read === 0) break
      const text = rest + chunk.toString('utf8', 0, read)
      const lines = text.split('\n')
      rest = lines.pop()
      offset += read
      for (const line of lines) {
        if (!line.includes('"usage"')) continue
        let row
        try { row = JSON.parse(line) } catch { continue }
        const message = row && row.message
        const usage = message && message.usage
        if (!usage || row.type !== 'assistant' || message.id === was.last) continue
        was.last = message.id
        was.tokens += (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.output_tokens || 0)
        was.out += usage.output_tokens || 0
      }
    }
    fs.closeSync(fd)
    // a last line still being written is read again next time
    was.offset = offset - Buffer.byteLength(rest, 'utf8')
    cache[id] = was
  }
  out.push({ id, tokens: was.tokens, out: was.out, lastMs: stat.mtimeMs })
}
try { fs.writeFileSync(cachePath, JSON.stringify(cache)) } catch {}
process.stdout.write(JSON.stringify(out))
