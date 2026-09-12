---
title: 第4章 状態持続型エージェントとマルチエージェント
sidebar_label: 第4章 状態持続型エージェント
---

# 第4章 状態持続型エージェントとマルチエージェント

エージェントを「自律的に考えて動くAI」と説明すると、実装から遠ざかる。実体はもっと地味で、**終了条件を満たすまでLLMの呼び出しとツールの実行を交互に繰り返すループ**である。設計上の論点も、この見方から素直に出てくる。ループの各回で何をモデルに見せるか、どこで抜けるか、途中で落ちたらどこから再開するか、そして誰が止めるか。この章では、推論パターンの整理から始め、LangGraphによる実装、複数エージェントへの分割、人間の介入までを順にたどる。

## 4.1 ReActとPlan-and-Solve——二つの推論パターン

### ReAct——考えながら動く

ReActは、推論（Reasoning）と行動（Acting）を交互に繰り返す。一手ごとに「今の状況を踏まえて次に何をすべきか」を考え、ツールを一つ呼び、その結果を見てまた考える。

現在の実装では、この骨格はモデルのツール呼び出し機能に吸収されている。かつてのように `Thought:` `Action:` `Observation:` という書式を文字列で解析する必要はない。残っているのは、次の二つの状態を行き来するループそのものである。

1. モデルを呼ぶ。ツール呼び出しが含まれていれば2へ、なければ終了
2. ツールを実行し、結果を会話に追加して1へ戻る

ReActの強みは適応力である。途中で予想外の結果が返っても、次の一手をその場で組み直せる。弱みは見通しの悪さで、**全体として何をしようとしているのかが、実行が終わるまで分からない**。長い手順では、途中で目的を見失い、同じ検索を繰り返したり、関係のない方向に逸れたりする。

### Plan-and-Solve——先に計画を立てる

Plan-and-Solveは、最初に手順の一覧を作り、それを順に実行する。計画と実行を分離することで、見通しの悪さに対処する。

```python
class Plan(BaseModel):
    """課題を解くための手順。"""
    steps: list[str] = Field(description="上から順に実行する手順。各手順は独立して実行可能な粒度で")

planner = model.with_structured_output(Plan)
```

計画を明示的なデータとして持つ効果は大きい。実行前に人間が計画をレビューできる。独立した手順を並行に実行できる。途中で失敗したとき、どの手順から再開すればよいかが明確になる。何より、エージェントが何をしようとしているのかが利用者に見える。

弱点は、**最初の計画が外れたときに脆い**ことである。実際にやってみないと分からない情報は必ずあり、計画時点の前提は崩れる。

### 実務的な折衷

そこで実務では、両者を組み合わせた再計画型の構成を採る。大枠の計画を立て、一手実行するごとに「計画を続行するか、作り直すか」を判断する。

```
計画 → 実行 → 結果を踏まえて再計画の要否を判定 → （必要なら）計画を更新 → 実行 …
```

使い分けの目安は、**手順の数と、事前に見通せる度合い**である。数手で終わる調査や問い合わせ応答ならReActで十分であり、計画層を足すのはコストの無駄になる。十手を超える手順、複数の担当者が関わる業務、途中で人間の承認が入る処理では、計画を明示的に持つ構成が要る。

> 計画を持たないエージェントは、長い仕事で必ず迷子になる。計画しか持たないエージェントは、最初の想定が外れた瞬間に壊れる。

## 4.2 LangGraphによる状態遷移

第1章で述べたとおり、LCELの `|` はループを表現できない。ここからはLangGraphの領分である。LangGraphの発想は明快で、**アプリケーションを状態遷移機械として書く**。状態の型を定め、状態を更新するノードを置き、ノード間の遷移をエッジで結ぶ。

### 状態を定義する

```python
from typing import Annotated, TypedDict
from langgraph.graph import StateGraph, START, END
from langgraph.graph.message import add_messages

class AgentState(TypedDict):
    messages: Annotated[list, add_messages]  # 追記される
    plan: list[str]                          # 上書きされる
    retries: int                             # 上書きされる
```

`Annotated` に添えた関数が**リデューサー**で、ノードが返した値を既存の状態にどう合成するかを決める。`add_messages` は追記、指定がなければ上書きである。この区別が状態設計の核心になる。会話履歴は追記されなければ文脈が消え、計画は上書きされなければ再計画が反映されない。

状態には**次の一手を決めるのに必要なものだけ**を置く。検索結果の全文のような大きなデータを状態に積むと、チェックポイントの容量が膨らみ、再開が遅くなる。参照だけを置いて実体は外部に持つのが基本である。

### ノードとエッジを組む

