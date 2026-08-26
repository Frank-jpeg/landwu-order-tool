# 项目规则

## 结构

- `main` 是 Windows/macOS 桌面版主线；`codex/landwu-mobile` 是手机版 APK / userscript 分支。
- 同一个工作目录切换分支时只会显示当前分支的文件；桌面功能以 `main` 为准，手机功能以 `codex/landwu-mobile` 为准。
- Windows 主程序：`领物做单器.pyw`。
- macOS 主程序：`macos/领物做单器.py`；已打包 `.app` 仅在需要修改启动器、依赖或应用结构时重新打包。
- 本机 macOS `.app` 的源码指路在 `Contents/Resources/source-info.json`。修改 Mac 源码后，如需立即在本机 `.app` 验证，先备份再同步到其中记录的运行文件；仓库提交仍以 `macos/领物做单器.py` 为准。

## 跨平台

- 面向用户的功能、设置项和更新机制默认同时评估 Windows 与 macOS；若不能同步，先说明差异。
- 待付款“修改成分尺码”可处理 JIT 和 VMI；改物流、一键流程、图片下载及支付保持仅处理 JIT。

## 更新与敏感数据

- 仓库为公开仓库。应用通过 GitHub Raw HTTPS 拉取对应源码更新，不使用 `gh`、Token 或私有仓库权限。
- 不提交登录态、Cookie、Token、浏览器存储、本地订单数据或数据库文件；`.gitignore` 是最后一道保护，提交前仍须检查暂存区。
- 不提交 Android 本机构建产物或 `mobile/android/*.keystore`；手机版覆盖安装依赖本机保存的签名文件，签名备份在 `D:\临时备份\landwu-mobile-signing\`。
- macOS 登录态和本地设置存于 `~/Library/Application Support/领物做单器/`；不得删除、提交或输出其内容。
- 每次发布用户可见改动时，Windows 与 macOS 的 `APP_VERSION` 使用相同的新版本号，确保“检查更新”的提示准确。

## 验证与交付

- 修改两端源码后，分别执行语法检查；涉及界面流程时验证空订单和正常订单路径。
- 提交前运行 `git diff --check`，只提交与当前任务有关的文件，并推送 `main`。
