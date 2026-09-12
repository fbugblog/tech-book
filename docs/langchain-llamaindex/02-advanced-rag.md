---
title: 第2章 高度なRAGアーキテクチャ
sidebar_label: 第2章 高度なRAG
---

# 第2章 高度なRAGアーキテクチャ

RAGの精度が出ないとき、多くの開発者はまずプロンプトを直そうとする。だが実際には、原因の大半は生成ではなく**検索**にある。LLMに渡した文脈に答えが含まれていなければ、どんなプロンプトを書いてもモデルは答えられない。この章では、検索の失敗を四つの層——分割、埋め込み、クエリ、順序付け——に分けて捉え、それぞれに対する具体的な対処を積み上げる。

## 2.1 ナイーブRAGの限界——分割と埋め込みの設計

最小構成のRAGは、文書を固定長に切り、埋め込みベクトルにして、質問との類似度が高い上位数件を取ってくる。この構成が破綻する理由は、大きく二つに分けられる。

### 分割が意味の単位と一致しない

固定長の分割は、文書の論理構造を無視して切る。「第3条の但し書き」が本文と別のチャンクに落ち、条件と結論が離ればなれになる。表がヘッダー行と切り離され、数値の列だけが残る。コードのフェンスが途中で切れる。こうして作られたチャンクは、単体では意味をなさない。

対処は「サイズを調整する」ことではなく、**文書の構造に沿って切る**ことである。

```python
from langchain_text_splitters import (
    MarkdownHeaderTextSplitter,
    RecursiveCharacterTextSplitter,
)

# 1段目: 見出し階層で分ける。見出しはメタデータとして各チャンクに残る
header_splitter = MarkdownHeaderTextSplitter(
    headers_to_split_on=[("#", "章"), ("##", "節"), ("###", "項")]
)
sections = header_splitter.split_text(markdown_text)

# 2段目: 長すぎる節だけを、段落・文の境界を優先して再分割する
splitter = RecursiveCharacterTextSplitter(
    chunk_size=800, chunk_overlap=120, separators=["\n\n", "\n", "。", "、", ""]
)
chunks = splitter.split_documents(sections)
```

日本語を扱ううえで見落としやすいのが、`separators` の既定値が英語を想定している点である。既定のままだと空白と改行でしか区切られず、日本語の長い段落は文字数だけで切られてしまう。「。」と「、」を区切り候補に加えるだけで、切断面の質は目に見えて変わる。

`chunk_size` と `chunk_overlap` の選び方には、二つの相反する力が働く。チャンクが小さいほど埋め込みベクトルは焦点が定まり、検索の精度が上がる。一方、チャンクが小さいほど、取得した断片だけでは回答に必要な文脈が足りなくなる。

この矛盾を、サイズの妥協点を探ることで解こうとすると行き詰まる。**検索する単位と、LLMに渡す単位を分ける**のが定石である。小さなチャンクで検索し、ヒットしたら、その親にあたる大きな単位を渡す。

```python
# LlamaIndex: 検索は文単位、渡すのは前後を含む窓
from llama_index.core.node_parser import SentenceWindowNodeParser
from llama_index.core.postprocessor import MetadataReplacementPostProcessor

parser = SentenceWindowNodeParser.from_defaults(
    window_size=3, window_metadata_key="window", original_text_metadata_key="original"
)
# 検索後に、ヒットした文をその前後3文を含む窓へ差し替える
postprocessor = MetadataReplacementPostProcessor(target_metadata_key="window")
```

LangChainでは `ParentDocumentRetriever`、LlamaIndexでは `SentenceWindowNodeParser` や `AutoMergingRetriever` が、この「小さく引いて大きく渡す」を実装している。名前は違うが狙いは同じである。

> チャンクサイズの最適値を探すのではなく、検索の単位と生成の単位を切り離す。

### 埋め込みモデルの選択

埋め込みモデルの選択は、あとから変更するコストが最も高い決定である。モデルを変えればインデックス全体の作り直しになる。選ぶ際に見るべき観点は四つある。

