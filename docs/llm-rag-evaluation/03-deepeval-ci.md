---
title: 第3章 DeepEval によるユニットテストとCI/CD組み込み
sidebar_label: 第3章 DeepEvalとCI/CD
---

# 第3章 DeepEval によるユニットテストとCI/CD組み込み

第2章で作ったメトリクスとデータセットは、手元で走らせているうちは研究にすぎない。プロンプトを触った人が、触ったその場で結果を突きつけられるようになって初めて、品質保証として機能する。

この章では、DeepEvalを使って評価をpytestのテストとして書き、GitHub Actionsで自動実行するところまでを組み立てる。

## 評価をアサーションとして書く

DeepEvalは、LLMの評価をpytestのテストとして書くために作られたフレームワークである。中心にあるのは `LLMTestCase` という単位で、入力・実際の出力・検索文脈・期待出力をひとまとめにする。

```python
# tests/test_rag.py
import pytest
from deepeval import assert_test
from deepeval.metrics import AnswerRelevancyMetric, FaithfulnessMetric
from deepeval.test_case import LLMTestCase

from app.rag import answer  # 評価対象のアプリケーション


def test_paid_leave_question():
    question = "有給休暇の付与日数は勤続何年で最大になりますか"
    result = answer(question)

    test_case = LLMTestCase(
        input=question,
        actual_output=result.text,
        retrieval_context=result.contexts,
    )

    assert_test(
        test_case,
        metrics=[
            FaithfulnessMetric(threshold=0.9),
            AnswerRelevancyMetric(threshold=0.8),
        ],
    )
```

`assert_test` は、渡したメトリクスのいずれかが閾値を下回ると失敗する。テストが赤くなったときのメッセージには、どの指標がいくつだったかに加えて、判定器が出した理由が含まれる。これがふつうのアサーションとの決定的な違いである。「0.62で閾値を下回った」ではなく「回答中の『翌年度に繰り越せる』という主張が文脈に存在しない」と出るので、直す場所が分かる。

実行はpytestでもよいが、専用のランナーを使うと並列実行と結果の集約が効く。

```bash
deepeval test run tests/test_rag.py -n 4
```

### データセットをパラメータ化して回す

1件ずつ関数を書くのは現実的ではない。第2章で作ったゴールデンデータセットをパラメータ化して流し込む。

```python
# tests/test_dataset.py
import json

import pytest
from deepeval import assert_test
from deepeval.metrics import ContextualRecallMetric, FaithfulnessMetric
from deepeval.test_case import LLMTestCase

from app.rag import answer

with open("tests/data/golden_dataset.json", encoding="utf-8") as f:
    GOLDEN = json.load(f)


@pytest.mark.parametrize("record", GOLDEN, ids=lambda r: r["id"])
def test_golden_dataset(record):
    result = answer(record["question"])

    test_case = LLMTestCase(
        input=record["question"],
        actual_output=result.text,
        retrieval_context=result.contexts,
        expected_output=record["reference"],
    )

    assert_test(
        test_case,
        metrics=[FaithfulnessMetric(threshold=0.9), ContextualRecallMetric(threshold=0.8)],
    )
```

ここで一つ設計上の判断が要る。全件をそれぞれ独立したテストとして扱うと、1件でも落ちればCIが赤くなる。確率的なシステムでは、これは厳しすぎる。500件中1件のぶれで毎回赤くなるCIは、遠からず誰にも見られなくなる。

そこで判定を二階建てにする。

- **個別の閾値**: 明らかな事故を捕まえる低い閾値。忠実性0.5未満のような、どう見ても壊れている件だけを落とす
- **集計の閾値**: データセット全体の平均やパス率に対する高い閾値。平均0.9以上、パス率95%以上といった形で、リリースゲートに使う

個別のテストで落とすのは前者、リリース可否を決めるのは後者、と役割を分ける。

## G-Eval——独自の基準を評価器に教える

忠実性や関連性は、どのRAGにも共通する汎用の指標である。一方で、現場の品質基準はもっと個別的だ。「社内規程の回答には必ず条番号を添えること」「断定できない場合は担当部署への確認を促すこと」「金融商品の説明にはリスクの言及を欠かさないこと」。こうした基準は既製のメトリクスにない。

G-Evalは、自然言語で書いた評価基準（ルーブリック）から評価器を作る仕組みである。もとは、評価基準を与えたうえでLLMに思考の手順を生成させ、その手順に沿って採点させるという手法として提案された。DeepEvalはこれを `GEval` クラスとして実装している。

