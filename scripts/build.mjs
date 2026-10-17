// Renders assets/readme.svg from GitHub's API + data/tokens.json + data/icons.json.
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'
import { layout } from './font.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const read = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'))

const LOGIN = 'KyleziNho'
const NAME = "KYLE O'SULLIVAN"
const TAGLINE = 'london · sharkninja · kyleosullivan.uk'
// Flutter/native scaffolding and markup that would drown out real code
const SKIP_LANGS = new Set(['C', 'C++', 'CMake', 'Objective-C', 'Kotlin', 'Java', 'Ruby', 'HTML', 'CSS', 'SCSS',
  'Makefile', 'Batchfile', 'Dockerfile', 'Jupyter Notebook', 'TeX', 'Procfile'])

const token = process.env.GH_TOKEN || execSync('gh auth token').toString().trim()

async function gql(query, variables = {}) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors) throw new Error(JSON.stringify(json.errors))
  return json.data
}

// ---------- data ----------
const { user } = await gql(`query($login: String!) { user(login: $login) {
  contributionsCollection { contributionYears }
  repositories(first: 100, ownerAffiliations: OWNER, isFork: false, orderBy: {field: PUSHED_AT, direction: DESC}) {
    totalCount
    nodes { name isPrivate stargazerCount pushedAt primaryLanguage { name }
      languages(first: 20) { edges { size node { name } } } }
  } } }`, { login: LOGIN })

const years = user.contributionsCollection.contributionYears
const yearQ = years.map((y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {
  contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } } }`).join('\n')
const cal = (await gql(`query($login: String!) { user(login: $login) { ${yearQ} } }`, { login: LOGIN })).user

const days = Object.values(cal)
  .flatMap((y) => y.contributionCalendar.weeks.flatMap((w) => w.contributionDays))
  .sort((a, b) => a.date.localeCompare(b.date))
const today = new Date().toISOString().slice(0, 10)
const past = days.filter((d) => d.date <= today)
const totalContrib = Object.values(cal).reduce((n, y) => n + y.contributionCalendar.totalContributions, 0)

let best = 0, run = 0
for (const d of past) { run = d.contributionCount ? run + 1 : 0; best = Math.max(best, run) }
// weekly buckets over the past year, oldest first
const yearDays = past.slice(-364)
const weeks = Array.from({ length: 52 }, (_, i) => {
  const w = yearDays.slice(i * 7, i * 7 + 7)
  return { date: w[0].date, contributionCount: w.reduce((n, d) => n + d.contributionCount, 0) }
})
const sumYear = weeks.reduce((n, d) => n + d.contributionCount, 0)

const langBytes = {}
for (const r of user.repositories.nodes) {
  for (const e of r.languages.edges) {
    if (!SKIP_LANGS.has(e.node.name)) langBytes[e.node.name] = (langBytes[e.node.name] ?? 0) + e.size
  }
}
const langTotal = Object.values(langBytes).reduce((a, b) => a + b, 0)
const langs = Object.entries(langBytes).sort((a, b) => b[1] - a[1]).slice(0, 6)
  .map(([name, b]) => ({ name: name.toLowerCase(), pct: (b / langTotal) * 100 }))

const shipped = user.repositories.nodes.filter((r) => !r.isPrivate).slice(0, 7)

const tk = read('data/tokens.json')
const tdays = Object.values(tk.days)
const claudeExact = tdays.reduce((n, d) => n + d.claude, 0)
const codex = tdays.reduce((n, d) => n + d.codex, 0)
const est = tdays.reduce((n, d) => n + d.est, 0) + (tk.manual ?? []).reduce((n, m) => n + m.tokens, 0)
const tokens = claudeExact + codex + est
const firstDay = [...Object.keys(tk.days), ...(tk.manual ?? []).map((m) => m.from)].sort()[0]

const icons = read('data/icons.json')

// ---------- helpers ----------
const W = 880, P = 40
const C = { bg: '#0b0b0c', panel: '#0e0e10', line: '#2a2a2e', fg: '#ececec', dim: '#8a8a90', faint: '#55555b', track: '#1a1a1d', claude: '#D97757' }
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, '&#39;')
const fmt = (n) => Math.round(n).toLocaleString('en-US')
const mon = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', day: 'numeric', timeZone: 'UTC' }).toLowerCase()
const monY = (d) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'UTC' }).toLowerCase()
const ago = (iso) => {
  const h = (Date.now() - new Date(iso)) / 36e5
  return h < 24 ? `${Math.max(1, Math.round(h))}h ago` : h < 24 * 60 ? `${Math.round(h / 24)}d ago` : `${Math.round(h / 24 / 30)}mo ago`
}
const short = (n) => n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : fmt(n)
const milestone = (n) => { const e = 10 ** Math.floor(Math.log10(n)); return [1, 2, 2.5, 5, 10].map((m) => m * e).find((m) => m > n) }

const text = (x, y, s, { size = 13, fill = C.dim, anchor = 'start', weight = 400, cls = '', ls = 0 } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}"${ls ? ` letter-spacing="${ls}"` : ''}${cls ? ` class="${cls}"` : ''}>${esc(s)}</text>`
const label = (x, y, title, sub) =>
  `<text x="${x}" y="${y}" font-size="13" letter-spacing="1.5"><tspan fill="${C.fg}">${esc(title)}</tspan>${sub ? `<tspan fill="${C.faint}"> · </tspan><tspan fill="${C.dim}" letter-spacing="0.5">${esc(sub)}</tspan>` : ''}</text>`