- **対象言語での実測性能。** 英語中心のベンチマークの順位は、日本語の社内文書での性能を保証しない。多言語対応をうたうモデルでも、日本語の実力には幅がある。自分の文書から数十件の質問と正解チャンクの組を作り、Recall@10を測るのが最も確実である
- **非対称性への対応。** 質問文と文書は長さも文体も異なる。この非対称性を前提に学習されたモデルは、検索用と文書用で別の接頭辞（`query:` / `passage:` など）を要求することがある。これを付け忘れると精度が目に見えて落ちる
- **入力長の上限。** 上限を超えた分は黙って切り捨てられる実装が多い。チャンクサイズと整合させる
- **次元数と運用コスト。** 次元が大きいほど表現力は上がるが、ベクトルストアの容量と検索コストも増える。次元削減に対応したモデルなら、精度の低下幅を測ったうえで縮める判断もできる

ここで重要なのは、**評価セットを先に作る**という順序である。評価セットがなければ、埋め込みモデルもチャンクサイズもリランカーも、すべて勘で選ぶことになる。数十件の質問と、それに答えるために必要なチャンクのIDを人手で紐づけた表があるだけで、以降の意思決定はすべて数字で決まる。

## 2.2 クエリを変換する——HyDE、書き換え、複数展開

分割と埋め込みを整えてもなお残るのが、**質問文と文書の表現のずれ**である。利用者は「有給って繰り越せる？」と書き、規程には「年次有給休暇の未消化分の取扱い」と書いてある。この二つのベクトルは、意味的には近くても、埋め込み空間では思ったほど近くない。

対処は、質問文をそのまま検索に使うのをやめることである。三つの代表的な手法がある。

### HyDE——仮想の答えで検索する

HyDE（Hypothetical Document Embeddings）は、質問に対する**答えをLLMに一度でっち上げさせ、その仮想文書のベクトルで検索する**手法である。生成された答えの中身は事実として正しくなくてよい。狙いは、答えの文体・語彙が、質問文よりも実際の文書に近いという性質を利用する点にある。

```python
from llama_index.core.indices.query.query_transform import HyDEQueryTransform
from llama_index.core.query_engine import TransformQueryEngine

hyde = HyDEQueryTransform(include_original=True)
engine = TransformQueryEngine(index.as_query_engine(), query_transform=hyde)
```

`include_original=True` を付けて、元の質問のベクトルも併用するのが安全側の設定である。仮想文書が的外れな方向に振れたときの保険になる。

HyDEが効きやすいのは、質問が短く口語的で、文書が形式的な文体で書かれている場合である。逆に、固有名詞や型番をピンポイントで探す検索では、LLMが存在しない型番を作文して精度を下げることがある。**万能ではなく、クエリの種類で使い分ける**。

### クエリ書き換え——会話文脈の解決

対話型のアプリケーションでは、そもそも質問が単体で成立していない。「それって過去分も対象？」という発話は、直前のやり取りを見ないと何を検索すべきか決まらない。

```python
rewrite_prompt = ChatPromptTemplate.from_messages([
    ("system",
     "会話履歴を踏まえ、最後の発話を単体で検索可能な質問文に書き換えよ。"
     "指示語は具体的な語に置き換え、質問文だけを出力せよ。"),
    ("placeholder", "{history}"),
    ("human", "{question}"),
])

standalone_question = rewrite_prompt | model | StrOutputParser()
```

この書き換えは、対話型RAGでは省略できない工程である。実装を忘れたまま多ターンの会話に入ると、二つ目以降の質問で検索が突然壊れる。

### 複数クエリ展開とRRFによる統合

一つの質問には、複数の言い換えがありうる。どれが当たるかは事前に分からない。ならば全部投げればよい、というのが複数クエリ展開である。

```python
from langchain.retrievers.multi_query import MultiQueryRetriever

retriever = MultiQueryRetriever.from_llm(retriever=base_retriever, llm=model)
```

問題は統合である。各クエリの検索結果はスコアの尺度が揃っておらず、単純に足し合わせても意味がない。ここで使うのがRRF（Reciprocal Rank Fusion）で、スコアではなく**順位**だけを使って統合する。

```python
def reciprocal_rank_fusion(ranked_lists: list[list[str]], k: int = 60) -> list[str]:
    scores: dict[str, float] = {}
    for docs in ranked_lists:
        for rank, doc_id in enumerate(docs):
            scores[doc_id] = scores.get(doc_id, 0.0) + 1.0 / (k + rank + 1)
    return sorted(scores, key=scores.get, reverse=True)
```

`k` は上位の順位差をどれだけ重く見るかを決める定数で、60が慣例的な既定値として広く使われている。スコアの正規化が不要で、異なる検索方式の結果でもそのまま混ぜられるのがRRFの強みであり、次節のハイブリッド検索でも同じ仕組みが使える。

