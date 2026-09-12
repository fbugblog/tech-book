---
title: 第4章 データ品質保証——テストを書かないパイプラインは静かに壊れる
sidebar_label: 第4章 データ品質保証
---

# 第4章 データ品質保証——テストを書かないパイプラインは静かに壊れる

アプリケーションのバグは、たいてい音を立てて壊れる。例外が飛び、ログにスタックトレースが残り、監視がアラートを上げる。

データパイプラインの壊れ方は違う。ジョブは成功し、テーブルは更新され、ダッシュボードは今日も数字を表示する。ただ、その数字が間違っている。上流のシステムが顧客IDの採番方式を変え、結合が空振りし、売上が実際の三割になっていた——それに気づくのは、経営会議で誰かが「先月と比べて減りすぎでは」と言ったときである。

この静かな壊れ方こそが、データエンジニアリングにテストが不可欠な理由だ。本章では、dbtのテスト機能を使って、壊れたことを人間より先にパイプラインが気づく仕組みを組む。

## dbtのテストは「行を返すクエリ」である

仕組みは拍子抜けするほど単純である。dbtにおけるテストとは、**条件に違反する行を返すSQLクエリ**にすぎない。返る行が0件ならテスト成功、1件以上あれば失敗である。

`not_null` テストは、内部的にはこう展開される。

```sql
select * from analytics.dbt_prod.fct_orders
where order_id is null
```

この単純さは、そのまま拡張性につながる。「異常な行を返すクエリ」を書ければ、それはテストになる。後半で扱うカスタムテストも、この原理の上に成り立っている。

テストの実行はコマンド一つだ。実務では、モデルの構築とテストをまとめて実行する `dbt build` を既定にするのがよい。

```bash
dbt test                 # テストだけを実行する
dbt build                # モデル構築とテストを DAG 順に実行する
dbt build -s fct_orders+ # 特定モデルと下流だけを対象にする
```

`dbt build` が優れているのは、**テストに失敗した時点で下流のモデル構築を止める**点である。`dbt run` の後に `dbt test` を回す構成だと、汚れたデータがマートまで届いてから失敗が判明する。`dbt build` なら、Staging層のテストが落ちた段階でそこから先が止まり、ダッシュボードは古いが正しい数字を出し続ける。

## 四つの標準テスト

dbtには最初から四つの汎用テストが備わっている。地味だが、実際の障害の大半はこの四つで捕まる。

```yaml
# models/marts/finance/_finance__models.yml
version: 2

models:
  - name: fct_orders
    description: 注文の事実テーブル。一行が一注文を表す。
    columns:
      - name: order_id
        description: 注文の一意な識別子。
        tests:
          - unique
          - not_null

      - name: customer_id
        description: 顧客テーブルへの外部キー。
        tests:
          - not_null
          - relationships:
              to: ref('dim_customers')
              field: customer_id

      - name: payment_state
        tests:
          - accepted_values:
              values: ['paid', 'partially_paid', 'unpaid']
```

**unique** は主キーの重複を見る。重複が入り込む最大の原因は結合のファンアウトであり、集計が静かに二重計上される事故に直結する。全モデルの主キーに付けるべきテストである。

**not_null** は必須項目の欠落を見る。主キーと外部キー、それに指標の元になる金額や数量には最低限付けておく。

**relationships** は参照整合性を見る。ファクトの外部キーが、ディメンション側に実在するかを確認する。冒頭に挙げた「採番方式が変わって結合が空振りする」事故は、まさにこのテストで捕まるものだ。

**accepted_values** は区分値の網羅性を見る。上流が新しいステータスを追加したとき、`case` 文の `else` に落ちて静かに誤分類されるのを防ぐ。第2章で触れたとおり、これはドキュメントとしても機能する。

原則として、**すべてのモデルの主キーに `unique` と `not_null` を付ける**ところから始めたい。ここを機械的にやるだけで、検知できる障害の範囲が大きく変わる。

## 重要度を使い分ける

テストを増やしていくと、必ず同じ問題にぶつかる。「失敗したがパイプラインは止めたくない」ケースである。

源泉に月に数件だけ混じる不正データを、毎晩の失敗として扱うと、アラートが狼少年になる。かといって、テスト自体を消すと異常に気づけない。そこで重要度を調整する。

```yaml
models:
  - name: fct_orders
    columns:
      - name: shipping_address
        tests:
          - not_null:
              config:
                severity: warn

      - name: customer_id
        tests:
          - not_null:
              config:
                severity: error
                error_if: ">100"
                warn_if: ">0"
```

`severity: warn` は、失敗しても実行を止めずに警告だけ出す。後者の書き方はさらに柔軟で、「1件でもあれば警告、100件を超えたらエラー」という閾値を設けている。完全な0を要求できないが、桁が変わったら止めたい、という現実的な要件に合う。

失敗した行を調べたいときは、結果を保存する設定が役に立つ。

