"""Class-name parsing from a YOLO dataset's data.yaml (all common forms)."""
import pytest

from backend.api.exports import _parse_data_yaml_names


def _write(tmp_path, text):
    (tmp_path / "data.yaml").write_text(text, encoding="utf-8")
    return str(tmp_path)


def test_dict_form(tmp_path):
    p = _write(tmp_path, "nc: 3\nnames:\n  0: robot\n  1: ball\n  2: goal\n")
    assert _parse_data_yaml_names(p) == {0: "robot", 1: "ball", 2: "goal"}


def test_block_list_form(tmp_path):
    p = _write(tmp_path, "nc: 3\nnames:\n  - robot\n  - ball\n  - goal\n")
    assert _parse_data_yaml_names(p) == {0: "robot", 1: "ball", 2: "goal"}


def test_inline_list_form(tmp_path):
    p = _write(tmp_path, "nc: 2\nnames: ['robot', 'ball']\n")
    assert _parse_data_yaml_names(p) == {0: "robot", 1: "ball"}


def test_quotes_are_stripped(tmp_path):
    p = _write(tmp_path, "names:\n  0: 'robot'\n  1: \"ball\"\n")
    assert _parse_data_yaml_names(p) == {0: "robot", 1: "ball"}


def test_missing_yaml_returns_empty(tmp_path):
    assert _parse_data_yaml_names(str(tmp_path)) == {}


def test_names_block_stops_at_other_keys(tmp_path):
    p = _write(tmp_path, "names:\n  0: robot\n  1: ball\nnc: 2\ntrain: images/train\n")
    assert _parse_data_yaml_names(p) == {0: "robot", 1: "ball"}
