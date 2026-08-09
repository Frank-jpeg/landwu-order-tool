# 项目规则

## 结构

- Windows 主程序：`领物做单器.pyw`。
- macOS 主程序：`macos/领物做单器.py`；已打包 `.app` 仅在需要修改启动器、依赖或应用结构时重新打包。
- 本机 macOS `.app` 的源码指路在 `Contents/Resources/source-info.json`。修改 Mac 源码后，如需立即在本机 `.app` 验证，先备份再同步到其中记录的运行文件；仓库提交仍以 `macos/领物做单器.py` 为准。
- 手机版使用 `mobile/landwu-mobile-v*.user.js`，Android 构建入口为 `mobile/android/build_apk.ps1`；安装、数据库和功能范围见 `mobile/README.md`。

## 跨平台

- 桌面端面向用户的功能、设置项和更新机制默认同时评估 Windows 与 macOS；若不能同步，先说明差异。
- 手机版是独立工作流。修改共享的 Landwu 接口或业务规则时评估三端影响；只修改移动端界面或 APK 时不要无关改动桌面端。
- 待付款“修改成分尺码”可处理 JIT 和 VMI；改物流、一键流程、图片下载及支付保持仅处理 JIT。

## 更新与敏感数据

- 仓库为公开仓库。应用通过 GitHub Raw HTTPS 拉取对应源码更新，不使用 `gh`、Token 或私有仓库权限。
- 不提交登录态、Cookie、Token、浏览器存储、本地订单数据或原始/私有数据库文件；`.gitignore` 是最后一道保护，提交前仍须检查暂存区。
- `mobile/composition-db.json` 是唯一允许提交的公开手机成分库，只能包含匹配 ID、成分和目标尺码；不得混入登录态或订单数据。
- macOS 登录态和本地设置存于 `~/Library/Application Support/领物做单器/`；不得删除、提交或输出其内容。
- 每次发布用户可见改动时，Windows 与 macOS 的 `APP_VERSION` 使用相同的新版本号，确保“检查更新”的提示准确。

## 验证与交付

- 修改两端源码后，分别执行语法检查；涉及界面流程时验证空订单和正常订单路径。
- 修改手机版 userscript 时另存新版本文件，并同步脚本元数据、`mobile/android/build_apk.ps1`、Android manifest 版本和 `mobile/README.md` 的 Raw 地址。
- 手机版至少执行 `node --check`、窄屏界面检查、APK 构建、签名校验和包内脚本版本检查。
- 提交前运行 `git diff --check`，只提交与当前任务有关的文件。桌面端交付到 `main`；手机版交付到 `codex/landwu-mobile`，除非用户明确要求合并。
