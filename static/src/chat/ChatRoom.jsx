import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EASE, STATUS_LABEL } from "../constants.js";
import {
  getApiErrorMessage
} from "../utils.js";
import Sidebar from "./Sidebar.jsx";
import MessageList from "./MessageList.jsx";
import MessageInput from "./MessageInput.jsx";
import MessageFlight from "./MessageFlight.jsx";
import WorkspacePanel from "./WorkspacePanel.jsx";
import { AiModelSelector, AiSeatStrip, mergeAiMemberOptions } from "./AiTeamEditor.jsx";

const NOTE_TOAST_MS = 2200;
const CHAT_SURFACE_STORAGE_KEY = "atrium.chat.surface";

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

function RoomMemoryLayer({
  isOpen,
  room,
  roomName,
  conversations = [],
  activeConversationId,
  onClose,
  onSelect,
  onDelete,
  onCreate,
  createBusy = false,
  error = "",
  readOnly = false
}) {
  const roomTone = room?.tone === "public" ? "public" : "personal";
  const activeConversation = conversations.find((item) => item.id === activeConversationId);
  const mainConversationId = room?.mainConversationId;

  return (
    <AnimatePresence>
      {isOpen ? (
        <motion.div
          key="room-memory"
          className={`room-memory-layer is-${roomTone}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: EASE }}
          role="region"
          aria-labelledby="room-memory-title"
        >
          <motion.section
            id="room-memory-panel"
            className="room-memory-surface"
            initial={{ opacity: 0, y: -6, scale: 0.995 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.998 }}
            transition={{ duration: 0.18, ease: EASE }}
          >
            <header className="room-memory-header">
              <div>
                <span className="room-memory-kicker">{roomName}</span>
                <h2 id="room-memory-title">房间记忆</h2>
                <p>{activeConversation?.name || `对话 ${activeConversationId || 1}`}</p>
              </div>
              <button type="button" className="room-memory-close focus-ring" onClick={onClose} aria-label="关闭房间记忆">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            </header>

            <div className="room-memory-list" aria-label="当前房间的对话">
              {conversations.length ? conversations.map((conversation) => {
                const isActive = conversation.id === activeConversationId;
                const title = conversation.name || `对话 ${conversation.id}`;
                return (
                  <div key={conversation.id} className={`room-memory-row ${isActive ? "is-active" : ""}`}>
                    <button
                      type="button"
                      className="room-memory-select focus-ring"
                      onClick={() => {
                        onSelect(conversation.id);
                        onClose();
                      }}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <span>{title}</span>
                      <small>{conversation.id === mainConversationId ? "主对话" : `#${conversation.id}`}</small>
                    </button>
                    {conversation.id !== mainConversationId ? (
                      <button
                        type="button"
                        className="room-memory-delete focus-ring"
                        onClick={() => onDelete(conversation.id)}
                        aria-label={`删除对话 ${title}`}
                        title="删除对话"
                      >
                        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                          <path d="M4 4l6 6M10 4l-6 6" />
                        </svg>
                      </button>
                    ) : null}
                  </div>
                );
              }) : (
                <div className="room-memory-empty">当前房间还只有主对话</div>
              )}
            </div>

            <button
              type="button"
              className="room-memory-create focus-ring"
              onClick={onCreate}
              disabled={readOnly || createBusy}
            >
              <span>{createBusy ? "创建中" : "新建讨论"}</span>
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                <path d="M7 2.5v9M2.5 7h9" />
              </svg>
            </button>
            {error ? <div className="room-memory-error">{error}</div> : null}
          </motion.section>
        </motion.div>
      ) : null}
    </AnimatePresence>
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
  onConversationSelect = () => {}, onDeleteConversation = () => {},
  draftConversation = null,
  onDraftAiMembersChange = async () => [],
  onCreateConversationDraft = async () => null,
  onConversationAiMembersChange = async () => [],
  onRoomAiMembersSave = async () => [],
  readOnly = false, suppressConnectionPulse = false,
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
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(() => readStoredChatSurface().workspacePanelOpen === true);
  const [workspacePanelTab, setWorkspacePanelTab] = useState(() => {
    const tab = readStoredChatSurface().workspacePanelTab;
    return ["room", "ai", "members", "contacts"].includes(tab) ? tab : "room";
  });
  const [roomMemoryOpen, setRoomMemoryOpen] = useState(false);
  const [createConversationBusy, setCreateConversationBusy] = useState(false);
  const [createConversationError, setCreateConversationError] = useState("");
  const [noteToast, setNoteToast] = useState(null);
  const noteToastTimerRef = useRef(null);

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
    if (!roomMemoryOpen) return undefined;
    function handlePointerDown(event) {
      if (event.target?.closest?.(".room-memory-surface")) return;
      if (event.target?.closest?.(".room-anchor")) return;
      setRoomMemoryOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") setRoomMemoryOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [roomMemoryOpen]);

  useEffect(() => {
    setRoomMemoryOpen(false);
    setCreateConversationError("");
  }, [activeRoomId]);

  useEffect(() => {
    return () => {
      window.clearTimeout(noteToastTimerRef.current);
    };
  }, []);

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

  async function handleCreateConversationDraft() {
    if (createConversationBusy || readOnly) return;
    setCreateConversationBusy(true);
    setCreateConversationError("");
    try {
      const created = await onCreateConversationDraft();
      if (created?.conversationId || created?.isDraft) {
        setRoomMemoryOpen(false);
        if (created.warning) setCreateConversationError(created.warning);
      }
    } catch (err) {
      setContextMenu(null);
      setCreateConversationError(getApiErrorMessage(err, "新讨论创建失败"));
    } finally {
      setCreateConversationBusy(false);
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
  const roomTone = room?.tone === "public" ? "public" : "personal";
  const roomPlaceLabel = room?.placeLabel || (roomTone === "public" ? "公共大厅" : "个人空间");
  const roomAtmosphere = room?.atmosphere || roomHint || "写下一个想法，让讨论从这里开始。";
  const currentModelLabel = isConversationModelLoading ? "团队同步中" : activeConversationModelLabel;
  const actualMessageCount = visibleMessages.filter((message) => message.nickname !== "__system__").length;
  const shouldShowConversationPrep = false;
  const emptyTitle = room?.emptyTitle || (roomTone === "public" ? "大厅正在等待新的讨论" : "这里还很安静");
  const emptyHint = room?.emptyHint || roomHint || "写下一个想法，让讨论从这里开始。";
  const emptySuggestions = roomTone === "public"
    ? ["提出一个公共问题", "贴出材料和判断", "沉淀阶段结论"]
    : ["写下研究对象", "让 DeepSeek 接入推演", "保存待整理结论"];
  const composerPlaceholder = room?.composerPlaceholder || "输入消息，按 Enter 发送";
  const roomConversationCount = Math.max(roomConversations.length || 0, 1);
  const selectedConversation = activeConversation || roomConversations.find((item) => item.id === activeConversationId);
  const activeConversationTitle = selectedConversation?.name || (activeConversationId ? `对话 ${activeConversationId}` : "主对话");
  const currentMoment =
    workspacePanelOpen ? "tooling"
      : roomMemoryOpen ? "switching"
        : !visibleMessages.length ? "arriving"
          : "thinking";
  const conversationTeamError =
    createConversationError ||
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
          onProfileUpdate={onProfileUpdate}
          onLogout={onLogout}
          shouldAnimateEntry={false}
          transitionMode={resolvedTransitionMode}
          motionTiming={transitionConfig?.sidebar}
          readOnly={readOnly}
          rooms={rooms}
          activeRoomId={activeRoomId}
          onRoomSelect={(id) => { onRoomSelect(id); setMobileSidebarOpen(false); }}
          roomName={roomName}
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
          className={`header ${isHeaderScrolled ? "is-scrolled" : ""}`}
          initial={headerMotion.initial}
          animate={headerMotion.animate}
          transition={headerMotion.transition}
        >
          <div className="header-inner">
            <div className="room-heading" title={roomHint || roomAtmosphere}>
              <button
                type="button"
                className="room-anchor focus-ring"
                onClick={() => setRoomMemoryOpen((value) => !value)}
                disabled={readOnly}
                aria-label={`${roomMemoryOpen ? "关闭" : "打开"}${roomName}的房间记忆`}
                aria-expanded={roomMemoryOpen}
                aria-haspopup="true"
                aria-controls="room-memory-panel"
                title={roomMemoryOpen ? "关闭房间记忆" : "打开房间记忆"}
              >
                <span className="room-name">{roomName}</span>
                <span className="room-anchor-meta">
                  <span>{activeConversationTitle}</span>
                  <span>{roomConversationCount} 段记忆</span>
                </span>
              </button>
              <HeaderStatus modelLabel={currentModelLabel} connectionState={connectionState} />
            </div>
            <div className="header-actions">
              <button
                type="button"
                className="header-icon-button focus-ring"
                onClick={() => {
                  setWorkspacePanelOpen(true);
                  writeStoredChatSurface({ workspacePanelOpen: true, workspacePanelTab });
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
          className={`messages-stage is-${roomTone} ${roomTransition ? "is-switching" : ""}`}
          initial={stageInitial}
          animate={stageAnimate}
          transition={stageTransition}
        >
          {draftConversation ? (
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
                shouldShowConversationPrep ? (
                  <div className="empty-state empty-state--ai-start">
                    <ConversationPrepPanel
                      isVisible={shouldShowConversationPrep}
                      roomAiMembers={roomAiMembers}
                      conversationAiMembers={conversationAiMembers}
                      availableAis={availableAis}
                      thinkingAdapters={thinkingAdapters}
                      readOnly={readOnly}
                      onChangeTeam={onConversationAiMembersChange}
                      loadError={conversationTeamError}
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
              )}
              onContextMenu={handleMessageContextMenu}
              hasMoreHistory={hasMoreHistory && !hideMessageContent}
            historyInitialLoading={historyInitialLoading && !hideMessageContent}
            historyLoading={historyLoading && !hideMessageContent}
            historyError={hideMessageContent ? "" : historyError}
            onLoadMoreHistory={onLoadMoreHistory}
            />
          )}
        </motion.div>

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
          onPasteImage={onPasteImage}
          onRemoveAttachment={onRemoveAttachment}
        />

        <RoomMemoryLayer
          isOpen={roomMemoryOpen && !readOnly}
          room={room}
          roomName={roomName}
          conversations={roomConversations}
          activeConversationId={activeConversationId}
          onClose={() => setRoomMemoryOpen(false)}
          onSelect={onConversationSelect}
          onDelete={onDeleteConversation}
          onCreate={handleCreateConversationDraft}
          createBusy={createConversationBusy}
          error={createConversationError}
          readOnly={readOnly}
        />
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
        rooms={rooms || []}
        readOnly={readOnly}
        activeTab={workspacePanelTab}
        onTabChange={(tab) => {
          setWorkspacePanelTab(tab);
          writeStoredChatSurface({ workspacePanelOpen: true, workspacePanelTab: tab });
        }}
        onRoomsChanged={onRoomsChanged}
        onConversationSelect={onConversationSelect}
        activeConversationModelLabel={activeConversationModelLabel}
        isConversationModelLoading={isConversationModelLoading}
        activeConversation={activeConversation}
        isMainConversation={isMainConversation}
        roomAiMembers={roomAiMembers}
        conversationAiMembers={conversationAiMembers}
        effectiveAiMembers={effectiveAiMembers}
        availableAis={availableAis}
        thinkingAdapters={thinkingAdapters}
        aiConfigError={aiConfigError}
        onRoomAiMembersSave={onRoomAiMembersSave}
        onConversationAiMembersChange={onConversationAiMembersChange}
        onRoomSelect={(id) => {
          onRoomSelect(id);
          setWorkspacePanelOpen(false);
          writeStoredChatSurface({ workspacePanelOpen: false, workspacePanelTab });
        }}
      />

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
