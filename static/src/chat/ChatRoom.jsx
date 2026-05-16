import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EASE, STATUS_LABEL } from "../constants.js";
import {
  createRoom,
  fetchFriendRequests,
  fetchMyRoomInvitations,
  fetchRoomMembers,
  getApiErrorMessage,
  getThinkingModeLabel,
  renameConversation,
  syncRoomAiMembers
} from "../utils.js";
import Sidebar from "./Sidebar.jsx";
import MessageList from "./MessageList.jsx";
import MessageInput from "./MessageInput.jsx";
import MessageFlight from "./MessageFlight.jsx";
import AccountCenterPanel from "./AccountCenterPanel.jsx";
import WorkspacePanel from "./WorkspacePanel.jsx";
import {
  AiModelSelector,
  AiSeatStrip,
  ModalLayer,
  getAiAvatarUrl,
  getAiMemberName,
  mergeAiMemberOptions
} from "./AiTeamEditor.jsx";

const NOTE_TOAST_MS = 2200;
const CHAT_SURFACE_STORAGE_KEY = "atrium.chat.surface";
const ROLE_LABELS = {
  0: "房主",
  1: "管理员",
  2: "成员"
};
const MAIN_SEATLINE_MEMBER_LIMIT = 5;
const MAIN_SEATLINE_AI_LIMIT = 5;

function readStoredChatSurface() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CHAT_SURFACE_STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeStoredChatSurface(nextSurface) {
  try {
    const current = readStoredChatSurface();
    window.localStorage.setItem(CHAT_SURFACE_STORAGE_KEY, JSON.stringify({ ...current, ...nextSurface }));
  } catch {
    // UI position persistence is best-effort only.
  }
}

function HeaderStatus({ modelLabel, connectionState }) {
  const connectionLabel = STATUS_LABEL[connectionState] || STATUS_LABEL.idle;
  const resolvedModel = modelLabel || "未绑定 AI";
  return (
    <span
      className={`room-connection-signal is-${connectionState}`}
      aria-label={`${resolvedModel} · ${connectionLabel}`}
      title={`${resolvedModel} · ${connectionLabel}`}
    >
      <span aria-hidden="true" />
    </span>
  );
}

function getRoleLabel(role) {
  return ROLE_LABELS[Number(role)] || "成员";
}

function getMemberInitial(member) {
  const source = member?.nickname || member?.username || "用";
  return String(source).trim().slice(0, 1) || "用";
}

function getVisibleMemberCount(room, members) {
  const rawCount = Number(room?.memberCount ?? room?.member_count ?? room?.membersCount ?? room?.members_count);
  const normalizedCount = Number.isSafeInteger(rawCount) && rawCount >= 0 ? rawCount : 0;
  return Math.max(normalizedCount, members.length);
}

function RoomMemberAvatar({ member, currentUserId = "" }) {
  const isSelf = currentUserId && String(member?.userId) === String(currentUserId);
  const avatar = member?.avatarUrl || member?.avatar_url || "";
  return (
    <span className={`main-seatline-avatar ${isSelf ? "is-self" : ""}`}>
      {avatar ? <img src={avatar} alt="" /> : <span>{getMemberInitial(member)}</span>}
    </span>
  );
}

