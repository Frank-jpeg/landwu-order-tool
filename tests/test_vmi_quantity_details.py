"""验证两端 VMI 卡片的逐 SKU 数量、刷新和滚动行为，全部使用虚构订单。"""

from pathlib import Path
import tkinter as tk
from tkinter import ttk
import unittest

from test_macos_card_scrolling import CardGuiTestCase


def descendants(widget):
    for child in widget.winfo_children():
        yield child
        yield from descendants(child)


class MacVmiQuantityDetailsTests(CardGuiTestCase):
    def reset_view(self, status):
        for widget in self.parent.winfo_children():
            widget.destroy()
        self.create_view(status)

    def render(self, rows):
        getattr(self.app, f"_populate_{self.kind}_cards")(rows)
        self.root.update()

    def labels(self):
        return [widget for widget in descendants(self.parent) if isinstance(widget, (tk.Label, ttk.Label))]

    def texts(self):
        return [str(widget.cget("text")) for widget in self.labels()]

    def order(self, details, tag="VMI", index=1):
        return {
            "order_id": str(index), "order_no": f"TEST-{index}", "tag_name": tag,
            "detail": details,
        }

    def test_each_sku_quantity_visible_on_edit_and_payment_cards(self):
        details = [
            {"sku": "TEST-001", "colour": "white", "size": "300ml", "buy_number": 3},
            {"sku_id": "TEST-002", "color_name": "black", "spec_size": "500ml", "buyNumber": "5"},
            {"productSku": "TEST-003", "colour_name": "blue", "goods_size": "one size", "quantity": 12},
            {"goods_sku": "TEST-004", "colour": "red", "size": "XL", "buy_number": 20},
        ]
        for status in (1, 2):
            with self.subTest(status=status):
                self.reset_view(status)
                self.render([self.order(details)])
                texts = self.texts()
                for expected in ("下单数量", "TEST-001", "TEST-002", "TEST-003", "TEST-004", "白色", "黑色", "通用尺码", "3 件", "5 件", "12 件", "20 件"):
                    self.assertIn(expected, texts)
                quantity_labels = [label for label in self.labels() if str(label.cget("text")).endswith(" 件")]
                self.assertEqual(len(quantity_labels), 4, "没有详情编辑 ID 的 SKU 也必须展示")
                self.assertTrue(all("bold" in str(label.cget("font")) for label in quantity_labels))
                self.assertFalse(getattr(self.app, f"{self.kind}_check_vars")["1"].get())

    def test_zero_unknown_and_invalid_quantity_are_not_replaced_with_one(self):
        values = self.app._vmi_quantity_display_rows(self.order([
            {"sku": "ZERO", "buy_number": 0, "buyNumber": 9},
            {"sku": "MISSING"},
            {"sku": "INVALID", "buy_number": "unknown"},
            {"sku": "FALLBACK", "buy_number": "", "buyNumber": 7},
            None,
        ]))
        self.assertEqual([value[3] for value in values], ["0 件", "未返回", "未返回", "7 件"])

    def test_refresh_replaces_previous_quantity(self):
        for status in (1, 2):
            with self.subTest(status=status):
                self.reset_view(status)
                row = self.order([{"sku": "TEST-001", "buy_number": 3}])
                self.render([row])
                self.assertIn("3 件", self.texts())
                row["detail"][0]["buy_number"] = 8
                self.render([row])
                self.assertIn("8 件", self.texts())
                self.assertNotIn("3 件", self.texts())

    def test_jit_cards_keep_existing_selection_and_layout(self):
        for status in (1, 2):
            with self.subTest(status=status):
                self.reset_view(status)
                self.render([self.order([{"sku": "JIT-001", "buy_number": 9}], tag="JIT")])
                self.assertNotIn("下单数量", self.texts())
                self.assertNotIn("9 件", self.texts())
                self.assertTrue(getattr(self.app, f"{self.kind}_check_vars")["1"].get())

    def test_detail_rows_keep_scrolling_and_order_selection(self):
        self.create_view(1)
        rows = [self.order([
            {"sku": f"TEST-{index}-{sku}", "colour": "white", "size": "300ml", "buy_number": sku + 1}
            for sku in range(6)
        ], index=index) for index in range(1, 6)]
        self.render(rows)
        quantity = next(label for label in self.labels() if str(label.cget("text")) == "1 件")
        before = self.app.edit_card_frames["1-row-1"].winfo_rooty()
        quantity.event_generate("<MouseWheel>", delta=-120)
        self.root.update()
        self.assertLess(self.app.edit_card_frames["1-row-1"].winfo_rooty(), before)
        self.assert_last_card_reachable()
        last_card = self.app.edit_card_frames["1-row-5"]
        last_quantity = next(widget for widget in descendants(last_card) if isinstance(widget, ttk.Label) and str(widget.cget("text")) == "6 件")
        last_quantity.event_generate("<Button-1>")
        self.root.update()
        self.assertEqual(self.app.selected_edit_iid, "1-row-5")

    def test_long_specifications_wrap_and_keep_quantity_in_view(self):
        self.create_view(1)
        self.root.geometry("800x420+20000+20000")
        self.render([self.order([{
            "sku": "TEST-001", "colour": "白色 / 黑色 / 蓝色 " * 12,
            "size": "300ml / 500ml " * 12, "buy_number": 122,
        }])])
        quantity = next(label for label in self.labels() if str(label.cget("text")) == "122 件")
        self.assertGreater(quantity.winfo_width(), 60)
        self.assertLessEqual(quantity.winfo_rootx() + quantity.winfo_width(), self.viewport.winfo_rootx() + self.viewport.winfo_width())
        size = next(label for label in self.labels() if str(label.cget("text")).startswith("300ml /"))
        self.assertGreater(size.winfo_height(), 40)

    def test_empty_orders_and_missing_details(self):
        for status in (1, 2):
            with self.subTest(status=status):
                self.reset_view(status)
                self.render([])
                self.assertEqual(getattr(self.app, f"{self.kind}_card_frames"), {})
                self.render([self.order([])])
                self.assertIn("暂无 SKU 数量明细", self.texts())
                self.assertNotIn("1 件", self.texts())


class WindowsVmiQuantityDetailsTests(MacVmiQuantityDetailsTests):
    source_path = Path(__file__).resolve().parents[1] / "领物做单器.pyw"


if __name__ == "__main__":
    unittest.main()
