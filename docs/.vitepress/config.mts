import { defineConfig } from 'vitepress'
import { topicNav, topicSidebars } from './sidebar.mts'

/**
 * サイトの基本情報。まずここを書き換えてください。
 */
const SITE = {
  title: 'FBUG 技術書庫',
  description: '技術書・技術記事を書きためていく場所。1トピック1書棚で、読み物として通して読めるようにまとめています。',
  author: 'FBUG',
  repo: 'https://github.com/fbugblog/tech-book',
}

/**
 * GitHub Pages のプロジェクトページ（https://<user>.github.io/<repo>/）で公開する場合、
 * サブパスを base に指定する必要があります。CI 側で VITEPRESS_BASE を渡しています
 * （.github/workflows/deploy.yml 参照）。ローカル開発では常に '/' になります。
 */
const base = process.env.VITEPRESS_BASE || '/'

export default defineConfig({
  lang: 'ja-JP',
  title: SITE.title,
  description: SITE.description,
  base,
  cleanUrls: true,
  lastUpdated: true,
  metaChunk: true,

  head: [
    // 本文用の明朝体と、ラベル用のゴシック体（日本語はサブセット配信されるので必要な字形だけ届く）
    ['link', { rel: 'preconnect', href: 'https://fonts.googleapis.com' }],
    ['link', { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' }],
    [
      'link',
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Shippori+Mincho:wght@700&family=Noto+Serif+JP:wght@400;600&family=Zen+Kaku+Gothic+New:wght@400;500&display=swap',
      },
    ],
    ['link', { rel: 'icon', type: 'image/svg+xml', href: `${base}favicon.svg` }],
    ['meta', { name: 'author', content: SITE.author }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: SITE.title }],
    ['meta', { property: 'og:description', content: SITE.description }],
  ],

  markdown: {
    lineNumbers: true,
    // 日本語の見出しはそのままだとアンカーが崩れやすいので、見出し ID は
    // frontmatter や {#custom-id} で明示するのを推奨（付録C 参照）。
    container: {
      tipLabel: 'ヒント',
      warningLabel: '注意',
      dangerLabel: '危険',
      infoLabel: '補足',
      detailsLabel: '詳細',
    },
    image: {
      lazyLoading: true,
    },
  },

  themeConfig: {
    outline: { level: [2, 3], label: 'このページの目次' },
    nav: [...topicNav(), { text: 'GitHub', link: SITE.repo }],
    sidebar: topicSidebars(),
    search: {
      provider: 'local',
      options: {
        // 日本語は単語境界がないため、部分一致で引けるようにしておく
        miniSearch: {
          searchOptions: {
            prefix: true,
            fuzzy: 0.2,
          },
        },
        translations: {
          button: { buttonText: '検索', buttonAriaLabel: '検索' },
          modal: {
            displayDetails: '詳細を表示',
            resetButtonTitle: '検索条件をリセット',
            backButtonTitle: '戻る',
            noResultsText: '見つかりませんでした:',
            footer: {
              selectText: '選択',
              selectKeyAriaLabel: 'Enter',
              navigateText: '移動',
              navigateUpKeyAriaLabel: '上',
              navigateDownKeyAriaLabel: '下',
              closeText: '閉じる',
              closeKeyAriaLabel: 'Esc',
            },
          },
        },
      },
    },
    editLink: {
      pattern: `${SITE.repo}/edit/main/docs/:path`,
      text: 'このページを編集する',
    },
    docFooter: { prev: '前へ', next: '次へ' },
    darkModeSwitchLabel: 'テーマ',
    lightModeSwitchTitle: 'ライトモードに切り替え',
    darkModeSwitchTitle: 'ダークモードに切り替え',
    sidebarMenuLabel: '目次',
    returnToTopLabel: 'ページの先頭へ',
    lastUpdated: {
      text: '最終更新',
      formatOptions: { dateStyle: 'medium', timeStyle: undefined },
    },
    footer: {
      message: `原稿は <a href="${SITE.repo}">GitHub</a> で管理しています。`,
      copyright: `© ${new Date().getFullYear()} ${SITE.author}`,
    },
  },
})