クエリ変換にはコストとレイテンシの代償がある。複数クエリ展開は検索回数を数倍にし、HyDEはLLM呼び出しを1回増やす。**質問の種類を先に分類し、必要なものにだけ適用する**構成が、実務では現実的である。

## 2.3 ハイブリッド検索とリランク

### ベクトル検索が落とすもの

ベクトル検索は意味の近さを捉えるのが得意な反面、**完全一致で引きたい語**に弱い。型番「XR-4120B」、エラーコード「E0x5F」、社内の略称、担当者名——これらは学習時に十分な頻度で現れていないため、埋め込み空間で近傍に置かれる保証がない。

この弱点を補うのがBM25に代表されるキーワード検索である。語の出現頻度と文書頻度から適合度を測る古典的な手法で、珍しい語ほど重く効く。ベクトル検索とは失敗の仕方が違うため、組み合わせると互いの穴を埋める。

```python
from langchain.retrievers import EnsembleRetriever
from langchain_community.retrievers import BM25Retriever

bm25 = BM25Retriever.from_documents(chunks)
bm25.k = 10
vector = vectorstore.as_retriever(search_kwargs={"k": 10})

hybrid = EnsembleRetriever(retrievers=[bm25, vector], weights=[0.4, 0.6])
```

`EnsembleRetriever` は内部でRRFによって結果を統合する。重みは文書の性質で決まる。専門用語や型番が頻出する技術文書ではBM25側を重く、口語的な問い合わせが多い場合はベクトル側を重くする。

日本語でBM25を使うときの注意点が一つある。**トークナイザーを日本語対応にしないと、ほとんど機能しない。** 既定の空白区切りでは、日本語の文が丸ごと一語として扱われてしまう。MeCabやSudachiによる形態素解析、あるいは文字N-gramを噛ませる必要がある。

```python
import MeCab

wakati = MeCab.Tagger("-Owakati")
bm25 = BM25Retriever.from_documents(
    chunks, preprocess_func=lambda text: wakati.parse(text).strip().split()
)
```

Elasticsearchやpgvectorのように、全文検索とベクトル検索を1つのエンジンで扱える基盤を使っているなら、統合をアプリケーション側で書かずにストア側のハイブリッド検索機能に寄せるほうが、運用は単純になる。

### リランクで順序を作り直す

ハイブリッド検索まで組めば、**正解を含む候補を拾う**確率（再現率）はかなり高くなる。だが依然として、候補の中での**順序**は信用できない。埋め込みベクトルは質問と文書を別々にベクトル化して距離を測るだけで、両者を突き合わせて読んではいないからだ。

リランクは、この最終工程を担う。質問と文書を**1つの入力として同時に**モデルに読ませ、適合度を直接スコアリングする。クロスエンコーダーと呼ばれる構成である。計算コストは高いが、対象は上位数十件に絞られているので実用に耐える。

```python
from llama_index.core.postprocessor import SentenceTransformerRerank

reranker = SentenceTransformerRerank(model="BAAI/bge-reranker-v2-m3", top_n=5)
engine = index.as_query_engine(similarity_top_k=30, node_postprocessors=[reranker])
```

LangChainでは `ContextualCompressionRetriever` に圧縮器としてリランカーを挿す形になる。

```python
from langchain.retrievers import ContextualCompressionRetriever
from langchain_cohere import CohereRerank

compressed = ContextualCompressionRetriever(
    base_compressor=CohereRerank(model="rerank-v3.5", top_n=5),
    base_retriever=hybrid,
)
```

ここで設計上の要点は、**一次検索の件数を思い切って増やすこと**である。リランカーを入れるなら、一次検索は30件から50件を取り、その中から上位5件に絞る。一次検索を5件のままリランクしても、順序が入れ替わるだけで、そもそも拾えていない正解は最後まで出てこない。

> 一次検索は再現率を、リランクは適合率を担当する。役割を分けたうえで、前段は広く、後段は厳しく。

多段構成が増えるほど、どの段で落ちたのかを追える仕組みが要る。各段の入出力をトレースに残し、評価セットに対して段ごとの再現率を出せるようにしておく。「リランカーを入れたら精度が下がった」という現象は、一次検索の件数を増やし忘れているか、リランカーの対応言語が合っていないかのどちらかであることが多い。

## 2.4 LlamaIndexの階層型インデックス

