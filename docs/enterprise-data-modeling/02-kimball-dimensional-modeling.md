---
title: 第2章 Kimball手法——ディメンショナルモデリング実践
sidebar_label: 第2章 Kimball手法
---

# 第2章 Kimball手法——ディメンショナルモデリング実践

ラルフ・キンボールが『The Data Warehouse Toolkit』で体系化したディメンショナルモデリングは、三十年を経てもDWH設計の標準語であり続けている。カラムナストレージもクラウドDWHもレイクハウスも、この語彙の上に乗っている。本章では、ファクトとディメンションという二種類のテーブルを、実務で崩れない水準まで厳密に設計していく。

## ファクトとディメンションは何が違うのか

ディメンショナルモデルの世界観は単純である。世の中の分析対象は、**測定値**と**文脈**の二つに分かれる。

ファクトテーブルは測定値を持つ。売上金額、数量、原価、所要時間。行数が多く、列は少なく、ほとんどが数値と外部キーで構成される。ディメンションテーブルは文脈を持つ。誰が、何を、いつ、どこで、どの経路で。行数は少なく、列は多く、ほとんどが文字列である。

この区別は設計の手触りとして次のように現れる。ファクトテーブルの列を増やす判断は慎重に行い、ディメンションテーブルの列は惜しまず増やす。ディメンションの列はそのまま分析の切り口になるからだ。「販売地域」「顧客ランク」「初回購入からの経過年数」といった属性を、正規化を気にせず横に並べていく。第三正規形に分解してスノーフレーク化する誘惑はあるが、可読性とクエリ性能を犠牲にしてまでやる価値は、ほとんどの場合ない。

判断に迷いやすいのが、数値なのにディメンションであるもの、文字列なのにファクトにあるものだ。単価は数値だが、商品の属性として使うならディメンション側にも置く。一方で、取引ごとに変動する単価はファクトの列である。同じ「単価」という語が二箇所に現れるのは冗長ではなく、意味が違うと考えるほうが正しい。

## 粒度を決めることが設計のすべてである

ディメンショナルモデリングで最初にやるべきことは、粒度（Grain）を一文で宣言することだ。この一文が曖昧なまま先へ進んだ設計は、必ず後で破綻する。

良い粒度の宣言は、「〜における一行は〜を表す」という形をとる。

- 「`fct_order_line` の一行は、ある注文における一つの商品明細を表す」
- 「`fct_inventory_snapshot` の一行は、ある日付・ある倉庫・ある商品の在庫残高を表す」
- 「`fct_call` の一行は、コールセンターにおける一件の通話を表す」

悪い宣言は「売上データ」「顧客の活動」のような名詞句である。一行が何かを言っていないので、集計時に何が二重計上されるのかを誰も判断できない。

粒度は、業務プロセスの最小単位まで下げるのが原則だ。日次集計済みのファクトから明細は復元できないが、明細から日次集計を作るのはいつでもできる。ストレージが安い時代に、あらかじめ集計した粗い粒度のテーブルだけを持つ理由はほとんどない。集計は必要に応じて上に積む。

粒度を決めると、その粒度で成り立つディメンションが自動的に決まる。注文明細の粒度なら、日付・顧客・商品・販売チャネル・キャンペーンは結合できる。逆に、注文明細より粗い単位でしか決まらないもの、たとえば「その月の為替レート」は、明細の粒度のファクトには直接持てない。持つとしたら、その明細の取引日時点のレートとして、値を確定させたうえで列に置くことになる。

業務プロセスのマッピングは、バスマトリクスと呼ばれる表で整理する。行にビジネスプロセス、列に共有ディメンションを置き、交差するところに印を付ける。

| ビジネスプロセス | 日付 | 顧客 | 商品 | 倉庫 | 販売員 |
| --- | --- | --- | --- | --- | --- |
| 受注 | ● | ● | ● | | ● |
| 出荷 | ● | ● | ● | ● | |
| 返品 | ● | ● | ● | ● | |
| 在庫棚卸 | ● | | ● | ● | |

この表の価値は、共有ディメンション（Conformed Dimension）を可視化するところにある。受注と出荷で別々の顧客ディメンションを作ってしまえば、二つのプロセスを横断した分析は永久にできない。同じ列は同じ意味を持つという規律が、後からの部門横断分析を可能にする。逆に言えば、バスマトリクスを描かずにマート単位で設計を始めると、部門ごとのサイロをDWHの中に再生産することになる。

## 変わってしまう属性にどう向き合うか

ディメンションの属性は変わる。顧客は引っ越し、担当営業は変わり、商品カテゴリは再編される。ここで問われるのが、過去の事実をどちらの属性で見たいのかという業務上の判断だ。これに対する定石がSCD（Slowly Changing Dimensions）である。

