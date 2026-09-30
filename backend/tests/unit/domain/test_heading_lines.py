from docchat.domain.heading_lines import heading_line_cuts

TEXT = (
    "Technische Daten\nDie Mira L hat IP66 und eine Schlagfestigkeit\n"
    "von IK09. Gewicht 7,4 kg.\nWartung\nDie Module sind tauschbar."
)


def test_larger_short_lines_are_cut_off_as_headings() -> None:
    sizes = [20, 11, 11, 14, 11]
    cuts = heading_line_cuts(TEXT, sizes)
    lines = TEXT.split("\n")
    first_end = len(lines[0]) + 1
    wartung = TEXT.index("Wartung")
    assert cuts == [first_end, wartung, wartung + len("Wartung") + 1]


def test_a_page_in_one_size_has_no_headings() -> None:
    assert heading_line_cuts(TEXT, [11] * 5) == []


def test_long_large_lines_are_body_text_not_headings() -> None:
    text = "Ein sehr langer Absatz in großer Schrift, " * 5 + "\nKlein."
    assert heading_line_cuts(text, [20, 11]) == []


def test_sizes_that_do_not_match_the_lines_are_ignored() -> None:
    assert heading_line_cuts(TEXT, [20, 11]) == []