```python
from langgraph.prebuilt import ToolNode

def call_model(state: AgentState) -> dict:
    response = model.bind_tools(tools).invoke(state["messages"])
    return {"messages": [response]}  # 差分だけを返す

def should_continue(state: AgentState) -> str:
    last = state["messages"][-1]
    if not getattr(last, "tool_calls", None):
        return END
    if state["retries"] >= 5:
        return "give_up"
    return "tools"

builder = StateGraph(AgentState)
builder.add_node("agent", call_model)
builder.add_node("tools", ToolNode(tools))
builder.add_node("give_up", summarize_failure)

builder.add_edge(START, "agent")
builder.add_conditional_edges("agent", should_continue, ["tools", "give_up", END])
builder.add_edge("tools", "agent")  # ここが循環
graph = builder.compile()
```

ノードは状態全体を受け取り、**更新したい差分だけを辞書で返す**。合成はリデューサーが行う。この規約のおかげで、ノードは互いを知らずに済み、単体でテストできる。

`add_conditional_edges` が分岐を担う。`should_continue` はただのPython関数であり、LLMを呼んでもよいし、単純な条件式でもよい。**制御フローの判断をコードで書けるところはコードで書く**のが、エージェントを予測可能に保つこつである。上の例では、再試行回数の上限判定をモデルに委ねていない。

### チェックポイントが本番との境目

ここまでは、LCELでも頑張れば書けなくはない。決定的な違いは**永続化**である。チェックポインターを付けると、LangGraphはノードを実行するたびに状態を保存する。

```python
from langgraph.checkpoint.postgres import PostgresSaver

with PostgresSaver.from_conn_string(DB_URL) as checkpointer:
    graph = builder.compile(checkpointer=checkpointer)
    config = {"configurable": {"thread_id": f"case-{case_id}"}}
    result = graph.invoke({"messages": [("user", question)]}, config)
```

`thread_id` が会話の識別子になる。同じ `thread_id` で呼び出せば、保存された状態の続きから実行が進む。これが効いてくる場面は三つある。

- **会話の継続。** 履歴の管理コードを自前で書かずに済む
- **障害からの再開。** プロセスが落ちても、最後に完了したノードの次から再開する。数十分かかる処理でやり直しが発生しない
- **中断と再開。** 人間の承認待ちで処理を止め、承認が下りてから再開する。この仕組みが4.4節の土台になる

チェックポイントは実行履歴でもある。過去の状態に戻して別の分岐を試す、いわゆるタイムトラベルも可能で、エージェントのデバッグでは強力な道具になる。**プロトタイプではメモリ上の実装で構わないが、本番ではデータベースに載せる。** ここを最初から見据えておくと、後の移行が楽になる。

## 4.3 マルチエージェント——分割の設計

エージェントに機能を足していくと、どこかで頭打ちになる。ツールが二十を超えると選択を誤り始め、システムプロンプトは数百行に膨れ、ある業務のために書いた指示が別の業務の挙動を壊す。

分割の判断基準は、**ツールの数が増えたから**ではなく、**必要な文脈と判断基準が別物になったから**である。財務データの照会と、コードの修正と、顧客への返信文の作成は、参照すべき情報も、良し悪しの基準も違う。一つのプロンプトに同居させる理由がない。

### Supervisorパターン

中央の監督役が、利用者の要求を読んで担当を選び、結果を受け取って次の担当を決める。担当エージェントどうしは直接やり取りしない。

```python
class Route(BaseModel):
    """次に作業させる担当。"""
    next: Literal["researcher", "analyst", "writer", "FINISH"]
    instruction: str = Field(description="担当への具体的な作業指示")

def supervisor(state: AgentState) -> Command:
    decision = model.with_structured_output(Route).invoke(
        [SYSTEM_PROMPT, *state["messages"]]
    )
    if decision.next == "FINISH":
        return Command(goto=END)
    return Command(
        goto=decision.next,
        update={"messages": [HumanMessage(content=decision.instruction)]},
    )
```

利点は制御のしやすさである。流れが一箇所に集まるため、追跡もログの設計も単純になる。停止条件も監督役が一元的に持てる。欠点はレイテンシで、担当が交代するたびに監督役のLLM呼び出しが挟まる。また監督役自身が単一障害点になり、その判断が誤れば全体が誤る。

実務では**この構成を既定にしてよい。** 制御可能性の価値は、思っているより高い。

### Peer-to-Peerパターン

各エージェントが「別の担当に引き継ぐ」ためのツールを持ち、自分で次の担当を決める。監督役を経由しないぶん往復が減り、専門家どうしが直接やり取りする形になる。

```python
@tool
def transfer_to_analyst(context: str) -> Command:
    """調査結果の数値分析を分析担当に引き継ぐ。"""
    return Command(
        goto="analyst",
        update={"messages": [ToolMessage(content=context, tool_call_id=...)]},
        graph=Command.PARENT,
    )
```

柔軟性は高いが、制御は難しくなる。二つのエージェントが互いに引き継ぎ合って往復が止まらない、という状況が容易に起きる。採用するなら、**引き継ぎの総回数に上限を設け**、引き継ぎ履歴を状態に持って循環を検知する仕組みを最初から入れておく。

### 文脈の受け渡しが実際の設計課題

パターンの選択よりも実装の質を左右するのが、**エージェント間で何を渡すか**である。素朴に会話履歴を全部渡すと、トークンが膨らむだけでなく、他の担当の試行錯誤や失敗が文脈に混ざって判断を濁す。

