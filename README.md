# 合约可读化助手

输入一个已 Etherscan 验证的智能合约地址，AI 把它翻译成普通用户能看懂的中文说明：一句话总结、主要函数、关键状态变量、风险点、互动建议。

> AI x Web3 School Cohort 0 · Week 1 AI 向任务（30 学分）。

## 解决什么学习问题

新手在链上遇到一个陌生合约（DeFi 协议、空投合约、NFT 合约……）时，往往面对几百行 Solidity 不知道在做什么，也不知道是否安全。本工具用 LLM 把源码翻译成结构化中文，把审计师常看的几个点（owner、可升级、收税、暂停、mint 上限、selfdestruct）显式列出，给普通用户一个**快速判断框架**。

## 数据流向

```
你的浏览器  ──地址──▶  Etherscan API  ──源码 + ABI──▶  你的浏览器
                                                       │
                                                       ▼
                                                   LLM API
                                                       │
                                                       ▼
                                                  结构化中文解读
```

整条链路里，没有任何中间服务器。所有 API Key 仅存在你本地浏览器的 `localStorage`。

## 本地启动

```bash
cd week1-contract-reader
python3 -m http.server 8000
# 浏览器打开 http://localhost:8000
```

## 你需要准备的 Key

| Key | 必填 | 申请地址 |
|---|---|---|
| LLM API Key（任选其一） | ✅ | 见下方三种方案 |
| Etherscan API Key | ✅（V2 起强制；或点「使用离线样本」跳过） | <https://etherscan.io/myapikey> |

### LLM Provider 三种方案

| 方案 | 适用人群 | 设置面板选择 | 申请 / 文档 |
|---|---|---|---|
| **Anthropic Claude** | 海外或科学上网 | Provider = `Anthropic Claude` | <https://console.anthropic.com/> |
| **OpenAI GPT** | 海外或科学上网 | Provider = `OpenAI GPT` | <https://platform.openai.com/api-keys> |
| **国内中转（智增增）** | 中国大陆直连 + 想免费跑 | Provider = `OpenAI 兼容（中转/国内）`，Endpoint URL 默认填智增增；模型推荐 **美团 LongCat Thinking（¥0）** | <https://doc.zhizengzeng.com/doc-3979947> |

「OpenAI 兼容」分支兼容所有 OpenAI Chat Completions 协议的 endpoint，可以一键切换到任意中转或自托管 LLM：
- 智增增（默认）：`https://api.zhizengzeng.com/v1/chat/completions` — 聚合 MiniMax / DeepSeek / Claude / GPT / Gemini / Kimi 等
- DeepSeek 官方：`https://api.deepseek.com/v1/chat/completions`
- 月之暗面 Kimi：`https://api.moonshot.cn/v1/chat/completions`
- 智谱：`https://open.bigmodel.cn/api/paas/v4/chat/completions`
- 自托管 vLLM / Ollama OpenAI 兼容层等

> Etherscan 已在 2025 年弃用 V1 endpoint，迁移到 V2 unified endpoint（`https://api.etherscan.io/v2/api?chainid=...`）。
> V1 允许无 Key 走公共速率，V2 起 API Key 强制必填。免费 Key 申请 1 分钟搞定，同一 Key 跨所有 EVM 链通用。

第一次打开页面，在设置面板粘贴 Key、选择 provider 与网络，点击「解读合约」即可。

## 支持的网络

- Ethereum Mainnet（`api.etherscan.io`）
- Sepolia Testnet（`api-sepolia.etherscan.io`）

## 推荐试用合约

| 名称 | 网络 | 地址 |
|---|---|---|
| USDC | Mainnet | `0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48` |
| Uniswap V2 Router 02 | Mainnet | `0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D` |
| Sepolia LINK | Sepolia | `0x779877A7B0D9E8603169DdbD7836e478b4624789` |

## AI 与人工分工

| 部分 | 来源 |
|---|---|
| Etherscan 拉源码 / ABI 的工程逻辑 | 人工编写 |
| Prompt 设计（system + user + 5 段结构） | 人工编写 |
| 解读内容本身（5 段 Markdown） | LLM 生成 |
| 风险点检查清单（owner / 可升级 / 收税……） | 人工指定，LLM 按清单逐项核对 |
| 「人工复核栏」勾选（AI 推断 / 已比对源码 / 存疑） | **使用者本人**对 LLM 输出做最后判断 |

详见 [SECURITY.md](SECURITY.md) 与同仓库 `ai-web3-learning/tasks/week1-ai-interactive-artifact.md` 的「人工复核记录」章节。

## 已知限制

- LLM 解读**可能有错**，重要决策前必须自己读源码或咨询审计专家。
- 合约源码若未在 Etherscan 验证（`SourceCode` 为空），本工具只能基于 ABI 给出非常有限的解读。
- 超长合约（>60k 字符）会被截断，可能遗漏边缘函数。
- 代理合约的实际逻辑在 implementation 地址，需要二次输入实现地址才能拿到真实源码。
- 浏览器直调 LLM API 受跨域与 rate limit 限制；Anthropic 需要 `anthropic-dangerous-direct-browser-access` header。

## 下一步改进

- 代理合约自动跟踪到 implementation 地址再拉源码。
- 支持 BSC / Polygon / Arbitrum 等 EVM 链。
- 把 ABI 函数签名做 4byte selector 反查，识别已知合约方法。
- 在结果区加「函数高亮」：点击解读里的函数名跳到源码对应行。
- 把人工复核结果回写到 GitHub PR，做开源审计协作。