ここまでは「チャンクを平らに並べて引く」前提だった。だが質問の種類によっては、この前提自体が合わない。

「この契約書の解約条項は？」は、特定の箇所を引く質問である。一方で「この40件の報告書から、今期の主要なリスクを挙げよ」は、全体を読まないと答えられない。後者にベクトル検索の上位5件を渡しても、残りの35件を無視した答えしか返らない。

LlamaIndexが複数のインデックス型を用意しているのは、この違いに対応するためである。

| インデックス | 構造 | 向く質問 |
| --- | --- | --- |
| `VectorStoreIndex` | 平坦なベクトル集合 | 特定の記述を引く質問 |
| `SummaryIndex` | 全ノードの逐次リスト | 全体の要約・網羅が要る質問 |
| `DocumentSummaryIndex` | 文書ごとの要約＋本体 | まず文書を絞り、次に中を引く質問 |
| `PropertyGraphIndex` | エンティティと関係のグラフ | 関係をたどる必要がある質問 |

### 要約による二段構え

`SummaryIndex` は全ノードを順に読み、`tree_summarize` などの応答モードで階層的にまとめ上げる。網羅性は高いがコストも高く、全文書に対して毎回走らせる使い方は現実的ではない。

実務で効くのは `DocumentSummaryIndex` による二段構えである。文書ごとにLLMで要約を作っておき、検索ではまず要約層で対象文書を絞り、選ばれた文書の中だけをチャンク単位で引く。数百から数千の文書があり、それぞれが独立した主題を持つ場合——たとえば案件ごとの報告書や製品ごとのマニュアル——に向く。

### グラフで関係をたどる

「A社と取引のある子会社が関与した案件のうち、監査で指摘が出たものは？」のような質問は、ベクトル検索では原理的に答えにくい。答えに必要な情報が1つのチャンクに揃っておらず、複数の文書にまたがる**関係**をたどる必要があるからだ。

`PropertyGraphIndex` は、文書からエンティティと関係を抽出してグラフを作り、検索時にそのグラフをたどる。抽出にLLMを使うため構築コストは高く、抽出の誤りがそのまま検索の誤りになる。適用は、関係をたどる質問が業務上重要で、かつエンティティの種類がある程度決まっている領域に絞るべきである。

### ルーターで振り分ける

複数のインデックスを持ったら、質問に応じてどれを使うかを決める層が要る。LlamaIndexの `RouterQueryEngine` は、各エンジンに付けた説明文を根拠にLLMに選択させる。

```python
from llama_index.core.query_engine import RouterQueryEngine
from llama_index.core.tools import QueryEngineTool

router = RouterQueryEngine.from_defaults(
    query_engine_tools=[
        QueryEngineTool.from_defaults(
            query_engine=vector_engine,
            description="規程や手順書の特定の条項・記述を引くのに使う。",
        ),
        QueryEngineTool.from_defaults(
            query_engine=summary_engine,
            description="複数文書を横断して全体傾向を要約するのに使う。",
        ),
    ]
)
```

ここで精度を決めるのは、選択のロジックではなく `description` の記述である。曖昧な説明を書けば振り分けを誤る。**どんな質問を投げるべきか**を具体的に書くのがこつであり、これは次章で扱うツール設計とまったく同じ原理である。

ルーターの発想を一歩進めると、「検索するかどうか」「どの検索を何回行うか」自体をLLMに委ねる構成になる。それはもうパイプラインではなくエージェントであり、第4章の主題になる。その前に次章で、LLMの出力を型で縛り、ツールを安全に呼ばせるための土台を固める。

::: tip この章のポイント
- RAGの精度問題の大半は生成ではなく検索にあり、分割・埋め込み・クエリ・順序付けの四層に分けて原因を切り分ける
- チャンクサイズの最適値を探すより、検索する単位と生成に渡す単位を分ける設計のほうが効く
- 日本語では、テキスト分割の区切り文字とBM25のトークナイザーを日本語向けに設定しないと、既定のままでは性能が出ない
- HyDE・クエリ書き換え・複数クエリ展開は質問文と文書の表現のずれを埋める手法で、RRFは順位だけを使って異種の検索結果を統合する
- 一次検索は再現率、リランクは適合率を担当する。リランカーを入れるなら一次検索の件数を大きく増やす
- 特定箇所を引く質問と全体の網羅が要る質問は別のインデックス型が向いており、振り分けの精度はツールの説明文の具体性で決まる
:::
