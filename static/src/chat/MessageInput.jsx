import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EASE, TAP_TRANSITION } from "../constants.js";

const EMOJI_LIST = ["😀","😂","🤣","😊","😍","🤔","👍","👎","❤️","🔥","🎉","💯","✨","🙏","😅","🤗","😎","🥳","😢","😡","🤯","👋","💪","🚀","⭐"];

export default function MessageInput({
  value, onChange, onSend, disabled, composerFieldRef,
  shouldAnimateEntry, entryDelay, entryDuration = 0.3, entryOffsetY = 20,
  transitionMode = "idle", motionTiming = null, readOnly = false,
  attachment = null, error = "", placeholder = "输入消息，按 Enter 发送",
  onPasteImage, onRemoveAttachment
}) {
  const textareaRef = useRef(null);
  const fileInputRef = useRef(null);
  const emojiRef = useRef(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const isActive = Boolean(value.trim() || attachment) && !disabled && !readOnly;
  const isEntering = transitionMode === "enter";
  const isExiting = transitionMode === "exit";

  const initial = isEntering
    ? { y: motionTiming?.y ?? entryOffsetY, opacity: 0 }
    : shouldAnimateEntry ? { y: entryOffsetY, opacity: 0 } : false;
  const animate = isExiting
    ? { y: motionTiming?.y || 0, opacity: 0 }
    : { y: 0, opacity: 1 };
  const transition = isEntering || isExiting
    ? { delay: motionTiming?.delay || 0, duration: motionTiming?.duration || entryDuration, ease: EASE }
    : shouldAnimateEntry
      ? { delay: entryDelay, duration: entryDuration, ease: EASE }
      : { duration: 0.18, ease: EASE };

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value]);

  useEffect(() => {
    function handleClickOutside(e) {
      if (emojiRef.current && !emojiRef.current.contains(e.target)) {
        setShowEmoji(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function handleKeyDown(event) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!readOnly && !disabled) onSend();
    }
    if (event.key === "Escape") {
      event.currentTarget.blur();
    }
  }

  function handlePaste(event) {
    if (readOnly) return;
    const items = event.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file && onPasteImage) {
          onPasteImage(file);
        }
        return;
      }
    }
  }

  function insertEmoji(emoji) {
    if (readOnly) return;
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const newValue = value.slice(0, start) + emoji + value.slice(end);
    onChange(newValue);
    requestAnimationFrame(() => {
      textarea.focus();
      const pos = start + emoji.length;
      textarea.setSelectionRange(pos, pos);
    });
    setShowEmoji(false);
  }

  return (
    <motion.section className="composer" initial={initial} animate={animate} transition={transition}>
      <div className="composer-inner">
        <div className="composer-row">
          <div className="composer-field" ref={composerFieldRef}>
            <div className="composer-input-shell">
              <textarea
                id="chat-message-composer"
                name="message"
                ref={textareaRef}
                className="composer-input"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                placeholder={attachment ? "添加图片说明，按 Enter 发送" : placeholder}
                aria-label="消息输入框"
                readOnly={readOnly}
                tabIndex={readOnly ? -1 : undefined}
                style={readOnly ? { pointerEvents: "none" } : undefined}
              />

              <div className="composer-toolbar">
                <div className="emoji-picker-wrap" ref={emojiRef}>
                  <motion.button
                    type="button"
                    className="composer-tool-button"
                    onClick={() => {
                      if (!readOnly) setShowEmoji((v) => !v);
                    }}
                    disabled={readOnly}
                    whileTap={{ scale: 0.92 }}
                    aria-label="表情"
                    tabIndex={readOnly ? -1 : undefined}
                  >
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10"/>
                      <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
                      <line x1="9" y1="9" x2="9.01" y2="9"/>
                      <line x1="15" y1="9" x2="15.01" y2="9"/>
                    </svg>
                  </motion.button>
                  {showEmoji ? (
                    <div className="emoji-popover">
                      {EMOJI_LIST.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          className="emoji-item"
                          onClick={() => insertEmoji(emoji)}
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>

                <motion.button
                  type="button"
                  className="composer-tool-button"
                  onClick={() => {
                    if (!readOnly) fileInputRef.current?.click();
                  }}
                  disabled={readOnly}
                  whileTap={{ scale: 0.92 }}
                  aria-label="上传图片"
                  tabIndex={readOnly ? -1 : undefined}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                    <circle cx="8.5" cy="8.5" r="1.5"/>
                    <polyline points="21 15 16 10 5 21"/>
                  </svg>
                </motion.button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  style={{ display: "none" }}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file && onPasteImage) {
                      onPasteImage(file);
                    }
                    event.target.value = "";
                  }}
                />
              </div>

              <div className="composer-send-wrap">
                <motion.button
                  type="button"
                  className={`send-button focus-ring ${isActive ? "is-active" : ""}`}
                  onClick={readOnly || disabled ? undefined : onSend}
                  disabled={readOnly || disabled}
                  whileTap={{ scale: 0.97 }}
                  transition={TAP_TRANSITION}
                  aria-label="发送消息"
                  tabIndex={readOnly ? -1 : undefined}
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                    <path d="M8 12V4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <path d="M4.75 7.25L8 4L11.25 7.25" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </motion.button>
              </div>
            </div>

            <AnimatePresence initial={false}>
              {attachment ? (
                <motion.div
                  key={attachment.id}
                  className="composer-attachment"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 4 }}
                  transition={{ duration: 0.18, ease: EASE }}
                >
                  <img className="composer-attachment-thumb" src={attachment.previewUrl} alt="" />
                  <span className="composer-attachment-copy">
                    <span className="composer-attachment-name">{attachment.name}</span>
                    <span className="composer-attachment-meta">{attachment.sizeLabel || "图片"}</span>
                  </span>
                  <button
                    type="button"
                    className="composer-attachment-remove focus-ring"
                    onClick={onRemoveAttachment}
                    aria-label="移除图片"
                  >
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
                      <path d="M4 4l8 8M12 4l-8 8" />
                    </svg>
                  </button>
                </motion.div>
              ) : null}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {error ? (
                <motion.div
                  key={error}
                  className="composer-error"
                  initial={{ opacity: 0, y: -3 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -3 }}
                  transition={{ duration: 0.16, ease: EASE }}
                >
                  {error}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
