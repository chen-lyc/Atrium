import { AI_MODEL_LABELS, DEFAULT_CONVERSATION_ID, MESSAGE_TYPE, THINKING_MODE_OPTIONS } from "./constants.js";

const MAX_IMAGE_SOURCE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_DATA_URL_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_EDGE = 1600;
const COMPRESSED_IMAGE_TYPE = "image/jpeg";
const COMPRESSED_IMAGE_QUALITY = 0.86;
const SUPPORTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function createId(prefix = "msg") {
  if (window.crypto && typeof window.crypto.randomUUID === "function") {
    return `${prefix}-${window.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getTimestampValue(timestamp) {
  const value = new Date(timestamp).getTime();
  return Number.isNaN(value) ? Date.now() : value;
}

export function formatDividerTime(timestamp, full) {
  return new Intl.DateTimeFormat(
    "zh-CN",
    full
      ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }
      : { hour: "2-digit", minute: "2-digit" }
  ).format(new Date(getTimestampValue(timestamp)));
}

export function formatMessageTime(timestamp) {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(getTimestampValue(timestamp)));
}

export function getIncomingText(payload) {
  if (typeof payload.text === "string") return payload.text;
  if (typeof payload.message === "string") return payload.message;
  if (typeof payload.content === "string") return payload.content;
  return "";
}

export function normalizeIncomingUserId(payload) {
  if (typeof payload.user_id === "number" && Number.isFinite(payload.user_id)) {
    return String(payload.user_id);
  }
  if (typeof payload.user_id === "string" && payload.user_id.trim()) {
    return payload.user_id.trim();
  }
  if (typeof payload.send_id === "number" && Number.isFinite(payload.send_id)) {
    return String(payload.send_id);
  }
  if (typeof payload.send_id === "string" && payload.send_id.trim()) {
    return payload.send_id.trim();
  }
  return "";
}

export function normalizeIncomingConversationId(payload) {
  const value = payload.conversation_id != null ? payload.conversation_id : payload.conversationId;
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

export function normalizeIncomingRoomId(payload) {
  const value = payload.room_id != null ? payload.room_id : payload.roomId;
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

export function normalizeIncomingMessageType(payload) {
  const value = payload.type != null ? payload.type : payload.messageType;
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : undefined;
}

export function normalizeIncomingTimestamp(payload) {
  const value = payload.timestamp ?? payload.send_time_ms ?? payload.sendTimeMs ?? Date.now();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const trimmedValue = value.trim();
    if (/^\d+$/.test(trimmedValue)) {
      const numericValue = Number(trimmedValue);
      if (Number.isFinite(numericValue)) return numericValue;
    }
    return trimmedValue;
  }
  return Date.now();
}

function normalizeAuthUserId(data) {
  const value = data?.user_id ?? data?.uesr_id ?? data?.userId ?? data?.id;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string" && value.trim()) return value.trim();
  return "";
}

function normalizeOptionalTimestampMs(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const trimmedValue = value.trim();
    if (/^\d+$/.test(trimmedValue)) {
      const numericValue = Number(trimmedValue);
      if (Number.isFinite(numericValue) && numericValue > 0) {
        return numericValue < 10_000_000_000 ? numericValue * 1000 : numericValue;
      }
    }
    const parsedValue = Date.parse(trimmedValue);
    return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : 0;
  }
  return 0;
}

function normalizePreviewText(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object") {
    return normalizePreviewText(value.text ?? value.content ?? value.message ?? value.preview);
  }
  return "";
}

export function normalizeAuthConversations(data) {
  const rawConversations = Array.isArray(data?.conversations) ? data.conversations : [];
  const seen = new Set();
  return rawConversations
    .map((item) => {
      const id = normalizeIncomingConversationId({
        conversation_id: item?.id ?? item?.conversation_id ?? item?.conversationId
      });
      const name =
        typeof item?.title === "string" && item.title.trim()
          ? item.title.trim()
          : typeof item?.name === "string" && item.name.trim()
            ? item.name.trim()
          : id
            ? `对话 ${id}`
            : "";
      const createdAtMs = normalizeOptionalTimestampMs(item?.created_at_ms ?? item?.createdAtMs ?? item?.created_at ?? item?.createdAt);
      const updatedAtMs = normalizeOptionalTimestampMs(item?.updated_at_ms ?? item?.updatedAtMs ?? item?.updated_at ?? item?.updatedAt);
      const lastMessageAtMs = normalizeOptionalTimestampMs(
        item?.last_message_at_ms ??
        item?.lastMessageAtMs ??
        item?.last_message_at ??
        item?.lastMessageAt ??
        item?.last_message?.created_at_ms ??
        item?.lastMessage?.createdAtMs ??
        item?.last_message?.created_at ??
        item?.lastMessage?.createdAt
      );
      const lastActivityAtMs = normalizeOptionalTimestampMs(
        item?.last_activity_at_ms ??
        item?.lastActivityAtMs ??
        item?.last_activity_at ??
        item?.lastActivityAt
      ) || lastMessageAtMs || updatedAtMs || createdAtMs;
      const lastMessagePreview = normalizePreviewText(
        item?.last_message_preview ??
        item?.lastMessagePreview ??
        item?.last_message ??
        item?.lastMessage ??
        item?.preview
      );
      const unreadCount = normalizeNonNegativeCount(item?.unread_count ?? item?.unreadCount);
      return { id, name, createdAtMs, updatedAtMs, lastActivityAtMs, lastMessagePreview, unreadCount };
    })
    .filter((conversation) => {
      if (!conversation.id || seen.has(conversation.id)) return false;
      seen.add(conversation.id);
      return true;
    });
}

export function normalizeAuthRooms(data) {
  const rawRooms = Array.isArray(data?.rooms) ? data.rooms : [];
  const seen = new Set();
  return rawRooms
    .map((item) => {
      const roomId = normalizeIncomingRoomId({
        room_id: item?.room_id ?? item?.roomId ?? item?.id
      });
      const mainConversationId = normalizeIncomingConversationId({
        conversation_id:
          item?.main_conversation_id ??
          item?.mainConversationId ??
          item?.conversation_id ??
          item?.conversationId
      });
      const name =
        typeof item?.name === "string" && item.name.trim()
          ? item.name.trim()
          : roomId
            ? `房间 ${roomId}`
            : "";
      const conversations = normalizeAuthConversations(item);
      const type = typeof item?.type === "number" ? item.type : 2;
      const memberCount = normalizeNonNegativeCount(item?.member_count ?? item?.memberCount ?? item?.members_count ?? item?.membersCount);
      return { roomId, id: roomId, name, mainConversationId, conversations, type, memberCount };
    })
    .filter((room) => {
      if (!room.roomId || seen.has(room.roomId)) return false;
      seen.add(room.roomId);
      return true;
    });
}

export function normalizeIncomingMessage(payload, currentNickname, currentUserId = "") {
  const messageType = normalizeIncomingMessageType(payload);
  const senderType = normalizeText(payload?.sender_type ?? payload?.senderType ?? payload?.participant_type ?? payload?.participantType).toLowerCase();
  const messageRole = normalizeText(payload?.role ?? payload?.message_role ?? payload?.messageRole).toLowerCase();
  const isSystemMessage = messageType === MESSAGE_TYPE.SYSTEM || senderType === "system" || messageRole === "system";
  const normalizedUsername =
    typeof payload.username === "string" && payload.username.trim()
      ? payload.username.trim()
      : "";
  const normalizedUserId = normalizeIncomingUserId(payload);
  const normalizedCurrentUserId = String(currentUserId || "").trim();
  const isCurrentUser = Boolean(normalizedCurrentUserId && normalizedUserId === normalizedCurrentUserId);
  const normalizedNickname =
    isSystemMessage ? "__system__" :
    normalizedUsername ||
    (typeof payload.nickname === "string" && payload.nickname.trim()
      ? payload.nickname.trim()
      : isCurrentUser && currentNickname
        ? currentNickname
        : normalizedUserId
          ? `用户 ${normalizedUserId}`
          : "匿名用户");

  return {
    id: payload.id || payload.message_id || payload.messageId || createId("remote"),
    clientMessageId:
      typeof payload.clientMessageId === "string"
        ? payload.clientMessageId
        : typeof payload.client_message_id === "string"
          ? payload.client_message_id
          : "",
    userId: normalizedUserId,
    username: normalizedUsername,
    nickname: normalizedNickname,
    avatarUrl: typeof payload.avatar_url === "string" ? payload.avatar_url : payload.avatarUrl || "",
    roomId: normalizeIncomingRoomId(payload),
    conversationId: normalizeIncomingConversationId(payload),
    messageType,
    text: getIncomingText(payload),
    timestamp: normalizeIncomingTimestamp(payload),
    isSelf: !isSystemMessage && Boolean(isCurrentUser || (currentNickname && normalizedNickname === currentNickname)),
    status: payload.status || "sent",
    source: "server"
  };
}

export function findPendingLocalMatch(prevMessages, incomingMessage) {
  const exactIdMatch = [...prevMessages]
    .map((message, index) => ({ message, index }))
    .find(({ message }) => {
      if (!message.isSelf || message.source !== "local") return false;
      if (!message.clientMessageId || !incomingMessage.clientMessageId) return false;
      return message.clientMessageId === incomingMessage.clientMessageId;
    })?.index;

  if (exactIdMatch != null) return exactIdMatch;
  if (!incomingMessage.isSelf) return undefined;

  return [...prevMessages]
    .map((message, index) => ({ message, index }))
    .find(({ message }) => {
      if (!message.isSelf || message.source !== "local") return false;
      if (message.nickname !== incomingMessage.nickname || message.text !== incomingMessage.text) return false;
      const timeGap = Math.abs(
        getTimestampValue(incomingMessage.timestamp) - getTimestampValue(message.timestamp)
      );
      return timeGap <= 30000;
    })?.index;
}

export function mergeIncomingMessage(prevMessages, incomingMessage) {
  let matchIndex = findPendingLocalMatch(prevMessages, incomingMessage);
  if (!incomingMessage.isSelf && matchIndex == null) {
    return [...prevMessages, incomingMessage];
  }
  if (matchIndex == null) {
    const incomingText = incomingMessage.text;
    matchIndex = prevMessages.findIndex(
      (m) => m.isSelf && (m.source === "local" || m.serverId) && m.text === incomingText
    );
  }
  if (matchIndex == null) {
    return [...prevMessages, incomingMessage];
  }
  return prevMessages.map((message, index) => {
    if (index !== matchIndex) return message;
    return {
      ...message,
      ...incomingMessage,
      id: message.id,
      serverId: incomingMessage.id,
      clientMessageId: incomingMessage.clientMessageId || message.clientMessageId || "",
      timelineOrder: message.timelineOrder ?? incomingMessage.timelineOrder,
      status: incomingMessage.status === "failed" ? "failed" : "sent",
      source: "server"
    };
  });
}

export function decorateMessages(messages) {
  return messages.map((message, index) => {
    const prev = index > 0 ? messages[index - 1] : null;
    const currentTime = getTimestampValue(message.timestamp);
    const previousTime = prev ? getTimestampValue(prev.timestamp) : null;
    const diffMinutes = previousTime == null ? Infinity : Math.abs(currentTime - previousTime) / 60000;
    const groupedWithPrev = Boolean(prev && getMessageAuthorGroupKey(prev) === getMessageAuthorGroupKey(message) && diffMinutes <= 2);
    const showAuthor = !groupedWithPrev;
    const showDivider = index === 0 || diffMinutes > 5;

    return {
      ...message,
      groupedWithPrev,
      showAuthor,
      showDivider,
      timeLabel: formatMessageTime(message.timestamp),
      dividerLabel: formatDividerTime(message.timestamp, index === 0)
    };
  });
}

function getMessageAuthorGroupKey(message) {
  if (message?.isAI) {
    const model = normalizeText(message.model).toLowerCase();
    const provider = normalizeText(message.provider).toLowerCase();
    if (model) return `ai:${model}`;
    if (provider) return `ai-provider:${provider}`;
  }
  return `user:${normalizeText(message?.nickname)}`;
}

export function deleteSessionCookie() {
  deleteCookie("session_id");
  deleteCookie("room_id");
  deleteCookie("conversation_id");
  deleteCookie("personal_conversation_id");
  deleteCookie("public_conversation_id");
}

function deleteCookie(name) {
  document.cookie = `${name}=; Max-Age=0; Path=/`;
}

export function setCookieValue(name, value) {
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/`;
}

export function getCookieValue(name) {
  const prefix = `${name}=`;
  const rawValue = document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
  if (!rawValue) return "";
  try {
    return decodeURIComponent(rawValue);
  } catch (error) {
    return rawValue;
  }
}

function hasCookie(name) {
  return Boolean(getCookieValue(name));
}

export function hasSessionCookie() {
  return hasCookie("session_id");
}

export function getConversationIdCookie() {
  const value = getCookieValue("conversation_id");
  const numericValue = Number(value);
  if (Number.isSafeInteger(numericValue) && numericValue > 0) return numericValue;
  return DEFAULT_CONVERSATION_ID;
}

export function getUtf8ByteLength(value) {
  if (typeof TextEncoder === "function") {
    return new TextEncoder().encode(value).length;
  }
  return unescape(encodeURIComponent(value)).length;
}

function hasInvalidControlCharacter(value) {
  return Array.from(value).some((char) => {
    const codePoint = char.codePointAt(0);
    return codePoint < 0x20 || codePoint === 0x7f;
  });
}

export function validateAuthNickname(nickname) {
  if (!nickname) return "请输入登录名";
  if (hasInvalidControlCharacter(nickname)) return "登录名包含无效字符";
  if (getUtf8ByteLength(nickname) > 32) return "登录名不能超过 32 字节";
  return "";
}

export function validateAuthUsername(username) {
  if (!username) return "请输入登录名";
  if (hasInvalidControlCharacter(username)) return "登录名包含无效字符";
  if (getUtf8ByteLength(username) > 32) return "登录名不能超过 32 字节";
  return "";
}

export function validateProfileNickname(nickname) {
  if (!nickname) return "请输入显示名";
  if (hasInvalidControlCharacter(nickname)) return "显示名包含无效字符";
  if (getUtf8ByteLength(nickname) > 64) return "显示名不能超过 64 字节";
  return "";
}

export function validateProfileAvatarUrl(avatarUrl) {
  if (getUtf8ByteLength(avatarUrl || "") > 255) return "头像地址不能超过 255 字节";
  return "";
}

export function validateAuthPassword(password) {
  if (!password) return "请输入密码";
  if (hasInvalidControlCharacter(password)) return "密码包含无效字符";
  if (getUtf8ByteLength(password) > 64) return "密码不能超过 64 字节";
  return "";
}

async function readResponseText(response) {
  try {
    return (await response.text()).trim();
  } catch (error) {
    return "";
  }
}

export async function resolveAuthFailure(response, mode) {
  const responseText = await readResponseText(response);
  if (response.status === 400) {
    if (responseText === "invalid_username") return { field: "nickname", message: "登录名不合法", networkError: "" };
    if (responseText === "invalid_password") return { field: "password", message: "密码不合法", networkError: "" };
    if (responseText === "invalid_encode") return { field: null, message: "", networkError: "请求格式异常，请重试" };
    if (responseText === "missing username or password") return { field: null, message: "", networkError: "请完整填写登录名和密码" };
    return { field: null, message: "", networkError: "输入格式不正确，请检查后重试" };
  }
  if (mode === "login" && response.status === 401) {
    return { field: "password", message: "登录名或密码错误", networkError: "" };
  }
  if (mode === "register" && response.status === 409) {
    return { field: "nickname", message: "登录名已被占用", networkError: "" };
  }
  if (response.status >= 500) {
    return { field: null, message: "", networkError: "服务器开小差了，请稍后再试" };
  }
  return {
    field: null,
    message: "",
    networkError: mode === "register" ? "注册失败，请稍后重试" : "登录失败，请稍后重试"
  };
}

function normalizeAuthNickname(data) {
  if (typeof data?.nickname === "string" && data.nickname.trim()) return data.nickname.trim();
  if (typeof data?.username === "string" && data.username.trim()) return data.username.trim();
  return "";
}

function normalizeAuthUsername(data) {
  if (typeof data?.username === "string" && data.username.trim()) return data.username.trim();
  return "";
}

function normalizeAuthAvatarUrl(data) {
  if (typeof data?.avatar_url === "string" && data.avatar_url.trim()) return data.avatar_url.trim();
  if (typeof data?.avatarUrl === "string" && data.avatarUrl.trim()) return data.avatarUrl.trim();
  return "";
}

export function normalizeAuthPayload(data, fallbackNickname = "") {
  const nickname = normalizeAuthNickname(data) || String(fallbackNickname || "").trim();
  const username = normalizeAuthUsername(data);
  const avatarUrl = normalizeAuthAvatarUrl(data);
  const userId = normalizeAuthUserId(data);
  return {
    ...(data && typeof data === "object" ? data : {}),
    userId,
    username,
    nickname,
    avatarUrl,
    avatar_url: avatarUrl,
    rooms: normalizeAuthRooms(data),
    conversations: normalizeAuthConversations(data)
  };
}

async function readJsonOrEmpty(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

async function apiRequest(path, options = {}) {
  const {
    method = "GET",
    body,
    signal,
    parseJson = true,
    headers = {}
  } = options;
  const init = {
    method,
    credentials: "include",
    headers: { ...headers },
    signal
  };
  if (body !== undefined) {
    init.headers["Content-Type"] = "application/json; charset=utf-8";
    init.body = JSON.stringify(body);
  }
  const response = await fetch(path, init);
  if (!response.ok) {
    const error = new Error("api request failed");
    error.status = response.status;
    error.body = await readResponseText(response);
    throw error;
  }
  if (!parseJson || response.status === 204) return {};
  return readJsonOrEmpty(response);
}

export function getApiErrorMessage(error, fallback = "操作失败，请稍后重试") {
  if (/QuotaExceeded|quota/i.test(String(error?.body || error?.message || ""))) {
    return "今日 AI 额度已用完，明天会自动恢复";
  }
  if (error?.status === 401) return "登录状态已失效，请重新登录";
  if (error?.status === 400) return "当前操作不符合后端规则";
  if (error?.status === 409) return "这项内容已经存在";
  if (error?.status >= 500) return "服务器暂时没有接住这个操作";
  return fallback;
}

export function getModelDisplayName(modelInfo, fallback = "") {
  if (!modelInfo) return fallback;
  const model = normalizeText(modelInfo?.model);
  const provider = normalizeText(modelInfo?.provider);
  if (model && AI_MODEL_LABELS[model]) return AI_MODEL_LABELS[model];
  if (model) return model;
  if (provider) return provider;
  return fallback;
}

export async function fetchAuthRooms() {
  try {
    const res = await fetch("/api/rooms", {
      method: "GET",
      credentials: "include"
    });
    if (!res.ok) {
      return { ok: false, status: res.status, data: null };
    }
    return { ok: true, status: res.status, data: await readJsonOrEmpty(res) };
  } catch (error) {
    return { ok: false, status: 0, data: null };
  }
}

export async function fetchRoomConversations(roomId) {
  if (!roomId) return [];
  try {
    const res = await fetch(`/api/rooms/${roomId}/conversations`, {
      method: "GET",
      credentials: "include"
    });
    if (!res.ok) return [];
    return normalizeAuthConversations(await readJsonOrEmpty(res));
  } catch (error) {
    return [];
  }
}

export async function renameConversation(conversationId, title) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  try {
    const res = await fetch(`/api/conversations/${conversationId}/title`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ title }),
      signal: controller.signal
    });
    if (!res.ok) {
      const error = new Error("重命名失败");
      error.status = res.status;
      throw error;
    }
    return await res.json();
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("重命名请求超时，请稍后重试");
    }
    if (error instanceof TypeError && error.message === "Failed to fetch") {
      throw new Error("网络连接异常，请稍后重试");
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function loadSessionRooms(fallbackNickname = "") {
  const roomResult = await fetchAuthRooms();
  if (!roomResult.ok) return { ok: false, status: roomResult.status, rooms: [], conversations: [] };

  const roomsSession = normalizeAuthPayload(roomResult.data, fallbackNickname);
  const hydratedRooms = await Promise.all(
    roomsSession.rooms.map(async (room) => {
      const conversations = await fetchRoomConversations(room.roomId);
      return {
        ...room,
        conversations: conversations.length ? conversations : room.conversations
      };
    })
  );
  return {
    ok: true,
    status: roomResult.status,
    rooms: hydratedRooms,
    conversations: roomsSession.conversations,
    raw: roomResult.data
  };
}

async function attachRoomsToSession(session) {
  const roomResult = await loadSessionRooms(session.nickname);
  if (!roomResult.ok) return session;
  return {
    ...session,
    ...(roomResult.raw && typeof roomResult.raw === "object" ? roomResult.raw : {}),
    rooms: roomResult.rooms,
    conversations: roomResult.conversations.length
      ? roomResult.conversations
      : session.conversations
  };
}

export async function readAuthSuccess(response, fallbackNickname = "") {
  const data = await readJsonOrEmpty(response);
  return attachRoomsToSession(normalizeAuthPayload(data, fallbackNickname));
}

export async function fetchCurrentUser() {
  try {
    const res = await fetch("/api/me", {
      method: "GET",
      credentials: "include"
    });
    if (!res.ok) {
      return { ok: false, status: res.status, data: null };
    }
    const data = await readJsonOrEmpty(res);
    const session = normalizeAuthPayload(data);
    if (!session.nickname) {
      return { ok: false, status: res.status, data: null };
    }
    return { ok: true, status: res.status, data: await attachRoomsToSession(session) };
  } catch (error) {
    return { ok: false, status: 0, data: null };
  }
}

export function buildAuthBody(nickname, password) {
  const body = new URLSearchParams();
  body.append("username", nickname);
  body.append("password", password);
  return body.toString();
}

function normalizeNumericId(value) {
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

function normalizeNonNegativeCount(value) {
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue >= 0 ? numericValue : null;
}

function normalizeTokenCount(value) {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return "0";
    return String(Math.trunc(value));
  }
  if (typeof value === "bigint") {
    return value >= 0n ? value.toString() : "0";
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (!/^\d+$/.test(text)) return "0";
  return text.replace(/^0+(?=\d)/, "");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function normalizeUserProfile(item) {
  const userId = normalizeNumericId(item?.user_id ?? item?.userId ?? item?.id);
  const username = normalizeText(item?.username);
  const nickname = normalizeText(item?.nickname) || username || (userId ? `用户 ${userId}` : "未命名用户");
  return {
    userId,
    username,
    nickname,
    avatarUrl: normalizeText(item?.avatar_url ?? item?.avatarUrl)
  };
}

function normalizeRoomMember(item) {
  return {
    ...normalizeUserProfile(item),
    role: normalizeNumericId(item?.role),
    joinedAt: normalizeNumericId(item?.join_at_ms ?? item?.joinAtMs)
  };
}

function normalizeFriend(item) {
  return {
    ...normalizeUserProfile(item),
    createdAt: normalizeNumericId(item?.created_at_ms ?? item?.createdAtMs)
  };
}

function normalizeFriendRequest(item, direction) {
  const fromUserId = normalizeNumericId(item?.from_user_id ?? item?.fromUserId);
  const toUserId = normalizeNumericId(item?.to_user_id ?? item?.toUserId);
  const peerNickname = direction === "sent"
    ? normalizeText(item?.to_nickname ?? item?.nickname)
    : normalizeText(item?.from_nickname ?? item?.nickname);
  return {
    requestId: normalizeNumericId(item?.request_id ?? item?.requestId ?? item?.id),
    fromUserId,
    toUserId,
    peerUserId: direction === "sent" ? toUserId : fromUserId,
    peerNickname: peerNickname || `用户 ${direction === "sent" ? toUserId : fromUserId}`,
    createdAt: normalizeNumericId(item?.created_at_ms ?? item?.createdAtMs)
  };
}

function normalizeRoomInvitation(item, direction = "received") {
  return {
    invitationId: normalizeNumericId(item?.invitation_id ?? item?.invitationId ?? item?.id),
    roomId: normalizeNumericId(item?.room_id ?? item?.roomId),
    roomName: normalizeText(item?.room_name ?? item?.roomName),
    inviterId: normalizeNumericId(item?.inviter_id ?? item?.inviterId),
    inviteeId: normalizeNumericId(item?.invitee_id ?? item?.inviteeId),
    inviteeNickname: normalizeText(item?.invitee_nickname ?? item?.inviteeNickname),
    direction,
    createdAt: normalizeNumericId(item?.created_at_ms ?? item?.createdAtMs)
  };
}

export function normalizeAiMember(item) {
  const aiId = normalizeNumericId(item?.ai_id ?? item?.aiId ?? item?.id);
  const provider = normalizeText(item?.provider);
  const model = normalizeText(item?.model);
  const displayName = normalizeText(item?.display_name ?? item?.displayName);
  const avatarUrl = normalizeText(item?.avatar_url ?? item?.avatarUrl);
  const adapterUrl = normalizeText(item?.adapter_url ?? item?.adapterUrl);
  const customAdapterText =
    typeof item?.custom_adapter_text === "string"
      ? item.custom_adapter_text
      : typeof item?.customAdapterText === "string"
        ? item.customAdapterText
        : "";
  return {
    aiId,
    id: aiId,
    provider,
    model,
    displayName,
    avatarUrl,
    adapterUrl,
    customAdapterText
  };
}

export function getThinkingModeFromMember(member) {
  if (member?.customAdapterText && String(member.customAdapterText).trim()) return "custom";
  const adapterUrl = normalizeText(member?.adapterUrl ?? member?.adapter_url);
  if (!adapterUrl) return "default";
  const matched = THINKING_MODE_OPTIONS.find((option) => option.adapterAliases.includes(adapterUrl));
  return matched?.key || "default";
}

export function getThinkingModeLabel(member) {
  const key = typeof member === "string" ? member : getThinkingModeFromMember(member);
  return THINKING_MODE_OPTIONS.find((option) => option.key === key)?.label || "默认";
}

export function resolveThinkingAdapterUrl(thinkingKey, availableAdapters = []) {
  const option = THINKING_MODE_OPTIONS.find((item) => item.key === thinkingKey);
  if (!option || option.key === "default" || option.isCustom) return "";
  const availableBasenames = new Set(
    (Array.isArray(availableAdapters) ? availableAdapters : [])
      .filter(Boolean)
      .map((path) => {
        const last = String(path).split("/").pop();
        return last;
      })
  );
  return option.adapterAliases.find((alias) => availableBasenames.has(alias)) || "";
}

function buildAiMemberBody(member) {
  const aiId = normalizeNumericId(member?.aiId ?? member?.ai_id ?? member?.id);
  const body = {
    ai_id: aiId,
    adapter_url: member?.adapterUrl ? String(member.adapterUrl) : null,
    custom_adapter_text:
      typeof member?.customAdapterText === "string" && member.customAdapterText.trim()
        ? member.customAdapterText
        : null
  };
  return body;
}

export async function createRoom(roomName) {
  const data = await apiRequest("/api/rooms", {
    method: "POST",
    body: { room_name: roomName }
  });
  return {
    roomId: normalizeNumericId(data?.room_id ?? data?.roomId),
    mainConversationId: normalizeNumericId(data?.main_conversation_id ?? data?.mainConversationId)
  };
}

export async function createConversation(roomId, title) {
  const data = await apiRequest(`/api/rooms/${roomId}/conversations`, {
    method: "POST",
    body: { title }
  });
  return { conversationId: normalizeNumericId(data?.conversation_id ?? data?.conversationId) };
}

export async function fetchThinkingAdapters(signal) {
  const data = await apiRequest("/api/thinking-adapters", { signal });
  return Array.isArray(data) ? data.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

export async function fetchAvailableAis(signal) {
  const data = await apiRequest("/api/ais", { signal });
  return Array.isArray(data) ? data.map(normalizeAiMember).filter((member) => member.aiId) : [];
}

export async function fetchRoomAiMembers(roomId, signal) {
  if (!roomId) return [];
  const data = await apiRequest(`/api/rooms/${roomId}/ai-members`, { signal });
  return Array.isArray(data) ? data.map(normalizeAiMember).filter((member) => member.aiId) : [];
}

export async function fetchConversationAiMembers(conversationId, signal) {
  if (!conversationId) return [];
  const data = await apiRequest(`/api/conversations/${conversationId}/ai-members`, { signal });
  return Array.isArray(data) ? data.map(normalizeAiMember).filter((member) => member.aiId) : [];
}

export async function addRoomAiMember(roomId, member) {
  await apiRequest(`/api/rooms/${roomId}/ai-members`, {
    method: "POST",
    body: buildAiMemberBody(member),
    parseJson: false
  });
}

export async function updateRoomAiMember(roomId, member) {
  await apiRequest(`/api/rooms/${roomId}/ai-members/${member.aiId}`, {
    method: "PATCH",
    body: buildAiMemberBody(member),
    parseJson: false
  });
}

export async function removeRoomAiMember(roomId, aiId) {
  await apiRequest(`/api/rooms/${roomId}/ai-members/${aiId}`, { method: "DELETE", parseJson: false });
}

export async function addConversationAiMember(conversationId, member) {
  await apiRequest(`/api/conversations/${conversationId}/ai-members`, {
    method: "POST",
    body: buildAiMemberBody(member),
    parseJson: false
  });
}

export async function updateConversationAiMember(conversationId, member) {
  await apiRequest(`/api/conversations/${conversationId}/ai-members/${member.aiId}`, {
    method: "PATCH",
    body: buildAiMemberBody(member),
    parseJson: false
  });
}

export async function removeConversationAiMember(conversationId, aiId) {
  await apiRequest(`/api/conversations/${conversationId}/ai-members/${aiId}`, { method: "DELETE", parseJson: false });
}

async function syncAiMemberSet(currentMembers, nextMembers, addMember, updateMember, removeMember) {
  const currentById = new Map((currentMembers || []).map((member) => [member.aiId, member]));
  const nextById = new Map((nextMembers || []).map((member) => [member.aiId, member]).filter(([aiId]) => aiId));

  await Promise.all(
    [...currentById.keys()]
      .filter((aiId) => !nextById.has(aiId))
      .map((aiId) => removeMember(aiId))
  );
  await Promise.all(
    [...nextById.values()].map((member) =>
      currentById.has(member.aiId) ? updateMember(member) : addMember(member)
    )
  );
}

export async function syncRoomAiMembers(roomId, nextMembers) {
  const currentMembers = await fetchRoomAiMembers(roomId);
  await syncAiMemberSet(
    currentMembers,
    nextMembers,
    (member) => addRoomAiMember(roomId, member),
    (member) => updateRoomAiMember(roomId, member),
    (aiId) => removeRoomAiMember(roomId, aiId)
  );
  return fetchRoomAiMembers(roomId);
}

export async function syncConversationAiMembers(conversationId, nextMembers) {
  const currentMembers = await fetchConversationAiMembers(conversationId);
  await syncAiMemberSet(
    currentMembers,
    nextMembers,
    (member) => addConversationAiMember(conversationId, member),
    (member) => updateConversationAiMember(conversationId, member),
    (aiId) => removeConversationAiMember(conversationId, aiId)
  );
  return fetchConversationAiMembers(conversationId);
}

// Reserved: API layer ready, not yet wired to UI
export async function fetchConversationModel(conversationId, signal) {
  const data = await apiRequest(`/api/conversations/${conversationId}/model`, { signal });
  return { provider: data?.provider || "", model: data?.model || "" };
}

export async function fetchAiUsage(signal) {
  const data = await apiRequest("/api/me/ai-usage", { signal });
  return {
    promptTokens: normalizeTokenCount(data?.prompt_tokens ?? data?.promptTokens),
    completionTokens: normalizeTokenCount(data?.completion_tokens ?? data?.completionTokens),
    totalTokens: normalizeTokenCount(data?.total_tokens ?? data?.totalTokens),
    requestCount: normalizeTokenCount(data?.api_requests ?? data?.apiRequests ?? data?.request_count ?? data?.requestCount),
    models: Array.isArray(data?.models)
      ? data.models
      : Array.isArray(data?.usage_by_model)
        ? data.usage_by_model
        : Array.isArray(data?.usageByModel)
          ? data.usageByModel
          : []
  };
}

export async function fetchTodayAiUsage(signal) {
  const data = await apiRequest("/api/me/ai-usage/today", { signal });
  return {
    promptTokens: normalizeTokenCount(data?.prompt_tokens ?? data?.promptTokens),
    completionTokens: normalizeTokenCount(data?.completion_tokens ?? data?.completionTokens),
    totalTokens: normalizeTokenCount(data?.total_tokens ?? data?.totalTokens),
    requestCount: normalizeTokenCount(data?.api_requests ?? data?.apiRequests ?? data?.request_count ?? data?.requestCount),
    models: Array.isArray(data?.models)
      ? data.models
      : Array.isArray(data?.usage_by_model)
        ? data.usage_by_model
        : Array.isArray(data?.usageByModel)
          ? data.usageByModel
          : []
  };
}

export async function renameRoom(roomId, name) {
  await apiRequest(`/api/rooms/${roomId}`, {
    method: "PATCH",
    body: { name },
    parseJson: false
  });
}

export async function deleteConversation(conversationId) {
  await apiRequest(`/api/conversations/${conversationId}`, { method: "DELETE", parseJson: false });
}

export async function deleteRoom(roomId) {
  await apiRequest(`/api/rooms/${roomId}`, { method: "DELETE", parseJson: false });
}

export async function fetchRoomMembers(roomId, signal) {
  const data = await apiRequest(`/api/rooms/${roomId}/members`, { signal });
  return Array.isArray(data) ? data.map(normalizeRoomMember).filter((member) => member.userId) : [];
}

export async function removeRoomMember(roomId, userId) {
  await apiRequest(`/api/rooms/${roomId}/members/${userId}`, { method: "DELETE", parseJson: false });
}

export async function updateRoomMemberRole(roomId, userId, role) {
  await apiRequest(`/api/rooms/${roomId}/members/${userId}`, {
    method: "PATCH",
    body: { role },
    parseJson: false
  });
}

export async function fetchRoomInvitations(roomId, signal) {
  const data = await apiRequest(`/api/rooms/${roomId}/invitations`, { signal });
  return Array.isArray(data) ? data.map((item) => normalizeRoomInvitation(item, "room")).filter((inv) => inv.invitationId) : [];
}

export async function createRoomInvitation(roomId, inviteeId) {
  const data = await apiRequest(`/api/rooms/${roomId}/invitations`, {
    method: "POST",
    body: { invitee_id: inviteeId }
  });
  return normalizeRoomInvitation(data, "room");
}

export async function fetchMyRoomInvitations(direction = "received", signal) {
  const data = await apiRequest(`/api/invitations?direction=${encodeURIComponent(direction)}`, { signal });
  return Array.isArray(data) ? data.map((item) => normalizeRoomInvitation(item, direction)).filter((inv) => inv.invitationId) : [];
}

export async function respondRoomInvitation(invitationId, status) {
  await apiRequest(`/api/invitations/${invitationId}`, {
    method: "PATCH",
    body: { status },
    parseJson: false
  });
}

export async function cancelRoomInvitation(invitationId) {
  await apiRequest(`/api/invitations/${invitationId}`, { method: "DELETE", parseJson: false });
}

export async function searchUsers(query, signal) {
  const data = await apiRequest(`/api/users/search?q=${encodeURIComponent(query)}`, { signal });
  return Array.isArray(data) ? data.map(normalizeUserProfile).filter((user) => user.userId) : [];
}

export async function fetchFriends(signal) {
  const data = await apiRequest("/api/friends", { signal });
  return Array.isArray(data) ? data.map(normalizeFriend).filter((friend) => friend.userId) : [];
}

export async function deleteFriend(userId) {
  await apiRequest(`/api/friends/${userId}`, { method: "DELETE", parseJson: false });
}

export async function createFriendRequest(toUserId) {
  const data = await apiRequest("/api/friend-requests", {
    method: "POST",
    body: { to_user_id: toUserId }
  });
  return { requestId: normalizeNumericId(data?.request_id ?? data?.requestId ?? data?.id) };
}

export async function fetchFriendRequests(direction = "received", signal) {
  const data = await apiRequest(`/api/friend-requests?direction=${encodeURIComponent(direction)}`, { signal });
  return Array.isArray(data) ? data.map((item) => normalizeFriendRequest(item, direction)).filter((request) => request.requestId) : [];
}

export async function respondFriendRequest(requestId, status) {
  await apiRequest(`/api/friend-requests/${requestId}`, {
    method: "PATCH",
    body: { status },
    parseJson: false
  });
}

export async function cancelFriendRequest(requestId) {
  await apiRequest(`/api/friend-requests/${requestId}`, { method: "DELETE", parseJson: false });
}

export async function updateCurrentUserProfile(profile) {
  await apiRequest("/api/me", {
    method: "PATCH",
    body: profile,
    parseJson: false
  });
}

export async function deleteStoredMessage(messageId) {
  await apiRequest(`/api/messages/${messageId}`, { method: "DELETE", parseJson: false });
}

export function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("图片解码失败"));
    image.src = dataUrl;
  });
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("图片压缩失败"));
    }, type, quality);
  });
}