```yaml
tests:
  - not_null:
      config:
        store_failures: true
        schema: dbt_test_failures
```

失敗した行が専用スキーマのテーブルに残るので、ログからSQLを拾って再実行する手間がなくなる。原因調査の速度が体感で変わる部分である。

## dbt_expectationsによる統計的アサーション

標準テストは「あってはならない値」を見る。しかし現実の異常は、値そのものではなく分布に現れることが多い。金額は負になっていないものの桁が一つ多い、行数はゼロでないものの平常の半分しかない、といった壊れ方である。

これを扱うのが `dbt_expectations` である。Python界の Great Expectations の考え方をdbtに移植したパッケージで、統計的な性質をテストとして宣言できる。

```yaml
models:
  - name: fct_orders
    tests:
      # 一日の行数が想定の範囲に収まっているか
      - dbt_expectations.expect_table_row_count_to_be_between:
          min_value: 1000
          max_value: 100000
          row_condition: "ordered_at >= current_date - 1"

    columns:
      - name: order_amount
        tests:
          # 金額の範囲
          - dbt_expectations.expect_column_values_to_be_between:
              min_value: 0
              max_value: 10000000

          # 平均値が平常の範囲か
          - dbt_expectations.expect_column_mean_to_be_between:
              min_value: 3000
              max_value: 30000
              config:
                severity: warn

      - name: ordered_at
        tests:
          # 直近24時間以内のデータが存在するか（鮮度の確認）
          - dbt_expectations.expect_row_values_to_have_recent_data:
              datepart: hour
              interval: 24
```

このうち特に効くのが、行数と鮮度の二つである。

**行数の異常**は、上流の連携が部分的に失敗したときに現れる。ジョブ自体は成功するので、行数を見ていないと気づけない。

**鮮度の劣化**は、連携が完全に止まったときに現れる。テーブルは存在し、クエリも成功し、ただ中身が三日前のまま。「今日のデータがあるか」を確認するテストは、最も費用対効果が高い部類に入る。

なお、源泉データの鮮度については、dbt本体に専用の機能がある。

```yaml
# models/staging/shop/_shop__sources.yml
sources:
  - name: shop
    database: RAW
    schema: raw_shop
    tables:
      - name: orders
        loaded_at_field: _loaded_at
        freshness:
          warn_after: {count: 6, period: hour}
          error_after: {count: 24, period: hour}
```

```bash
dbt source freshness
```

こちらは変換を走らせる前に実行できる。源泉が古いまま全モデルを再構築しても意味がないので、パイプラインの先頭に置いておくとよい。

分布系のテストを使うときの注意点も書いておく。閾値の根拠をコメントに残すことだ。「なぜ最小1000行なのか」が書かれていないと、季節変動で落ちたときに、調査ではなく閾値の緩和で対処されてしまう。

## カスタム汎用テストを書く

標準テストにもパッケージにもない検査は、自分で書く。dbtのテストは「違反行を返すクエリ」だという原理を思い出せば、書き方は自然に決まる。

`tests/generic/` にマクロを置くだけでよい。

```sql
-- tests/generic/test_positive_value.sql
{% test positive_value(model, column_name) %}

select {{ column_name }}
from {{ model }}
where {{ column_name }} <= 0

{% endtest %}
```

```yaml
columns:
  - name: order_amount
    tests:
      - positive_value
```

`model` と `column_name` は、dbtが自動で渡してくれる引数である。追加の引数も定義できる。

より実務的な例として、集計の整合性を見るテストを挙げる。ファクトの合計と、源泉の合計が一致するかという検査だ。この種のテストは、結合のファンアウトやフィルターの書き間違いを高い確度で捕まえる。

```sql
-- tests/generic/test_equal_sum_across_models.sql
{% test equal_sum_across_models(model, column_name, compare_model, compare_column, tolerance=1) %}

with this_total as (
    select sum({{ column_name }}) as total from {{ model }}
),

that_total as (
    select sum({{ compare_column }}) as total from {{ compare_model }}
)

select
    this_total.total as this_total,
    that_total.total as that_total
from this_total
cross join that_total
where abs(this_total.total - that_total.total) > {{ tolerance }}

{% endtest %}
```

```yaml
models:
  - name: fct_orders
    columns:
      - name: order_amount
        tests:
          - equal_sum_across_models:
              compare_model: ref('stg_shop__orders')
              compare_column: order_amount
              tolerance: 1
```

浮動小数点の誤差を吸収する `tolerance` を引数にしている点が実務的である。厳密な一致を要求すると、丸め処理の違いで恒常的に落ち続けるテストができあがる。

汎用テストにできない一回限りの検査は、**特異テスト**として `tests/` に素のSQLファイルを置く。

```sql
-- tests/assert_no_future_orders.sql
select order_id, ordered_at
from {{ ref('fct_orders') }}
where ordered_at > current_timestamp
```

