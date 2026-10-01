from docchat.domain.line_breaks import PageLine
from docchat.domain.page_title import page_title


def _page(rows: list[tuple[str, float]], leading: float = 1.4) -> tuple[str, list[PageLine]]:
    """Lines top to bottom: (text, font size)."""
    lines, start, top = [], 0, 50.0
    for text, size in rows:
        lines.append(PageLine(start, start + len(text), ((50, 50 + 5 * len(text)),), top, size, 20))
        start += len(text) + 1
        top += size * leading
    return "\n".join(t for t, _ in rows), lines


def test_the_line_in_clearly_larger_type_names_the_page() -> None:
    text, lines = _page(
        [
            ("Weitere Varianten finden Sie online.", 8.5),
            ("Hallenleuchten | Highbay 11 midi", 7.6),
            ("Highbay 11 midi", 13.2),
            ("Technische Daten", 9.5),
            ("Farbtemperatur 4.000 K", 6.6),
            ("Lichtstrom 10.000 | ... | 34.500 lm", 6.6),
            ("Lichtausbeute Bis zu 210lm/W", 6.6),
        ]
    )
    assert page_title(text, lines) == "Highbay 11 midi"


def test_a_title_over_several_lines_is_joined() -> None:
    text, lines = _page(
        [("Office 21", 44), ("Design aus", 44), ("einem Guss.", 44)]
        + [("Maximale Flexibilität in einer einheitlichen Designsprache.", 10)] * 3
    )
    assert page_title(text, lines) == "Office 21 Design aus einem Guss."


def test_no_title_without_a_clear_size_step_or_without_letters() -> None:
    text, lines = _page([("Weitere Varianten", 8.5), ("Zubehör und Preise der Leuchten", 6.6)] * 3)
    assert page_title(text, lines) == ""
    text, lines = _page([("56", 30), ("Text der Seite in normaler Größe.", 7)])
    assert page_title(text, lines) == ""
    assert page_title("", []) == ""


def test_separate_titles_are_listed_and_long_ones_shortened() -> None:
    text, lines = _page(
        [
            ("Silica 21 Round", 13),
            ("Text " * 10, 6.6),
            ("Silica 21 Linear", 13),
            ("Text " * 10, 6.6),
        ]
    )
    assert page_title(text, lines) == "Silica 21 Round / Silica 21 Linear"
    text, lines = _page([("Ein sehr langer Titel aus Wörtern", 20)] * 5 + [("Text " * 30, 8)] * 3)
    title, joined = page_title(text, lines), " ".join(["Ein sehr langer Titel aus Wörtern"] * 5)
    assert len(title) <= 120 and joined.startswith(title) and joined[len(title)] == " "
