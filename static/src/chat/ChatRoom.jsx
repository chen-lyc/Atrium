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
import NoteCaptureToast from "./NoteCaptureToast.jsx";
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
import HomeDashboard, {
  getHomeObjectKey,
  normalizeHomeVisitCount,
  readStoredHomeVisitStats,
  writeStoredHomeVisitStats
} from "./HomeDashboard.jsx";

const NOTE_TOAST_MS = 2200;
const CHAT_SURFACE_STORAGE_KEY = "atrium.chat.surface";
const ROLE_LABELS = {
  0: "房主",
  1: "管理员",
  2: "成员"
};
const MAIN_SEATLINE_MEMBER_LIMIT = 5;
const MAIN_SEATLINE_AI_LIMIT = 5;
const SIDEBAR_SURFACE_HOME = "home";
const SIDEBAR_SURFACE_DEFAULT = "default";
const AGENT_PROPOSAL_EVENTS = ["atrium-agent-proposal", "atrium-agent-proposals"];

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

function normalizeAgentDecisionProposal(raw, fallback) {
  if (!raw || typeof raw !== "object") return null;
  const roomId = raw.roomId ?? raw.room_id ?? fallback.roomId;
  const conversationId = raw.conversationId ?? raw.conversation_id ?? fallback.conversationId;
  const aiId = raw.aiId ?? raw.ai_id ?? "";
  const createdAt = raw.createdAt ?? raw.created_at ?? Date.now();
  const id = raw.id || raw.proposalId || raw.proposal_id || `agent-proposal-${conversationId || "conversation"}-${aiId || "ai"}-${createdAt}`;
  return {
    id: String(id),
    roomId,
    conversationId: Number(conversationId || 0),
    aiId: aiId === "" ? "" : String(aiId),
    provider: raw.provider || "",
    model: raw.model || "",
    displayName: raw.displayName || raw.display_name || raw.aiName || raw.ai_name || "",
    avatarUrl: raw.avatarUrl || raw.avatar_url || "",
    type: raw.type || raw.kind || "context",
    title: raw.title || raw.summary || raw.actionLabel || raw.action_label || "",
    reason: raw.reason || raw.shortReason || raw.short_reason || "",
    actionLabel: raw.actionLabel || raw.action_label || raw.suggestedAction || raw.suggested_action || "",
    rejectLabel: raw.rejectLabel || raw.reject_label || "",
    sourceLabel: raw.sourceLabel || raw.source_label || "",
    triggerMessageId: raw.triggerMessageId || raw.trigger_message_id || raw.messageId || raw.message_id || "",
    createdAt,
    previewKey: raw.previewKey || "",
    isPreview: Boolean(raw.isPreview)
  };
}

