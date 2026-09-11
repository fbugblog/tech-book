---
title: 第3章 Data Vault 2.0——エンタープライズ変更に強いアーキテクチャ
sidebar_label: 第3章 Data Vault 2.0
---

# 第3章 Data Vault 2.0——エンタープライズ変更に強いアーキテクチャ

前章の最後に挙げた二つの弱点——上流の追加や変更に弱いこと、統合の過程が監査できないこと——は、ディメンショナルモデリングの欠陥ではない。配信形式に統合の責務まで負わせていることの帰結である。ダン・リンステッドが体系化したData Vaultは、この責務を分離する。統合層はData Vaultで受け、配信層はKimballで出す。本章では、その統合層の組み方を扱う。

## ビジネスキー・関係・記述を分解する

Data Vaultの発想は、テーブルを三つの役割に切り分けるところにある。

- **Hub**：ビジネスキーの一覧。「この会社にとって顧客とは何か」の定義そのもの
- **Link**：Hub同士の関係。顧客と商品が注文という関係で結ばれた、という事実
- **Satellite**：HubやLinkに付随する記述的属性と、その履歴

なぜこう分けるのか。三つの要素は、変化の速度がまったく違うからである。ビジネスキーはめったに変わらない。関係は業務の再編で変わる。属性は日々変わり、上流システムごとに違う。変化の速度が違うものを同じテーブルに同居させると、遅い部分が速い部分に引きずられて壊れる。分けておけば、属性が増えてもSatelliteを足すだけで済み、既存のテーブルには一切触らない。

Hubの定義はこうなる。

```sql
create table hub_customer (
  customer_hk    bytea       primary key,   -- ビジネスキーのハッシュ
  customer_bk    varchar(64) not null,      -- ビジネスキー（業務上の顧客番号）
  load_date      timestamptz not null,      -- 最初に観測した時刻
  record_source  varchar(64) not null       -- 由来（例: 'crm.customers'）
);
```

Hubには記述的な属性を一切置かない。顧客名も住所も入らない。入るのは、キーそのものと、それをいつどこで初めて見たかという事実だけである。この禁欲さがData Vaultの肝で、これによってHubは上流の変更から完全に切り離される。

`customer_hk` はビジネスキーから決定的に計算するハッシュキーである。Data Vault 2.0が1.0から変えた最大の点がここで、シーケンス採番をやめてハッシュにしたことにより、複数のテーブルを**並列に、依存関係なしに**ロードできるようになった。顧客Hubのロードが終わるのを待たずに注文Satelliteをロードできる。分散環境ではこの差が効く。

```sql
-- ハッシュキーの計算規約を決めておく（大文字化・トリム・区切り文字）
-- 例: sha256(upper(trim(customer_bk)))
select encode(sha256(convert_to(upper(trim(c.customer_no)), 'UTF8')), 'hex');
```

規約は文書化し、全テーブルで同一の実装を使う。トリムの有無や区切り文字が揺れると、同じキーから別のハッシュが生まれ、統合が静かに壊れる。

Linkは関係を表す。

```sql
create table lnk_order (
  order_hk        bytea       primary key,  -- 構成キーの結合ハッシュ
  customer_hk     bytea       not null references hub_customer(customer_hk),
  product_hk      bytea       not null references hub_product(product_hk),
  order_bk        varchar(64) not null,     -- 注文番号
  load_date       timestamptz not null,
  record_source   varchar(64) not null
);
```

Linkは常に多対多として設計する。現在の業務が一対多であっても、である。これは冗長に見えるが、業務ルールがモデルの構造に焼き込まれるのを防ぐための規律だ。「一人の顧客は一つの営業担当にしか紐づかない」という前提で一対一のLinkを作った半年後に、共同担当制が導入されてモデルを作り直す、という事態を避けられる。カーディナリティの制約は構造ではなく、後段のビジネスルールで表現する。

Satelliteが属性と履歴を持つ。

