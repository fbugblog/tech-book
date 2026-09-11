---
title: 第2章 レイヤード・アーキテクチャ設計パターン——Staging・Intermediate・Marts
sidebar_label: 第2章 レイヤード・アーキテクチャ
---

# 第2章 レイヤード・アーキテクチャ設計パターン——Staging・Intermediate・Marts

dbtを導入したプロジェクトが失敗する典型的なパターンは、技術的な問題ではない。モデルの置き場所を決めずに書き始めることである。

最初の数週間は問題なく進む。モデルが30個を超えたあたりから、DAGが蜘蛛の巣のようになる。マートが別のマートを参照し、ステージング相当のモデルが下流から直接叩かれ、同じ集計が三か所に現れる。この状態になると、あるモデルを直したときの影響範囲が読めなくなり、誰も触りたがらなくなる。

これを防ぐのがレイヤード・アーキテクチャである。モデルを役割ごとの層に分け、層をまたぐ参照の向きを制限する。本章では、Staging・Intermediate・Martsという三層の設計を、それぞれの判断基準まで含めて扱う。

## 三層に分ける理由

まず、なぜ三層なのかを押さえておきたい。この分割は、変換処理の中で性質の異なる三つの仕事を切り分けたものである。

第一の仕事は、源泉データを「dbtで扱える形」に整えることだ。カラム名がバラバラで、日付が文字列で入っていて、真偽値が `'Y'` と `'N'` の世界を、統一されたルールの中に引き込む。ここに**ビジネスロジックは一切入らない**。これがStaging層である。

第二の仕事は、複雑なビジネスロジックを扱いやすい単位に分解することだ。五つのテーブルを結合して顧客ごとの生涯価値を出すような処理を、一つの巨大なクエリではなく、意味のある中間成果物の連鎖として書く。これがIntermediate層である。

第三の仕事は、利用者に届ける形へ整えることだ。BIツールが速く引けるように、あるいはAIアプリケーションが意味を取り違えないように、粒度とカラム構成を決める。これがMarts層である。

この三つを分けておくと、変更の影響が層の中に閉じやすくなる。源泉のカラム名が変わればStagingだけを直せばよい。集計の定義が変わればMartsだけを見ればよい。層をまたぐ参照のルールがこれを担保する。

> 層の設計とは、「どこを直せばよいか」が事前に分かる構造を作ることである。

## 参照のルール

三層構造を機能させるルールは、次の三つに集約できる。

**源泉テーブルを `source()` で参照してよいのはStagingモデルだけ**である。Intermediate層やMarts層から生テーブルを直接叩くと、源泉の変更が全層に波及する。Stagingが唯一の入口になることで、外界との接点が一か所に閉じる。

**一つの源泉テーブルに対応するStagingモデルは一つだけ**にする。`stg_shop__orders` が二つあってはならない。複数あると「どちらが正しいか」問題が層の入口で発生する。

**参照は下流方向にしか流れない**。StagingはStagingを参照せず、MartsはMartsを参照しない。特にマート同士の参照は、DAGが複雑化する最大の原因になる。共通部分が出てきたら、それはIntermediate層へ切り出すべきロジックである。

ディレクトリ構成は、この層をそのまま反映させる。

```text
models/
├── staging/
│   └── shop/
│       ├── _shop__sources.yml     # 源泉の定義
│       ├── _shop__models.yml      # Stagingモデルの定義とテスト
│       ├── stg_shop__orders.sql
│       ├── stg_shop__order_items.sql
│       └── stg_shop__customers.sql
├── intermediate/
│   └── finance/
│       ├── _int_finance__models.yml
│       └── int_orders_joined_to_payments.sql
└── marts/
    ├── finance/
    │   ├── _finance__models.yml
    │   ├── fct_orders.sql
    │   └── dim_customers.sql
    └── marketing/
        └── fct_campaign_performance.sql
```

Staging層は源泉システムごと、Intermediate層とMarts層はビジネス領域ごとに分けるのが定石である。前者は技術的な都合で、後者は組織の関心で区切られている、と考えると腑に落ちる。

## Staging層——退屈であることが正しさである

Staging層のモデルは、一つの源泉テーブルに一対一で対応する薄い変換層である。ここで行ってよい操作は、次の範囲に限定する。

- カラム名の変更（命名規則への統一）
- 型変換（文字列の日付を日付型へ、など）
- 単純な計算（セント単位の金額を円単位へ、など）
- 真偽値への正規化（`'Y'` / `'N'` を `true` / `false` へ）

逆に、**結合と集計は行わない**。ここで `join` を書いた瞬間に、Staging層は「源泉の素直な写し」ではなくなり、下流から再利用しにくくなる。