const hr = (y, x1 = 0, x2 = W) => `<line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${C.line}" stroke-dasharray="4 4"/>`
const vr = (x, y1, y2) => `<line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}" stroke="${C.line}" stroke-dasharray="4 4"/>`

// pixel-font text with a dithered drop shadow; each char fades in (typing)
function pixel(str, x, y, px, { delay = 0, step = 0.06, cls = 'type' } = {}) {
  const { chars, width } = layout(str, px)
  const g = chars.map((c, i) => `<g class="${cls}" style="animation-delay:${(delay + i * step).toFixed(2)}s">` +
    `<path d="${c.d}" transform="translate(${px / 2} ${px / 2})" fill="url(#dither)"/><path d="${c.d}" fill="${C.fg}"/></g>`).join('')
  return { svg: `<g transform="translate(${x} ${y})">${g}</g>`, width }
}

// horizontal progress bar with tick marks and a dithered leading edge
function meter(x, y, w, h, frac, delay, segments) {
  const fill = Math.max(2, w * Math.min(1, frac))
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${C.track}"/>`
  s += `<g class="grow-x" style="animation-delay:${delay}s">`
  if (segments) {
    let cx = x
    for (const [f, color] of segments) { const sw = fill * f; s += `<rect x="${cx}" y="${y}" width="${sw}" height="${h}" fill="${color}"/>`; cx += sw }
  } else s += `<rect x="${x}" y="${y}" width="${fill}" height="${h}" fill="${C.fg}"/>`
  s += `<rect x="${x + fill}" y="${y}" width="${Math.min(h * 0.6, w - fill)}" height="${h}" fill="url(#dither)"/></g>`
  for (let t = x + w / 10; t < x + w - 1; t += w / 10) s += `<line x1="${t}" y1="${y}" x2="${t}" y2="${y + h}" stroke="${C.bg}" stroke-opacity=".7"/>`
  return s
}