```sql
create table sat_customer_crm (
  customer_hk    bytea       not null references hub_customer(customer_hk),
  load_date      timestamptz not null,
  load_end_date  timestamptz,               -- 次のバージョンが来たら閉じる
  hash_diff      bytea       not null,      -- 属性全体のハッシュ（差分検知用）
  record_source  varchar(64) not null,
  customer_name  varchar(200),
  customer_rank  varchar(20),
  postal_code    varchar(10),
  primary key (customer_hk, load_date)
);
```

主キーがハッシュキーとロード日時の組であることに注目してほしい。同じ顧客の属性が変わるたびに行が増える。上書きは起きない。`hash_diff` を使って前回の行と比較し、変化があったときだけ追加する。

## 監査可能性と、複数ソースの安全な統合

Data Vaultの設計原則のうち、実務で最も価値を生むのは「**上流から来たものを、解釈せずにそのまま残す**」という点である。データの修正、名寄せ、コード変換といった加工は、Raw Vaultには一切入れない。入るのはロード日時と由来の記録だけだ。

この原則がもたらす帰結が二つある。

一つは、監査可能性である。「この数字はどこから来たのか」という問いに対し、`record_source` と `load_date` をたどるだけで答えられる。金融機関や医療のように、当局や監査法人に説明責任を負う領域では、これが決定的な価値を持つ。加工済みの値しか残っていないDWHでは、変換ロジックのバグが発覚したときに、過去の正しい値を復元できない。Raw Vaultが残っていれば、変換を作り直して再構築できる。

もう一つは、再現性である。Raw Vaultは追記のみで、過去の行が書き換わらない。つまり、ある時点でのDWHの状態をいつでも再現できる。これは機械学習の学習データ生成で効く。「モデルを学習させたときに見えていたデータ」を再現できなければ、モデルの挙動を後から検証できないからだ。

複数ソースの統合は、Satelliteをソースごとに分けることで扱う。

```text
hub_customer
 ├── sat_customer_crm        （CRM 由来の氏名・ランク）
 ├── sat_customer_billing    （会計システム由来の請求先情報）
 └── sat_customer_support    （サポートシステム由来の連絡先）
```

三つのシステムが同じ顧客について異なる名前を持っていても、どれかを正としてマージする必要はない。Raw Vaultでは三つとも保持し、どちらを採用するかという判断は後段に置く。この判断を入れる場所がビジネスヴォールト（Business Vault）で、そこに「Same-As Link」や導出Satelliteを置く。

```sql
-- 名寄せの結果を、Raw Vault を汚さずに別テーブルとして持つ
create table sal_customer (
  same_as_hk       bytea      primary key,
  master_hk        bytea      not null references hub_customer(customer_hk), -- 代表
  duplicate_hk     bytea      not null references hub_customer(customer_hk), -- 重複
  match_rule       varchar(64) not null,   -- 例: 'name_addr_fuzzy_v3'
  match_score      numeric(5,4),
  load_date        timestamptz not null,
  record_source    varchar(64) not null
);
```

名寄せのルール名とスコアを列として持っているところが要点だ。名寄せは統計的な判断であり、後から見直される。ルールをバージョン付きで記録しておけば、「v2のルールで集計した先月の数字」と「v3で集計した数字」の差を説明できる。名寄せロジックをETLのコードの中に埋めてしまうと、この説明ができない。

第1章で挙げた「同じ取引先が三つのシステムで別表記になっている」という現場の問題は、ここで構造的に扱われる。重要なのは、正解を一つ決めることではなく、判断を明示的なデータとして外に出すことである。

## 柔軟性とクエリ複雑性のトレードオフ

ここまで読んで、当然の疑問が湧くはずだ。テーブルが増えすぎないか。

増える。顧客の名前と最新の注文金額を取るだけで、Hub・Link・Satelliteを四つも五つも結合する羽目になる。ディメンショナルモデルなら二つのテーブルの結合で済む問いだ。この結合の多さがData Vault最大のコストであり、「Data Vaultは複雑すぎる」という批判の実体でもある。

対処は三層に分けて考える。

**第一に、レイヤーを分ける。** Data Vaultは分析者が直接クエリする層ではない。統合層であり、その上にKimballのスタースキーマを情報マートとして構築する。分析者とBIツールとLLMが触るのはマート側だけにする。この分担が崩れて「Data Vaultを直接BIから叩く」構成にすると、確実に破綻する。