```sql
-- models/staging/shop/stg_shop__orders.sql
with source as (
    select * from {{ source('shop', 'orders') }}
),

renamed as (
    select
        -- 識別子
        id                                as order_id,
        user_id                           as customer_id,

        -- 文字列
        upper(status)                     as order_status,

        -- 数値
        amount_cents / 100.0              as order_amount,

        -- 真偽値
        case when is_gift = 'Y' then true else false end as is_gift,

        -- 日時
        cast(created_at as timestamp)     as created_at,
        cast(updated_at as timestamp)     as updated_at

    from source
)

select * from renamed
```

`with source as (select * from ...)` で始め、`renamed` で整形し、最後に `select * from renamed` で締める。この定型は、どのStagingモデルを開いても構造が同じになるという利点を生む。レビュー時に読む場所が決まるのは、想像以上に効いてくる。

カラムを種類ごとに並べ、コメントで区切っているのも意図がある。源泉に新しいカラムが増えたとき、どこに足すかで迷わない。

命名規則も揃えておく。`stg_<源泉システム>__<エンティティ>` という形式で、区切りはアンダースコア二つである。源泉名とエンティティ名の境界が視覚的に分かるため、`stg_shop_order_items` のような曖昧さが消える。

カラム名では、主キーを `<エンティティ>_id`、真偽値を `is_` か `has_` で始め、日時を `_at`、日付を `_date` で終える、といった規則を決めておく。この規則が効いてくるのは、モデルが100個を超えてからである。

Stagingのマテリアライゼーションは、原則 `view` でよい。実体を持たないため保存コストがかからず、常に最新の源泉を反映する。源泉が巨大で下流から何度も参照されるケースだけ、`table` を検討する。

```yaml
# dbt_project.yml
models:
  my_analytics:
    staging:
      +materialized: view
    intermediate:
      +materialized: ephemeral
    marts:
      +materialized: table
```

## Intermediate層——複雑さを分解する場所

Intermediate層は、三層の中で最も判断が要る。「置くべきかどうか」に明確な基準がないからである。

指針はこうだ。**Intermediate層は、マートを読みやすくするために存在する**。マートのSQLが読めなくなってきたら、その中の意味のあるまとまりを切り出す。逆に言えば、マートが素直に書けているならIntermediate層は要らない。層があるから埋めなければならない、という発想は捨てる。

切り出す単位は、行数ではなく意味で決める。よくあるのは次の三つのパターンである。

**複数ソースの結合**は、最も典型的な用途だ。注文と支払いを結合した状態は、複数のマートから使われる。これを `int_orders_joined_to_payments` として切り出せば、結合条件の修正は一か所で済む。

**粒度の変更**も切り出す価値がある。明細行を注文単位に集約する、イベントログをセッション単位にまとめる、といった処理である。集約は間違いが混入しやすく、単体で確かめられる形にしておくと安心できる。

**ファンアウトの解消**は見落とされやすい。一対多の結合を含んだまま集計すると、金額が多重に数えられる。この危険な部分だけを切り出し、そこにテストを当てる。

```sql
-- models/intermediate/finance/int_orders_joined_to_payments.sql
with orders as (
    select * from {{ ref('stg_shop__orders') }}
),

payments as (
    select * from {{ ref('stg_shop__payments') }}
),

payment_totals as (
    select
        order_id,
        sum(case when payment_status = 'SUCCESS' then payment_amount end) as paid_amount,
        max(payment_at)                                                   as last_payment_at,
        count(*)                                                          as payment_count
    from payments
    group by 1
),

final as (
    select
        orders.order_id,
        orders.customer_id,
        orders.order_amount,
        orders.created_at,
        coalesce(payment_totals.paid_amount, 0) as paid_amount,
        payment_totals.last_payment_at,
        coalesce(payment_totals.payment_count, 0) as payment_count
    from orders
    left join payment_totals
        on orders.order_id = payment_totals.order_id
)

select * from final
```

支払いを先に注文単位へ集約してから結合している点が肝である。順序を逆にすると、複数回払いの注文で金額が膨らむ。この「集約してから結合する」型は、ファンアウトを防ぐ基本形として覚えておく価値がある。

命名は `int_<エンティティ>_<動詞の過去分詞>` とする。`int_orders_joined_to_payments`、`int_events_sessionized` のように、何をした結果なのかが名前から読める。

マテリアライゼーションは `ephemeral` を既定にする。実体を作らずCTEとして下流に埋め込まれるため、中間テーブルでウェアハウスが散らからない。ただし、複数のマートから参照されて同じ計算が繰り返される場合や、デバッグのために中身を直接見たい場合は `table` にする。`ephemeral` は実体がないぶん、コンパイル後のSQLが読みにくくなるという代償がある。

Intermediate層のモデルは、外部に公開しない。BIツールから直接参照されると、リファクタリングの自由が失われる。dbtには公開範囲を宣言する仕組みがあり、意図を機械可読な形で残せる。

```yaml
models:
  - name: int_orders_joined_to_payments
    access: private
    description: 注文に支払い実績を突き合わせた中間モデル。マートからのみ参照する。
```

## Marts層——利用者との契約

