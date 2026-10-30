"""Consistency checks for the M2 templates and M4 persona cards (no scene data needed)."""
from pathlib import Path

import yaml

SRC = Path(__file__).resolve().parents[1] / "src" / "ha"
PERSONAS = yaml.safe_load((SRC / "resident" / "personas.yaml").read_text())
TEMPLATES = yaml.safe_load((SRC / "enrich" / "templates.yaml").read_text())

REQUIRED = {"id", "name", "footprint", "kinematics", "reach"}


def test_persona_ids_and_fields():
    ids = [p["id"] for p in PERSONAS["personas"]]
    assert ids == ["wheelchair", "walker_elder", "upper_limb", "walking_control"]
    for p in PERSONAS["personas"]:
        assert REQUIRED <= p.keys(), p["id"]
        for key in ("footprint", "kinematics", "reach"):
            assert "src" in p[key], (p["id"], key)
        lo, hi = p["reach"]["vertical_m"]
        assert 0 < lo < hi < 2.0


def test_same_as_targets_exist():
    by_id = {p["id"]: p for p in PERSONAS["personas"]}
    for p in PERSONAS["personas"]:
        for key, val in p.items():
            if isinstance(val, dict) and "same_as" in val:
                assert key in by_id[val["same_as"]], (p["id"], key)


def test_wheelchair_thresholds_match_standards_check():
    w = PERSONAS["personas"][0]
    cw = w["doors"]["clear_width_m"]
    assert (cw["gb_new"], cw["gb_retrofit"], cw["ada"]) == (0.90, 0.80, 0.815)
    assert w["doors"]["pull_latch_side"]["ada_m"] == 0.455
    assert w["threshold"]["gb_max_m"] == 0.015 and w["threshold"]["ada_max_m"] == 0.013
    assert w["corridor"]["gb_min_m"] == 0.90 and w["corridor"]["ada_m"] == 0.915
    assert w["reach"]["vertical_m"] == [0.38, 1.22]


def test_template_keys_are_groups():
    groups = TEMPLATES["groups"]
    for section in ("mass", "zones"):
        for key in TEMPLATES[section]:
            assert key == "default" or key in groups, (section, key)
    members = [c for cs in groups.values() for c in cs]
    assert len(members) == len(set(members)), "category in two groups"
    assert all(c == c.lower() for c in members)


def test_mass_ranges():
    for key, m in TEMPLATES["mass"].items():
        assert 0 < m["fill"] <= 1 and 0 < m["min"] < m["max"], key


def test_bed_and_switch_values():
    bed = TEMPLATES["zones"]["bed"][0]
    assert bed["depth_m"] == 1.20 and bed["src"] == "GB55019 3.4.6"
    sw = TEMPLATES["reach_targets"]["switch"]
    assert sw["compliant_m"]["gb"] == [0.85, 1.10]
    assert not (0.85 <= sw["fallback_height_m"] <= 1.10)  # 1.30 m is the non-compliant status-quo case
