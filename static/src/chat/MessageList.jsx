import { Fragment, useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EASE } from "../constants.js";
import { decorateMessages } from "../utils.js";
import AgentDecisionDock from "./AgentDecisionDock.jsx";
import MessageItem from "./MessageItem.jsx";

function EmptyState() {
  return (
    <div className="empty-state">
      <div>
        <div className="empty-title">等待第一条消息</div>
        <div className="empty-hint">Enter 发送 · Shift+Enter 换行</div>
      </div>
    </div>
  );
}

function resolveEmpty(renderEmpty) {
  if (typeof renderEmpty === "function") return renderEmpty();
  if (renderEmpty != null) return renderEmpty;
  return <EmptyState />;
}

function AssistantStatusRow({ state }) {
  if (!state || state.status !== "quota-exceeded") return null;
  return (
    <motion.li
      className={`assistant-status-row is-${state.status}`}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 4 }}
      transition={{ duration: 0.18, ease: EASE }}
      role="status"
      aria-live="polite"
    >
      <span className="assistant-status-mark" aria-hidden="true">
        !
      </span>
      <span className="assistant-status-copy">
        <strong>{state.message || "今日 AI 额度已用完"}</strong>
        {state.detail ? <small>{state.detail}</small> : null}
      </span>
    </motion.li>
  );
}

function AgentProposalRow({ proposals, aiMembers, onAccept, onReject, onConvert }) {
  if (!Array.isArray(proposals) || !proposals.length) return null;
  return (
    <motion.li
      className="agent-decision-row"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.2, ease: EASE }}
      layout
    >
      <AgentDecisionDock
        proposals={proposals}
        aiMembers={aiMembers}
        onAccept={onAccept}
        onReject={onReject}
        onConvert={onConvert}
      />
    </motion.li>
  );
}

