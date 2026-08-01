# 领物做单器

Landwu 本地做单桌面工具，提供订单查询、JIT 物流处理、图片下载、尺码调整、支付预检，以及登录态同步。

## 运行

双击 `领物做单器.pyw`。运行环境需要 Python、`requests`、`playwright`、`Pillow` 和 `openpyxl`。

## 登录态同步

在“设置”中点击“一键复制同步脚本”，将脚本粘贴到 Tampermonkey 并启用。随后点击“接收登录态3分钟”，打开或刷新 `https://user.landwu.com/` 即可将登录态同步到本机。

`auth-state-v1.json` 是登录凭证，不会提交到此仓库。

## 更新

“设置”中的“检查更新”会通过本机已登录的 GitHub CLI（`gh`）读取此私有仓库。发现新版本并确认后，工具会覆盖当前 `.pyw` 文件并自动重启。

首次使用更新功能前，请完成：

```powershell
gh auth login
```
