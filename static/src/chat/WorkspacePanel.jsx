import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { EASE, TAP_TRANSITION } from "../constants.js";
import {
  cancelFriendRequest,
  cancelRoomInvitation,
  createFriendRequest,
  createRoom,
  createRoomInvitation,
  deleteFriend,
  deleteRoom,
  fetchFriendRequests,
  fetchFriends,
  fetchAiUsage,
  fetchTodayAiUsage,
  fetchMyRoomInvitations,
  fetchRoomInvitations,
  fetchRoomMembers,
  getApiErrorMessage,
  removeRoomMember,
  renameRoom,
  respondFriendRequest,
  respondRoomInvitation,
  searchUsers,
  syncRoomAiMembers,
  updateRoomMemberRole
} from "../utils.js";
import { AiModelSelector, AiRosterList, AiSeatStrip, ModalLayer, mergeAiMemberOptions } from "./AiTeamEditor.jsx";

const ROLE_LABELS = {
  0: "房主",
  1: "协管",
  2: "成员"
};
const MANAGER_ROLES = new Set([0, 1]);
const EMPTY_AI_USAGE = Object.freeze({
  promptTokens: "0",
  completionTokens: "0",
  totalTokens: "0",
  requestCount: "0",
  models: []
});
const CHART_HEIGHT = 118;
const CHART_WIDTH = 260;
const MAX_VISIBLE_USAGE_MODELS = 5;
const OTHER_USAGE_COLOR = "#a8adb1";
const AI_USAGE_COLOR_RULES = [
  { test: /deepseek/i, color: "#7cc7f4" },
  { test: /qwen|通义/i, color: "#ad9cf2" },
  { test: /chatgpt|openai|gpt/i, color: "#8fa79b" },
  { test: /claude|anthropic/i, color: "#d8b887" },
  { test: /kimi|moonshot/i, color: "#8fb8d6" },
  { test: /doubao|豆包/i, color: "#d9a0a0" }
];
const AI_USAGE_FALLBACK_COLORS = ["#7cc7f4", "#ad9cf2", "#8fa79b", "#d8b887", "#8fb8d6"];
const TOKEN_USAGE_COLORS = Object.freeze({
  hit: "#9ed8ff",
  input: "#57aeff",
  output: "#096fe8"
});

function getRoleLabel(role) {
  return ROLE_LABELS[Number(role)] || "成员";
}
function normalizePositiveId(value) {
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}
function getAiMemberId(member) {
  return normalizePositiveId(member?.aiId ?? member?.ai_id ?? member?.id);
}
function getAiSupplementMembers(primaryMembers = [], fallbackMembers = []) {
  const primaryIds = new Set((primaryMembers || []).map(getAiMemberId).filter(Boolean));
  return (fallbackMembers || []).filter((member) => {
    const aiId = getAiMemberId(member);
    return aiId && !primaryIds.has(aiId);
  });
}

function RowAction({ children, kind = "secondary", busy = false, disabled = false, onClick }) {
  return (
    <motion.button
      type="button"
      className={`workspace-action is-${kind}`}
      onClick={onClick}
      disabled={disabled || busy}
      whileTap={disabled || busy ? undefined : { scale: 0.98 }}
      transition={TAP_TRANSITION}
    >
      {busy ? "处理中" : children}
    </motion.button>
  );
}

function EmptyLine({ children }) {
  return <div className="workspace-empty">{children}</div>;
}

function formatTokenCount(value) {
  const text = typeof value === "string" && /^\d+$/.test(value) ? value : "0";
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function formatUsagePercent(value, total) {
  if (!total) return "0%";
  const percent = (value / total) * 100;
  if (percent > 0 && percent < 1) return "<1%";
  return `${Math.round(percent)}%`;
}

function toChartNumber(value) {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  if (typeof value === "string" && value.trim()) {
    const numericValue = Number(value.replace(/,/g, ""));
    if (Number.isFinite(numericValue) && numericValue >= 0) return numericValue;
  }
  return 0;
}

function getIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getMonthDays() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: count }, (_, index) => getIsoDate(new Date(year, month, index + 1)));
}

function formatShortDate(date) {
  const [, month = "", day = ""] = String(date).split("-");
  return `${Number(month) || 0}-${Number(day) || 0}`;
}

function readFirst(item, keys, fallback = "") {
  for (const key of keys) {
    const value = item?.[key];
    if (value != null && value !== "") return value;
  }
  return fallback;
}

function normalizeUsageDay(item, fallbackDate, fallback = {}) {
  const promptTokens = toChartNumber(readFirst(item, ["prompt_tokens", "promptTokens", "input_tokens", "inputTokens"], fallback.promptTokens ?? 0));
  const cachedInputTokens = toChartNumber(readFirst(item, [
    "cached_prompt_tokens",
    "cachedPromptTokens",
    "input_cached_tokens",
    "inputCachedTokens",
    "cache_hit_tokens",
    "cacheHitTokens"
  ], fallback.cachedInputTokens ?? 0));
  const explicitUncached = readFirst(item, [
    "uncached_prompt_tokens",
    "uncachedPromptTokens",
    "input_uncached_tokens",
    "inputUncachedTokens"
  ], fallback.uncachedInputTokens ?? null);
  const uncachedInputTokens = explicitUncached == null
    ? Math.max(0, promptTokens - cachedInputTokens)
    : toChartNumber(explicitUncached);
  const completionTokens = toChartNumber(readFirst(item, ["completion_tokens", "completionTokens", "output_tokens", "outputTokens"], fallback.completionTokens ?? 0));
  const totalTokens = toChartNumber(readFirst(item, ["total_tokens", "totalTokens"], fallback.totalTokens ?? cachedInputTokens + uncachedInputTokens + completionTokens));

  return {
    date: String(readFirst(item, ["date", "day", "usage_date", "usageDate"], fallbackDate)),
    requestCount: toChartNumber(readFirst(item, ["api_requests", "apiRequests", "request_count", "requestCount", "requests", "calls"], 0)),
    cachedInputTokens,
    uncachedInputTokens,
    completionTokens,
    totalTokens
  };
}

