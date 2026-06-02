import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CHAT_URL, CHAT_RUNTIME_MODULES, DEFAULT_CONVERSATION_ID, EASE,
  MESSAGE_CONTENT_MAX_LENGTH, NORMAL_SEND_FLIGHT,
  PERSONAL_ROOM_ID, PUBLIC_ROOM_ID, PUBLIC_CONVERSATION_ID
} from "./constants.js";
import {
  createId, deleteSessionCookie, fetchCurrentUser,
  getApiErrorMessage,
  getConversationIdCookie, getCookieValue,
  loadSessionRooms, deleteConversation, createConversation,
  fetchAvailableAis, fetchThinkingAdapters, fetchRoomAiMembers, fetchConversationAiMembers,
  syncConversationAiMembers, syncRoomAiMembers,
  setCookieValue, prepareImageAttachment, buildImageMarkdown,
  normalizeAuthPayload, getModelDisplayName, updateCurrentUserProfile
} from "./utils.js";
import useWebSocket from "./useWebSocket.js";
import { LoadingStage } from "./auth/shell/AuthPrimitives.jsx";
import AuthShell from "./auth/AuthShell.jsx";

const NORMAL_LOGIN_RITUAL = {
  panelCloseMs: 170, totalMs: 1520,
  authExit: {
    card: { delay: 0.02, duration: 0.36, y: 8 },
    atmosphere: { delay: 0.16, duration: 0.32, y: 4 },
    chrome: { delay: 0.28, duration: 0.28, y: 4 },
    footer: { delay: 0.38, duration: 0.24, y: 6 }
  },
  chatEnter: {
    sidebar: { delay: 0.34, duration: 0.36, x: -18 },
    header: { delay: 0.5, duration: 0.3, y: -10 },
    composer: { delay: 0.62, duration: 0.3, y: 12 },
    messages: { delay: 0.86, duration: 0.24 }
  }
};
const REDUCED_LOGIN_RITUAL = {
  panelCloseMs: 16, totalMs: 360,
  authExit: {
    card: { delay: 0, duration: 0.12, y: 0 },
    atmosphere: { delay: 0.04, duration: 0.12, y: 0 },
    chrome: { delay: 0.08, duration: 0.12, y: 0 },
    footer: { delay: 0.12, duration: 0.1, y: 0 }
  },
  chatEnter: {
    sidebar: { delay: 0.08, duration: 0.1, x: 0 },
    header: { delay: 0.14, duration: 0.1, y: 0 },
    composer: { delay: 0.2, duration: 0.1, y: 0 },
    messages: { delay: 0.26, duration: 0.1 }
  }
};
const NORMAL_LOGOUT_RITUAL = {
  totalMs: 980,
  authEnter: {
    card: { delay: 0.08, duration: 0.34, y: 0 },
    atmosphere: { delay: 0.18, duration: 0.3, y: 0 },
    chrome: { delay: 0.28, duration: 0.26, y: 8 },
    footer: { delay: 0.38, duration: 0.24, y: 10 }
  },
  chatExit: {
    sidebar: { delay: 0.02, duration: 0.26, x: -12 },
    header: { delay: 0.08, duration: 0.24, y: -6 },
    composer: { delay: 0.12, duration: 0.24, y: 10 },
    messages: { delay: 0.18, duration: 0.24 }
  }
};
const REDUCED_LOGOUT_RITUAL = {
  totalMs: 320,
  authEnter: {
    card: { delay: 0.03, duration: 0.1, y: 0 },
    atmosphere: { delay: 0.08, duration: 0.09, y: 0 },
    chrome: { delay: 0.13, duration: 0.08, y: 0 },
    footer: { delay: 0.18, duration: 0.08, y: 0 }
  },
  chatExit: {
    sidebar: { delay: 0, duration: 0.1, x: 0 },
    header: { delay: 0.03, duration: 0.09, y: 0 },
    composer: { delay: 0.06, duration: 0.09, y: 0 },
    messages: { delay: 0.1, duration: 0.08 }
  }
};
const SEND_FLIGHT_COOLDOWN_MS = 260;
const MESSAGE_FLIGHT_TARGET_RETRY_FRAMES = 3;
const CHAT_VIEW_STORAGE_KEY = "atrium.chat.view";
const DRAFT_CONVERSATION_HISTORY_FLAG = "atriumDraftConversation";
const DEVTOOLS_QUERY_KEY = "devtools";
const DESIGN_LAB_QUERY_VALUE = "design-lab";

function readStoredChatView() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHAT_VIEW_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredChatView(nextView) {
  try {
    window.localStorage.setItem(CHAT_VIEW_STORAGE_KEY, JSON.stringify(nextView));
  } catch {
    // Local storage can be unavailable in private or restricted browser modes.
  }
}

function clearStoredChatView() {
  try {
    window.localStorage.removeItem(CHAT_VIEW_STORAGE_KEY);
  } catch {
    // Ignore storage cleanup failures; auth cookies still define server session state.
  }
}

function getCharacterLength(value) {
  return Array.from(value).length;
}