async function resizeRasterImage(dataUrl) {
  const image = await loadImage(dataUrl);
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("浏览器无法处理这张图片");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const blob = await canvasToBlob(canvas, COMPRESSED_IMAGE_TYPE, COMPRESSED_IMAGE_QUALITY);
  const resizedDataUrl = await readFileAsDataUrl(blob);
  return { dataUrl: resizedDataUrl, width, height, bytes: blob.size, mime: COMPRESSED_IMAGE_TYPE };
}

function assertPreparedImageSize(dataUrl) {
  if (getUtf8ByteLength(dataUrl) > MAX_IMAGE_DATA_URL_BYTES) {
    throw new Error(`图片处理后仍超过 ${formatFileSize(MAX_IMAGE_DATA_URL_BYTES)}，请换一张更小的图片`);
  }
}

export async function prepareImageAttachment(file) {
  if (!file || !SUPPORTED_IMAGE_TYPES.has(file.type)) {
    throw new Error("请选择 PNG、JPG、WebP 或 GIF 图片");
  }
  if (file.size > MAX_IMAGE_SOURCE_BYTES) {
    throw new Error(`图片不能超过 ${formatFileSize(MAX_IMAGE_SOURCE_BYTES)}`);
  }

  const originalDataUrl = await readFileAsDataUrl(file);
  const baseAttachment = {
    id: createId("image"),
    name: file.name || "pasted-image",
    alt: file.name || "聊天图片",
    sizeLabel: formatFileSize(file.size),
    originalBytes: file.size
  };

  if (file.type === "image/gif") {
    assertPreparedImageSize(originalDataUrl);
    return {
      ...baseAttachment,
      dataUrl: originalDataUrl,
      previewUrl: originalDataUrl,
      mime: file.type,
      bytes: file.size
    };
  }

  const resized = await resizeRasterImage(originalDataUrl);
  assertPreparedImageSize(resized.dataUrl);
  return {
    ...baseAttachment,
    dataUrl: resized.dataUrl,
    previewUrl: resized.dataUrl,
    mime: resized.mime,
    bytes: resized.bytes,
    sizeLabel: formatFileSize(resized.bytes),
    width: resized.width,
    height: resized.height
  };
}

export function buildImageMarkdown(attachment) {
  if (!attachment?.dataUrl) return "";
  const alt = String(attachment.alt || attachment.name || "聊天图片")
    .replace(/[\[\]\r\n]/g, " ")
    .trim() || "聊天图片";
  return `![${alt}](${attachment.dataUrl})`;
}