function isAgentProposalInContext(proposal, context) {
  if (!proposal) return false;
  const proposalConversationId = Number(proposal.conversationId || 0);
  if (proposalConversationId && context.conversationId && proposalConversationId !== Number(context.conversationId)) return false;
  if (proposal.roomId != null && proposal.roomId !== "") {
    const roomValue = String(proposal.roomId);
    const activeRoomValue = String(context.roomId || "");
    const backendRoomValue = context.backendRoomId ? String(context.backendRoomId) : "";
    if (roomValue !== activeRoomValue && (!backendRoomValue || roomValue !== backendRoomValue)) return false;
  }
  return true;
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

function getDefaultSidebarCollapsed(sidebarSurface) {
  return sidebarSurface === SIDEBAR_SURFACE_HOME;
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
  governanceAiIds = [],
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
              governanceAiIds={governanceAiIds}
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

function ConversationPrepPanel({
  isVisible,
  roomAiMembers = [],
  conversationAiMembers = [],
  availableAis = [],
  thinkingAdapters = [],
  readOnly = false,
  onCancel = () => {},
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
      <div className="conversation-prep-head">
        <button
          type="button"
          className="conversation-prep-back focus-ring"
          onClick={onCancel}
          aria-label="返回 Home"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M9.8 3.4 5.2 8l4.6 4.6" />
          </svg>
          <span>Home</span>
        </button>
        <span>新建对话</span>
      </div>
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
  onCancelConversationDraft = () => {},
  onCreateConversationDraft = async () => null,
  onConversationAiMembersChange = async () => [],
  onRoomAiMembersSave = async () => [],
  readOnly = false,
  isFading = false, fadeDuration = 600,
  transitionMode = "idle", transitionConfig = null,
  hideMessageContent = false,
  onPasteImage, onRemoveAttachment,
  hasMoreHistory = false, historyInitialLoading = false, historyLoading = false, historyError = "",
  onLoadMoreHistory,
  onOpenDesignLab = () => {},
  designLabLoading = false,
  designLabError = ""
}) {
  const hasComposerContent = Boolean(messageDraft.trim() || messageAttachment);
  const composerDisabled = readOnly ? false : !hasComposerContent || connectionState !== "connected";
  const resolvedTransitionMode =
    transitionMode === "enter-from-auth" ? "enter" : transitionMode === "exit-to-auth" ? "exit" : "idle";
  const visibleMessages = hideMessageContent ? [] : messages;
  const roomTone = room?.tone === "public" ? "public" : "personal";
  const activeBackendRoomId = Number(room?.roomId || 0);
  const isPersonalMainConversation = room?.id === "personal" || Number(room?.type) === 1;
  const isOrdinaryMainConversation = isMainConversation && !isPersonalMainConversation;
  const isHomeDashboard = isMainConversation && isPersonalMainConversation && !draftConversation;

  const [contextMenu, setContextMenu] = useState(null);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const initialChatSurfaceRef = useRef(null);
  if (initialChatSurfaceRef.current == null) initialChatSurfaceRef.current = readStoredChatSurface();
  const initialWorkspacePanelOpen = initialChatSurfaceRef.current.workspacePanelOpen === true;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const initialSurface = isHomeDashboard && !initialWorkspacePanelOpen ? SIDEBAR_SURFACE_HOME : SIDEBAR_SURFACE_DEFAULT;
    return getDefaultSidebarCollapsed(initialSurface);
  });
  const sidebarPreferenceRef = useRef({
    [SIDEBAR_SURFACE_HOME]: null,
    [SIDEBAR_SURFACE_DEFAULT]: null
  });
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
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(() => initialWorkspacePanelOpen);
  const [workspacePanelTab, setWorkspacePanelTab] = useState(() => {
    const tab = initialChatSurfaceRef.current.workspacePanelTab;
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
  const [homeVisitStats, setHomeVisitStats] = useState(() => readStoredHomeVisitStats(currentUserId));
  const [agentDecisionProposals, setAgentDecisionProposals] = useState([]);
  const fallbackSeatMember = {
    userId: currentUserId || "self",
    username,
    nickname: nickname || username || "我",
    avatarUrl,
    role: 2
  };
  const isPureHomeDashboard = isHomeDashboard && !workspacePanelOpen && !accountCenterOpen && !createRoomOpen;
  const sidebarSurface = isPureHomeDashboard ? SIDEBAR_SURFACE_HOME : SIDEBAR_SURFACE_DEFAULT;
  const agentProposalContext = {
    roomId: activeRoomId,
    backendRoomId: activeBackendRoomId,
    conversationId: Number(activeConversationId || 0)
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
    setHomeVisitStats(readStoredHomeVisitStats(currentUserId));
  }, [currentUserId]);

  useEffect(() => {
    const userPreference = sidebarPreferenceRef.current[sidebarSurface];
    setSidebarCollapsed(userPreference ?? getDefaultSidebarCollapsed(sidebarSurface));
  }, [sidebarSurface]);

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

  useEffect(() => {
    setAgentDecisionProposals((current) =>
      current.filter((proposal) => isAgentProposalInContext(proposal, agentProposalContext))
    );
  }, [activeRoomId, activeBackendRoomId, activeConversationId]);

  useEffect(() => {
    function readProposalDetails(detail) {
      if (Array.isArray(detail)) return detail;
      if (Array.isArray(detail?.proposals)) return detail.proposals;
      return detail ? [detail] : [];
    }

    function handleAgentProposal(event) {
      const incoming = readProposalDetails(event.detail)
        .map((detail) => normalizeAgentDecisionProposal(detail, agentProposalContext))
        .filter((proposal) => isAgentProposalInContext(proposal, agentProposalContext));
      if (!incoming.length) return;
      setAgentDecisionProposals((current) => {
        const base = incoming.some((proposal) => !proposal.isPreview)
          ? current.filter((proposal) => !proposal.isPreview)
          : current;
        const byId = new Map(base.map((proposal) => [proposal.id, proposal]));
        incoming.forEach((proposal) => byId.set(proposal.id, proposal));
        return Array.from(byId.values()).sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
      });
    }

    function handleAgentProposalClear(event) {
      const id = event.detail?.id || event.detail?.proposalId || event.detail?.proposal_id || "";
      if (id) {
        setAgentDecisionProposals((current) => current.filter((proposal) => proposal.id !== String(id)));
        return;
      }
      setAgentDecisionProposals([]);
    }

    AGENT_PROPOSAL_EVENTS.forEach((eventName) => window.addEventListener(eventName, handleAgentProposal));
    window.addEventListener("atrium-agent-proposal-clear", handleAgentProposalClear);
    return () => {
      AGENT_PROPOSAL_EVENTS.forEach((eventName) => window.removeEventListener(eventName, handleAgentProposal));
      window.removeEventListener("atrium-agent-proposal-clear", handleAgentProposalClear);
    };
  }, [activeRoomId, activeBackendRoomId, activeConversationId]);

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

  function resolveAgentDecisionProposal(proposal, resolution, convertTo = "") {
    if (!proposal) return;
    setAgentDecisionProposals((current) => current.filter((item) => item.id !== proposal.id));
    window.dispatchEvent(new CustomEvent("atrium-agent-proposal-decision", {
      detail: {
        proposalId: proposal.id,
        resolution,
        convertTo,
        roomId: activeRoomId,
        conversationId: activeConversationId,
        type: proposal.type || "context"
      }
    }));
  }

  function recordHomeConversationVisit(roomId, conversationId) {
    const normalizedConversationId = Number(conversationId || 0);
    if (!roomId || !normalizedConversationId) return;
    const homeRoom = Array.isArray(rooms) ? rooms.find((item) => item.id === "personal" || item.type === 1) : null;
    const homeMainConversationId = homeRoom?.mainConversationId || homeRoom?.conversationId || 0;
    if (homeRoom?.id === roomId && normalizedConversationId === homeMainConversationId) return;
    const objectKey = getHomeObjectKey(roomId, normalizedConversationId);
    setHomeVisitStats((current) => {
      const currentEntry = current[objectKey] || {};
      const nextStats = {
        ...current,
        [objectKey]: {
          lastVisitedAtMs: Date.now(),
          visitCount: normalizeHomeVisitCount(currentEntry.visitCount) + 1
        }
      };
      writeStoredHomeVisitStats(currentUserId, nextStats);
      return nextStats;
    });
  }

  function handleActiveRoomSelect(roomId) {
    const nextRoom = Array.isArray(rooms) ? rooms.find((item) => item.id === roomId) : null;
    const nextConversationId = nextRoom?.mainConversationId || nextRoom?.conversationId || 0;
    const isAlreadyOpen = nextRoom?.id === activeRoomId && nextConversationId === activeConversationId;
    if (nextRoom?.id && nextConversationId && !isAlreadyOpen) {
      recordHomeConversationVisit(nextRoom.id, nextConversationId);
    }
    onRoomSelect(roomId);
  }

  function handleActiveConversationSelect(conversationId) {
    if (activeRoomId && conversationId && conversationId !== activeConversationId) {
      recordHomeConversationVisit(activeRoomId, conversationId);
    }
    onConversationSelect(conversationId);
  }

  function handleHomeObjectOpen(roomId, conversationId) {
    recordHomeConversationVisit(roomId, conversationId);
    onNavigateConversation(roomId, conversationId);
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
  const visibleAgentDecisionProposals = hideMessageContent
    ? []
    : agentDecisionProposals.filter((proposal) => isAgentProposalInContext(proposal, agentProposalContext));
  const agentProposalAiIds = visibleAgentDecisionProposals
    .map((proposal) => proposal.aiId)
    .filter(Boolean);

  return (
    <div className={`shell is-moment-${currentMoment} ${draftConversation ? "is-ai-draft" : ""} ${sidebarCollapsed ? "is-sidebar-collapsed" : ""}`}>
      <button
        type="button"
        className={`mobile-menu-btn ${mobileSidebarOpen ? "is-open" : ""}`}
        onClick={() => setMobileSidebarOpen((v) => !v)}
        aria-label={mobileSidebarOpen ? "关闭菜单" : "打开菜单"}
        aria-expanded={mobileSidebarOpen}
        aria-controls="atrium-sidebar-panel"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          {mobileSidebarOpen ? (
            <path d="M5 5l10 10M15 5 5 15" />
          ) : (
            <path d="M3 5h14M3 10h14M3 15h14" />
          )}
        </svg>
      </button>

      <div className={`sidebar-overlay ${mobileSidebarOpen ? "is-open" : ""}`} onClick={() => setMobileSidebarOpen(false)} />

      <div id="atrium-sidebar-panel" className={`sidebar-wrapper ${mobileSidebarOpen ? "is-open" : ""}`}>
        <button
          type="button"
          className="mobile-sidebar-close-btn focus-ring"
          onClick={() => setMobileSidebarOpen(false)}
          aria-label="关闭菜单"
        >
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <path d="M4.5 4.5 13.5 13.5M13.5 4.5 4.5 13.5" />
          </svg>
        </button>
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
          onRoomSelect={(id) => { handleActiveRoomSelect(id); setMobileSidebarOpen(false); }}
          roomName={roomName}
          mode={sidebarMode}
          onModeChange={updateSidebarMode}
          room={room}
          conversations={roomConversations}
          activeConversationId={activeConversationId}
          onConversationSelect={(id) => { handleActiveConversationSelect(id); setMobileSidebarOpen(false); }}
          onCreateConversation={async () => { await onCreateConversationDraft(); setMobileSidebarOpen(false); }}
          onRenameConversation={handleRenameConversation}
          onDeleteConversation={onDeleteConversation}
          onCreateRoom={() => { openCreateRoom(); setMobileSidebarOpen(false); }}
          onOpenRoomManagement={(roomId, tab) => { openWorkspace(roomId, tab); setMobileSidebarOpen(false); }}
          onOpenAccountCenter={() => { openAccountCenter(); setMobileSidebarOpen(false); }}
          accountNotificationCount={accountNotificationCount}
        />
      </div>

      <button
        type="button"
        className="sidebar-collapse-btn focus-ring"
        onClick={() => setSidebarCollapsed((value) => {
          const nextValue = !value;
          sidebarPreferenceRef.current[sidebarSurface] = nextValue;
          return nextValue;
        })}
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
          className={`messages-stage is-${roomTone} ${isOrdinaryMainConversation ? "is-main-timeline" : ""} ${isHomeDashboard ? "is-home-dashboard" : ""} ${roomTransition ? "is-switching" : ""} ${visibleAgentDecisionProposals.length ? "has-agent-proposals" : ""}`}
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
              governanceAiIds={agentProposalAiIds}
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
              availableAis={availableAis}
              thinkingAdapters={thinkingAdapters}
              aiConfigError={aiConfigError}
              readOnly={readOnly}
              currentUserId={currentUserId}
              homeVisitStats={homeVisitStats}
              onOpenConversation={handleHomeObjectOpen}
              onCreateConversation={onCreateConversationDraft}
              onRoomAiMembersSave={onRoomAiMembersSave}
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
                onCancel={onCancelConversationDraft}
                onChangeTeam={onDraftAiMembersChange}
                loadError={aiConfigError?.room || aiConfigError?.thinking || ""}
              />
            </div>
          ) : (
            <MessageList
              messages={visibleMessages}
              assistantState={assistantState}
              aiMembers={effectiveAiMembers}
              onScrolled={onScrolled}
              hiddenMessageId={hiddenMessageId}
              shouldAnimateEntry={false}
              itemAnimationMode="calm"
              isFading={isFading}
              fadeDuration={fadeDuration}
              viewportRef={messagesViewportRef}
              emptyLayerClassName={draftConversation ? "is-ai-start" : ""}
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
              agentDecisionProposals={visibleAgentDecisionProposals}
              onAgentProposalAccept={(proposal) => resolveAgentDecisionProposal(proposal, "accepted")}
              onAgentProposalReject={(proposal) => resolveAgentDecisionProposal(proposal, "rejected")}
              onAgentProposalConvert={(proposal, convertTo) => resolveAgentDecisionProposal(proposal, "converted", convertTo)}
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
        onOpenDesignLab={() => {
          setAccountCenterOpen(false);
          onOpenDesignLab();
        }}
        designLabLoading={designLabLoading}
        designLabError={designLabError}
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

      <NoteCaptureToast toast={noteToast} />

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
