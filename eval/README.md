# Retrieval evaluation set

This folder holds data only: the PDFs, the golden question set and the sources of the fictional datasheets. The runner lives in the backend as `docchat.cli.run_eval` (`make eval`). It indexes the documents, asks the questions and writes `results/latest.json`.

## Documents

| File | Language | Source |
| --- | --- | --- |
| `documents/eu-2019-2020-de.pdf` | de | Commission Regulation (EU) 2019/2020, German |
| `documents/eu-2019-2020-en.pdf` | en | Commission Regulation (EU) 2019/2020, English |
| `documents/nordlicht-viaro.pdf` | de | Fictional street luminaire datasheet |
| `documents/nordlicht-arenis.pdf` | en | Fictional floodlight datasheet |
| `documents/nordlicht-galerion.pdf` | de | Fictional tunnel luminaire datasheet |

The SHA-256 of every file is recorded in `golden.json`.

### Regulation (EU) 2019/2020

Commission Regulation (EU) 2019/2020 of 1 October 2019 laying down ecodesign requirements for light sources and separate control gears, CELEX 32019R2020, OJ L 315, 5.12.2019, p. 209. Both files are the unmodified Official Journal PDFs (32 pages each) from the Publications Office of the European Union.

Downloaded from `http://publications.europa.eu/resource/celex/32019R2020` with the headers `Accept: application/pdf` and `Accept-Language: deu` or `eng`, which resolve to:

- DE: `http://publications.europa.eu/resource/cellar/33be9f4b-1729-11ea-8c1f-01aa75ed71a1.0004.01/DOC_1`, SHA-256 `a3b9fa129200f46f062d1f99d46b63249337475c90ce7104bb761472226e5a6a`
- EN: `http://publications.europa.eu/resource/cellar/33be9f4b-1729-11ea-8c1f-01aa75ed71a1.0006.01/DOC_1`, SHA-256 `9686587e823f371ba8524f5d34ee1701c33eced4d81941376c44d75de61d620d`

Reuse notice: © European Union, https://eur-lex.europa.eu/. EU legal texts published on EUR-Lex and by the Publications Office may be reused under Commission Decision 2011/833/EU, provided the source is acknowledged. Only the version published in the Official Journal of the European Union is authentic.

### Fictional datasheets

The three datasheets of "Nordlicht Leuchten GmbH (fiktiv)" were written for this project. The maker, the products, the article numbers and all values are invented. They are not Siteco products or products of any other real manufacturer, and every page footer says so. They exist to test retrieval on exact tokens (article numbers, IP and IK codes, standards) and to make retrieval tell similar products apart.

The sources are in `datasheets/<slug>.md`; `<!-- page -->` separates pages. To rebuild the PDFs (deterministic, byte-identical on rerun):

```
cd backend && uv run python -m tests.eval.build_datasheets
```

After changing a datasheet, update its `sha256` in `golden.json` and check the labels again.

## golden.json

```
{
  "version": 1,
  "description": "...",
  "documents": [{"id", "file", "sha256", "language", "fictional", "title"}],
  "questions": [{"id", "category", "language", "question", "relevant", "keywords", "scope", "previous", "note"}]
}
```

- `relevant`: alternatives as `{"document": id, "pages": [n, ...]}`, 1-based PDF page numbers. A retrieved chunk is a hit if its document and page match any entry. Regulation questions list the pages of both language versions. Empty for unanswerable questions.
- `keywords`: 1 to 3 strings that occur verbatim (case-insensitive, whitespace normalised) on a relevant page of every listed document. A later answer eval uses them. Empty for unanswerable questions.
- `scope`: `null` searches all documents; a list of document ids limits the search, like a chat restricted to selected documents.
- `previous`: for follow-up questions, the previous user question in the conversation; `null` otherwise.
- `note`: why the label is what it is.

Categories:

- `factual`: plain questions about a fact in one document.
- `exact_code`: questions that hinge on an exact token, such as an article number, a standard or a limit value (`Psb`, `0,5 W`, `Pst LM`, `NL-4012-4KB10`).
- `cross_lingual`: question and document in different languages. German questions on the English regulation and English questions on the German one use `scope`; questions on the single-language datasheets search everything.
- `follow_up`: only answerable together with `previous`.
- `unanswerable`: the answer is in no document (prices, a variant that does not exist, penalties the regulation does not set). The expected behaviour is to say so.

## How the labels were checked

Labels are at page level, not chunk level, so different chunking strategies stay comparable. Every regulation page used as a label was read to confirm it answers the question. A script extracted each page with pypdfium2 (stripping U+FFFE and soft hyphens, joining words split at line ends and collapsing whitespace) and confirmed that every keyword occurs on at least one relevant page of each listed document.
