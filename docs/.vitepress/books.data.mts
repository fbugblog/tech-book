import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { defineLoader } from 'vitepress'
import {
  bodyLength,
  isHidden,
  list,
  listTopicDirs,
  readPage,
  resolveDocsDir,
  scalar,
  titleOf,
} from './pages.mts'

/**
 * トップページの索引データ。docs/ 配下のファイルを走査して、
 * 本（トピック）ごとのメタ情報と章の一覧をビルド時に組み立てる。
 *
 * 索引に出す情報はトピックの index.md の frontmatter で調整できる:
 *
 *   title       本のタイトル
 *   nav_label   ナビと索引カードに出す短い名前
 *   description 索引に出す一文（省略時は本文の最初の段落から拾う）
 *   status      「本文あり（ドラフト）」など、書き進み具合を示すラベル
 *   tags        検索とタグ絞り込みに使うキーワード
 *   order       索引とナビでの並び順
 *
 * 個々のページ側では `appendix: true` を付けると、章数に数えずに一覧へ並べる。
 */

export type BookChapter = {
  title: string
  group: string | null
  link: string
  /** 出典や用語集のような付録。章数には数えないが一覧には並べる */
  appendix: boolean
}

export type Book = {
  slug: string
  title: string
  label: string
  description: string
  status: string | null
  tags: string[]
  link: string
  chapters: BookChapter[]
  chars: number
  updated: string | null
}

declare const data: Book[]
export { data }

export default defineLoader({
  watch: ['../**/*.md'],
  load(): Book[] {
    const docsDir = resolveDocsDir()

    return listTopicDirs(docsDir).flatMap((slug) => {
      const topicDir = path.join(docsDir, slug)
      const indexFile = path.join(topicDir, 'index.md')
      if (!fs.existsSync(indexFile)) return []

      const { frontmatter, body } = readPage(indexFile)
      const title = scalar(frontmatter, 'title') ?? firstHeading(body) ?? slug
      const chapters = collectChapters(docsDir, slug)

      return [
        {
          slug,
          title,
          label: scalar(frontmatter, 'nav_label') ?? title,
          description: scalar(frontmatter, 'description') ?? firstParagraph(body),
          status: scalar(frontmatter, 'status'),
          tags: list(frontmatter, 'tags'),
          link: `/${slug}/`,
          chapters,
          chars: totalChars(topicDir),
          updated: lastModified(topicDir),
        },
      ]
    })
  },
})

/** トピック配下のページを、部などのグループ名を添えて並べる */
function collectChapters(docsDir: string, slug: string): BookChapter[] {
  const walk = (relDir: string, group: string | null): BookChapter[] => {
    const abs = path.join(docsDir, relDir)

    return fs
      .readdirSync(abs, { withFileTypes: true })
      .filter((entry) => {
        if (isHidden(entry.name)) return false
        if (entry.isDirectory()) return true
        return entry.isFile() && entry.name.endsWith('.md') && entry.name !== 'index.md'
      })
      .sort((a, b) =>
        a.name.replace(/\.md$/, '').localeCompare(b.name.replace(/\.md$/, ''), 'ja'),
      )
      .flatMap((entry) => {
        const rel = path.join(relDir, entry.name)

        if (entry.isFile()) {
          const file = path.join(docsDir, rel)
          return [
            {
              title: titleOf(file, entry.name),
              group,
              link: `/${rel.split(path.sep).join('/').replace(/\.md$/, '')}`,
              appendix: scalar(readPage(file).frontmatter, 'appendix') === 'true',
            },
          ]
        }

        const childIndex = path.join(docsDir, rel, 'index.md')
        const childGroup = fs.existsSync(childIndex)
          ? titleOf(childIndex, entry.name)
          : null
        return walk(rel, childGroup ?? group)
      })
  }

  return walk(slug, null)
}

function totalChars(dir: string): number {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !isHidden(entry.name))
    .reduce((sum, entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return sum + totalChars(full)
      if (!entry.name.endsWith('.md')) return sum
      return sum + bodyLength(readPage(full).body)
    }, 0)
}

/** 最終更新日は git の履歴から取り、取れない場合はファイルの更新時刻で代用する */
function lastModified(dir: string): string | null {
  try {
    const stdout = execFileSync('git', ['log', '-1', '--format=%cI', '--', dir], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
    if (stdout) return stdout
  } catch {
    // git が使えない環境（浅いクローンやアーカイブ展開）ではファイル時刻にフォールバックする
  }

  const mtimes = collectMtimes(dir)
  return mtimes.length > 0 ? new Date(Math.max(...mtimes)).toISOString() : null
}

function collectMtimes(dir: string): number[] {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !isHidden(entry.name))
    .flatMap((entry) => {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) return collectMtimes(full)
      return entry.name.endsWith('.md') ? [fs.statSync(full).mtimeMs] : []
    })
}

function firstHeading(body: string): string | null {
  const heading = body.match(/^#\s+(.+)$/m)
  return heading ? heading[1].trim() : null
}

/** 本文の最初の段落を、索引カードに収まる長さで切り出す */
function firstParagraph(body: string): string {
  const paragraph = body
    .replace(/^#.*$/gm, '')
    .replace(/^:::[\s\S]*?:::$/gm, '')
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, ' ').trim())
    .find((block) => block.length > 0 && !block.startsWith('<') && !block.startsWith('|'))

  if (!paragraph) return ''
  return paragraph.length > 160 ? `${paragraph.slice(0, 159)}…` : paragraph
}
