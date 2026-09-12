# FBUG 技術書庫

技術書・技術記事を Markdown で書き、[VitePress](https://vitepress.dev/) で1つのサイトとして
公開するためのリポジトリです。トップページの下にトピック（1トピック＝1冊分）を足していける
構成にしています。

- 執筆ルール: [WRITING.md](./WRITING.md)
- 添削メモと未確認事項: [REVIEW.md](./REVIEW.md)

## 収録トピック

| トピック | 内容 | 状態 |
| --- | --- | --- |
| `docs/ai-for-science/` | AI for Science — 深掘り全30章 | 本文あり（ドラフト） |
| `docs/llm-app-development/` | 生成AI/LLMアプリケーション開発 — 目次案 | 章立てのみ |
| `docs/langchain-llamaindex/` | LangChain & LlamaIndex 応用アプリケーションアーキテクチャ — 全5章 | 本文あり（ドラフト） |
| `docs/llm-rag-evaluation/` | LLM / RAGシステムの評価と品質保証 — 全5章 | 本文あり（ドラフト） |
| `docs/fde-practice/` | フォワードデプロイエンジニア（FDE）実践大全 — 全14章＋付録 | 本文あり（ドラフト） |

## セットアップ

```bash
npm install
```

Node.js 20 以降が必要です（`.nvmrc` は 22 を指定しています）。

## よく使うコマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | ローカルサーバーを起動してプレビュー（保存で即反映） |
| `npm run build` | 静的サイトを `docs/.vitepress/dist/` に生成 |
| `npm run preview` | ビルド結果をローカルで確認 |
| `npm run lint` | textlint で日本語を校正 |
| `npm run lint:fix` | 表記ゆれなど自動修正できるものを直す |
| `npm run count` | トピック・章ごとの文字数と原稿用紙換算を集計 |
| `npm run toc` | 目次ブロック（`<!-- TOC:start -->`）をファイル構成から再生成 |
| `npm run new:topic -- <slug> "<タイトル>"` | 新しいトピックの入口ページを作る |
| `npm run new:page -- <ディレクトリ> <slug> "<タイトル>"` | ページのひな形を作る（連番は自動） |

## ディレクトリ構成

```
.
├── docs/
│   ├── index.md                    # サイトのトップページ（本の索引＋検索）
│   ├── ai-for-science/             # トピック1
│   │   ├── index.md                # この本について＋目次
│   │   ├── 01-foundations/         # 第I部
│   │   │   ├── index.md            # 部の扉ページ（サイドバーの見出しになる）
│   │   │   └── 01-....md           # 各章
│   │   ├── 02-applications/        # 第II部
│   │   └── 03-frontier/            # 第III部
│   ├── llm-app-development/        # トピック2
│   ├── langchain-llamaindex/       # トピック3
│   ├── llm-rag-evaluation/         # トピック4
│   ├── fde-practice/               # トピック5（第I部〜第VI部＋付録）
│   ├── public/                     # 図版・ファビコン（/images/... で参照）
│   └── .vitepress/
│       ├── config.mts              # サイト設定（タイトル・検索・フォントなど）
│       ├── pages.mts               # docs/ を読むための共通処理
│       ├── sidebar.mts             # ナビと目次の自動生成
│       ├── books.data.mts          # トップページの索引データ（ビルド時に収集）
│       └── theme/
│           ├── BookIndex.vue       # 索引＋キーワード絞り込み
│           └── custom.css          # 配色とタイポグラフィ
├── scripts/                        # 執筆補助スクリプト
├── .textlintrc.json                # 校正ルール
├── prh.yml                         # 用語辞書（表記ゆれの統一）
└── .github/workflows/              # CI（校正・ビルド）と GitHub Pages へのデプロイ
```

**トップページの索引・ナビ・サイドバーは、すべて `docs/` のファイル構成から自動生成されます。**
ページを追加しても設定ファイルを編集する必要はありません。

- 並び順はファイル名の数字プレフィックス（`01-`, `02-` …）で決まる
- サイドバーの表示名は frontmatter の `sidebar_label`、なければ `title`
- トピックの並び順は入口ページ（`index.md`）の frontmatter の `order`

トップページの索引カードに出る情報は、トピックの `index.md` の frontmatter で決まります。

| フィールド | 索引での使われ方 |
| --- | --- |
| `title` | カードの見出し |
| `nav_label` | ナビゲーションに出る短い名前 |
| `description` | カードの説明文（省略すると本文の最初の段落を使う） |
| `status` | 「本文あり（ドラフト）」などの進捗ラベル |
| `tags` | タグ絞り込みと検索キーワード |

章数・文字数・最終更新日は自動で算出されます（最終更新日は git の履歴から取得）。
索引の検索ボックスは、本のタイトル・説明・タグ・**章タイトル**を対象に絞り込みます。
本文まで検索したい場合はナビの検索（<kbd>Ctrl</kbd> + <kbd>K</kbd>）を使います。

## トピックを追加する

```bash
# 1. 入口ページを作る（order は既存トピックの次の番号が入る）
npm run new:topic -- rust-cli "Rustで書くCLIツール"

# 2. ページを足す（先頭の連番は自動）
npm run new:page -- rust-cli getting-started "はじめてのビルド"

# 3. 目次ブロックを更新
npm run toc
```

章を部（第I部・第II部…）で束ねたい場合は、トピックの下にディレクトリを作り、その中に
`index.md`（部の扉ページ）と各章のファイルを置きます。`docs/ai-for-science/` がその形です。

トップページの索引には自動で並ぶので、`docs/index.md` を編集する必要はありません。

## GitHub Pages で公開する

1. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする
   （初回だけ必要な手動設定。ワークフローの `GITHUB_TOKEN` では Pages サイトを新規作成できないため、
   これを省くと `Get Pages site failed` でデプロイが失敗する）
2. `main` に push すると `.github/workflows/deploy.yml` が動き、
   `https://<ユーザー名>.github.io/<リポジトリ名>/` に公開される

プライベートリポジトリの Pages は GitHub Pro 以上が必要です。無料プランで公開する場合は
リポジトリを public にしてください。

サブパス（`/<リポジトリ名>/`）は CI が `VITEPRESS_BASE` で自動的に渡すため、設定は不要です。
独自ドメインや `<ユーザー名>.github.io` リポジトリの場合もそのまま動きます。

## 執筆の進め方

章ごとにブランチを切り、Pull Request でセルフレビューしてから `main` にマージすると、
差分単位で読み返せて推敲しやすくなります。CI で textlint とビルドが走るので、崩れた原稿が
`main` に入るのを防げます。
