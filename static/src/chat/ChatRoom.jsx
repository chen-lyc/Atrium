import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EASE } from "../constants.js";
import Sidebar from "./Sidebar.jsx";
import ConnectionStatus from "./ConnectionStatus.jsx";
import MessageList from "./MessageList.jsx";
import MessageInput from "./MessageInput.jsx";
import MessageFlight from "./MessageFlight.jsx";
import WorkspacePanel from "./WorkspacePanel.jsx";

const NOTE_TOAST_MS = 2200;
const ROOM_AI_MODELS = ["DeepSeek", "Qwen"];

function RoomAtmosphere({ tone }) {
  return (
    <div className={`room-atmosphere-layer is-${tone}`} aria-hidden="true">
      <span className="room-atmosphere-grid" />
      <span className="room-atmosphere-axis is-left" />
      <span className="room-atmosphere-axis is-right" />
      <span className="room-atmosphere-horizon" />
    </div>
  );
}

function WorkbenchOverview({
  tone,
  connectionState,
  messageCount,
  conversationCount,
  activeConversationId,
  roomAtmosphere
}) {
  const connectionLabel = connectionState === "connected" ? "房间在线" : connectionState === "connecting" ? "同步中" : "未连接";

  return (
    <section className={`workbench-overview is-${tone}`} aria-label="当前讨论工作台">
      <div className="workbench-primary">
        <span className="workbench-kicker">当前工作台</span>
        <p>{roomAtmosphere}</p>
      </div>
      <div className="workbench-console" aria-label="讨论状态">
        <span className="workbench-console-item is-thread">
          <strong>{messageCount} 消息 · {conversationCount || 1} 对话 · #{activeConversationId || 1}</strong>
          <small>讨论索引</small>
        </span>
        <span className="workbench-console-item is-model">
          <strong>{ROOM_AI_MODELS.join(" · ")}</strong>
          <small>AI 模型</small>
        </span>
        <span className="workbench-console-item is-note">
          <strong>笔记沉淀</strong>
          <small>摘录 · 结论 · 索引</small>
        </span>
        <span className="workbench-console-item is-sync">
          <strong>{connectionLabel}</strong>
          <small>连接</small>
        </span>
      </div>
    </section>
  );
}