function MainConversationSeatline({
  room,
  members = [],
  membersState = "idle",
  currentUserId = "",
  fallbackMember,
  aiMembers = [],
  thinkingAdapters = [],
  compact = false,
  onOpenMembers = () => {},
  onOpenAi = () => {}
}) {
  const resolvedMembers = members.length ? members : fallbackMember ? [fallbackMember] : [];
  const visibleMembers = resolvedMembers.slice(0, MAIN_SEATLINE_MEMBER_LIMIT);
  const memberCount = getVisibleMemberCount(room, resolvedMembers);
  const remainingMembers = Math.max(memberCount - visibleMembers.length, 0);
  const visibleAiMembers = aiMembers.slice(0, MAIN_SEATLINE_AI_LIMIT);
  const remainingAi = Math.max(aiMembers.length - visibleAiMembers.length, 0);
  const loadLabel = membersState === "loading" && !members.length ? "同步中" : "";

  return (
    <section className={`main-seatline ${compact ? "is-compact" : "is-open"}`} aria-label="主对话成员席位">
      <div className="main-seatline-scroll">
        <div className="main-seatline-group is-members">
          {visibleMembers.map((member) => {
            const isSelf = currentUserId && String(member.userId) === String(currentUserId);
            return (
              <button
                key={member.userId || member.nickname}
                type="button"
                className={`main-seatline-member focus-ring ${isSelf ? "is-self" : ""}`}
                onClick={onOpenMembers}
                title={`${member.nickname || member.username || "成员"} · ${getRoleLabel(member.role)}`}
              >
                <RoomMemberAvatar member={member} currentUserId={currentUserId} />
                <span className="main-seatline-copy">
                  <span>{isSelf ? "我" : member.nickname || member.username || "成员"}</span>
                  <small>{getRoleLabel(member.role)}</small>
                </span>
              </button>
            );
          })}
          {remainingMembers > 0 ? (
            <button type="button" className="main-seatline-more focus-ring" onClick={onOpenMembers}>
              +{remainingMembers}
              <small>成员</small>
            </button>
          ) : loadLabel ? (
            <span className="main-seatline-loading">{loadLabel}</span>
          ) : null}
        </div>

        <div className="main-seatline-divider" aria-hidden="true" />

        <div className="main-seatline-group is-ai">
          {visibleAiMembers.length ? (
            <AiSeatStrip
              members={visibleAiMembers}
              thinkingAdapters={thinkingAdapters}
              readOnly={true}
              onChange={async () => visibleAiMembers}
              onSeatAction={onOpenAi}
              showHoverSummary={true}
              showLabels={true}
              emptyText=""
              className="is-main-seatline"
            />
          ) : (
            <button type="button" className="main-seatline-empty-ai focus-ring" onClick={onOpenAi}>
              <span>无 AI</span>
              <small>房间阵容</small>
            </button>
          )}
          {remainingAi > 0 ? (
            <button type="button" className="main-seatline-more is-ai focus-ring" onClick={onOpenAi}>
              +{remainingAi}
              <small>AI</small>
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function MainConversationCover({ roomPlaceLabel, title, topic, aiMembers = [], onOpenAi = () => {} }) {
  const aiSummary = aiMembers.length
    ? `${aiMembers.length} 位 AI 保持沉默席位`
    : "房间 AI 阵容为空";
  return (
    <div className="main-conversation-cover">
      <div className="main-cover-kicker">{roomPlaceLabel}</div>
      <h2>{title}</h2>
      <p>{topic}</p>
      <button type="button" className="main-cover-ai-summary focus-ring" onClick={onOpenAi}>
        <span>{aiSummary}</span>
      </button>
    </div>
  );
}

function getMentionQuery(value) {
  const match = String(value || "").match(/(^|\s)@([^\s@]*)$/);
  return match ? match[2].trim().toLowerCase() : null;
}

function MainConversationMentionReserve({ query = "", aiMembers = [], onPick = () => {} }) {
  const normalizedQuery = String(query || "").toLowerCase();
  const matches = aiMembers
    .filter((member) => getAiMemberName(member).toLowerCase().includes(normalizedQuery))
    .slice(0, 5);
  if (!matches.length) return null;

  return (
    <div className="main-mention-reserve" aria-label="@AI">
      {matches.map((member) => (
        <button
          key={member.aiId}
          type="button"
          className="main-mention-chip focus-ring"
          onClick={() => onPick(member)}
        >
          <img src={getAiAvatarUrl(member)} alt="" />
          <span>{getAiMemberName(member)}</span>
          <small>{getThinkingModeLabel(member)}</small>
        </button>
      ))}
    </div>
  );
}

function formatHomeTimestamp(timestamp) {
  if (!timestamp) return "刚刚";
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "最近";
  const now = Date.now();
  const diff = now - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diff >= 0 && diff < minute) return "刚刚";
  if (diff >= 0 && diff < hour) return `${Math.max(1, Math.floor(diff / minute))} 分钟前`;
  if (diff >= 0 && diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff >= 0 && diff < day * 7) return `${Math.floor(diff / day)} 天前`;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getConversationActivityMs(conversation) {
  return Number(conversation?.lastActivityAtMs || conversation?.updatedAtMs || conversation?.createdAtMs || 0);
}

function getConversationPreview(conversation, room) {
  if (conversation?.lastMessagePreview) return conversation.lastMessagePreview;
  if (conversation?.isMain) return `${room?.name || "房间"}的公共时间线`;
  return "进入对话后继续阅读和推进。";
}

function getHomeConversationEntries(rooms = [], homeRoom = null) {
  const homeRoomId = homeRoom?.id;
  const homeMainConversationId = homeRoom?.mainConversationId || homeRoom?.conversationId || 0;
  return rooms
    .flatMap((item) => {
      const mainConversationId = item?.mainConversationId || item?.conversationId || 0;
      return (item?.conversations || []).map((conversation) => ({
        ...conversation,
        roomId: item.id,
        backendRoomId: item.roomId,
        roomName: item.name,
        roomType: item.type,
        roomTone: item.tone,
        isMain: conversation.id === mainConversationId || conversation.isMain === true,
        title: conversation.id === mainConversationId
          ? item.id === homeRoomId ? "Home" : `${item.name || "房间"} · 公共时间线`
          : conversation.name || `对话 ${conversation.id}`,
        preview: getConversationPreview(conversation, item),
        activityMs: getConversationActivityMs(conversation) || conversation.id
      }));
    })
    .filter((conversation) => !(conversation.roomId === homeRoomId && conversation.id === homeMainConversationId))
    .sort((a, b) => (b.activityMs || 0) - (a.activityMs || 0) || b.id - a.id);
}

function HomeAiStack({ members = [] }) {
  const visibleMembers = members.slice(0, 3);
  if (!visibleMembers.length) {
    return <span className="home-ai-empty">无 AI</span>;
  }
  return (
    <span className="home-ai-cluster" aria-label={`${members.length} 位 AI`}>
      <span className="home-ai-stack">
        {visibleMembers.map((member) => (
          <span className="home-ai-avatar" key={member.aiId || member.id} title={getAiMemberName(member)}>
            <img src={getAiAvatarUrl(member)} alt="" />
          </span>
        ))}
      </span>
      <span className="home-ai-count">{members.length} 位 AI</span>
    </span>
  );
}

function HomeDashboard({
  nickname = "",
  room = null,
  rooms = [],
  roomAiMembersByRoomId = {},
  onOpenConversation = () => {},
  onCreateConversation = () => {},
  onOpenAi = () => {}
}) {
  const conversations = getHomeConversationEntries(rooms, room);
  const hasConversations = conversations.length > 0;
  const homeName = nickname ? `${nickname} 的 Home` : "Home";

  return (
    <section className={`home-dashboard ${hasConversations ? "has-conversations" : "is-empty"}`} aria-label="Home">
      <div className="home-dashboard-inner">
        <header className="home-hero">
          <div className="home-hero-copy">
            <span className="home-kicker">个人讨论室 · 默认入口</span>
            <h1>{homeName}</h1>
            <p>从这里扫过最近的讨论、摘录和 AI 阵容，再决定进入哪一条思考线。</p>
          </div>
          <div className="home-hero-actions">
            <button type="button" className="home-action is-primary focus-ring" onClick={onCreateConversation}>
              新建对话
            </button>
            <button type="button" className="home-action focus-ring" onClick={onOpenAi}>
              选择 AI
            </button>
          </div>
        </header>

        {!hasConversations ? (
          <section className="home-empty-panel" aria-label="开始使用 Atrium">
            <div className="home-empty-grid" aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
            <div className="home-empty-copy">
              <h2>还没有对话</h2>
              <p>先建立一条思考线，再决定要不要让 AI 坐进来。个人讨论室会保留你的对话列表、房间设置和默认 AI 阵容。</p>
            </div>
            <div className="home-empty-actions">
              <button type="button" className="home-action is-primary focus-ring" onClick={onCreateConversation}>
                新建第一个对话
              </button>
              <button type="button" className="home-action focus-ring" onClick={onOpenAi}>
                先配置 AI 阵容
              </button>
            </div>
          </section>
        ) : (
          <section className="home-conversation-section" aria-label="对话近况">
            <div className="home-section-head">
              <div>
                <h2>继续思考</h2>
                <p>{conversations.length} 条对话按最近活动排列</p>
              </div>
            </div>
            <div className="home-conversation-grid">
              {conversations.map((conversation) => {
                const members = roomAiMembersByRoomId[conversation.backendRoomId] || [];
                const unreadCount = Number(conversation.unreadCount || 0);
                return (
                  <button
                    key={`${conversation.roomId}-${conversation.id}`}
                    type="button"
                    className={`home-conversation-card focus-ring ${unreadCount > 0 ? "has-unread" : ""}`}
                    onClick={() => onOpenConversation(conversation.roomId, conversation.id)}
                  >
                    <span className="home-card-meta">
                      <span>{conversation.roomName || "房间"}</span>
                      <time>{formatHomeTimestamp(conversation.activityMs)}</time>
                    </span>
                    <span className="home-card-title">{conversation.title}</span>
                    <span className="home-card-preview">{conversation.preview}</span>
                    <span className="home-card-foot">
                      <HomeAiStack members={members} />
                      {unreadCount > 0 ? <span className="home-unread">{unreadCount > 9 ? "9+" : unreadCount}</span> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        )}

        <aside className="home-notes-panel" aria-label="笔记窥看">
          <div className="home-section-head">
            <div>
              <h2>最近摘录</h2>
              <p>笔记功能先保留前端入口</p>
            </div>
          </div>
          <div className="home-note-empty">
            <span>还没有笔记</span>
            <p>在对话中右键消息，使用“摘录到笔记”。</p>
          </div>
        </aside>
      </div>
    </section>
  );
}

function ConversationPrepPanel({
  isVisible,
  roomAiMembers = [],
  conversationAiMembers = [],
  availableAis = [],
  thinkingAdapters = [],
  readOnly = false,
  onChangeTeam = async () => [],
  loadError = ""
}) {
  const availableMembers = mergeAiMemberOptions(availableAis, roomAiMembers, conversationAiMembers);

  if (!isVisible) return null;

  return (
    <motion.section
      className="conversation-prep"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.18, ease: EASE }}
      aria-label="新对话 AI 阵容"
    >
      <div className="conversation-prep-seats">
        <AiSeatStrip
          members={conversationAiMembers}
          thinkingAdapters={thinkingAdapters}
          readOnly={readOnly}
          onChange={onChangeTeam}
          emptyText="无 AI"
        />
      </div>
      <AiModelSelector
        models={availableMembers}
        members={conversationAiMembers}
        thinkingAdapters={thinkingAdapters}
        readOnly={readOnly}
        onChange={onChangeTeam}
        className="is-conversation-prep"
      />
      {loadError ? <div className="conversation-prep-error">{loadError}</div> : null}
    </motion.section>
  );
}

export default function ChatRoom({
  nickname, username = "", avatarUrl = "", onProfileUpdate = async () => {},
  connectionState, messages,
  isHeaderScrolled, onScrolled,
  messageDraft, onMessageDraftChange, onSend,
  messageAttachment = null, composerError = "",
  composerFieldRef, messagesViewportRef,
  hiddenMessageId, messageFlight, onMessageFlightComplete,
  onLogout, onDeleteMessage = () => {},
  rooms = null, activeRoomId = "", onRoomSelect = () => {},
  roomAiMembersByRoomId = {},
  currentUserId = "", onRoomsChanged = async () => {},
  roomName = "我的讨论室", roomHint = "",
  room = null,
  roomTransition = null,
  activeConversationId = 0,
  activeConversation = null,
  isMainConversation = true,
  activeConversationModelLabel = "",
  isConversationModelLoading = false,
  roomAiMembers = [],
  conversationAiMembers = [],
  effectiveAiMembers = [],
  availableAis = [],
  thinkingAdapters = [],
  aiConfigError = {},
  assistantState = null,
  roomConversations = [],
  onConversationSelect = () => {}, onNavigateConversation = () => {}, onDeleteConversation = () => {},
  draftConversation = null,
  onDraftAiMembersChange = async () => [],
  onCreateConversationDraft = async () => null,
  onConversationAiMembersChange = async () => [],
  onRoomAiMembersSave = async () => [],
  readOnly = false,
  isFading = false, fadeDuration = 600,
  transitionMode = "idle", transitionConfig = null,
  hideMessageContent = false,
  onPasteImage, onRemoveAttachment,
  hasMoreHistory = false, historyInitialLoading = false, historyLoading = false, historyError = "",
  onLoadMoreHistory
}) {
  const hasComposerContent = Boolean(messageDraft.trim() || messageAttachment);
  const composerDisabled = readOnly ? false : !hasComposerContent || connectionState !== "connected";
  const resolvedTransitionMode =
    transitionMode === "enter-from-auth" ? "enter" : transitionMode === "exit-to-auth" ? "exit" : "idle";
  const visibleMessages = hideMessageContent ? [] : messages;

  const [contextMenu, setContextMenu] = useState(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarMode, setSidebarMode] = useState(() => {
    try {
      return localStorage.getItem("atrium.chat.sidebarMode") || "conversations";
    } catch {
      return "conversations";
    }
  });
  const updateSidebarMode = (mode) => {
    setSidebarMode(mode);
    try { localStorage.setItem("atrium.chat.sidebarMode", mode); } catch {}
  };
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(() => readStoredChatSurface().workspacePanelOpen === true);
  const [workspacePanelTab, setWorkspacePanelTab] = useState(() => {
    const tab = readStoredChatSurface().workspacePanelTab;
    return ["room", "ai", "members"].includes(tab) ? tab : "room";
  });
  const [accountCenterOpen, setAccountCenterOpen] = useState(false);
  const [accountNotificationCount, setAccountNotificationCount] = useState(0);
  const [createRoomOpen, setCreateRoomOpen] = useState(false);
  const [newRoomName, setNewRoomName] = useState("");
  const [newRoomAiMembers, setNewRoomAiMembers] = useState([]);
  const [createRoomBusy, setCreateRoomBusy] = useState(false);
  const [createRoomError, setCreateRoomError] = useState("");
  const [noteToast, setNoteToast] = useState(null);
  const noteToastTimerRef = useRef(null);
  const [mainRoomMembers, setMainRoomMembers] = useState([]);
  const [mainRoomMembersState, setMainRoomMembersState] = useState("idle");

  const roomTone = room?.tone === "public" ? "public" : "personal";
  const activeBackendRoomId = Number(room?.roomId || 0);
  const isPersonalMainConversation = room?.id === "personal" || Number(room?.type) === 1;
  const isOrdinaryMainConversation = isMainConversation && !isPersonalMainConversation;
  const isHomeDashboard = isMainConversation && isPersonalMainConversation && !draftConversation;
  const fallbackSeatMember = {
    userId: currentUserId || "self",
    username,
    nickname: nickname || username || "我",
    avatarUrl,
    role: 2
  };

  useEffect(() => {
    if (!contextMenu) return undefined;
    function handlePointerDown(event) {
      if (event.target?.closest?.(".context-menu")) return;
      setContextMenu(null);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  useEffect(() => {
    return () => {
      window.clearTimeout(noteToastTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) {
      setAccountNotificationCount(0);
      return undefined;
    }
    const controller = new AbortController();
    Promise.all([
      fetchFriendRequests("received", controller.signal),
      fetchMyRoomInvitations("received", controller.signal)
    ])
      .then(([friendRequests, roomInvitations]) => {
        setAccountNotificationCount(friendRequests.length + roomInvitations.length);
      })
      .catch((error) => {
        if (error?.name !== "AbortError") setAccountNotificationCount(0);
      });
    return () => controller.abort();
  }, [currentUserId]);

  useEffect(() => {
    if (!isOrdinaryMainConversation || !activeBackendRoomId) {
      setMainRoomMembers([]);
      setMainRoomMembersState("idle");
      return undefined;
    }
    const controller = new AbortController();
    setMainRoomMembersState("loading");
    fetchRoomMembers(activeBackendRoomId, controller.signal)
      .then((members) => {
        setMainRoomMembers(members);
        setMainRoomMembersState("ready");
      })
      .catch((error) => {
        if (error?.name === "AbortError") return;
        setMainRoomMembers([]);
        setMainRoomMembersState("error");
      });
    return () => controller.abort();
  }, [isOrdinaryMainConversation, activeBackendRoomId]);

  function handleMessageContextMenu(e, message) {
    if (!message) return;
    e.preventDefault();
    const menuWidth = 190;
    const menuHeight = 136;
    setContextMenu({
      x: Math.min(e.clientX, window.innerWidth - menuWidth - 8),
      y: Math.min(e.clientY, window.innerHeight - menuHeight - 8),
      message
    });
  }

  async function copyMessageText() {
    const text = contextMenu?.message?.text || "";
    if (!text) {
      setContextMenu(null);
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const buffer = document.createElement("textarea");
        buffer.value = text;
        buffer.setAttribute("readonly", "");
        buffer.style.position = "fixed";
        buffer.style.opacity = "0";
        document.body.appendChild(buffer);
        buffer.select();
        document.execCommand("copy");
        document.body.removeChild(buffer);
      }
    } finally {
      setContextMenu(null);
    }
  }

  function deleteMessageFromView() {
    if (contextMenu?.message) onDeleteMessage(contextMenu.message);
    setContextMenu(null);
  }

  function excerptMessageToNote() {
    const message = contextMenu?.message;
    const text = String(message?.text || "").trim();
    if (!message || !text) {
      setContextMenu(null);
      return;
    }
    window.dispatchEvent(new CustomEvent("atrium-note-excerpt", {
      detail: {
        messageId: message.id,
        text,
        roomId: activeRoomId,
        roomName
      }
    }));
    window.clearTimeout(noteToastTimerRef.current);
    setNoteToast({ id: `${message.id || "note"}-${Date.now()}`, text });
    noteToastTimerRef.current = window.setTimeout(() => setNoteToast(null), NOTE_TOAST_MS);
    setContextMenu(null);
  }

  function openWorkspace(roomId = activeRoomId, tab = "room") {
    const nextTab = ["room", "ai", "members"].includes(tab) ? tab : "room";
    if (roomId && roomId !== activeRoomId) onRoomSelect(roomId);
    setAccountCenterOpen(false);
    setWorkspacePanelTab(nextTab);
    setWorkspacePanelOpen(true);
    writeStoredChatSurface({ workspacePanelOpen: true, workspacePanelTab: nextTab });
  }

  function openAccountCenter() {
    setWorkspacePanelOpen(false);
    writeStoredChatSurface({ workspacePanelOpen: false, workspacePanelTab });
    setAccountCenterOpen(true);
  }

  function openNoteEntry() {
    window.dispatchEvent(new CustomEvent("atrium-note-entry", {
      detail: {
        roomId: activeRoomId,
        conversationId: activeConversationId,
        roomName
      }
    }));
  }

  function insertAiMention(member) {
    const aiName = getAiMemberName(member);
    const nextValue = String(messageDraft || "").replace(/(^|\s)@([^\s@]*)$/, `$1@${aiName} `);
    onMessageDraftChange(nextValue);
    requestAnimationFrame(() => {
      const textarea = composerFieldRef?.current?.querySelector?.("textarea");
      textarea?.focus?.();
      textarea?.setSelectionRange?.(nextValue.length, nextValue.length);
    });
  }

  function openCreateRoom() {
    if (readOnly) return;
    setCreateRoomError("");
    setCreateRoomOpen(true);
  }

  function closeCreateRoom() {
    if (createRoomBusy) return;
    setCreateRoomOpen(false);
    setCreateRoomError("");
  }

  async function updateNewRoomAiMembers(nextMembers) {
    setNewRoomAiMembers(nextMembers);
    return nextMembers;
  }

  async function handleCreateRoom() {
    const name = newRoomName.trim();
    if (!name || createRoomBusy || readOnly) {
      if (!name) setCreateRoomError("请先给讨论室起名");
      return;
    }
    setCreateRoomBusy(true);
    setCreateRoomError("");
    try {
      const created = await createRoom(name);
      if (created?.roomId && newRoomAiMembers.length) {
        await syncRoomAiMembers(created.roomId, newRoomAiMembers);
      }
      const nextRoom = await onRoomsChanged(created?.roomId);
      if (nextRoom?.id) onRoomSelect(nextRoom.id);
      updateSidebarMode("conversations");
      setMobileSidebarOpen(false);
      setCreateRoomOpen(false);
      setNewRoomName("");
      setNewRoomAiMembers([]);
    } catch (error) {
      setCreateRoomError(getApiErrorMessage(error, "新建房间失败"));
    } finally {
      setCreateRoomBusy(false);
    }
  }

  async function handleRenameConversation(conversationId, nextTitle) {
    const normalizedTitle = String(nextTitle || "").trim();
    const normalizedConversationId = Number(conversationId);
    const mainConversationId = Number(room?.mainConversationId || room?.conversationId || 0);
    if (readOnly || !normalizedConversationId || (mainConversationId && normalizedConversationId === mainConversationId)) return;
    if (!normalizedTitle) throw new Error("对话名不能为空");
    try {
      await renameConversation(normalizedConversationId, normalizedTitle);
    } finally {
      await onRoomsChanged(room?.roomId);
    }
  }

  function resolveSectionMotion(timing) {
    if (resolvedTransitionMode === "enter" && timing) {
      return {
        initial: { opacity: 0, x: timing.x || 0, y: timing.y || 0 },
        animate: { opacity: 1, x: 0, y: 0 },
        transition: { delay: timing.delay || 0, duration: timing.duration || 0.24, ease: EASE }
      };
    }
    if (resolvedTransitionMode === "exit" && timing) {
      return {
        initial: false,
        animate: { opacity: 0, x: timing.x || 0, y: timing.y || 0 },
        transition: { delay: timing.delay || 0, duration: timing.duration || 0.2, ease: EASE }
      };
    }
    return {
      initial: false,
      animate: { opacity: 1, x: 0, y: 0 },
      transition: { duration: 0.18, ease: EASE }
    };
  }

  const headerMotion = resolveSectionMotion(transitionConfig?.header);
  const messagesMotion = resolveSectionMotion(transitionConfig?.messages);
  const roomPlaceLabel = room?.placeLabel || (roomTone === "public" ? "公共大厅" : "个人空间");
  const roomAtmosphere = room?.atmosphere || roomHint || "写下一个想法，让讨论从这里开始。";
  const currentModelLabel = isConversationModelLoading ? "团队同步中" : activeConversationModelLabel;
  const emptyTitle = room?.emptyTitle || (roomTone === "public" ? "大厅正在等待新的讨论" : "这里还很安静");
  const emptyHint = room?.emptyHint || roomHint || "写下一个想法，让讨论从这里开始。";
  const emptySuggestions = roomTone === "public"
    ? ["提出一个公共问题", "贴出材料和判断", "沉淀阶段结论"]
    : ["写下研究对象", "让 DeepSeek 接入推演", "保存待整理结论"];
  const composerPlaceholder = isOrdinaryMainConversation
    ? "在主对话发言，可 @AI"
    : room?.composerPlaceholder || "输入消息，按 Enter 发送";
  const roomConversationCount = Math.max(roomConversations.length || 0, 1);
  const selectedConversation = activeConversation || roomConversations.find((item) => item.id === activeConversationId);
  const activeConversationTitle = isHomeDashboard
    ? "Home"
    : isMainConversation
    ? roomName
    : selectedConversation?.name || (activeConversationId ? `对话 ${activeConversationId}` : "对话");
  const mentionQuery = isOrdinaryMainConversation ? getMentionQuery(messageDraft) : null;
  const mainComposerTopSlot = mentionQuery != null && roomAiMembers.length ? (
    <MainConversationMentionReserve
      query={mentionQuery}
      aiMembers={roomAiMembers}
      onPick={insertAiMention}
    />
  ) : null;
  const newRoomAiOptions = mergeAiMemberOptions(availableAis, newRoomAiMembers);
  const currentMoment =
    workspacePanelOpen || accountCenterOpen ? "tooling"
      : isHomeDashboard ? "home"
      : !visibleMessages.length ? "arriving"
        : "thinking";
  const conversationTeamError =
    aiConfigError?.conversation ||
    aiConfigError?.room ||
    aiConfigError?.thinking ||
    "";
  const stageInitial = resolvedTransitionMode === "idle" ? false : messagesMotion.initial;
  const stageAnimate = resolvedTransitionMode === "idle" ? { opacity: 1 } : messagesMotion.animate;
  const stageTransition = resolvedTransitionMode === "idle" ? { duration: 0 } : messagesMotion.transition;

  return (
    <div className={`shell is-moment-${currentMoment} ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <button
        type="button"
        className="mobile-menu-btn"
        onClick={() => setMobileSidebarOpen((v) => !v)}
        aria-label="菜单"
        aria-expanded={mobileSidebarOpen}
        aria-controls="atrium-sidebar-panel"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 5h14M3 10h14M3 15h14"/>
        </svg>
      </button>

      <div className={`sidebar-overlay ${mobileSidebarOpen ? "is-open" : ""}`} onClick={() => setMobileSidebarOpen(false)} />

      <div id="atrium-sidebar-panel" className={`sidebar-wrapper ${mobileSidebarOpen ? "is-open" : ""}`}>
        <Sidebar
          nickname={nickname}
          username={username}
          avatarUrl={avatarUrl}
          onLogout={onLogout}
          shouldAnimateEntry={false}
          transitionMode={resolvedTransitionMode}
          motionTiming={transitionConfig?.sidebar}
          readOnly={readOnly}
          rooms={rooms}
          activeRoomId={activeRoomId}
          onRoomSelect={(id) => { onRoomSelect(id); setMobileSidebarOpen(false); }}
          roomName={roomName}
          mode={sidebarMode}
          onModeChange={updateSidebarMode}
          room={room}
          conversations={roomConversations}
          activeConversationId={activeConversationId}
          onConversationSelect={(id) => { onConversationSelect(id); setMobileSidebarOpen(false); }}
          onCreateConversation={onCreateConversationDraft}
          onRenameConversation={handleRenameConversation}
          onDeleteConversation={onDeleteConversation}
          onCreateRoom={openCreateRoom}
          onOpenRoomManagement={(roomId, tab) => openWorkspace(roomId, tab)}
          onOpenAccountCenter={openAccountCenter}
          accountNotificationCount={accountNotificationCount}
        />
      </div>

      <button
        type="button"
        className="sidebar-collapse-btn focus-ring"
        onClick={() => setSidebarCollapsed((value) => !value)}
        aria-label={sidebarCollapsed ? "打开侧边栏" : "收起侧边栏"}
        aria-expanded={!sidebarCollapsed}
        title={sidebarCollapsed ? "打开侧边栏" : "收起侧边栏"}
      >
        <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {sidebarCollapsed ? (
            <path d="M6.2 4.2 10.5 8.5l-4.3 4.3" />
          ) : (
            <path d="m10.8 4.2-4.3 4.3 4.3 4.3" />
          )}
          <path d="M3.4 3.2v10.6" />
        </svg>
      </button>

      <main className="main">
        <motion.header
          className={`header ${isHeaderScrolled ? "is-scrolled" : ""} is-connection-${connectionState} ${isOrdinaryMainConversation ? "is-main-timeline" : ""} ${isHomeDashboard ? "is-home-dashboard" : ""}`}
          initial={headerMotion.initial}
          animate={headerMotion.animate}
          transition={headerMotion.transition}
        >
          <div className="header-inner">
            <div className="room-heading" title={roomHint || roomAtmosphere}>
              <div className="room-anchor">
                <div className="room-title-button" aria-label="当前对话">
                  <span className="room-name">{activeConversationTitle}</span>
                  {isOrdinaryMainConversation ? <span className="room-topic">{roomAtmosphere}</span> : null}
                </div>
                <span className="room-anchor-meta">
                  <span>{isOrdinaryMainConversation ? roomPlaceLabel : roomName}</span>
                  <span>{roomConversationCount} 段{isOrdinaryMainConversation ? "公共历史" : "记忆"}</span>
                </span>
              </div>
              {connectionState !== "connected" ? <HeaderStatus modelLabel={currentModelLabel} connectionState={connectionState} /> : null}
            </div>
            <div className="header-actions">
              {isOrdinaryMainConversation ? (
                <button
                  type="button"
                  className="header-icon-button is-note-entry focus-ring"
                  onClick={openNoteEntry}
                  disabled={readOnly}
                  aria-label="笔记"
                  title="笔记"
                >
                  <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4.3 2.8h5.9l2.5 2.5v8.9H4.3z" />
                    <path d="M10.1 2.9v2.5h2.5M6.1 8.2h4.8M6.1 10.9h3.3" />
                  </svg>
                </button>
              ) : null}
              <button
                type="button"
                className="header-icon-button focus-ring"
                onClick={() => {
                  openWorkspace(activeRoomId, workspacePanelTab);
                }}
                disabled={readOnly}
                aria-label="打开房间、成员与笔记"
                title="打开房间、成员与笔记"
              >
                <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3.2 4.7h10.6M3.2 8.5h10.6M3.2 12.3h10.6" />
                  <path d="M6.1 3.1v3.2M10.9 6.9v3.2M8.3 10.7v3.2" />
                </svg>
              </button>
            </div>
          </div>
        </motion.header>

        <motion.div
          key={draftConversation ? "draft" : `${activeRoomId}-${activeConversationId || "main"}`}
          className={`messages-stage is-${roomTone} ${isOrdinaryMainConversation ? "is-main-timeline" : ""} ${isHomeDashboard ? "is-home-dashboard" : ""} ${roomTransition ? "is-switching" : ""}`}
          initial={stageInitial}
          animate={stageAnimate}
          transition={stageTransition}
        >
          {isOrdinaryMainConversation && !draftConversation ? (
            <MainConversationSeatline
              room={room}
              members={mainRoomMembers}
              membersState={mainRoomMembersState}
              currentUserId={currentUserId}
              fallbackMember={fallbackSeatMember}
              aiMembers={roomAiMembers}
              thinkingAdapters={thinkingAdapters}
              compact={Boolean(visibleMessages.length)}
              onOpenMembers={() => openWorkspace(activeRoomId, "members")}
              onOpenAi={() => openWorkspace(activeRoomId, "ai")}
            />
          ) : null}
          {isHomeDashboard ? (
            <HomeDashboard
              nickname={nickname}
              room={room}
              rooms={rooms}
              roomAiMembersByRoomId={roomAiMembersByRoomId}
              onOpenConversation={onNavigateConversation}
              onCreateConversation={onCreateConversationDraft}
              onOpenAi={() => openWorkspace(activeRoomId, "ai")}
            />
          ) : draftConversation ? (
            <div className="empty-state empty-state--ai-start">
              <ConversationPrepPanel
                isVisible={true}
                roomAiMembers={roomAiMembers}
                conversationAiMembers={draftConversation.aiMembers}
                availableAis={availableAis}
                thinkingAdapters={thinkingAdapters}
                readOnly={readOnly}
                onChangeTeam={onDraftAiMembersChange}
                loadError={aiConfigError?.room || aiConfigError?.thinking || ""}
              />
            </div>
          ) : (
            <MessageList
              messages={visibleMessages}
              assistantState={assistantState}
              onScrolled={onScrolled}
              hiddenMessageId={hiddenMessageId}
              shouldAnimateEntry={false}
              itemAnimationMode="calm"
              isFading={isFading}
              fadeDuration={fadeDuration}
              viewportRef={messagesViewportRef}
              renderEmpty={hideMessageContent ? () => null : () => (
                isOrdinaryMainConversation ? (
                  <div className={`empty-state empty-state--room is-main-conversation is-${roomTone}`}>
                    <MainConversationCover
                      roomPlaceLabel={roomPlaceLabel}
                      title={roomAtmosphere}
                      topic={room?.description || emptyHint}
                      aiMembers={roomAiMembers}
                      onOpenAi={() => openWorkspace(activeRoomId, "ai")}
                    />
                  </div>
                ) : (
                  <div className={`empty-state empty-state--room is-${roomTone}`}>
                    <div className="empty-copy">
                      <div className="empty-kicker">{roomPlaceLabel}</div>
                      <div className="empty-title">{emptyTitle}</div>
                      <div className="empty-hint">{emptyHint}</div>
                      <div className="empty-prompt-rail" aria-label="讨论起点">
                        {emptySuggestions.map((item) => <span key={item}>{item}</span>)}
                      </div>
                    </div>
                  </div>
                )
                )
              }
              onContextMenu={handleMessageContextMenu}
              hasMoreHistory={hasMoreHistory && !hideMessageContent}
            historyInitialLoading={historyInitialLoading && !hideMessageContent}
            historyLoading={historyLoading && !hideMessageContent}
            historyError={hideMessageContent ? "" : historyError}
            onLoadMoreHistory={onLoadMoreHistory}
            />
          )}
        </motion.div>

        {isHomeDashboard ? null : (
          <MessageInput
            value={messageDraft}
            onChange={onMessageDraftChange}
            onSend={onSend}
            disabled={composerDisabled}
            attachment={messageAttachment}
            error={composerError}
            composerFieldRef={composerFieldRef}
            shouldAnimateEntry={false}
            transitionMode={resolvedTransitionMode}
            motionTiming={transitionConfig?.composer}
            readOnly={readOnly}
            placeholder={composerPlaceholder}
            topSlot={mainComposerTopSlot}
            onPasteImage={onPasteImage}
            onRemoveAttachment={onRemoveAttachment}
          />
        )}

      </main>

      {readOnly ? null : (
        <MessageFlight flight={messageFlight} onComplete={onMessageFlightComplete} />
      )}

      <WorkspacePanel
        isOpen={workspacePanelOpen && !readOnly}
        onClose={() => {
          setWorkspacePanelOpen(false);
          writeStoredChatSurface({ workspacePanelOpen: false, workspacePanelTab });
        }}
        currentUserId={currentUserId}
        room={room}
        readOnly={readOnly}
        activeTab={workspacePanelTab}
        onTabChange={(tab) => {
          setWorkspacePanelTab(tab);
          writeStoredChatSurface({ workspacePanelOpen: true, workspacePanelTab: tab });
        }}
        onRoomsChanged={onRoomsChanged}
        activeConversationModelLabel={activeConversationModelLabel}
        isConversationModelLoading={isConversationModelLoading}
        activeConversation={activeConversation}
        isMainConversation={isMainConversation}
        roomAiMembers={roomAiMembers}
        conversationAiMembers={conversationAiMembers}
        availableAis={availableAis}
        thinkingAdapters={thinkingAdapters}
        aiConfigError={aiConfigError}
        onRoomAiMembersSave={onRoomAiMembersSave}
        onConversationAiMembersChange={onConversationAiMembersChange}
      />

      <AccountCenterPanel
        isOpen={accountCenterOpen && !readOnly}
        onClose={() => setAccountCenterOpen(false)}
        currentUserId={currentUserId}
        nickname={nickname}
        username={username}
        avatarUrl={avatarUrl}
        onProfileUpdate={onProfileUpdate}
        readOnly={readOnly}
        onRoomsChanged={onRoomsChanged}
        onNotificationCountChange={setAccountNotificationCount}
      />

      <ModalLayer
        isOpen={createRoomOpen && !readOnly}
        title="新建房间"
        subtitle="先命名房间，再配置默认 AI 阵容"
        onClose={closeCreateRoom}
      >
        <div className="ai-create-room">
          <label className="ai-create-room-name">
            <span>房间名</span>
            <input
              className="workspace-input"
              value={newRoomName}
              onChange={(event) => {
                setNewRoomName(event.target.value);
                setCreateRoomError("");
              }}
              placeholder="例如：项目复盘"
              maxLength={32}
              disabled={createRoomBusy}
            />
          </label>
          <div className="ai-create-room-main">
            <AiModelSelector
              models={newRoomAiOptions}
              members={newRoomAiMembers}
              thinkingAdapters={thinkingAdapters}
              readOnly={createRoomBusy}
              onChange={updateNewRoomAiMembers}
              className="is-room-create"
            />
          </div>
          <div className="ai-create-room-seats">
            <AiSeatStrip
              members={newRoomAiMembers}
              thinkingAdapters={thinkingAdapters}
              readOnly={createRoomBusy}
              onChange={updateNewRoomAiMembers}
              emptyText="无 AI"
            />
          </div>
          {createRoomError ? <div className="create-conversation-error">{createRoomError}</div> : null}
          <div className="ai-create-room-actions">
            <motion.button
              type="button"
              className="workspace-action is-primary"
              onClick={handleCreateRoom}
              disabled={createRoomBusy || !newRoomName.trim()}
              whileTap={createRoomBusy || !newRoomName.trim() ? undefined : { scale: 0.98 }}
            >
              {createRoomBusy ? "处理中" : "创建"}
            </motion.button>
          </div>
        </div>
      </ModalLayer>

      <AnimatePresence>
        {noteToast ? (
          <motion.div
            key={noteToast.id}
            className="note-capture-toast"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.18, ease: EASE }}
            role="status"
            aria-live="polite"
          >
            <div className="note-capture-title">已摘录到笔记草稿</div>
            <div className="note-capture-preview">{noteToast.text}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {contextMenu ? (
          <motion.div
            key="ctx-menu"
            className="context-menu"
            style={{ left: contextMenu.x, top: contextMenu.y }}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.12, ease: EASE }}
            role="menu"
          >
            <button type="button" className="context-menu-item" onClick={copyMessageText} role="menuitem">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="3" width="8" height="10" rx="1"/>
                <path d="M3 5h-.5a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5h7a.5.5 0 0 0 .5-.5V12"/>
              </svg>
              复制原文
            </button>
            <button type="button" className="context-menu-item is-note" onClick={excerptMessageToNote} role="menuitem">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 2.5h6.8L13 4.7V13a.8.8 0 0 1-.8.8H4A.8.8 0 0 1 3.2 13V3.3A.8.8 0 0 1 4 2.5Z"/>
                <path d="M10.7 2.7V4.8H13M5.4 7.2h5.2M5.4 9.6h3.9"/>
              </svg>
              摘录到笔记
            </button>
            <button type="button" className="context-menu-item is-danger" onClick={deleteMessageFromView} role="menuitem">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 4h12M5.33 4V2.67a.67.67 0 0 1 .67-.67h4a.67.67 0 0 1 .67.67V4M6.67 7.33v4M9.33 7.33v4"/>
                <path d="M3.33 4l.87 8.67a.67.67 0 0 0 .67.6h6.27a.67.67 0 0 0 .67-.6L12.67 4"/>
              </svg>
              从本地移除
            </button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
