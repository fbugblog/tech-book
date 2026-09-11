<script setup lang="ts">
import { computed, ref } from 'vue'
import { data as books, type Book, type BookChapter } from '../books.data.mts'

/**
 * トップページの索引。書いた本を一覧し、キーワードで絞り込む。
 * 章タイトルまで検索対象にしているので、「RAG」「拡散モデル」のような語から
 * 該当する章に直接飛べる。本文まで検索したい場合はナビの検索（Ctrl+K）を使う。
 */

const query = ref('')
const activeTag = ref<string | null>(null)

const allTags = computed(() => {
  const counts = new Map<string, number>()
  for (const book of books) {
    for (const tag of book.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts.keys()].sort((a, b) => a.localeCompare(b, 'ja'))
})

const terms = computed(() =>
  normalize(query.value)
    .split(/[\s　]+/)
    .filter(Boolean),
)

const results = computed(() =>
  books
    .filter((book) => activeTag.value === null || book.tags.includes(activeTag.value))
    .map((book) => {
      if (terms.value.length === 0) {
        return { book, chapters: [] as BookChapter[], matched: true }
      }

      const haystack = normalize(
        [book.title, book.label, book.description, book.status ?? '', ...book.tags].join(' '),
      )
      const onMeta = terms.value.every((term) => haystack.includes(term))
      const chapters = book.chapters.filter((chapter) => {
        const text = normalize(`${chapter.group ?? ''} ${chapter.title}`)
        return terms.value.every((term) => text.includes(term))
      })

      return { book, chapters, matched: onMeta || chapters.length > 0 }
    })
    .filter((result) => result.matched),
)

const totalChars = computed(() => books.reduce((sum, book) => sum + book.chars, 0))

const summary = computed(() => {
  if (terms.value.length === 0 && activeTag.value === null) {
    return `${books.length}冊 / 約${formatChars(totalChars.value)}`
  }
  return `${results.value.length}件が該当`
})

function reset() {
  query.value = ''
  activeTag.value = null
}

function toggleTag(tag: string) {
  activeTag.value = activeTag.value === tag ? null : tag
}

/** 全角・半角と大文字・小文字の違いを吸収して比較する */
function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase()
}

function formatChars(chars: number): string {
  if (chars >= 10000) return `${(chars / 10000).toFixed(1)}万字`
  return `${chars.toLocaleString('en-US')}字`
}

function formatDate(iso: string | null): string | null {
  if (!iso) return null
  const match = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return match ? `${match[1]}/${match[2]}/${match[3]}` : null
}

function chapterCount(book: Book): string {
  return book.chapters.length > 0 ? `全${book.chapters.length}章` : '章立てのみ'
}
</script>

<template>
  <div class="book-index">
    <header class="lead">
      <h1>技術書庫</h1>
      <p>1つのトピックを1冊分の深さで。基礎から最前線まで、通して読める形にまとめています。</p>
    </header>

    <div class="search">
      <label class="visually-hidden" for="book-search">本と章をキーワードで絞り込む</label>
      <input
        id="book-search"
        v-model="query"
        type="search"
        placeholder="キーワードで絞り込む（例: RAG、拡散モデル、材料）"
        autocomplete="off"
      />
      <p class="summary" aria-live="polite">{{ summary }}</p>
    </div>

    <div v-if="allTags.length > 0" class="tags">
      <button
        v-for="tag in allTags"
        :key="tag"
        type="button"
        class="tag"
        :class="{ active: activeTag === tag }"
        :aria-pressed="activeTag === tag"
        @click="toggleTag(tag)"
      >
        {{ tag }}
      </button>
    </div>

    <ul v-if="results.length > 0" class="books">
      <li v-for="result in results" :key="result.book.slug" class="book">
        <div class="book-head">
          <h2>
            <a :href="result.book.link">{{ result.book.title }}</a>
          </h2>
          <span v-if="result.book.status" class="status">{{ result.book.status }}</span>
        </div>

        <p v-if="result.book.description" class="description">{{ result.book.description }}</p>

        <p class="meta">
          <span>{{ chapterCount(result.book) }}</span>
          <span>約{{ formatChars(result.book.chars) }}</span>
          <span v-if="formatDate(result.book.updated)">
            最終更新 {{ formatDate(result.book.updated) }}
          </span>
        </p>

        <p v-if="result.book.tags.length > 0" class="book-tags">
          <span v-for="tag in result.book.tags" :key="tag">{{ tag }}</span>
        </p>

        <div v-if="result.chapters.length > 0" class="hits">
          <p class="hits-label">該当する章</p>
          <ul>
            <li v-for="chapter in result.chapters.slice(0, 8)" :key="chapter.link">
              <a :href="chapter.link">{{ chapter.title }}</a>
              <span v-if="chapter.group" class="group">{{ chapter.group }}</span>
            </li>
          </ul>
          <p v-if="result.chapters.length > 8" class="more">
            ほか{{ result.chapters.length - 8 }}章が該当
          </p>
        </div>

        <details v-else-if="result.book.chapters.length > 0" class="toc">
          <summary>章一覧を開く</summary>
          <ul>
            <li v-for="chapter in result.book.chapters" :key="chapter.link">
              <a :href="chapter.link">{{ chapter.title }}</a>
            </li>
          </ul>
        </details>
      </li>
    </ul>

    <p v-else class="empty">
      「{{ query }}」に一致する本や章はありませんでした。
      本文まで検索する場合はナビの検索（<kbd>Ctrl</kbd> + <kbd>K</kbd>）を使ってください。
      <button type="button" class="link" @click="reset">絞り込みを解除する</button>
    </p>
  </div>