function RoomSwitchOverlay({ transition }) {
  return (
    <AnimatePresence>
      {transition ? (
        <motion.div
          key={transition.id}
          className={`room-switch-overlay is-${transition.tone || "personal"}`}
          initial={{ opacity: 0, x: "-50%", y: 8, scale: 0.985 }}
          animate={{ opacity: 1, x: "-50%", y: 0, scale: 1 }}
          exit={{ opacity: 0, x: "-50%", y: -6, scale: 0.99 }}
          transition={{ duration: 0.2, ease: EASE }}
          aria-live="polite"
        >
          <span className="room-switch-kicker">
            {transition.kind === "conversation" ? "切换对话" : "切换房间"}
          </span>
          <span className="room-switch-route">
            <span>{transition.fromLabel}</span>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 7h8M8 4l3 3-3 3" />
            </svg>
            <strong>{transition.toLabel}</strong>
          </span>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export default function ChatRoom({
  nickname, connectionState, messages,
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
  activeConversationId = 0, roomConversations = [],
  onConversationSelect = () => {}, onDeleteConversation = () => {},
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
  const [workspacePanelOpen, setWorkspacePanelOpen] = useState(false);
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
    return () => window.clearTimeout(noteToastTimerRef.current);
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
  const emptyTitle = room?.emptyTitle || (roomTone === "public" ? "大厅正在等待新的讨论" : "这里还很安静");
  const emptyHint = room?.emptyHint || roomHint || "写下一个想法，让讨论从这里开始。";
  const emptySuggestions = roomTone === "public"
    ? ["提出一个公共问题", "贴出材料和判断", "沉淀阶段结论"]
    : ["写下研究对象", "让 DeepSeek / Qwen 接入推演", "保存待整理结论"];
  const composerPlaceholder = room?.composerPlaceholder || "输入消息，按 Enter 发送";
  const discussionMessageCount = visibleMessages.filter((message) => message.nickname !== "__system__").length;
  const stageInitial = resolvedTransitionMode === "idle" ? { opacity: 0.96, y: 2 } : messagesMotion.initial;
  const stageAnimate = resolvedTransitionMode === "idle" ? { opacity: 1, y: 0 } : messagesMotion.animate;
  const stageTransition = resolvedTransitionMode === "idle" ? { duration: 0.22, ease: EASE } : messagesMotion.transition;

  return (
    <div className="shell">
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
          onLogout={onLogout}
          shouldAnimateEntry={false}
          transitionMode={resolvedTransitionMode}
          motionTiming={transitionConfig?.sidebar}
          readOnly={readOnly}
          rooms={rooms}
          activeRoomId={activeRoomId}
          onRoomSelect={(id) => { onRoomSelect(id); setMobileSidebarOpen(false); }}
          roomName={roomName}
          onOpenWorkspacePanel={() => setWorkspacePanelOpen(true)}
        />
      </div>

      <main className="main">
        <motion.header
          className={`header ${isHeaderScrolled ? "is-scrolled" : ""}`}
          initial={headerMotion.initial}
          animate={headerMotion.animate}
          transition={headerMotion.transition}
        >
          <div className="header-inner">
            <div className="room-heading">
              <div className="room-kicker">{roomPlaceLabel}</div>
              <div className="room-title-row">
                <div className="room-name">{roomName}</div>
                <span className={`room-tone-chip is-${roomTone}`}>{roomTone === "public" ? "团队讨论" : "个人研究"}</span>
              </div>
              {roomHint ? <div className="room-hint">{roomHint}</div> : null}
            </div>
            <div className="header-actions">
              <button
                type="button"
                className="header-action-button focus-ring"
                onClick={() => setWorkspacePanelOpen(true)}
                disabled={readOnly}
                aria-label="打开侧工作区"
              >
                侧工作区
              </button>
              <ConnectionStatus state={connectionState} allowPulse={!suppressConnectionPulse} />
            </div>
          </div>
        </motion.header>

        {roomConversations.length > 0 ? (
          <div className="conversation-bar" aria-label="对话切换">
            <div className="conversation-bar-inner">
              <div className="conversation-bar-label">对话</div>
              <div className="conversation-track">
                {roomConversations.map((conversation) => {
                  const isActive = conversation.id === activeConversationId;
                  return (
                    <div key={conversation.id} className={`conversation-tab ${isActive ? "is-active" : ""}`}>
                      <button type="button" className="conversation-tab-btn focus-ring" onClick={() => onConversationSelect(conversation.id)}>
                        {conversation.name || `对话 ${conversation.id}`}
                      </button>
                      {conversation.id !== room?.mainConversationId ? (
                        <button
                          type="button"
                          className="conversation-tab-close focus-ring"
                          onClick={() => onDeleteConversation(conversation.id)}
                          aria-label={`删除对话 ${conversation.name || conversation.id}`}
                          title="删除对话"
                        >
                          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                            <path d="M3 3l6 6M9 3l-6 6" />
                          </svg>
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="conversation-add-btn focus-ring"
                onClick={() => setWorkspacePanelOpen(true)}
                disabled={readOnly}
                aria-label="新建对话"
                title="新建对话"
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
                  <path d="M7 2.5v9M2.5 7h9" />
                </svg>
              </button>
            </div>
          </div>
        ) : null}

        <motion.div
          key={`${activeRoomId}-${activeConversationId || "main"}`}
          className={`messages-stage is-${roomTone} ${roomTransition ? "is-switching" : ""}`}
          initial={stageInitial}
          animate={stageAnimate}
          transition={stageTransition}
        >
          <RoomAtmosphere tone={roomTone} />
          <RoomSwitchOverlay transition={roomTransition} />
          <WorkbenchOverview
            tone={roomTone}
            connectionState={connectionState}
            messageCount={discussionMessageCount}
            conversationCount={roomConversations.length}
            activeConversationId={activeConversationId}
            roomAtmosphere={roomAtmosphere}
          />
          <MessageList
            messages={visibleMessages}
            onScrolled={onScrolled}
            hiddenMessageId={hiddenMessageId}
            shouldAnimateEntry={false}
            itemAnimationMode="calm"
            isFading={isFading}
            fadeDuration={fadeDuration}
            viewportRef={messagesViewportRef}
            renderEmpty={hideMessageContent ? () => null : () => (
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
            )}
            onContextMenu={handleMessageContextMenu}
            hasMoreHistory={hasMoreHistory && !hideMessageContent}
            historyInitialLoading={historyInitialLoading && !hideMessageContent}
            historyLoading={historyLoading && !hideMessageContent}
            historyError={hideMessageContent ? "" : historyError}
            onLoadMoreHistory={onLoadMoreHistory}
          />
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
      </main>

      {readOnly ? null : (
        <MessageFlight flight={messageFlight} onComplete={onMessageFlightComplete} />
      )}

      <WorkspacePanel
        isOpen={workspacePanelOpen && !readOnly}
        onClose={() => setWorkspacePanelOpen(false)}
        currentUserId={currentUserId}
        room={room}
        rooms={rooms || []}
        readOnly={readOnly}
        onRoomsChanged={onRoomsChanged}
        onConversationSelect={onConversationSelect}
        onRoomSelect={(id) => {
          onRoomSelect(id);
          setWorkspacePanelOpen(false);
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
