import json
from pathlib import Path

from docchat.cli.export_openapi import build_openapi
from docchat.domain.errors import ErrorCode

CONTRACT = Path(__file__).resolve().parents[3] / "contracts" / "openapi.json"


def test_openapi_contains_error_codes_and_envelope() -> None:
    schemas = build_openapi()["components"]["schemas"]
    assert set(schemas["ErrorCode"]["enum"]) == {code.value for code in ErrorCode}
    assert {"ErrorEnvelope", "ErrorBody", "ReadyOut", "ConfigOut"} <= set(schemas)


def test_committed_contract_is_up_to_date() -> None:
    committed = json.loads(CONTRACT.read_text("utf-8"))
    assert committed == build_openapi(), "contract drift: run `make api-types`"
