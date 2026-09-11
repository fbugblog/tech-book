#!/usr/bin/env node
/**
 * index.md の中の目次ブロックを、ファイル構成から再生成する。
 *
 *   npm run toc
 *
 * 対象は docs/ 配下の index.md のうち、次のマーカーを含むもの。
 * マーカーの間だけが書き換わるので、前後の文章はそのまま残る。
 *
 *   <!-- TOC:start -->
 *   <!-- TOC:end -->
 *
 * サイドバーは常に自動生成なので、この目次は「ページとして読める一覧」を
 * 用意したいときだけ使えばよい。章を追加したらこのコマンドを実行する。
 */

import fs from 'node:fs'
import path from 'node:path'

const DOCS_DIR = path.resolve(process.cwd(), 'docs')
const START = '<!-- TOC:start -->'
const END = '<!-- TOC:end -->'

if (!fs.existsSync(DOCS_DIR)) {
  console.error(`エラー: ${DOCS_DIR} が見つかりません。リポジトリのルートで実行してください。`)
  process.exit(1)
}

const targets = collectIndexes(DOCS_DIR).filter((file) => {
  const text = fs.readFileSync(file, 'utf8')
  return text.includes(START) && text.includes(END)
})

if (targets.length === 0) {
  console.log(`${START} を含む index.md が見つかりませんでした。`)
  process.exit(0)
}

let updated = 0
for (const file of targets) {
  const original = fs.readFileSync(file, 'utf8')
  const toc = renderToc(path.dirname(file), 0)
  const body = toc.length > 0 ? `\n${toc.join('\n')}\n` : '\n'

  const head = original.slice(0, original.indexOf(START) + START.length)
  const tail = original.slice(original.indexOf(END))
  const next = `${head}${body}${tail}`

  if (next !== original) {
    fs.writeFileSync(file, next, 'utf8')
    updated += 1
  }
  console.log(`${path.relative(process.cwd(), file)}: ${toc.length} 行`)
}

console.log(`${updated} ファイルを更新しました`)

function renderToc(dir, depth) {
  const indent = '  '.repeat(depth)

  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => {
      if (entry.name.startsWith('.') || entry.name.startsWith('_')) return false
      if (entry.isDirectory()) return true
      return entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'index.md'
    })
    .sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name), 'ja'))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name)

      if (entry.isFile()) {
        return [`${indent}- [${titleOf(full, entry.name)}](${linkFor(full)})`]
      }

      const indexFile = path.join(full, 'index.md')
      const label = fs.existsSync(indexFile) ? titleOf(indexFile, entry.name) : humanize(entry.name)
      const head = fs.existsSync(indexFile)
        ? `${indent}- [${label}](${linkFor(indexFile)})`
        : `${indent}- ${label}`

      return [head, ...renderToc(full, depth + 1)]
    })
}

function titleOf(absFile, fallback) {
  const raw = fs.readFileSync(absFile, 'utf8')
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)

  if (frontmatter) {
    const title = frontmatter[1].match(/^title:\s*(.+)$/m)
    if (title) return title[1].trim().replace(/^['"]|['"]$/g, '')
  }

  const heading = raw.replace(/^---[\s\S]*?\n---/, '').match(/^#\s+(.+)$/m)
  return heading ? heading[1].trim() : humanize(fallback)
}

/** docs/ からの絶対パス（cleanUrls 前提で拡張子を落とす） */
function linkFor(absFile) {
  const rel = path.relative(DOCS_DIR, absFile).split(path.sep).join('/')
  return `/${rel.replace(/index\.md$/, '').replace(/\.md$/, '')}`
}

function collectIndexes(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      if (entry.name.startsWith('.') || entry.name === 'public') return []
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return collectIndexes(full)
      return entry.name === 'index.md' ? [full] : []
    })
}

function sortKey(name) {
  return name.replace(/\.md$/, '')
}

function humanize(name) {
  return name.replace(/\.md$/, '').replace(/^\d+[-_]/, '').replace(/[-_]/g, ' ')
}
