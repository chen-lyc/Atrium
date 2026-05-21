import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_CONVERSATION_ID,
  LOCAL_SEND_SETTLE_DELAY,
  MESSAGE_HISTORY_PAGE_SIZE,
  MESSAGE_TYPE
} from "./constants.js";
import {
  createId,
  deleteStoredMessage,
  fetchCurrentUser,
  getModelDisplayName,
  getIncomingText,
  normalizeIncomingMessage,
  normalizeIncomingConversationId,
  normalizeIncomingRoomId,
  normalizeIncomingTimestamp,
  normalizeIncomingUserId,
  findPendingLocalMatch,
  mergeIncomingMessage
} from "./utils.js";

const AI_NO_REPLY_TOKEN = "<NO_REPLY>";
const WS_EVENT = Object.freeze({
  USER_MSG: 0,
  AI_STREAM_START: 1,
  AI_STREAM_DELTA: 2,
  AI_STREAM_END: 3,
  AI_STREAM_ERROR: 4
});
const ASSISTANT_IDLE_STATE = Object.freeze({
  status: "idle",
  modelLabel: "",
  message: "",
  detail: ""
});
const AI_DISPLAY_NAME = "AI";
const AI_AVATAR_BY_PROVIDER = Object.freeze({
  deepseek: "/avatars/deepseek-logo.svg",
  qwen: "/avatars/qwen-logo.svg"
});
const AI_STREAM_INTERRUPTED_STATUS = "interrupted";

function cleanText(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function inferAiProviderFromModel(model) {
  const normalizedModel = cleanText(model).toLowerCase();
  if (normalizedModel.startsWith("deepseek")) return "deepseek";
  if (normalizedModel.startsWith("qwen")) return "qwen";
  return "";
}

function normalizeServerMessageId(payload = {}) {
  const value = payload.message_id ?? payload.messageId ?? payload.id;
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && value.trim()) {
    const trimmed = value.trim();
    if (/^\d+$/.test(trimmed) && Number(trimmed) > 0) return trimmed;
  }
  return "";
}

function getAiProvider(payload = {}, fallback = "") {
  return cleanText(payload.provider) || cleanText(fallback) || inferAiProviderFromModel(payload.model);
}

function getAiModel(payload = {}, fallback = "") {
  return cleanText(payload.model) || fallback || "";
}

function getAiAvatarUrl(payload = {}, fallback = "") {
  const explicit = cleanText(payload.avatar_url ?? payload.avatarUrl);
  if (explicit) return explicit;
  const resolvedFallback = cleanText(fallback);
  if (resolvedFallback) return resolvedFallback;
  const provider = getAiProvider(payload).toLowerCase();
  return AI_AVATAR_BY_PROVIDER[provider] || "";
}

function getAiAuthorName(payload = {}, fallback = AI_DISPLAY_NAME) {
  const model = getAiModel(payload);
  const modelLabel = getModelDisplayName({ model }, "");
  const candidates = [
    payload.display_name,
    payload.displayName,
    payload.nickname,
    payload.username,
    getAiProvider(payload)
  ];
  const explicit = candidates.map(cleanText).find((value) => value && value !== model && value !== modelLabel);
  return explicit || fallback || AI_DISPLAY_NAME;
}

function isAiPayload(payload = {}, normalizedMessage = null) {
  const senderType = cleanText(payload.sender_type ?? payload.senderType ?? payload.participant_type ?? payload.participantType).toLowerCase();
  const role = cleanText(payload.role ?? payload.message_role ?? payload.messageRole).toLowerCase();
  const provider = getAiProvider(payload).toLowerCase();
  const displayName = cleanText(payload.display_name ?? payload.displayName ?? payload.nickname ?? payload.username).toLowerCase();
  return (
    payload.is_ai === true ||
    payload.isAI === true ||
    senderType === "ai" ||
    senderType === "assistant" ||
    role === "assistant" ||
    provider === "deepseek" ||
    displayName === "deepseek" ||
    Boolean(getAiModel(payload)) ||
    normalizedMessage?.userId === "0"
  );
}

function getQuotaExceededMessage(raw) {
  const data = raw?.data && typeof raw.data === "object" ? raw.data : {};
  const values = [
    raw?.code,
    raw?.error,
    raw?.message,
    raw?.reason,
    typeof raw?.type === "string" ? raw.type : "",
    data.code,
    data.error,
    data.message,
    data.reason
  ];
  return values.some((value) => /QuotaExceeded|quota/i.test(String(value || "")))
    ? "今日 AI 额度已用完，明天会自动恢复"
    : "";
}

function normalizeAiStreamErrorValue(value) {
  if (value === true) return "Unknown";
  if (value === false || value == null) return "";
  if (typeof value === "string" || typeof value === "number") return cleanText(value);
  if (typeof value !== "object") return "";
  const candidates = [
    value.error,
    value.code,
    value.type,
    value.name,
    value.reason,
    value.message
  ];
  return candidates.map(normalizeAiStreamErrorValue).find(Boolean) || "Unknown";
}

function getAiStreamErrorType(payload = {}) {
  if (!payload || typeof payload !== "object") return "";
  const candidates = [
    payload.error,
    payload.error_type,
    payload.errorType,
    payload.code,
    payload.reason
  ];
  return candidates.map(normalizeAiStreamErrorValue).find(Boolean) || "";
}

