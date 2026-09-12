---
title: 出典
sidebar_label: 出典
appendix: true
---

# 出典

本文で挙げた記述のうち、一次情報との突き合わせが済んだものをここに並べる。確認が済んでいない
記述は、リポジトリの `REVIEW.md` に作業中の一覧として残している。

## 第1章 AI for Scienceとは何か

- Nina Miolane, "The fifth era of science: Artificial scientific intelligence," *PLOS Biology*, 2025.
  [journals.plos.org](https://journals.plos.org/plosbiology/article?id=10.1371/journal.pbio.3003230)

  科学を経験的・理論的・計算論的・データ駆動の四つの時代として整理し、その先に「第五の時代」
  を置く枠組みの出典。本章で引いた「猛烈に働くインターン生」の比喩も、この論考のものである。

## 第14章 気候・地球科学×AI

- "Aurora 1.5: Fine-Tuning a Foundation Model for Medium-Range Ensemble Weather Prediction,"
  Microsoft Research, 2026.
  [microsoft.com](https://www.microsoft.com/en-us/research/publication/aurora-1-5-fine-tuning-a-foundation-model-for-medium-range-ensemble-weather-prediction/)

  22の予報変数の追加（4変数から26変数へ）、1時間刻みの時間解像度、確率的アンサンブル予報の
  導入はいずれもこの発表による。評価対象の88.9%でECMWFのアンサンブル予報を上回り、熱帯低気圧
  の進路誤差を16%削減したことも報告されている。

## 第20章 AI駆動ラボの実際

- "An autonomous laboratory for the accelerated synthesis of inorganic materials," *Nature*, 2023.
  [nature.com](https://www.nature.com/articles/s41586-023-06734-w)

  17日間の稼働で58種類の目標物質のうち41種類を合成したという成果の出典。ローレンス・バークレー
  国立研究所のヤン・ゼン氏とゲルブランド・シーダー氏らのチームによるもので、Google DeepMindとの
  共同研究でもある。装置の構成（16種類・計28台）は、制御ソフトウェアAlabOSについての報告による。

## 第22章・第29章 自律的発見

- "The AI Scientist: Towards Fully Automated AI Research," *Nature*, 2026年3月25日.
  [sakana.ai](https://sakana.ai/ai-scientist-nature/) /
  [nature.com](https://www.nature.com/articles/d41586-026-00899-w)

  Sakana AIと、ブリティッシュコロンビア大学・Vector Institute・オックスフォード大学の共同研究。
  自動査読者の仕組みと、基盤モデルの性能向上に伴って生成される論文の質も上がるという
  「科学のスケーリング則」が報告されている。

## 第26章 再現性・信頼性・ハルシネーション問題

- "Fabricated citations: an audit across 2·5 million biomedical papers," *The Lancet*, 2026.
  [thelancet.com](<https://www.thelancet.com/journals/lancet/article/PIIS0140-6736(26)00603-3/fulltext>)

  架空の参考文献を含む論文の割合が、2023年の2828件に1件から2025年に458件に1件、2026年の最初の
  7週間に277件に1件へと増えたという報告。コロンビア大学のマキシム・トパズ氏らによる、約250万件
  を対象にした監査である。

- GPTZero, "100 new hallucinations in NeurIPS 2025 accepted papers," 2026.
  [gptzero.me](https://gptzero.me/news/neurips/)

  NeurIPS 2025の採択論文5290本のうち4841本を検査し、53本に合計100件の捏造された引用を検出した
  という分析。採択論文のおよそ1%に当たる。

- "The case of the fake references in an ethics journal," *Retraction Watch*, 2025年12月.

  Journal of Academic Ethicsに掲載された論文で、29件の参考文献のうち少なくとも19件が実在しない
  ことを、独立研究者のエルヤ・モーレ氏が突き止めた事例。2026年7月には、医療倫理の専門誌が
  同様に存在しない参考文献を含む論文を撤回している。
