# 领物做单器

Landwu 本地做单桌面工具，提供订单查询、JIT 物流处理、图片下载、尺码调整、支付预检，以及登录态同步。

## Windows 运行

双击根目录的 `领物做单器.pyw`。运行环境需要 Python、`requests`、`playwright`、`Pillow` 和 `openpyxl`。

## macOS 运行

Mac 源码位于 `macos/领物做单器.py`，运行环境需要 Python 3、`requests`、`playwright`、`Pillow` 和 `openpyxl`：

```bash
python3 macos/领物做单器.py
```

如果使用已打包的 `.app`，双击应用即可。`.app` 内的源码需保持与仓库的 `macos/领物做单器.py` 同步。

## 登录态同步

在“设置”中点击“一键复制同步脚本”，将脚本粘贴到 Tampermonkey 并启用。随后点击“接收登录态3分钟”，打开或刷新 `https://user.landwu.com/` 即可将登录态同步到本机。

`auth-state-v1.json` 是登录凭证，不会提交到此仓库。

## 更新

两个版本的“设置”中均有“检查更新”。它会通过本机已登录的 GitHub CLI（`gh`）读取此私有仓库：

- Windows 更新根目录的 `领物做单器.pyw`。
- macOS 更新 `macos/领物做单器.py`。

发现新版本并确认后，工具会覆盖当前运行的源码文件并自动重启。

首次使用更新功能前，请完成：

```powershell
gh auth login
```

## 仓库规则

- Windows 只修改根目录 `领物做单器.pyw`。
- macOS 只修改 `macos/领物做单器.py`。
- 不要提交 `auth-state-v1.json`、Cookie、token、本地订单数据或浏览器登录态。
- 推送前执行 `git pull --rebase origin main`，发生冲突时先解决冲突，不要强制推送。
