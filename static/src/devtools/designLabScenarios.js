const now = Date.now();

export const DESIGN_LAB_VIEWPORTS = Object.freeze([
  { key: "desktop", label: "桌面", width: "wide" },
  { key: "narrow", label: "窄屏", width: "narrow" },
  { key: "mobile", label: "移动", width: "mobile" }
]);

export const DESIGN_LAB_THEMES = Object.freeze([
  { key: "surface", label: "当前" },
  { key: "light", label: "浅色" },
  { key: "dark", label: "暗色" }
]);

export const DESIGN_LAB_AI_MEMBERS = Object.freeze([
  {
    aiId: 1,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    displayName: "DeepSeek Pro",
    avatarUrl: "/avatars/deepseek-logo.svg",
    thinkingMode: "comprehensive"
  },
  {
    aiId: 2,
    provider: "qwen",
    model: "qwen3.5-flash",
    displayName: "Qwen Flash",
    avatarUrl: "/avatars/qwen-logo.svg",
    thinkingMode: "counterexample"
  },
  {
    aiId: 3,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    displayName: "DeepSeek Flash",
    avatarUrl: "/avatars/deepseek-logo.svg",
    thinkingMode: "divergent"
  }
]);

export const DESIGN_LAB_THINKING_ADAPTERS = Object.freeze([
  "aggressive.md",
  "conservative.md",
  "comprehensive.md",
  "counterexample.md",
  "convergent.md",
  "divergent.md"
]);

export const DESIGN_LAB_MESSAGES = Object.freeze([
  {
    id: "lab-system-join",
    nickname: "__system__",
    text: "林夏 加入了项目复盘",
    timestamp: now - 1000 * 60 * 14,
    status: "sent"
  },
  {
    id: "lab-user-brief",
    nickname: "林夏",
    text: "我们先不要讨论完整方案，先确认这次复盘里哪些判断应该沉淀成下一轮工作的上下文。",
    timestamp: now - 1000 * 60 * 13,
    isSelf: true,
    status: "sent"
  },
  {
    id: "lab-ai-structure",
    nickname: "DeepSeek Pro",
    text: "我会把它拆成三层：\n\n1. 已经达成共识的事实\n2. 仍然开放的问题\n3. 暂时不要推进的方向\n\n如果把第二层提前写进共享白板，后续讨论会更容易保持边界。",
    timestamp: now - 1000 * 60 * 12,
    isAI: true,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    status: "sent"
  },
  {
    id: "lab-user-long",
    nickname: "林夏",
    text: "这个状态需要验证长中文、长英文单词和代码块混在一起时的排版：`conversation_context_boundary` 不应该把消息撑破，也不能挤压头像和作者行。\n\n```ts\nconst decision = {\n  type: \"open_question\",\n  ownerOnly: true,\n  source: \"current discussion\"\n};\n```",
    timestamp: now - 1000 * 60 * 11,
    isSelf: true,
    status: "sent"
  },
  {
    id: "lab-ai-interrupted",
    nickname: "Qwen Flash",
    text: "",
    timestamp: now - 1000 * 60 * 9,
    isAI: true,
    provider: "qwen",
    model: "qwen3.5-flash",
    status: "interrupted",
    aiErrorType: "Unauthorized"
  }
]);

export const DESIGN_LAB_PROPOSALS = Object.freeze([
  {
    id: "lab-proposal-open-question",
    aiId: 1,
    provider: "deepseek",
    model: "deepseek-v4-pro",
    displayName: "DeepSeek Pro",
    avatarUrl: "/avatars/deepseek-logo.svg",
    type: "question",
    title: "是否列为开放问题",
    reason: "这会进入讨论白板，影响后续多 AI 共用的背景。",
    actionLabel: "列为开放问题",
    rejectLabel: "暂不写入",
    sourceLabel: "讨论白板",
    createdAt: now - 1000 * 25
  },
  {
    id: "lab-proposal-phase",
    aiId: 2,
    provider: "qwen",
    model: "qwen3.5-flash",
    displayName: "Qwen Flash",
    avatarUrl: "/avatars/qwen-logo.svg",
    type: "phase",
    title: "是否切到收敛阶段",
    reason: "当前信息已经足够，继续发散会稀释讨论重点。",
    actionLabel: "进入收敛",
    rejectLabel: "保持当前阶段",
    sourceLabel: "阶段判断",
    createdAt: now - 1000 * 18
  },
  {
    id: "lab-proposal-note",
    aiId: 3,
    provider: "deepseek",
    model: "deepseek-v4-flash",
    displayName: "DeepSeek Flash",
    avatarUrl: "/avatars/deepseek-logo.svg",
    type: "note",
    title: "是否摘录为笔记",
    reason: "这段结论可以复用到后续房间，不需要再次推导。",
    actionLabel: "摘到笔记",
    rejectLabel: "先不摘录",
    sourceLabel: "可复用结论",
    createdAt: now - 1000 * 10
  }
]);

export const DESIGN_LAB_HOME_CARDS = Object.freeze([
  {
    title: "项目复盘的上下文边界",
    recall: "上次停在“哪些判断进入共享白板，哪些只留作个人立场”。",
    meta: "路径上 · 12 次访问 · 3 位 AI"
  },
  {
    title: "Auth 入口的房间感",
    recall: "登录不是落地页，而是用户试图继续进入一个真实讨论室。",
    meta: "同空间 · 昨天 · 设计基线"
  },
  {
    title: "AI 席位不是按钮",
    recall: "席位要像成员身体，有呼吸和状态，而不是工具栏里的模型开关。",
    meta: "更早 · 移动端验收"
  }
]);

