import { useEffect, useLayoutEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EASE } from "../constants.js";
import { decorateMessages } from "../utils.js";
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

export default function MessageList({
  messages, onScrolled = () => {}, hiddenMessageId,
  shouldAnimateEntry, entryDelay, entryDuration = 0.26,
  isFading = false, fadeDuration = 600,
  itemAnimationMode = "standard",
  stickToBottom = true, className = "", innerClassName = "",
  viewportRef, renderEmpty,
  onContextMenu
}) {
  const localViewportRef = useRef(null);
  const stickToBottomRef = useRef(true);
  const [showNewMsgBtn, setShowNewMsgBtn] = useState(false);
  const decoratedMessages = decorateMessages(messages);
  const resolvedViewportRef = viewportRef || localViewportRef;

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
    viewport.scrollTop = viewport.scrollHeight;
  }, [messages.length, resolvedViewportRef, stickToBottom]);

  useEffect(() => {
    const viewport = resolvedViewportRef.current;
    if (!viewport || typeof ResizeObserver !== "function") return undefined;
    const content = viewport.querySelector(".messages-inner");
    if (!content) return undefined;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current) {
        viewport.scrollTop = viewport.scrollHeight;
      }
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

  const initialProps = shouldAnimateEntry ? { opacity: 0 } : false;
  const transition = shouldAnimateEntry
    ? { delay: entryDelay, duration: entryDuration, ease: EASE }
    : { duration: 0.18, ease: EASE };
  const viewportClassName = `messages ${className}`.trim();
  const contentClassName = `messages-inner ${innerClassName}`.trim();
  const hasMessages = decoratedMessages.length > 0;

  return (
    <motion.div className={viewportClassName} ref={resolvedViewportRef} onScroll={handleScroll}>
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
        <AnimatePresence initial={false}>
          {!hasMessages ? (
            <motion.div
              key="empty-state"
              className="empty-state-layer"
              initial={{ opacity: 1 }}
              animate={{ opacity: isFading ? 0 : 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: isFading ? fadeDuration / 1000 : 0.16, ease: EASE }}
            >
              {resolveEmpty(renderEmpty)}
            </motion.div>
          ) : null}
        </AnimatePresence>

        <ol className="message-list" role="list">
          <AnimatePresence initial={false}>
            {decoratedMessages.map((message) => (
              <MessageItem
                key={message.id}
                message={message}
                hiddenMessageId={hiddenMessageId}
                itemAnimationMode={itemAnimationMode}
                onContextMenu={onContextMenu}
              />
            ))}
          </AnimatePresence>
        </ol>
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
    </motion.div>
  );
}
