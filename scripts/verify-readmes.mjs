import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const files = ['README.md', 'README.zh.md']

function blobHash(content) {
  return createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex')
}

function structure(content) {
  const tokens = []
  let fenced = false
  for (const line of content.split(/\r?\n/)) {
    const fence = /^```(.*)$/.exec(line)
    if (fence !== null) {
      tokens.push(fenced ? 'F/' : `F:${fence[1]}`)
      fenced = !fenced
      continue
    }
    if (fenced || line.trim() === '') continue
    const heading = /^(#{1,6})\s/.exec(line)
    if (heading !== null) tokens.push(`H${heading[1].length}`)
    else if (/^[-*]\s/.test(line)) tokens.push('U')
    else if (/^\d+\.\s/.test(line)) tokens.push('O')
    else if (/^\|.*\|$/.test(line)) tokens.push('T')
    else tokens.push('P')
  }
  if (fenced) throw new Error('README contains an unclosed code fence')
  return tokens
}

const contents = Object.fromEntries(await Promise.all(files.map(async file => [file, await readFile(resolve(root, file), 'utf8')])))
const signatures = files.map(file => structure(contents[file]))
if (JSON.stringify(signatures[0]) !== JSON.stringify(signatures[1])) {
  throw new Error('README.md and README.zh.md do not have matching document structure')
}

const hashes = Object.fromEntries(files.map(file => [file, blobHash(contents[file])]))
const recordPath = resolve(root, 'README.i18n.yaml')
if (process.argv.includes('--write')) {
  await writeFile(recordPath, [
    '# Standalone bilingual README consistency record (git blob hashes).',
    '# Run `pnpm docs:write-pair` after updating both language versions.',
    `README.md: ${hashes['README.md']}`,
    `README.zh.md: ${hashes['README.zh.md']}`,
    '',
  ].join('\n'))
  console.log('Updated README.i18n.yaml')
} else {
  const record = await readFile(recordPath, 'utf8')
  for (const file of files) {
    const match = new RegExp(`^${file.replace('.', '\\.')}: ([a-f0-9]{40})$`, 'm').exec(record)
    if (match?.[1] !== hashes[file]) throw new Error(`${file} hash is stale; run pnpm docs:write-pair`)
  }
  console.log('README pair is structurally aligned and recorded')
}
