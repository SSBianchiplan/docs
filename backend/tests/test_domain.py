import re

import pytest

from app.services.coding import MaskError, build_code, mask_to_regex, next_revision_label
from app.services.comment_check import heuristic
from app.services.ocr.titleblock import extract, same_code


def test_mascara_gera_codigo_que_casa_com_a_regex() -> None:
    mask = "{PROJ}-{DISC}-{TIPO}-{SEQ:4}"
    code = build_code(mask, proj="P100", disc="MEC", tipo="DE", seq=7)
    assert code == "P100-MEC-DE-0007"
    assert re.fullmatch(mask_to_regex(mask), code)


def test_mascara_com_area_e_literal() -> None:
    mask = "{PROJ}.{AREA}-{DISC}{TIPO}-{SEQ:3}"
    code = build_code(mask, proj="GX", area="U100", disc="E", tipo="LI", seq=12)
    assert code == "GX.U100-ELI-012"
    assert re.fullmatch(mask_to_regex(mask), code)


@pytest.mark.parametrize("mask", ["{PROJ}-{DISC}", "{SEQ:4}-{SEQ:2}", "{PROJ}#{SEQ:4}"])
def test_mascara_invalida(mask: str) -> None:
    with pytest.raises(MaskError):
        mask_to_regex(mask)


def test_sequencial_estoura_largura() -> None:
    with pytest.raises(MaskError):
        build_code("{PROJ}-{SEQ:2}", proj="P1", disc="", tipo="", seq=100)


@pytest.mark.parametrize(("cur", "nxt"), [(None, "A"), ("A", "B"), ("Z", "AA"), ("AZ", "BA"), ("0", "1"), ("9", "10")])
def test_proxima_revisao(cur: str | None, nxt: str) -> None:
    assert next_revision_label(cur) == nxt


def test_carimbo() -> None:
    txt = """TÍTULO: ARRANJO GERAL BOMBAS B-101A/B    DES. JSILVA
             P100-MEC-DE-0001   REV. B   ESCALA 1:50   FOLHA 1 DE 3   A1"""
    tb = extract(txt, r"^[A-Z0-9]{2,12}-[A-Z0-9]{1,4}-[A-Z0-9]{2,4}-[0-9]{4}$")
    assert tb.code == "P100-MEC-DE-0001"
    assert tb.revision == "B"
    assert tb.escala == "1:50"
    assert tb.folha == "1/3"
    assert tb.formato == "A1"
    assert tb.title and tb.title.startswith("ARRANJO GERAL")


def test_heuristica_comentario_atendido() -> None:
    old = "Bocal N3 diâmetro 4 pol\nFlange classe 150"
    new = "Bocal N3 diâmetro 6 pol\nFlange classe 300"
    comments = [{"id": "c1", "body": "Alterar flange para classe 300"},
                {"id": "c2", "body": "Incluir nota sobre pintura epóxi"}]
    got = heuristic(comments, old, new)
    assert [v.comment_id for v in got] == ["c1"]
    assert got[0].confidence <= 0.6   # heurística nunca se declara muito confiante


def test_carimbo_em_ingles_e_confusao_ocr() -> None:
    txt = "TITLE: GENERAL ARRANGEMENT PUMP HOUSE UTE0O1-MEC-DE-0001 REV.B SCALE 1:50 SHEET1OF3 Al"
    tb = extract(txt, r"^[A-Z0-9]{2,12}-[A-Z0-9]{1,4}-[A-Z0-9]{2,4}-[0-9]{4}$")
    assert tb.title == "GENERAL ARRANGEMENT PUMP HOUSE"
    assert (tb.revision, tb.escala, tb.folha, tb.formato) == ("B", "1:50", "1/3", "A1")
    assert tb.code and same_code(tb.code, "UTE01-MEC-DE-0001")
    assert not same_code("UTE01-MEC-DE-0007", "UTE01-ELE-DF-0002")
