"""Each installed method, end to end, on the synthetic deck. Skipped in CI and
for any method whose environment does not exist yet."""
import pytest

from backend.eval.parser_bench import execute, tools
from backend.tests.unit.parser_bench_fixtures import TITLES, make_deck


@pytest.mark.slow
@pytest.mark.parametrize("tool_id", list(tools.TOOLS))
def test_method_reads_the_title_of_every_page(tool_id, tmp_path):
    tool = tools.TOOLS[tool_id]
    if tool.paid:
        pytest.skip("paid method: never run in tests")
    if not tools.is_ready(tool):
        pytest.skip(f"{tool_id} not installed: {tools.missing(tool)}")
    if tool.downloads_models and not tools.cache_mb(tool):
        pytest.skip(f"{tool_id}: its models are not downloaded (tests never download models)")
    timeout = 1800 if tool.group == "heavy" else 600
    result = execute.invoke(tool, make_deck(tmp_path / "deck.pdf"), timeout=timeout)
    assert sorted(result.pages) == [1, 2, 3, 4, 5, 6]
    for page, title in zip(range(1, 7), TITLES):
        assert title.split()[0].lower() in result.pages[page].lower(), (tool_id, page)