ファイルを置くだけでテストとして実行される。YAMLへの登録も要らない。

## データのユニットテスト

ここまでのテストは、すべて実データに対する検査である。これとは別に、**ロジックそのもの**を検査する仕組みがdbtにはある。ユニットテストだ。

入力を固定値で与え、出力が期待どおりかを確かめる。ソフトウェア開発でおなじみの形式である。

```yaml
unit_tests:
  - name: test_payment_state_classification
    model: fct_orders
    given:
      - input: ref('int_orders_joined_to_payments')
        rows:
          - {order_id: 1, order_amount: 1000, paid_amount: 1000}
          - {order_id: 2, order_amount: 1000, paid_amount: 400}
          - {order_id: 3, order_amount: 1000, paid_amount: 0}
    expect:
      rows:
        - {order_id: 1, payment_state: 'paid'}
        - {order_id: 2, payment_state: 'partially_paid'}
        - {order_id: 3, payment_state: 'unpaid'}
```

実データのテストとユニットテストは、目的が違う。前者は「データが想定どおりか」を見て、後者は「ロジックが想定どおりか」を見る。全額入金のちょうど境界、金額ゼロ、支払い過多といった境界条件は、実データにたまたま含まれているとは限らない。ユニットテストなら確実に踏める。

すべてのモデルに書く必要はない。`case` 文が入り組んでいるモデル、金額を計算しているモデル、過去にバグを出したモデル——この三つに絞って書くだけで、リグレッションの大半は防げる。

## どこまでテストを書くか

テストは書けばよいというものではない。実行時間もコストもかかるし、意味のないテストは保守の負担になる。

優先順位を付けるなら、次の順で積み上げるのが実務的である。

第一に、**全モデルの主キーに `unique` と `not_null`**。これは議論の余地なく入れる。

第二に、**マートの外部キーに `relationships`**。結合の空振りは影響が大きく、自力では気づけない。

第三に、**源泉の鮮度チェック**。連携の停止を検知する唯一の手段になる。

第四に、**主要マートの行数と `case` 文で使う区分値**。異常な増減と、未知の値の混入を捕まえる。

第五に、**複雑なロジックへのユニットテスト**。ここまで来ればかなり手厚い。

逆に、書かなくてよいものもある。Staging層は源泉の写しなので、主キー以外にテストを厚く積む価値は薄い。分布のテストをすべてのカラムに機械的に付けるのも、失敗の大半が「正常な変動」になるので勧めない。

> テストの価値は、書いた本数ではなく、それが落ちたときに人が動くかどうかで決まる。誰も見ないアラートを出すテストは、書かないほうがましである。

## 失敗を人に届ける

テストを書いても、失敗が誰にも届かなければ意味がない。通知の設計まで含めて品質保証である。

dbt Cloudを使っているなら、ジョブの通知設定でSlackやメールに飛ばせる。dbt Coreの場合は、実行結果のアーティファクトから自前で組む。

`dbt build` を実行すると、`target/run_results.json` に各ノードの結果が書き出される。これを読んで通知すればよい。

```python
import json

with open("target/run_results.json") as f:
    results = json.load(f)

failures = [
    r for r in results["results"]
    if r["status"] in ("fail", "error")
]

for r in failures:
    print(f"{r['unique_id']}: {r['status']} ({r['failures']} rows)")
    # ここでSlackのWebhookへ送る
```

通知の設計で大事なのは、**宛先を分けること**である。すべての失敗を一つのチャンネルに流すと、数週間で誰も読まなくなる。

エラー（`severity: error`）はオンコール担当に即時通知し、警告（`severity: warn`）は日次のサマリーにまとめる。この二段構えにするだけで、アラートの信頼性は保たれる。

さらに、モデルに `owner` のメタデータを持たせておくと、宛先の自動判定ができる。

```yaml
models:
  - name: fct_orders
    config:
      meta:
        owner: "#data-finance"
        criticality: high
```

障害対応の初動で最も時間を食うのは、「これは誰に聞けばよいのか」という問いである。ここをメタデータで解決しておくと、深夜の対応が目に見えて楽になる。

::: tip この章のポイント
- dbtのテストは「違反する行を返すクエリ」でしかない。この単純さが、そのまま拡張性になっている
- `dbt run` と `dbt test` を分けず `dbt build` を使う。テスト失敗時に下流の構築が止まり、汚れたデータがマートに届かない
- `severity` と `error_if` / `warn_if` で重要度を段階化し、`store_failures` で失敗行を残すと調査が速くなる
- 値の異常より分布の異常のほうが見つけにくい。行数と鮮度のテストは費用対効果が高い
- 実データのテストは「データが想定どおりか」、ユニットテストは「ロジックが想定どおりか」を見る。目的が違うので両方要る
- テストの価値は本数ではなく、落ちたときに人が動くかで決まる。エラーと警告で通知先を分け、オーナーをメタデータに持たせる
:::
