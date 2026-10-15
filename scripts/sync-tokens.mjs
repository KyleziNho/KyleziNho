// Collects local AI token usage into data/tokens.json (a ledger that never shrinks).
// Runs on your Mac (the logs live here), not in GitHub Actions.
//
// Sources, per day:
//   claude   exact: Claude Code transcripts (~/.claude/projects + Claude desktop agent sessions)
//   cache    exact: ~/.claude/stats-cache.json (written by /stats) for days transcripts no longer cover
//   codex    exact: ~/.codex/sessions token_count events
//   est      estimate: prompt-history days with no surviving transcript, prompts x your tokens-per-prompt
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const HOME = os.homedir()
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const LEDGER = path.join(ROOT, 'data', 'tokens.json')
const MANUAL = path.join(ROOT, 'data', 'tokens-manual.json')

const day = (ts) => new Date(ts).toLocaleDateString('en-CA', { timeZone: 'Europe/London' })

function* walk(dir) {
  let entries
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) yield* walk(p)
    else if (e.name.endsWith('.jsonl')) yield p
  }
}

function* lines(file) {
  for (const l of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!l) continue
    try { yield JSON.parse(l) } catch {}
  }
}

// --- Claude transcripts --------------------------------------------------
const claudeDirs = [path.join(HOME, '.claude', 'projects')]
const desktop = path.join(HOME, 'Library', 'Application Support', 'Claude')
for (const f of walk(desktop)) {
  const i = f.indexOf(`${path.sep}.claude${path.sep}projects${path.sep}`)
  if (i > 0) claudeDirs.push(f.slice(0, i) + '/.claude/projects')
}

const msgs = new Map() // message id -> { day, model, total }
let rawLines = 0 // what /stats sums: every logged line, duplicates included
for (const dir of new Set(claudeDirs)) {
  for (const f of walk(dir)) {
    for (const e of lines(f)) {
      const u = e.message?.usage
      if (e.type !== 'assistant' || !u || !e.timestamp) continue
      const model = e.message.model ?? 'unknown'
      if (model === '<synthetic>') continue
      const total = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) +
        (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0)
      rawLines += total
      // streamed messages are logged several times under one id; keep the largest
      const key = `${e.message.id}:${e.requestId ?? ''}`
      const prev = msgs.get(key)
      if (!prev || total > prev.total) msgs.set(key, { day: day(e.timestamp), model, total })
    }
  }
}

const fresh = {} // day -> { claude, cache, codex, models }
const slot = (d) => (fresh[d] ??= { claude: 0, cache: 0, codex: 0, models: {} })
for (const m of msgs.values()) {
  const s = slot(m.day)
  s.claude += m.total
  s.models[m.model] = (s.models[m.model] ?? 0) + m.total
}

// --- /stats cache ----------------------------------------------------------
// /stats sums every transcript line, and each API response is logged once per
// content block (~2x). Deflate its numbers by the duplication we measure here.
const dedupedTotal = [...msgs.values()].reduce((n, m) => n + m.total, 0)
const dup = dedupedTotal ? rawLines / dedupedTotal : 2
// Older cache versions' dailyModelTokens excluded cache reads, so scale each
// day by the model's all-tokens / counted-tokens ratio from modelUsage.
try {
  const sc = JSON.parse(fs.readFileSync(path.join(HOME, '.claude', 'stats-cache.json'), 'utf8'))
  const ratio = {}
  for (const [model, u] of Object.entries(sc.modelUsage ?? {})) {
    const all = u.inputTokens + u.outputTokens + u.cacheReadInputTokens + u.cacheCreationInputTokens
    const counted = sc.dailyModelTokens.reduce((n, d) => n + (d.tokensByModel[model] ?? 0), 0)
    ratio[model] = counted ? all / counted : 1
  }
  for (const d of sc.dailyModelTokens ?? []) {
    for (const [model, n] of Object.entries(d.tokensByModel)) {
      const s = slot(d.date)
      const v = Math.round((n * (ratio[model] ?? 1)) / dup)
      s.cache += v
      if (!s.claude) s.models[model] = (s.models[model] ?? 0) + v
    }
  }
} catch {}

// --- Codex -------------------------------------------------------------------
for (const dir of ['sessions', 'archived_sessions']) {
  for (const f of walk(path.join(HOME, '.codex', dir))) {
    let last = 0
    for (const e of lines(f)) {
      const t = e.payload?.type === 'token_count' && e.payload.info?.total_token_usage?.total_tokens
      if (!t || t <= last) continue
      const s = slot(day(e.timestamp))
      s.codex += t - last
      s.models.codex = (s.models.codex ?? 0) + t - last
      last = t
    }
  }
}

// --- merge into ledger (per-day max, so pruned logs never lower a total) ----
let ledger = { days: {} }
try { ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8')) } catch {}
for (const [d, s] of Object.entries(fresh)) {
  const o = (ledger.days[d] ??= { claude: 0, codex: 0, est: 0, models: {} })
  // transcripts are exact; the stats-cache only fills days they no longer cover
  o.claude = Math.max(o.claude, s.claude || s.cache)
  o.codex = Math.max(o.codex, s.codex)
  for (const [m, n] of Object.entries(s.models)) o.models[m] = Math.max(o.models[m] ?? 0, n)
}

// --- estimate days we only know about from prompt history ---------------------
const prompts = {}
try {
  for (const e of lines(path.join(HOME, '.claude', 'history.jsonl'))) {
    if (e.timestamp) prompts[day(e.timestamp)] = (prompts[day(e.timestamp)] ?? 0) + 1
  }
} catch {}
const rates = Object.entries(prompts)
  .filter(([d]) => ledger.days[d]?.claude > 0)
  .map(([d, n]) => ledger.days[d].claude / n)
  .sort((a, b) => a - b)
const perPrompt = rates.length ? rates[Math.floor(rates.length / 2)] : 0 // median
for (const [d, n] of Object.entries(prompts)) {
  const o = (ledger.days[d] ??= { claude: 0, codex: 0, est: 0, models: {} })
  o.est = o.claude > 0 ? 0 : Math.round(n * perPrompt)
}

// --- optional manual backfill for periods with no logs at all ------------------
// data/tokens-manual.json: [{ "from": "2025-03-01", "to": "2025-10-03", "tokens": 1234, "note": "..." }]
let manual = []
try { manual = JSON.parse(fs.readFileSync(MANUAL, 'utf8')) } catch {}

ledger.perPrompt = Math.round(perPrompt)
ledger.statsDup = Number(dup.toFixed(3))
ledger.manual = manual
ledger.updated = new Date().toISOString()
ledger.days = Object.fromEntries(Object.entries(ledger.days).sort())
fs.mkdirSync(path.dirname(LEDGER), { recursive: true })
fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1) + '\n')

const sum = (k) => Object.values(ledger.days).reduce((n, d) => n + d[k], 0)
const man = manual.reduce((n, m) => n + m.tokens, 0)
const fmt = (n) => n.toLocaleString('en-US')
console.log(`claude exact   ${fmt(sum('claude'))}`)
console.log(`codex exact    ${fmt(sum('codex'))}`)
console.log(`claude est.    ${fmt(sum('est'))}  (${fmt(Math.round(perPrompt))} tokens/prompt, ${rates.length} sample days)`)
console.log(`manual         ${fmt(man)}`)
console.log(`total          ${fmt(sum('claude') + sum('codex') + sum('est') + man)}`)
console.log(`first day      ${Object.keys(ledger.days)[0]}`)