export default function MessageList({
  messages, onScrolled = () => {}, hiddenMessageId,
  shouldAnimateEntry, entryDelay, entryDuration = 0.26,
  isFading = false, fadeDuration = 600,
  itemAnimationMode = "standard",
  stickToBottom = true, className = "", innerClassName = "",
  viewportRef, renderEmpty, emptyLayerClassName = "",
  aiMembers = [],
  assistantState = null,
  onContextMenu,
  hasMoreHistory = false,
  historyInitialLoading = false,
  historyLoading = false,
  historyError = "",
  onLoadMoreHistory,
  agentDecisionProposals = [],
  onAgentProposalAccept = () => {},
  onAgentProposalReject = () => {},
  onAgentProposalConvert = () => {}
}) {
  const localViewportRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const loadingOlderRef = useRef(false);
  const [showNewMsgBtn, setShowNewMsgBtn] = useState(false);
  const decoratedMessages = decorateMessages(messages);
  const resolvedViewportRef = viewportRef || localViewportRef;
  const hasAssistantState = Boolean(assistantState && assistantState.status === "quota-exceeded");
  const visibleAgentDecisionProposals = Array.isArray(agentDecisionProposals) ? agentDecisionProposals : [];
  const proposalAnchorId = String(
    visibleAgentDecisionProposals[0]?.triggerMessageId ||
    visibleAgentDecisionProposals[0]?.trigger_message_id ||
    ""
  );
  const hasAgentDecisionProposals = visibleAgentDecisionProposals.length > 0;

  useLayoutEffect(() => {
    const viewport = resolvedViewportRef.current;
    if (!viewport) return;
    if (!stickToBottom) {
      viewport.scrollTop = 0;
      return;
    }
    if (!stickToBottomRef.current) {
      setShowNewMsgBtn(true);
      return;
    }
    const messageList = viewport.querySelector(".message-list");
    if (messageList) {
      const contentHeight = messageList.scrollHeight;
      const fitsViewport = contentHeight <= viewport.clientHeight - 72;
      viewport.scrollTop = fitsViewport ? 0 : viewport.scrollHeight;
    } else {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [messages.length, hasAssistantState, resolvedViewportRef, stickToBottom]);

  useEffect(() => {
    const viewport = resolvedViewportRef.current;
    if (!viewport || typeof ResizeObserver !== "function") return undefined;
    const content = viewport.querySelector(".messages-inner");
    if (!content) return undefined;
    const observer = new ResizeObserver(() => {
      if (!stickToBottomRef.current) return;
      const messageList = viewport.querySelector(".message-list");
      if (messageList && messageList.scrollHeight <= viewport.clientHeight - 72) return;
      viewport.scrollTop = viewport.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [resolvedViewportRef]);

  const scrollToBottom = useCallback(() => {
    const viewport = resolvedViewportRef.current;
    if (!viewport) return;
    stickToBottomRef.current = true;
    setShowNewMsgBtn(false);
    viewport.scrollTop = viewport.scrollHeight;
  }, [resolvedViewportRef]);

  function handleScroll() {
    const viewport = resolvedViewportRef.current;
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    const atBottom = distanceFromBottom < 80;
    if (atBottom) {
      stickToBottomRef.current = true;
      setShowNewMsgBtn(false);
    } else {
      stickToBottomRef.current = false;
    }
    onScrolled(viewport.scrollTop > 4);
  }

  async function handleLoadMoreHistory() {
    const viewport = resolvedViewportRef.current;
    if (!viewport || typeof onLoadMoreHistory !== "function" || historyLoading) return;
    loadingOlderRef.current = true;
    const previousScrollHeight = viewport.scrollHeight;
    const previousScrollTop = viewport.scrollTop;
    try {
      await onLoadMoreHistory();
    } finally {
      window.requestAnimationFrame(() => {
        const nextViewport = resolvedViewportRef.current;
        if (nextViewport) {
          const heightDelta = nextViewport.scrollHeight - previousScrollHeight;
          nextViewport.scrollTop = previousScrollTop + Math.max(0, heightDelta);
        }
        loadingOlderRef.current = false;
      });
    }
  }

  const initialProps = shouldAnimateEntry ? { opacity: 0 } : false;
  const transition = shouldAnimateEntry
    ? { delay: entryDelay, duration: entryDuration, ease: EASE }
    : { duration: 0.18, ease: EASE };
  const viewportClassName = `messages ${className}`.trim();
  const contentClassName = `messages-inner ${innerClassName}`.trim();
  const hasMessages = decoratedMessages.length > 0;
  const emptyHistoryState = !hasMessages && (historyInitialLoading || historyError);
  const listClassName = [
    "message-list",
    hasMessages || hasAssistantState ? "has-tail-space" : "",
    hasAssistantState ? "has-assistant-state" : "",
    hasAgentDecisionProposals ? "has-agent-proposals" : ""
  ].filter(Boolean).join(" ");

  function renderAgentProposalRow(key = "agent-proposal-row") {
    return (
      <AgentProposalRow
        key={key}
        proposals={visibleAgentDecisionProposals}
        aiMembers={aiMembers}
        onAccept={onAgentProposalAccept}
        onReject={onAgentProposalReject}
        onConvert={onAgentProposalConvert}
      />
    );
  }

  return (
    <div className={viewportClassName} ref={resolvedViewportRef} onScroll={handleScroll}>
      <motion.div
        className={contentClassName}
        initial={initialProps}
        animate={{ opacity: isFading ? 0 : 1 }}
        transition={{
          duration: isFading ? fadeDuration / 1000 : transition.duration,
          delay: isFading ? 0 : transition.delay || 0,
          ease: EASE
        }}
      >
        <ol className={listClassName} role="list">
          {hasMessages && (hasMoreHistory || historyLoading || historyError) ? (
            <li className="history-load-row">
              {hasMoreHistory || historyLoading ? (
                <button
                  type="button"
                  className="history-load-btn"
                  onClick={handleLoadMoreHistory}
                  disabled={historyLoading || loadingOlderRef.current}
                >
                  {historyLoading ? "加载中" : "加载更早消息"}
                </button>
              ) : null}
              {historyError ? <span className="history-load-error">{historyError}</span> : null}
            </li>
          ) : null}
          <AnimatePresence initial={false}>
            {decoratedMessages.map((message) => (
              <Fragment key={message.id}>
                <MessageItem
                  message={message}
                  hiddenMessageId={hiddenMessageId}
                  itemAnimationMode={itemAnimationMode}
                  onContextMenu={onContextMenu}
                  aiMembers={aiMembers}
                />
                {hasAgentDecisionProposals && proposalAnchorId && String(message.id) === proposalAnchorId
                  ? renderAgentProposalRow(`agent-proposal-${message.id}`)
                  : null}
              </Fragment>
            ))}
            {hasMessages && hasAgentDecisionProposals && !proposalAnchorId ? renderAgentProposalRow("agent-proposal-tail") : null}
            {hasAssistantState ? <AssistantStatusRow key={`assistant-${assistantState.status}`} state={assistantState} /> : null}
          </AnimatePresence>
        </ol>

        <AnimatePresence initial={false}>
          {!hasMessages ? (
            <motion.div
              key="empty-state"
              className={`empty-state-layer ${emptyLayerClassName}`.trim()}
              initial={{ opacity: 1 }}
              animate={{ opacity: isFading ? 0 : 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: isFading ? fadeDuration / 1000 : 0.16, ease: EASE }}
            >
              {emptyHistoryState ? (
                <div className={`history-empty-state ${historyError ? "is-error" : ""}`}>
                  {historyError || "正在加载历史消息"}
                </div>
              ) : resolveEmpty(renderEmpty)}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </motion.div>

      <AnimatePresence>
        {showNewMsgBtn ? (
          <motion.button
            key="new-msg-btn"
            className="new-messages-btn"
            onClick={scrollToBottom}
            aria-label="查看新消息"
            initial={{ opacity: 0, y: 12, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.9 }}
            transition={{ duration: 0.22, ease: EASE }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span>新消息</span>
          </motion.button>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