```text
ソースシステム
   ↓  （解釈せず取り込む）
Raw Vault          … Hub / Link / Satellite
   ↓  （ビジネスルールを適用）
Business Vault     … 名寄せ、導出指標、PIT / Bridge
   ↓  （配信形式へ変換）
Information Mart   … スタースキーマ、ワイドテーブル
   ↓
BI / セマンティックレイヤー / AI
```

**第二に、PITテーブルとBridgeテーブルを置く。** PIT（Point-In-Time）テーブルは、複数のSatelliteのうち、ある時点で有効だった行のキーをあらかじめ束ねておくテーブルである。時点指定の結合条件を毎回書く代わりに、PITと等値結合するだけで済むようになる。

```sql
create table pit_customer (
  customer_hk            bytea       not null,
  snapshot_date          date        not null,
  sat_crm_load_date      timestamptz,     -- その時点で有効だった CRM Satellite の行
  sat_billing_load_date  timestamptz,     -- 同、請求 Satellite の行
  primary key (customer_hk, snapshot_date)
);
```

Bridgeテーブルは、Hub・Link・Hubと連なる経路をあらかじめ展開しておくもので、多段のLink結合を一段に潰す。どちらも純粋な性能最適化であり、削除してもモデルの意味は変わらない。この「消しても壊れない」という性質が重要で、PIT/Bridgeは必要になってから足せばよい。

**第三に、自動生成に任せる。** Data Vaultのロード処理は、パターンが厳格に決まっている。Hubのロード、Linkのロード、Satelliteのロードはそれぞれ一種類のテンプレートしかない。だから、メタデータからSQLを生成できる。手書きでHubのINSERT文を百本書くのは設計の失敗であり、テーブル定義のメタデータを持って生成するのが正しい進め方だ。

```yaml
# ロード定義のメタデータ例。ここから DDL と ロード SQL の両方を生成する
- target: hub_customer
  type: hub
  business_key: [customer_no]
  sources:
    - { name: crm.customers,     column_map: { customer_no: cust_cd } }
    - { name: billing.customers, column_map: { customer_no: customer_code } }

- target: sat_customer_crm
  type: satellite
  parent: hub_customer
  source: crm.customers
  attributes: [customer_name, customer_rank, postal_code]
```

この形にしておくと、上流に新しいシステムが加わったときの作業が、メタデータへの追記だけになる。既存のテーブルにもロード処理にも触らない。これがData Vaultの言う「変更に強い」の実体であり、抽象的な設計思想の話ではなく、作業量の話である。

## どちらを選ぶかではなく、どこで使うか

Data Vaultは万能ではない。むしろ、次の条件が揃わないなら採用しないほうがよい。

- ソースシステムが単一で、今後増える見込みがない
- 監査要件がない
- チームの人数が少なく、テーブル数の増加が運用の負担に直結する

これらに当てはまる小規模な環境では、素直にディメンショナルモデルを組むほうが速く、保守も楽である。Data Vaultが効くのは、ソースが十を超え、組織再編でシステムが入れ替わり、規制当局への説明責任があり、データ基盤チームが恒常的に存在する環境だ。要するに、本書が想定するエンタープライズの現場である。

そして、どちらの構成を採ったとしても、最後に残る問題は共通している。マートの列名を見ただけでは、売上の定義が分からないという問題だ。`net_amount` の合計が「売上」なのか、返品を引くのか、社内取引を除くのか。この定義をどこに置くかが、次章のテーマである。

::: tip この章のポイント
- Hub（キー）・Link（関係）・Satellite（属性と履歴）は、変化の速度が違うものを分離するための区分である
- ハッシュキーの採用により、テーブル間の依存なしに並列ロードできる。ハッシュの計算規約は必ず統一する
- Raw Vaultは上流を解釈せずに残す。これが監査可能性と再現性を生む
- 名寄せなどの判断はBusiness Vaultへ置き、ルール名とスコアをデータとして残す
- 結合の多さは、レイヤー分離・PIT/Bridge・生成による自動化の三点で抑える
- ソースが単一で監査要件がないなら、Data Vaultは過剰である
:::
