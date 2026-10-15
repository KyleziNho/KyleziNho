// Writes preview.html with the SVG inlined and every animation jumped to its end state.
import fs from 'node:fs'
const svg = fs.readFileSync(new URL('../assets/readme.svg', import.meta.url), 'utf8')
const freeze = process.argv.includes('--final') ? '<style>*{animation-delay:-20s!important}</style>' : ''
fs.writeFileSync(process.argv[2] ?? 'preview.html', `<html><body style="margin:0;background:#0d1117;padding:20px">${freeze}${svg}</body></html>`)
