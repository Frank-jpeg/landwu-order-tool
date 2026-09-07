"""使用真实 Tk 控件验证滚动，不启动应用、联网或读取本机账号数据。"""

from __future__ import annotations

import ast
from pathlib import Path
from types import SimpleNamespace
import tkinter as tk
from tkinter import ttk
import unittest


SOURCE_PATH = Path(__file__).resolve().parents[1] / "macos" / "领物做单器.py"


def load_gui_class():
    module = ast.parse(SOURCE_PATH.read_text(encoding="utf-8-sig"))
    gui = next(node for node in module.body if isinstance(node, ast.ClassDef) and node.name == "LandwuGuiApp")
    constants = [
        node for node in module.body
        if isinstance(node, ast.Assign)
        and any(isinstance(target, ast.Name) and target.id == "SCROLL_PIXELS_PER_UNIT" for target in node.targets)
    ]
    # 保留完整类及方法定义顺序，确保测试的是运行时实际生效的渲染方法。
    isolated = ast.Module(
        body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), *constants, gui],
        type_ignores=[],
    )
    namespace = {"tk": tk, "ttk": ttk, "Path": Path}
    exec(compile(ast.fix_missing_locations(isolated), str(SOURCE_PATH), "exec"), namespace)
    return namespace["LandwuGuiApp"]


class MacCardScrollingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.gui_class = load_gui_class()

    def setUp(self):
        try:
            self.root = tk.Tk()
        except tk.TclError as exc:
            self.skipTest(f"需要可用的 Tk 显示环境：{exc}")
        self.root.withdraw()
        self.addCleanup(self.root.destroy)
        self.root.attributes("-alpha", 0.0)
        self.root.geometry("1000x600+20000+20000")
        self.root.rowconfigure(0, weight=1)
        self.root.columnconfigure(0, weight=1)
        self.callback_errors = []
        self.root.report_callback_exception = lambda _type, value, _tb: self.callback_errors.append(value)
        self.parent = ttk.Frame(self.root)
        self.parent.grid(sticky="nsew")
        self.parent.rowconfigure(0, weight=1)
        self.parent.columnconfigure(0, weight=1)

        self.app = self.gui_class.__new__(self.gui_class)
        self.app.root = self.root
        self.app._mousewheel_targets = {}
        self.app._mousewheel_hover_target = None
        self.app._mousewheel_dispatcher_installed = False
        self.app._touchpad_scroll_supported = None
        self.app._scroll_pixel_remainder = {}
        self.app.order_rows_by_status_iid = {1: {}, 2: {}}
        for kind in ("edit", "payment"):
            setattr(self.app, f"{kind}_card_frames", {})
            setattr(self.app, f"{kind}_check_vars", {})
            setattr(self.app, f"unchecked_{kind}_order_ids", set())
        self.app.payment_card_images = []
        self.app._on_tree_select = lambda: None
        self.app._image_items_for_row = lambda row: [{"sku": "TEST-SKU"}]
        self.pending_images = []
        self.app._load_image_async = lambda _item, label, _size, images, **_opts: self.pending_images.append((label, images))
        self.test_image = tk.PhotoImage(master=self.root, width=620, height=700)
        self.root.deiconify()
        self.root.update()

    def tearDown(self):
        self.assertEqual(self.callback_errors, [])

    def create_view(self, status):
        self.kind = "edit" if status == 1 else "payment"
        self.app._active_status = lambda: status
        getattr(self.app, f"_create_{self.kind}_cards_view")(self.parent)
        self.viewport = getattr(self.app, f"{self.kind}_canvas")
        self.root.update()

    def populate(self, count):
        rows = [
            {"order_id": str(index), "order_no": f"TEST-{index}", "tag_name": "JIT"}
            for index in range(count)
        ]
        getattr(self.app, f"_populate_{self.kind}_cards")(rows)
        self.root.update()

    def finish_image_loading(self):
        labels = []
        for label, references in self.pending_images:
            if label.winfo_exists():
                references.append(self.test_image)
                label.configure(image=self.test_image)
                labels.append(label)
        self.pending_images.clear()
        self.root.update()
        return labels

    def assert_last_card_reachable(self):
        self.viewport.yview_moveto(0.0)
        self.root.update()
        self.assertLess(self.viewport.yview()[1], 1.0, "下方还有订单时，滚动条必须保留滚动范围")
        scrollbar = next(widget for widget in self.parent.winfo_children() if isinstance(widget, ttk.Scrollbar))
        command = scrollbar.tk.splitlist(scrollbar.cget("command"))
        scrollbar.tk.call(*command, "moveto", 1.0)
        self.root.update()
        self.assertAlmostEqual(self.viewport.yview()[1], 1.0)
        last = list(getattr(self.app, f"{self.kind}_card_frames").values())[-1]
        last_bottom = last.winfo_rooty() + last.winfo_height()
        self.assertGreater(last_bottom, self.viewport.winfo_rooty())
        self.assertLessEqual(last_bottom, self.viewport.winfo_rooty() + self.viewport.winfo_height())

    def test_four_payment_orders_scroll_after_images_load_and_resize(self):
        self.create_view(2)
        self.populate(4)
        initial_height = self.app.payment_body.winfo_reqheight()
        self.finish_image_loading()
        self.assertGreater(self.app.payment_body.winfo_reqheight(), initial_height)
        self.assertEqual(len(self.app.payment_card_frames), 4)
        self.assert_last_card_reachable()
        self.root.geometry("800x420+20000+20000")
        self.root.update()
        self.assert_last_card_reachable()

    def test_wheel_over_image_checkbox_and_scrollbar(self):
        self.create_view(2)
        self.populate(4)
        image_label = self.finish_image_loading()[0]
        card = self.app.payment_card_frames["2-row-1"]
        header = card.winfo_children()[0]
        checkbox = next(widget for widget in header.winfo_children() if isinstance(widget, tk.Checkbutton))
        scrollbar = next(widget for widget in self.parent.winfo_children() if isinstance(widget, ttk.Scrollbar))
        for widget, delta in ((image_label, -1), (checkbox, -120), (scrollbar, -1)):
            with self.subTest(widget=widget.winfo_class(), delta=delta):
                before = card.winfo_rooty()
                widget.event_generate("<MouseWheel>", delta=delta)
                self.root.update()
                self.assertEqual(before - card.winfo_rooty(), 60)
        self.assertTrue(all(var.get() for var in self.app.payment_check_vars.values()))

    def test_small_touchpad_deltas_scroll_without_jumping_a_whole_card(self):
        self.create_view(2)
        self.populate(4)
        self.finish_image_loading()
        card = self.app.payment_card_frames["2-row-1"]
        before = card.winfo_rooty()
        # Tk 9 的高 16 位为横向位移，低 16 位为有符号纵向位移。
        self.app._scroll_touchpad_target(self.viewport, SimpleNamespace(delta=(3 << 16) | (-7 & 0xFFFF)))
        self.root.update()
        self.assertEqual(before - card.winfo_rooty(), 7)
        self.app._scroll_touchpad_target(self.viewport, SimpleNamespace(delta=7))
        self.root.update()
        self.assertEqual(card.winfo_rooty(), before)

    def test_edit_orders_scroll_to_last_card(self):
        self.create_view(1)
        self.populate(30)
        self.assert_last_card_reachable()

    def assert_empty_and_refill(self, status):
        self.create_view(status)
        for count in (0, 1, 0, 12):
            self.populate(count)
            if count == 0:
                self.assertEqual(self.viewport.yview(), (0.0, 1.0))
                self.app._scroll_mousewheel_target(self.viewport, SimpleNamespace(delta=-1))
                self.root.update()
                self.assertEqual(self.viewport.yview(), (0.0, 1.0))
            elif count == 12:
                self.finish_image_loading()
                self.assert_last_card_reachable()

    def test_empty_payment_list_and_refill(self):
        self.assert_empty_and_refill(2)

    def test_empty_edit_list_and_refill(self):
        self.assert_empty_and_refill(1)


if __name__ == "__main__":
    unittest.main()
