import pytest

from docchat.domain.ocr_text import OcrWord, ocr_section, parse_tesseract_tsv

_COLUMNS = "level page_num block_num par_num line_num word_num left top width height conf text"
_HEADER = _COLUMNS.replace(" ", "\t")


def _row(
    level: int, block: int, par: int, line: int, word: int, box: str, conf: str, text: str
) -> str:
    return f"{level}\t1\t{block}\t{par}\t{line}\t{word}\t{box}\t{conf}\t{text}"


TSV = "\n".join(
    [
        _HEADER,
        _row(1, 0, 0, 0, 0, "0\t0\t1000\t2000", "-1", ""),
        _row(4, 1, 1, 1, 0, "100\t100\t500\t40", "-1", ""),
        _row(5, 1, 1, 1, 1, "100\t100\t200\t40", "96.1", "Die"),
        _row(5, 1, 1, 1, 2, "320\t100\t280\t40", "95.0", "Leuchte"),
        _row(5, 1, 1, 2, 1, "100\t160\t150\t40", "91.5", "hat"),
        _row(5, 1, 1, 2, 2, "260\t150\t140\t50", "90.0", "IP66."),
        _row(5, 1, 1, 2, 3, "420\t160\t100\t40", "12.0", "   "),
        _row(5, 2, 1, 1, 1, "100\t400\t300\t40", "88.0", "Zweiter"),
        _row(5, 2, 1, 1, 2, "420\t400\t300\t40", "88.0", "Absatz."),
    ]
)


def test_parses_word_rows_and_skips_empty_words() -> None:
    words = parse_tesseract_tsv(TSV)
    assert [w.text for w in words] == ["Die", "Leuchte", "hat", "IP66.", "Zweiter", "Absatz."]
    assert words[0] == OcrWord("Die", 100, 100, 200, 40, (1, 1, 1))


def test_ignores_malformed_rows() -> None:
    assert parse_tesseract_tsv(_HEADER + "\n5\t1\tnot\ta\trow") == []
    assert parse_tesseract_tsv("") == []


def test_builds_lines_and_paragraphs() -> None:
    section = ocr_section(parse_tesseract_tsv(TSV), width=1000, height=2000, page=3)
    assert section.text == "Die Leuchte\nhat IP66.\n\nZweiter Absatz."
    assert section.page == 3
    assert section.precise_highlight is True


def test_sentence_rects_are_one_union_per_line_normalized_to_the_image() -> None:
    section = ocr_section(parse_tesseract_tsv(TSV), width=1000, height=2000, page=1)
    first, second = section.sentences
    assert section.text[first.start : first.end] == "Die Leuchte\nhat IP66."
    assert first.rects == (
        (0.1, 0.05, 0.5, 0.02),
        (0.1, 0.075, 0.3, 0.025),
    )
    assert section.text[second.start : second.end] == "Zweiter Absatz."
    assert second.rects == ((0.1, 0.2, 0.62, 0.02),)


def test_empty_result_has_no_text() -> None:
    section = ocr_section([], width=100, height=100, page=1)
    assert section.text == ""
    assert not section.has_text


def test_text_is_nfc_normalized() -> None:
    words = [OcrWord("Gerät", 0, 0, 10, 10, (1, 1, 1))]
    assert ocr_section(words, width=100, height=100, page=1).text == "Gerät"


def test_rejects_an_empty_image() -> None:
    with pytest.raises(ValueError):
        ocr_section([], width=0, height=10, page=1)
