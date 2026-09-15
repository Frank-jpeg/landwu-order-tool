"""验证两端成分数据库能拆开“一格多 SKU”的单元格，全部使用虚构数据。"""

from __future__ import annotations

import ast
import csv
import math
import re
import tempfile
import unittest
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable


SOURCE_PATHS = {
    "windows": Path(__file__).resolve().parents[1] / "领物做单器.pyw",
    "macos": Path(__file__).resolve().parents[1] / "macos" / "领物做单器.py",
}

FUNCTION_NAMES = {
    "normalize_db_key",
    "split_db_cell_values",
    "split_db_spec_values",
    "db_cell_spec_color",
    "clean_table_header",
    "find_table_column",
    "read_csv_rows",
    "read_xlsx_rows",
    "read_composition_db_table",
    "choose_db_composition",
    "normalize_composition_text",
    "infer_size_from_composition",
    "load_composition_db_mapping",
}

CONSTANT_NAMES = {
    "COMPOSITION_DB_FOLDER",
    "COMPOSITION_DB_SUFFIXES",
    "COMPOSITION_DB_JOIN_FIELDS",
    "COMPOSITION_DB_CELL_SPLIT_PATTERN",
    "COMPOSITION_DB_SPEC_SPLIT_PATTERN",
    "COMPOSITION_DB_SPEC_COLOR_PATTERN",
}


def load_composition_helpers(source_path):
    """只取匹配用到的函数和常量，不导入整个应用、不启动界面。"""
    module = ast.parse(source_path.read_text(encoding="utf-8-sig"))
    picked = []
    for node in module.body:
        if isinstance(node, ast.FunctionDef) and node.name in FUNCTION_NAMES:
            picked.append(node)
        elif isinstance(node, ast.Assign):
            names = {target.id for target in node.targets if isinstance(target, ast.Name)}
            if names & CONSTANT_NAMES:
                picked.append(node)
    missing = FUNCTION_NAMES - {node.name for node in picked if isinstance(node, ast.FunctionDef)}
    if missing:
        raise AssertionError(f"{source_path.name} 缺少匹配函数：{sorted(missing)}")
    isolated = ast.Module(
        body=[
            ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0),
            *picked,
        ],
        type_ignores=[],
    )
    namespace = {
        "csv": csv,
        "math": math,
        "re": re,
        "Path": Path,
        "Any": Any,
        "Iterable": Iterable,
        "Decimal": Decimal,
        "InvalidOperation": InvalidOperation,
    }
    exec(compile(ast.fix_missing_locations(isolated), str(source_path), "exec"), namespace)
    return namespace


class CompositionDbMatchingTests(unittest.TestCase):
    source_key = "windows"

    @classmethod
    def setUpClass(cls):
        cls.helpers = load_composition_helpers(SOURCE_PATHS[cls.source_key])

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.folder = Path(self.tmp.name)

    def write_db(self, rows, header=None):
        header = header or ["商品货号", "材质", "成分", "SKU_ID", "SKU规格", "SKC_ID", "SPU_ID"]
        with (self.folder / "虚构数据库.csv").open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(header)
            writer.writerows(rows)

    def match(self, *queries):
        return self.helpers["load_composition_db_mapping"](list(queries), db_folder=self.folder)

    multi_row = [
        "DAIL20260523",
        "聚酯纤维(涤纶）",
        "聚酯纤维(涤纶） 100%",
        "72455222634；48840368538；94767498783",
        "颜色:黑色 / 尺码:通用尺码；颜色:卡其 / 尺码:通用尺码；颜色:藏青 / 尺码:通用尺码",
        "27709925880",
        "2130086008",
    ]

    def test_each_sku_in_one_cell_matches_with_its_color(self):
        self.write_db([self.multi_row])
        mapping = self.match("72455222634", "48840368538", "94767498783")["mapping"]
        self.assertEqual(sorted(mapping), ["48840368538", "72455222634", "94767498783"])
        for sku, color in (("72455222634", "黑色"), ("48840368538", "卡其"), ("94767498783", "藏青")):
            with self.subTest(sku=sku):
                self.assertEqual(mapping[sku]["target_size"], "涤纶")
                self.assertEqual(mapping[sku]["db_field"], "SKU_ID")
                self.assertEqual(mapping[sku]["spec_color"], color)

    def test_single_value_cell_behaviour_is_unchanged(self):
        self.write_db([[
            "DAIL20260905", "涤纶", "", "80292996089", "颜色:黑色臂包 / 尺码:通用", "", "",
        ]])
        mapping = self.match("80292996089")["mapping"]
        self.assertEqual(list(mapping), ["80292996089"])
        self.assertEqual(mapping["80292996089"]["target_size"], "涤纶")
        self.assertNotIn("spec_color", mapping["80292996089"])

    def test_whole_cell_form_still_matches(self):
        self.write_db([self.multi_row])
        whole = self.multi_row[3]
        self.assertIn(whole, self.match(whole)["mapping"])

    def test_mixed_separators_and_blanks_are_split(self):
        self.write_db([[
            "DAIL20260701", "涤纶", "", "111\n222，333 444；555", "颜色:黑 / 尺码:通用", "", "",
        ]])
        mapping = self.match("111", "222", "333", "444", "555")["mapping"]
        self.assertEqual(sorted(mapping), ["111", "222", "333", "444", "555"])
        self.assertTrue(all(item["target_size"] == "涤纶" for item in mapping.values()))
        self.assertTrue(all("spec_color" not in item for item in mapping.values()))

    def test_color_is_skipped_when_spec_count_does_not_align(self):
        self.write_db([[
            "DAIL20260701", "涤纶", "涤纶 100%", "111；222", "颜色:黑色 / 尺码:通用", "", "",
        ]])
        mapping = self.match("111", "222")["mapping"]
        self.assertEqual(sorted(mapping), ["111", "222"])
        self.assertTrue(all("spec_color" not in item for item in mapping.values()))

    def test_material_column_is_used_when_composition_is_blank(self):
        self.write_db([[
            "DAIL20260523", "聚酯纤维(涤纶）", "", "48840368538；62890196892",
            "颜色:卡其 / 尺码:通用尺码；颜色:浅灰色 / 尺码:通用尺码", "", "",
        ]])
        mapping = self.match("62890196892")["mapping"]
        self.assertEqual(mapping["62890196892"]["target_size"], "涤纶")
        self.assertEqual(mapping["62890196892"]["spec_color"], "浅灰色")

    def test_unknown_sku_is_not_matched(self):
        self.write_db([self.multi_row])
        self.assertEqual(self.match("99999999999")["mapping"], {})

    def test_first_hit_keeps_wins_across_rows(self):
        self.write_db([
            self.multi_row,
            ["DAIL20260523", "棉", "棉 100%", "48840368538", "颜色:卡其 / 尺码:通用尺码", "", ""],
        ])
        mapping = self.match("48840368538")["mapping"]
        self.assertEqual(mapping["48840368538"]["target_size"], "涤纶")


class MacCompositionDbMatchingTests(CompositionDbMatchingTests):
    source_key = "macos"


if __name__ == "__main__":
    unittest.main()
