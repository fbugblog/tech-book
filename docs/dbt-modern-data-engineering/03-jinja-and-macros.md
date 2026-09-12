---
title: 第3章 Jinja・マクロ・パッケージ——SQLを組み立てるためのメタ言語
sidebar_label: 第3章 Jinja・マクロ・パッケージ
---

# 第3章 Jinja・マクロ・パッケージ——SQLを組み立てるためのメタ言語

第1章で、dbtの正体はSQLコンパイラだと書いた。そのコンパイル処理を担っているのがJinjaである。

Jinjaは、もともとPythonのWebアプリケーションでHTMLを組み立てるために作られたテンプレートエンジンだ。dbtはこれをSQLに転用した。`ref()` も `source()` も `config()` も、すべてJinjaの関数呼び出しとして実装されている。つまり、dbtを使っている時点ですでにJinjaを使っている。

本章では、この仕組みを意識的に使いこなす方法を扱う。同時に、使いすぎたときに何が起きるかも扱う。Jinjaは強力だが、読めないSQLを量産する道具にもなりうるからである。

## Jinjaの三つの記法と実行の順序

Jinjaの記法は三種類しかない。

<span v-pre>`{{ ... }}`</span> は**式**であり、評価結果がその場に文字列として埋め込まれる。<span v-pre>`{{ ref('stg_orders') }}`</span> がテーブル名に置き換わるのがこれである。

`{% ... %}` は**文**であり、条件分岐やループ、変数代入といった制御構造を書く。それ自体は出力を持たない。

`{# ... #}` は**コメント**で、コンパイル結果には残らない。SQLの `--` コメントは結果に残るため、生成されたSQLを汚したくない説明はこちらを使う。

ここで、初学者が必ずつまずく点を先に潰しておきたい。**Jinjaの評価はSQLの実行より前に、完全に終わっている**。テンプレートは文字列を組み立てるだけであり、データベースの中身を見ているわけではない。

この順序を理解していないと、「テーブルの値によってループの回数を変える」といった発想をしてしまう。それはできない。ただし、コンパイル時にウェアハウスへ問い合わせる `run_query()` という抜け道はあり、後述する。

コンパイル結果は必ず確認する習慣をつけたい。

```bash
dbt compile -s fct_orders
# target/compiled/<project>/models/marts/fct_orders.sql に生成物が出る
```

Jinjaを書いていて動作が分からなくなったら、まずこのファイルを開く。生成されたSQLを見れば、ほとんどの疑問は解ける。

## 動的SQLが効く場面

Jinjaの制御構造が本当に役立つ場面は、そう多くない。乱用を避けるためにも、効く型を覚えておくのがよい。

**繰り返しの列生成**が第一の型である。ピボットのように、同じ形の式が値の数だけ並ぶケースだ。

```sql
select
    order_date,
    {% for state in ['paid', 'partially_paid', 'unpaid'] %}
    sum(case when payment_state = '{{ state }}' then order_amount else 0 end)
        as {{ state }}_amount
    {%- if not loop.last %},{% endif %}
    {% endfor %}
from {{ ref('fct_orders') }}
group by 1
```

`loop.last` でカンマの有無を制御している。この末尾カンマの処理はJinjaを書くときの定番の面倒であり、`{%- ` のハイフンで空白を削る記法と合わせて覚えておくと楽になる。

値の一覧を手書きせず、実際のデータから取ってくる書き方もある。ここで先ほどの抜け道が出てくる。

```sql
{% set payment_states = dbt_utils.get_column_values(
    table=ref('fct_orders'), column='payment_state'
) %}
```

`get_column_values` は、コンパイル時にウェアハウスへクエリを投げ、結果をJinjaのリストとして返す。便利だが、コンパイルのたびにクエリが走る点と、値が増えたときに列構成が勝手に変わる点は理解しておく必要がある。列構成が変わればBI側が壊れるので、公開するマートで使うのは慎重に判断する。

**環境による分岐**が第二の型である。開発環境では処理対象を絞り、本番では全量を処理したい、というケースは頻出する。

```sql
select * from {{ ref('stg_shop__events') }}
{% if target.name != 'prod' %}
where event_at >= dateadd('day', -7, current_date)
{% endif %}
```