function getUsageModelColor(model, index) {
  const name = String(model || "");
  const matched = AI_USAGE_COLOR_RULES.find((rule) => rule.test.test(name));
  return matched?.color || AI_USAGE_FALLBACK_COLORS[index % AI_USAGE_FALLBACK_COLORS.length];
}

function normalizeUsageModel(item, monthDays, index = 0) {
  const rawDays = Array.isArray(item?.days)
    ? item.days
    : Array.isArray(item?.daily)
      ? item.daily
      : Array.isArray(item?.series)
        ? item.series
        : [];
  const modelDayFallback = normalizeUsageDay(item, getIsoDate(new Date()));
  const effectiveRawDays = rawDays.length ? rawDays : modelDayFallback.totalTokens ? [{ date: modelDayFallback.date }] : [];
  const dayFallback = effectiveRawDays.length <= 1 ? modelDayFallback : {};
  const daysByDate = new Map(effectiveRawDays.map((day) => {
    const normalized = normalizeUsageDay(day, undefined, dayFallback);
    return [normalized.date, normalized];
  }));
  const days = monthDays.map((date) => daysByDate.get(date) || normalizeUsageDay({}, date));
  const requestCount = toChartNumber(readFirst(item, ["api_requests", "apiRequests", "request_count", "requestCount", "requests", "calls"], 0)) ||
    days.reduce((sum, day) => sum + day.requestCount, 0);
  const totalTokens = toChartNumber(readFirst(item, ["total_tokens", "totalTokens"], 0)) ||
    days.reduce((sum, day) => sum + day.totalTokens, 0);

  return {
    id: `${String(readFirst(item, ["id", "model", "model_name", "modelName", "name"], "ai"))}-${index}`,
    model: String(readFirst(item, ["model", "model_name", "modelName", "name"], "AI 用量")),
    requestCount,
    totalTokens,
    days
  };
}

function normalizeUsageModels(usage, currentModelLabel) {
  const monthDays = getMonthDays();
  const rawModels = Array.isArray(usage?.models)
    ? usage.models
    : Array.isArray(usage?.usage_by_model)
      ? usage.usage_by_model
      : Array.isArray(usage?.usageByModel)
        ? usage.usageByModel
        : [];

  if (rawModels.length) return rawModels.map((item, index) => normalizeUsageModel(item, monthDays, index));

  const today = getIsoDate(new Date());
  const day = normalizeUsageDay({
    date: today,
    prompt_tokens: usage?.promptTokens,
    completion_tokens: usage?.completionTokens,
    total_tokens: usage?.totalTokens,
    request_count: usage?.requestCount
  }, today);
  const days = monthDays.map((date) => date === today ? day : normalizeUsageDay({}, date));
  return [{
    id: `${currentModelLabel || "today-summary"}-0`,
    model: currentModelLabel || "今日汇总",
    requestCount: day.requestCount,
    totalTokens: day.totalTokens,
    days
  }];
}

function addUsageDays(models) {
  const baseDays = models[0]?.days || getMonthDays().map((date) => normalizeUsageDay({}, date));
  return baseDays.map((day, index) => models.reduce((sum, model) => {
    const nextDay = model.days[index] || normalizeUsageDay({}, day.date);
    return {
      date: day.date,
      requestCount: sum.requestCount + nextDay.requestCount,
      cachedInputTokens: sum.cachedInputTokens + nextDay.cachedInputTokens,
      uncachedInputTokens: sum.uncachedInputTokens + nextDay.uncachedInputTokens,
      completionTokens: sum.completionTokens + nextDay.completionTokens,
      totalTokens: sum.totalTokens + nextDay.totalTokens
    };
  }, normalizeUsageDay({}, day.date)));
}

function mergeUsageModels(models, label, id, color = OTHER_USAGE_COLOR) {
  const days = addUsageDays(models);
  return {
    id,
    model: label,
    requestCount: models.reduce((sum, model) => sum + model.requestCount, 0),
    totalTokens: models.reduce((sum, model) => sum + model.totalTokens, 0),
    days,
    color
  };
}

function prepareUsageModels(models) {
  return models
    .map((model, index) => ({ ...model, color: getUsageModelColor(model.model, index) }))
    .sort((a, b) => b.totalTokens - a.totalTokens);
}

function getVisibleUsageModels(models) {
  if (models.length <= MAX_VISIBLE_USAGE_MODELS) return models;
  const visible = models.slice(0, MAX_VISIBLE_USAGE_MODELS);
  const rest = models.slice(MAX_VISIBLE_USAGE_MODELS);
  return [...visible, mergeUsageModels(rest, `其他 ${rest.length} 个 AI`, "__other-ai-usage", OTHER_USAGE_COLOR)];
}

function getTodayTokens(models) {
  const today = getIsoDate(new Date());
  return models.reduce((sum, model) => {
    const day = model.days.find((item) => item.date === today);
    return sum + (day?.totalTokens || 0);
  }, 0);
}

function getNiceChartMax(values) {
  const rawMax = Math.max(0, ...values);
  if (!rawMax) return 1;
  const paddedMax = rawMax * 1.25;
  const magnitude = 10 ** Math.floor(Math.log10(paddedMax));
  const normalized = paddedMax / magnitude;
  const niceStep = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceStep * magnitude;
}