| 型 | やること | 過去の実績の見え方 | 主な用途 |
| --- | --- | --- | --- |
| Type 0 | 変更を無視し初期値を保持 | 常に初期値 | 初回登録日、初回チャネル |
| Type 1 | 上書きする | すべて最新値で見える | 誤記の訂正、分析に影響しない属性 |
| Type 2 | 行を追加し有効期間を持つ | 発生時点の値で見える | 組織、地域、顧客ランク |
| Type 3 | 列を追加して前回値を持つ | 現行と直前の二通りで見える | 一度きりの組織再編 |
| Type 4 | 変化の速い属性を別表に切り出す | 別表との結合で見える | 高頻度に変わる属性 |
| Type 6 | Type 1・2・3の併用 | 発生時点と最新の両方で見える | 両方の見方を業務が要求するとき |

実務で使うのはType 1とType 2、そして両者を併用するType 6にほぼ集約される。「誤記の訂正はType 1、業務上の変化はType 2」という切り分けが出発点になる。住所の綴り間違いを直したときに過去の売上が分裂したら困るが、顧客が本当に引っ越したなら、引っ越し前の売上は旧住所の実績として残ってほしい。この二つは、システムから見れば同じUPDATEであり、区別できるのは業務だけである。設計時に必ず握っておく。

Type 2のディメンションは次の形になる。

```sql
create table dim_customer (
  customer_key      bigint generated always as identity primary key, -- サロゲートキー
  customer_id       varchar(32)  not null,   -- 業務キー（ナチュラルキー）
  customer_name     varchar(200) not null,
  customer_rank     varchar(20)  not null,   -- SCD2 追跡対象
  sales_region      varchar(50)  not null,   -- SCD2 追跡対象
  postal_code       varchar(10)  not null,
  valid_from        timestamptz  not null,
  valid_to          timestamptz  not null default '9999-12-31'::timestamptz,
  is_current        boolean      not null,
  row_hash          bytea        not null    -- 追跡対象列のハッシュ
);

create unique index ux_dim_customer_natural
  on dim_customer (customer_id, valid_from);
```

ここでサロゲートキー（`customer_key`）を置くことが決定的に重要である。ファクトテーブルはこのサロゲートキーを参照する。業務キーである `customer_id` を参照してしまうと、同じ顧客の複数バージョンのうちどれを指しているのかが決まらず、Type 2が機能しない。ファクト行は「取引が起きた時点で有効だったディメンション行」を指すべきであり、その指し先を一意にするのがサロゲートキーの役割だ。

`row_hash` は、追跡対象の列をまとめてハッシュ化したものである。上流から届いた行と既存の現行行のハッシュを比べるだけで変更を検知でき、列を一つずつ比較するロジックを書かずに済む。追跡対象を増やすときはハッシュの対象列を変えるだけでよい。

更新処理は、現行行を閉じて新しい行を開く操作になる。

```sql
-- 1) 属性が変わった顧客の現行行を閉じる
update dim_customer d
   set valid_to   = s.effective_at,
       is_current = false
  from stg_customer s
 where d.customer_id = s.customer_id
   and d.is_current
   and d.row_hash <> s.row_hash;

-- 2) 新しいバージョンを開く
insert into dim_customer (
  customer_id, customer_name, customer_rank, sales_region,
  postal_code, valid_from, valid_to, is_current, row_hash
)
select s.customer_id, s.customer_name, s.customer_rank, s.sales_region,
       s.postal_code, s.effective_at, '9999-12-31'::timestamptz, true, s.row_hash
  from stg_customer s
  left join dim_customer d
    on d.customer_id = s.customer_id
   and d.is_current
 where d.customer_key is null          -- 新規顧客
    or d.row_hash <> s.row_hash;       -- 属性が変わった顧客
```

この処理で注意すべき点が三つある。

第一に、`valid_to` にNULLではなく `9999-12-31` を入れている。NULLを使うと期間判定の条件が `(valid_to is null or valid_to > :ts)` と冗長になり、結合条件にNULLが混ざる。番兵値を置けば `:ts >= valid_from and :ts < valid_to` の単純な範囲比較で済む。

第二に、`effective_at` を上流の業務的な発生時刻にするか、取り込み時刻にするかを決めておく必要がある。理想は業務時刻だが、上流が変更時刻を持たない場合は取り込み時刻で代用するほかない。その場合、DWH上の履歴は「いつ変わったか」ではなく「いつ気づいたか」を表すことになる。この差は必ず明記する。

第三に、遅延到着（late arriving）への対応だ。過去の日付で属性変更が届いた場合、単純に現行行を閉じる処理では履歴の順序が壊れる。期間の分割を伴う処理になるため、実装の複雑さを避けたいなら、上流の変更を時系列順に処理するキューを前段に置くほうが結果的に安全である。

Type 6は、Type 2の行に「現在の値」を保持する列を追加する形で実現する。

```sql
alter table dim_customer
  add column current_sales_region varchar(50);  -- 常に最新値で上書き（Type 1 的な列）
```

これで、「取引当時の地域別売上」は `sales_region` で、「現在の組織体制に引き直した売上」は `current_sales_region` で集計できる。営業組織の再編があった企業では、この二つの見方を両方求められることが多い。列名で意図がはっきり伝わるよう、`current_` のような接頭辞を規約として決めておくとよい。

## ファクトテーブルの三つの型

ファクトテーブルは、測定値の性質によって三種類に分かれる。この分類を外すと、集計が正しくならない。

