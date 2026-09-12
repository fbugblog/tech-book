import fs from 'node:fs'
import path from 'node:path'

/**
 * docs/ 配下のページを読むための共通処理。
 * サイドバーの自動生成（sidebar.mts）と、トップページの索引データ（books.data.mts）が
 * 同じ規約でファイルを読めるようにここに寄せている。
 */

export type Frontmatter = Record<string, string | string[]>

export type Page = {
  frontmatter: Frontmatter
  body: string
}

export function resolveDocsDir(): string {
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

export function readPage(absFile: string): Page {
  const raw = fs.readFileSync(absFile, 'utf8')
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)

  return {
    frontmatter: match ? parseFrontmatter(match[1]) : {},
    body: match ? raw.slice(match[0].length) : raw,
  }
}

/**
 * frontmatter のうち、この構成で使うぶんだけを読む簡易パーサ。
 * `key: value` / `key: [a, b]` / `key:` に続く `- item` の3形だけを解釈する。
 */
function parseFrontmatter(block: string): Frontmatter {
  const frontmatter: Frontmatter = {}
  const lines = block.split(/\r?\n/)

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const entry = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/)
    if (!entry) continue

    const [, key, rawValue] = entry
    const value = rawValue.trim()

    if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key] = value
        .slice(1, -1)
        .split(',')
        .map((item) => unquote(item.trim()))
        .filter(Boolean)
      continue
    }

    if (value === '') {
      const items: string[] = []
      while (i + 1 < lines.length) {
        const item = lines[i + 1].match(/^\s*-\s+(.+)$/)
        if (!item) break
        items.push(unquote(item[1].trim()))
        i += 1
      }
      frontmatter[key] = items.length > 0 ? items : ''
      continue
    }

    frontmatter[key] = unquote(value)
  }

  return frontmatter
}

export function scalar(frontmatter: Frontmatter, key: string): string | null {
  const value = frontmatter[key]
  return typeof value === 'string' && value !== '' ? value : null
}

export function list(frontmatter: Frontmatter, key: string): string[] {
  const value = frontmatter[key]
  if (Array.isArray(value)) return value
  return typeof value === 'string' && value !== '' ? [value] : []
}

/** frontmatter の title、次に最初の見出し、最後にファイル名 */
export function titleOf(absFile: string, fallback: string): string {
  const { frontmatter, body } = readPage(absFile)
  const title = scalar(frontmatter, 'title')
  if (title) return title

  const heading = body.match(/^#\s+(.+)$/m)
  return heading ? heading[1].trim() : humanize(fallback)
}

/** docs/ 直下のディレクトリを、トピックの order 昇順（同値なら名前順）で返す */
export function listTopicDirs(docsDir: string): string[] {
  return fs
    .readdirSync(docsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !isHidden(entry.name) && entry.name !== 'public')
    .map((entry) => {
      const indexFile = path.join(docsDir, entry.name, 'index.md')
      const order = fs.existsSync(indexFile)
        ? Number(scalar(readPage(indexFile).frontmatter, 'order') ?? Number.NaN)
        : Number.NaN
      return { name: entry.name, order: Number.isFinite(order) ? order : 999 }
    })
    .sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ja'))
    .map((topic) => topic.name)
}

export function isHidden(name: string): boolean {
  return name.startsWith('.') || name.startsWith('_')
}

export function humanize(name: string): string {
  return name.replace(/\.md$/, '').replace(/^\d+[-_]/, '').replace(/[-_]/g, ' ')
}

function unquote(value: string): string {
  return value.replace(/^['"]|['"]$/g, '')
}

/** 本文として読まれる文字数（frontmatter・コード・記号を除いて数える） */
export function bodyLength(body: string): number {
  const text = body
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^:::.*$/gm, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/`[^`]*`/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+\.\s+/gm, '')
    .replace(/^\s*\|.*\|\s*$/gm, '')
    .replace(/[*_~>]/g, '')

  return text.replace(/\s/g, '').length
}