function isNoReplyText(value) {
  return String(value || "").trim() === AI_NO_REPLY_TOKEN;
}

function isNoReplyPayload(payload) {
  if (typeof payload === "string") return isNoReplyText(payload);
  if (!payload || typeof payload !== "object") return false;
  return isNoReplyText(getIncomingText(payload));
}

function normalizeConversationId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const numericValue = Number(value);
    if (Number.isSafeInteger(numericValue) && numericValue > 0) return numericValue;
  }
  return DEFAULT_CONVERSATION_ID;
}

function normalizeRoomId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const numericValue = Number(value);
    if (Number.isSafeInteger(numericValue) && numericValue > 0) return numericValue;
  }
  return 0;
}

function getMessageCacheKey(roomId, conversationId) {
  return `${roomId || "room"}:${conversationId || DEFAULT_CONVERSATION_ID}`;
}

function getStableMessageKey(message) {
  const serverId = message.serverId || (message.source === "server" ? message.id : "");
  if (serverId && !String(serverId).startsWith("remote-")) return `server:${serverId}`;
  if (message.clientMessageId) return `client:${message.clientMessageId}`;
  return "";
}

function hasDurableServerId(message) {
  const serverId = message.serverId || (message.source === "server" ? message.id : "");
  return Boolean(serverId && !String(serverId).startsWith("remote-"));
}

function getDurableServerId(message) {
  const serverId = message?.serverId || (message?.source === "server" ? message?.id : "");
  const numericValue = Number(serverId);
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function getComparableSender(message) {
  if (message.userId) return `user:${message.userId}`;
  if (message.nickname) return `name:${message.nickname}`;
  return "";
}

function messagesLookLikeSameStoredMessage(a, b) {
  if (!a || !b) return false;
  if (hasDurableServerId(a) && hasDurableServerId(b)) return false;
  if (a.source !== "server" && b.source !== "server") return false;
  const aText = String(a.text || "");
  const bText = String(b.text || "");
  const sameText = aText === bText;
  const streamPrefixMatch = Boolean(
    (a.source === "stream" || b.source === "stream") &&
    (a.isAI || b.isAI) &&
    aText &&
    bText &&
    (aText.startsWith(bText) || bText.startsWith(aText))
  );
  if (!sameText && !streamPrefixMatch) return false;
  if (Number(a.conversationId || 0) && Number(b.conversationId || 0) && Number(a.conversationId) !== Number(b.conversationId)) {
    return false;
  }
  const aSender = getComparableSender(a);
  const bSender = getComparableSender(b);
  if (!aSender || !bSender || aSender !== bSender) return false;
  const aTime = Number(a.timestamp);
  const bTime = Number(b.timestamp);
  return Number.isFinite(aTime) && Number.isFinite(bTime) && Math.abs(aTime - bTime) <= 30000;
}

function dedupeMessageList(messages) {
  const seenKeys = new Set();
  const result = [];
  messages.forEach((message) => {
    const key = getStableMessageKey(message);
    if (key && seenKeys.has(key)) return;
    if (result.some((existing) => messagesLookLikeSameStoredMessage(existing, message))) return;
    result.push(message);
    if (key) seenKeys.add(key);
  });
  return result;
}

function mergeMessageLists(currentMessages, incomingMessages, { prepend = false } = {}) {
  const combined = prepend ? [...incomingMessages, ...currentMessages] : [...currentMessages, ...incomingMessages];
  return dedupeMessageList(combined);
}

function getOldestServerCursor(messages) {
  const oldest = messages.find((message) => {
    const messageId = Number(message.serverId || message.id);
    const timestamp = Number(message.timestamp);
    return message.source === "server" && Number.isSafeInteger(messageId) && messageId > 0 && Number.isFinite(timestamp) && timestamp > 0;
  });
  if (!oldest) return null;
  return {
    before_time: String(Number(oldest.timestamp)),
    before_id: String(Number(oldest.serverId || oldest.id))
  };
}

function getStreamKey(streamId, payload = {}, fallbackRoomId = 0, fallbackConversationId = 0) {
  const value = String(streamId ?? "").trim();
  if (value) return `stream:${value}`;
  const model = getAiModel(payload);
  if (model) {
    const roomId = normalizeIncomingRoomId(payload) || fallbackRoomId || "room";
    const conversationId = normalizeIncomingConversationId(payload) || fallbackConversationId || DEFAULT_CONVERSATION_ID;
    const provider = getAiProvider(payload) || "ai";
    return `model:${roomId}:${conversationId}:${provider}:${model}`;
  }
  const serverId = normalizeServerMessageId(payload);
  return serverId ? `server:${serverId}` : "";
}

function getTimelineValue(message) {
  const value = message?.timestamp;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const trimmedValue = value.trim();
    if (/^\d+$/.test(trimmedValue)) {
      const numericValue = Number(trimmedValue);
      if (Number.isFinite(numericValue)) return numericValue;
    }
    const parsedValue = Date.parse(trimmedValue);
    if (Number.isFinite(parsedValue)) return parsedValue;
  }
  return Date.now();
}

