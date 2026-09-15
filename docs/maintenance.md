# 桌面端维护与验证

使用说明见 [README](../README.md)，修改约束见 [AGENTS.md](../AGENTS.md)。本文记录实现入口、验证方法和交接边界。

## 源码与运行方式

| 文件 | 职责 |
| --- | --- |
| [领物做单器.pyw](../领物做单器.pyw) | Windows 桌面程序及命令行入口 |
| [macos/领物做单器.py](../macos/领物做单器.py) | macOS 桌面程序及命令行入口 |
| [test_macos_card_scrolling.py](../tests/test_macos_card_scrolling.py) | Mac 源码的卡片滚动验证，以及共用的隔离 GUI 测试工具 |
| [test_vmi_quantity_details.py](../tests/test_vmi_quantity_details.py) | Windows/macOS 的 VMI 数量明细验证 |
| [test_composition_db_matching.py](../tests/test_composition_db_matching.py) | Windows/macOS 的成分数据库匹配验证（多值单元格拆分、颜色对齐、旧行为回归） |
| [build-windows-exe.yml](../.github/workflows/build-windows-exe.yml) | PyInstaller 单文件 EXE 构建与标签发布 |

桌面源码在 `main`，手机 APK、手机脚本及手机成分数据库在 `codex/landwu-mobile`。桌面界面调整不需要同步到手机分支；共享业务规则变化时单独评估手机端。

两端保留独立的单文件源码，应用内更新只替换对应运行文件。引入新模块或依赖时，需要一并评估已安装程序能否获得这些文件。

## 卡片布局与滚动

Mac 的 `_create_scrollable_cards_view()` 使用 `Canvas` 承载独立 `Frame`，订单卡片在 Frame 内通过 `pack` 排列。内容的 `<Configure>` 事件更新 `scrollregion`，Canvas 的尺寸变化同步内容宽度，因此异步图片变高、窗口缩放和订单刷新后仍可滚到最后一单。

不要把 `pack` 的卡片直接放进 `Text` 后依赖 Text 的滚动条；这些子控件不会被计入文本内容的滚动高度。Mac 源码中仍有旧的同名方法，Python 采用类内最后一个定义。修改 `_populate_edit_cards()`、`_populate_payment_cards()` 等方法时，先确认实际生效的定义；现有测试保留完整类定义顺序，能检查这一点。

Mac 的 `_scroll_target_pixels()` 将 Canvas 的 `yscrollincrement` 设为 1，再通过 `yview_scroll(..., "units")` 按像素移动；Canvas 不接受 `"pixels"` 参数。滚轮与 Tk 9 的 `<TouchpadScroll>` 共用目标路由，Tk 8.6 不支持后者时跳过该绑定。新增图片、数量表格或按钮时，沿用 `_bind_edit_card_widget()` / `_bind_payment_card_widget()`，让鼠标停在卡片子控件上也能滚动。

## VMI 数量明细

`get_gui_order_rows()` 把订单的 `detail` 列表交给界面。两端的 `_vmi_quantity_display_rows()` 负责显示字段，`_add_vmi_quantity_details()` 在待编辑、待付款卡片中添加明细表。

- 每条有效详情单独显示 SKU、颜色、尺码和下单数量；显示不要求存在可提交修改的详情 ID。
- 数量依次读取非空的 `buy_number`、`buyNumber`、`quantity`；0 件照实显示，缺失、负数或无效值显示“未返回”。无详情时显示“暂无 SKU 数量明细”。
- 颜色和尺码沿用 `display_color_name()`、`display_size_name()`，只转换显示值。
- “修改件数”仍通过原有弹窗提交；成功回调调用 `refresh_summary()`，卡片随服务端返回值重新绘制。

## 低余额提示

`_apply_summary()` 和 `fetch_auth()` 的成功回调都会调用 `_check_low_balance()`。阈值由 `LOW_BALANCE_ALERT_THRESHOLD` 控制，当前为 400 元。

低于阈值时更新 `balance_notice_var` 并显示顶部红色标签；达到阈值或余额不可解析时清空、隐藏标签。余额 0 是有效值。该提示不调用消息框，也不覆盖底部操作进度；一次连续低余额状态只记录一次日志。

## 成分数据库匹配

`load_composition_db_mapping()` 在两端的实现一致：按 `COMPOSITION_DB_JOIN_FIELDS`（`SKU_ID`、`SKU`、`SKC_ID`、`SPU_ID`）逐列取值，与订单侧 `match_candidates`（`sku` → `skc_id` → `product_id`）比对，命中后取成分（空则回退材质）并推断目标尺码。订单侧查询键由 `_build_payment_size_items()` 组装。

供应商导出表常把同一 SPU 下多个颜色的 SKU 写进同一个单元格（如 6 个 ID 用 `；` 拼接），只做整串比较会让这些行永远匹配不到，待付款订单显示“未匹配”。因此：

