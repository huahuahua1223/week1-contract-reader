// 合约可读化助手 — 主逻辑
//
// 单文件，无构建。所有 DOM、state、fetch、render 都在这里。
// 模块化的拆分原则：纯逻辑（validate / normalize / parse）与 UI（render / setStep）分开，
// 副作用（localStorage / fetch）独立成小函数。

// 版本号 query 与 index.html 中的 ?v= 保持一致；改 prompts.js 时一并 bump，
// 避免浏览器 ES module 强缓存导致旧版本生效。
import {
  SYSTEM_PROMPT_ZH,
  buildUserPrompt,
  DEFAULT_TEMPERATURE,
  DEFAULT_MAX_TOKENS,
  MODELS,
  OPENAI_COMPAT_DEFAULT_URL,
} from "./prompts.js?v=5";

// ============ 常量 ============

const STORAGE_KEY = "cr.v1.settings";
const MAX_SOURCE_CHARS = 60000;

const EXAMPLES = {
  usdc: {
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    network: "mainnet",
  },
  uniswap: {
    address: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
    network: "mainnet",
  },
  "sepolia-link": {
    address: "0x779877A7B0D9E8603169DdbD7836e478b4624789",
    network: "sepolia",
  },
};

// Etherscan V2（2025 起 V1 已 deprecated）：统一 host，用 chainid 区分链。
// 文档：https://docs.etherscan.io/v2-migration
const ETHERSCAN_V2_HOST = "https://api.etherscan.io/v2/api";
const CHAIN_IDS = {
  mainnet: 1,
  sepolia: 11155111,
};

const NETWORK_LABELS = {
  mainnet: "Ethereum Mainnet",
  sepolia: "Sepolia Testnet",
};

const SAMPLES = {
  mainnet: "samples/usdc-mainnet.json",
  sepolia: "samples/simple-erc20-sepolia.json",
};

const SECTION_TITLES = [
  "合约一句话总结",
  "主要函数（人话）",
  "关键状态变量",
  "风险点",
  "普通用户互动建议",
];

// ============ State ============

const state = {
  settings: {
    provider: "anthropic",
    model: MODELS.anthropic[0].id,
    llmKey: "",
    etherscanKey: "",
    network: "mainnet",
    persist: false,
    baseUrl: OPENAI_COMPAT_DEFAULT_URL,
  },
  contract: null, // { address, meta, abi, sourceCode, truncated }
  result: null,   // { raw, sections: {title -> markdown} }
  reviews: {},    // { title -> "ai" | "verified" | "doubt" }
  running: false,
};

// ============ 工具：localStorage ============

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    Object.assign(state.settings, saved);
    state.settings.persist = true;
  } catch (e) {
    console.warn("loadSettings failed", e);
  }
}

function saveSettings() {
  if (!state.settings.persist) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
}

function clearAllKeys() {
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
}

// ============ 校验 ============

function validateAddress(addr) {
  return /^0x[0-9a-fA-F]{40}$/.test(addr.trim());
}

// ============ Etherscan 拉源码 ============

async function fetchContractFromEtherscan(address, network, key) {
  const chainid = CHAIN_IDS[network];
  if (!chainid) throw new Error(`未知网络：${network}`);
  // Etherscan V2 起，API Key 是必填项（V1 允许无 Key 走公共速率，V2 取消了这一项）。
  if (!key) {
    throw new Error(
      "Etherscan V2 起 API Key 必填。请在左侧设置面板「Etherscan API Key」填入。\n" +
      "免费申请：https://etherscan.io/myapikey\n" +
      "或点「使用离线样本」按钮跳过 Etherscan，直接用项目自带 USDC 源码样本走通流程。"
    );
  }
  const params = new URLSearchParams({
    chainid: String(chainid),
    module: "contract",
    action: "getsourcecode",
    address,
    apikey: key,
  });
  const url = `${ETHERSCAN_V2_HOST}?${params.toString()}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Etherscan HTTP ${res.status}`);
  const data = await res.json();

  // Etherscan 错误风格：status="0" message="NOTOK" result="rate limit / Invalid Address"
  if (data.status === "0") {
    const msg = (data.result || data.message || "").toString();
    if (/rate limit/i.test(msg)) {
      throw rateLimitError(msg);
    }
    throw new Error(`Etherscan: ${msg || "未知错误"}`);
  }
  if (!Array.isArray(data.result) || data.result.length === 0) {
    throw new Error("Etherscan 返回为空");
  }
  return data.result[0];
}