</template>

<style scoped>
.book-index {
  max-width: 52rem;
  margin: 0 auto;
  padding: 3rem 1.5rem 5rem;
}

.lead h1 {
  font-family: var(--vp-font-family-display);
  font-size: 2rem;
  line-height: 1.4;
  margin: 0 0 0.75rem;
}

.lead p {
  color: var(--vp-c-text-2);
  line-height: 1.9;
  margin: 0;
}

.search {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.75rem 1rem;
  margin: 2.5rem 0 1.25rem;
}

.search input {
  flex: 1 1 20rem;
  padding: 0.7rem 0.9rem;
  font-size: 1rem;
  font-family: inherit;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  transition: border-color 0.2s;
}

.search input:focus {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 1px;
  border-color: var(--vp-c-brand-1);
}

.summary {
  margin: 0;
  font-size: 0.875rem;
  color: var(--vp-c-text-3);
  white-space: nowrap;
}

.tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-bottom: 2rem;
}

.tag {
  padding: 0.25rem 0.7rem;
  font-size: 0.8125rem;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  cursor: pointer;
}

.tag:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.tag.active {
  color: var(--vp-c-bg);
  background: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.books {
  list-style: none;
  margin: 0;
  padding: 0;
}

.book {
  padding: 1.75rem 0;
  border-top: 1px solid var(--vp-c-divider);
}

.book:last-child {
  border-bottom: 1px solid var(--vp-c-divider);
}

.book-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.75rem;
}

.book-head h2 {
  font-family: var(--vp-font-family-display);
  font-size: 1.3rem;
  line-height: 1.5;
  margin: 0;
}

.book-head a {
  color: var(--vp-c-text-1);
  text-decoration: none;
}

.book-head a:hover {
  color: var(--vp-c-brand-1);
}

.status {
  padding: 0.1rem 0.55rem;
  font-size: 0.75rem;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  border-radius: 999px;
  white-space: nowrap;
}

.description {
  margin: 0.75rem 0 0;
  line-height: 1.9;
  color: var(--vp-c-text-2);
}

.meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 1rem;
  margin: 0.75rem 0 0;
  font-size: 0.8125rem;
  color: var(--vp-c-text-3);
}

.book-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0.6rem 0 0;
}

.book-tags span {
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
}

.book-tags span::before {
  content: '#';
  opacity: 0.6;
}

.hits {
  margin-top: 1rem;
  padding: 0.9rem 1rem;
  background: var(--vp-c-bg-soft);
  border-radius: 8px;
}

.hits-label {
  margin: 0 0 0.5rem;
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
}

.hits ul,
.toc ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.hits li,
.toc li {
  padding: 0.2rem 0;
  font-size: 0.9375rem;
  line-height: 1.7;
}

.hits a,
.toc a {
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.hits a:hover,
.toc a:hover {
  text-decoration: underline;
}

.group {
  margin-left: 0.5rem;
  font-size: 0.75rem;
  color: var(--vp-c-text-3);
}

.more {
  margin: 0.5rem 0 0;
  font-size: 0.8125rem;
  color: var(--vp-c-text-3);
}

.toc {
  margin-top: 1rem;
}

.toc summary {
  font-size: 0.875rem;
  color: var(--vp-c-text-2);
  cursor: pointer;
}

.toc summary:hover {
  color: var(--vp-c-brand-1);
}

.toc ul {
  margin-top: 0.6rem;
  padding-left: 0.25rem;
}

.empty {
  margin: 2.5rem 0 0;
  line-height: 1.9;
  color: var(--vp-c-text-2);
}

.empty kbd {
  padding: 0.05rem 0.35rem;
  font-size: 0.8125rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 4px;
}

.link {
  padding: 0;
  color: var(--vp-c-brand-1);
  background: none;
  border: none;
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
}

@media (max-width: 520px) {
  .book-index {
    padding: 2rem 1rem 4rem;
  }

  .lead h1 {
    font-size: 1.625rem;
  }

  .summary {
    white-space: normal;
  }
}
</style>
