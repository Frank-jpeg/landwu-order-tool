# 领物做单器

Landwu 本地做单桌面工具，提供订单查询、JIT 物流处理、图片下载、尺码调整、支付预检，以及登录态同步。

## 下载 Windows 版

[下载最新 Windows EXE](https://github.com/Frank-jpeg/landwu-order-tool/releases/latest)

打开页面后，在 **Assets** 区域下载 `领物做单器.exe`。每次发布新版本后，这个链接会自动指向最新版本。

EXE 安装包单独发布，版本可能早于 `main` 源码；使用 EXE 时下载新的 Release 包升级。源码运行版和 Mac `.app` 的更新方式见下文。

## 分支说明

`main` 是 Windows/macOS 桌面版主线，`codex/landwu-mobile` 是手机版 APK / userscript 分支。同一个本地文件夹同一时间只会展开一个分支的文件；切到手机分支时看到桌面代码缺少主线新按钮，不代表主线丢失。

常用命令：

```bash
git switch main
git switch codex/landwu-mobile
```

桌面功能以 `main` 为准；手机 APK、手机脚本和远程手机成分数据库以 `codex/landwu-mobile` 为准。需要两端一致的规则，例如货号日期兜底，应分别同步到两个分支。

手机版 APK 的源码、构建脚本和手机数据库在 `codex/landwu-mobile` 分支的 `mobile/` 目录。APK 构建产物在 `mobile/android/build/outputs/`，本地签名文件为 `mobile/android/landwu-mobile-debug.keystore`；签名不同会导致安卓无法覆盖安装。该签名文件不提交仓库，当前备份在 `D:\临时备份\landwu-mobile-signing\`。

## Windows 运行

双击根目录的 `领物做单器.pyw`。运行环境建议 Python 3.11，需要 Tkinter、`requests`、`playwright`、`Pillow` 和 `openpyxl`。

## macOS 运行

Mac 源码位于 `macos/领物做单器.py`，运行环境需要带 Tkinter 的 Python 3，以及 `requests`、`playwright`、`Pillow` 和 `openpyxl`：

```bash
python3 macos/领物做单器.py
```

如果使用已打包的 `.app`，双击应用即可。该应用包含启动器、内置 Python 环境和实际运行源码；它们均不提交到仓库。

## 登录态同步

在“设置”中点击“一键复制同步脚本”，将脚本粘贴到 Tampermonkey 并启用。随后点击“接收登录态3分钟”，打开或刷新 `https://user.landwu.com/` 即可将登录态同步到本机。

`auth-state-v1.json` 是登录凭证，不会提交到此仓库。

macOS 将登录态和本地设置保存在 `~/Library/Application Support/领物做单器/`。这相当于 Windows 的 `%AppData%`，更新或替换 `.app` 不应删除该目录。

## 网页快速改尺码脚本

`userscripts/landwu-payment-size-helper.user.js` 是给脚本猫 / Tampermonkey 使用的网页脚本。安装后打开 `https://user.landwu.com/` 的待付款页面，右侧默认显示一个“改”字抽屉按钮，点开后可点击“刷新待付款”，先为多个 SKU 选择“棉 / 涤纶 / 人棉 / 通用尺码”，再点击“提交修改”统一提交。提交时只确认一次，脚本按 SKU 顺序调用保存接口；失败项会保留待提交选择。刷新页面后会保持上次收起/展开状态。

安装地址：[待付款快速改尺码脚本](https://raw.githubusercontent.com/Frank-jpeg/landwu-order-tool/main/userscripts/landwu-payment-size-helper.user.js)。

脚本只读取当前 Landwu 页面自己的登录态并调用 Landwu 接口，不包含 token、Cookie 或本地数据库文件。手机端可在支持 userscript 的浏览器里使用；脚本支持手动快速改尺码，不读取本机成分数据库。

## 更新

Python 源码运行版和现有 Mac `.app` 可在“设置 → 检查更新”中升级。它会通过 HTTPS 从[公开仓库](https://github.com/Frank-jpeg/landwu-order-tool)直接读取对应源码，不要求安装 GitHub CLI 或登录 GitHub：

- Windows 源码运行版更新当前运行的 `领物做单器.pyw`。
- macOS `.app` 下载并替换其内部运行源码，来源为 `macos/领物做单器.py`。

发现新版本并确认后，工具会覆盖当前运行的源码文件并自动重启。macOS 仅修改业务源码时无需重新打包 `.app`；修改启动器、Python 版本、依赖、图标或应用结构时才需要重新打包。

主界面标题旁、窗口标题和设置页会显示当前 `APP_VERSION`，便于确认正在运行的版本。

## 订单页面

待编辑和待付款页面支持滚轮、触控板和右侧滚动条；图片加载或窗口缩放后，滚动范围会随内容高度更新。

VMI 订单卡片下方直接列出每个 SKU 的颜色、尺码和下单数量，数量加粗显示，无需打开弹窗查看。数量为 0 时照实显示，缺失或无效时显示“未返回”。

点击 VMI 卡片右侧的“修改件数”，弹窗会列出该订单的全部可编辑 SKU；在每行数量框中修改，点击“确认”后统一提交本单变更。商品、颜色和尺码沿用订单原值；失败时弹窗和运行日志会列出订单号、SKU 及接口返回原因。提交后刷新订单，卡片明细会同步更新。

下单余额低于 400 元时，仅在软件顶部显示红字提醒，不弹窗、不打断操作；刷新后余额达到 400 元或无法取得余额时，会隐藏提示。Windows 和 macOS 均支持。

“修改成分尺码”可处理待付款 JIT 和 VMI 订单。改物流、一键流程、下载图片和预检支付仅处理 JIT。

## 成分数据库

Windows 和 macOS 都支持在“设置”中选择成分数据库文件夹，选择后会保存在本机。进入“修改成分尺码”后：

1. 顶部“数据库目录”会显示当前已保存的路径。
2. 点击“选择数据库文件夹”可更换并保存目录。
3. 点击绿色的“开始匹配”会读取该目录并匹配当前待付款订单。
4. 下方的“旧版表格导入（通常不需要）”仅保留给旧的 Excel 成分结果表流程；日常使用数据库匹配即可。

待付款页新增的“一键匹配并提交成分”会直接读取已保存的数据库目录，匹配当前待付款 SKU，二次确认后按“全部关联”批量提交尺码修改；没有可提交目标时只提示结果，不会提交。

没有待付款订单时仍可进入该页面配置目录，但不能提交尺码修改。Windows 首次使用默认读取 `D:\匹配数据库文件夹`。

macOS 支持选择本地成分数据库文件夹或 Excel 成分表，不依赖 Windows 的 `D:` 路径。

待付款页每张订单卡片的标题右侧会显示服务端返回的“当前尺码”。提交尺码修改后，窗口会显示提交中/完成/失败状态，工具会自动刷新订单；以刷新后显示的尺码为准确认是否修改成功。

数据库文件支持 `.xlsx`、`.xlsm`、`.csv`，只读取第一个工作表。表头至少需要 `SKU_ID`、`SKU`、`SKC_ID`、`SPU_ID` 中的一列用于匹配；匹配优先级为 `SKU_ID → SKU → SKC_ID → SPU_ID`。也兼容带空格或下划线的写法，例如 `SKU ID`、`SKC ID`。成分优先读取表头为“成分”或“成份”的列，空值时回退“材质”列。旧版没有成分表头但至少 8 列的表仍兼容第 H 列成分。

数据库未命中时，工具会从货号、款号、商品货号、`article_no` 等字段中提取第一个合法的 `YYYYMMDD` 日期；日期大于等于 `2026-07-01` 的商品默认建议“涤纶”。数据库命中优先于这条兜底规则。

## 支付

点击“预检并支付 JIT”时，如果本次勾选的订单仍有 SKU 为“通用尺码”，确认窗会用红色列出相关订单与 SKU；必须手动点击“仍要付款”才会继续支付预检。

如果勾选订单里同时存在已改好尺码和“通用尺码”，确认窗会提供“只支付已改好尺码（N单）”，自动跳过通用尺码订单；没有已改好尺码订单时该选项不可用。

## 开发与维护

- [项目规则](AGENTS.md)：源码入口、跨平台范围、敏感数据和提交要求。
- [维护与验证](docs/maintenance.md)：卡片滚动、数量明细、余额提醒的实现入口，测试命令、发布方式和待验证事项。
