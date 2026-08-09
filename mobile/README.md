# 领物手机版做单器

这是手机端独立做单工作台。安卓 APK 登录 Landwu 后会全屏显示工作台，不再使用不适配手机的领物后台界面；同一份脚本也可以单独安装为 userscript。

## 安装

脚本地址：

```text
https://raw.githubusercontent.com/Frank-jpeg/landwu-order-tool/codex/landwu-mobile/mobile/landwu-mobile-v2026.08.09.2.user.js
```

安卓建议用支持 userscript 的浏览器安装脚本猫或 Tampermonkey。iPhone 可用支持 userscript 的 Safari 扩展。安装后，用同一个手机浏览器打开并登录 `https://user.landwu.com/`。

## 安卓 APK 套壳

如果手机浏览器不支持扩展，可以直接安装 APK。它内置 Android WebView，启动后打开 `https://user.landwu.com/`；登录领物后自动进入全屏做单工作台。

本机已有 Android SDK 时运行：

```powershell
.\mobile\android\build_apk.ps1
```

生成文件：

```text
mobile/android/build/outputs/landwu-mobile-debug.apk
```

这是固定签名的测试 APK，同一台手机后续可以直接覆盖更新。首次安装可能需要允许“安装未知来源应用”。

## 登录态

手机版不导入 `auth-state-v1.json`，也不上传 token。脚本只读取当前 Landwu 页面里的 `access_token` 和 `user_info`，并直接调用 Landwu 自己的接口。

## 功能范围

- 显示待编辑、JIT、VMI 和待付款数量。
- 一键预检并把全部待编辑 JIT 改为 TEMU 物流，随后等待订单进入待付款。
- VMI 只显示，不参与改物流。
- 待付款页按公开成分数据库匹配建议尺码。
- 待付款 SKU 直接显示图片缩略图，点图可放大核对款式。
- 一键修改全部匹配项，也可手动改为 `棉 / 涤纶 / 人棉 / 通用尺码`。
- 批量任务实时显示当前订单、完成进度、成功和失败结果。
- 提醒仍是“通用尺码”的 SKU。
- 重新核对待付款 JIT 后执行支付预检，通过后可真实支付；VMI 始终跳过。

当前版本只做在线看图，不做图片下载或桌面端完整验图流程。

## 成分数据库

默认读取：

```text
https://raw.githubusercontent.com/Frank-jpeg/landwu-order-tool/codex/landwu-mobile/mobile/composition-db.json
```

`composition-db.json` 由导出脚本生成并提交到 `codex/landwu-mobile` 分支，手机有网络时自动下载；成功下载后也会保存在 APK 的本机缓存中。记录格式如下：

```json
[
  {
    "SKC_ID": "1234567890",
    "SPU_ID": "9876543210",
    "SKU": "SKU-DEMO-001",
    "composition": "100%棉",
    "target_size": "棉"
  }
]
```

匹配优先级为 `SKC_ID -> SPU_ID -> SKU`。如果 `target_size` 为空，脚本会根据 `composition` 推断：优先 `人棉`，再 `涤纶/聚酯/polyester`，再 `棉`。

注意：这个仓库是公开仓库，放到 `composition-db.json` 的内容任何人拿到链接都能下载。不要放登录态、Cookie、token、私有订单数据或不想公开的数据库。

## 从本机数据库导出

固定位置已经定好：

- 本机来源目录：`D:\匹配成分数据库`
- 手机端公开文件：`mobile/composition-db.json`
- 手机端读取地址：`https://raw.githubusercontent.com/Frank-jpeg/landwu-order-tool/codex/landwu-mobile/mobile/composition-db.json`

更新数据库时运行：

```bash
python mobile/export_composition_db.py
```

导出脚本只写入 `SKC_ID / SPU_ID / SKU / composition / target_size`，不会提交原始 Excel/CSV 文件。