`target` には、`profiles.yml` で選んだ接続先の情報が入っている。開発時の実行時間が数分から数秒になるので、試行錯誤の速度が変わる。

**増分処理の分岐**が第三の型で、第1章でも触れた `is_incremental()` である。これは実質的にdbtの標準機能であり、Jinjaを意識せずとも使う。

## マクロ——共通処理をパッケージ化する

マクロは、Jinjaにおける関数である。`macros/` ディレクトリに置き、プロジェクト内のどのモデルからも呼べる。

素直な例として、金額を丸める処理を考える。

```sql
-- macros/cents_to_yen.sql
{% macro cents_to_yen(column_name, decimal_places=0) %}
    round({{ column_name }} / 100.0, {{ decimal_places }})
{% endmacro %}
```

```sql
select
    order_id,
    {{ cents_to_yen('amount_cents') }} as order_amount
from {{ ref('stg_shop__orders') }}
```

これだけ見ると、わざわざマクロにする価値は薄い。マクロが効いてくるのは、次の三つの条件のどれかが満たされるときである。

**同じロジックが多数のモデルに散らばっている**場合。個人情報のマスキング処理などが典型で、規則が変わったときに直す場所が一か所になる。

**ウェアハウス間の差異を吸収したい**場合。日付操作や文字列結合の関数名は、SnowflakeとBigQueryとPostgresで揃っていない。マクロで包んでおくと、移行時の書き換えが局所化する。

**定型の運用処理をコード化したい**場合。これは後述する `run-operation` の用途である。

実務でよく書くのは、ビジネス定義を閉じ込めるマクロである。

```sql
-- macros/is_valid_order.sql
{% macro is_valid_order(alias='orders') %}
    {{ alias }}.order_status not in ('CANCELLED', 'TEST')
    and {{ alias }}.order_amount > 0
{% endmacro %}
```

「有効な注文とは何か」という定義は、放っておくと各モデルにコピーされる。一か所に集めておけば、定義変更が全モデルに一度に効く。

なお、この種の定義はマクロではなくモデルとして持つ選択肢もある。第2章のIntermediate層に `int_valid_orders` を作れば、テストも書けるしDAGにも現れる。**どちらでも書ける場合は、モデルを選ぶほうがよい**。マクロはDAGに現れず、テストも書けず、どこから使われているかの追跡が難しいからである。

マクロには説明を付けられる。`macros/` 配下のYAMLに書けば、ドキュメントにも載る。

```yaml
macros:
  - name: cents_to_yen
    description: セント単位の整数を円単位の数値に変換する。
    arguments:
      - name: column_name
        type: string
        description: 変換対象のカラム名。
      - name: decimal_places
        type: integer
        description: 丸める小数桁数。既定は0。
```

## run-operationによる運用処理

マクロはモデルの中からだけでなく、単体でも実行できる。権限付与やメンテナンス処理をコード化する用途で使う。

```sql
-- macros/grant_select_to_bi.sql
{% macro grant_select_to_bi(role='BI_READER') %}
    {% set sql %}
        grant usage on schema {{ target.schema }} to role {{ role }};
        grant select on all tables in schema {{ target.schema }} to role {{ role }};
    {% endset %}
    {% do run_query(sql) %}
    {% do log('granted select on ' ~ target.schema ~ ' to ' ~ role, info=True) %}
{% endmacro %}
```

```bash
dbt run-operation grant_select_to_bi --args '{role: BI_READER}'
```

手順書のスクリーンショットに残っていた作業が、レビュー可能なコードになる。引き継ぎの質が変わる部分である。

なお、権限付与に関しては `grants` 設定という標準機能もあり、単純な付与ならそちらのほうが素直に書ける。マクロを書く前に、標準機能で足りないかを確認する癖をつけたい。

## パッケージ——他人の書いたマクロを使う

dbtにはパッケージの仕組みがあり、コミュニティが公開しているマクロ集を取り込める。`packages.yml` に書いて `dbt deps` を実行するだけである。

```yaml
# packages.yml
packages:
  - package: dbt-labs/dbt_utils
    version: [">=1.3.0", "<2.0.0"]
  - package: calogica/dbt_expectations
    version: [">=0.10.0", "<0.11.0"]
  - package: dbt-labs/codegen
    version: [">=0.13.0", "<0.14.0"]
```

