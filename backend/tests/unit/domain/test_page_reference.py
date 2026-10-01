import pytest

from docchat.domain.page_reference import find_page_request, named_document_ids


@pytest.mark.parametrize(
    ("question", "pages"),
    [
        ("Was steht auf Seite 56?", (56,)),
        ("was steht auf seite 56", (56,)),
        ("Zeig mir S. 56", (56,)),
        ("Inhalt von S.56 bitte", (56,)),
        ("What is on page 56?", (56,)),
        ("what does p. 56 say", (56,)),
        ("Fasse Seiten 56 bis 58 zusammen", (56, 57, 58)),
        ("pages 10-12 please", (10, 11, 12)),
        ("Seite 3 und Seite 9", (3, 9)),
        ("Seiten 56 und 58", (56, 58)),
    ],
)
def test_page_references_in_german_and_english(question: str, pages: tuple[int, ...]) -> None:
    request = find_page_request(question)
    assert request is not None
    assert request.pages == pages


@pytest.mark.parametrize(
    "question",
    [
        "Welche Schutzart hat die Mira L?",
        "Seitenwand aus Stahl",
        "Pages of the manual are fine",
        "Seite",
        "Seite 0",
        "Leuchte mit 56 W",
        "Wie viel kostet S. Meier?",
    ],
)
def test_other_questions_are_not_page_requests(question: str) -> None:
    assert find_page_request(question) is None


def test_a_huge_range_is_limited() -> None:
    request = find_page_request("Seiten 1 bis 900")
    assert request is not None
    assert len(request.pages) <= 20


def test_documents_named_in_the_question() -> None:
    docs = {
        "a": "SIT_KAT_Beleuchtungsloesungen_DE_2026.pdf",
        "b": "Mira L Datenblatt.pdf",
    }
    assert named_document_ids("Was steht auf Seite 4 im Mira L Datenblatt?", docs) == ["b"]
    assert named_document_ids("Seite 4 im Katalog SIT_KAT_Beleuchtungsloesungen_DE_2026", docs) == [
        "a"
    ]
    assert named_document_ids("Was steht auf Seite 4?", docs) == []


def test_a_typographic_dash_makes_a_range() -> None:
    request = find_page_request(f"Seiten 56 {chr(0x2013)} 58")
    assert request is not None and request.pages == (56, 57, 58)
