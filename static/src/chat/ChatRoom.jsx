import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EASE } from "../constants.js";
import Sidebar from "./Sidebar.jsx";
import ConnectionStatus from "./ConnectionStatus.jsx";
import MessageList from "./MessageList.jsx";
import MessageInput from "./MessageInput.jsx";
import MessageFlight from "./MessageFlight.jsx";
import WorkspacePanel from "./WorkspacePanel.jsx";

const DEFAULT_ROOM_CUES = ["共同讨论", "AI 参与", "笔记沉淀"];
const NOTE_TOAST_MS = 2200;

function RoomAtmosphere({ tone }) {
  return (
    <div className={`room-atmosphere-layer is-${tone}`} aria-hidden="true">
      <span className="room-atmosphere-arch is-outer" />
      <span className="room-atmosphere-arch is-inner" />
      <span className="room-atmosphere-table" />
      <span className="room-atmosphere-thread is-left" />
      <span className="room-atmosphere-thread is-right" />
      <span className="room-atmosphere-seat is-self" />
      <span className="room-atmosphere-seat is-ai" />
      <span className="room-atmosphere-seat is-note" />
    </div>
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
  const roomCues = Array.isArray(room?.cues) && room.cues.length ? room.cues : DEFAULT_ROOM_CUES;
  const emptyTitle = room?.emptyTitle || (roomTone === "public" ? "大厅正在等待新的讨论" : "这里还很安静");
  const emptyHint = room?.emptyHint || roomHint || "写下一个想法，让讨论从这里开始。";
  const composerPlaceholder = room?.composerPlaceholder || "输入消息，按 Enter 发送";
  const aiPresenceLabel = roomTone === "public" ? "@AI 可召唤" : "AI 陪同席";
  const stageInitial = resolvedTransitionMode === "idle" ? { opacity: 0.96, y: 2 } : messagesMotion.initial;
  const stageAnimate = resolvedTransitionMode === "idle" ? { opacity: 1, y: 0 } : messagesMotion.animate;
  const stageTransition = resolvedTransitionMode === "idle" ? { duration: 0.22, ease: EASE } : messagesMotion.transition;

  return (
    <div className="shell">
      <button
        className="mobile-menu-btn"
        onClick={() => setMobileSidebarOpen((v) => !v)}
        aria-label="菜单"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M3 5h14M3 10h14M3 15h14"/>
        </svg>
      </button>

      <div className={`sidebar-overlay ${mobileSidebarOpen ? "is-open" : ""}`} onClick={() => setMobileSidebarOpen(false)} />

      <div className={`sidebar-wrapper ${mobileSidebarOpen ? "is-open" : ""}`}>
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
              <div className="room-name">{roomName}</div>
              {roomHint ? <div className="room-hint">{roomHint}</div> : null}
              <div className="room-presence-strip" aria-label="房间成员线索">
                <span className="room-presence-item is-self">
                  <span className="room-presence-dot" aria-hidden="true" />
                  你
                </span>
                <span className="room-presence-item is-ai">
                  <span className="room-presence-dot" aria-hidden="true" />
                  {aiPresenceLabel}
                </span>
                <span className="room-presence-item is-note">
                  <span className="room-presence-dot" aria-hidden="true" />
                  可摘录
                </span>
              </div>
            </div>
            <div className="header-actions">
              <button
                type="button"
                className="header-icon-button focus-ring"
                onClick={() => setWorkspacePanelOpen(true)}
                disabled={readOnly}
                aria-label="打开空间面板"
                title="空间面板"
              >
                <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="currentColor" strokeWidth="1.45" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3.2 4.8h10.6M3.2 8.5h10.6M3.2 12.2h10.6" />
                  <path d="M5.1 3v3.6M11.9 6.7v3.6M7.6 10.4V14" />
                </svg>
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
          className={`messages-stage is-${roomTone}`}
          initial={stageInitial}
          animate={stageAnimate}
          transition={stageTransition}
        >
          <RoomAtmosphere tone={roomTone} />
          <div className={`room-context-strip is-${roomTone}`} aria-label={`${roomName}空间状态`}>
            <div className="room-context-copy">
              <span className="room-context-mark" aria-hidden="true" />
              <span>{roomAtmosphere}</span>
            </div>
            <div className="room-context-cues" aria-label="房间线索">
              {roomCues.map((cue) => (
                <span key={cue} className="room-context-cue">{cue}</span>
              ))}
            </div>
          </div>
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
                <div className="empty-room-visual" aria-hidden="true">
                  <span className="empty-room-track" />
                  <span className="empty-room-seat is-self" />
                  <span className="empty-room-seat is-ai" />
                  <span className="empty-room-seat is-note" />
                </div>
                <div className="empty-copy">
                  <div className="empty-title">{emptyTitle}</div>
                  <div className="empty-hint">{emptyHint}</div>
                  <div className="empty-cues" aria-label="房间线索">
                    {roomCues.map((cue) => (
                      <span key={cue}>{cue}</span>
                    ))}
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
