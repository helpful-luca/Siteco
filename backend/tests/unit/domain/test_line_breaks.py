from itertools import pairwise

from docchat.domain.line_breaks import PageLine, line_break_cuts


def _layout(
    rows: list[tuple[str, list[tuple[float, float]], float]], size: float = 10, leading: float = 12
) -> tuple[str, list[PageLine]]:
    """Lines top to bottom: (text, x ranges of the text runs, first word width)."""
    lines, start = [], 0
    for i, (text, spans, word) in enumerate(rows):
        top = 100 + i * leading
        lines.append(PageLine(start, start + len(text), tuple(spans), top, size, word))
        start += len(text) + 1
    return "\n".join(row[0] for row in rows), lines


def _pieces(text: str, cuts: list[int]) -> list[str]:
    bounds = [0, *cuts, len(text)]
    return [text[a:b].strip() for a, b in pairwise(bounds)]


def test_wrapped_prose_stays_together() -> None:
    text, lines = _layout(
        [
            ("Unsere Experten übersetzen Ihre Anforderungen in", [(50, 450)], 30),
            ("ein maßgeschneidertes Licht- und Elektrokonzept,", [(50, 460)], 10),
            ("ob Trockenbau oder Systemdecke.", [(50, 300)], 10),
        ]
    )
    assert line_break_cuts(text, lines) == []


def test_a_short_line_whose_next_word_would_have_fit_ends_its_unit() -> None:
    text, lines = _layout(
        [
            ("Ihre maßgeschneiderte Sanierungslösung.", [(50, 250)], 30),
            ("Unsere Experten übersetzen Ihre Anforderungen in", [(50, 450)], 30),
            ("ein maßgeschneidertes Licht- und Elektrokonzept.", [(50, 460)], 10),
        ]
    )
    assert _pieces(text, line_break_cuts(text, lines)) == [
        "Ihre maßgeschneiderte Sanierungslösung.",
        "Unsere Experten übersetzen Ihre Anforderungen in\n"
        "ein maßgeschneidertes Licht- und Elektrokonzept.",
    ]


def test_table_rows_are_units_of_their_own() -> None:
    text, lines = _layout(
        [
            ("Farbtemperatur 4.000 K", [(57, 105), (168, 191)], 40),
            ("Lichtstrom 7.200 lm", [(57, 90), (168, 230)], 30),
            ("4000 ≥ 80 11500 64 180 DALI 2", [(63, 77), (104, 108), (111, 251)], 14),
            ("4000 ≥ 80 7200 41 178 DALI 2", [(63, 77), (104, 108), (111, 251)], 14),
        ]
    )
    assert _pieces(text, line_break_cuts(text, lines)) == [
        "Farbtemperatur 4.000 K",
        "Lichtstrom 7.200 lm",
        "4000 ≥ 80 11500 64 180 DALI 2",
        "4000 ≥ 80 7200 41 178 DALI 2",
    ]


def test_close_runs_are_one_segment_and_a_hanging_indent_continues_the_item() -> None:
    text, lines = _layout(
        [
            ("ʶ Anpassung von Gehäuseabmessungen, -farben,", [(67, 70), (75, 260)], 5),
            ("Montagezubehör für bestehende Deckensysteme", [(76, 265)], 70),
            ("ʶ Veränderung der Lichtfarbe", [(67, 70), (75, 200)], 5),
        ]
    )
    assert _pieces(text, line_break_cuts(text, lines)) == [
        "ʶ Anpassung von Gehäuseabmessungen, -farben,\nMontagezubehör für bestehende Deckensysteme",
        "ʶ Veränderung der Lichtfarbe",
    ]


def test_column_jumps_size_changes_and_gaps_end_the_unit() -> None:
    text = "Erste Spalte unten\nZweite Spalte oben\nKlein gedruckt\nWeit darunter"
    lines = [
        PageLine(0, 18, ((50, 300),), 700, 10, 30),
        PageLine(19, 37, ((320, 570),), 100, 10, 30),  # above: the next column
        PageLine(38, 52, ((320, 570),), 112, 6, 30),  # much smaller type
        PageLine(53, 66, ((320, 570),), 200, 6, 30),  # far below
    ]
    assert len(line_break_cuts(text, lines)) == 3


def test_lines_that_do_not_match_the_text_give_no_cuts() -> None:
    assert line_break_cuts("a\nb", [PageLine(0, 1, ((0, 5),), 0, 10, 5)]) == []


def test_a_balanced_line_that_ends_a_word_short_of_the_margin_still_wraps() -> None:
    text, lines = _layout(
        [
            ("Unsere Experten übersetzen Ihre Anforderungen in", [(52, 453)], 30),
            ("ein maßgeschneidertes Licht- und Elektrokonzept,", [(52, 464)], 12),
            ("und Systemen an Ihre Einbausituation, ob Trockenbau.", [(52, 470)], 18),
        ]
    )
    assert line_break_cuts(text, lines) == []


def test_a_heading_over_two_lines_is_one_unit_and_the_size_change_ends_it() -> None:
    text = "Weitere Varianten\nfinden Sie online.\nDer Text darunter ist klein."
    lines = [
        PageLine(0, 17, ((108, 160),), 100, 14, 40),
        PageLine(18, 36, ((108, 170),), 116, 14, 30),
        PageLine(37, 65, ((108, 200),), 134, 8, 20),
    ]
    assert line_break_cuts(text, lines) == [37]
