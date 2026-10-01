# Retrieval evaluation

Draft of the README section. The numbers are what `make eval` measured on 2026-10-01 at commit 0e8ef49
(`eval/results/latest.json`); latencies vary by a millisecond or two between runs.

## What is measured

- **Data:** Commission Regulation (EU) 2019/2020 on ecodesign for light sources in German and
  English (Official Journal PDFs, 32 pages each) and three fictional datasheets of a made up
  manufacturer (2 to 3 pages each, one English, two German). 71 pages, 176 chunks. Sources,
  licence and checksums: `eval/README.md`.
- **Questions:** 32, hand-checked, 17 German and 15 English: 9 facts, 8 exact codes (IP66,
  EN 13201-2, article numbers, limit values), 6 cross-lingual (German question on English text
  and the other way round), 5 follow-ups (only make sense with the question before), 4 not
  answerable from the documents.
- **Labels are pages**, not chunks, so chunking variants stay comparable. A result is a hit when
  it comes from a labelled page.
- **Pipeline:** the production code end to end in a temporary data dir: upload, pdfium, chunker,
  Granite embeddings, LanceDB, the follow-up query and the source selection of a real answer.
  The variants only swap the ranking (vector, BM25, hybrid) or the BM25 stemmer.
- **Metrics:** Hit@1 and Hit@5 (right page first, or within the first five), MRR@10, and
  **in sources**: a right page among the 8 passages Claude actually gets after deduplication
  and the per-document cap. Latency is query embedding plus search on an Apple M4.

## Results (28 answerable questions)

| Configuration | Hit@1 | Hit@5 | MRR@10 | In sources | p50 / p95 |
|---|---|---|---|---|---|
| **Hybrid, German stemmer (default)** | 0.46 | 0.89 | 0.66 | **0.93** | 10 / 12 ms |
| Hybrid, English stemmer | 0.50 | 0.89 | 0.69 | 0.93 | 11 / 13 ms |
| Hybrid, no stemming | 0.50 | 0.89 | 0.68 | 0.96 | 11 / 12 ms |
| Vectors only | 0.46 | 0.86 | 0.67 | 0.89 | 10 / 14 ms |
| BM25 only, German stemmer | 0.57 | 0.79 | 0.68 | 0.86 | 2 / 3 ms |
| BM25 only, English stemmer | 0.46 | 0.75 | 0.61 | 0.86 | 2 / 3 ms |
| BM25 only, no stemming | 0.50 | 0.79 | 0.64 | 0.82 | 2 / 2 ms |

By kind of question, default configuration against each retriever alone (in sources):

| Category | Questions | Hybrid | Vectors only | BM25 only |
|---|---|---|---|---|
| Facts | 9 | 0.89 | 0.78 | 1.00 |
| Exact codes | 8 | 1.00 | 0.88 | 1.00 |
| Cross-lingual | 6 | 0.83 | 1.00 | 0.33 |
| Follow-ups | 5 | 1.00 | 1.00 | 1.00 |

## What it means

- **Hybrid is the only configuration without a blind spot.** Vectors alone lose one exact
  code and two facts that BM25 finds by their tokens; BM25 alone collapses on
  cross-lingual questions (2 of 6 in the sources, Hit@5 0.17), because a German question shares
  no words with an English datasheet. Hybrid keeps 1.00 on exact codes and 0.83 cross-lingual.
  That is the reason the app pays for two retrievers; the gate asserts that hybrid finds at
  least what each of them finds alone.
- **Where hybrid loses: the first place.** BM25 with the German stemmer puts the right page
  first more often (0.57 against 0.46). Reciprocal rank fusion mixes in pages that are only
  similar in meaning: the other language version of the regulation, a sister datasheet with the
  same vocabulary. Cross-lingual questions never get the right page first (Hit@1 0), although 5
  of 6 have it within the first five. For an answer this matters less than it looks, because
  Claude reads all 8 passages; a reranker (phase 14) is the measured next step for the first
  place.
- **Where it fails:** two questions miss the sources completely. "Ab welchem Datum gelten die
  Ökodesign-Anforderungen?" has its date repeated in every block of Annex II, so the labelled
  pages compete with each other and land at rank 10. "Which older regulations does 2019/2020
  repeal, and from which date?" asked against the German text finds the right article only at
  rank 12.
- **Stemming is within noise here.** No stemming gets one question more into the sources
  (0.96), the English stemmer the same as German. With 28 questions one question is 3.6
  points, so the default stays German (the stemmer matches German compounds like
  "Straßenleuchten" to "Straßenleuchte", spike 12) until a larger set shows a real difference.
- **Full context changes nothing for single datasheets:** 13 questions are about one datasheet
  of about 900 tokens; the 8 best passages already are the whole document, so both reach 1.00.
  The full-context mode exists for "summarize this document", which retrieval metrics do not
  measure.
- **Search is not the slow part:** 10 ms median, almost all of it embedding the question; BM25
  alone takes 2 ms.
- **How solid this is:** a small set, hand-checked, built for a direction and as a regression
  guard, not as a benchmark. Unanswerable questions are not scored by retrieval (there is no
  page to find and RRF scores are not calibrated); refusing is the model's job.

## Generation eval (prepared, not run yet)

`make eval-generation` (needs `RUN_LIVE=1` and `ANTHROPIC_API_KEY`, costs a few dollars) asks
all 32 questions through the app's own answer path with Haiku 4.5, Sonnet 5.5 and Opus 5.5 and
lets Claude Opus judge each answer against the labelled pages: correctness, citations on a
right page, honest refusals on the 4 unanswerable questions, cost and response time. It writes
`eval/results/generation.json`. It never runs
in CI.

## Reproduce

```
make eval        # writes eval/results/latest.json (about 15 s on an M4)
make eval-gate   # the CI gate: thresholds just below the numbers above
```