function normalizeConversationId(value) {
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}
function normalizeOptionalId(value) {
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}
function normalizeOptionalCount(value) {
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue >= 0 ? numericValue : null;
}
function normalizeTimestampMs(value) {
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
function normalizeConversationRecord(conversation) {
  const id = normalizeConversationId(conversation?.id ?? conversation?.conversation_id ?? conversation?.conversationId);
  const name = typeof conversation?.title === "string" && conversation.title.trim()
    ? conversation.title.trim()
    : typeof conversation?.name === "string" && conversation.name.trim()
      ? conversation.name.trim()
      : "";
  const createdBy = normalizeOptionalId(
    conversation?.created_by ??
    conversation?.createdBy ??
    conversation?.creator_id ??
    conversation?.creatorId ??
    conversation?.owner_id ??
    conversation?.ownerId
  );
  const isMain = conversation?.is_main === true || conversation?.isMain === true || Number(conversation?.is_main ?? conversation?.isMain) === 1;
  const createdAtMs = normalizeTimestampMs(conversation?.created_at_ms ?? conversation?.createdAtMs ?? conversation?.created_at ?? conversation?.createdAt);
  const updatedAtMs = normalizeTimestampMs(conversation?.updated_at_ms ?? conversation?.updatedAtMs ?? conversation?.updated_at ?? conversation?.updatedAt);
  const lastMessageAtMs = normalizeTimestampMs(
    conversation?.last_message_at_ms ??
    conversation?.lastMessageAtMs ??
    conversation?.last_message_at ??
    conversation?.lastMessageAt ??
    conversation?.last_message?.created_at_ms ??
    conversation?.lastMessage?.createdAtMs ??
    conversation?.last_message?.created_at ??
    conversation?.lastMessage?.createdAt
  );
  const lastActivityAtMs = normalizeTimestampMs(
    conversation?.last_activity_at_ms ??
    conversation?.lastActivityAtMs ??
    conversation?.last_activity_at ??
    conversation?.lastActivityAt
  ) || lastMessageAtMs || updatedAtMs || createdAtMs;
  const lastMessagePreview = normalizePreviewText(
    conversation?.last_message_preview ??
    conversation?.lastMessagePreview ??
    conversation?.last_message ??
    conversation?.lastMessage ??
    conversation?.preview
  );
  const unreadCount = normalizeOptionalCount(conversation?.unread_count ?? conversation?.unreadCount);
  return { id, name, createdBy, isMain, createdAtMs, updatedAtMs, lastActivityAtMs, lastMessagePreview, unreadCount };
}
function persistPersonalConversationId(conversationId) {
  const normalizedId = normalizeConversationId(conversationId);
  if (normalizedId) setCookieValue("personal_conversation_id", normalizedId);
  return normalizedId || DEFAULT_CONVERSATION_ID;
}
function getPersonalConversationId() {
  const cookieValue = normalizeConversationId(getConversationIdCookie());
  const storedValue = normalizeConversationId(getCookieValue("personal_conversation_id"));
  return persistPersonalConversationId(storedValue || cookieValue || DEFAULT_CONVERSATION_ID);
}

function normalizeRoomRecord(room) {
  const roomId = normalizeConversationId(room?.roomId ?? room?.room_id ?? room?.id);
  const conversations = Array.isArray(room?.conversations)
    ? room.conversations
        .map(normalizeConversationRecord)
        .filter((conversation) => conversation.id)
    : [];
  const mainConversationId =
    normalizeConversationId(room?.mainConversationId ?? room?.main_conversation_id) ||
    conversations.find((conversation) => conversation.isMain)?.id ||
    conversations[0]?.id ||
    normalizeConversationId(room?.conversationId ?? room?.conversation_id);
  const name = typeof room?.name === "string" && room.name.trim() ? room.name.trim() : "";
  const type = typeof room?.type === "number" ? room.type : 2;
  const memberCount = normalizeOptionalCount(room?.memberCount ?? room?.member_count ?? room?.membersCount ?? room?.members_count);
  return { roomId, name, mainConversationId, conversations, type, memberCount };
}

function getRoomConversationId(record, fallbackConversationId = DEFAULT_CONVERSATION_ID) {
  return normalizeConversationId(record?.mainConversationId) ||
    normalizeConversationId(record?.conversations?.[0]?.id) ||
    normalizeConversationId(fallbackConversationId) ||
    DEFAULT_CONVERSATION_ID;
}

function createPersonalRoom(record, fallbackConversationId = DEFAULT_CONVERSATION_ID) {
  const conversationId = getRoomConversationId(record, fallbackConversationId);
  return {
    id: PERSONAL_ROOM_ID,
    roomId: normalizeConversationId(record?.roomId),
    name: record?.name || "我的讨论室",
    note: "个人研究空间",
    description: "适合整理问题、材料和初步判断，也为个人 + 多 AI 讨论预留位置。",
    placeLabel: "个人空间",
    atmosphere: "把问题、材料和初步判断放在同一条思考线上，再让 AI 接入讨论。",
    cues: ["个人研究", "DeepSeek", "笔记沉淀"],
    emptyTitle: "建立一个清晰问题",
    emptyHint: "写下研究对象、待拆问题或初步观点，让个人空间成为稳定的思考记录。",
    composerPlaceholder: "写下问题、论点或材料...",
    tone: "personal",
    conversations: record?.conversations || [],
    mainConversationId: normalizeConversationId(record?.mainConversationId) || conversationId,
    conversationId,
    memberCount: record?.memberCount,
    type: 1,
    isAvailable: true
  };
}
function createPublicRoom(record, fallbackConversationId = PUBLIC_CONVERSATION_ID) {
  const conversationId = getRoomConversationId(record, fallbackConversationId);
  return {
    id: PUBLIC_ROOM_ID,
    roomId: normalizeConversationId(record?.roomId) || 1,
    name: record?.name || "Atrium 大厅",
    note: "团队共享讨论",
    description: "让多人和 AI 在同一条讨论线上推进问题，并把结论沉淀下来。",
    placeLabel: "公共大厅",
    atmosphere: "把问题公开出来，让人、DeepSeek 和未来更多 AI 在同一个上下文里形成判断。",
    cues: ["团队讨论", "DeepSeek", "共享笔记"],
    emptyTitle: "开启一场可沉淀的讨论",
    emptyHint: "提出一个问题、观点或材料，让大厅成为多人和 AI 共同推进的工作台。",
    composerPlaceholder: "向大厅提出问题或观点...",
    tone: "public",
    conversations: record?.conversations || [],
    mainConversationId: normalizeConversationId(record?.mainConversationId) || conversationId,
    conversationId,
    memberCount: record?.memberCount,
    type: 0,
    isAvailable: true
  };
}
function createGenericRoom(record, index) {
  const roomId = normalizeConversationId(record?.roomId);
  const name = record?.name || `讨论室 ${roomId}`;
  return {
    id: `room-${roomId}`,
    roomId,
    name,
    note: "讨论室",
    description: `${name} 的实时讨论空间。`,
    placeLabel: "讨论室",
    atmosphere: "把话题、证据和判断放进同一个房间，让讨论沿着一条线继续。",
    cues: ["持续讨论", "AI 模型", "知识沉淀"],
    emptyTitle: "建立新的讨论线",
    emptyHint: "发起第一段问题或材料，让这个房间开始形成可追踪的上下文。",
    composerPlaceholder: `在${name}写下问题或消息...`,
    tone: index % 2 === 0 ? "personal" : "public",
    conversations: record?.conversations || [],
    mainConversationId: normalizeConversationId(record?.mainConversationId) || getRoomConversationId(record),
    conversationId: getRoomConversationId(record),
    memberCount: record?.memberCount,
    type: 2,
    isAvailable: true
  };
}
function createFallbackRoomList(personalConversationId) {
  const personalId = normalizeConversationId(personalConversationId) || DEFAULT_CONVERSATION_ID;
  return [
    createPersonalRoom({ roomId: 0, name: "我的讨论室", mainConversationId: personalId }, personalId),
    createPublicRoom({ roomId: 1, name: "Atrium 大厅", mainConversationId: PUBLIC_CONVERSATION_ID }, PUBLIC_CONVERSATION_ID)
  ];
}

function getAiMemberDisplayName(member) {
  return getModelDisplayName(member, member?.provider || (member?.aiId ? `AI ${member.aiId}` : "AI"));
}

function getAiTeamLabel(members = []) {
  const normalizedMembers = Array.isArray(members) ? members.filter((member) => member?.aiId) : [];
  if (!normalizedMembers.length) return "";
  const firstName = getAiMemberDisplayName(normalizedMembers[0]);
  return normalizedMembers.length === 1 ? firstName : `${firstName} + ${normalizedMembers.length - 1} 位 AI`;
}

function createRoomList(roomRecords, personalConversationId) {
  const records = Array.isArray(roomRecords)
    ? roomRecords
        .map(normalizeRoomRecord)
        .filter((room) => room.roomId && room.mainConversationId)
    : [];
  if (!records.length) return createFallbackRoomList(personalConversationId);

  const personalRecord = records.find((room) => room.type === 1);
  const atriumRecord = records.find((room) => room.type === 0);
  const usedIds = new Set();
  const rooms = [];

  if (personalRecord) {
    rooms.push(createPersonalRoom(personalRecord, personalConversationId));
    usedIds.add(personalRecord.roomId);
  }
  if (atriumRecord) {
    rooms.push(createPublicRoom(atriumRecord, PUBLIC_CONVERSATION_ID));
    usedIds.add(atriumRecord.roomId);
  }

  records
    .filter((room) => !usedIds.has(room.roomId))
    .forEach((room, index) => {
      rooms.push(createGenericRoom(room, index));
    });

  return rooms.length ? rooms : createFallbackRoomList(personalConversationId);
}
function getDefaultActiveRoomId(rooms) {
  return rooms.find((room) => room.id === PERSONAL_ROOM_ID)?.id || rooms[0]?.id || PERSONAL_ROOM_ID;
}
function getPersonalConversationIdFromRooms(rooms) {
  return rooms.find((room) => room.id === PERSONAL_ROOM_ID)?.conversationId || rooms[0]?.conversationId || DEFAULT_CONVERSATION_ID;
}
function getRoomConversationIds(room) {
  return new Set([
    room?.conversationId,
    room?.mainConversationId,
    ...(room?.conversations || []).map((conversation) => conversation.id)
  ].map((value) => normalizeConversationId(value)).filter(Boolean));
}
function getAiMemberId(member) {
  return normalizeOptionalId(member?.aiId ?? member?.ai_id ?? member?.id);
}
function mergeAiTeamMembers(primaryMembers = [], fallbackMembers = []) {
  const seen = new Set();
  const merged = [];
  [...primaryMembers, ...fallbackMembers].forEach((member) => {
    const aiId = getAiMemberId(member);
    if (!aiId || seen.has(aiId)) return;
    seen.add(aiId);
    merged.push({ ...member, aiId, id: aiId });
  });
  return merged;
}
function isMainConversation(room, conversationId) {
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (!room || !normalizedConversationId) return true;
  const mainConversationId = normalizeConversationId(room.mainConversationId || room.conversationId);
  return !mainConversationId || normalizedConversationId === mainConversationId;
}
function resolveStoredChatView(rooms) {
  const availableRooms = rooms.filter((room) => room?.isAvailable);
  const preferredRoom = availableRooms.find((room) => room.id === PERSONAL_ROOM_ID) || availableRooms[0] || rooms[0];
  const storedView = readStoredChatView();
  const storedActiveRoomId = typeof storedView.activeRoomId === "string" ? storedView.activeRoomId.trim() : "";
  const storedBackendRoomId = normalizeConversationId(
    storedView.backendRoomId ??
    storedView.room_id ??
    storedView.roomId ??
    getCookieValue("room_id")
  );
  const storedConversationId = normalizeConversationId(
    storedView.conversationId ??
    storedView.conversation_id ??
    getCookieValue("conversation_id")
  );
  const roomFromStoredId = storedActiveRoomId
    ? availableRooms.find((room) => room.id === storedActiveRoomId)
    : null;
  const roomFromBackendId = storedBackendRoomId
    ? availableRooms.find((room) => room.roomId === storedBackendRoomId)
    : null;
  const roomFromConversation = storedConversationId
    ? availableRooms.find((room) => getRoomConversationIds(room).has(storedConversationId))
    : null;
  const activeRoom = roomFromStoredId || roomFromBackendId || roomFromConversation || preferredRoom;
  const activeRoomId = activeRoom?.id || PERSONAL_ROOM_ID;
  const roomConversationIds = getRoomConversationIds(activeRoom);
  const conversationId = storedConversationId && roomConversationIds.has(storedConversationId)
    ? storedConversationId
    : activeRoom?.conversationId || DEFAULT_CONVERSATION_ID;
  return {
    activeRoomId,
    conversationId,
    conversationOverride: conversationId !== activeRoom?.conversationId ? { roomId: activeRoomId, conversationId } : null
  };
}
function syncRoomCookies(rooms, activeRoomId) {
  const personalRoom = rooms.find((room) => room.id === PERSONAL_ROOM_ID);
  const publicRoom = rooms.find((room) => room.id === PUBLIC_ROOM_ID);
  const activeRoom = rooms.find((room) => room.id === activeRoomId) || personalRoom || rooms[0];
  if (personalRoom?.conversationId) setCookieValue("personal_conversation_id", personalRoom.conversationId);
  if (publicRoom?.conversationId) setCookieValue("public_conversation_id", publicRoom.conversationId);
  if (activeRoom?.roomId) setCookieValue("room_id", activeRoom.roomId);
  if (activeRoom?.conversationId) setCookieValue("conversation_id", activeRoom.conversationId);
}
function syncActiveChatCookies(rooms, activeRoomId, conversationId) {
  syncRoomCookies(rooms, activeRoomId);
  const activeRoom = rooms.find((room) => room.id === activeRoomId) || rooms[0];
  const normalizedConversationId = normalizeConversationId(conversationId);
  if (activeRoom?.roomId) setCookieValue("room_id", activeRoom.roomId);
  if (normalizedConversationId) setCookieValue("conversation_id", normalizedConversationId);
}
function getAuthRoute(pathname = window.location.pathname) {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  if (normalizedPath === "/chat") return { mode: "login", isPanelOpen: true, path: "/chat" };
  if (normalizedPath === "/register") return { mode: "register", isPanelOpen: true, path: "/register" };
  if (normalizedPath === "/login") return { mode: "login", isPanelOpen: true, path: "/login" };
  return { mode: "login", isPanelOpen: false, path: "/" };
}

function isDesignLabRoute() {
  return new URLSearchParams(window.location.search).get(DEVTOOLS_QUERY_KEY) === DESIGN_LAB_QUERY_VALUE;
}

function readSessionUsername(session) {
  return typeof session?.username === "string" ? session.username.trim() : "";
}

function readSessionAvatarUrl(session) {
  if (typeof session?.avatarUrl === "string" && session.avatarUrl.trim()) return session.avatarUrl.trim();
  if (typeof session?.avatar_url === "string" && session.avatar_url.trim()) return session.avatar_url.trim();
  return "";
}

export default function App() {
  const launchTimerRef = useRef(null);
  const launchFrameRef = useRef(null);
  const focusFrameRef = useRef(null);
  const authPanelCloseTimerRef = useRef(null);
  const ritualTimerRef = useRef(null);
  const chatRuntimePromiseRef = useRef(null);
  const ChatRoomComponentRef = useRef(null);
  const designLabPromiseRef = useRef(null);
  const DesignLabComponentRef = useRef(null);
  const lastSendFlightAtRef = useRef(0);
  const composerFieldRef = useRef(null);
  const chatMessagesViewportRef = useRef(null);
  const roomSwitchTimerRef = useRef(null);
  const sendingRef = useRef(false);

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
  const loginRitualConfig = prefersReducedMotion ? REDUCED_LOGIN_RITUAL : NORMAL_LOGIN_RITUAL;
  const logoutRitualConfig = prefersReducedMotion ? REDUCED_LOGOUT_RITUAL : NORMAL_LOGOUT_RITUAL;

  const [appStage, setAppStage] = useState("loading");
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const [authedNickname, setAuthedNickname] = useState("");
  const [authedUsername, setAuthedUsername] = useState("");
  const [authedAvatarUrl, setAuthedAvatarUrl] = useState("");
  const [authedUserId, setAuthedUserId] = useState("");
  const [authHandoffPending, setAuthHandoffPending] = useState(false);
  const [wsEnabled, setWsEnabled] = useState(false);
  const [localSystemMessages, setLocalSystemMessages] = useState([]);
  const [personalConversationId, setPersonalConversationId] = useState(() => getPersonalConversationId());
  const [roomRecords, setRoomRecords] = useState([]);
  const [activeRoomId, setActiveRoomId] = useState(PERSONAL_ROOM_ID);
  const [conversationOverride, setConversationOverride] = useState(null);
  const [thinkingAdapters, setThinkingAdapters] = useState([]);
  const [availableAis, setAvailableAis] = useState([]);
  const [roomAiMembers, setRoomAiMembers] = useState({});
  const [conversationAiMembers, setConversationAiMembers] = useState({});
  const [aiConfigError, setAiConfigError] = useState({});
  const [messageDraft, setMessageDraft] = useState("");
  const [draftAttachment, setDraftAttachment] = useState(null);
  const [composerError, setComposerError] = useState("");
  const [isHeaderScrolled, setHeaderScrolled] = useState(false);
  const [messageFlight, setMessageFlight] = useState(null);
  const [hiddenMessageId, setHiddenMessageId] = useState(null);
  const [sceneTransition, setSceneTransition] = useState(null);
  const [roomTransition, setRoomTransition] = useState(null);
  const [draftConversation, setDraftConversation] = useState(null);
  const [isChatRuntimeReady, setChatRuntimeReady] = useState(false);
  const [ChatRoomComponent, setChatRoomComponent] = useState(null);
  const [isDesignLabOpen, setDesignLabOpen] = useState(() => isDesignLabRoute());
  const [designLabLoading, setDesignLabLoading] = useState(false);
  const [designLabError, setDesignLabError] = useState("");
  const [DesignLabComponent, setDesignLabComponent] = useState(null);

  async function ensureChatRuntimeLoaded() {
    if (ChatRoomComponentRef.current) return ChatRoomComponentRef.current;
    if (chatRuntimePromiseRef.current) return chatRuntimePromiseRef.current;
    const promise = (async () => {
      await CHAT_RUNTIME_MODULES();
      const mod = await import("./chat/ChatRoom.jsx");
      ChatRoomComponentRef.current = mod.default;
      setChatRoomComponent(() => mod.default);
      setChatRuntimeReady(true);
      return mod.default;
    })().finally(() => {
      chatRuntimePromiseRef.current = null;
    });
    chatRuntimePromiseRef.current = promise;
    return promise;
  }

  async function ensureDesignLabLoaded() {
    if (DesignLabComponentRef.current) return DesignLabComponentRef.current;
    if (designLabPromiseRef.current) return designLabPromiseRef.current;
    setDesignLabLoading(true);
    setDesignLabError("");
    const promise = import("./devtools/DesignLab.jsx")
      .then((mod) => {
        DesignLabComponentRef.current = mod.default;
        setDesignLabComponent(() => mod.default);
        return mod.default;
      })
      .catch((error) => {
        console.warn("Failed to load Design Lab:", error);
        setDesignLabError("开发者界面加载失败");
        throw error;
      })
      .finally(() => {
        designLabPromiseRef.current = null;
        setDesignLabLoading(false);
      });
    designLabPromiseRef.current = promise;
    return promise;
  }

  const rooms = createRoomList(roomRecords, personalConversationId);
  const personalRoom = rooms[0];
  const activeRoom = rooms.find((r) => r.id === activeRoomId && r.isAvailable) || personalRoom;
  const activeConversationId =
    (conversationOverride && conversationOverride.roomId === activeRoom.id ? conversationOverride.conversationId : null) ||
    activeRoom.conversationId || personalRoom.conversationId;
  const activeRoomConversations = activeRoom.conversations || [];
  const activeBackendRoomId = activeRoom.roomId || personalRoom.roomId || 0;
  const activeConversation = activeRoomConversations.find((item) => item.id === activeConversationId) || null;
  const activeConversationIsMain = isMainConversation(activeRoom, activeConversationId);
  const isHomeDashboardActive = activeRoom?.id === PERSONAL_ROOM_ID && activeConversationIsMain;
  const activeRoomAiMembers = roomAiMembers[activeBackendRoomId] || [];
  const hasKnownConversationAiMembers = Object.prototype.hasOwnProperty.call(conversationAiMembers, activeConversationId);
  const activeConversationAiMembers = !activeConversationIsMain && hasKnownConversationAiMembers ? conversationAiMembers[activeConversationId] : [];
  const activeEffectiveAiMembers = activeConversationIsMain
    ? activeRoomAiMembers
    : mergeAiTeamMembers(activeConversationAiMembers, activeRoomAiMembers);
  const activeConversationModelLabel = getAiTeamLabel(activeEffectiveAiMembers);
  const isConversationModelLoading = Boolean(authedNickname && activeConversationId && !activeConversationIsMain && !hasKnownConversationAiMembers);
  const assistantExpected = activeEffectiveAiMembers.length > 0;
  const roomAiPrefetchKey = rooms.map((room) => room.roomId).filter(Boolean).join(",");
  const shouldKeepSocketEnabled =
    Boolean(authedNickname) && (sceneTransition?.kind === "login" || sceneTransition?.kind === "logout" || (appStage === "chat" && sceneTransition?.kind !== "logout"));

  const {
    messages, connectionState, assistantState, historyState, historyHasMore, historyError,
    loadOlderMessages, sendChatMessage, deleteChatMessage
  } = useWebSocket({
    url: CHAT_URL,
    nickname: authedNickname,
    userId: authedUserId,
    roomId: activeBackendRoomId,
    conversationId: activeConversationId,
    assistantModelLabel: activeConversationModelLabel,
    assistantExpected,
    enabled: shouldKeepSocketEnabled && wsEnabled,
    onAuthFailed: () => {
      clearRitualTimers(); setSceneTransition(null); deleteSessionCookie();
      clearAuthIdentity(); setWsEnabled(false); setAuthHandoffPending(false);
      setLocalSystemMessages([]); setPersonalConversationId(DEFAULT_CONVERSATION_ID);
      setRoomRecords([]);
      setRoomAiMembers({});
      setConversationAiMembers({});
      setAvailableAis([]);
      setThinkingAdapters([]);
      setAiConfigError({});
      setActiveRoomId(PERSONAL_ROOM_ID);
      setConversationOverride(null);
      clearStoredChatView();
      clearRoomTransition();
      syncAuthRoute("login", true, { replace: true });
      setMessageDraft(""); setDraftAttachment(null); setComposerError(""); setMessageFlight(null); setHiddenMessageId(null);
    }
  });

  useEffect(() => {
    if (!authedNickname || !activeRoom?.id || !activeConversationId) return;
    writeStoredChatView({
      activeRoomId: activeRoom.id,
      backendRoomId: activeBackendRoomId,
      conversationId: activeConversationId
    });
  }, [authedNickname, activeRoom?.id, activeBackendRoomId, activeConversationId]);

  function clearComposer() {
    setMessageDraft("");
    setDraftAttachment(null);
    setComposerError("");
  }

  function pushDraftConversationHistory() {
    try {
      if (window.history.state?.[DRAFT_CONVERSATION_HISTORY_FLAG]) return;
      window.history.pushState({
        ...(window.history.state || {}),
        path: "/chat",
        [DRAFT_CONVERSATION_HISTORY_FLAG]: true
      }, "", "/chat");
    } catch {
      // Browser history is an enhancement; the in-page back control still works.
    }
  }

  function setDesignLabRoute(isOpen, { replace = false } = {}) {
    const url = new URL(window.location.href);
    if (isOpen) {
      url.searchParams.set(DEVTOOLS_QUERY_KEY, DESIGN_LAB_QUERY_VALUE);
    } else {
      url.searchParams.delete(DEVTOOLS_QUERY_KEY);
    }
    const nextUrl = `${url.pathname}${url.search}${url.hash}`;
    const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (nextUrl !== currentUrl) {
      const method = replace ? "replaceState" : "pushState";
      window.history[method]({
        ...(window.history.state || {}),
        path: url.pathname,
        devtools: isOpen ? DESIGN_LAB_QUERY_VALUE : null
      }, "", nextUrl);
    }
    setDesignLabOpen(isOpen);
    if (isOpen) {
      ensureDesignLabLoaded().catch(() => {});
    }
  }

  function openDesignLab() {
    setDesignLabRoute(true);
  }

  function closeDesignLab() {
    setDesignLabRoute(false, { replace: true });
  }

  function closeDraftConversation() {
    setDraftConversation(null);
    clearComposer();
    setMessageFlight(null);
    setHiddenMessageId(null);
    setHeaderScrolled(false);
  }

  function handleCancelConversationDraft() {
    if (window.history.state?.[DRAFT_CONVERSATION_HISTORY_FLAG]) {
      window.history.back();
      return;
    }
    closeDraftConversation();
  }

  function clearAuthIdentity() {
    setAuthedNickname("");
    setAuthedUsername("");
    setAuthedAvatarUrl("");
    setAuthedUserId("");
  }

  function commitAuthIdentity(session) {
    const resolvedNickname = String(session?.nickname || "").trim();
    const resolvedUsername = readSessionUsername(session) || resolvedNickname;
    setAuthedNickname(resolvedNickname);
    setAuthedUsername(resolvedUsername);
    setAuthedAvatarUrl(readSessionAvatarUrl(session));
    setAuthedUserId(session?.userId || "");
    return { nickname: resolvedNickname, username: resolvedUsername };
  }

  function clearRitualTimers() {
    window.clearTimeout(authPanelCloseTimerRef.current);
    window.clearTimeout(ritualTimerRef.current);
    authPanelCloseTimerRef.current = null; ritualTimerRef.current = null;
    if (focusFrameRef.current != null) { window.cancelAnimationFrame(focusFrameRef.current); focusFrameRef.current = null; }
  }
  function clearRoomTransition() {
    window.clearTimeout(roomSwitchTimerRef.current);
    roomSwitchTimerRef.current = null;
    setRoomTransition(null);
  }
  function beginRoomTransition(nextTransition) {
    window.clearTimeout(roomSwitchTimerRef.current);
    setRoomTransition({
      id: createId("room-transition"),
      ...nextTransition
    });
    roomSwitchTimerRef.current = window.setTimeout(() => setRoomTransition(null), 620);
  }
  function focusComposerAfterRitual() {
    if (focusFrameRef.current != null) window.cancelAnimationFrame(focusFrameRef.current);
    focusFrameRef.current = window.requestAnimationFrame(() => {
      focusFrameRef.current = window.requestAnimationFrame(() => {
        const textarea = composerFieldRef.current?.querySelector("textarea");
        textarea?.focus({ preventScroll: true });
        focusFrameRef.current = null;
      });
    });
  }
  function installWelcomeMessage(nickname) {
    const resolved = nickname.trim();
    if (!resolved) return;
    setLocalSystemMessages((current) => {
      if (current.some((m) => m.source === "local-welcome")) return current;
      return [{ id: createId("welcome"), nickname: "__system__", text: `${resolved} 加入了我的讨论室`, timestamp: Date.now(), isSelf: false, status: "sent", source: "local-welcome", roomId: PERSONAL_ROOM_ID }];
    });
  }
  function syncAuthRoute(mode, isPanelVisible, { replace = false } = {}) {
    const resolvedMode = mode === "register" ? "register" : "login";
    const panelVisible = Boolean(isPanelVisible);
    const nextPath = panelVisible ? `/${resolvedMode}` : "/";
    setAppStage(resolvedMode); setAuthPanelOpen(panelVisible);
    if (window.location.pathname !== nextPath) {
      const method = replace ? "replaceState" : "pushState";
      window.history[method]({ path: nextPath }, "", nextPath);
    }
  }
  function applyAuthSession(authData) {
    const session = normalizeAuthPayload(authData);
    const nextRoomRecords = Array.isArray(session.rooms) && session.rooms.length
      ? session.rooms
      : Array.isArray(session.conversations)
        ? session.conversations.map((conversation) => ({
          roomId: normalizeConversationId(conversation.id),
          name: conversation.name,
          mainConversationId: normalizeConversationId(conversation.id),
          conversations: [conversation]
        }))
        : [];
    const nextRooms = createRoomList(nextRoomRecords, getPersonalConversationId());
    const restoredView = resolveStoredChatView(nextRooms);
    const nextPersonalId = getPersonalConversationIdFromRooms(nextRooms);
    setRoomRecords(nextRoomRecords);
    setRoomAiMembers({});
    setConversationAiMembers({});
    setAiConfigError({});
    setPersonalConversationId(nextPersonalId);
    setActiveRoomId(restoredView.activeRoomId);
    setConversationOverride(restoredView.conversationOverride);
    syncActiveChatCookies(nextRooms, restoredView.activeRoomId, restoredView.conversationId);
    return { session, rooms: nextRooms, activeRoomId: restoredView.activeRoomId, personalId: nextPersonalId };
  }

  async function refreshRooms(preferredBackendRoomId = activeBackendRoomId) {
    const result = await loadSessionRooms(authedNickname);
    if (!result.ok) return null;
    const nextRoomRecords = result.rooms;
    const nextRooms = createRoomList(nextRoomRecords, personalConversationId);
    const preferredRoom =
      nextRooms.find((room) => room.roomId === preferredBackendRoomId) ||
      nextRooms.find((room) => room.id === activeRoomId && room.isAvailable) ||
      nextRooms.find((room) => room.id === PERSONAL_ROOM_ID) ||
      nextRooms[0];
    const nextActiveRoomId = preferredRoom?.id || getDefaultActiveRoomId(nextRooms);
    const currentConversationId = normalizeConversationId(
      conversationOverride && conversationOverride.roomId === nextActiveRoomId
        ? conversationOverride.conversationId
        : activeConversationId
    );
    const nextRoomConversationIds = getRoomConversationIds(preferredRoom);
    const nextConversationId = currentConversationId && nextRoomConversationIds.has(currentConversationId)
      ? currentConversationId
      : preferredRoom?.conversationId || DEFAULT_CONVERSATION_ID;
    const nextPersonalId = getPersonalConversationIdFromRooms(nextRooms);
    setRoomRecords(nextRoomRecords);
    setConversationAiMembers((current) => {
      const nextConversationIds = new Set(nextRooms.flatMap((room) => (room.conversations || []).map((conversation) => conversation.id)));
      if (activeConversationId) nextConversationIds.add(activeConversationId);
      return Object.fromEntries(Object.entries(current).filter(([id]) => nextConversationIds.has(Number(id))));
    });
    setPersonalConversationId(nextPersonalId);
    setActiveRoomId(nextActiveRoomId);
    setConversationOverride(nextConversationId !== preferredRoom?.conversationId ? { roomId: nextActiveRoomId, conversationId: nextConversationId } : null);
    syncActiveChatCookies(nextRooms, nextActiveRoomId, nextConversationId);
    return preferredRoom || null;
  }

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const result = await fetchCurrentUser();
        if (cancelled) return;
        if (result.ok && typeof result.data?.nickname === "string" && result.data.nickname.trim()) {
          const { session } = applyAuthSession(result.data);
          setAuthHandoffPending(false); setLocalSystemMessages([]);
          commitAuthIdentity(session);
          setWsEnabled(true); setAuthPanelOpen(false); setAppStage("chat");
          if (window.location.pathname !== "/chat") {
            const search = isDesignLabRoute() ? `?${DEVTOOLS_QUERY_KEY}=${DESIGN_LAB_QUERY_VALUE}` : "";
            window.history.replaceState({ path: "/chat" }, "", `/chat${search}`);
          }
          if (isDesignLabRoute()) {
            setDesignLabOpen(true);
            ensureDesignLabLoaded().catch(() => {});
          }
          ensureChatRuntimeLoaded().catch((err) => {
            console.error("Failed to load chat runtime:", err);
          });
          return;
        }
        const authRoute = getAuthRoute();
        clearAuthIdentity(); setWsEnabled(false); setAuthHandoffPending(false); setLocalSystemMessages([]);
        setRoomRecords([]); setPersonalConversationId(DEFAULT_CONVERSATION_ID); setActiveRoomId(PERSONAL_ROOM_ID);
        setRoomAiMembers({}); setConversationAiMembers({}); setThinkingAdapters([]); setAvailableAis([]); setAiConfigError({});
        setConversationOverride(null); clearStoredChatView();
        setAppStage(authRoute.mode); setAuthPanelOpen(authRoute.isPanelOpen);
        if (authRoute.path === "/chat" && window.location.pathname !== "/login") {
          window.history.replaceState({ path: "/login" }, "", "/login"); setAuthPanelOpen(true);
        }
      } catch (error) {
        if (cancelled) return;
        const authRoute = getAuthRoute();
        clearAuthIdentity(); setWsEnabled(false); setAuthHandoffPending(false); setLocalSystemMessages([]);
        setRoomRecords([]); setPersonalConversationId(DEFAULT_CONVERSATION_ID); setActiveRoomId(PERSONAL_ROOM_ID);
        setRoomAiMembers({}); setConversationAiMembers({}); setThinkingAdapters([]); setAvailableAis([]); setAiConfigError({});
        setConversationOverride(null); clearStoredChatView();
        setAppStage(authRoute.mode); setAuthPanelOpen(authRoute.isPanelOpen);
        if (authRoute.path === "/chat" && window.location.pathname !== "/login") {
          window.history.replaceState({ path: "/login" }, "", "/login"); setAuthPanelOpen(true);
        }
      }
    };
    bootstrap();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    function handlePopState() {
      const nextDesignLabOpen = isDesignLabRoute();
      setDesignLabOpen(nextDesignLabOpen);
      if (nextDesignLabOpen) ensureDesignLabLoaded().catch(() => {});
      if (authedNickname && (appStage === "chat" || sceneTransition?.kind === "login")) {
        if (draftConversation) {
          closeDraftConversation();
          if (window.location.pathname !== "/chat") window.history.replaceState({ path: "/chat" }, "", "/chat");
          return;
        }
        if (window.location.pathname !== "/chat") window.history.replaceState({ path: "/chat" }, "", "/chat");
        return;
      }
      const authRoute = getAuthRoute();
      clearRitualTimers(); setSceneTransition(null); setAuthHandoffPending(false); setLocalSystemMessages([]);
      setRoomAiMembers({}); setConversationAiMembers({}); setThinkingAdapters([]); setAvailableAis([]);
      setAiConfigError({});
      setWsEnabled(false); setAppStage(authRoute.mode); setAuthPanelOpen(authRoute.isPanelOpen);
      if (authRoute.path === "/chat" && window.location.pathname !== "/login") {
        window.history.replaceState({ path: "/login" }, "", "/login"); setAuthPanelOpen(true);
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [appStage, authedNickname, draftConversation, sceneTransition]);

  useEffect(() => {
    if (!isDesignLabOpen) return;
    ensureDesignLabLoaded().catch(() => {});
  }, [isDesignLabOpen]);

  useEffect(() => { if (shouldKeepSocketEnabled) setWsEnabled(true); else setWsEnabled(false); }, [shouldKeepSocketEnabled]);
  useEffect(() => { return () => { clearRitualTimers(); window.clearTimeout(roomSwitchTimerRef.current); window.clearTimeout(launchTimerRef.current); if (launchFrameRef.current != null) window.cancelAnimationFrame(launchFrameRef.current); if (focusFrameRef.current != null) window.cancelAnimationFrame(focusFrameRef.current); }; }, []);

  useEffect(() => { if (appStage === "chat") return; clearComposer(); setMessageFlight(null); setHiddenMessageId(null); setHeaderScrolled(false); if (focusFrameRef.current != null) { window.cancelAnimationFrame(focusFrameRef.current); focusFrameRef.current = null; } }, [appStage]);

  useEffect(() => {
    if (!authedNickname) return undefined;
    const controller = new AbortController();
    setAiConfigError((current) => ({ ...current, thinking: "", models: "" }));
    Promise.all([
      fetchThinkingAdapters(controller.signal),
      fetchAvailableAis(controller.signal)
    ])
      .then(([adapters, ais]) => {
        setThinkingAdapters(adapters);
        setAvailableAis(ais);
        setAiConfigError((current) => ({ ...current, thinking: "", models: "" }));
      })
      .catch((error) => {
        if (error?.name !== "AbortError") {
          setThinkingAdapters([]);
          setAvailableAis([]);
          setAiConfigError((current) => ({ ...current, thinking: getApiErrorMessage(error, "AI 模型目录加载失败"), models: getApiErrorMessage(error, "AI 模型目录加载失败") }));
        }
      });
    return () => controller.abort();
  }, [authedNickname]);

  useEffect(() => {
    if (!authedNickname || !activeBackendRoomId) return undefined;
    const controller = new AbortController();
    setAiConfigError((current) => ({ ...current, room: "" }));
    fetchRoomAiMembers(activeBackendRoomId, controller.signal)
      .then((members) => {
        setRoomAiMembers((current) => ({ ...current, [activeBackendRoomId]: members }));
        setAiConfigError((current) => ({ ...current, room: "" }));
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setRoomAiMembers((current) => ({ ...current, [activeBackendRoomId]: [] }));
        setAiConfigError((current) => ({ ...current, room: getApiErrorMessage(error, "房间默认 AI 加载失败") }));
      });
    return () => controller.abort();
  }, [authedNickname, activeBackendRoomId]);

  useEffect(() => {
    if (!authedNickname || !isHomeDashboardActive || !roomAiPrefetchKey) return undefined;
    const missingRoomIds = rooms
      .map((item) => item.roomId)
      .filter((roomId) => roomId && !Object.prototype.hasOwnProperty.call(roomAiMembers, roomId));
    if (!missingRoomIds.length) return undefined;

    const controller = new AbortController();
    Promise.all(
      missingRoomIds.map((roomId) =>
        fetchRoomAiMembers(roomId, controller.signal)
          .then((members) => [roomId, members])
          .catch((error) => {
            if (error?.name === "AbortError") return null;
            return [roomId, []];
          })
      )
    ).then((entries) => {
      if (controller.signal.aborted) return;
      setRoomAiMembers((current) => {
        const next = { ...current };
        entries.forEach((entry) => {
          if (!entry) return;
          const [roomId, members] = entry;
          next[roomId] = members;
        });
        return next;
      });
    });
    return () => controller.abort();
  }, [authedNickname, isHomeDashboardActive, roomAiPrefetchKey, roomAiMembers]);

  useEffect(() => {
    if (!authedNickname || !activeConversationId) return undefined;
    if (activeConversationIsMain) {
      setAiConfigError((current) => ({ ...current, conversation: "" }));
      return undefined;
    }
    const controller = new AbortController();
    setAiConfigError((current) => ({ ...current, conversation: "" }));
    fetchConversationAiMembers(activeConversationId, controller.signal)
      .then((members) => {
        setConversationAiMembers((current) => ({ ...current, [activeConversationId]: members }));
        setAiConfigError((current) => ({ ...current, conversation: "" }));
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setConversationAiMembers((current) => ({ ...current, [activeConversationId]: [] }));
        setAiConfigError((current) => ({ ...current, conversation: getApiErrorMessage(error, "当前对话 AI 加载失败") }));
      });
    return () => controller.abort();
  }, [authedNickname, activeConversationId, activeConversationIsMain]);

  function beginLoginRitual(authData, config) {
    const { session } = applyAuthSession(authData);
    const resolved = session.nickname.trim();
    commitAuthIdentity(session); setLocalSystemMessages([]);
    clearComposer(); setMessageFlight(null); setHiddenMessageId(null); setHeaderScrolled(false);
    setWsEnabled(true); setAuthPanelOpen(false);
    setSceneTransition({ kind: "login", config });
    if (window.location.pathname !== "/chat") window.history.replaceState({ path: "/chat" }, "", "/chat");
    ritualTimerRef.current = window.setTimeout(() => {
      installWelcomeMessage(resolved);
      setAuthHandoffPending(false); setSceneTransition(null); setAppStage("chat");
      focusComposerAfterRitual();
    }, config.totalMs);
  }

  function handleAuthSuccess(authData) {
    const session = normalizeAuthPayload(authData, typeof authData === "string" ? authData : "");
    const resolved = session.nickname.trim();
    if (!resolved) return;
    clearRitualTimers(); setAuthHandoffPending(true);
    ensureChatRuntimeLoaded()
      .then(() => {
        setAuthPanelOpen(false);
        authPanelCloseTimerRef.current = window.setTimeout(() => { beginLoginRitual(session, loginRitualConfig); }, loginRitualConfig.panelCloseMs);
      })
      .catch((err) => { console.error("Failed to load chat runtime:", err); setAuthHandoffPending(false); });
  }

  function handleLogout() {
    clearRitualTimers(); deleteSessionCookie();
    setAuthHandoffPending(false); setMessageFlight(null); setHiddenMessageId(null);
    clearRoomTransition();
    setRoomRecords([]); setPersonalConversationId(DEFAULT_CONVERSATION_ID); setActiveRoomId(PERSONAL_ROOM_ID);
    setConversationOverride(null); clearStoredChatView();
    setRoomAiMembers({});
    setConversationAiMembers({});
    setAvailableAis([]);
    setThinkingAdapters([]);
    setAiConfigError({});
    setAuthPanelOpen(true);
    setSceneTransition({ kind: "logout", authMode: "login", config: logoutRitualConfig });
    if (window.location.pathname !== "/login") window.history.replaceState({ path: "/login" }, "", "/login");
    ritualTimerRef.current = window.setTimeout(() => {
      setSceneTransition(null); setWsEnabled(false); clearAuthIdentity(); setLocalSystemMessages([]);
      setRoomRecords([]); setPersonalConversationId(DEFAULT_CONVERSATION_ID); setActiveRoomId(PERSONAL_ROOM_ID);
      setConversationOverride(null); clearStoredChatView();
      setRoomAiMembers({});
      setConversationAiMembers({});
      setAvailableAis([]);
      setThinkingAdapters([]);
      setAiConfigError({});
      clearComposer(); setMessageFlight(null); setHiddenMessageId(null); setHeaderScrolled(false);
      setAppStage("login"); setAuthPanelOpen(true);
    }, logoutRitualConfig.totalMs);
  }

  async function handleProfileUpdate(changes) {
    const payload = {};
    if (Object.prototype.hasOwnProperty.call(changes, "username")) payload.username = String(changes.username || "").trim();
    if (Object.prototype.hasOwnProperty.call(changes, "nickname")) payload.nickname = String(changes.nickname || "").trim();
    if (Object.prototype.hasOwnProperty.call(changes, "avatar_url")) payload.avatar_url = String(changes.avatar_url || "").trim();
    await updateCurrentUserProfile(payload);
    const previousNickname = authedNickname;
    const previousUsername = authedUsername;
    let nextNickname = authedNickname;
    let nextUsername = authedUsername;
    let nextAvatarUrl = authedAvatarUrl;
    if (Object.prototype.hasOwnProperty.call(payload, "nickname")) {
      nextNickname = payload.nickname;
      setAuthedNickname(payload.nickname);
    }
    if (Object.prototype.hasOwnProperty.call(payload, "username")) {
      nextUsername = payload.username;
      setAuthedUsername(payload.username);
      if (!Object.prototype.hasOwnProperty.call(payload, "nickname") && previousNickname === previousUsername) {
        nextNickname = payload.username;
        setAuthedNickname(payload.username);
      }
    }
    if (Object.prototype.hasOwnProperty.call(payload, "avatar_url")) {
      nextAvatarUrl = payload.avatar_url;
      setAuthedAvatarUrl(payload.avatar_url);
    }
    return {
      nickname: nextNickname,
      username: nextUsername,
      avatarUrl: nextAvatarUrl
    };
  }

  function completeMessageFlight(messageId) {
    setHiddenMessageId((cur) => (cur === messageId ? null : cur));
    setMessageFlight((cur) => (cur && cur.id === messageId ? null : cur));
  }

  async function handleCreateConversationDraft() {
    if (!activeBackendRoomId || !activeRoom?.id) return null;
    let inheritedMembers = activeRoomAiMembers;
    try {
      if (!Object.prototype.hasOwnProperty.call(roomAiMembers, activeBackendRoomId)) {
        inheritedMembers = await fetchRoomAiMembers(activeBackendRoomId);
        setRoomAiMembers((current) => ({ ...current, [activeBackendRoomId]: inheritedMembers }));
      }
    } catch {
      inheritedMembers = [];
    }
    pushDraftConversationHistory();
    setDraftConversation({ aiMembers: inheritedMembers });
    clearComposer(); setMessageFlight(null); setHiddenMessageId(null); setHeaderScrolled(false);
    return { conversationId: 0, isDraft: true };
  }

  function handleDraftAiMembersChange(nextMembers) {
    setDraftConversation((current) => current ? { ...current, aiMembers: nextMembers } : null);
    return nextMembers;
  }

  async function handleConversationAiMembersChange(nextMembers) {
    if (!activeConversationId || activeConversationIsMain) return [];
    const previousMembers = conversationAiMembers[activeConversationId] || [];
    setConversationAiMembers((current) => ({ ...current, [activeConversationId]: nextMembers }));
    try {
      const syncedMembers = await syncConversationAiMembers(activeConversationId, nextMembers);
      setConversationAiMembers((current) => ({ ...current, [activeConversationId]: syncedMembers }));
      setAiConfigError((current) => ({ ...current, conversation: "" }));
      return syncedMembers;
    } catch (error) {
      setConversationAiMembers((current) => ({ ...current, [activeConversationId]: previousMembers }));
      setAiConfigError((current) => ({ ...current, conversation: getApiErrorMessage(error, "当前对话 AI 保存失败") }));
      throw error;
    }
  }

  async function handleRoomAiMembersSave(nextMembers) {
    if (!activeBackendRoomId) return [];
    const previousMembers = roomAiMembers[activeBackendRoomId] || [];
    setRoomAiMembers((current) => ({ ...current, [activeBackendRoomId]: nextMembers }));
    try {
      const syncedMembers = await syncRoomAiMembers(activeBackendRoomId, nextMembers);
      setRoomAiMembers((current) => ({ ...current, [activeBackendRoomId]: syncedMembers }));
      setAiConfigError((current) => ({ ...current, room: "" }));
      return syncedMembers;
    } catch (error) {
      setRoomAiMembers((current) => ({ ...current, [activeBackendRoomId]: previousMembers }));
      setAiConfigError((current) => ({ ...current, room: getApiErrorMessage(error, "房间默认 AI 保存失败") }));
      throw error;
    }
  }

  function scheduleMessageFlightTarget(messageId) {
    if (launchFrameRef.current != null) window.cancelAnimationFrame(launchFrameRef.current);
    let framesLeft = MESSAGE_FLIGHT_TARGET_RETRY_FRAMES;
    function findTargetOnNextFrame() {
      launchFrameRef.current = window.requestAnimationFrame(() => {
        const targetElement = document.querySelector(`[data-message-id="${messageId}"] .message-text-shell`);
        if (targetElement) {
          const targetRect = targetElement.getBoundingClientRect();
          setMessageFlight((cur) => cur && cur.id === messageId ? { ...cur, targetRect: { left: targetRect.left, top: targetRect.top, width: targetRect.width } } : cur);
          launchFrameRef.current = null;
          return;
        }
        framesLeft -= 1;
        if (framesLeft > 0) {
          findTargetOnNextFrame();
          return;
        }
        completeMessageFlight(messageId);
        launchFrameRef.current = null;
      });
    }
    findTargetOnNextFrame();
  }

  function handleRoomSelect(roomId) {
    const nextRoom = rooms.find((r) => r.id === roomId);
    if (!nextRoom || !nextRoom.isAvailable || nextRoom.id === activeRoom.id) return;
    beginRoomTransition({
      kind: "room",
      fromLabel: activeRoom.name,
      toLabel: nextRoom.name,
      tone: nextRoom.tone || "personal"
    });
    if (nextRoom.roomId) setCookieValue("room_id", nextRoom.roomId);
    setCookieValue("conversation_id", nextRoom.conversationId);
    setActiveRoomId(nextRoom.id);
    setConversationOverride(null);
    setDraftConversation(null);
    clearComposer(); setMessageFlight(null); setHiddenMessageId(null); setHeaderScrolled(false);
  }

  async function handleConversationSelect(conversationId) {
    if (!conversationId || conversationId === activeConversationId) return;
    const nextConversation = activeRoomConversations.find((conversation) => conversation.id === conversationId);
    beginRoomTransition({
      kind: "conversation",
      fromLabel: activeRoom.name,
      toLabel: nextConversation?.name || `对话 ${conversationId}`,
      tone: activeRoom.tone || "personal"
    });
    setCookieValue("conversation_id", conversationId);
    setConversationOverride({ roomId: activeRoom.id, conversationId });
    setDraftConversation(null);
    clearComposer(); setMessageFlight(null); setHiddenMessageId(null); setHeaderScrolled(false);
  }

  function handleNavigateConversation(roomId, conversationId) {
    const nextRoom = rooms.find((r) => r.id === roomId);
    if (!nextRoom || !nextRoom.isAvailable) return;
    const nextConversationId = normalizeConversationId(conversationId) || nextRoom.conversationId;
    if (!nextConversationId) return;
    if (nextRoom.id === activeRoom.id && nextConversationId === activeConversationId) return;
    const nextConversation = (nextRoom.conversations || []).find((conversation) => conversation.id === nextConversationId);
    beginRoomTransition({
      kind: nextRoom.id === activeRoom.id ? "conversation" : "room",
      fromLabel: activeRoom.name,
      toLabel: nextConversation?.name || nextRoom.name,
      tone: nextRoom.tone || "personal"
    });
    if (nextRoom.roomId) setCookieValue("room_id", nextRoom.roomId);
    setCookieValue("conversation_id", nextConversationId);
    setActiveRoomId(nextRoom.id);
    setConversationOverride(nextConversationId !== nextRoom.conversationId ? { roomId: nextRoom.id, conversationId: nextConversationId } : null);
    setDraftConversation(null);
    clearComposer(); setMessageFlight(null); setHiddenMessageId(null); setHeaderScrolled(false);
  }

  async function handleDeleteConversation(conversationId) {
    if (!conversationId) return;
    try {
      await deleteConversation(conversationId);
      if (conversationOverride?.conversationId === conversationId) setConversationOverride(null);
      await refreshRooms(activeBackendRoomId);
    } catch (error) {
      console.warn("Failed to delete conversation:", error);
    }
  }

  async function handlePasteImage(file) {
    setComposerError("");
    try {
      const attachment = await prepareImageAttachment(file);
      setDraftAttachment(attachment);
    } catch (error) {
      setDraftAttachment(null);
      setComposerError(error instanceof Error ? error.message : "图片处理失败，请重试");
    }
  }

  async function handleDeleteMessage(message) {
    if (!message?.id) return;
    if (message.source === "local-welcome") {
      setLocalSystemMessages((current) => current.filter((item) => item.id !== message.id));
      return;
    }
    try {
      await deleteChatMessage(message);
    } catch (error) {
      setComposerError(getApiErrorMessage(error, "消息删除失败"));
    }
  }

  async function handleSend() {
    if (sendingRef.current) return;
    const trimmedMessage = messageDraft.trim();
    const imageMarkdown = buildImageMarkdown(draftAttachment);
    const outgoingMessage = [trimmedMessage, imageMarkdown].filter(Boolean).join("\n\n");
    const flightText = trimmedMessage || (draftAttachment ? "图片" : "");
    if (!outgoingMessage) return;
    if (getCharacterLength(outgoingMessage) > MESSAGE_CONTENT_MAX_LENGTH) {
      setComposerError(`消息不能超过 ${MESSAGE_CONTENT_MAX_LENGTH} 个字符`);
      return;
    }
    setComposerError("");
    sendingRef.current = true;

    if (draftConversation) {
      const savedMessage = outgoingMessage;
      const savedFlight = flightText;
      clearComposer(); setMessageFlight(null); setHiddenMessageId(null);
      const nextTitle = activeRoomConversations.length
        ? `新的讨论 ${activeRoomConversations.length + 1}`
        : "新的讨论";
      try {
        const created = await createConversation(activeBackendRoomId, nextTitle);
        if (!created?.conversationId) {
          setComposerError("对话创建失败");
          setMessageDraft(savedMessage);
          sendingRef.current = false;
          return;
        }
        try {
          const syncedMembers = await syncConversationAiMembers(created.conversationId, draftConversation.aiMembers);
          setConversationAiMembers((current) => ({ ...current, [created.conversationId]: syncedMembers }));
          setAiConfigError((current) => ({ ...current, room: "", conversation: "" }));
        } catch (error) {
          setConversationAiMembers((current) => ({ ...current, [created.conversationId]: [] }));
          setAiConfigError((current) => ({ ...current, conversation: getApiErrorMessage(error, "AI 团队继承失败") }));
        }
        setCookieValue("conversation_id", created.conversationId);
        const sentMessage = sendChatMessage(savedMessage, created.conversationId);
        if (!sentMessage) {
          setComposerError("消息发送失败，请重试");
          setMessageDraft(savedMessage);
          sendingRef.current = false;
          return;
        }
        setConversationOverride({ roomId: activeRoom.id, conversationId: created.conversationId });
        setDraftConversation(null);
        const composerField = composerFieldRef.current;
        const composerRect = composerField?.getBoundingClientRect();
        if (composerRect) {
          setMessageFlight({ id: sentMessage.id, text: savedFlight, transition: NORMAL_SEND_FLIGHT, startRect: { left: composerRect.left, top: composerRect.top + 6, width: Math.max(120, composerRect.width - 16) }, targetRect: null });
          setHiddenMessageId(sentMessage.id);
          scheduleMessageFlightTarget(sentMessage.id);
          window.clearTimeout(launchTimerRef.current);
          launchTimerRef.current = window.setTimeout(() => { completeMessageFlight(sentMessage.id); }, 1400);
        }
      } catch (error) {
        setComposerError(getApiErrorMessage(error, "对话创建失败"));
        setMessageDraft(savedMessage);
      } finally {
        sendingRef.current = false;
      }
      return;
    }

    try {
      const sentMessage = sendChatMessage(outgoingMessage);
      if (sentMessage) {
        const composerField = composerFieldRef.current;
        const composerRect = composerField?.getBoundingClientRect();
        const now = window.performance?.now?.() ?? Date.now();
        const shouldAnimateFlight = Boolean(composerRect) && !messageFlight && hiddenMessageId == null && now - lastSendFlightAtRef.current >= SEND_FLIGHT_COOLDOWN_MS;
        clearComposer();
        if (!shouldAnimateFlight) return;
        lastSendFlightAtRef.current = now;
        setMessageFlight({ id: sentMessage.id, text: flightText, transition: NORMAL_SEND_FLIGHT, startRect: { left: composerRect.left, top: composerRect.top + 6, width: Math.max(120, composerRect.width - 16) }, targetRect: null });
        setHiddenMessageId(sentMessage.id);
        scheduleMessageFlightTarget(sentMessage.id);
        window.clearTimeout(launchTimerRef.current);
        launchTimerRef.current = window.setTimeout(() => { completeMessageFlight(sentMessage.id); }, 1400);
      }
    } finally {
      sendingRef.current = false;
    }
  }

  const isLoginTransition = sceneTransition?.kind === "login";
  const isLogoutTransition = sceneTransition?.kind === "logout";
  const isSceneTransitioning = Boolean(sceneTransition);
  const showAuthStage = appStage === "login" || appStage === "register" || isLoginTransition || isLogoutTransition;
  const showChatStage = appStage === "chat" || isLoginTransition || isLogoutTransition;
  const currentAuthMode = isLogoutTransition ? sceneTransition.authMode || "login" : appStage === "register" ? "register" : "login";
  const authTransitionMode = isLoginTransition ? "exit-to-chat" : isLogoutTransition ? "enter-from-chat" : "idle";
  const chatTransitionMode = isLoginTransition ? "enter-from-auth" : isLogoutTransition ? "exit-to-auth" : "idle";
  const roomSystemMessages = localSystemMessages.filter((m) => !m.roomId || m.roomId === activeRoom.id);
  const displayMessages = isLoginTransition ? [] : [...roomSystemMessages, ...messages];

  return (
    <>
      <AnimatePresence initial={false}>
        {appStage === "loading" ? <LoadingStage key="loading" /> : null}

        {showAuthStage ? (
          <AuthShell
            key="auth" mode={currentAuthMode} isPanelOpen={authPanelOpen}
            onOpenMode={(next) => syncAuthRoute(next, true)}
            onClosePanel={() => syncAuthRoute("login", false)}
            onNavigateHome={() => syncAuthRoute("login", false)}
            onSuccess={handleAuthSuccess}
            disabled={authHandoffPending || isSceneTransitioning}
            isHandoffPending={authHandoffPending}
            transitionMode={authTransitionMode}
            transitionConfig={
              isLoginTransition ? sceneTransition.config.authExit
                : isLogoutTransition ? sceneTransition.config.authEnter : null
            }
          />
        ) : null}

        {showChatStage && !showAuthStage && (!isChatRuntimeReady || !ChatRoomComponent) ? (
          <LoadingStage key="chat-runtime-loading" />
        ) : null}

        {showChatStage && isChatRuntimeReady && ChatRoomComponent ? (
          <motion.div
            key="chat-stage"
            className={`chat-stage ${isLoginTransition ? "is-entering-from-auth" : isLogoutTransition ? "is-exiting-to-auth" : "is-live"}`}
            initial={isSceneTransitioning ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: isSceneTransitioning ? 0.2 : 0.3, ease: EASE }}
          >
            <ChatRoomComponent
              nickname={authedNickname} username={authedUsername} avatarUrl={authedAvatarUrl}
              onProfileUpdate={handleProfileUpdate} connectionState={connectionState}
              messages={displayMessages} isHeaderScrolled={isHeaderScrolled}
              onScrolled={setHeaderScrolled} messageDraft={messageDraft}
              onMessageDraftChange={setMessageDraft} onSend={handleSend}
              messageAttachment={draftAttachment}
              composerError={composerError}
              onPasteImage={handlePasteImage}
              onRemoveAttachment={() => { setDraftAttachment(null); setComposerError(""); }}
              composerFieldRef={composerFieldRef} messagesViewportRef={chatMessagesViewportRef}
              hiddenMessageId={hiddenMessageId} messageFlight={messageFlight}
              onMessageFlightComplete={completeMessageFlight} onLogout={handleLogout}
              onDeleteMessage={handleDeleteMessage}
              rooms={rooms} activeRoomId={activeRoom.id} onRoomSelect={handleRoomSelect}
              roomAiMembersByRoomId={roomAiMembers}
              roomName={activeRoom.name}
              roomHint={activeRoom.description}
              room={activeRoom}
              roomTransition={roomTransition}
              activeConversationId={activeConversationId}
              activeConversation={activeConversation}
              isMainConversation={activeConversationIsMain}
              activeConversationModelLabel={activeConversationModelLabel}
              isConversationModelLoading={isConversationModelLoading}
              roomAiMembers={activeRoomAiMembers}
              conversationAiMembers={activeConversationAiMembers}
              effectiveAiMembers={activeEffectiveAiMembers}
              availableAis={availableAis}
              thinkingAdapters={thinkingAdapters}
              aiConfigError={aiConfigError}
              assistantState={assistantState}
              roomConversations={activeRoomConversations}
              onConversationSelect={handleConversationSelect}
              onNavigateConversation={handleNavigateConversation}
              draftConversation={draftConversation}
              onDraftAiMembersChange={handleDraftAiMembersChange}
              onCancelConversationDraft={handleCancelConversationDraft}
              onDeleteConversation={handleDeleteConversation}
              onCreateConversationDraft={handleCreateConversationDraft}
              onConversationAiMembersChange={handleConversationAiMembersChange}
              onRoomAiMembersSave={handleRoomAiMembersSave}
              currentUserId={authedUserId}
              onRoomsChanged={refreshRooms}
              transitionMode={chatTransitionMode}
              transitionConfig={
                isLoginTransition ? sceneTransition.config.chatEnter
                  : isLogoutTransition ? sceneTransition.config.chatExit : null
              }
              hideMessageContent={isLoginTransition} readOnly={isSceneTransitioning}
              hasMoreHistory={historyHasMore}
              historyInitialLoading={historyState === "loading"}
              historyLoading={historyState === "loading-more"}
              historyError={historyError}
              onLoadMoreHistory={loadOlderMessages}
              onOpenDesignLab={openDesignLab}
              designLabLoading={designLabLoading}
              designLabError={designLabError}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
      <AnimatePresence>
        {isDesignLabOpen && DesignLabComponent ? (
          <motion.div
            key="design-lab-route"
            className="design-lab-route"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: EASE }}
          >
            <DesignLabComponent onClose={closeDesignLab} />
          </motion.div>
        ) : isDesignLabOpen && designLabLoading ? (
          <LoadingStage key="design-lab-loading" />
        ) : null}
      </AnimatePresence>
    </>
  );
}
