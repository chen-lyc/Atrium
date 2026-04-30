import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CHAT_URL, CHAT_RUNTIME_MODULES, DEFAULT_CONVERSATION_ID, EASE,
  NORMAL_SEND_FLIGHT, PERSONAL_ROOM_ID, PUBLIC_ROOM_ID, PUBLIC_CONVERSATION_ID
} from "./constants.js";
import {
  createId, deleteSessionCookie, fetchCurrentUser,
  getConversationIdCookie, getCookieValue, hasSessionCookie,
  setCookieValue, prepareImageAttachment, buildImageMarkdown,
  normalizeAuthPayload
} from "./utils.js";
import useWebSocket from "./useWebSocket.js";
import { LoadingStage } from "./auth/AuthShell.jsx";
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

function normalizeConversationId(value) {
  const numericValue = Number(value);
  return Number.isSafeInteger(numericValue) && numericValue > 0 ? numericValue : 0;
}
function getPublicConversationId() {
  const bootstrappedValue = normalizeConversationId(window.__ATRIUM_PUBLIC_CONVERSATION_ID);
  if (bootstrappedValue) return bootstrappedValue;
  const cookieValue = normalizeConversationId(getCookieValue("public_conversation_id"));
  if (cookieValue) return cookieValue;
  return normalizeConversationId(PUBLIC_CONVERSATION_ID);
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
function createPersonalRoom(conversationId, name = "我的讨论室") {
  return {
    id: PERSONAL_ROOM_ID,
    name,
    note: "安静的个人空间",
    description: "适合先整理自己的想法，也为未来的个人 + 多 AI 讨论预留位置。",
    placeLabel: "个人空间",
    atmosphere: "先把想法放稳，再决定要不要带 AI 一起拆开。",
    cues: ["私下整理", "AI 可加入", "摘录成笔记"],
    emptyTitle: "这里可以慢慢想",
    emptyHint: "写下一个问题、计划或灵感，个人讨论室会先替你留住它。",
    composerPlaceholder: "在个人房间写下一个想法...",
    tone: "personal",
    conversationId,
    isAvailable: true
  };
}
function createPublicRoom(conversationId, name = "Atrium 大厅") {
  return {
    id: PUBLIC_ROOM_ID,
    name,
    note: "多人共享讨论",
    description: "和其他人进入同一个空间，把临时对话逐步沉淀成清晰结论。",
    placeLabel: "公共大厅",
    atmosphere: "这里适合把问题抛出来，让人和 AI 在同一张讨论桌旁接住它。",
    cues: ["共同讨论", "@AI 梳理", "共享沉淀"],
    emptyTitle: "大厅正在等第一段讨论",
    emptyHint: "发起一个话题，让这张公共讨论桌开始有声音。",
    composerPlaceholder: "向大厅发起一个话题...",
    tone: "public",
    conversationId,
    isAvailable: true
  };
}
function createGenericRoom(conversation, index) {
  const name = conversation.name || `讨论室 ${conversation.id}`;
  return {
    id: `conversation-${conversation.id}`,
    name,
    note: "讨论室",
    description: `${name} 的实时讨论空间。`,
    placeLabel: "讨论室",
    atmosphere: "把话题放进这个房间，让讨论沿着同一条线继续。",
    cues: ["持续讨论", "多人参与", "后续沉淀"],
    emptyTitle: "这里还没有消息",
    emptyHint: "发起第一段讨论，让这个房间开始运转。",
    composerPlaceholder: `在${name}写下消息...`,
    tone: index % 2 === 0 ? "personal" : "public",
    conversationId: conversation.id,
    isAvailable: true
  };
}
function createFallbackRoomList(personalConversationId) {
  const personalId = normalizeConversationId(personalConversationId) || DEFAULT_CONVERSATION_ID;
  const publicId = getPublicConversationId();
  return [
    createPersonalRoom(personalId),
    createPublicRoom(publicId || DEFAULT_CONVERSATION_ID)
  ];
}
function createRoomList(conversations, personalConversationId) {
  const records = Array.isArray(conversations)
    ? conversations
        .map((conversation) => ({
          id: normalizeConversationId(conversation?.id),
          name: typeof conversation?.name === "string" && conversation.name.trim()
            ? conversation.name.trim()
            : ""
        }))
        .filter((conversation) => conversation.id)
    : [];
  if (!records.length) return createFallbackRoomList(personalConversationId);

  const publicConversationId = getPublicConversationId();
  const publicRecord =
    records.find((conversation) => conversation.id === publicConversationId) ||
    records.find((conversation) => conversation.name.includes("大厅"));
  const personalRecord =
    records.find((conversation) => conversation.id !== publicRecord?.id && conversation.name.includes("个人")) ||
    records.find((conversation) => conversation.id !== publicRecord?.id);
  const usedIds = new Set();
  const rooms = [];

  if (personalRecord) {
    rooms.push(createPersonalRoom(personalRecord.id, personalRecord.name || "我的讨论室"));
    usedIds.add(personalRecord.id);
  }
  if (publicRecord) {
    rooms.push(createPublicRoom(publicRecord.id, publicRecord.name || "Atrium 大厅"));
    usedIds.add(publicRecord.id);
  }

  records
    .filter((conversation) => !usedIds.has(conversation.id))
    .sort((a, b) => a.id - b.id)
    .forEach((conversation, index) => {
      rooms.push(createGenericRoom(conversation, index));
    });

  return rooms.length ? rooms : createFallbackRoomList(personalConversationId);
}
function getDefaultActiveRoomId(rooms) {
  return rooms.find((room) => room.id === PERSONAL_ROOM_ID)?.id || rooms[0]?.id || PERSONAL_ROOM_ID;
}
function getPersonalConversationIdFromRooms(rooms) {
  return rooms.find((room) => room.id === PERSONAL_ROOM_ID)?.conversationId || rooms[0]?.conversationId || DEFAULT_CONVERSATION_ID;
}
function syncRoomCookies(rooms, activeRoomId) {
  const personalRoom = rooms.find((room) => room.id === PERSONAL_ROOM_ID);
  const publicRoom = rooms.find((room) => room.id === PUBLIC_ROOM_ID);
  const activeRoom = rooms.find((room) => room.id === activeRoomId) || personalRoom || rooms[0];
  if (personalRoom?.conversationId) setCookieValue("personal_conversation_id", personalRoom.conversationId);
  if (publicRoom?.conversationId) setCookieValue("public_conversation_id", publicRoom.conversationId);
  if (activeRoom?.conversationId) setCookieValue("conversation_id", activeRoom.conversationId);
}
function getAuthRoute(pathname = window.location.pathname) {
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  if (normalizedPath === "/chat") return { mode: "login", isPanelOpen: true, path: "/chat" };
  if (normalizedPath === "/register") return { mode: "register", isPanelOpen: true, path: "/register" };
  if (normalizedPath === "/login") return { mode: "login", isPanelOpen: true, path: "/login" };
  return { mode: "login", isPanelOpen: false, path: "/" };
}

export default function App() {
  const launchTimerRef = useRef(null);
  const launchFrameRef = useRef(null);
  const focusFrameRef = useRef(null);
  const authPanelCloseTimerRef = useRef(null);
  const ritualTimerRef = useRef(null);
  const chatRuntimePromiseRef = useRef(null);
  const ChatRoomComponentRef = useRef(null);
  const lastSendFlightAtRef = useRef(0);
  const composerFieldRef = useRef(null);
  const chatMessagesViewportRef = useRef(null);

  const prefersReducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;
  const loginRitualConfig = prefersReducedMotion ? REDUCED_LOGIN_RITUAL : NORMAL_LOGIN_RITUAL;
  const logoutRitualConfig = prefersReducedMotion ? REDUCED_LOGOUT_RITUAL : NORMAL_LOGOUT_RITUAL;

  const [appStage, setAppStage] = useState("loading");
  const [authPanelOpen, setAuthPanelOpen] = useState(false);
  const [authedNickname, setAuthedNickname] = useState("");
  const [authHandoffPending, setAuthHandoffPending] = useState(false);
  const [wsEnabled, setWsEnabled] = useState(false);
  const [localSystemMessages, setLocalSystemMessages] = useState([]);
  const [personalConversationId, setPersonalConversationId] = useState(() => getPersonalConversationId());
  const [conversationRecords, setConversationRecords] = useState([]);
  const [activeRoomId, setActiveRoomId] = useState(PERSONAL_ROOM_ID);
  const [messageDraft, setMessageDraft] = useState("");
  const [draftAttachment, setDraftAttachment] = useState(null);
  const [composerError, setComposerError] = useState("");
  const [isHeaderScrolled, setHeaderScrolled] = useState(false);
  const [messageFlight, setMessageFlight] = useState(null);
  const [hiddenMessageId, setHiddenMessageId] = useState(null);
  const [sceneTransition, setSceneTransition] = useState(null);
  const [isChatRuntimeReady, setChatRuntimeReady] = useState(false);
  const [ChatRoomComponent, setChatRoomComponent] = useState(null);

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
    })();
    chatRuntimePromiseRef.current = promise;
    return promise;
  }

  const rooms = createRoomList(conversationRecords, personalConversationId);
  const personalRoom = rooms[0];
  const activeRoom = rooms.find((r) => r.id === activeRoomId && r.isAvailable) || personalRoom;
  const activeConversationId = activeRoom.conversationId || personalRoom.conversationId;
  const shouldKeepSocketEnabled =
    Boolean(authedNickname) && (sceneTransition?.kind === "login" || sceneTransition?.kind === "logout" || (appStage === "chat" && sceneTransition?.kind !== "logout"));

  const { messages, connectionState, sendChatMessage, deleteChatMessage } = useWebSocket({
    url: CHAT_URL, nickname: authedNickname, conversationId: activeConversationId,
    enabled: shouldKeepSocketEnabled && wsEnabled,
    onAuthFailed: () => {
      clearRitualTimers(); setSceneTransition(null); deleteSessionCookie();
      setAuthedNickname(""); setWsEnabled(false); setAuthHandoffPending(false);
      setLocalSystemMessages([]); setPersonalConversationId(DEFAULT_CONVERSATION_ID);
      setConversationRecords([]);
      setActiveRoomId(PERSONAL_ROOM_ID);
      syncAuthRoute("login", true, { replace: true });
      setMessageDraft(""); setDraftAttachment(null); setComposerError(""); setMessageFlight(null); setHiddenMessageId(null);
    }
  });

  function clearComposer() {
    setMessageDraft("");
    setDraftAttachment(null);
    setComposerError("");
  }

  function clearRitualTimers() {
    window.clearTimeout(authPanelCloseTimerRef.current);
    window.clearTimeout(ritualTimerRef.current);
    authPanelCloseTimerRef.current = null; ritualTimerRef.current = null;
    if (focusFrameRef.current != null) { window.cancelAnimationFrame(focusFrameRef.current); focusFrameRef.current = null; }
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
    const nextConversationRecords = Array.isArray(session.conversations) ? session.conversations : [];
    const nextRooms = createRoomList(nextConversationRecords, getPersonalConversationId());
    const nextActiveRoomId = getDefaultActiveRoomId(nextRooms);
    const nextPersonalId = getPersonalConversationIdFromRooms(nextRooms);
    setConversationRecords(nextConversationRecords);
    setPersonalConversationId(nextPersonalId);
    setActiveRoomId(nextActiveRoomId);
    syncRoomCookies(nextRooms, nextActiveRoomId);
    return { session, rooms: nextRooms, activeRoomId: nextActiveRoomId, personalId: nextPersonalId };
  }

  useEffect(() => {
    let cancelled = false;
    const bootstrap = async () => {
      try {
        const shouldPrepareChatRuntime = hasSessionCookie();
        const chatRuntimePromise = shouldPrepareChatRuntime
          ? ensureChatRuntimeLoaded().catch((err) => { console.error("Failed to preload chat runtime:", err); return null; })
          : Promise.resolve(null);
        const result = await fetchCurrentUser();
        if (cancelled) return;
        if (result.ok && typeof result.data?.nickname === "string" && result.data.nickname.trim()) {
          const LoadedChatRoom = await chatRuntimePromise;
          if (!LoadedChatRoom) throw new Error("Chat runtime not ready");
          if (cancelled) return;
          const { session } = applyAuthSession(result.data);
          setAuthHandoffPending(false); setLocalSystemMessages([]);
          setAuthedNickname(session.nickname.trim());
          setWsEnabled(true); setAuthPanelOpen(false); setAppStage("chat");
          if (window.location.pathname !== "/chat") window.history.replaceState({ path: "/chat" }, "", "/chat");
          return;
        }
        const authRoute = getAuthRoute();
        setAuthedNickname(""); setWsEnabled(false); setAuthHandoffPending(false); setLocalSystemMessages([]);
        setConversationRecords([]); setPersonalConversationId(DEFAULT_CONVERSATION_ID); setActiveRoomId(PERSONAL_ROOM_ID);
        setAppStage(authRoute.mode); setAuthPanelOpen(authRoute.isPanelOpen);
        if (authRoute.path === "/chat" && window.location.pathname !== "/login") {
          window.history.replaceState({ path: "/login" }, "", "/login"); setAuthPanelOpen(true);
        }
      } catch (error) {
        if (cancelled) return;
        const authRoute = getAuthRoute();
        setAuthedNickname(""); setWsEnabled(false); setAuthHandoffPending(false); setLocalSystemMessages([]);
        setConversationRecords([]); setPersonalConversationId(DEFAULT_CONVERSATION_ID); setActiveRoomId(PERSONAL_ROOM_ID);
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
      if (authedNickname && (appStage === "chat" || sceneTransition?.kind === "login")) {
        if (window.location.pathname !== "/chat") window.history.replaceState({ path: "/chat" }, "", "/chat");
        return;
      }
      const authRoute = getAuthRoute();
      clearRitualTimers(); setSceneTransition(null); setAuthHandoffPending(false); setLocalSystemMessages([]);
      setWsEnabled(false); setAppStage(authRoute.mode); setAuthPanelOpen(authRoute.isPanelOpen);
      if (authRoute.path === "/chat" && window.location.pathname !== "/login") {
        window.history.replaceState({ path: "/login" }, "", "/login"); setAuthPanelOpen(true);
      }
    }
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [appStage, authedNickname, sceneTransition]);

  useEffect(() => { if (shouldKeepSocketEnabled) setWsEnabled(true); else setWsEnabled(false); }, [shouldKeepSocketEnabled]);
  useEffect(() => { return () => { clearRitualTimers(); window.clearTimeout(launchTimerRef.current); if (launchFrameRef.current != null) window.cancelAnimationFrame(launchFrameRef.current); if (focusFrameRef.current != null) window.cancelAnimationFrame(focusFrameRef.current); }; }, []);

  useEffect(() => { if (appStage === "chat") return; clearComposer(); setMessageFlight(null); setHiddenMessageId(null); setHeaderScrolled(false); if (focusFrameRef.current != null) { window.cancelAnimationFrame(focusFrameRef.current); focusFrameRef.current = null; } }, [appStage]);

  function beginLoginRitual(authData, config) {
    const { session } = applyAuthSession(authData);
    const resolved = session.nickname.trim();
    setAuthedNickname(resolved); setLocalSystemMessages([]);
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
    setConversationRecords([]); setPersonalConversationId(DEFAULT_CONVERSATION_ID); setActiveRoomId(PERSONAL_ROOM_ID);
    setAuthPanelOpen(true);
    setSceneTransition({ kind: "logout", authMode: "login", config: logoutRitualConfig });
    if (window.location.pathname !== "/login") window.history.replaceState({ path: "/login" }, "", "/login");
    ritualTimerRef.current = window.setTimeout(() => {
      setSceneTransition(null); setWsEnabled(false); setAuthedNickname(""); setLocalSystemMessages([]);
      setConversationRecords([]); setPersonalConversationId(DEFAULT_CONVERSATION_ID); setActiveRoomId(PERSONAL_ROOM_ID);
      clearComposer(); setMessageFlight(null); setHiddenMessageId(null); setHeaderScrolled(false);
      setAppStage("login"); setAuthPanelOpen(true);
    }, logoutRitualConfig.totalMs);
  }

  function completeMessageFlight(messageId) {
    setHiddenMessageId((cur) => (cur === messageId ? null : cur));
    setMessageFlight((cur) => (cur && cur.id === messageId ? null : cur));
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
    setCookieValue("conversation_id", nextRoom.conversationId);
    setActiveRoomId(nextRoom.id);
    clearComposer(); setMessageFlight(null); setHiddenMessageId(null); setHeaderScrolled(false);
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

  function handleDeleteMessage(message) {
    if (!message?.id) return;
    if (message.source === "local-welcome") {
      setLocalSystemMessages((current) => current.filter((item) => item.id !== message.id));
      return;
    }
    deleteChatMessage(message.id);
  }

  function handleSend() {
    const trimmedMessage = messageDraft.trim();
    const imageMarkdown = buildImageMarkdown(draftAttachment);
    const outgoingMessage = [trimmedMessage, imageMarkdown].filter(Boolean).join("\n\n");
    const flightText = trimmedMessage || (draftAttachment ? "图片" : "");
    if (!outgoingMessage) return;
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
              nickname={authedNickname} connectionState={connectionState}
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
              roomName={activeRoom.name}
              roomHint={activeRoom.description}
              room={activeRoom}
              transitionMode={chatTransitionMode}
              transitionConfig={
                isLoginTransition ? sceneTransition.config.chatEnter
                  : isLogoutTransition ? sceneTransition.config.chatExit : null
              }
              hideMessageContent={isLoginTransition} readOnly={isSceneTransitioning}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
