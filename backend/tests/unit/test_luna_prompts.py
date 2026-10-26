from backend.services.luna import prompts
from backend.services.luna.validate import PageIndex

L = "11111111-1111-1111-1111-111111111111"
VIEW = prompts.LessonView(
    lecture_id=L, title="Normalisation {weird}", served="en",
    titles=[(1, "Why normalise?"), (2, "Functional dependency")],
    pages=PageIndex(totals={L: 2}, texts={(L, 2): 'X → Y holds if {rows} "agree"'}),
)
MEMORY = [{"id": "m1", "kind": "preference", "text": "examples before definitions"}]


def test_plan_prompt_renders_with_braces_in_data_and_carries_memory():
    p = prompts.plan_prompt(VIEW, page=2, opener="exam Friday", memory=MEMORY, locale="de")
    assert "examples before definitions" in p and "exam Friday" in p and "German" in p
    assert "Normalisation {weird}" in p


def test_turn_prompt_names_the_step_the_reading_position_and_the_check_result():
    step = {"id": "s1", "kind": "look", "title": "What an FD says", "target": {"lecture_id": L, "page": 2}, "status": "current"}
    p = prompts.turn_prompt(
        VIEW, step=step, plan=[step], recent=[{"role": "learner", "content": {"text": "why?"}}], recap="",
        memory=MEMORY, reading_at=2, text="why?", check_result={"question": "Q", "correct": False},
        related=[], locale="en",
    )
    assert "What an FD says" in p and "page 2" in p and "answered it wrong" in p and "why?" in p


def test_wrap_and_practice_prompts_render():
    assert "memory_add" in prompts.wrap_prompt(VIEW, plan=[], turns=[], memory=MEMORY, locale="en")
    assert '"questions"' in prompts.practice_prompt(VIEW, shaky=["partial keys"], missed=["Q"], locale="en")


def test_memory_block_is_plain():
    assert prompts.memory_block([]) == "nothing yet"
    assert prompts.memory_block(MEMORY) == "- [m1] (preference) examples before definitions"


def test_say_is_asked_for_as_plain_text():
    from backend.services.luna import prompts

    for template in (prompts.PLAN, prompts.TURN):
        assert '"say" is plain text, no markdown' in template


def test_plan_prompt_plans_content_pages_after_a_title_slide():
    p = prompts.plan_prompt(VIEW, page=1, opener="", memory=[], locale="en")
    assert "title, agenda or overview slide" in p
    assert "Put steps on different pages" in p
    assert "first step a `look`" in p


def test_wrap_prompt_keeps_page_numbers_out_of_the_text():
    p = prompts.wrap_prompt(VIEW, plan=[], turns=[], memory=[], locale="en")
    assert "Do not write page numbers in the text; the page goes in the page field." in p


def test_german_prompts_say_seite_never_folie():
    rule = 'Sag immer "Seite" / "Seiten", nie "Folie" / "Folien".'
    de = [
        prompts.plan_prompt(VIEW, page=1, opener="", memory=[], locale="de"),
        prompts.turn_prompt(VIEW, step=None, plan=[], recent=[], recap="", memory=[], reading_at=None, text=None,
                            check_result=None, related=[], locale="de"),
        prompts.wrap_prompt(VIEW, plan=[], turns=[], memory=[], locale="de"),
        prompts.practice_prompt(VIEW, shaky=[], missed=[], locale="de"),
    ]
    assert all(rule in p for p in de)
    assert rule not in prompts.plan_prompt(VIEW, page=1, opener="", memory=[], locale="en")
