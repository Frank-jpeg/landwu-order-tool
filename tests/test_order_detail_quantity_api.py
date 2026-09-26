"""离线验证两端改量/删除参数；不导入应用、不读取登录态、不访问服务器。"""

from __future__ import annotations

import ast
import copy
import math
from pathlib import Path
import re
import unittest
from unittest.mock import Mock


ROOT = Path(__file__).resolve().parents[1]


def load_client(source_path):
    module = ast.parse(source_path.read_text(encoding="utf-8-sig"))
    names = {
        "normalize_db_key", "normalize_option_id", "first_option_id",
        "_option_key", "_option_field_value", "_option_id_from_value",
        "_option_search_values", "option_display_name",
        "iter_named_options", "find_option_by_id",
    }
    picked = [node for node in module.body if (
        isinstance(node, ast.FunctionDef) and node.name in names
    ) or (
        isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id in {"OPTION_ID_FIELDS", "OPTION_VALUE_FIELDS"}
            for t in node.targets
        )
    )]
    client = next(n for n in module.body if isinstance(n, ast.ClassDef) and n.name == "LandwuClient")
    picked.append(client)
    isolated = ast.Module(body=[
        ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0),
        *picked,
    ], type_ignores=[])
    namespace = {"math": math, "re": re}
    exec(compile(ast.fix_missing_locations(isolated), str(source_path), "exec"), namespace)
    return namespace["LandwuClient"]


class WindowsQuantityApiTests(unittest.TestCase):
    source_path = ROOT / "领物做单器.pyw"

    @classmethod
    def setUpClass(cls):
        cls.client_class = load_client(cls.source_path)

    def setUp(self):
        self.client = self.client_class.__new__(self.client_class)
        self.detail = {
            "data": {"id": 101, "order_id": 901, "order_no": "WB-TEST-001",
                     "sku": "TEST-SKU", "sku_id": 301, "product_id": 401,
                     "colour_id": 11, "size_id": 22, "size": "棉", "buy_number": 4},
            "size": {"22": {"id": 22, "name": "棉"}},
        }
        self.rows = [{"order_id": 901, "order_no": "WB-TEST-001",
                      "detail": [{"id": 101, "order_id": 901}]}]
        self.client.get_order_edit_detail = Mock(side_effect=lambda _: copy.deepcopy(self.detail))
        self.client.iter_orders = Mock(side_effect=lambda **kw: self.rows if kw["status"] == 1 else [])
        self.client.get = Mock(return_value={"code": 1})
        self.client.post = Mock(return_value={"code": 1})
        self.item = {"order_detail_id": "101", "order_no": "WB-TEST-001",
                     "sku": "TEST-SKU", "target_quantity": 0}

    def assert_delete(self, order_id=901):
        self.client.get.assert_called_once_with("/order/delOrderDetail", {
            "order_id": str(order_id), "order_detail_id": "101", "lange": "zh",
        })
        self.client.post.assert_not_called()

    def test_zero_uses_internal_id_and_keeps_display_order_number(self):
        result = self.client.change_order_detail_quantities([self.item])
        self.assertEqual((result["successCount"], result["failedCount"]), (1, 0))
        self.assertEqual(result["results"][0]["orderNo"], "WB-TEST-001")
        self.assertTrue(result["results"][0]["deleted"])
        self.assert_delete()

    def test_fresh_detail_id_takes_precedence_over_caller(self):
        self.client.change_order_detail_quantity(order_detail_id=101, target_quantity=0, order_id="WB-TEST-OLD")
        self.assert_delete()

    def test_top_level_edit_id_is_supported(self):
        del self.detail["data"]["order_id"]
        self.detail["order_id"] = 902
        self.client.change_order_detail_quantities([self.item])
        self.assert_delete(902)

    def test_live_detail_id_is_fallback(self):
        del self.detail["data"]["order_id"]
        self.rows[0]["detail"][0]["order_id"] = 903
        self.client.change_order_detail_quantities([self.item])
        self.assert_delete(903)

    def test_live_order_id_is_fallback(self):
        del self.detail["data"]["order_id"]
        del self.rows[0]["detail"][0]["order_id"]
        self.client.change_order_detail_quantities([self.item])
        self.assert_delete()

    def test_missing_internal_id_blocks_instead_of_using_display_number(self):
        del self.detail["data"]["order_id"]
        del self.rows[0]["order_id"]
        del self.rows[0]["detail"][0]["order_id"]
        result = self.client.change_order_detail_quantities([self.item])
        self.assertEqual(result["failedCount"], 1)
        self.assertIn("订单内部ID", result["failed"][0]["error"])
        self.client.get.assert_not_called()
        self.client.post.assert_not_called()

    def test_stale_detail_is_blocked(self):
        self.rows.clear()
        result = self.client.change_order_detail_quantities([self.item])
        self.assertEqual(result["failedCount"], 1)
        self.client.get_order_edit_detail.assert_not_called()
        self.client.get.assert_not_called()
        self.client.post.assert_not_called()

    def test_pending_payment_order_can_be_changed(self):
        self.client.iter_orders.side_effect = lambda **kw: self.rows if kw["status"] == 2 else []
        self.client.change_order_detail_quantities([self.item])
        self.assert_delete()

    def test_positive_quantity_uses_original_save_endpoint_and_fields(self):
        result = self.client.change_order_detail_quantities([{**self.item, "target_quantity": 6}])
        self.assertEqual(result["successCount"], 1)
        self.client.get.assert_not_called()
        self.client.post.assert_called_once_with("/order/relateOrderDetailSave", {
            "productId": 401, "sku": "TEST-SKU", "skuId": 301,
            "colourId": "11", "sizeId": "22", "buyNumber": 6,
            "is_img_custom": "", "fabric_id": "", "order_detail_id": 101,
            "order_id": 901, "isSave": 1, "type": 1, "lange": "zh",
        })

    def test_unchanged_quantity_skips_writes(self):
        result = self.client.change_order_detail_quantities([{**self.item, "target_quantity": 4}])
        self.assertEqual((result["successCount"], result["skippedCount"]), (0, 1))
        self.client.get.assert_not_called()
        self.client.post.assert_not_called()

    def test_empty_order_batch_has_no_writes(self):
        self.rows.clear()
        result = self.client.change_order_detail_quantities([])
        self.assertEqual((result["successCount"], result["failedCount"], result["skippedCount"]), (0, 0, 0))
        self.client.get_order_edit_detail.assert_not_called()
        self.client.get.assert_not_called()
        self.client.post.assert_not_called()

    def test_invalid_quantities_do_not_submit(self):
        for quantity in (-1, "bad", "1.5"):
            with self.subTest(quantity=quantity), self.assertRaises(RuntimeError):
                self.client.change_order_detail_quantity(order_detail_id=101, target_quantity=quantity)
        self.client.get_order_edit_detail.assert_not_called()
        self.client.get.assert_not_called()
        self.client.post.assert_not_called()

    def test_server_failure_is_reported_as_failed(self):
        self.client.get.side_effect = RuntimeError("订单状态已变化")
        result = self.client.change_order_detail_quantities([self.item])
        self.assertEqual((result["successCount"], result["failedCount"]), (0, 1))
        self.assertIn("订单状态已变化", result["failed"][0]["error"])


class MacQuantityApiTests(WindowsQuantityApiTests):
    source_path = ROOT / "macos" / "领物做单器.py"


if __name__ == "__main__":
    unittest.main()
