from docchat.domain.errors import ERROR_SPECS, AppError, ErrorCode


def test_every_error_code_has_a_spec() -> None:
    assert set(ERROR_SPECS) == set(ErrorCode)


def test_app_error_exposes_status_and_retryable_from_spec() -> None:
    err = AppError(ErrorCode.SERVICE_STARTING, "model loading", retry_after=3)
    assert err.status == 503
    assert err.retryable is True
    assert err.retry_after == 3
    assert err.params == {}


def test_error_codes_are_upper_snake() -> None:
    for code in ErrorCode:
        assert code.value == code.name
        assert code.value.upper() == code.value
