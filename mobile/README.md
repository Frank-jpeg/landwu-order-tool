# 领物手机版做单器

这是手机端 userscript 版本，安装后会在 `https://user.landwu.com/` 页面内显示“领物手机版做单器”浮层。

## 安装

脚本地址：

```text
https://raw.githubusercontent.com/Frank-jpeg/landwu-order-tool/codex/landwu-mobile/mobile/landwu-mobile.user.js
```

安卓建议用支持 userscript 的浏览器安装脚本猫或 Tampermonkey。iPhone 可用支持 userscript 的 Safari 扩展。安装后，用同一个手机浏览器打开并登录 `https://user.landwu.com/`。

## 登录态

手机版不导入 `auth-state-v1.json`，也不上传 token。脚本只读取当前 Landwu 页面里的 `access_token` 和 `user_info`，并直接调用 Landwu 自己的接口。

## 功能范围

- 刷新待付款订单。
- 显示订单号、SKU、SKC、SPU、当前尺码。
- 按公开成分数据库给出建议尺码。
- 手动改为 `棉 / 涤纶 / 人棉 / 通用尺码`。
- 提交前二次确认，成功标绿，失败标红。
- 提醒仍是“通用尺码”的 SKU。

v1 不做支付、改物流、图片下载或桌面端完整一键流程。

## 成分数据库

默认读取：

```text
https://raw.githubusercontent.com/Frank-jpeg/landwu-order-tool/codex/landwu-mobile/mobile/composition-db.json
```

`composition-db.json` 当前是空数组。要启用网络匹配，把公开可用的记录按下面格式填进去并提交到 `codex/landwu-mobile` 分支：

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
