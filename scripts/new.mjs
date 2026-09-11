#!/usr/bin/env node
/**
 * トピックやページのひな形を作る。番号は同じディレクトリの既存ファイルから自動で決まる。
 *
 *   npm run new:topic -- <slug> "<タイトル>"
 *   npm run new:page  -- <ディレクトリ> <slug> "<タイトル>"
 *
 * 例:
 *   npm run new:topic -- rust-book "Rustで書くCLIツール"
 *     -> docs/rust-book/index.md
 *
 *   npm run new:page -- rust-book 01-basics "はじめてのビルド"
 *     -> docs/rust-book/01-basics.md   （先頭に連番が付く）
 *
 *   npm run new:page -- ai-for-science/03-frontier agent-safety "エージェントの安全設計"
 *     -> docs/ai-for-science/03-frontier/31-agent-safety.md
 *
 * サイドバーとナビは docs/ の構成から自動生成されるので、設定ファイルの編集は不要。
 */

import fs from 'node:fs'
import path from 'node:path'

const DOCS_DIR = path.resolve(process.cwd(), 'docs')

const [mode, ...args] = process.argv.slice(2)

try {
  if (!fs.existsSync(DOCS_DIR)) {
    fail(`${DOCS_DIR} が見つかりません。リポジトリのルートで実行してください。`)
  }

  if (mode === 'topic') createTopic(args)
  else if (mode === 'page') createPage(args)
  else {
    fail(
      '使い方:\n' +
        '  npm run new:topic -- <slug> "<タイトル>"\n' +
        '  npm run new:page  -- <ディレクトリ> <slug> "<タイトル>"',
    )
  }
} catch (error) {
  fail(error.message)
}

function createTopic([slug, title]) {
  if (!slug || !title) fail('使い方: npm run new:topic -- <slug> "<タイトル>"')
  assertSlug(slug)

  const dir = path.join(DOCS_DIR, slug)
  if (fs.existsSync(dir)) fail(`${rel(dir)} はすでに存在します。`)

  const order = nextOrder()
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'index.md')
  fs.writeFileSync(file, topicTemplate(title, order), 'utf8')

  console.log(`作成しました: ${rel(file)}`)
  console.log(`トップページ（docs/index.md）の features にも追記すると、入口から辿れるようになります。`)
}

function createPage([dirArg, slug, title]) {
  if (!dirArg || !slug || !title) {
    fail('使い方: npm run new:page -- <ディレクトリ> <slug> "<タイトル>"')
  }
  assertSlug(slug)

  const dir = path.join(DOCS_DIR, dirArg)
  if (!fs.existsSync(dir)) {
    fail(`${rel(dir)} がありません。先に npm run new:topic を実行するか、パスを確認してください。`)
  }

  const numbers = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith('.md') && name !== 'index.md')
    .map((name) => Number((name.match(/^(\d+)/) ?? [])[1] ?? 0))
  const number = numbers.length === 0 ? 1 : Math.max(...numbers) + 1

  const file = path.join(dir, `${String(number).padStart(2, '0')}-${slug}.md`)
  if (fs.existsSync(file)) fail(`${rel(file)} はすでに存在します。`)

  fs.writeFileSync(file, pageTemplate(title), 'utf8')

  console.log(`作成しました: ${rel(file)}`)
  console.log('目次ページを使っている場合は npm run toc で一覧を更新してください。')
}

/** 既存トピックの order の最大値 + 1 */
function nextOrder() {
  const orders = fs
    .readdirSync(DOCS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'public' && !entry.name.startsWith('.'))
    .map((entry) => {
      const indexFile = path.join(DOCS_DIR, entry.name, 'index.md')
      if (!fs.existsSync(indexFile)) return 0
      const match = fs.readFileSync(indexFile, 'utf8').match(/^order:\s*(\d+)$/m)
      return match ? Number(match[1]) : 0
    })
  return orders.length === 0 ? 1 : Math.max(...orders) + 1
}

function topicTemplate(title, order) {
  return `---
title: ${title}
sidebar_label: この本について・目次
nav_label: ${title}
order: ${order}
---

# ${title}

（このトピックが何を扱うのか、誰に向けたものかを2〜3文で書く）

## 対象読者

- （想定読者を書く）

## 目次

<!-- TOC:start -->
<!-- TOC:end -->
`
}

function pageTemplate(title) {
  return `---
title: ${title}
---

# ${title}

（本文を書く）
`
}

function assertSlug(slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    fail(`slug は英小文字・数字・ハイフンで指定してください: ${slug}`)
  }
}

function rel(target) {
  return path.relative(process.cwd(), target)
}

function fail(message) {
  console.error(`エラー: ${message}`)
  process.exit(1)
}