```python
from deepeval.metrics import GEval
from deepeval.test_case import LLMTestCase, LLMTestCaseParams

citation_metric = GEval(
    name="規程参照の明示",
    criteria=(
        "回答が社内規程に基づく内容である場合、根拠となる規程名と条番号を明示しているか。"
        "規程に基づかない一般的な案内である場合は、この基準の対象外として満点とする。"
    ),
    evaluation_steps=[
        "回答が社内規程の内容に言及しているかを判定する",
        "言及している場合、規程名と条番号が本文中に現れるかを確認する",
        "条番号が検索文脈に含まれるものと一致するかを確認する",
        "一致しない番号を挙げている場合は最低点とする",
    ],
    evaluation_params=[
        LLMTestCaseParams.INPUT,
        LLMTestCaseParams.ACTUAL_OUTPUT,
        LLMTestCaseParams.RETRIEVAL_CONTEXT,
    ],
    threshold=0.8,
)
```

`criteria` だけでも動くが、`evaluation_steps` を明示的に書くほうが結果は安定する。評価器が毎回自前で手順を考えると、その手順自体がぶれるからだ。手順を固定すれば、判定のぶれは減る。

ルーブリックを書くときのこつを挙げる。

- **対象外のケースを明記する。** 上の例の「規程に基づかない場合は満点」がこれにあたる。書き忘れると、対象外の回答が軒並み低評価になる。
- **一つの基準に一つの観点だけを入れる。** 「条番号を示し、かつ丁寧な口調であること」は二つの指標に分ける。混ぜると、どちらが原因で落ちたのか分からない。
- **判定の根拠を出力させる。** DeepEvalは既定で理由を返す。この理由を必ずログに残す。あとでルーブリック自体を直すときの材料になる。

プロンプトの回帰テストにも同じ仕組みが使える。プロンプトを更新したら、口調・構造・禁止事項に関するG-Evalの指標群を回し、意図しない副作用が出ていないかを見る。

## GitHub Actionsに組み込む

仕上げに、プロンプトやRAGの設定が変わったときだけ評価が走るパイプラインを用意する。

```yaml
# .github/workflows/llm-eval.yml
name: LLM Evaluation

on:
  pull_request:
    paths:
      - 'app/prompts/**'
      - 'app/rag/**'
      - 'tests/data/golden_dataset.json'
  schedule:
    - cron: '0 18 * * *'   # 毎晩フルセットを流す

jobs:
  evaluate:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: pip

      - run: pip install -r requirements-dev.txt

      - name: 評価テストの実行
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          # PRでは部分集合、夜間ジョブでは全件
          EVAL_SAMPLE_SIZE: ${{ github.event_name == 'pull_request' && '50' || '0' }}
        run: deepeval test run tests/ -n 4

      - name: 結果をPRにコメント
        if: always() && github.event_name == 'pull_request'
        run: python scripts/post_eval_summary.py
```

`paths` でトリガーを絞っているのが要点である。README の誤字修正でLLM評価が走ると、時間とコストの無駄になるうえ、失敗しても誰も真面目に受け取らなくなる。

### 運用上の三つの調整

**コスト。** 評価一回のAPI費用は、データセット件数×指標数×判定あたりの呼び出し回数で決まる。PRごとに全件を回すと月の請求が無視できない額になる。層化サンプリングで部分集合を作り、日常のPRはそれで回す。夜間とリリース前だけ全件を流す。

**ぶれ。** 評価器の温度は0に固定する。それでも実行ごとの揺らぎは残るため、閾値には安全余裕を持たせる。基準線が0.90なら、CIの閾値は0.85あたりに置く。境界ぎりぎりに置くと、変更していないのに赤くなるテストが生まれる。

**秘匿情報。** 評価データセットには実際の業務文書が入ることが多い。リポジトリに置けない場合は、暗号化して置くか、CIの中でオブジェクトストレージから取得する。APIキーは必ずシークレット経由で渡し、評価結果のログに入力文がそのまま出ないよう、出力の扱いも決めておく。

### 基準線を記録する

CIの出力は、その場の合否だけでなく時系列で残す。コミットハッシュ、データセットのバージョン、評価器モデル、各指標の平均値を1行にして追記していくだけでも、驚くほど役に立つ。三か月後に「いつから忠実性が下がったのか」と問われたとき、答えられるのはこの記録だけである。

::: tip この章のポイント
- DeepEvalはLLMの評価をpytestのアサーションとして書ける。失敗時に判定理由が出る点が通常のテストと違う
- 個別テストの閾値は事故検知用に低く、リリースゲートは集計値に対して高く、と二階建てにする
- G-Evalは自然言語のルーブリックから評価器を作る。評価手順を明示すると判定が安定する
- ルーブリックは一基準一観点で書き、対象外のケースを必ず明記する
- CIは変更パスで絞り、PRでは部分集合、夜間は全件という二段構えでコストを抑える
- 閾値には安全余裕を持たせ、指標の推移をコミット単位で記録し続ける
:::