// odometer: each digit is a column of 0-9 twice that rolls into place
function odometer(str, x, y, px) {
  const h = 7 * px, digitW = 6 * px
  let cx = 0, s = ''
  const clipId = 'odo'
  ;[...str].forEach((ch, i) => {
    if (!/\d/.test(ch)) {
      s += pixel(ch, x + cx, y, px, { delay: 0, cls: 'fade' }).svg
      cx += layout(ch, px).width + px
      return
    }
    const col = Array.from({ length: 20 }, (_, k) => {
      const { chars } = layout(String(k % 10), px)
      return `<g transform="translate(0 ${k * h * 1.25})"><path d="${chars[0].d}" transform="translate(${px / 2} ${px / 2})" fill="url(#dither)"/><path d="${chars[0].d}" fill="${C.fg}"/></g>`
    }).join('')
    const target = (10 + Number(ch)) * h * 1.25
    s += `<g transform="translate(${x + cx} ${y})" clip-path="url(#${clipId})"><g class="roll" style="animation-delay:${(i * 0.05).toFixed(2)}s;transform:translateY(-${target}px)">${col}</g></g>`
    cx += digitW
  })
  return { svg: s, width: cx, clip: `<clipPath id="${clipId}"><rect x="-2" y="-2" width="${digitW + 4}" height="${h + px + 4}"/></clipPath>` }
}

// ---------- layout ----------
let y = 0
const out = []

// header
out.push(text(P, 36, LOGIN.toLowerCase(), { fill: C.fg, size: 15, weight: 700 }))
out.push(`<text x="${W - P}" y="36" font-size="14" text-anchor="end"><tspan fill="${C.faint}">~/</tspan><tspan fill="${C.fg}">readme</tspan></text>`)
out.push(hr(58))

// title
const title = pixel(NAME, P, 90, 8, { delay: 0.2 })
out.push(title.svg)
out.push(`<rect class="cursor" x="${P + title.width + 14}" y="90" width="26" height="56" fill="${C.fg}"/>`)
out.push(text(P, 182, TAGLINE, { size: 13, fill: C.dim, cls: 'fade d2', ls: 0.5 }))
out.push(hr(210))

// stack
const ICON = 28, GAP = 16, SEP = 22
const rows = [[icons[0], icons[1], icons[3]], [icons[2], icons[4]]]
const toolCount = icons.flat().length
out.push(label(P, 244, 'STACK', `${toolCount} tools`))
let n = 0
rows.forEach((groups, ri) => {
  const width = groups.reduce((w, g) => w + g.length * ICON + (g.length - 1) * GAP, 0) + (groups.length - 1) * (SEP * 2)
  let ix = (W - width) / 2
  const iy = 272 + ri * 50
  groups.forEach((g, gi) => {
    if (gi) { out.push(`<circle cx="${ix + SEP - GAP / 2 + 3}" cy="${iy + ICON / 2}" r="1.5" fill="${C.faint}"/>`); ix += SEP * 2 - GAP }
    for (const ic of g) {
      // brand colours too dark for the background get drawn light
      const hex = parseInt(ic.hex, 16)
      const lum = 0.299 * (hex >> 16) + 0.587 * ((hex >> 8) & 255) + 0.114 * (hex & 255)
      const fill = lum < 70 ? C.fg : `#${ic.hex}`
      out.push(`<g class="pop" style="animation-delay:${(0.6 + n++ * 0.03).toFixed(2)}s"><title>${esc(ic.title)}</title>` +
        `<g transform="translate(${ix} ${iy}) scale(${ICON / 24})"><path d="${ic.path}" fill="${fill}"/></g></g>`)
      ix += ICON + GAP
    }
  })
})
out.push(hr(386))

