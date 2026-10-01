from docchat.domain.highlight_geometry import trusted_rects


def lines(count: int, *, start: float = 0.1) -> list[tuple[float, float, float, float]]:
    return [(0.1, start + i * 0.015, 0.5, 0.012) for i in range(count)]


def test_a_paragraph_flowing_down_the_page_is_trusted() -> None:
    rects = lines(4)
    assert trusted_rects(rects) == tuple(rects)


def test_one_column_break_is_fine() -> None:
    rects = [*lines(3, start=0.8), *lines(2, start=0.1)]
    assert trusted_rects(rects) == tuple(rects)


def test_lines_jumping_around_like_a_table_are_not_trusted() -> None:
    rects = [*lines(2, start=0.5), *lines(2, start=0.1), *lines(2, start=0.7), *lines(2, start=0.2)]
    assert trusted_rects(rects) == ()


def test_a_collage_of_many_lines_is_not_trusted() -> None:
    assert trusted_rects(lines(13)) == ()


def test_a_page_sized_rectangle_is_not_trusted() -> None:
    assert trusted_rects([(0.0, 0.0, 0.9, 0.9)]) == ()


def test_no_rectangles_stay_none() -> None:
    assert trusted_rects([]) == ()


def test_cells_of_one_table_row_count_as_one_line() -> None:
    row = [(0.1 + i * 0.06, 0.4, 0.04, 0.012) for i in range(9)]
    rects = [*row, *[(x, y + 0.015, w, h) for x, y, w, h in row]]
    assert trusted_rects(rects) == tuple(rects)
