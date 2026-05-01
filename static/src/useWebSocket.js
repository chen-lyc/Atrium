import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_CONVERSATION_ID,
  LOCAL_SEND_SETTLE_DELAY,
  MESSAGE_HISTORY_PAGE_SIZE,
  MESSAGE_TYPE
} from "./constants.js";
import {
  createId,
  fetchCurrentUser,
  normalizeIncomingMessage,
  findPendingLocalMatch,
  mergeIncomingMessage
} from "./utils.js";

function normalizeConversationId(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return value;
  if (typeof value === "string" && value.trim()) {
    const numericValue = Number(value);
    if (Number.isSafeInteger(numericValue) && numericValue > 0) return numericValue;
  }
  return DEFAULT_CONVERSATION_ID;
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
    .map((message) => normalizeIncomingMessage({
      ...message,
      id: message.id ?? message.message_id,
      user_id: message.user_id ?? message.send_id,
      conversation_id: message.conversation_id ?? conversationId,
      status: "sent"
    }, nickname, userId));
}

export default function useWebSocket({ url, nickname, userId = "", enabled, onAuthFailed, conversationId = DEFAULT_CONVERSATION_ID }) {
  const socketRef = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectAttemptRef = useRef(0);
  const pendingResolveTimersRef = useRef(new Map());
  const authFailedRef = useRef(onAuthFailed);
  const activeConversationId = normalizeConversationId(conversationId);
  const normalizedUserId = String(userId || "").trim();

  const [messages, setMessages] = useState([]);
  const [connectionState, setConnectionState] = useState(enabled ? "connecting" : "idle");
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [lastError, setLastError] = useState("");
  const [historyState, setHistoryState] = useState("idle");
  const [historyHasMore, setHistoryHasMore] = useState(false);
  const [historyError, setHistoryError] = useState("");

  useEffect(() => {
    authFailedRef.current = onAuthFailed;
  }, [onAuthFailed]);

  function clearAllPendingTimers() {
    pendingResolveTimersRef.current.forEach((timerId) => {
      window.clearTimeout(timerId);
    });
    pendingResolveTimersRef.current.clear();
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
      setMessages((prev) =>
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
    setMessages((prev) =>
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
    clearAllPendingTimers();
    setMessages([]);
    setLastError("");
    setHistoryState(nickname ? "loading" : "idle");
    setHistoryHasMore(false);
    setHistoryError("");
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    if (!nickname) {
      setConnectionState("idle");
    }
  }, [nickname, activeConversationId]);

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
        setMessages((prev) => mergeMessageLists(prev, historicalMessages, { prepend: true }));
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
  }, [enabled, nickname, normalizedUserId, activeConversationId]);

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
            const payload = JSON.parse(rawData);
            const nextMessage = normalizeIncomingMessage(payload, nickname, normalizedUserId);
            if (nextMessage.conversationId && nextMessage.conversationId !== activeConversationId) {
              return;
            }
            setMessages((prev) => {
              if (nextMessage.isSelf) {
                const matchIndex = findPendingLocalMatch(prev, nextMessage);
                if (matchIndex != null) {
                  clearPendingResolveTimer(prev[matchIndex].id);
                }
              }
              return dedupeMessageList(mergeIncomingMessage(prev, nextMessage));
            });
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
      cleanupSocket();
    };
  }, [url, nickname, normalizedUserId, enabled, activeConversationId]);

  function sendChatMessage(text) {
    const content = text.trim();
    const current = socketRef.current;
    if (!content || !nickname || !current || current.readyState !== WebSocket.OPEN) {
      return null;
    }

    const localMessage = {
      id: createId("local"),
      clientMessageId: createId("client"),
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

    setMessages((prev) => [...prev, localMessage]);

    try {
      current.send(JSON.stringify({
        conversation_id: localMessage.conversationId,
        type: localMessage.messageType,
        content,
        client_message_id: localMessage.clientMessageId
      }));
      schedulePendingResolve(localMessage.id);
      return localMessage;
    } catch (error) {
      const failedMessage = { ...localMessage, status: "failed" };
      markLocalMessageFailed(localMessage.id);
      setLastError("消息发送失败");
      return failedMessage;
    }
  }

  function deleteChatMessage(messageId) {
    clearPendingResolveTimer(messageId);
    setMessages((prev) => prev.filter((message) => message.id !== messageId));
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
      setMessages((prev) => mergeMessageLists(prev, historicalMessages, { prepend: true }));
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
    historyState,
    historyHasMore,
    historyError,
    loadOlderMessages,
    sendChatMessage,
    deleteChatMessage
  };
}
