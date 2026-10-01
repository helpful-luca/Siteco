from docchat.domain.text_cleanup import clean_page_text, normalize_text


def _check_map(raw: str, text: str, raw_index: tuple[int, ...]) -> None:
    assert len(raw_index) == len(text)
    assert list(raw_index) == sorted(raw_index)
    assert all(0 <= i < len(raw) for i in raw_index)


def test_pdfium_hyphenation_markers_join_the_word() -> None:
    for marker in ("\ufffe", "\u0002"):
        raw = f"Schutz{marker}art IP66"
        cleaned = clean_page_text(raw)
        assert cleaned.text == "Schutzart IP66"
        _check_map(raw, cleaned.text, cleaned.raw_index)
        assert cleaned.raw_index[6] == 7  # "a" after the marker


def test_crlf_becomes_one_newline_mapped_to_the_cr() -> None:
    raw = "Zeile eins\r\nZeile zwei"
    cleaned = clean_page_text(raw)
    assert cleaned.text == "Zeile eins\nZeile zwei"
    assert cleaned.raw_index[10] == 10
    assert cleaned.raw_index[11] == 12


def test_raw_span_translates_clean_offsets_back() -> None:
    raw = "Fire\ufffeproof door.\r\nNext."
    cleaned = clean_page_text(raw)
    start = cleaned.text.index("door")
    raw_start, raw_count = cleaned.raw_span(start, start + len("door."))
    assert raw[raw_start : raw_start + raw_count] == "door."
    raw_start, raw_count = cleaned.raw_span(0, len("Fireproof"))
    assert raw[raw_start : raw_start + raw_count] == "Fire\ufffeproof"


def test_nfd_umlauts_become_nfc() -> None:
    raw = "Gro\u0308ße"
    cleaned = clean_page_text(raw)
    assert cleaned.text == "Größe"
    assert cleaned.raw_index == (0, 1, 2, 4, 5)


def test_ligatures_expand_and_map_to_the_same_raw_char() -> None:
    cleaned = clean_page_text("\ufb01nal")
    assert cleaned.text == "final"
    assert cleaned.raw_index[:2] == (0, 0)


def test_controls_soft_hyphens_and_odd_spaces_are_normalized() -> None:
    raw = "a\u00adb\tc\u00a0d\x07e   f"
    assert clean_page_text(raw).text == "ab c de f"


def test_normalize_text_applies_the_same_rules_without_a_map() -> None:
    raw = " Zeile \r\n  zwei\rdrei Gro\u0308ße \ufb01x\x00"
    assert normalize_text(raw) == "Zeile\nzwei\ndrei Größe fix"
    assert normalize_text(raw) == clean_page_text(raw.replace("\r\n", "\n")).text


def test_empty_text() -> None:
    cleaned = clean_page_text("")
    assert cleaned.text == ""
    assert cleaned.raw_index == ()


def test_hidden_characters_lines_and_their_spaces_are_left_out() -> None:
    raw = "Links sichtbar Rechts\r\nVerborgen ganz\r\nWieder da\r\nVerborgen"
    hidden = {i for word in ("Rechts", "Verborgen ganz") for i in _positions(raw, word)}
    hidden |= set(range(raw.rindex("Verborgen"), len(raw)))
    cleaned = clean_page_text(raw, hidden)
    assert cleaned.text == "Links sichtbar\nWieder da"
    _check_map(raw, cleaned.text, cleaned.raw_index)
    assert all(i not in hidden for i in cleaned.raw_index)


def _positions(raw: str, word: str) -> range:
    start = raw.index(word)
    return range(start, start + len(word))


def test_every_unicode_space_becomes_a_plain_space() -> None:
    # Catalogs set "50 %" with a thin space; the question types "50 %".
    raw = "50 % und 105 W, 3 K x y"
    assert clean_page_text(raw).text == "50 % und 105 W, 3 K x y"
    assert normalize_text(raw) == clean_page_text(raw).text


def test_a_white_bullet_before_c_is_the_degree_sign() -> None:
    raw = "-25..+50◦C und ◦ Punkt"
    cleaned = clean_page_text(raw)
    assert cleaned.text == "-25..+50°C und ◦ Punkt"
    assert normalize_text(raw) == cleaned.text
