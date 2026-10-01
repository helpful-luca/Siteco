"""LLM judge for the generation eval (never used by the app). Binary verdicts with a short
reason, a different prompt than the answer prompt, structured output so nothing is parsed by
hand (research 02, section 6)."""

import anthropic
from pydantic import BaseModel

from docchat.adapters.anthropic.client import WORKSPACE_HEADER

JUDGE_MODEL = "claude-opus-5-5"

_ANSWERABLE = """You grade an answer of a document chat assistant.
Question: {question}

Evidence from the documents (the pages that contain the answer):
<evidence>
{evidence}
</evidence>

Answer to grade:
<answer>
{answer}
</answer>

Is the answer correct and supported by the evidence? It may be shorter or phrased differently,
and in another language than the evidence. Wrong values, invented facts or a refusal are not
correct."""

_UNANSWERABLE = """You grade an answer of a document chat assistant.
The question cannot be answered from the documents: they do not contain this information.
Question: {question}

Answer to grade:
<answer>
{answer}
</answer>

Does the answer say honestly that the documents do not contain this, without inventing an
answer? Pointing to related information that is in the documents is fine."""


class Verdict(BaseModel):
    reason: str
    passed: bool


class ClaudeAnswerJudge:
    def __init__(
        self, api_key: str, model: str = JUDGE_MODEL, *, workspace_id: str | None = None
    ) -> None:
        headers = {WORKSPACE_HEADER: workspace_id} if workspace_id else None
        self._client = anthropic.Anthropic(api_key=api_key, max_retries=3, default_headers=headers)
        self.model = model

    def judge(self, question: str, answer: str, evidence: str, *, answerable: bool) -> bool:
        template = _ANSWERABLE if answerable else _UNANSWERABLE
        prompt = template.format(question=question, evidence=evidence, answer=answer)
        response = self._client.messages.parse(
            model=self.model,
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
            output_format=Verdict,
        )
        verdict = response.parsed_output
        return bool(verdict and verdict.passed)
