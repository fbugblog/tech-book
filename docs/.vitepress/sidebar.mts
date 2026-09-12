import fs from 'node:fs'
import path from 'node:path'
import type { DefaultTheme } from 'vitepress'
import {
  humanize,
  isHidden,
  listTopicDirs,
  readPage,
  resolveDocsDir,
  scalar,
} from './pages.mts'

/**
 * docs/ のファイル構成から、トピックごとの目次（サイドバー）とナビを自動生成する。
 *
 * 構成のルールはこれだけ:
 *
 *   docs/
 *     index.md                  ← サイトのトップページ（本の索引）
 *     <トピック>/
 *       index.md                ← トピックの入口。frontmatter で order / nav_label を指定できる
 *       <部などのディレクトリ>/
 *         index.md              ← グループの見出しになる
 *         01-....md             ← 個別のページ
 *
 * - 並び順はファイル名の昇順。`01-`, `02-` のように数字プレフィックスを付けて管理する。
 * - サイドバーの表示名は frontmatter の `sidebar_label`、なければ `title`、なければ最初の `#` 見出し。
 * - トピックやページを追加しても設定ファイルを編集する必要はない。
 */

export function topicSidebars(): DefaultTheme.Sidebar {
  const docsDir = resolveDocsDir()
  const sidebar: DefaultTheme.SidebarMulti = {}

  for (const topic of listTopicDirs(docsDir)) {
    const items: DefaultTheme.SidebarItem[] = []

    const indexFile = path.join(docsDir, topic, 'index.md')
    if (fs.existsSync(indexFile)) {
      items.push({ text: labelOf(indexFile, topic), link: `/${topic}/` })
    }
    items.push(...itemsFor(docsDir, topic))

    if (items.length > 0) sidebar[`/${topic}/`] = items
  }

  return sidebar
}

export function topicNav(): DefaultTheme.NavItem[] {
  const docsDir = resolveDocsDir()

  return listTopicDirs(docsDir).flatMap((topic) => {
    const indexFile = path.join(docsDir, topic, 'index.md')
    if (!fs.existsSync(indexFile)) return []

    const { frontmatter } = readPage(indexFile)
    const text = scalar(frontmatter, 'nav_label') ?? labelOf(indexFile, topic)
    return [{ text, link: `/${topic}/` }]
  })
}

function itemsFor(docsDir: string, relDir: string): DefaultTheme.SidebarItem[] {
  const abs = path.join(docsDir, relDir)

  // ファイルとディレクトリを名前順で混ぜて並べる（`03-note.md` と `04-part/` が意図した順に並ぶように）
  const entries = fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((entry) => {
      if (isHidden(entry.name)) return false
      if (entry.isDirectory()) return true
      return entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'index.md'
    })
    .sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name), 'ja'))

  return entries.map((entry) => {
    const rel = path.join(relDir, entry.name)

    if (entry.isFile()) {
      return {
        text: labelOf(path.join(docsDir, rel), entry.name),
        link: `/${toUrl(rel)}`,
      }
    }

    const children = itemsFor(docsDir, rel)
    const indexFile = path.join(docsDir, rel, 'index.md')
    const hasIndex = fs.existsSync(indexFile)

    const item: DefaultTheme.SidebarItem = {
      text: hasIndex ? labelOf(indexFile, entry.name) : humanize(entry.name),
    }
    if (hasIndex) item.link = `/${toUrl(rel)}/`
    if (children.length > 0) {
      item.items = children
      // 既定ではたたんでおく。VitePress が閲覧中のページを含むグループだけ自動で開く
      item.collapsed = true
    }
    return item
  })
}

/** サイドバーの表示名: sidebar_label → title → 最初の見出し → ファイル名 */
function labelOf(absFile: string, fallback: string): string {
  const { frontmatter, body } = readPage(absFile)
  const label = scalar(frontmatter, 'sidebar_label') ?? scalar(frontmatter, 'title')
  if (label) return label

  const heading = body.match(/^#\s+(.+)$/m)
  return heading ? heading[1].trim() : humanize(fallback)
}

/** 並び替え用のキー（拡張子を落として `01-a.md` と `01-a/` を同じ位置に置く） */
function sortKey(name: string): string {
  return name.replace(/\.md$/, '')
}

/** `ai-for-science/01-foundations/01-intro.md` -> `ai-for-science/01-foundations/01-intro` */
function toUrl(rel: string): string {
  return rel.split(path.sep).join('/').replace(/\.md$/, '')
}
