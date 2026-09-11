#!/usr/bin/env node
/**
 * 原稿の文字数を章ごとに集計する。
 *
 *   npm run count
 *
 * frontmatter・コードブロック・HTML コメント・Markdown の記号は除外して、
 * 「本文として読まれる文字」だけを数える。400字詰め原稿用紙の枚数も併記する。
 */

import fs from 'node:fs'
import path from 'node:path'

const DOCS_DIR = path.resolve(process.cwd(), 'docs')
const CHARS_PER_SHEET = 400

if (!fs.existsSync(DOCS_DIR)) {
  console.error(`エラー: ${DOCS_DIR} が見つかりません。リポジトリのルートで実行してください。`)
  process.exit(1)
}

const groups = []

for (const target of listTopics()) {
  const root = path.join(DOCS_DIR, target)
  if (!fs.existsSync(root)) continue

  const files = collectMarkdown(root)
  if (files.length === 0) continue

  const byGroup = new Map()
  for (const file of files) {
    const key = groupKeyOf(root, file)
    const count = countChars(fs.readFileSync(file, 'utf8'))
    const current = byGroup.get(key) ?? { chars: 0, files: 0 }
    byGroup.set(key, { chars: current.chars + count, files: current.files + 1 })
  }

  for (const [name, stats] of [...byGroup.entries()].sort((a, b) => a[0].localeCompare(b[0], 'ja'))) {
    groups.push({ name: `${target}/${name}`, ...stats })
  }
}

if (groups.length === 0) {
  console.log('原稿が見つかりませんでした。')
  process.exit(0)
}

const total = groups.reduce(
  (acc, group) => ({ chars: acc.chars + group.chars, files: acc.files + group.files }),
  { chars: 0, files: 0 },
)

const nameWidth = Math.max(...groups.map((group) => width(group.name)), width('合計'))

console.log('')
console.log(
  `${padEnd('章', nameWidth)}  ${padStart('文字数', 8)}  ${padStart('ページ', 6)}  ${padStart('ファイル', 4)}`,
)
console.log('-'.repeat(nameWidth + 28))

for (const group of groups) {
  printRow(group.name, group.chars, group.files, nameWidth)
}

console.log('-'.repeat(nameWidth + 28))
printRow('合計', total.chars, total.files, nameWidth)
console.log('')
console.log(`※ ページは400字詰め原稿用紙に換算した枚数の目安です。`)

function printRow(name, chars, files, nameWidth) {
  const sheets = (chars / CHARS_PER_SHEET).toFixed(1)
  console.log(
    `${padEnd(name, nameWidth)}  ${String(chars).padStart(8)}  ${sheets.padStart(6)}  ${String(files).padStart(4)}`,
  )
}

/** docs/ 直下のディレクトリをトピックとして扱う */
function listTopics() {
  return fs
    .readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name !== 'public' &&
        !entry.name.startsWith('.') &&
        !entry.name.startsWith('_'),
    )
    .map((entry) => entry.name)
    .sort()
}

function collectMarkdown(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return collectMarkdown(full)
      return entry.isFile() && entry.name.endsWith('.md') ? [full] : []
    })
    .sort()
}

/** 章ディレクトリ名（直下のファイルはファイル名そのもの）を集計キーにする */
function groupKeyOf(root, file) {
  const rel = path.relative(root, file)
  const [head] = rel.split(path.sep)
  return head.replace(/\.md$/, '')
}

function countChars(raw) {
  const text = raw
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, '') // frontmatter
    .replace(/```[\s\S]*?```/g, '') // コードブロック
    .replace(/^:::.*$/gm, '') // VitePress のコンテナ記法
    .replace(/<!--[\s\S]*?-->/g, '') // HTML コメント
    .replace(/`[^`]*`/g, '') // インラインコード
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 画像
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // リンクはテキストだけ残す
    .replace(/^#{1,6}\s+/gm, '') // 見出し記号
    .replace(/^\s*[-*+]\s+/gm, '') // 箇条書き記号
    .replace(/^\s*\d+\.\s+/gm, '') // 番号付き箇条書き
    .replace(/^\s*\|.*\|\s*$/gm, '') // 表
    .replace(/[*_~>]/g, '') // 強調・引用記号

  return text.replace(/\s/g, '').length
}

function width(value) {
  // 全角を2文字分として数え、桁をそろえる
  return [...value].reduce((sum, char) => sum + (/[ -~]/.test(char) ? 1 : 2), 0)
}

function padEnd(value, target) {
  return value + ' '.repeat(Math.max(0, target - width(value)))
}

function padStart(value, target) {
  return ' '.repeat(Math.max(0, target - width(value))) + value
}