export const DESIGN_LAB_SCENARIOS = Object.freeze([
  {
    id: "chat-rich-messages",
    group: "聊天",
    title: "消息进入与错误流程",
    surface: "MessageList",
    previewType: "messages",
    description: "脚本消息按顺序进入时间线，最后出现 AI 中断和额度提示。",
    checks: ["进入顺序自然", "代码块不撑破", "AI 错误身份正确"],
    tags: ["流程", "长内容", "错误"]
  },
  {
    id: "ai-seat-governance",
    group: "AI 席位",
    title: "席位入场与确认呼应",
    surface: "AiSeatStrip",
    previewType: "ai-seats",
    description: "AI 从空阵容进入多人席位，再出现一次讨论白板提议并回落。",
    checks: ["入席节奏自然", "呼应不抢主视觉", "移动端不变成按钮堆"],
    tags: ["席位", "流程", "确认"]
  },
  {
    id: "decision-dock-single",
    group: "上下文",
    title: "AI 提议完整流程",
    surface: "MessageList + AgentDecisionDock",
    previewType: "governance-flow",
    description: "自动发送一条脚本消息，AI 提议把一个分歧列为开放问题，再验收白板更新后的回落。",
    checks: ["过程节奏自然", "提议不是普通回复审批", "选择后空间能回落"],
    tags: ["举手", "上下文", "白板"]
  },
  {
    id: "decision-dock-single-frame",
    group: "上下文",
    title: "单个确认提议流程",
    surface: "AgentDecisionDock",
    previewType: "decision-single",
    description: "提议延迟进入，选择后退场并留下处理结果。",
    checks: ["进入不突兀", "不是普通回复审批", "选择后能退场"],
    tags: ["确认", "流程"],
    action: { type: "agent-proposal-single" },
    actionLabel: "发送到当前页面"
  },
  {
    id: "decision-dock-stack",
    group: "上下文",
    title: "多提议堆叠流程",
    surface: "AgentDecisionDock",
    previewType: "decision-stack",
    description: "先进入一个提议，再堆叠成队列，选择后验证退场结果。",
    checks: ["堆叠计数清楚", "转处理可访问", "选择后能退场"],
    tags: ["确认", "队列", "流程"],
    action: { type: "agent-proposal-stack" },
    actionLabel: "发送队列"
  },
  {
    id: "home-memory-cards",
    group: "Home",
    title: "记忆卡片浏览流程",
    surface: "Home card",
    previewType: "home-cards",
    description: "模拟用户在 Home 里依次掠过路径对象，验收卡片和窥看区的连续感。",
    checks: ["标题硬度适中", "窥看切换稳定", "metadata 退到背景"],
    tags: ["Home", "记忆", "流程"]
  },
  {
    id: "auth-room-state",
    group: "Auth",
    title: "未登录房间恢复流程",
    surface: "Auth preview",
    previewType: "auth-room",
    description: "模拟未登录用户回到房间、看见上一轮对话，并自然出现继续入口。",
    checks: ["第一屏有房间信号", "登录动作自然出现", "文案生活化"],
    tags: ["Auth", "入口", "流程"]
  },
  {
    id: "motion-entry",
    group: "动效",
    title: "进入与浮层动效",
    surface: "MessageList + Dock + Toast",
    previewType: "motion",
    description: "用真实消息、确认浮层和摘录 toast 回放进入节奏，避免开发者窗口维护第二套动效。",
    checks: ["直接复用真实组件", "退出可读", "短屏不跳动"],
    tags: ["动画", "过渡"],
    action: { type: "agent-proposal-clear" },
    actionLabel: "清除当前提议"
  },
  {
    id: "composer-draft",
    group: "输入",
    title: "输入框草稿流程",
    surface: "MessageInput",
    previewType: "composer",
    description: "脚本草稿进入输入框、增长为长文本、发送后回到空态。",
    checks: ["输入落点稳定", "按钮不挤压", "移动端不溢出"],
    tags: ["输入", "草稿", "流程"]
  }
]);

export function getInitialDesignLabScenarioId() {
  return DESIGN_LAB_SCENARIOS[0]?.id || "";
}

export function getDesignLabScenario(id) {
  return DESIGN_LAB_SCENARIOS.find((scenario) => scenario.id === id) || DESIGN_LAB_SCENARIOS[0] || null;
}

export function runDesignLabAction(action) {
  if (!action || typeof window === "undefined") return "";
  if (action.type === "agent-proposal-single") {
    window.dispatchEvent(new CustomEvent("atrium-agent-proposal", {
      detail: { ...DESIGN_LAB_PROPOSALS[0], id: `lab-proposal-${Date.now()}`, createdAt: Date.now() }
    }));
    return "已发送一个确认提议到当前页面";
  }
  if (action.type === "agent-proposal-stack") {
    window.dispatchEvent(new CustomEvent("atrium-agent-proposals", {
      detail: {
        proposals: DESIGN_LAB_PROPOSALS.map((proposal, index) => ({
          ...proposal,
          id: `lab-proposal-${Date.now()}-${index}`,
          createdAt: Date.now() + index
        }))
      }
    }));
    return "已发送确认提议队列到当前页面";
  }
  if (action.type === "agent-proposal-clear") {
    window.dispatchEvent(new CustomEvent("atrium-agent-proposal-clear", { detail: {} }));
    return "已清除当前页面确认提议";
  }
  return "";
}