**トランザクションファクト**は、事象が起きるたびに一行を追加する。注文明細、通話、クリック、入金。最も粒度が細かく、加法的な指標を持つ。全ディメンションで自由に合計できるのが強みだ。

```sql
create table fct_order_line (
  order_line_key   bigint generated always as identity primary key,
  order_date_key   int    not null references dim_date(date_key),
  customer_key     bigint not null references dim_customer(customer_key),
  product_key      bigint not null references dim_product(product_key),
  order_id         varchar(32) not null,      -- 退行ディメンション
  quantity         int            not null,
  gross_amount     numeric(18,2)  not null,
  discount_amount  numeric(18,2)  not null,
  net_amount       numeric(18,2)  not null    -- gross - discount
);
```

`order_id` のように、ディメンションテーブルを作るほどの属性を持たないキーは、ファクトに直接置く。これを退行ディメンション（Degenerate Dimension）と呼ぶ。注文単位で明細をまとめる操作に必要なので、捨ててはいけない。

**定期スナップショットファクト**は、一定間隔ごとに状態を記録する。日次の在庫残高、月末の口座残高、日次の契約者数。事象ではなく状態を測るので、行数は「期間 × 対象数」で決まり、事象が起きなくても行ができる。

重要なのは、残高のような指標が**半加法的**であることだ。在庫残高は倉庫や商品をまたいで足せるが、日付をまたいで足すと意味を失う。一月分の日次残高を合計した数値は何も表さない。時間軸では平均や期末値を使う必要がある。

```sql
create table fct_inventory_daily (
  snapshot_date_key int    not null references dim_date(date_key),
  warehouse_key     bigint not null references dim_warehouse(warehouse_key),
  product_key       bigint not null references dim_product(product_key),
  quantity_on_hand  int           not null,   -- 半加法的：日付方向に合計してはいけない
  inventory_value   numeric(18,2) not null,   -- 同上
  primary key (snapshot_date_key, warehouse_key, product_key)
);
```

この「日付方向に足してはいけない」という制約は、テーブル定義には書けない。書けるのは第4章のセマンティックレイヤーであり、そこでこの指標の集約関数を `average` や `last_value` として宣言しておけば、人間もBIツールもLLMも誤らない。半加法性はメタデータとして持つべき情報の典型例である。

**累積スナップショットファクト**は、開始から終了までのマイルストーンを持つプロセスを、一行で表現する。受注から出荷、請求、入金までのリードタイム分析がその代表だ。この型だけは、行が**更新される**。

```sql
create table fct_order_fulfillment (
  order_id            varchar(32) primary key,
  customer_key        bigint not null references dim_customer(customer_key),
  ordered_date_key    int references dim_date(date_key),
  confirmed_date_key  int references dim_date(date_key),
  shipped_date_key    int references dim_date(date_key),
  delivered_date_key  int references dim_date(date_key),
  invoiced_date_key   int references dim_date(date_key),
  paid_date_key       int references dim_date(date_key),
  days_order_to_ship  int,          -- マイルストーン到達のたびに更新される
  days_ship_to_pay    int,
  order_amount        numeric(18,2) not null
);
```

未到達のマイルストーンはNULLになり、進行するにつれて埋まっていく。どのマイルストーンで滞留しているかが一目で分かるので、業務改善の分析に強い。イミュータブルなファクトという原則には反するが、プロセス分析にはこの形が最も素直である。

三つの型は排他ではない。同じ受注プロセスに対し、明細の分析にはトランザクションファクト、リードタイムの分析には累積スナップショットファクトを並置することは普通に行われる。どちらか一方を選ぶ問題ではなく、答えたい問いの種類で使い分ける。

## この手法の限界

ディメンショナルモデルは、分析クエリの配信形式としては完成度が高い。問題は、それを組み上げる過程にある。

上流が三つのシステムからなり、それぞれが別の顧客コード体系を持ち、しかも来年また一つ増える、という状況を考えてほしい。スタースキーマを直接作ろうとすると、統合ロジックはETLの中に埋め込まれる。新しいソースが増えるたびに既存のETLに手を入れ、リグレッションテストをやり直すことになる。監査の観点でも弱い。統合の過程で捨てた値や、突合に失敗した行の記録は、どこにも残らないことが多い。

この「変更に弱い」「監査できない」という二点を正面から解こうとしたのが、次章で扱うData Vault 2.0である。

::: tip この章のポイント
- ファクトは測定値、ディメンションは文脈。ファクトの列は慎重に、ディメンションの列は惜しまず増やす
- 粒度は「一行が何を表すか」を一文で宣言する。曖昧なまま進めた設計は必ず破綻する
- バスマトリクスで共有ディメンションを可視化しないと、DWHの中に部門サイロを作り直すことになる
- SCDはType 1とType 2、そして両者を併用するType 6に集約される。誤記の訂正と業務上の変化を業務側と切り分ける
- ファクトはトランザクション・定期スナップショット・累積スナップショットの三型。残高のような半加法的な指標は、時間方向に合計してはいけない
- 半加法性のような制約はDDLに書けない。メタデータとして持つ必要がある
:::
