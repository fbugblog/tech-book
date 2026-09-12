---
title: フォワードデプロイエンジニア（FDE）実践大全
sidebar_label: この本について・目次
nav_label: FDE実践大全
order: 3
---

# フォワードデプロイエンジニア（FDE）実践大全

## 現場駆動型AI/データアプリケーション開発とビジネス価値創出の技術

顧客のオフィスの片隅に机を借り、担当者の隣に座って、その人が毎朝Excelに転記している作業を三日で自動化してみせる。そういう仕事の仕方を職種として定義したものが、フォワードデプロイエンジニア（Forward Deployed Engineer、以下FDE）である。本書は、この働き方を支える技術——データ基盤、LLMアプリケーション、API設計、運用とガバナンス——を、現場で実際に直面する制約とトレードオフの側から書いた全14章の実践書である。

チュートリアルではない。ライブラリの使い方は公式ドキュメントのほうが正確で、しかも本書より新しい。本書が扱うのは、**なぜその設計を選ぶのか**、そして**選んだ結果どのコーナーケースを踏むことになるのか**である。

## 対象読者

- FDEを目指すITコンサルタント、プロジェクトマネージャー、システムエンジニア
- 顧客の現場課題に深く入り込み、AI/データ基盤のプロトタイピングから運用定着までを推進したいエンジニア
- AIをプログラミングのパートナーとして使い、設計・検証・構造理解のレイヤーで速く価値を出したい実務家

前提知識は、何らかの言語でアプリケーションを書いた経験と、SQLの基本、そしてLLMのAPIを一度でも叩いたことがある、という程度を想定している。各分野の深い専門知識は前提にしない。

## この本の読み方

| 部 | 扱うこと |
| --- | --- |
| 第I部・FDEの思想とプラクティス（第1〜2章） | FDEという職種の輪郭と、課題を「問い」に変換する技術 |
| 第II部・エンタープライズデータ基盤（第3〜5章） | 汚れたデータに立ち向かい、モデリングし、パイプラインに載せる |
| 第III部・応用AI/LLMアーキテクチャ（第6〜8章） | RAG、構造化出力、エージェントを本番の要求水準で設計する |
| 第IV部・システム開発（第9〜11章） | API、フロントエンド、レガシー結合という三つの接続面 |
| 第V部・運用とガバナンス（第12〜13章） | 評価、可観測性、コスト、セキュリティ |
| 第VI部・キャリアとデリバリー（第14章） | AI時代の実装力と、顧客に引き継ぐという最後の仕事 |

第I部と第VI部は職能論、第II部から第V部は技術論である。すでに現場に入っている読者は第3章から読み始め、必要になったときに第1章へ戻る読み方でも筋は通る。

## コードと図について

- コード例は、動くアプリケーション一式ではなく、**判断が現れる核心部分**だけを載せている。データ構造（Pydantic、JSON Schema、SQL DDL）を優先し、グルーコードは省く
- 図はMermaid記法で描いている。アーキテクチャ図、データフロー図、シーケンス図、状態遷移図を章ごとに配置した
- 検証環境はPython 3.12、TypeScript 5.x、PostgreSQL 16を前提にしている。ライブラリのバージョンは変化が速いため、APIの細部よりも設計上の役割に注目して読んでほしい

## 目次

<!-- TOC:start -->
- [第I部・FDEの思想とプラクティス](/fde-practice/01-foundations/)
  - [第1章 フォワードデプロイエンジニアリングの原点とパラダイム](/fde-practice/01-foundations/01-fde-origin)
  - [第2章 エンタープライズ領域における課題発見と「問い」の再定義](/fde-practice/01-foundations/02-problem-discovery)
- [第II部・エンタープライズ・データ基盤とモデリング](/fde-practice/02-data-foundations/)
  - [第3章 エンタープライズ・データの泥臭い現実に立ち向かう](/fde-practice/02-data-foundations/03-enterprise-data-reality)
  - [第4章 分析とAI活用のためのデータモデリング技術](/fde-practice/02-data-foundations/04-data-modeling)
  - [第5章 モダン・パイプライン構築：dbt とオーケストレーション](/fde-practice/02-data-foundations/05-dbt-and-orchestration)
- [第III部・応用AI/LLMアーキテクチャとRAG](/fde-practice/03-ai-architecture/)
  - [第6章 実用的なLLM/RAGアーキテクチャの全貌](/fde-practice/03-ai-architecture/06-rag-architecture)
  - [第7章 コンテキスト設計とプロンプトエンジニアリングの厳密化](/fde-practice/03-ai-architecture/07-context-and-prompting)
  - [第8章 自律型AIエージェントの設計と実装パターン](/fde-practice/03-ai-architecture/08-ai-agents)
- [第IV部・システム開発・API・フロントエンド](/fde-practice/04-system-engineering/)
  - [第9章 モダンバックエンド開発とAPI設計](/fde-practice/04-system-engineering/09-backend-and-api)
  - [第10章 現場主導型フロントエンドと高速プロトタイピング](/fde-practice/04-system-engineering/10-frontend-prototyping)
  - [第11章 既存基幹システム（レガシー）とのセキュアな結合](/fde-practice/04-system-engineering/11-legacy-integration)
- [第V部・運用・ガバナンス・LLMOps](/fde-practice/05-production/)
  - [第12章 LLMアプリケーションの精度の客観的評価](/fde-practice/05-production/12-evaluations)
  - [第13章 LLMOps：オブザーバビリティ・コスト管理・セキュリティ](/fde-practice/05-production/13-llmops)
- [第VI部・FDEのキャリアとチーム・デプロイメント](/fde-practice/06-career/)
  - [第14章 コンサルタントからFDEへの移行と顧客アセット化](/fde-practice/06-career/14-career-and-enablement)
<!-- TOC:end -->

::: warning この版について
本書はドラフトである。製品名・サービス仕様・価格体系は執筆時点（2026年）の情報にもとづく。とくにLLM関連のツールチェーンは数か月単位で変化するため、採用判断の前に一次情報を確認してほしい。事実確認が未了の記述は [REVIEW.md](https://github.com/fbugblog/tech-book/blob/main/REVIEW.md) に残している。
:::