// contributions + totals
y = 386
const split = 560
out.push(label(P, y + 34, 'CONTRIBUTIONS', `${fmt(sumYear)} in the last year · weekly`))
const chartX = P, chartW = split - P - 30, base = y + 210, maxH = 140
const max = Math.max(1, ...weeks.map((d) => d.contributionCount))
const bw = chartW / weeks.length
weeks.forEach((d, i) => {
  const h = d.contributionCount ? Math.max(4, Math.sqrt(d.contributionCount / max) * maxH) : 1
  const bx = chartX + i * bw + 1, w = bw - 2
  out.push(`<g class="grow-y" style="animation-delay:${(0.8 + i * 0.015).toFixed(3)}s">` +
    `<rect x="${bx}" y="${base - h}" width="${w}" height="${h}" fill="${d.contributionCount ? C.fg : C.line}"/>` +
    (d.contributionCount ? `<rect x="${bx}" y="${base - h}" width="${w}" height="${Math.min(4, h)}" fill="url(#dither2)"/>` : '') + '</g>')
  if (d.contributionCount === max && !weeks.slice(0, i).some((x) => x.contributionCount === max)) out.push(text(bx + w / 2, base - h - 8, String(max), { size: 12, fill: C.fg, anchor: 'middle', cls: 'fade d3' }))
})
out.push(text(chartX, base + 26, mon(weeks[0].date), { size: 12, fill: C.faint }))
out.push(text(chartX + chartW, base + 26, 'today', { size: 12, fill: C.faint, anchor: 'end' }))

out.push(vr(split, y, y + 250))
const tx = split + 30
out.push(label(tx, y + 34, 'TOTALS'))
;[[fmt(totalContrib), 'contributions'], [String(yearDays.filter((d) => d.contributionCount).length), 'active days, 1y'], [String(best), 'day streak, best'], [String(user.repositories.totalCount), 'repos built']]
  .forEach(([v, l], i) => {
    const ry = y + 58 + i * 40
    out.push(pixel(v, tx, ry, 4, { delay: 1 + i * 0.15, step: 0.04 }).svg)
    out.push(text(tx + 100, ry + 22, l, { size: 13, fill: C.fg }))
  })
y += 250
out.push(hr(y))

// languages + shipping
out.push(label(P, y + 34, 'LANGUAGES', 'by bytes'))
langs.forEach((l, i) => {
  const ly = y + 64 + i * 30
  out.push(text(P, ly + 10, l.name, { size: 14, fill: C.fg }))
  out.push(meter(P + 120, ly, 210, 14, l.pct / 100 / (langs[0].pct / 100) * 0.55, 1.2 + i * 0.08))
  out.push(text(P + 400, ly + 11, `${l.pct.toFixed(1)}%`, { size: 14, fill: C.fg, anchor: 'end' }))
})
const mid = 470
out.push(vr(mid, y, y + 260))
out.push(label(mid + 30, y + 34, 'SHIPPING', 'recently pushed'))
shipped.forEach((r, i) => {
  const ry = y + 70 + i * 26
  out.push(`<g class="fade" style="animation-delay:${(1.3 + i * 0.07).toFixed(2)}s">` +
    `<text x="${mid + 30}" y="${ry}" font-size="13"><tspan fill="${C.faint}">~/</tspan><tspan fill="${C.fg}">${esc(r.name.length > 24 ? r.name.slice(0, 23) + '…' : r.name)}</tspan></text>` +
    text(W - P - 70, ry, (r.primaryLanguage?.name ?? '—').toLowerCase(), { size: 12, fill: C.dim, anchor: 'end' }) +
    text(W - P, ry, ago(r.pushedAt), { size: 12, fill: C.fg, anchor: 'end' }) + '</g>')
})
y += 260
out.push(hr(y))

// tokens
const goal = milestone(tokens)
// rough API-equivalent cost: ~$0.785 per 1M tokens, from the measured model/cache mix
out.push(label(P, y + 34, 'TOKEN SPEND', `claude code + codex · since ${monY(firstDay)} · ≈ $${Math.round((tokens / 1e6) * 0.785 / 1000)}k at API prices`))
const odo = odometer(fmt(tokens), P, y + 58, 7)
out.push(odo.svg)
out.push(text(P + odo.width + 24, y + 96, `≈ ${(tokens / 1e9).toFixed(2)} billion tokens`, { size: 15, fill: C.fg, cls: 'fade d3' }))
const exactPart = claudeExact + codex
out.push(meter(P, y + 132, W - P * 2 - 150, 18, tokens / goal, 1.8,
  [[claudeExact / tokens, C.fg], [codex / tokens, '#9aa0a6'], [est / tokens, 'url(#dither)']]))
