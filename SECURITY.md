# 安全与隐私说明

## 你的 API Key 去了哪里

| Key | 存放位置 | 离开浏览器吗 |
|---|---|---|
| LLM API Key | `localStorage`（仅当你勾选「保存到本地」） | 仅在你点「解读合约」时直接发送到 Anthropic / OpenAI API |
| Etherscan API Key | 同上 | 仅在拉取源码时作为 URL query 发送到 Etherscan |

**没有任何中间服务器**。本工具是一份纯静态 HTML/JS，你打开的页面是直接在你浏览器里执行的 JavaScript。

## 风险点

- `localStorage` 在以下情况会泄露 Key：
  - **公共电脑** — 别人能打开浏览器开发者工具读出来
  - **浏览器扩展** — 流氓扩展可以读取页面 localStorage
  - **XSS** — 如果将来被注入恶意脚本（目前代码里没有任何外部脚本）
- Etherscan Key 即使泄漏，影响只是别人用你的免费配额，不涉及资金。
- LLM Key 泄漏可能导致他人消耗你的账单余额，请及时 revoke。

## 推荐使用方式

- 在**自己的电脑、自己的浏览器**上使用
- 不要勾选「保存到 localStorage」，每次手动粘贴 → 关页面即清空
- 如果一定要勾选保存，**用完后点「清除全部 Key」**
- 申请 LLM Key 时设置**支出上限**（Anthropic 与 OpenAI 都支持）
- 定期 rotate Key

## 一键清除

设置面板里有一个永久可见的「**清除全部 Key**」按钮，点击后：

```js
localStorage.removeItem("cr.v1.settings");
location.reload();
```

仅清除本工具的命名空间，不影响其他网站的 localStorage。

## 仓库提交检查

本仓库为 **public**。提交前请人工确认：

```bash
git status                              # 无 .env / *.key / private/
grep -r "sk-ant-" .                     # 无 Anthropic key
grep -r "sk-proj-" .                    # 无 OpenAI key
grep -r "0x[0-9a-fA-F]\{64\}" .         # 无 64 位 hex（私钥长度）
```

截图前请关闭设置面板或马赛克遮挡 Key 输入框。
