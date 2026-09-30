import pytest

from docchat.domain.sentences import MAX_SENTENCE_CHARS, split_sentences


def _texts(text: str) -> list[str]:
    return [text[start:end] for start, end in split_sentences(text)]


def test_splits_on_terminal_punctuation_before_a_capital() -> None:
    text = "Die Leuchte ist hell. Sie hat IP66! Wirklich? Ja."
    assert _texts(text) == ["Die Leuchte ist hell.", "Sie hat IP66!", "Wirklich?", "Ja."]


def test_keeps_decimal_numbers_abbreviations_and_ordinals_together() -> None:
    text = "Sie kostet ca. 12.50 Euro, z.B. im Handel. Am 3. Oktober gilt Nr. 5 laut Abb. 2. Ende."
    assert _texts(text) == [
        "Sie kostet ca. 12.50 Euro, z.B. im Handel.",
        "Am 3. Oktober gilt Nr. 5 laut Abb. 2. Ende.",
    ]


def test_lowercase_continuation_is_not_a_boundary() -> None:
    assert _texts("Version 2. danach mehr.") == ["Version 2. danach mehr."]


def test_closing_quotes_stay_with_the_sentence() -> None:
    assert _texts('Er sagte: "Gut." Dann ging er.') == ['Er sagte: "Gut."', "Dann ging er."]


def test_paragraph_breaks_and_list_items_are_boundaries() -> None:
    text = "Titel ohne Punkt\n\nErster Absatz\nmit Umbruch\n- Punkt eins\n- Punkt zwei\n2) Zwei"
    assert _texts(text) == [
        "Titel ohne Punkt",
        "Erster Absatz\nmit Umbruch",
        "- Punkt eins",
        "- Punkt zwei",
        "2) Zwei",
    ]


def test_spans_are_trimmed_and_empty_input_gives_nothing() -> None:
    assert split_sentences("") == []
    assert split_sentences("  \n \n ") == []
    assert _texts("  Hallo Welt.   ") == ["Hallo Welt."]


def test_long_runs_without_punctuation_are_capped() -> None:
    text = " ".join(["Tabellenzeile"] * 200)
    parts = _texts(text)
    assert len(parts) > 1
    assert all(len(p) <= MAX_SENTENCE_CHARS for p in parts)
    assert " ".join(parts) == text


def test_a_single_huge_token_is_cut_hard() -> None:
    parts = _texts("x" * (MAX_SENTENCE_CHARS * 2 + 5))
    assert [len(p) for p in parts] == [MAX_SENTENCE_CHARS, MAX_SENTENCE_CHARS, 5]


@pytest.mark.parametrize("text", ["A. B. C.", "Wort", "a\nb", "1.2.3"])
def test_spans_are_ordered_and_inside_the_text(text: str) -> None:
    spans = split_sentences(text)
    assert spans == sorted(spans)
    assert all(0 <= s < e <= len(text) for s, e in spans)


def test_many_sentences_in_a_large_block_split_in_linear_time() -> None:
    import time

    text = "Die Leuchte ist hell. " * 5000 + "a." + " " * 100_000 + "b"
    started = time.perf_counter()
    spans = split_sentences(text)
    assert time.perf_counter() - started < 0.5
    assert len(spans) > 5000


def test_forced_cuts_split_where_the_text_has_no_punctuation() -> None:
    text = "Technische Daten\nDie Mira L hat IP66. Sie wiegt 7,4 kg."
    assert _texts(text) == ["Technische Daten\nDie Mira L hat IP66.", "Sie wiegt 7,4 kg."]
    spans = split_sentences(text, extra_cuts=[17])
    assert [text[a:b] for a, b in spans] == [
        "Technische Daten",
        "Die Mira L hat IP66.",
        "Sie wiegt 7,4 kg.",
    ]