- `split_db_cell_values()` 按 `[；;，,\s]+` 拆开单元格并逐项注册，同时保留“整串去空白”形式（序号 -1），一行一个 ID 的旧表格行为完全不变。
- `load_composition_db_mapping()` 先把整行命中的键收集到 `cell_hits` 再统一注册，维持“首个命中者生效”的语义；成分与目标尺码每行只解析一次。
- `split_db_spec_values()` / `db_cell_spec_color()`：仅当单元格内 ID 数与“SKU规格”项数严格相等时，按位置取颜色写入 `spec_color`，顺序对不齐就不猜；匹配状态显示为 `SKU_ID（卡其）`。
- 货号日期兜底（`PRODUCT_NO_POLYESTER_FALLBACK_START = 2026-07-01`）与匹配优先级不变，数据库命中优先。

改动匹配逻辑后除了跑自动测试，还建议做一次新旧对跑回归：`git show HEAD~1:领物做单器.pyw` 导出上一版源码，与当前版本同时导入，对同一份数据库的匹配键全量比对，确认“旧命中丢失 0、结果被改写 0”，只新增命中。

## 本地验证

建议使用 Python 3.11 和可用的 Tk 显示环境。在仓库根目录执行；Mac 上将 `python` 换成实际使用的 `python3`：

```bash
python -X utf8 -m py_compile "领物做单器.pyw" "macos/领物做单器.py"
python -X utf8 -m unittest discover -s tests -v
git diff --check
```

测试通过 AST 提取 GUI 类及必要的纯函数，使用真实 Tk 控件和虚构订单，不启动完整应用、不读取账号设置、不联网。缺少 Tk 显示环境时会跳过 GUI 测试；跳过不能视为界面验证通过。

自动测试覆盖大图延迟加载、窗口缩放、滚轮及精密触控板位移、滚动到最后一单、空列表重新填充，以及两端的 VMI 数量、中文规格、刷新、长文本换行、选择状态和成分数据库多值单元格拆分、颜色对齐与旧行为回归。

发布界面改动前，还应在目标运行环境逐项验收：

| 场景 | 预期 |
| --- | --- |
| 空订单与正常订单 | 均能刷新；空列表提示正常，有订单时最后一单可见 |
| 大图与多行 VMI 明细 | 图片加载后滚动范围更新；在图片、勾选框、明细表和滚动条上滚动均有效 |
| VMI 修改件数 | 刷新后明细显示服务端的新数量 |
| 余额低于 400（含 0、负数） | 顶部红字显示当前金额，刷新不中断，不要求确认 |
| 余额达到 400 或更高 | 红字隐藏 |
| 余额缺失或不可解析 | 清除旧提示，不继续显示过期余额 |
| 查看登录态后余额变化 | 顶部提示同步更新 |

## 发布与更新

用户可见的应用改动必须同步递增两端 `APP_VERSION`；仅整理文档时不递增。检查差异和暂存区后提交到 `main`，推送前运行 `git pull --rebase origin main`，不强制推送。

源码运行版和现有 Mac `.app` 的“检查更新”通过公开 GitHub Raw HTTPS 下载对应源码，编译检查后写入 `.download` 临时文件，再替换当前 `__file__` 并使用当前 Python 解释器重启。不需要 GitHub CLI 或仓库 Token。

Mac 只修改业务源码时无需重新打包。需要定位某个已安装 `.app` 的运行源码时，读取其 `Contents/Resources/source-info.json`；在本机手动同步前备份指向的运行文件。启动器、依赖或应用结构变化才需要重新打包。

Windows EXE 是独立发布流程：工作流在推送 `v*` 标签或手动触发时构建，只有标签运行会上传 Release 附件；手动构建只上传 Actions artifact。推送 `main` 不会自动生成 EXE，Releases 中的安装包可能与主线源码版本不同。当前源码更新器没有针对 PyInstaller 单文件 EXE 的替换流程，EXE 用户以下载新 Release 包更新为准。

发现更新后仍显示旧版本时，先核对启动的应用副本和窗口标题中的版本号，再检查对应源码或 Release；不要通过删除登录态或设置来修复更新问题。Mac 的账号数据、设置位于 `~/Library/Application Support/领物做单器/`，Windows 的设置位于 `%LOCALAPPDATA%/领物做单器/settings.json`，均不属于源码更新内容。

## 验证交接：2026-09-15

应用源码版本为 `2026.09.15.1`，包含 Mac 卡片滚动修复、两端 VMI 逐 SKU 数量展示、顶部低余额提醒，以及成分数据库多值单元格拆分匹配。`v2026.09.15.1` 的 Windows 单文件 EXE 已由标签工作流构建并发布。

- 已完成：Windows 主机上的两端语法检查、36 项自动测试（含两端成分匹配用例）；成分匹配改动另做了新旧对跑回归，23,003 个匹配键中旧命中丢失 0、结果被改写 0，新增命中 9,332 个。
- 待完成：Mac 真机在有订单时验证触控板、大图、数量明细、顶部余额提示和成分匹配提交。Windows 上执行 Mac 源码的 Tk 测试不能替代 Mac 真机验收。
- 已安装的 Mac `.app` 内部仍是旧源码，需要走应用内更新或重新打包，才能用上这一版。
