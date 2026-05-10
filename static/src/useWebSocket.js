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

const AI_THINKING_TIMEOUT_MS = 15000;
const AI_NO_REPLY_SETTLE_MS = 1300;
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
  if (String(a.text || "") !== String(b.text || "")) return false;
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

function getStreamKey(streamId) {
  const value = String(streamId ?? "").trim();
  return value ? `stream:${value}` : "";
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
        conversation_id: message.conversation_id ?? conversationId,
        status: "sent"
      }, nickname, userId);
      const isAssistantHistoryMessage =
        normalized.userId === "0" ||
        Boolean(typeof message.model === "string" && message.model.trim());
      if (isAssistantHistoryMessage) {
        normalized.isAI = true;
        normalized.nickname = "DeepSeek";
        normalized.model = message.model || "";
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

  const [messages, setMessages] = useState([]);
  const [connectionState, setConnectionState] = useState(enabled ? "connecting" : "idle");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [lastError, setLastError] = useState("");
  const [assistantState, setAssistantState] = useState(ASSISTANT_IDLE_STATE);
  const [historyState, setHistoryState] = useState("idle");
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyError, setHistoryError] = useState("");

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

  function beginAssistantThinking() {
    if (assistantExpectedRef.current === false) return;
    clearAssistantTimer();
    const modelLabel = assistantModelLabelRef.current || "AI";
    setAssistantState({
      status: "thinking",
      modelLabel,
      message: `${modelLabel} 正在思考`,
      detail: "正在接住你的上一条消息"
    });
    aiThinkingTimerRef.current = window.setTimeout(() => {
      aiThinkingTimerRef.current = null;
      setAssistantState((current) => current.status === "thinking" ? ASSISTANT_IDLE_STATE : current);
    }, AI_THINKING_TIMEOUT_MS);
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

  function showAssistantNoReply() {
    clearAssistantTimer();
    const modelLabel = assistantModelLabelRef.current || "AI";
    setAssistantState({
      status: "no-reply",
      modelLabel,
      message: `${modelLabel} 暂时旁听`,
      detail: "这条消息没有生成回复"
    });
    aiThinkingTimerRef.current = window.setTimeout(() => {
      aiThinkingTimerRef.current = null;
      setAssistantState((current) => current.status === "no-reply" ? ASSISTANT_IDLE_STATE : current);
    }, AI_NO_REPLY_SETTLE_MS);
  }

  function clearAllPendingTimers() {
    pendingResolveTimersRef.current.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    pendingResolveTimersRef.current.clear();
  }

  function commitMessages(updater) {
    setMessages((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
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
    const next = typeof updater === "function" ? updater(current) : updater;
    messageCacheRef.current.set(cacheKey, next);
  }

  function handleUserMessage(payload) {
    const nextMessage = normalizeIncomingMessage(payload, nicknameRef.current, normalizedUserId);
    if (nextMessage.roomId && activeRoomIdRef.current && nextMessage.roomId !== activeRoomIdRef.current) {
      return;
    }
    if (nextMessage.conversationId && nextMessage.conversationId !== activeConversationIdRef.current) {
      return;
    }
    commitMessages((prev) => {
      if (nextMessage.isSelf) {
        const matchIndex = findPendingLocalMatch(prev, nextMessage);
        if (matchIndex != null) {
          clearPendingResolveTimer(prev[matchIndex].id);
        }
      }
      return dedupeMessageList(mergeIncomingMessage(prev, nextMessage));
    });
  }

  function handleAiStreamStart(streamId, payload = {}) {
    const streamKey = getStreamKey(streamId);
    if (!streamKey) return;
    const streamRoomId = normalizeIncomingRoomId(payload) || activeRoomIdRef.current;
    const streamConversationId = normalizeIncomingConversationId(payload) || activeConversationIdRef.current;
    if (!streamRoomId || !streamConversationId) return;
    const model = typeof payload.model === "string" ? payload.model.trim() : "";
    const modelLabel = getModelDisplayName({ model }, assistantModelLabelRef.current || "DeepSeek");
    const messageId = createId(`ai-${String(streamId).replace(/[^a-zA-Z0-9_-]/g, "") || "stream"}`);
    const streamMessage = {
      id: messageId,
      streamId: String(streamId),
      roomId: streamRoomId,
      conversationId: streamConversationId,
      messageType: MESSAGE_TYPE.TEXT,
      nickname: modelLabel,
      userId: "",
      username: "",
      avatarUrl: typeof payload.avatar_url === "string" ? payload.avatar_url : payload.avatarUrl || "",
      text: "",
      timestamp: normalizeIncomingTimestamp(payload),
      isSelf: false,
      isAI: true,
      model,
      status: "streaming",
      source: "stream"
    };
    activeStreamsRef.current.set(streamKey, {
      messageId,
      roomId: streamRoomId,
      conversationId: streamConversationId,
      model,
      modelLabel,
      avatarUrl: streamMessage.avatarUrl
    });
    resetAssistantState();
    updateMessagesForContext(streamRoomId, streamConversationId, (prev) => {
      if (prev.some((message) => message.id === messageId)) return prev;
      return [...prev, streamMessage];
    });
  }

  function handleAiStreamDelta(streamId, payload = {}) {
    const stream = activeStreamsRef.current.get(getStreamKey(streamId));
    if (!stream) return;
    const content = getIncomingText(payload);
    if (!content) return;
    const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : stream.model;
    updateMessagesForContext(stream.roomId, stream.conversationId, (prev) =>
      prev.map((message) =>
        message.id === stream.messageId
          ? {
              ...message,
              text: `${message.text || ""}${content}`,
              model,
              status: message.status === "failed" ? "failed" : "streaming"
            }
          : message
      )
    );
  }

  function handleAiStreamEnd(streamId, payload = {}) {
    const streamKey = getStreamKey(streamId);
    const stream = activeStreamsRef.current.get(streamKey);
    if (!stream) return;
    const serverMessageId = payload.message_id ?? payload.messageId;
    const userId = normalizeIncomingUserId(payload);
    const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : stream.model;
    const modelLabel = getModelDisplayName({ model }, stream.modelLabel || assistantModelLabelRef.current || "DeepSeek");
    updateMessagesForContext(stream.roomId, stream.conversationId, (prev) =>
      prev.map((message) =>
        message.id === stream.messageId
          ? {
              ...message,
              serverId: serverMessageId || message.serverId || "",
              userId: userId || message.userId || "",
              nickname: modelLabel,
              model,
              status: "sent",
              source: "server"
            }
          : message
      )
    );
    activeStreamsRef.current.delete(streamKey);
    resetAssistantState();
  }

  function handleAiStreamError(streamId, payload = {}) {
    const streamKey = getStreamKey(streamId);
    const stream = activeStreamsRef.current.get(streamKey);
    if (!stream) return;
    const model = typeof payload.model === "string" && payload.model.trim() ? payload.model.trim() : stream.model;
    updateMessagesForContext(stream.roomId, stream.conversationId, (prev) =>
      prev.map((message) =>
        message.id === stream.messageId
          ? { ...message, model, status: "failed" }
          : message
      )
    );
    activeStreamsRef.current.delete(streamKey);
    resetAssistantState();
  }

  function clearPendingResolveTimer(messageId) {
    const timerId = pendingResolveTimersRef.current.get(messageId);
    if (timerId == null) return;
    window.clearTimeout(timerId);
    pendingResolveTimersRef.current.delete(messageId);
  }

  function schedulePendingResolve(messageId) {
    clearPendingResolveTimer(messageId);
    const timerId = window.setTimeout(() => {
      pendingResolveTimersRef.current.delete(messageId);
      commitMessages((prev) =>
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
      nicknameRef.current = nickname;
    }
    clearAllPendingTimers();
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
  }, [enabled, nickname, normalizedUserId, activeRoomId, activeConversationId]);

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
          opened = true;
          reconnectAttemptRef.current = 0;
          setReconnectAttempt(0);
          setConnectionState("connected");
          setLastError("");
        };

        ws.onmessage = async (event) => {
          if (cancelled) return;
          try {
            const rawData =
              typeof event.data === "string"
                ? event.data
                : event.data instanceof Blob
                  ? await event.data.text()
                  : String(event.data);
            if (cancelled) return;
            if (isNoReplyText(rawData)) {
              showAssistantNoReply();
              return;
            }
            if (/QuotaExceeded|quota/i.test(rawData)) {
              showAssistantQuota("今日 AI 额度已用完，明天会自动恢复");
              return;
            }
            const raw = JSON.parse(rawData);
            const quotaMessage = getQuotaExceededMessage(raw);
            if (quotaMessage) {
              showAssistantQuota(quotaMessage);
              return;
            }
            const envelopeType = typeof raw.type === "number" ? raw.type : undefined;
            const payload = raw.data || raw;
            if (envelopeType === WS_EVENT.USER_MSG) {
              handleUserMessage(payload);
              return;
            }
            if (envelopeType === WS_EVENT.AI_STREAM_START) {
              if (isNoReplyPayload(payload)) showAssistantNoReply();
              else handleAiStreamStart(raw.stream_id, payload);
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
            handleUserMessage(payload);
          } catch (error) {
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

  function sendChatMessage(text) {
    const content = text.trim();
    const current = socketRef.current;
    if (!content || !nickname || !activeRoomId || !current || current.readyState !== WebSocket.OPEN) {
      return null;
    }

    const localMessage = {
      id: createId("local"),
      clientMessageId: createId("client"),
      roomId: activeRoomId,
      conversationId: activeConversationId,
      messageType: MESSAGE_TYPE.TEXT,
      nickname,
      userId: normalizedUserId,
      text: content,
      timestamp: Date.now(),
      isSelf: true,
      status: "pending",
      source: "local"
    };

    commitMessages((prev) => [...prev, localMessage]);

    try {
      current.send(JSON.stringify({
        type: 0,
        data: {
          room_id: activeRoomId,
          conversation_id: localMessage.conversationId,
          type: localMessage.messageType,
          content,
          client_message_id: localMessage.clientMessageId
        }
      }));
      beginAssistantThinking();
      schedulePendingResolve(localMessage.id);
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
