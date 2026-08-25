import { readdir, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const output = new URL('../lib/', import.meta.url)
const outputPath = fileURLToPath(output)
const entryNames = ['index.js', 'invariant.js']
const referenced = new Set()

for (const entryName of entryNames) {
  const source = await readFile(new URL(entryName, output), 'utf8')
  for (const match of source.matchAll(/from\s+["']\.\/(summary-[A-Za-z0-9_-]+\.js)["']/g)) {
    referenced.add(match[1])
    referenced.add(`${match[1]}.map`)
  }
}

for (const name of await readdir(output)) {
  if (!/^summary-[A-Za-z0-9_-]+\.js(?:\.map)?$/.test(name) || referenced.has(name)) continue
  await rm(join(outputPath, name), { force: true })
}

async function removeDeclarationPassJavaScript(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      await removeDeclarationPassJavaScript(path)
    } else if (entry.name.endsWith('.js') || entry.name.endsWith('.js.map')) {
      await rm(path, { force: true })
    }
  }
}

await removeDeclarationPassJavaScript(join(outputPath, 'types'))