function UsageStackedTokenChart({ models, selectedModel }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const activeModels = selectedModel ? [selectedModel] : models;
  const detailModel = selectedModel || (activeModels.length === 1 ? activeModels[0] : null);
  const days = detailModel?.days || activeModels[0]?.days || getMonthDays().map((date) => normalizeUsageDay({}, date));
  const totals = days.map((_, index) => {
    if (detailModel) return detailModel.days[index]?.totalTokens || 0;
    return activeModels.reduce((sum, model) => sum + (model.days[index]?.totalTokens || 0), 0);
  });
  const maxValue = getNiceChartMax(totals);
  const activeDay = activeIndex == null ? null : days[activeIndex];
  const barStep = CHART_WIDTH / Math.max(days.length, 1);
  const barWidth = Math.max(2, Math.min(8, barStep * 0.58));

  function getRows(index) {
    if (detailModel) {
      const day = detailModel.days[index] || normalizeUsageDay({}, days[index]?.date);
      const rows = [
        { key: "output", label: "输出", value: day.completionTokens, color: TOKEN_USAGE_COLORS.output, opacity: 0.92 },
        { key: "input", label: "输入（未命中缓存）", value: day.uncachedInputTokens, color: TOKEN_USAGE_COLORS.input, opacity: 0.72 },
        { key: "hit", label: "输入（命中缓存）", value: day.cachedInputTokens, color: TOKEN_USAGE_COLORS.hit, opacity: 0.92 }
      ];
      const sum = rows.reduce((total, row) => total + row.value, 0);
      if (!sum && day.totalTokens) {
        return [{ key: detailModel.id, label: detailModel.model, value: day.totalTokens, color: detailModel.color, opacity: 0.82 }];
      }
      return rows;
    }

    return activeModels.map((model) => ({
      key: model.id,
      label: model.model,
      value: model.days[index]?.totalTokens || 0,
      color: model.color,
      opacity: 0.78
    }));
  }

  return (
    <div className="workspace-usage-chart">
      <div className="workspace-chart-axis is-top">{formatTokenCount(String(Math.ceil(maxValue)))}</div>
      <div className="workspace-chart-axis is-bottom">0</div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} role="img" aria-label="Token 用量趋势">
        <line x1="0" x2={CHART_WIDTH} y1="0" y2="0" />
        <line x1="0" x2={CHART_WIDTH} y1={CHART_HEIGHT} y2={CHART_HEIGHT} />
        {days.map((day, index) => {
          const x = index * barStep + (barStep - barWidth) / 2;
          let y = CHART_HEIGHT;
          const rows = getRows(index);
          return (
            <g key={day.date} onMouseEnter={() => setActiveIndex(index)} onMouseLeave={() => setActiveIndex(null)}>
              {rows.map((row) => {
                const height = maxValue ? (row.value / maxValue) * CHART_HEIGHT : 0;
                y -= height;
                return (
                  <rect
                    key={row.key}
                    x={x}
                    y={y}
                    width={barWidth}
                    height={height}
                    rx="1.5"
                    fill={row.color}
                    opacity={row.opacity}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      {activeDay ? (
        <div className="workspace-token-tooltip" style={{ left: `${Math.min(72, Math.max(28, (activeIndex / Math.max(days.length - 1, 1)) * 100))}%` }}>
          <strong>{activeDay.date}</strong>
          <b>{formatTokenCount(String(totals[activeIndex] || 0))} tokens</b>
          {(detailModel ? getRows(activeIndex).slice().reverse() : getRows(activeIndex)).filter((row) => row.value > 0).map((row) => (
            <span key={row.key} className="workspace-token-tooltip-row">
              <i style={{ background: row.color, opacity: row.opacity }} />
              <span className="workspace-token-tooltip-label">{row.label}</span>
              <span className="workspace-token-tooltip-value">{formatTokenCount(String(row.value))} tokens</span>
            </span>
          ))}
          {totals[activeIndex] ? null : <span>没有用量</span>}
        </div>
      ) : null}
      <div className="workspace-chart-labels">
        <span>{formatShortDate(days[0]?.date || "")}</span>
        <span>{formatShortDate(days[days.length - 1]?.date || "")}</span>
      </div>
    </div>
  );
}

function WorkspaceAiUsage({ usage, state, onRefresh, currentModelLabel }) {
  const [selectedModelId, setSelectedModelId] = useState("");
  const isLoading = state === "loading";
  const isError = state === "error";
  const usageModels = useMemo(() => prepareUsageModels(normalizeUsageModels(usage, currentModelLabel)), [usage, currentModelLabel]);
  const visibleModels = useMemo(() => getVisibleUsageModels(usageModels), [usageModels]);
  const selectedModel = visibleModels.find((model) => model.id === selectedModelId) || null;
  const totalTokens = usageModels.reduce((sum, model) => sum + model.totalTokens, 0);
  const todayTokens = getTodayTokens(usageModels);
  const chartLabel = selectedModel?.model || (visibleModels.length === 1 ? visibleModels[0]?.model : "全部 AI");
  const chartTokens = selectedModel?.totalTokens ?? totalTokens;

  useEffect(() => {
    if (selectedModelId && !visibleModels.some((model) => model.id === selectedModelId)) {
      setSelectedModelId("");
    }
  }, [selectedModelId, visibleModels]);

  return (
    <section className={`workspace-ai-usage ${isError ? "is-error" : ""}`} aria-label="AI 用量">
      <div className="workspace-ai-usage-head">
        <div>
          <span>AI 用量</span>
          <strong>{isLoading ? "同步中" : selectedModel?.model || "本月账本"}</strong>
        </div>
        {isError ? <RowAction busy={isLoading} onClick={onRefresh}>重试</RowAction> : <span className="workspace-usage-sync">{isLoading ? "同步中" : "已同步"}</span>}
      </div>
      <div className="workspace-usage-summary">
        <div>
          <span>本月</span>
          <strong>{isLoading ? "..." : formatTokenCount(String(totalTokens))}</strong>
          <small>tokens</small>
        </div>
        <div>
          <span>今日</span>
          <strong>{isLoading ? "..." : formatTokenCount(String(todayTokens))}</strong>
          <small>tokens</small>
        </div>
      </div>
      <div className="workspace-usage-chart-block">
        <div className="workspace-usage-chart-head">
          <div>
            <span>Tokens</span>
            <strong>{isLoading ? "..." : formatTokenCount(String(chartTokens))}</strong>
            <small>{chartLabel}</small>
          </div>
          {selectedModel ? (
            <button type="button" className="workspace-usage-clear" onClick={() => setSelectedModelId("")}>
              全部
            </button>
          ) : null}
        </div>
        <UsageStackedTokenChart models={visibleModels} selectedModel={selectedModel} />
      </div>
      <div className="workspace-usage-model-list" aria-label="AI 用量分布">
        {visibleModels.map((model) => {
          const selected = selectedModel?.id === model.id;
          return (
            <button
              key={model.id}
              type="button"
              className={`workspace-usage-model-row ${selected ? "is-active" : ""}`}
              style={{ "--usage-color": model.color, "--usage-share": `${totalTokens ? Math.max(2, (model.totalTokens / totalTokens) * 100) : 0}%` }}
              aria-pressed={selected}
              onClick={() => setSelectedModelId(selected ? "" : model.id)}
            >
              <span className="workspace-model-color" aria-hidden="true" />
              <span className="workspace-model-name">{model.model}</span>
              <span className="workspace-model-tokens">{isLoading ? "..." : formatTokenCount(String(model.totalTokens))}</span>
              <span className="workspace-model-share">{formatUsagePercent(model.totalTokens, totalTokens)}</span>
              <span className="workspace-model-share-bar" aria-hidden="true"><span /></span>
            </button>
          );
        })}
      </div>
      {isError ? <div className="workspace-ai-usage-note">AI 用量暂时不可用</div> : null}
    </section>
  );
}

function WorkspaceRoomBrief({ room, members, conversations, modelLabel, modelLoading }) {
  const discussionCount = conversations.length || 1;
  const resolvedModelLabel = modelLoading ? "团队同步中" : modelLabel || "未绑定 AI";
  return (
    <section className={`workspace-room-brief is-${room?.tone || "personal"}`} aria-label="房间概览">
      <div className="workspace-brief-copy">
        <div className="workspace-brief-title">{room?.placeLabel || "讨论室"}</div>
        <p>{room?.atmosphere || "把讨论放在同一个空间里继续。"}</p>
      </div>
      <div className="workspace-brief-rail" aria-label="空间工作结构">
        <div>
          <span>讨论线</span>
          <strong>{discussionCount} 个对话</strong>
          <small>{members.length || 0} 位成员</small>
        </div>
        <div>
          <span>当前 AI</span>
          <strong>{resolvedModelLabel}</strong>
          <small>随当前对话显示</small>
        </div>
        <div>
          <span>摘录入口</span>
          <strong>右键消息</strong>
          <small>从聊天上下文进入</small>
        </div>
      </div>
    </section>
  );
}

export default function WorkspacePanel({
  isOpen,
  onClose,
  currentUserId = "",
  room = null,
  rooms = [],
  readOnly = false,
  activeConversationModelLabel = "",
  isConversationModelLoading = false,
  activeConversation = null,
  isMainConversation = true,
  roomAiMembers = [],
  conversationAiMembers = [],
  effectiveAiMembers = [],
  availableAis = [],
  thinkingAdapters = [],
  aiConfigError = {},
  onRoomAiMembersSave = async () => [],
  onConversationAiMembersChange = async () => [],
  activeTab = "room",
  onTabChange = () => {},
  onRoomsChanged = async () => {},
  onConversationSelect = () => {},
  onRoomSelect = () => {}
}) {
  const [tab, setTab] = useState(() => ["room", "ai", "members", "contacts"].includes(activeTab) ? activeTab : "room");
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [aiAddOpen, setAiAddOpen] = useState(false);
  const [conversationAiOpen, setConversationAiOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomAiMembers, setNewRoomAiMembers] = useState([]);
  const [renameValue, setRenameValue] = useState(room?.name || "");
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [members, setMembers] = useState([]);
  const [friends, setFriends] = useState([]);
  const [receivedFriendRequests, setReceivedFriendRequests] = useState([]);
  const [sentFriendRequests, setSentFriendRequests] = useState([]);
  const [receivedRoomInvitations, setReceivedRoomInvitations] = useState([]);
  const [roomInvitations, setRoomInvitations] = useState([]);
  const [aiUsage, setAiUsage] = useState(EMPTY_AI_USAGE);
  const [aiUsageState, setAiUsageState] = useState("idle");
  const historicalUsageRef = useRef(EMPTY_AI_USAGE);
  const [panelState, setPanelState] = useState("idle");
  const [searchState, setSearchState] = useState("idle");
  const [actionKey, setActionKey] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const roomId = room?.roomId || 0;
  const normalizedCurrentUserId = String(currentUserId || "");
  const myMember = useMemo(
    () => members.find((member) => String(member.userId) === normalizedCurrentUserId) || null,
    [members, normalizedCurrentUserId]
  );
  const myRole = myMember ? Number(myMember.role) : null;
  const canManageRoom = myRole === 0;
  const canManageMembers = MANAGER_ROLES.has(myRole);
  const conversationCreatorId = normalizePositiveId(activeConversation?.createdBy ?? activeConversation?.created_by);
  const isConversationCreator = Boolean(conversationCreatorId && normalizedCurrentUserId && String(conversationCreatorId) === normalizedCurrentUserId);
  const canEditConversationAi = !isMainConversation && (canManageMembers || isConversationCreator || !conversationCreatorId);
  const isBaseRoom = room?.id === "personal" || room?.id === "public" || room?.roomId === 1;
  const isPersonalRoom = room?.id === "personal";
  const friendIds = useMemo(() => new Set(friends.map((friend) => friend.userId)), [friends]);
  const roomMemberIds = useMemo(() => new Set(members.map((member) => member.userId)), [members]);
  const conversationSupplementMembers = useMemo(
    () => getAiSupplementMembers(conversationAiMembers, roomAiMembers),
    [conversationAiMembers, roomAiMembers]
  );
  const aiMemberOptions = useMemo(
    () => mergeAiMemberOptions(availableAis, roomAiMembers, conversationAiMembers),
    [availableAis, roomAiMembers, conversationAiMembers]
  );

  function handleTabChange(nextTab) {
    setTab(nextTab);
    onTabChange(nextTab);
  }

  useEffect(() => {
    let resolvedTab = activeTab;
    if (["room", "ai", "members", "contacts"].includes(resolvedTab) && resolvedTab !== tab) {
      setTab(resolvedTab);
    }
  }, [activeTab, tab]);

  useEffect(() => {
    setRenameValue(room?.name || "");
    setNotice("");
    setError("");
    setConversationAiOpen(false);
  }, [room?.roomId, room?.name]);

  useEffect(() => {
    setConversationAiOpen(false);
  }, [activeConversation?.id, isMainConversation]);

  useEffect(() => {
    if (!isOpen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const controller = new AbortController();
    refreshPanel(controller.signal);
    refreshAiUsage(controller.signal);
    return () => controller.abort();
  }, [isOpen, roomId]);

  async function refreshAiUsage(signal) {
    setAiUsageState("loading");
    try {
      if (!historicalUsageRef.current.models || !historicalUsageRef.current.models.length) {
        const historyData = await fetchAiUsage(signal);
        historicalUsageRef.current = historyData;
      }
      const historical = historicalUsageRef.current;

      const today = await fetchTodayAiUsage(signal);
      const todayDate = getIsoDate(new Date());

      const modelByName = new Map();
      for (const m of (historical.models || [])) {
        const name = String(readFirst(m, ["model", "model_name", "modelName", "name"], "ai"));
        if (name) modelByName.set(name, { ...m });
      }
      for (const tm of (today.models || [])) {
        const name = String(readFirst(tm, ["model", "model_name", "modelName", "name"], "ai"));
        if (!name) continue;
        const existing = modelByName.get(name);
        if (existing) {
          const rawDays = Array.isArray(existing.days)
            ? existing.days : Array.isArray(existing.daily) ? existing.daily : [];
          const todayEntry = { ...tm };
          const days = rawDays
            .filter((d) => String(readFirst(d, ["date", "day", "usage_date", "usageDate"], "")) !== todayDate)
            .concat(todayEntry);
          modelByName.set(name, { ...existing, days });
        } else {
          modelByName.set(name, { ...tm });
        }
      }
      const mergedModels = [...modelByName.values()];

      setAiUsage({
        promptTokens: historical.promptTokens,
        completionTokens: historical.completionTokens,
        totalTokens: historical.totalTokens,
        requestCount: historical.requestCount,
        models: mergedModels
      });
      setAiUsageState("ready");
    } catch (err) {
      if (err?.name === "AbortError") return;
      setAiUsageState("error");
    }
  }

  async function refreshPanel(signal) {
    if (!roomId) return;
    setPanelState("loading");
    setError("");
    try {
      const [
        nextMembers,
        nextFriends,
        nextReceivedFriendRequests,
        nextSentFriendRequests,
        nextReceivedRoomInvitations,
        nextRoomInvitations
      ] = await Promise.all([
        fetchRoomMembers(roomId, signal),
        fetchFriends(signal),
        fetchFriendRequests("received", signal),
        fetchFriendRequests("sent", signal),
        fetchMyRoomInvitations("received", signal),
        fetchRoomInvitations(roomId, signal)
      ]);
      setMembers(nextMembers);
      setFriends(nextFriends);
      setReceivedFriendRequests(nextReceivedFriendRequests);
      setSentFriendRequests(nextSentFriendRequests);
      setReceivedRoomInvitations(nextReceivedRoomInvitations);
      setRoomInvitations(nextRoomInvitations);
      setPanelState("ready");
    } catch (err) {
      if (err?.name === "AbortError") return;
      setPanelState("error");
      setError(getApiErrorMessage(err, "空间信息加载失败"));
    }
  }

  async function runAction(key, action, successMessage = "", { refresh = true } = {}) {
    if (readOnly || actionKey) return;
    setActionKey(key);
    setError("");
    setNotice("");
    try {
      const result = await action();
      if (successMessage) setNotice(successMessage);
      if (refresh) await refreshPanel();
      return result;
    } catch (err) {
      setError(getApiErrorMessage(err));
      return null;
    } finally {
      setActionKey("");
    }
  }

  async function handleCreateRoom() {
    const name = newRoomName.trim();
    if (!name) {
      setError("请先给讨论室起名");
      return;
    }
    const created = await runAction("create-room", async () => {
      const nextRoom = await createRoom(name);
      if (nextRoom?.roomId && newRoomAiMembers.length) {
        await syncRoomAiMembers(nextRoom.roomId, newRoomAiMembers);
      }
      return nextRoom;
    }, "讨论室已创建");
    if (created?.roomId) {
      setNewRoomName("");
      setNewRoomAiMembers([]);
      setCreateRoomOpen(false);
      const nextRoom = await onRoomsChanged(created.roomId);
      if (nextRoom?.id) onRoomSelect(nextRoom.id);
    }
  }

  async function handleRenameRoom() {
    const name = renameValue.trim();
    if (!roomId || !name || name === room?.name) return;
    await runAction("rename-room", async () => {
      await renameRoom(roomId, name);
      await onRoomsChanged(roomId);
    }, "房间名已更新");
  }

  async function handleDeleteRoom() {
    if (!roomId || isBaseRoom || !window.confirm("删除这个讨论室？")) return;
    await runAction("delete-room", async () => {
      await deleteRoom(roomId);
      await onRoomsChanged();
    }, "讨论室已删除", { refresh: false });
  }

  async function handleLeaveRoom() {
    if (!roomId || !currentUserId || isBaseRoom || !window.confirm("退出这个讨论室？")) return;
    await runAction("leave-room", async () => {
      await removeRoomMember(roomId, currentUserId);
      await onRoomsChanged();
    }, "已退出讨论室", { refresh: false });
  }

  async function handleSearch() {
    const value = query.trim();
    if (!value) {
      setSearchResults([]);
      setSearchState("idle");
      return;
    }
    setSearchState("loading");
    setError("");
    try {
      setSearchResults(await searchUsers(value));
      setSearchState("ready");
    } catch (err) {
      setSearchState("error");
      setError(getApiErrorMessage(err, "没有搜索到用户"));
    }
  }

  function handleQueryKeyDown(event) {
    if (event.key === "Enter") {
      event.preventDefault();
      handleSearch();
    }
  }

  async function handleFriendRequest(userId) {
    await runAction(`friend-${userId}`, async () => {
      await createFriendRequest(userId);
    }, "好友请求已送出");
  }

  async function handleRespondFriend(requestId, status) {
    await runAction(`friend-request-${requestId}-${status}`, async () => {
      await respondFriendRequest(requestId, status);
    }, status === "accepted" ? "已成为好友" : "已忽略请求");
  }

  async function handleCancelFriendRequest(requestId) {
    await runAction(`friend-cancel-${requestId}`, async () => {
      await cancelFriendRequest(requestId);
    }, "请求已撤回");
  }

  async function handleDeleteFriend(userId) {
    await runAction(`friend-delete-${userId}`, async () => {
      await deleteFriend(userId);
    }, "好友已移除");
  }

  async function handleInviteFriend(userId) {
    await runAction(`invite-${userId}`, async () => {
      await createRoomInvitation(roomId, userId);
    }, "房间邀请已送出");
  }

  async function handleRespondRoomInvitation(invitationId, status) {
    await runAction(`room-invitation-${invitationId}-${status}`, async () => {
      await respondRoomInvitation(invitationId, status);
      if (status === "accepted") await onRoomsChanged();
    }, status === "accepted" ? "已加入讨论室" : "已忽略邀请");
  }

  async function handleCancelRoomInvitation(invitationId) {
    await runAction(`room-invitation-cancel-${invitationId}`, async () => {
      await cancelRoomInvitation(invitationId);
    }, "邀请已撤回");
  }

  async function handleMemberRole(member, role) {
    await runAction(`role-${member.userId}-${role}`, async () => {
      await updateRoomMemberRole(roomId, member.userId, role);
    }, "成员身份已更新");
  }

  async function handleRemoveMember(member) {
    await runAction(`remove-${member.userId}`, async () => {
      await removeRoomMember(roomId, member.userId);
    }, "成员已移出");
  }

  const inviteableFriends = friends.filter((friend) => !roomMemberIds.has(friend.userId));

  return (
    <AnimatePresence>
      {isOpen ? (
        <>
          <motion.div
            className="workspace-panel-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: EASE }}
            onClick={onClose}
          />
          <motion.aside
            className="workspace-panel"
            initial={{ opacity: 0, x: 18 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 18 }}
            transition={{ duration: 0.22, ease: EASE }}
            role="dialog"
            aria-modal="true"
            aria-label="空间管理"
            aria-labelledby="workspace-panel-title"
          >
            <header className="workspace-panel-header">
              <div>
                <div className="workspace-panel-kicker">空间管理</div>
                <h2 id="workspace-panel-title">{room?.name || "空间"}</h2>
                <p className="workspace-panel-subtitle">{room?.placeLabel || "讨论室"} · 对话与成员管理</p>
              </div>
              <button type="button" className="workspace-close focus-ring" onClick={onClose} aria-label="关闭空间管理">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </header>

            <div className="workspace-tabs" role="tablist" aria-label="空间管理分类">
              {[
                ["room", "空间"],
                ["ai", "AI"],
                ["members", "成员"],
                ["contacts", "联系人"]
              ].map(([id, label]) => (
	                <button
	                  key={id}
	                  type="button"
	                  className={`workspace-tab ${tab === id ? "is-active" : ""}`}
	                  onClick={() => handleTabChange(id)}
                  role="tab"
                  aria-selected={tab === id}
                  aria-controls={`workspace-panel-${id}`}
                  id={`workspace-tab-${id}`}
                >
                  {label}
                </button>
              ))}
            </div>

            {notice ? <div className="workspace-notice">{notice}</div> : null}
            {error ? <div className="workspace-error">{error}</div> : null}
            {panelState === "loading" ? <div className="workspace-loading">正在同步空间</div> : null}

            <div
              className="workspace-panel-body"
              role="tabpanel"
              id={`workspace-panel-${tab}`}
              aria-labelledby={`workspace-tab-${tab}`}
            >
              {tab === "room" ? (
                <div className="workspace-stack">
                  <WorkspaceRoomBrief
                    room={room}
                    members={members}
                    conversations={room?.conversations || []}
                    modelLabel={activeConversationModelLabel}
                    modelLoading={isConversationModelLoading}
                  />

                  <section className="workspace-section">
                    <div className="workspace-section-title">新讨论室</div>
                    <div className="workspace-create-room-entry">
                      <RowAction kind="primary" busy={actionKey === "create-room"} disabled={readOnly} onClick={() => setCreateRoomOpen(true)}>新建房间</RowAction>
                    </div>
                  </section>

                  <section className="workspace-section">
                    <div className="workspace-section-title">当前房间</div>
                    <div className="workspace-inline-form">
                      <input
                        className="workspace-input"
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        maxLength={32}
                        disabled={readOnly || !canManageRoom}
                      />
                      <RowAction busy={actionKey === "rename-room"} disabled={readOnly || !canManageRoom || renameValue.trim() === room?.name} onClick={handleRenameRoom}>保存</RowAction>
                    </div>
                    <div className="workspace-room-meta">
                      <span>{members.length || 0} 位成员</span>
                      <span>{roomInvitations.length || 0} 个待回应邀请</span>
                    </div>
                    {isBaseRoom ? null : (
                      <div className="workspace-danger-row">
                        {canManageRoom ? <RowAction kind="danger" busy={actionKey === "delete-room"} onClick={handleDeleteRoom}>删除房间</RowAction> : null}
                        {myRole !== 0 ? <RowAction kind="danger" busy={actionKey === "leave-room"} onClick={handleLeaveRoom}>退出房间</RowAction> : null}
                      </div>
                    )}
                  </section>

                </div>
              ) : null}

              {tab === "ai" ? (
                <div className="workspace-stack">
                  <WorkspaceAiUsage
                    usage={aiUsage}
                    state={aiUsageState}
                    onRefresh={() => refreshAiUsage()}
                    currentModelLabel={activeConversationModelLabel}
                  />

                  <section className="workspace-section">
                    <div className="workspace-section-title">当前对话团队</div>
                    <div className="workspace-ai-team">
                      <div className="workspace-ai-team-head">
                        <span>{effectiveAiMembers.length ? `${effectiveAiMembers.length} 位 AI` : "无 AI"}</span>
                        <small>
                          {isMainConversation
                            ? "主对话使用房间 AI"
                            : canEditConversationAi
                              ? "本对话可单独调整"
                              : "仅创建者、房主或协管可调整"}
                        </small>
                      </div>
                      {aiConfigError?.conversation ? <div className="workspace-ai-team-warning">{aiConfigError.conversation}</div> : null}
                      {isMainConversation ? (
                        <AiRosterList
                          members={roomAiMembers}
                          thinkingAdapters={thinkingAdapters}
                          readOnly={true}
                          onChange={async () => roomAiMembers}
                          emptyText="主对话未绑定 AI"
                        />
                      ) : (
                        <>
                          <AiRosterList
                            members={conversationAiMembers}
                            thinkingAdapters={thinkingAdapters}
                            readOnly={readOnly || !canEditConversationAi}
                            onChange={onConversationAiMembersChange}
                            emptyText="本对话未单独添加 AI"
                          />
                          {conversationSupplementMembers.length ? (
                            <div className="workspace-ai-supplement" aria-label="来自房间默认团队的 AI">
                              <span>房间补位</span>
                              <AiSeatStrip
                                members={conversationSupplementMembers}
                                thinkingAdapters={thinkingAdapters}
                                readOnly={true}
                                onChange={async () => conversationSupplementMembers}
                                emptyText=""
                              />
                            </div>
                          ) : null}
                          <div className="workspace-ai-team-foot">
                            <button type="button" className="workspace-ai-add focus-ring" onClick={() => setConversationAiOpen(true)} disabled={readOnly || !canEditConversationAi}>
                              + 调整本对话 AI
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </section>

                  <section className="workspace-section">
                    <div className="workspace-section-title">房间默认团队</div>
                    <div className="workspace-ai-team">
                      <div className="workspace-ai-team-head">
                        <span>{roomAiMembers.length ? `${roomAiMembers.length} 位 AI` : "无 AI"}</span>
                        <small>{canManageRoom ? "新对话默认继承这里" : "只有房主可以修改房间默认"}</small>
                      </div>
                      {aiConfigError?.room ? <div className="workspace-ai-team-warning">{aiConfigError.room}</div> : null}
                      {aiConfigError?.models ? <div className="workspace-ai-team-warning">{aiConfigError.models}</div> : null}
                      <AiRosterList
                        members={roomAiMembers}
                        thinkingAdapters={thinkingAdapters}
                        readOnly={readOnly || !canManageRoom}
                        onChange={onRoomAiMembersSave}
                        emptyText="房间默认阵容为空"
                      />
                      <div className="workspace-ai-team-foot">
                        <button type="button" className="workspace-ai-add focus-ring" onClick={() => setAiAddOpen(true)} disabled={readOnly || !canManageRoom}>
                          + 添加 AI
                        </button>
                      </div>
                    </div>
                  </section>
                </div>
              ) : null}

              {tab === "members" ? (
                <div className="workspace-stack">
                  <section className="workspace-section">
                    <div className="workspace-section-title">成员</div>
                    <div className="workspace-list">
                      {members.length ? members.map((member) => {
                        const isSelf = String(member.userId) === normalizedCurrentUserId;
                        const isOwner = Number(member.role) === 0;
                        return (
                          <div key={member.userId} className="workspace-row">
                            <div className="workspace-row-main">
                              <span>{member.nickname}</span>
                              <small>{getRoleLabel(member.role)} · #{member.userId}</small>
                            </div>
                            {canManageMembers && !isSelf && !isOwner ? (
                              <div className="workspace-row-actions">
                                {canManageRoom ? (
                                  <RowAction busy={actionKey === `role-${member.userId}-${Number(member.role) === 1 ? 2 : 1}`} onClick={() => handleMemberRole(member, Number(member.role) === 1 ? 2 : 1)}>
                                    {Number(member.role) === 1 ? "设为成员" : "设为协管"}
                                  </RowAction>
                                ) : null}
                                <RowAction kind="danger" busy={actionKey === `remove-${member.userId}`} onClick={() => handleRemoveMember(member)}>移出</RowAction>
                              </div>
                            ) : null}
                          </div>
                        );
                      }) : <EmptyLine>暂无成员数据</EmptyLine>}
                    </div>
                  </section>

                  {isPersonalRoom ? null : (
                    <section className="workspace-section">
                      <div className="workspace-section-title">邀请好友</div>
                      <div className="workspace-list">
                        {inviteableFriends.length ? inviteableFriends.map((friend) => (
                          <div key={friend.userId} className="workspace-row">
                            <div className="workspace-row-main">
                              <span>{friend.nickname}</span>
                              <small>#{friend.userId}</small>
                            </div>
                            <RowAction busy={actionKey === `invite-${friend.userId}`} disabled={!roomId} onClick={() => handleInviteFriend(friend.userId)}>邀请</RowAction>
                          </div>
                        )) : <EmptyLine>没有可邀请的好友</EmptyLine>}
                      </div>
                    </section>
                  )}

                  {isPersonalRoom ? null : (
                    <section className="workspace-section">
                      <div className="workspace-section-title">已发房间邀请</div>
                      <div className="workspace-list">
                        {roomInvitations.length ? roomInvitations.map((invitation) => (
                          <div key={invitation.invitationId} className="workspace-row">
                            <div className="workspace-row-main">
                              <span>{invitation.inviteeNickname || `用户 ${invitation.inviteeId}`}</span>
                              <small>等待回应</small>
                            </div>
                            <RowAction busy={actionKey === `room-invitation-cancel-${invitation.invitationId}`} onClick={() => handleCancelRoomInvitation(invitation.invitationId)}>撤回</RowAction>
                          </div>
                        )) : <EmptyLine>没有待回应的房间邀请</EmptyLine>}
                      </div>
                    </section>
                  )}
                </div>
              ) : null}

              {tab === "contacts" ? (
                <div className="workspace-stack">
                  <section className="workspace-section">
                    <div className="workspace-section-title">找人</div>
                    <div className="workspace-inline-form">
                      <input
                        className="workspace-input"
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        onKeyDown={handleQueryKeyDown}
                        placeholder="昵称或用户 ID"
                      />
                      <RowAction kind="primary" busy={searchState === "loading"} onClick={handleSearch}>搜索</RowAction>
                    </div>
                    <div className="workspace-list is-search">
                      {searchResults.length ? searchResults.map((user) => {
                        const isSelf = String(user.userId) === normalizedCurrentUserId;
                        const isFriend = friendIds.has(user.userId);
                        return (
                          <div key={user.userId} className="workspace-row">
                            <div className="workspace-row-main">
                              <span>{user.nickname}</span>
                              <small>{user.username || `#${user.userId}`}</small>
                            </div>
                            {isSelf ? <span className="workspace-muted">你自己</span> : isFriend ? <span className="workspace-muted">已是好友</span> : (
                              <RowAction busy={actionKey === `friend-${user.userId}`} onClick={() => handleFriendRequest(user.userId)}>加好友</RowAction>
                            )}
                          </div>
                        );
                      }) : searchState === "ready" ? <EmptyLine>没有匹配用户</EmptyLine> : null}
                    </div>
                  </section>

                  <section className="workspace-section">
                    <div className="workspace-section-title">好友</div>
                    <div className="workspace-list">
                      {friends.length ? friends.map((friend) => (
                        <div key={friend.userId} className="workspace-row">
                          <div className="workspace-row-main">
                            <span>{friend.nickname}</span>
                            <small>#{friend.userId}</small>
                          </div>
                          <RowAction kind="danger" busy={actionKey === `friend-delete-${friend.userId}`} onClick={() => handleDeleteFriend(friend.userId)}>移除</RowAction>
                        </div>
                      )) : <EmptyLine>暂无好友</EmptyLine>}
                    </div>
                  </section>

                  <section className="workspace-section">
                    <div className="workspace-section-title">好友请求</div>
                    <div className="workspace-list">
                      {receivedFriendRequests.map((request) => (
                        <div key={request.requestId} className="workspace-row">
                          <div className="workspace-row-main">
                            <span>{request.peerNickname}</span>
                            <small>请求成为好友</small>
                          </div>
                          <div className="workspace-row-actions">
                            <RowAction busy={actionKey === `friend-request-${request.requestId}-accepted`} onClick={() => handleRespondFriend(request.requestId, "accepted")}>接受</RowAction>
                            <RowAction kind="danger" busy={actionKey === `friend-request-${request.requestId}-rejected`} onClick={() => handleRespondFriend(request.requestId, "rejected")}>忽略</RowAction>
                          </div>
                        </div>
                      ))}
                      {sentFriendRequests.map((request) => (
                        <div key={request.requestId} className="workspace-row">
                          <div className="workspace-row-main">
                            <span>{request.peerNickname}</span>
                            <small>等待对方回应</small>
                          </div>
                          <RowAction busy={actionKey === `friend-cancel-${request.requestId}`} onClick={() => handleCancelFriendRequest(request.requestId)}>撤回</RowAction>
                        </div>
                      ))}
                      {!receivedFriendRequests.length && !sentFriendRequests.length ? <EmptyLine>没有待处理好友请求</EmptyLine> : null}
                    </div>
                  </section>

                  <section className="workspace-section">
                    <div className="workspace-section-title">房间邀请</div>
                    <div className="workspace-list">
                      {receivedRoomInvitations.length ? receivedRoomInvitations.map((invitation) => (
                        <div key={invitation.invitationId} className="workspace-row">
                          <div className="workspace-row-main">
                            <span>{invitation.roomName || `讨论室 ${invitation.roomId}`}</span>
                            <small>来自用户 #{invitation.inviterId}</small>
                          </div>
                          <div className="workspace-row-actions">
                            <RowAction busy={actionKey === `room-invitation-${invitation.invitationId}-accepted`} onClick={() => handleRespondRoomInvitation(invitation.invitationId, "accepted")}>加入</RowAction>
                            <RowAction kind="danger" busy={actionKey === `room-invitation-${invitation.invitationId}-rejected`} onClick={() => handleRespondRoomInvitation(invitation.invitationId, "rejected")}>忽略</RowAction>
                          </div>
                        </div>
                      )) : <EmptyLine>没有新的房间邀请</EmptyLine>}
                    </div>
                  </section>
                </div>
              ) : null}
            </div>
          </motion.aside>
          <ModalLayer
            isOpen={createRoomOpen}
            title="新建房间"
            subtitle="先命名房间，再配置默认 AI 阵容"
            onClose={() => setCreateRoomOpen(false)}
          >
            <div className="ai-create-room">
              <label className="ai-create-room-name">
                <span>房间名</span>
                <input
                  className="workspace-input"
                  value={newRoomName}
                  onChange={(event) => setNewRoomName(event.target.value)}
                  placeholder="例如：项目复盘"
                  maxLength={32}
                  disabled={readOnly || actionKey === "create-room"}
                />
              </label>
              <div className="ai-create-room-main">
                <AiModelSelector
                  models={aiMemberOptions}
                  members={newRoomAiMembers}
                  thinkingAdapters={thinkingAdapters}
                  readOnly={readOnly || actionKey === "create-room"}
                  onChange={async (nextMembers) => {
                    setNewRoomAiMembers(nextMembers);
                    return nextMembers;
                  }}
                  className="is-room-create"
                />
              </div>
              <div className="ai-create-room-seats">
                <AiSeatStrip
                  members={newRoomAiMembers}
                  thinkingAdapters={thinkingAdapters}
                  readOnly={readOnly || actionKey === "create-room"}
                  onChange={async (nextMembers) => {
                    setNewRoomAiMembers(nextMembers);
                    return nextMembers;
                  }}
                  emptyText="无 AI"
                />
              </div>
              <div className="ai-create-room-actions">
                <RowAction busy={actionKey === "create-room"} disabled={readOnly || !newRoomName.trim()} onClick={handleCreateRoom}>创建</RowAction>
              </div>
            </div>
          </ModalLayer>
          <ModalLayer
            isOpen={conversationAiOpen}
            title="调整本对话 AI"
            subtitle="只影响当前普通对话，房间默认团队会继续补位"
            onClose={() => setConversationAiOpen(false)}
          >
            <AiModelSelector
              models={aiMemberOptions}
              members={conversationAiMembers}
              thinkingAdapters={thinkingAdapters}
              readOnly={readOnly || !canEditConversationAi}
              onChange={onConversationAiMembersChange}
              className="is-workspace-modal"
            />
          </ModalLayer>
          <ModalLayer
            isOpen={aiAddOpen}
            title="添加 AI"
            subtitle="修改房间默认阵容"
            onClose={() => setAiAddOpen(false)}
          >
            <AiModelSelector
              models={aiMemberOptions}
              members={roomAiMembers}
              thinkingAdapters={thinkingAdapters}
              readOnly={readOnly || !canManageRoom}
              onChange={onRoomAiMembersSave}
              className="is-workspace-modal"
            />
          </ModalLayer>
        </>
      ) : null}
    </AnimatePresence>
  );
}
