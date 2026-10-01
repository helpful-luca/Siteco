"""The eval results for the Quality page."""

import logging

from fastapi import APIRouter
from pydantic import ValidationError

from docchat.api.dependencies import ContainerDep
from docchat.api.schemas.common import ErrorEnvelope
from docchat.api.schemas.evaluation import EvalOut, GenerationResultsFile
from docchat.domain.errors import AppError, ErrorCode

router = APIRouter(prefix="/api", tags=["eval"])
log = logging.getLogger("docchat.eval")


@router.get("/eval", response_model=EvalOut, responses={404: {"model": ErrorEnvelope}})
def evaluation(container: ContainerDep) -> EvalOut:
    """`eval/results/latest.json` from the image, `stale` when the retrieval settings changed
    since, and the generation results when someone ran that eval too."""
    report = container.evaluation.report()
    generation = None
    if report.generation is not None:
        try:
            generation = GenerationResultsFile.model_validate(report.generation)
        except ValidationError:
            log.warning("eval_generation_invalid")
    try:
        return EvalOut.model_validate(
            {**report.latest, "stale": report.stale, "generation": generation}
        )
    except ValidationError as exc:
        log.warning("eval_results_invalid")
        raise AppError(ErrorCode.EVAL_RESULTS_MISSING) from exc