out.push(text(W - P, y + 146, `${short(tokens)}/${short(goal)}`, { size: 18, fill: C.fg, anchor: 'end' }))
const legend = [[C.fg, `claude ${short(claudeExact)}`], ['#9aa0a6', `codex ${short(codex)}`], ['url(#dither)', `estimated ${short(est)}`]]
let lx = P
for (const [c, l] of legend) {
  out.push(`<rect x="${lx}" y="${y + 166}" width="10" height="10" fill="${c}"${c.startsWith('url') ? ` stroke="${C.dim}" stroke-width=".5"` : ''}/>`)
  out.push(text(lx + 16, y + 175, l, { size: 12, fill: C.dim }))
  lx += 30 + l.length * 7.6
}
out.push(text(W - P, y + 175, `${Math.round((exactPart / tokens) * 100)}% measured from local logs`, { size: 12, fill: C.faint, anchor: 'end' }))
y += 200
out.push(hr(y))

// footer
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
out.push(`<rect class="pulse" x="${P}" y="${y + 22}" width="8" height="8" fill="${C.fg}"/>`)
out.push(text(P + 18, y + 31, 'regenerated every 6h by github actions', { size: 12, fill: C.faint }))
out.push(text(W - P, y + 31, `last sync ${stamp} utc`, { size: 12, fill: C.faint, anchor: 'end' }))
const H = y + 54

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace">
<defs>
<pattern id="dither" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="1" height="1" fill="${C.fg}"/><rect x="1" y="1" width="1" height="1" fill="${C.fg}"/></pattern>
<pattern id="dither2" width="2" height="2" patternUnits="userSpaceOnUse"><rect width="2" height="2" fill="${C.bg}"/><rect width="1" height="1" fill="${C.fg}"/><rect x="1" y="1" width="1" height="1" fill="${C.fg}"/></pattern>
${odo.clip}
</defs>
<style>
.type{opacity:0;animation:type .01s steps(1) forwards}
@keyframes type{to{opacity:1}}
.cursor{animation:blink 1.1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
.fade{opacity:0;animation:fade .6s ease-out forwards}
.d2{animation-delay:1.1s}.d3{animation-delay:1.9s}
@keyframes fade{to{opacity:1}}
.pop{opacity:0;transform-box:fill-box;transform-origin:center;animation:pop .45s cubic-bezier(.2,.9,.3,1.4) forwards}
@keyframes pop{from{opacity:0;transform:scale(.4)}to{opacity:1;transform:scale(1)}}
.grow-y{transform-box:fill-box;transform-origin:bottom;transform:scaleY(0);animation:gy .7s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes gy{to{transform:scaleY(1)}}
.grow-x{transform-box:fill-box;transform-origin:left;transform:scaleX(0);animation:gx 1.2s cubic-bezier(.2,.8,.2,1) forwards}
@keyframes gx{to{transform:scaleX(1)}}
.roll{animation:roll 2.2s cubic-bezier(.15,.85,.25,1) backwards}
@keyframes roll{from{transform:translateY(0)}}
.pulse{animation:pulse 1.6s ease-in-out infinite}
@keyframes pulse{50%{opacity:.25}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}.type,.fade,.pop{opacity:1}.grow-x,.grow-y,.pop{transform:none}}
</style>
<rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="6" fill="${C.bg}" stroke="${C.line}"/>
${out.join('\n')}
</svg>
`
fs.mkdirSync(path.join(ROOT, 'assets'), { recursive: true })
fs.writeFileSync(path.join(ROOT, 'assets', 'readme.svg'), svg)
console.log(`wrote assets/readme.svg (${(svg.length / 1024).toFixed(1)} KB) · ${fmt(tokens)} tokens · ${totalContrib} contributions`)