function rateLimitError(msg) {
  const e = new Error(msg);
  e.code = "RATE_LIMIT";
  return e;
}

// 处理 Etherscan 多文件 JSON 格式（`{{...}}` 包裹）
function normalizeSource(rawSourceCode) {
  if (!rawSourceCode) return "";
  const s = rawSourceCode.trim();
  // 多文件 JSON：以 {{ 开头 }} 结尾
  if (s.startsWith("{{") && s.endsWith("}}")) {
    try {
      const inner = s.slice(1, -1); // 去掉外层一对花括号
      const obj = JSON.parse(inner);
      if (obj && obj.sources) {
        return Object.entries(obj.sources)
          .map(([name, v]) => `// ===== ${name} =====\n${v.content || ""}`)
          .join("\n\n");
      }
    } catch (e) {
      console.warn("multi-file parse failed, fallback to raw", e);
    }
  }
  // 单 JSON 包裹
  if (s.startsWith("{")) {
    try {
      const obj = JSON.parse(s);
      if (obj && obj.sources) {
        return Object.entries(obj.sources)
          .map(([name, v]) => `// ===== ${name} =====\n${v.content || ""}`)
          .join("\n\n");
      }
    } catch (e) {
      // 不是 JSON，按纯文本处理
    }
  }
  return s;
}

function truncateForPrompt(text, max = MAX_SOURCE_CHARS) {
  if (text.length <= max) return { text, truncated: false };
  // 保留头部 + 末尾，丢中间，标记截断
  const head = Math.floor(max * 0.7);
  const tail = max - head - 80;
  return {
    text:
      text.slice(0, head) +
      `\n\n// ... [TRUNCATED ${text.length - max} chars] ...\n\n` +
      text.slice(-tail),
    truncated: true,
  };
}

function summarizeABI(abiJson) {
  if (!abiJson) return "";
  let abi;
  try {
    abi = typeof abiJson === "string" ? JSON.parse(abiJson) : abiJson;
  } catch {
    return "";
  }
  if (!Array.isArray(abi)) return "";
  const items = abi.filter((x) => x.type === "function" || x.type === "event");
  return items
    .map((x) => {
      const inputs = (x.inputs || []).map((i) => `${i.type} ${i.name}`).join(", ");
      const outputs = (x.outputs || []).map((o) => o.type).join(", ");
      const mod = x.stateMutability ? ` [${x.stateMutability}]` : "";
      if (x.type === "event") return `event ${x.name}(${inputs})`;
      return `function ${x.name}(${inputs})${outputs ? " → " + outputs : ""}${mod}`;
    })
    .slice(0, 80) // 太多函数会撑爆 prompt，限 80 条
    .join("\n");
}

// ============ LLM 调用 ============