Marts層は、データ基盤の外に対する公開面である。ここに置いたテーブルのカラム名や粒度は、BIのダッシュボード、レポート、AIアプリケーションに埋め込まれ、簡単には変えられなくなる。つまりMartsは実質的なAPIであり、設計は契約だと考えるべきである。

構成の基本はディメンショナルモデリングに倣う。事実（ファクト）と実体（ディメンション）を分ける考え方だ。

**ファクトテーブル**（`fct_` 接頭辞）は、起きた出来事を一行一件で持つ。注文、支払い、クリック、発送。行は基本的に追加されるだけで、更新されない。数値の指標と、ディメンションへの外部キーを持つ。

**ディメンションテーブル**（`dim_` 接頭辞）は、実体の現在の姿を一行一件で持つ。顧客、商品、店舗。属性が中心で、更新される。

```sql
-- models/marts/finance/fct_orders.sql
{{ config(materialized='table') }}

with orders as (
    select * from {{ ref('int_orders_joined_to_payments') }}
),

final as (
    select
        -- 主キー
        order_id,

        -- 外部キー
        customer_id,

        -- 日時
        created_at as ordered_at,
        last_payment_at,

        -- 指標
        order_amount,
        paid_amount,
        order_amount - paid_amount as outstanding_amount,

        -- 区分
        case
            when paid_amount >= order_amount then 'paid'
            when paid_amount > 0             then 'partially_paid'
            else 'unpaid'
        end as payment_state

    from orders
)

select * from final
```

マートを設計するときに繰り返し出てくる判断が三つある。

一つ目は、**どこまで非正規化するか**である。BIツールでの利用が中心なら、顧客名や商品名をファクトに持たせてしまうほうが、結合なしで引けて速い。一方で、属性を持たせるほど更新時の再構築コストが上がる。「ダッシュボードのフィルターで使われる属性だけを持たせる」くらいが実務的な落としどころになる。

二つ目は、**粒度を何にするか**である。一行が何を表すのかを、モデルの説明文に必ず書く。「一行 = 一注文」と書かれていれば、利用者が `count(*)` の意味を誤解しない。粒度が曖昧なマートは、必ず数字の食い違いを生む。

三つ目は、**指標をどこで計算するか**である。BIツール側で計算式を持たせると、ツールごとに定義がずれる。マートに列として持たせると、定義は一つになるが、組み合わせの数だけ列が増える。基本の指標はマートに持たせ、比率や期間比較のような派生指標はBI側かセマンティックレイヤーに任せる、という分担が扱いやすい。

## AIアプリケーション向けのマート設計

近年は、マートの利用者がBIツールだけではなくなった。LLMを使ったアプリケーションが、テキストから生成したSQLでマートを叩く構成が現実的な選択肢になっている。この場合、設計の要件が少し変わる。

最も効くのは、**説明文を書き切ること**である。人間は `amt` というカラム名を見て文脈から金額だと推測するが、モデルは説明文に書かれたことしか手がかりにできない。dbtのYAMLに書いた `description` は、そのままモデルへ渡せるメタデータになる。

次に、**曖昧な名前を排除すること**だ。`status` のようなカラムが複数のテーブルにあり、それぞれ意味が違う状態は、生成されるSQLの誤りに直結する。`order_status`、`payment_status` のように、単体で読める名前にしておく。

さらに、**取りうる値を宣言すること**が効く。`accepted_values` テストは品質チェックであると同時に、「このカラムは `paid` / `partially_paid` / `unpaid` のいずれかを取る」というドキュメントでもある。

```yaml
models:
  - name: fct_orders
    description: |
      注文の事実テーブル。一行が一注文を表す。
      金額は日本円、税込。キャンセル済みの注文は含まない。
    columns:
      - name: order_id
        description: 注文の一意な識別子。
        tests: [unique, not_null]
      - name: payment_state
        description: |
          支払いの充足状態。
          paid=全額入金済み、partially_paid=一部入金、unpaid=未入金。
        tests:
          - accepted_values:
              values: ['paid', 'partially_paid', 'unpaid']
```

「税込か税抜か」「キャンセル分を含むか」といった前提は、人間相手でも取り違えの元になる。書いておけば、どちらの利用者にも効く。AI向けの設計として特別なことをするというより、これまで暗黙にしてきた前提を明文化する作業だと捉えるほうが正しい。

::: tip この章のポイント
- 三層構造は、源泉の正規化・ロジックの分解・利用者向けの整形という、性質の異なる仕事を分離したものである
- 源泉を `source()` できるのはStagingだけ、源泉一つにStagingモデル一つ、参照は下流方向のみ。この三つのルールが層構造を担保する
- Stagingは結合も集計もしない退屈な層でよい。定型構造と命名規則を揃えることが、100モデルを超えたときに効いてくる
- Intermediateは「マートを読みやすくするため」に置く。層があるから埋めるのではなく、必要になったら切り出す
- Martsは実質的なAPIである。粒度を明記し、曖昧な名前を避け、取りうる値を宣言しておくと、BIにもAIアプリケーションにも効く
:::