function getMessageSortId(message) {
  const value = Number(message?.timelineSortId || message?.serverId || message?.id || 0);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function getTimelineOrderValue(message) {
  const value = Number(message?.timelineOrder || 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function compareMessagesByTimeline(a, b) {
  const aSortId = getMessageSortId(a);
  const bSortId = getMessageSortId(b);
  if (aSortId && bSortId && aSortId !== bSortId) return aSortId - bSortId;
  const aLiveOrder = getTimelineOrderValue(a);
  const bLiveOrder = getTimelineOrderValue(b);
  if (aLiveOrder && bLiveOrder && aLiveOrder !== bLiveOrder) return aLiveOrder - bLiveOrder;
  const timeGap = getTimelineValue(a) - getTimelineValue(b);
  if (timeGap) return timeGap;
  if (aLiveOrder || bLiveOrder) return aLiveOrder - bLiveOrder;
  return aSortId - bSortId;
}

function settleMessageList(messages) {
  return dedupeMessageList(messages).slice().sort(compareMessagesByTimeline);
}

async function fetchHistoryPage(conversationId, cursor, signal) {
  const params = new URLSearchParams();
  params.set("limit", String(MESSAGE_HISTORY_PAGE_SIZE));
  if (cursor) {
    params.set("before_time", cursor.before_time);
    params.set("before_id", cursor.before_id);
  }
  const response = await fetch(`/api/conversations/${conversationId}/messages?${params.toString()}`, {
    method: "GET",
    credentials: "include",
    signal
  });
  if (!response.ok) {
    const error = new Error("history request failed");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

function normalizeHistoryMessages(data, conversationId, nickname, userId) {
  const rawMessages = Array.isArray(data?.messages) ? data.messages : [];
  return rawMessages
    .slice()
    .reverse()
    .map((message) => {
      const normalized = normalizeIncomingMessage({
        ...message,
        id: message.id ?? message.message_id,
        user_id: message.user_id ?? message.send_id,
        username: message.username ?? message.display_name ?? message.displayName,
        conversation_id: message.conversation_id ?? conversationId,
        status: "sent"
      }, nickname, userId);
      const isAssistantHistoryMessage = isAiPayload(message, normalized);
      if (isAssistantHistoryMessage) {
        normalized.isAI = true;
        normalized.nickname = getAiAuthorName(message);
        normalized.model = getAiModel(message);
        normalized.provider = getAiProvider(message);
        normalized.avatarUrl = normalized.avatarUrl || getAiAvatarUrl(message);
        normalized.senderType = "ai";
      }
      if (isAssistantHistoryMessage && isNoReplyText(normalized.text)) {
        return null;
      }
      return normalized;
    })
    .filter(Boolean);
}

export default function useWebSocket({
  url,
  nickname,
  userId = "",
  enabled,
  onAuthFailed,
  roomId = 0,
  conversationId = DEFAULT_CONVERSATION_ID,
  assistantModelLabel = "",
  assistantExpected = true
}) {
  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const pendingResolveTimersRef = useRef(new Map());
  const aiThinkingTimerRef = useRef(null);
  const authFailedRef = useRef(onAuthFailed);
  const activeRoomId = normalizeRoomId(roomId);
  const activeConversationId = normalizeConversationId(conversationId);
  const normalizedUserId = String(userId || "").trim();
  const activeRoomIdRef = useRef(activeRoomId);
  const activeConversationIdRef = useRef(activeConversationId);
  const nicknameRef = useRef(nickname);
  const assistantModelLabelRef = useRef(assistantModelLabel);
  const assistantExpectedRef = useRef(assistantExpected);
  const messageCacheRef = useRef(new Map());
  const activeStreamsRef = useRef(new Map());
  const activeAiStreamRef = useRef(null);
  const timelineOrderRef = useRef(0);

  const [messages, setMessages] = useState([]);
  const [connectionState, setConnectionState] = useState(enabled ? "connecting" : "idle");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [lastError, setLastError] = useState("");
  const [assistantState, setAssistantState] = useState(ASSISTANT_IDLE_STATE);
  const [historyState, setHistoryState] = useState("idle");
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyError, setHistoryError] = useState("");
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  useEffect(() => {
    authFailedRef.current = onAuthFailed;
  }, [onAuthFailed]);

  useEffect(() => {
    assistantModelLabelRef.current = assistantModelLabel || "";
    assistantExpectedRef.current = assistantExpected;
    if (assistantExpected === false) resetAssistantState();
  }, [assistantModelLabel, assistantExpected]);

  function clearAssistantTimer() {
    if (aiThinkingTimerRef.current == null) return;
    window.clearTimeout(aiThinkingTimerRef.current);
    aiThinkingTimerRef.current = null;
  }

  function resetAssistantState() {
    clearAssistantTimer();
    setAssistantState(ASSISTANT_IDLE_STATE);
  }

  function showAssistantQuota(message) {
    clearAssistantTimer();
    setAssistantState({
      status: "quota-exceeded",
      modelLabel: assistantModelLabelRef.current || "AI",
      message,
      detail: "普通讨论仍可继续，AI 调用明天恢复"
    });
  }

  function clearAllPendingTimers() {
    pendingResolveTimersRef.current.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    pendingResolveTimersRef.current.clear();
  }

  function nextTimelineOrder() {
    timelineOrderRef.current += 1;
    return timelineOrderRef.current;
  }

  function commitMessages(updater) {
    setMessages((prev) => {
      const next = settleMessageList(typeof updater === "function" ? updater(prev) : updater);
      messageCacheRef.current.set(
        getMessageCacheKey(activeRoomIdRef.current, activeConversationIdRef.current),
        next
      );
      return next;
    });
  }

  function updateMessagesForContext(roomId, conversationId, updater) {
    const targetRoomId = normalizeRoomId(roomId) || activeRoomIdRef.current;
    const targetConversationId = normalizeConversationId(conversationId) || activeConversationIdRef.current;
    const isActiveContext =
      targetRoomId === activeRoomIdRef.current &&
      targetConversationId === activeConversationIdRef.current;
    if (isActiveContext) {
      commitMessages(updater);
      return;
    }
    const cacheKey = getMessageCacheKey(targetRoomId, targetConversationId);
    const current = messageCacheRef.current.get(cacheKey) || [];
    const next = settleMessageList(typeof updater === "function" ? updater(current) : updater);
    messageCacheRef.current.set(cacheKey, next);
  }

  function handleUserMessage(payload) {
    const nextMessage = {
      ...normalizeIncomingMessage(payload, nicknameRef.current, normalizedUserId),
      timelineOrder: nextTimelineOrder()
    };
    const targetRoomId = nextMessage.roomId || activeRoomIdRef.current;
    const targetConversationId = nextMessage.conversationId || activeConversationIdRef.current;
    if (!targetRoomId || !targetConversationId) {
      return;
    }
    const scopedMessage = {
      ...nextMessage,
      roomId: targetRoomId,
      conversationId: targetConversationId
    };
    const incomingId = normalizeServerMessageId(payload);
    updateMessagesForContext(targetRoomId, targetConversationId, (prev) => {
      if (incomingId && prev.some((m) => normalizeServerMessageId({ message_id: m.serverId || m.id }) === incomingId)) {
        const matchIndex = findPendingLocalMatch(prev, scopedMessage);
        if (matchIndex != null) {
          clearPendingResolveTimer(prev[matchIndex].id);
          return prev.filter((_, index) => index !== matchIndex);
        }
        return prev;
      }
      const matchIndex = findPendingLocalMatch(prev, scopedMessage);
      if (matchIndex != null) {
        clearPendingResolveTimer(prev[matchIndex].id);
      }
      return dedupeMessageList(mergeIncomingMessage(prev, scopedMessage));
    });
  }

  function createStreamMessageId(streamId, payload = {}) {
    const serverMessageId = normalizeServerMessageId(payload);
    if (serverMessageId) return `ai-server-${serverMessageId}`;
    const streamToken = cleanText(streamId).replace(/[^a-zA-Z0-9_-]/g, "");
    return createId(`ai-${streamToken || "stream"}`);
  }

  function getActiveStreamEntry(streamId, payload = {}) {
    const streamKey = getStreamKey(streamId, payload, activeRoomIdRef.current, activeConversationIdRef.current);
    if (streamKey && activeStreamsRef.current.has(streamKey)) {
      return { key: streamKey, stream: activeStreamsRef.current.get(streamKey) };
    }
    const model = getAiModel(payload);
    if (model) {
      const provider = getAiProvider(payload);
      for (const [key, stream] of activeStreamsRef.current.entries()) {
        if (stream.model !== model) continue;
        if (provider && stream.provider && stream.provider !== provider) continue;
        return { key, stream };
      }
    }
    return { key: streamKey, stream: null };
  }

  function createStreamState(streamId, payload = {}) {
    const streamKey = getStreamKey(streamId, payload, activeRoomIdRef.current, activeConversationIdRef.current);
    if (!streamKey) return null;
    const streamRoomId = normalizeIncomingRoomId(payload) || activeRoomIdRef.current;
    const streamConversationId = normalizeIncomingConversationId(payload) || activeConversationIdRef.current;
    if (!streamRoomId || !streamConversationId) return null;
    const model = getAiModel(payload);
    const provider = getAiProvider(payload);
    const nickname = getAiAuthorName(payload);
    const serverId = normalizeServerMessageId(payload);
    const timelineOrder = nextTimelineOrder();
    return {
      messageId: createStreamMessageId(streamId, payload),
      serverId,
      timelineSortId: serverId ? Number(serverId) : 0,
      roomId: streamRoomId,
      conversationId: streamConversationId,
      model,
      provider,
      nickname,
      avatarUrl: getAiAvatarUrl(payload),
      timestamp: normalizeIncomingTimestamp(payload),
      timelineOrder,
      visible: false
    };
  }

  function ensureStreamState(streamId, payload = {}) {
    const { key: existingKey, stream: existing } = getActiveStreamEntry(streamId, payload);
    if (existing) {
      const serverId = normalizeServerMessageId(payload);
      const model = getAiModel(payload, existing.model);
      const provider = getAiProvider(payload, existing.provider);
      existing.serverId = serverId || existing.serverId || "";
      existing.timelineSortId = existing.timelineSortId || (serverId ? Number(serverId) : 0);
      existing.model = model;
      existing.provider = provider;
      existing.nickname = getAiAuthorName(payload, existing.nickname || AI_DISPLAY_NAME);
      existing.avatarUrl = getAiAvatarUrl(payload, existing.avatarUrl);
      return existing;
    }
    if (!existingKey) return null;
    const nextStream = createStreamState(streamId, payload);
    if (!nextStream) return null;
    activeStreamsRef.current.set(existingKey, nextStream);
    return nextStream;
  }

  function clearActiveStream(streamId, payload = {}, stream = null) {
    const { key, stream: existing } = getActiveStreamEntry(streamId, payload);
    if (key) activeStreamsRef.current.delete(key);
    if (stream) {
      for (const [entryKey, entryStream] of activeStreamsRef.current.entries()) {
        if (entryStream === stream) activeStreamsRef.current.delete(entryKey);
      }
    }
    const target = stream || existing;
    if (target && activeAiStreamRef.current === target) activeAiStreamRef.current = null;
  }

  function buildStreamMessage(streamId, stream, text, status = "streaming") {
    return {
      id: stream.messageId,
      streamId: String(streamId),
      serverId: stream.serverId || "",
      timelineSortId: stream.timelineSortId || 0,
      roomId: stream.roomId,
      conversationId: stream.conversationId,
      messageType: MESSAGE_TYPE.TEXT,
      nickname: stream.nickname || AI_DISPLAY_NAME,
      userId: "",
      username: "",
      avatarUrl: stream.avatarUrl,
      text,
      timestamp: stream.timestamp,
      timelineOrder: stream.timelineOrder,
      isSelf: false,
      isAI: true,
      model: stream.model,
      provider: stream.provider,
      senderType: "ai",
      status,
      source: "stream"
    };
  }

  function createTerminalStreamState(streamId, payload = {}) {
    const streamRoomId = normalizeIncomingRoomId(payload) || activeRoomIdRef.current;
    const streamConversationId = normalizeIncomingConversationId(payload) || activeConversationIdRef.current;
    if (!streamRoomId || !streamConversationId) return null;
    return {
      messageId: createStreamMessageId(streamId, payload),
      serverId: normalizeServerMessageId(payload),
      timelineSortId: Number(normalizeServerMessageId(payload)) || 0,
      roomId: streamRoomId,
      conversationId: streamConversationId,
      model: getAiModel(payload),
      provider: getAiProvider(payload),
      nickname: getAiAuthorName(payload),
      avatarUrl: getAiAvatarUrl(payload),
      timestamp: normalizeIncomingTimestamp(payload),
      timelineOrder: nextTimelineOrder(),
      visible: false
    };
  }

  function finishAiStreamInterruption(streamId, payload = {}, errorType = "Unknown") {
    const stream = getActiveStreamEntry(streamId, payload).stream || createTerminalStreamState(streamId, payload);
    if (!stream) {
      resetAssistantState();
      return;
    }
    const serverId = normalizeServerMessageId(payload) || stream.serverId || "";
    const model = getAiModel(payload, stream.model);
    const provider = getAiProvider(payload, stream.provider);
    const nickname = getAiAuthorName(payload, stream.nickname || AI_DISPLAY_NAME);
    const avatarUrl = getAiAvatarUrl(payload, stream.avatarUrl);
    const normalizedErrorType = cleanText(errorType) || "Unknown";

    stream.serverId = serverId;
    stream.timelineSortId = stream.timelineSortId || (serverId ? Number(serverId) : 0);
    stream.model = model;
    stream.provider = provider;
    stream.nickname = nickname;
    stream.avatarUrl = avatarUrl;

    updateMessagesForContext(stream.roomId, stream.conversationId, (prev) =>
      prev.some((message) => message.id === stream.messageId)
        ? prev.map((message) =>
            message.id === stream.messageId
              ? {
                  ...message,
                  serverId: serverId || message.serverId || "",
                  timelineSortId: message.timelineSortId || stream.timelineSortId || (serverId ? Number(serverId) : 0),
                  nickname,
                  avatarUrl,
                  model,
                  provider,
                  senderType: "ai",
                  status: AI_STREAM_INTERRUPTED_STATUS,
                  aiErrorType: normalizedErrorType
                }
              : message
          )
        : [
            ...prev,
            {
              ...buildStreamMessage(serverId || stream.messageId, stream, "", AI_STREAM_INTERRUPTED_STATUS),
              serverId,
              timelineSortId: stream.timelineSortId || (serverId ? Number(serverId) : 0),
              nickname,
              avatarUrl,
              model,
              provider,
              senderType: "ai",
              aiErrorType: normalizedErrorType
            }
          ]
    );
    clearActiveStream(streamId, payload, stream);
    resetAssistantState();
  }

  function handleAiStreamStart(streamId, payload = {}) {
    if (isNoReplyPayload(payload)) {
      clearActiveStream(streamId, payload);
      return;
    }
    const serverId = normalizeServerMessageId(payload);
    const stream = ensureStreamState(streamId, payload);
    if (!stream) return;
    if (serverId) {
      stream.messageId = `ai-server-${serverId}`;
      stream.serverId = serverId;
      stream.timelineSortId = stream.timelineSortId || Number(serverId);
    }
    activeAiStreamRef.current = stream;
    resetAssistantState();
  }

  function handleAiStreamDelta(streamId, payload = {}) {
    if (isNoReplyPayload(payload)) {
      clearActiveStream(streamId, payload);
      return;
    }
    const stream = ensureStreamState(streamId, payload);
    if (!stream) return;
    const content = getIncomingText(payload);
    if (!content) return;
    const model = getAiModel(payload, stream.model);
    const provider = getAiProvider(payload, stream.provider);
    const nickname = getAiAuthorName(payload, stream.nickname || AI_DISPLAY_NAME);
    const avatarUrl = getAiAvatarUrl(payload, stream.avatarUrl);
    const serverId = normalizeServerMessageId(payload) || stream.serverId || "";
    stream.model = model;
    stream.provider = provider;
    stream.nickname = nickname;
    stream.avatarUrl = avatarUrl;
    stream.serverId = serverId;
    stream.timelineSortId = stream.timelineSortId || (serverId ? Number(serverId) : 0);
    stream.visible = true;
    activeAiStreamRef.current = stream;
    resetAssistantState();
    updateMessagesForContext(stream.roomId, stream.conversationId, (prev) =>
      prev.some((message) => message.id === stream.messageId)
        ? prev.map((message) =>
            message.id === stream.messageId
              ? {
                  ...message,
                  serverId: serverId || message.serverId || "",
                  timelineSortId: message.timelineSortId || stream.timelineSortId || (serverId ? Number(serverId) : 0),
                  text: `${message.text || ""}${content}`,
                  nickname,
                  avatarUrl,
                  model,
                  provider,
                  status: message.status === "failed" || message.status === AI_STREAM_INTERRUPTED_STATUS ? message.status : "streaming"
                }
              : message
          )
        : [...prev, buildStreamMessage(serverId || stream.messageId, stream, content)]
    );
  }

  function handleAiStreamEnd(streamId, payload = {}) {
    const stream = ensureStreamState(streamId, payload);
    const errorType = getAiStreamErrorType(payload);
    if (errorType) {
      finishAiStreamInterruption(streamId, payload, errorType);
      return;
    }
    if (isNoReplyPayload(payload)) {
      if (stream) {
        updateMessagesForContext(stream.roomId, stream.conversationId, (prev) =>
          prev.filter((message) => message.id !== stream.messageId)
        );
      }
      clearActiveStream(streamId, payload, stream);
      return;
    }
    if (!stream) return;
    const serverMessageId = normalizeServerMessageId(payload) || stream.serverId || "";
    const userId = normalizeIncomingUserId(payload);
    const model = getAiModel(payload, stream.model);
    const provider = getAiProvider(payload, stream.provider);
    const nickname = getAiAuthorName(payload, stream.nickname || AI_DISPLAY_NAME);
    const avatarUrl = getAiAvatarUrl(payload, stream.avatarUrl);
    const finalText = getIncomingText(payload);
    stream.model = model;
    stream.provider = provider;
    stream.nickname = nickname;
    stream.avatarUrl = avatarUrl;
    stream.serverId = serverMessageId;
    stream.timelineSortId = stream.timelineSortId || (serverMessageId ? Number(serverMessageId) : 0);
    updateMessagesForContext(stream.roomId, stream.conversationId, (prev) =>
      prev.some((message) => message.id === stream.messageId)
        ? prev.map((message) =>
            message.id === stream.messageId
              ? {
                  ...message,
                  serverId: serverMessageId || message.serverId || "",
                  timelineSortId: message.timelineSortId || stream.timelineSortId || (serverMessageId ? Number(serverMessageId) : 0),
                  userId: userId || message.userId || "",
                  nickname,
                  avatarUrl,
                  text: finalText || message.text,
                  model,
                  provider,
                  senderType: "ai",
                  status: "sent",
                  source: "server"
                }
              : message
          )
        : finalText
          ? [
              ...prev,
              {
                ...buildStreamMessage(serverMessageId || stream.messageId, stream, finalText, "sent"),
                serverId: serverMessageId || "",
                timelineSortId: stream.timelineSortId || (serverMessageId ? Number(serverMessageId) : 0),
                userId: userId || "",
                nickname,
                avatarUrl,
                model,
                provider,
                senderType: "ai",
                source: "server"
              }
            ]
          : prev
    );
    clearActiveStream(streamId, payload, stream);
    resetAssistantState();
  }

  function handleAiStreamError(streamId, payload = {}) {
    finishAiStreamInterruption(streamId, payload, getAiStreamErrorType(payload) || "Unknown");
  }

  function clearPendingResolveTimer(messageId) {
    const timerId = pendingResolveTimersRef.current.get(messageId);
    if (timerId == null) return;
    window.clearTimeout(timerId);
    pendingResolveTimersRef.current.delete(messageId);
  }

  function schedulePendingResolve(messageId, roomId, conversationId) {
    clearPendingResolveTimer(messageId);
    const targetRoomId = normalizeRoomId(roomId) || activeRoomIdRef.current;
    const targetConversationId = normalizeConversationId(conversationId) || activeConversationIdRef.current;
    const timerId = window.setTimeout(() => {
      pendingResolveTimersRef.current.delete(messageId);
      updateMessagesForContext(targetRoomId, targetConversationId, (prev) =>
        prev.map((message) =>
          message.id === messageId && message.status === "pending"
            ? { ...message, status: "sent" }
            : message
        )
      );
    }, LOCAL_SEND_SETTLE_DELAY);
    pendingResolveTimersRef.current.set(messageId, timerId);
  }

  function markLocalMessageFailed(messageId) {
    clearPendingResolveTimer(messageId);
    commitMessages((prev) =>
      prev.map((message) =>
        message.id === messageId ? { ...message, status: "failed" } : message
      )
    );
  }

  function cleanupSocket() {
    const current = socketRef.current;
    socketRef.current = null;
    if (current && (current.readyState === WebSocket.OPEN || current.readyState === WebSocket.CONNECTING)) {
      current.close();
    }
  }

  useEffect(() => {
    const previousNickname = nicknameRef.current;
    const nicknameChanged = previousNickname !== nickname;
    if (nicknameChanged) {
      messageCacheRef.current.clear();
      activeStreamsRef.current.clear();
      activeAiStreamRef.current = null;
      nicknameRef.current = nickname;
    }
    if (nicknameChanged) clearAllPendingTimers();
    resetAssistantState();
    setMessages((prev) => {
      const previousRoomId = activeRoomIdRef.current;
      const previousConversationId = activeConversationIdRef.current;
      if (!nicknameChanged && previousNickname && previousConversationId) {
        messageCacheRef.current.set(getMessageCacheKey(previousRoomId, previousConversationId), prev);
      }
      activeRoomIdRef.current = activeRoomId;
      activeConversationIdRef.current = activeConversationId;
      if (!nickname) return [];
      return messageCacheRef.current.get(getMessageCacheKey(activeRoomId, activeConversationId)) || [];
    });
    setLastError("");
    setHistoryState(nickname ? "loading" : "idle");
    setHistoryHasMore(false);
    setHistoryError("");
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    if (!nickname) {
      activeStreamsRef.current.clear();
      activeAiStreamRef.current = null;
      setConnectionState("idle");
    }
  }, [nickname, activeRoomId, activeConversationId]);

  useEffect(() => {
    if (!enabled || !nickname || !activeConversationId) {
      setHistoryState(nickname ? "idle" : "idle");
      setHistoryHasMore(false);
      setHistoryError("");
      return undefined;
    }

    const controller = new AbortController();
    setHistoryState("loading");
    setHistoryError("");
    setHistoryHasMore(false);

    fetchHistoryPage(activeConversationId, null, controller.signal)
      .then((data) => {
        const historicalMessages = normalizeHistoryMessages(data, activeConversationId, nickname, normalizedUserId);
        commitMessages((prev) => mergeMessageLists(prev, historicalMessages, { prepend: true }));
        setHistoryHasMore(Boolean(data?.has_more));
        setHistoryState("ready");
      })
      .catch((error) => {
        if (error.name === "AbortError") return;
        if (error.status === 401) {
          authFailedRef.current?.();
          return;
        }
        setHistoryState("error");
        setHistoryError("历史消息加载失败");
      });

    return () => controller.abort();
  }, [enabled, nickname, normalizedUserId, activeRoomId, activeConversationId, historyRefreshKey]);

  useEffect(() => {
    if (!enabled || !nickname) {
      window.clearTimeout(reconnectTimerRef.current);
      cleanupSocket();
      setConnectionState("idle");
      return undefined;
    }

    let cancelled = false;

    const scheduleReconnect = () => {
      if (cancelled) return;
      const nextAttempt = reconnectAttemptRef.current + 1;
      reconnectAttemptRef.current = nextAttempt;
      setReconnectAttempt(nextAttempt);
      setConnectionState("reconnecting");
      const delay = Math.min(1200 + nextAttempt * 900, 6400);
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(() => {
        openSocket();
      }, delay);
    };

    const openSocket = () => {
      if (cancelled) return;
      let opened = false;
      setConnectionState(reconnectAttemptRef.current > 0 ? "reconnecting" : "connecting");
      try {
        const ws = new WebSocket(url);
        socketRef.current = ws;

        ws.onopen = () => {
          if (cancelled) return;
          const wasReconnect = reconnectAttemptRef.current > 0;
          opened = true;
          reconnectAttemptRef.current = 0;
          setReconnectAttempt(0);
          setConnectionState("connected");
          setLastError("");
          if (wasReconnect) {
            window.setTimeout(() => {
              if (!cancelled) setHistoryRefreshKey((value) => value + 1);
            }, 250);
          }
        };

        ws.onmessage = async (event) => {
          if (cancelled) return;
          let rawData = "";
          try {
            rawData =
              typeof event.data === "string"
                ? event.data
                : event.data instanceof Blob
                  ? await event.data.text()
                  : String(event.data);
            if (cancelled) return;
            if (isNoReplyText(rawData)) {
              return;
            }
            const raw = JSON.parse(rawData);
            const envelopeType = typeof raw.type === "number" ? raw.type : undefined;
            const payload = raw.data || raw;
            if (envelopeType === WS_EVENT.USER_MSG) {
              handleUserMessage(payload);
              return;
            }
            if (envelopeType === WS_EVENT.AI_STREAM_START) {
              handleAiStreamStart(raw.stream_id, payload);
              return;
            }
            if (envelopeType === WS_EVENT.AI_STREAM_DELTA) {
              handleAiStreamDelta(raw.stream_id, payload);
              return;
            }
            if (envelopeType === WS_EVENT.AI_STREAM_END) {
              handleAiStreamEnd(raw.stream_id, payload);
              return;
            }
            if (envelopeType === WS_EVENT.AI_STREAM_ERROR) {
              handleAiStreamError(raw.stream_id, payload);
              return;
            }
            const quotaMessage = getQuotaExceededMessage(raw);
            if (quotaMessage) {
              showAssistantQuota(quotaMessage);
              return;
            }
            handleUserMessage(payload);
          } catch (error) {
            if (/QuotaExceeded|quota/i.test(rawData)) {
              showAssistantQuota("今日 AI 额度已用完，明天会自动恢复");
              return;
            }
            console.warn("Invalid message payload:", error);
          }
        };

        ws.onerror = () => {
          if (cancelled) return;
          setLastError("连接过程中发生错误");
        };

        ws.onclose = (event) => {
          if (cancelled) return;
          socketRef.current = null;
          if (!opened) {
            setConnectionState("idle");
            fetchCurrentUser()
              .then((result) => {
                if (cancelled) return;
                if (result.ok) {
                  scheduleReconnect();
                  return;
                }
                authFailedRef.current?.();
              })
              .catch(() => {
                if (!cancelled) scheduleReconnect();
              });
            return;
          }
          setConnectionState("disconnected");
          scheduleReconnect();
        };
      } catch (error) {
        setLastError("浏览器无法建立 WebSocket 连接");
        scheduleReconnect();
      }
    };

    openSocket();

    return () => {
      cancelled = true;
      window.clearTimeout(reconnectTimerRef.current);
      clearAllPendingTimers();
      clearAssistantTimer();
      cleanupSocket();
    };
  }, [url, nickname, normalizedUserId, enabled, activeRoomId]);

  function sendChatMessage(text, forceConversationId = 0) {
    const content = text.trim();
    const current = socketRef.current;
    if (!content || !nickname || !activeRoomId || !current || current.readyState !== WebSocket.OPEN) {
      return null;
    }
    const effectiveConversationId = forceConversationId ? normalizeConversationId(forceConversationId) : activeConversationId;

    const localMessage = {
      id: createId("local"),
      clientMessageId: createId("client"),
      roomId: activeRoomId,
      conversationId: effectiveConversationId,
      messageType: MESSAGE_TYPE.TEXT,
      nickname,
      userId: normalizedUserId,
      text: content,
      timestamp: Date.now(),
      isSelf: true,
      status: "pending",
      source: "local",
      timelineOrder: nextTimelineOrder()
    };

    if (forceConversationId && effectiveConversationId !== activeConversationId) {
      updateMessagesForContext(activeRoomId, effectiveConversationId, (prev) => [...prev, localMessage]);
    } else {
      commitMessages((prev) => [...prev, localMessage]);
    }

    try {
      current.send(JSON.stringify({
        type: 0,
        data: {
          room_id: activeRoomId,
          conversation_id: effectiveConversationId,
          type: Number.isSafeInteger(localMessage.messageType) && localMessage.messageType >= 1 && localMessage.messageType <= 3 ? localMessage.messageType : MESSAGE_TYPE.TEXT,
          content,
          client_message_id: localMessage.clientMessageId
        }
      }));
      schedulePendingResolve(localMessage.id, localMessage.roomId, localMessage.conversationId);
      return localMessage;
    } catch (error) {
      const failedMessage = { ...localMessage, status: "failed" };
      markLocalMessageFailed(localMessage.id);
      setLastError("消息发送失败");
      return failedMessage;
    }
  }

  async function deleteChatMessage(message) {
    if (!message?.id) return false;
    const serverMessageId = getDurableServerId(message);
    if (serverMessageId) {
      await deleteStoredMessage(serverMessageId);
    }
    clearPendingResolveTimer(message.id);
    commitMessages((prev) => prev.filter((item) => item.id !== message.id));
    return true;
  }

  async function loadOlderMessages() {
    if (!enabled || !nickname || !historyHasMore || historyState === "loading-more") return;
    const cursor = getOldestServerCursor(messages);
    if (!cursor) {
      setHistoryHasMore(false);
      return;
    }
    setHistoryState("loading-more");
    setHistoryError("");
    try {
      const data = await fetchHistoryPage(activeConversationId, cursor);
      const historicalMessages = normalizeHistoryMessages(data, activeConversationId, nickname, normalizedUserId);
      commitMessages((prev) => mergeMessageLists(prev, historicalMessages, { prepend: true }));
      setHistoryHasMore(Boolean(data?.has_more));
      setHistoryState("ready");
    } catch (error) {
      if (error.status === 401) {
        authFailedRef.current?.();
        return;
      }
      setHistoryState("error");
      setHistoryError("更早消息加载失败");
    }
  }

  return {
    messages,
    connectionState,
    reconnectAttempt,
    lastError,
    assistantState,
    historyState,
    historyHasMore,
    historyError,
    loadOlderMessages,
    sendChatMessage,
    deleteChatMessage
  };
}
