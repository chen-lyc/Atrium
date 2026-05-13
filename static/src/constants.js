const EASE = [0.22, 1, 0.36, 1];

export const CHAT_URL = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}/chat`;

export const CHAT_RUNTIME_MODULES = () => Promise.all([
  import("./chat/ConnectionStatus.jsx"),
  import("./chat/MessageInput.jsx"),
  import("./chat/MessageFlight.jsx"),
  import("./chat/AiTeamEditor.jsx"),
  import("./chat/Sidebar.jsx"),
  import("./chat/WorkspacePanel.jsx"),
  import("./chat/ChatRoom.jsx")
]);

export const DEFAULT_CONVERSATION_ID = 1;
export const PERSONAL_ROOM_ID = "personal";
export const PUBLIC_ROOM_ID = "public";
export const PUBLIC_CONVERSATION_ID = 1;
export const DEFAULT_AI_MODEL = "deepseek-v4-flash";
export const AI_MODEL_OPTIONS = Object.freeze([
  {
    value: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    shortLabel: "V4 Flash",
    description: "快速回应，适合日常讨论、轻量整理和连续追问。",
    fit: "轻量讨论"
  },
  {
    value: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    shortLabel: "V4 Pro",
    description: "更深推理，适合复杂材料、长问题和需要反复校准的判断。",
    fit: "深度推演"
  },
  {
    value: "qwen3.5-plus",
    label: "Qwen 3.5 Plus",
    shortLabel: "3.5 Plus",
    description: "稳定平衡，适合讨论、改写和多轮整理。",
    fit: "通用协作"
  },
  {
    value: "qwen3.5-flash",
    label: "Qwen 3.5 Flash",
    shortLabel: "3.5 Flash",
    description: "轻量快速，适合即时反馈和短上下文处理。",
    fit: "快速回应"
  }
]);
export const AI_MODEL_LABELS = Object.freeze(
  AI_MODEL_OPTIONS.reduce((labels, model) => ({ ...labels, [model.value]: model.label }), {})
);
export const THINKING_MODE_OPTIONS = Object.freeze([
  { key: "default", label: "默认", adapterAliases: [] },
  { key: "aggressive", label: "激进", adapterAliases: ["aggressive.md", "challenger.md"] },
  { key: "conservative", label: "保守", adapterAliases: ["conservative.md", "cautious.md"] },
  { key: "comprehensive", label: "全面", adapterAliases: ["comprehensive.md"] },
  { key: "counterexample", label: "反例", adapterAliases: ["counterexample.md"] },
  { key: "convergent", label: "收敛", adapterAliases: ["convergent.md"] },
  { key: "divergent", label: "发散", adapterAliases: ["divergent.md"] },
  { key: "custom", label: "自定义", adapterAliases: [], isCustom: true }
]);
export const MESSAGE_CONTENT_MAX_LENGTH = 4000;
export const MESSAGE_HISTORY_PAGE_SIZE = 50;
export const MESSAGE_TYPE = Object.freeze({
  TEXT: 1,
  IMAGE: 2,
  FILE: 3,
  SYSTEM: 4
});
export { EASE };
export const TAP_TRANSITION = { duration: 0.12, ease: EASE };
export const NORMAL_SEND_FLIGHT = { duration: 0.34, ease: [0.2, 0.82, 0.2, 1] };
export const LOCAL_SEND_SETTLE_DELAY = 900;

export const STATUS_LABEL = {
  idle: "等待加入",
  connecting: "连接中",
  connected: "已连接",
  reconnecting: "重连中",
  disconnected: "已断开"
};

export const STATUS_COLOR = {
  idle: "#9B9A97",
  connecting: "#9B9A97",
  connected: "#238A52",
  reconnecting: "#B67A00",
  disconnected: "#D44C47"
};
