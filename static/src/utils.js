import { DEFAULT_CONVERSATION_ID } from "./constants.js";

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
  return "";
}

export function normalizeIncomingConversationId(payload) {
  const value = payload.conversation_id != null ? payload.conversation_id : payload.conversationId;
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}

export function normalizeIncomingMessageType(payload) {
  const value = payload.type != null ? payload.type : payload.messageType;
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : undefined;
}

export function normalizeIncomingTimestamp(payload) {
  return payload.timestamp ?? payload.send_time_ms ?? payload.sendTimeMs ?? Date.now();
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
        typeof item?.name === "string" && item.name.trim()
          ? item.name.trim()
          : id
            ? `讨论室 ${id}`
            : "";
      return { id, name };
    })
    .filter((conversation) => {
      if (!conversation.id || seen.has(conversation.id)) return false;
      seen.add(conversation.id);
      return true;
    });
}

export function normalizeIncomingMessage(payload, currentNickname) {
  const normalizedUsername =
    typeof payload.username === "string" && payload.username.trim()
      ? payload.username.trim()
      : "";
  const normalizedNickname =
    normalizedUsername ||
    (typeof payload.nickname === "string" && payload.nickname.trim()
      ? payload.nickname.trim()
      : "匿名用户");

  return {
    id: payload.id || payload.message_id || payload.messageId || createId("remote"),
    clientMessageId:
      typeof payload.clientMessageId === "string"
        ? payload.clientMessageId
        : typeof payload.client_message_id === "string"
          ? payload.client_message_id
          : "",
    userId: normalizeIncomingUserId(payload),
    username: normalizedUsername,
    nickname: normalizedNickname,
    conversationId: normalizeIncomingConversationId(payload),
    messageType: normalizeIncomingMessageType(payload),
    text: getIncomingText(payload),
    timestamp: normalizeIncomingTimestamp(payload),
    isSelf: Boolean(currentNickname && normalizedNickname === currentNickname),
    status: payload.status || "sent",
    source: "server"
  };
}

export function findPendingLocalMatch(prevMessages, incomingMessage) {
  const exactIdMatch = [...prevMessages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => {
      if (!message.isSelf || message.source !== "local") return false;
      if (!message.clientMessageId || !incomingMessage.clientMessageId) return false;
      return message.clientMessageId === incomingMessage.clientMessageId;
    })?.index;

  if (exactIdMatch != null) return exactIdMatch;

  return [...prevMessages]
    .map((message, index) => ({ message, index }))
    .reverse()
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
  if (!incomingMessage.isSelf) {
    return [...prevMessages, incomingMessage];
  }
  const matchIndex = findPendingLocalMatch(prevMessages, incomingMessage);
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
    const groupedWithPrev = Boolean(prev && prev.nickname === message.nickname && diffMinutes <= 2);
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

export function deleteSessionCookie() {
  deleteCookie("session_id");
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
  if (!nickname) return "请输入昵称";
  if (hasInvalidControlCharacter(nickname)) return "昵称包含无效字符";
  if (getUtf8ByteLength(nickname) > 32) return "昵称不能超过 32 字节";
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
    if (responseText === "invalid_username") return { field: "nickname", message: "昵称不合法", networkError: "" };
    if (responseText === "invalid_password") return { field: "password", message: "密码不合法", networkError: "" };
    if (responseText === "invalid_encode") return { field: null, message: "", networkError: "请求格式异常，请重试" };
    if (responseText === "missing username or password") return { field: null, message: "", networkError: "请完整填写昵称和密码" };
    return { field: null, message: "", networkError: "输入格式不正确，请检查后重试" };
  }
  if (mode === "login" && response.status === 401) {
    return { field: "password", message: "昵称或密码错误", networkError: "" };
  }
  if (mode === "register" && response.status === 409) {
    return { field: "nickname", message: "昵称已被占用", networkError: "" };
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

export function normalizeAuthPayload(data, fallbackNickname = "") {
  const nickname = normalizeAuthNickname(data) || String(fallbackNickname || "").trim();
  return {
    ...(data && typeof data === "object" ? data : {}),
    nickname,
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

async function fetchAuthRooms() {
  try {
    const res = await fetch("/rooms", {
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

async function attachRoomsToSession(session) {
  const roomResult = await fetchAuthRooms();
  if (!roomResult.ok) return session;

  const roomsSession = normalizeAuthPayload(roomResult.data, session.nickname);
  return {
    ...session,
    ...(roomResult.data && typeof roomResult.data === "object" ? roomResult.data : {}),
    nickname: roomsSession.nickname || session.nickname,
    conversations: roomsSession.conversations.length
      ? roomsSession.conversations
      : session.conversations
  };
}

export async function readAuthSuccess(response, fallbackNickname = "") {
  const data = await readJsonOrEmpty(response);
  return attachRoomsToSession(normalizeAuthPayload(data, fallbackNickname));
}

export async function fetchCurrentUser() {
  if (!hasSessionCookie()) {
    return { ok: false, status: 0, data: null };
  }
  const res = await fetch("/me", {
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
}

export function buildAuthBody(nickname, password) {
  const body = new URLSearchParams();
  body.append("username", nickname);
  body.append("password", password);
  return body.toString();
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