function buildLLMRequest(provider, model, systemPrompt, userPrompt, key, baseUrl) {
  if (provider === "anthropic") {
    return {
      url: "https://api.anthropic.com/v1/messages",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({
        model,
        max_tokens: DEFAULT_MAX_TOKENS,
        temperature: DEFAULT_TEMPERATURE,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    };
  }
  // openai 与 openai_compat 共享 OpenAI Chat Completions payload；只是 url 不同。
  if (provider === "openai" || provider === "openai_compat") {
    const url =
      provider === "openai"
        ? "https://api.openai.com/v1/chat/completions"
        : baseUrl;
    if (!url) throw new Error("OpenAI 兼容 endpoint URL 为空，请在设置面板填入。");
    return {
      url,
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: DEFAULT_MAX_TOKENS,
        temperature: DEFAULT_TEMPERATURE,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    };
  }
  throw new Error("Unknown provider: " + provider);
}

async function callLLM(provider, model, system, user, key, baseUrl) {
  const req = buildLLMRequest(provider, model, system, user, key, baseUrl);
  let res;
  try {
    res = await fetch(req.url, { method: "POST", headers: req.headers, body: req.body });
  } catch (e) {
    // 浏览器 fetch 在 LLM 端返回 4xx 且不带 CORS header 时也会抛 TypeError: Failed to fetch。
    // 大概率是 Key 错或 provider 选错。给精准提示，而不是泛泛的「网络错误」。
    throw new Error(
      `调用失败：${e.message}\n` +
      `常见原因：\n` +
      `  1) LLM API Key 错误或已撤销（Key 不对时 OpenAI/Anthropic 不返回 CORS header，浏览器显示成 CORS/Failed to fetch）\n` +
      `  2) Provider 与 Key 不匹配（Anthropic Key 选了 OpenAI，反之亦然）\n` +
      `  3) 浏览器扩展（如广告拦截器）拦截了 api.openai.com / api.anthropic.com\n` +
      `  4) 你所在地区被 LLM provider 屏蔽（可能需要代理）`
    );
  }
  if (!res.ok) {
    let detail = "";
    try {
      const data = await res.json();
      detail = data?.error?.message || JSON.stringify(data).slice(0, 240);
    } catch {
      detail = await res.text().catch(() => "");
    }
    const hint = explainLLMHttpError(res.status);
    throw new Error(`LLM ${res.status}：${detail || res.statusText}\n→ ${hint}`);
  }
  const data = await res.json();
  if (provider === "anthropic") {
    return data?.content?.[0]?.text || "";
  }
  return data?.choices?.[0]?.message?.content || "";
}

function explainLLMHttpError(status) {
  if (status === 401) return "Key 不正确或已被撤销，检查复制是否完整。";
  if (status === 403) return "可能是地区限制或 Key 权限不足。";
  if (status === 429) return "速率/余额限制，稍后重试或在 LLM 控制台检查余额。";
  if (status >= 500) return "LLM 服务端错误，稍后重试。";
  return "查看上方报错信息。";
}

// ============ 解析输出 ============

function parseStructuredOutput(text) {
  const sections = {};
  for (const title of SECTION_TITLES) sections[title] = "";

  // 用「## 标题」做切分
  const lines = text.split("\n");
  let current = null;
  for (const ln of lines) {
    const m = ln.match(/^##\s+(.+?)\s*$/);
    if (m) {
      // 标题可能略有偏差，做容错匹配
      const matched = SECTION_TITLES.find(
        (t) => m[1].includes(t) || t.includes(m[1])
      );
      if (matched) {
        current = matched;
        continue;
      }
    }
    if (current) sections[current] += ln + "\n";
  }
  // trim
  for (const k of Object.keys(sections)) sections[k] = sections[k].trim();
  return { raw: text, sections };
}

// ============ 极简 Markdown 渲染（避免引第三方库） ============

function escapeHTML(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function renderMarkdown(md) {
  let html = escapeHTML(md);
  // code `xxx`
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  // bold **xxx**
  html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  // italic *xxx*
  html = html.replace(/(^|[^\*])\*([^*\n]+)\*([^\*]|$)/g, "$1<em>$2</em>$3");
  // 列表项 - 或 *
  const lines = html.split("\n");
  const out = [];
  let inList = false;
  let inOL = false;
  for (const ln of lines) {
    const ul = ln.match(/^\s*[-*]\s+(.*)$/);
    const ol = ln.match(/^\s*\d+\.\s+(.*)$/);
    if (ul) {
      if (!inList) { out.push("<ul>"); inList = true; }
      if (inOL) { out.push("</ol>"); inOL = false; }
      out.push(`<li>${ul[1]}</li>`);
    } else if (ol) {
      if (!inOL) { out.push("<ol>"); inOL = true; }
      if (inList) { out.push("</ul>"); inList = false; }
      out.push(`<li>${ol[1]}</li>`);
    } else {
      if (inList) { out.push("</ul>"); inList = false; }
      if (inOL) { out.push("</ol>"); inOL = false; }
      if (ln.trim() === "") out.push("");
      else out.push(`<p>${ln}</p>`);
    }
  }
  if (inList) out.push("</ul>");
  if (inOL) out.push("</ol>");
  return out.join("\n");
}

// ============ UI 渲染 ============

const $ = (id) => document.getElementById(id);

function setStep(id, status, msg) {
  const el = document.getElementById("step-" + id);
  if (el) {
    el.classList.remove("active", "done", "fail");
    if (status) el.classList.add(status);
  }
  if (msg !== undefined) {
    const m = $("status-msg");
    m.textContent = msg || "";
    m.classList.remove("error", "warn");
    if (status === "fail") m.classList.add("error");
    if (status === "warn") m.classList.add("warn");
  }
}

function showPanel(id, show) {
  const el = $(id);
  if (!el) return;
  if (show) el.removeAttribute("hidden");
  else el.setAttribute("hidden", "");
}

function refreshModelOptions() {
  const sel = $("model");
  sel.innerHTML = "";
  const list = MODELS[state.settings.provider] || [];
  for (const m of list) {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = m.label;
    sel.appendChild(opt);
  }
  if (!list.find((x) => x.id === state.settings.model)) {
    state.settings.model = list[0]?.id || "";
  }
  sel.value = state.settings.model;
}

function renderResultCards(parsed) {
  const wrap = $("cards");
  wrap.innerHTML = "";
  const tpl = $("card-tpl");
  SECTION_TITLES.forEach((title, idx) => {
    const node = tpl.content.cloneNode(true);
    const card = node.querySelector(".card");
    card.dataset.title = title;
    node.querySelector(".card-title").textContent = `${idx + 1}. ${title}`;
    const body = node.querySelector(".card-body");
    const md = parsed.sections[title] || "*（LLM 未输出此段）*";
    body.innerHTML = renderMarkdown(md);
    // radio name 唯一化
    const radios = node.querySelectorAll(".review input[type=radio]");
    radios.forEach((r) => {
      r.name = `r-${idx}`;
      r.addEventListener("change", () => {
        state.reviews[title] = r.value;
      });
    });
    wrap.appendChild(node);
  });
}

function renderRawMeta() {
  const c = state.contract;
  if (!c) return;
  const meta = {
    address: c.address,
    network: NETWORK_LABELS[c.network],
    contractName: c.meta.contractName,
    compilerVersion: c.meta.compilerVersion,
    isProxy: c.meta.isProxy,
    implementation: c.meta.implementation,
    abiFunctions: c.abiSummary.split("\n").filter(Boolean).length,
    sourceLength: c.sourceCode.length,
    truncated: c.truncated,
  };
  $("raw-meta").textContent = JSON.stringify(meta, null, 2);
}

// ============ Markdown 导出 ============

function buildResultMarkdown() {
  const c = state.contract;
  const r = state.result;
  if (!c || !r) return "";
  const head = [
    `# 合约解读 · ${c.meta.contractName || "Unknown"}`,
    "",
    `- 地址：\`${c.address}\``,
    `- 网络：${NETWORK_LABELS[c.network]}`,
    `- 编译器：${c.meta.compilerVersion}`,
    `- 是否代理：${c.meta.isProxy ? "是" : "否"}`,
    "",
  ].join("\n");
  const body = SECTION_TITLES.map(
    (t) => `## ${t}\n\n${r.sections[t] || "*（LLM 未输出此段）*"}\n`
  ).join("\n");
  return head + body;
}

function buildReviewMarkdown() {
  const c = state.contract;
  const r = state.result;
  if (!c || !r) return "";
  const reviewLabel = {
    ai: "AI 推断（未核对）",
    verified: "已比对源码 ✓",
    doubt: "存疑 ⚠️",
  };
  const head = [
    `# 合约解读复核 · ${c.meta.contractName || "Unknown"}`,
    "",
    `- 地址：\`${c.address}\``,
    `- 网络：${NETWORK_LABELS[c.network]}`,
    `- 复核时间：${new Date().toISOString()}`,
    "",
    "本文档由「合约可读化助手」的「人工复核栏」导出，对应 WCB 提交指引第 4 点（区分 AI 生成与人工核对）。",
    "",
  ].join("\n");
  const body = SECTION_TITLES.map((t) => {
    const review = state.reviews[t];
    const label = review ? reviewLabel[review] : "（未复核）";
    return `## ${t}\n\n**复核状态：${label}**\n\n${r.sections[t] || ""}\n`;
  }).join("\n");
  return head + body;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ============ 主流程 ============

async function run({ useSample = false } = {}) {
  if (state.running) return;
  state.running = true;
  $("run").disabled = true;
  $("run-sample").disabled = true;

  showPanel("status-panel", true);
  showPanel("result-panel", false);
  ["validate", "fetch", "llm", "render"].forEach((s) => setStep(s, null));

  try {
    let meta, abi, sourceCode, address, network;

    if (useSample) {
      setStep("validate", "done");
      setStep("fetch", "active", "读取离线样本...");
      const samplePath = SAMPLES[state.settings.network] || SAMPLES.mainnet;
      const res = await fetch(samplePath);
      if (!res.ok) throw new Error(`样本加载失败：${res.status}`);
      const data = await res.json();
      meta = data.meta;
      abi = data.abi;
      sourceCode = data.sourceCode;
      address = meta.address;
      network = state.settings.network;
    } else {
      address = $("address").value.trim();
      network = state.settings.network;

      setStep("validate", "active", "校验地址...");
      if (!validateAddress(address)) {
        setStep("validate", "fail", "地址格式不对，必须是 0x 开头的 40 位 hex");
        return;
      }
      setStep("validate", "done");

      setStep("fetch", "active", "从 Etherscan 拉源码...");
      let raw;
      try {
        raw = await fetchContractFromEtherscan(
          address,
          network,
          state.settings.etherscanKey
        );
      } catch (e) {
        if (e.code === "RATE_LIMIT") {
          setStep(
            "fetch",
            "fail",
            "Etherscan 速率限制。可在设置面板填 Etherscan Key，或点「使用离线样本」试用 demo。"
          );
        } else {
          setStep("fetch", "fail", e.message);
        }
        return;
      }
      if (!raw.SourceCode || raw.SourceCode === "") {
        setStep(
          "fetch",
          "fail",
          "该地址在 Etherscan 上未验证源码，无法解读。请换一个 verified 的合约。"
        );
        return;
      }
      meta = {
        contractName: raw.ContractName || "",
        compilerVersion: raw.CompilerVersion || "",
        isProxy: raw.Proxy === "1",
        implementation: raw.Implementation || "",
      };
      abi = raw.ABI && raw.ABI !== "Contract source code not verified" ? raw.ABI : "";
      sourceCode = raw.SourceCode;
    }

    const normalized = normalizeSource(sourceCode);
    const { text: truncatedText, truncated } = truncateForPrompt(normalized);
    const abiSummary = summarizeABI(abi);

    state.contract = {
      address,
      network,
      meta,
      abi,
      abiSummary,
      sourceCode: truncatedText,
      truncated,
    };

    setStep("fetch", "done", `已获取源码：${normalized.length} 字符${truncated ? "（已截断）" : ""}`);

    setStep("llm", "active", "正在调用 LLM 解读...");
    if (!state.settings.llmKey) {
      setStep("llm", "fail", "未填写 LLM API Key，请在左侧设置面板粘贴。");
      return;
    }

    const userPrompt = buildUserPrompt(
      {
        address,
        network: NETWORK_LABELS[network],
        contractName: meta.contractName,
        compilerVersion: meta.compilerVersion,
        isProxy: meta.isProxy,
        implementation: meta.implementation,
      },
      abiSummary,
      truncatedText,
      truncated
    );

    let llmText;
    try {
      llmText = await callLLM(
        state.settings.provider,
        state.settings.model,
        SYSTEM_PROMPT_ZH,
        userPrompt,
        state.settings.llmKey,
        state.settings.baseUrl
      );
    } catch (e) {
      setStep("llm", "fail", e.message);
      return;
    }
    setStep("llm", "done");

    setStep("render", "active", "渲染中...");
    const parsed = parseStructuredOutput(llmText);
    state.result = parsed;
    state.reviews = {};
    renderResultCards(parsed);
    renderRawMeta();
    setStep("render", "done", "解读完成。请在每段卡片上勾选「AI 推断 / 已比对源码 / 存疑」做人工复核。");
    showPanel("result-panel", true);
  } finally {
    state.running = false;
    refreshRunButton();
    $("run-sample").disabled = false;
  }
}

// ============ 事件绑定 ============

function refreshRunButton() {
  const addrOk = validateAddress($("address").value.trim());
  const keyOk = !!state.settings.llmKey;
  $("run").disabled = !(addrOk && keyOk) || state.running;
}

function bindEvents() {
  $("provider").addEventListener("change", (e) => {
    state.settings.provider = e.target.value;
    refreshModelOptions();
    refreshBaseUrlVisibility();
    saveSettings();
  });
  $("base-url").addEventListener("input", (e) => {
    state.settings.baseUrl = e.target.value.trim() || OPENAI_COMPAT_DEFAULT_URL;
    saveSettings();
  });
  $("model").addEventListener("change", (e) => {
    state.settings.model = e.target.value;
    saveSettings();
  });
  $("llm-key").addEventListener("input", (e) => {
    state.settings.llmKey = e.target.value;
    saveSettings();
    refreshRunButton();
  });
  $("etherscan-key").addEventListener("input", (e) => {
    state.settings.etherscanKey = e.target.value;
    saveSettings();
  });
  $("network").addEventListener("change", (e) => {
    state.settings.network = e.target.value;
    saveSettings();
  });
  $("persist").addEventListener("change", (e) => {
    state.settings.persist = e.target.checked;
    saveSettings();
  });
  $("clear-keys").addEventListener("click", () => {
    if (confirm("确认清除所有 Key 和本地保存？")) clearAllKeys();
  });

  $("address").addEventListener("input", refreshRunButton);

  document.querySelectorAll(".chip[data-example]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ex = EXAMPLES[btn.dataset.example];
      if (!ex) return;
      $("address").value = ex.address;
      state.settings.network = ex.network;
      $("network").value = ex.network;
      saveSettings();
      refreshRunButton();
    });
  });

  $("run").addEventListener("click", () => run());
  $("run-sample").addEventListener("click", () => run({ useSample: true }));

  $("toggle-settings").addEventListener("click", () => {
    const body = $("settings-body");
    const btn = $("toggle-settings");
    const collapsed = body.hasAttribute("hidden");
    if (collapsed) {
      body.removeAttribute("hidden");
      btn.textContent = "收起";
      btn.setAttribute("aria-expanded", "true");
    } else {
      body.setAttribute("hidden", "");
      btn.textContent = "展开";
      btn.setAttribute("aria-expanded", "false");
    }
  });

  $("copy-md").addEventListener("click", async () => {
    const md = buildResultMarkdown();
    try {
      await navigator.clipboard.writeText(md);
      $("status-msg").textContent = "已复制 Markdown 到剪贴板。";
    } catch {
      $("status-msg").textContent = "复制失败（浏览器拒绝），可改用「下载 .md」。";
    }
  });
  $("download-md").addEventListener("click", () => {
    const md = buildResultMarkdown();
    const name = state.contract?.meta?.contractName || "contract";
    downloadText(`${name}-${state.contract.address.slice(0, 8)}.md`, md);
  });
  $("export-review").addEventListener("click", () => {
    const md = buildReviewMarkdown();
    const name = state.contract?.meta?.contractName || "contract";
    downloadText(`${name}-review.md`, md);
  });
}

function applySettingsToUI() {
  $("provider").value = state.settings.provider;
  refreshModelOptions();
  $("llm-key").value = state.settings.llmKey || "";
  $("etherscan-key").value = state.settings.etherscanKey || "";
  $("network").value = state.settings.network;
  $("persist").checked = state.settings.persist;
  $("base-url").value = state.settings.baseUrl || OPENAI_COMPAT_DEFAULT_URL;
  refreshBaseUrlVisibility();
}

function refreshBaseUrlVisibility() {
  const field = $("base-url-field");
  if (!field) return;
  if (state.settings.provider === "openai_compat") field.removeAttribute("hidden");
  else field.setAttribute("hidden", "");
}

// ============ 启动 ============

loadSettings();
applySettingsToUI();
bindEvents();
refreshRunButton();

// 桌面端默认展开设置面板；移动 / 平板默认收起
if (window.matchMedia("(max-width: 1024px)").matches) {
  $("settings-body").setAttribute("hidden", "");
  const btn = $("toggle-settings");
  btn.textContent = "展开";
  btn.setAttribute("aria-expanded", "false");
}