バージョンは範囲で固定する。上限を切っておかないと、破壊的変更が入ったときに再現性が失われる。

**dbt_utils** は事実上の標準パッケージである。使用頻度の高いものを挙げる。

`dbt_utils.generate_surrogate_key(['order_id', 'line_number'])` は、複数カラムから代理キーを生成する。複合キーをそのまま扱うより、結合もテストも扱いやすくなる。

`dbt_utils.star(from=ref('stg_orders'), except=['updated_at'])` は、特定カラムを除いた全列展開を生成する。列の多いテーブルで `select *` の代わりに使う。

`dbt_utils.date_spine(...)` は連続した日付の表を生成する。データの欠けている日を0で埋めたい集計で使う。

`dbt_utils.union_relations(...)` は、複数テーブルをカラム構成の差を吸収しながら結合する。国別・年別に分かれたテーブルをまとめる場面で効く。

**codegen** は、定型のYAMLやSQLを生成するパッケージだ。源泉テーブルからStagingモデルの雛形を作る用途で、初期構築の手間が大きく減る。

```bash
dbt run-operation generate_source --args '{schema_name: raw_shop, database: RAW}'
dbt run-operation generate_base_model --args '{source_name: shop, table_name: orders}'
```

生成物はあくまで雛形である。カラム名の整理や型変換は、第2章の規則に沿って自分で手を入れる。

**dbt_expectations** はテスト用のパッケージで、次章でまとめて扱う。ほかに、プロジェクト構成そのものを検査する `dbt_project_evaluator` や、データ品質の監視を担う `elementary` も、規模が大きくなってくると検討に値する。

パッケージを入れる判断には、一つ基準を置いておきたい。**自分で30行書けば済む処理のために依存を増やさない**。パッケージはアップグレード時の互換性という負債を伴う。dbt_utilsのように広く使われ、メンテナンスが続いているものは別として、小規模なパッケージへの依存は慎重に判断する。

## Jinjaを書きすぎない

最後に、本章で最も伝えたいことを書く。**Jinjaは控えめに使うべきである**。

理由は単純で、読めなくなるからだ。次のようなモデルを想像してほしい。

```sql
{% for entity in var('entities') %}
{% if entity.type == 'fact' %}
select {{ build_columns(entity) }} from {{ source(entity.source, entity.table) }}
{% if not loop.last %}union all{% endif %}
{% endif %}
{% endfor %}
```

書いた本人には美しく見える。半年後に別の担当者がこれを読むとき、`var('entities')` の中身を探し、`build_columns` の実装を追い、生成されるSQLを頭の中で組み立てる必要がある。バグが出たときの調査時間は、素直に書いたSQLの数倍になる。

判断の基準を三つ挙げる。

**生成されるSQLが頭に浮かぶか**。浮かばないなら、それは抽象化しすぎである。

**SQLを直接書くより短くなっているか**。同程度の行数なら、SQLのほうがよい。ループで10行が3行になるなら価値がある。

**モデルとして書けないか**。前述のとおり、モデルはDAGに現れ、テストが書け、途中結果を確認できる。マクロで書けることの多くは、モデルでも書ける。

> 抽象化のコストは、書くときにではなく、読むときに支払われる。SQLは読まれる回数のほうが圧倒的に多い。

dbtのJinjaは、SQLの限界を補うために存在する。SQLを別の言語に作り変えるために存在するのではない。

::: tip この章のポイント
- Jinjaの評価はSQLの実行より前に完全に終わる。テンプレートは文字列を組み立てているだけである
- 動的SQLが効くのは、繰り返しの列生成・環境による分岐・増分処理の分岐という限られた型である
- マクロが価値を持つのは、ロジックが多数のモデルに散らばる場合、ウェアハウス間の差異を吸収する場合、運用処理をコード化する場合である
- マクロでもモデルでも書ける処理は、モデルを選ぶ。モデルはDAGに現れ、テストでき、途中結果を確認できる
- パッケージはバージョンを範囲で固定し、自前で30行書けば済む処理のために依存を増やさない
- 抽象化のコストは読むときに支払われる。生成されるSQLが頭に浮かばないなら、それは書きすぎである
:::
