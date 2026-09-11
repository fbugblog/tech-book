import fs from 'node:fs'
import path from 'node:path'
import type { DefaultTheme } from 'vitepress'

/**
 * docs/ のファイル構成から、トピックごとの目次（サイドバー）とナビを自動生成する。
 *
 * 構成のルールはこれだけ:
 *
 *   docs/
 *     index.md                  ← サイトのトップページ（トピック一覧）
 *     <トピック>/
 *       index.md                ← トピックの入口。frontmatter で order / nav_label を指定できる
 *       <章や部のディレクトリ>/
 *         index.md              ← グループの見出しになる
 *         01-....md             ← 個別のページ
 *
 * - 並び順はファイル名の昇順。`01-`, `02-` のように数字プレフィックスを付けて管理する。
 * - サイドバーの表示名は frontmatter の `sidebar_label`、無ければ `title`、無ければ最初の `#` 見出し。
 * - トピックやページを追加しても設定ファイルを編集する必要はない。
 */

type PageMeta = {
  title: string
  sidebarLabel: string
  navLabel: string | null
  order: number
}

export function topicSidebars(): DefaultTheme.Sidebar {
  const docsDir = resolveDocsDir()
  const sidebar: DefaultTheme.SidebarMulti = {}

  for (const topic of listTopics(docsDir)) {
    const items: DefaultTheme.SidebarItem[] = []

    const indexFile = path.join(docsDir, topic, 'index.md')
    if (fs.existsSync(indexFile)) {
      items.push({ text: metaOf(indexFile, topic).sidebarLabel, link: `/${topic}/` })
    }
    items.push(...itemsFor(docsDir, topic))

    if (items.length > 0) sidebar[`/${topic}/`] = items
  }

  return sidebar
}

export function topicNav(): DefaultTheme.NavItem[] {
  const docsDir = resolveDocsDir()

  return listTopics(docsDir).flatMap((topic) => {
    const indexFile = path.join(docsDir, topic, 'index.md')
    if (!fs.existsSync(indexFile)) return []

    const meta = metaOf(indexFile, topic)
    return [{ text: meta.navLabel ?? meta.sidebarLabel, link: `/${topic}/` }]
  })
}

/** docs/ 直下のディレクトリを、トピックの `order` 昇順（同値なら名前順）で返す */
function listTopics(docsDir: string): string[] {
  return fs
    .readdirSync(docsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !isHidden(entry.name) && entry.name !== 'public')
    .map((entry) => {
      const indexFile = path.join(docsDir, entry.name, 'index.md')
      const order = fs.existsSync(indexFile) ? metaOf(indexFile, entry.name).order : 999
      return { name: entry.name, order }
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ja'))
    .map((topic) => topic.name)
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
        text: metaOf(path.join(docsDir, rel), entry.name).sidebarLabel,
        link: `/${toUrl(rel)}`,
      }
    }

    const children = itemsFor(docsDir, rel)
    const indexFile = path.join(docsDir, rel, 'index.md')
    const hasIndex = fs.existsSync(indexFile)

    const item: DefaultTheme.SidebarItem = {
      text: hasIndex ? metaOf(indexFile, entry.name).sidebarLabel : humanize(entry.name),
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

function metaOf(absFile: string, fallback: string): PageMeta {
  const raw = fs.readFileSync(absFile, 'utf8')
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  const block = frontmatter ? frontmatter[1] : ''

  const field = (name: string) => {
    const match = block.match(new RegExp(`^${name}:\\s*(.+)$`, 'm'))
    return match ? unquote(match[1].trim()) : null
  }

  const heading = raw.replace(/^---[\s\S]*?\n---/, '').match(/^#\s+(.+)$/m)
  const title = field('title') ?? (heading ? heading[1].trim() : humanize(fallback))
  const order = Number(field('order') ?? Number.NaN)

  return {
    title,
    sidebarLabel: field('sidebar_label') ?? title,
    navLabel: field('nav_label'),
    order: Number.isFinite(order) ? order : 999,
  }
}

function resolveDocsDir(): string {
  const candidates = [
    path.resolve(process.cwd(), 'docs'),
    process.cwd(),
    path.resolve(process.cwd(), '..', 'docs'),
  ]
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, '.vitepress'))) return dir
  }
  throw new Error(
    'docs ディレクトリを特定できませんでした。npm script はリポジトリのルートで実行してください。',
  )
}

function isHidden(name: string): boolean {
  return name.startsWith('.') || name.startsWith('_')
}

/** 並び替え用のキー（拡張子を落として `01-a.md` と `01-a/` を同じ位置に置く） */
function sortKey(name: string): string {
  return name.replace(/\.md$/, '')
}

/** `ai-for-science/01-foundations/01-intro.md` -> `ai-for-science/01-foundations/01-intro` */
function toUrl(rel: string): string {
  return rel.split(path.sep).join('/').replace(/\.md$/, '')
}

function humanize(name: string): string {
  return name.replace(/\.md$/, '').replace(/^\d+[-_]/, '').replace(/[-_]/g, ' ')
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}