渡すべきは、**受け手が仕事をするのに必要な情報だけ**である。構造化した引き継ぎ票を型で定義してしまうのがよい。

```python
class Handoff(BaseModel):
    """担当間の引き継ぎ票。"""
    task: str = Field(description="依頼する作業の内容")
    findings: list[str] = Field(description="ここまでに判明した事実。推測は含めない")
    constraints: list[str] = Field(default_factory=list, description="守るべき制約や前提")
    unresolved: list[str] = Field(default_factory=list, description="未解決で、確認が必要な点")
```

**推測と事実を分けて渡す**のが要点である。前段のエージェントの仮説が事実として次段に伝わると、誤りが連鎖して増幅する。

## 4.4 人間の介入を組み込む

不可逆な操作を伴う業務では、エージェントを完全に自律させる選択肢はない。送金、外部への送信、本番データの更新——これらの手前で止まり、人間の判断を待ち、承認されたら続きを実行する仕組みが要る。

素朴な実装は難しい。承認には時間がかかる。数時間後かもしれず、翌営業日かもしれない。その間プロセスを生かしておくわけにはいかない。**待っている間、状態はどこかに保存されていなければならない。**

これが4.2節のチェックポイントが効く場面である。LangGraphの `interrupt()` は、その位置で実行を止め、状態を保存し、呼び出し元に制御を返す。

```python
from langgraph.types import interrupt, Command

def approve_payment(state: AgentState) -> dict:
    decision = interrupt({
        "type": "payment_approval",
        "payee": state["payment"]["payee"],
        "amount_jpy": state["payment"]["amount_jpy"],
        "evidence": state["payment"]["evidence"],
    })
    if decision["approved"]:
        return {"payment_status": "approved"}
    return {
        "payment_status": "rejected",
        "messages": [HumanMessage(content=f"却下理由: {decision['comment']}")],
    }
```

`interrupt()` に渡した辞書は、そのまま承認画面に表示する材料として呼び出し元に返る。プロセスはここで終わってよい。承認が下りたら、同じ `thread_id` に対して再開を指示する。

```python
graph.invoke(Command(resume={"approved": True, "comment": ""}), config)
```

再開時、`interrupt()` の呼び出しは渡された値を返して処理が続く。承認待ちの間、アプリケーションのプロセスは何も保持していなくてよい。

### 承認画面に何を出すか

技術的な仕組みより難しいのが、**人間が正しく判断できる情報を出すこと**である。「この操作を承認しますか？ はい／いいえ」だけの画面は、機械的に「はい」を押す習慣を作るだけで、ガバナンスの実態を失わせる。

承認画面には最低限、次を出す。

- **これから何が起きるか。** 実行される操作を、技術的な表現ではなく業務の言葉で
- **なぜそう判断したか。** 根拠となった文書や数値へのリンク
- **間違っていた場合に何が起きるか。** 取り消せるのか、取り消せないのか

そして、**承認・却下だけでなく「修正して続行」を用意する**。金額が一桁違うだけなら、却下して最初からやり直させるより、人間が値を直して続けるほうが速い。`interrupt()` の戻り値は任意の構造を取れるので、修正後の値をそのまま受け取って状態に反映できる。

### どこに置くか

介入点は、多すぎても少なすぎても機能しない。多すぎれば承認が形骸化し、少なすぎればガバナンスが効かない。判断基準は**可逆性と影響範囲**である。取り消せない操作、外部に出ていく操作、金額や件数が閾値を超える操作に絞る。閾値による自動承認（少額は自動、一定額以上は承認必須）を組み合わせると、現実的な運用に落ちる。

さらに、承認の記録は監査証跡として残す。誰がいつ何を承認したか、そのとき提示された情報は何だったか。チェックポイントがこの記録の土台になるが、監査要件がある領域では、業務的な承認ログを別に持つほうが確実である。

次章では、ここまで作ったものを実際のサービスに載せる段階——非同期処理とストリーミング、そしてコンテキストの安全性とトークン制限に進む。

::: tip この章のポイント
- エージェントの実体は、終了条件を満たすまでLLM呼び出しとツール実行を繰り返すループである
- ReActは適応力が高い一方で見通しが悪く、Plan-and-Solveは見通しがよいが前提が崩れると脆い。手順が長い業務では再計画型の折衷を採る
- LangGraphでは状態の型・リデューサー・ノード・条件付きエッジで循環を表現する。コードで書ける制御判断はモデルに委ねない
- チェックポインターによる状態の永続化が、会話の継続・障害からの再開・承認待ちの中断を同時に解決する
- エージェントを分割する基準はツールの数ではなく、必要な文脈と判断基準が別物になったかどうかである
- Supervisorパターンを既定とし、引き継ぎでは事実と推測を分けた構造化データを渡す
- 人間の介入は `interrupt()` と永続化で実装し、承認画面には操作内容・根拠・可逆性を出したうえで「修正して続行」を用意する
:::
