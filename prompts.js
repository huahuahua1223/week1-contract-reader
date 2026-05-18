// 合约可读化助手 — Prompt 定义
//
// 把 prompt 独立成一个文件，便于：
// 1. Code review / 提交时贴 prompt 全文
// 2. 与任务证明文档第 3 章「关键 Prompt 与配置」一一对应
// 3. 与 LLM 交互逻辑（script.js）解耦

export const SYSTEM_PROMPT_ZH = `你是一名资深 Solidity 审计师与 Web3 教学助手。

你的任务：把一份已在 Etherscan 验证的智能合约源码，翻译成普通用户能看懂的中文说明。

【严格规则】
1. 只解释源码与 ABI 中真实存在的内容；不要发明任何函数、变量、地址或外部依赖。
2. 用「人话」描述，避免直接堆砌 Solidity 术语；首次出现的专有名词括注英文原名，例如：「所有者(owner)」。
3. 凡涉及外部合约、代理实现、链下依赖、未给出源码的库等不确定信息，在该条目前加 "⚠️ 未验证" 前缀。
4. 严格按下方 5 个二级标题输出 Markdown，标题文字一字不差，顺序不变。每段控制在 150 字以内。
5. 「风险点」一段必须显式核对以下清单，命中即列出，未命中也用一句话说明「未发现」：
   - 是否存在 owner / Ownable / onlyOwner 等权限角色
   - 是否为可升级合约（proxy / upgradeable / delegatecall to implementation）
   - 是否在转账时收税 / 黑名单 / 限额（transfer fee / tax / blacklist / maxTx）
   - 是否可暂停（Pausable / paused / whenNotPaused）
   - 是否存在 mint 函数，是否有总量上限
   - 是否存在 selfdestruct
6. 禁止给出任何投资、买卖、收益预测类建议；只给「与合约交互前应注意」的技术建议。
7. 若用户提示中出现 "[TRUNCATED]" 标记，必须在「合约一句话总结」段末尾加一句：「⚠️ 源码已被截断，本解读可能遗漏部分函数。」
8. 保持中立、克制；不夸张、不渲染恐慌；不使用 emoji 装饰（"⚠️" 标记除外）。

【输出格式（5 个二级标题，严格照抄）】
## 合约一句话总结
## 主要函数（人话）
## 关键状态变量
## 风险点
## 普通用户互动建议`;

/**
 * 拼装用户 prompt。
 *
 * @param {object} meta - 合约元信息
 *   - address: 合约地址
 *   - network: "Ethereum Mainnet" | "Sepolia Testnet"
 *   - contractName: 来自 Etherscan
 *   - compilerVersion: 编译器版本
 *   - isProxy: 是否被 Etherscan 标记为代理
 *   - implementation: 实现地址（代理时）或 ""
 * @param {string} abiSummary - ABI 函数签名摘要（多行）
 * @param {string} sourceCode - 已规范化、可能已截断的 Solidity 源码
 * @param {boolean} truncated - 是否被截断
 * @returns {string}
 */
export function buildUserPrompt(meta, abiSummary, sourceCode, truncated) {
  const truncatedFlag = truncated ? " [TRUNCATED]" : "";
  return `请解读下方智能合约。

【合约元信息】
- 地址：${meta.address}
- 网络：${meta.network}
- 合约名：${meta.contractName || "(未知)"}
- 编译器：${meta.compilerVersion || "(未知)"}
- 是否代理：${meta.isProxy ? "是" : "否"}
- 实现地址：${meta.implementation || "N/A"}

【ABI 函数签名摘要】
${abiSummary || "(无 ABI 或解析失败)"}

【源码（Solidity，${sourceCode.length} 字符${truncatedFlag}）】
\`\`\`solidity
${sourceCode}
\`\`\`

请严格按以下 5 个二级标题输出 Markdown：

## 合约一句话总结
## 主要函数（人话）
## 关键状态变量
## 风险点
## 普通用户互动建议`;
}

// 推荐的 LLM 参数
export const DEFAULT_TEMPERATURE = 0.2;
export const DEFAULT_MAX_TOKENS = 4096;

// OpenAI 兼容中转/国内 API 默认 endpoint（智增增）。
// 用户可在 UI 里改成任何 OpenAI 兼容的 chat/completions 地址：
//   - 智增增：https://api.zhizengzeng.com/v1/chat/completions（聚合 MiniMax / DeepSeek / Claude / GPT / Gemini）
//   - DeepSeek 官方：https://api.deepseek.com/v1/chat/completions
//   - 月之暗面 Kimi：https://api.moonshot.cn/v1/chat/completions
//   - 智谱：https://open.bigmodel.cn/api/paas/v4/chat/completions
//   - 自托管 vLLM / Ollama OpenAI 兼容层等
export const OPENAI_COMPAT_DEFAULT_URL = "https://api.zhizengzeng.com/v1/chat/completions";

// 模型清单
export const MODELS = {
  anthropic: [
    { id: "claude-opus-4-7", label: "Claude Opus 4.7（推荐）" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5（最快）" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o（推荐）" },
    { id: "gpt-4o-mini", label: "GPT-4o mini（最快）" },
  ],
  // 走 OpenAI 兼容协议的中转/国内服务。默认 endpoint 见 OPENAI_COMPAT_DEFAULT_URL。
  // 排序：免费的美团 LongCat 置顶 → MiniMax 收费 → DeepSeek → Kimi。
  openai_compat: [
    { id: "LongCat-Flash-Thinking-2601", label: "美团 LongCat Thinking（推荐，免费 ¥0）" },
    { id: "LongCat-Flash-Thinking", label: "美团 LongCat Thinking（免费 ¥0）" },
    { id: "Sphynx", label: "美团 Sphynx（Agentic，免费 ¥0）" },
    { id: "LongCat-Flash-Chat-2602-Exp", label: "美团 LongCat Chat 2602 Exp（免费 ¥0）" },
    { id: "LongCat-Flash-Chat", label: "美团 LongCat Chat（免费 ¥0）" },
    { id: "LongCat-Flash-Lite", label: "美团 LongCat Lite（最快，免费 ¥0）" },
    { id: "MiniMax-M2.7", label: "MiniMax M2.7（最新）" },
    { id: "MiniMax-M2.7-highspeed", label: "MiniMax M2.7 highspeed" },
    { id: "MiniMax-M2.5", label: "MiniMax M2.5（Agentic 推理强）" },
    { id: "MiniMax-M2.5-highspeed", label: "MiniMax M2.5 highspeed" },
    { id: "MiniMax-M2.1", label: "MiniMax M2.1" },
    { id: "deepseek-chat", label: "DeepSeek Chat" },
    { id: "deepseek-reasoner", label: "DeepSeek Reasoner" },
    { id: "kimi-k2-0905-preview", label: "Kimi K2" },
  ],
};
