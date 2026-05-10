import { motion } from "framer-motion";
import { EASE } from "../constants.js";

const ANIMATION_PRESETS = {
  standard: {
    initial: { opacity: 0, y: 16 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -8 },
    transition: {
      opacity: { duration: 0.35, ease: EASE },
      y: { duration: 0.35, ease: EASE },
      layout: { duration: 0.42, ease: EASE }
    },
    layout: "position"
  },
  soft: {
    initial: { opacity: 0, y: 8, scale: 0.985 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -4 },
    transition: {
      opacity: { duration: 0.24, ease: EASE },
      y: { duration: 0.24, ease: EASE },
      scale: { duration: 0.24, ease: EASE }
    },
    layout: false
  },
  calm: {
    initial: { opacity: 0, y: 3 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0 },
    transition: {
      opacity: { duration: 0.18, ease: EASE },
      y: { duration: 0.18, ease: EASE }
    },
    layout: false
  },
  flightTarget: {
    initial: false,
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0 },
    transition: { opacity: { duration: 0.12, ease: EASE } },
    layout: false
  },
  welcome: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { opacity: { duration: 0.22, ease: EASE } },
    layout: false
  },
  settled: {
    initial: false,
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0 },
    transition: { opacity: { duration: 0.12, ease: EASE } },
    layout: false
  }
};

const INLINE_MARKDOWN_PATTERN = /(`[^`\n]+`|!\[[^\]\n]*\]\([^)]+\)|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
const IMAGE_SRC_PATTERN = /^(data:image\/(?:png|jpeg|jpg|webp|gif);base64,|https?:\/\/)/i;

function isSafeImageSrc(src) {
  return IMAGE_SRC_PATTERN.test(src);
}

function isSafeLinkHref(href) {
  return /^(https?:\/\/|mailto:)/i.test(href);
}

function renderInlineMarkdown(text, keyPrefix) {
  const nodes = [];
  let lastIndex = 0;
  let match;
  INLINE_MARKDOWN_PATTERN.lastIndex = 0;

  while ((match = INLINE_MARKDOWN_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${keyPrefix}-${match.index}`;

    if (token.startsWith("![")) {
      const image = token.match(/^!\[([^\]\n]*)\]\(([^)]+)\)$/);
      const alt = image?.[1]?.trim() || "聊天图片";
      const src = image?.[2] || "";
      nodes.push(
        isSafeImageSrc(src) ? (
          <a key={key} className="message-image-link" href={src} target="_blank" rel="noreferrer">
            <img className="message-image" src={src} alt={alt} loading="lazy" />
          </a>
        ) : (
          alt
        )
      );
    } else if (token.startsWith("[")) {
      const link = token.match(/^\[([^\]\n]+)\]\(([^)]+)\)$/);
      const label = link?.[1] || token;
      const href = link?.[2] || "";
      nodes.push(
        isSafeLinkHref(href) ? (
          <a key={key} className="message-link" href={href} target="_blank" rel="noreferrer">
            {label}
          </a>
        ) : (
          label
        )
      );
    } else if (token.startsWith("`")) {
      nodes.push(<code key={key} className="message-inline-code">{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    } else {
      nodes.push(token);
    }

    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderParagraph(text, key) {
  const lines = text.split("\n");
  return (
    <p key={key} className="message-text">
      {lines.map((line, index) => (
        <span key={`${key}-line-${index}`}>
          {index > 0 ? <br /> : null}
          {renderInlineMarkdown(line, `${key}-inline-${index}`)}
        </span>
      ))}
    </p>
  );
}

function renderMarkdownList(lines, key, ordered) {
  const TagName = ordered ? "ol" : "ul";
  return (
    <TagName key={key} className="message-md-list">
      {lines.map((line, index) => {
        const content = ordered
          ? line.replace(/^\s*\d+[.)]\s+/, "")
          : line.replace(/^\s*[-*+]\s+/, "");
        return <li key={`${key}-item-${index}`}>{renderInlineMarkdown(content, `${key}-item-${index}`)}</li>;
      })}
    </TagName>
  );
}

function renderBlockquote(lines, key) {
  const content = lines.map((line) => line.replace(/^\s*>\s?/, "")).join("\n");
  return (
    <blockquote key={key} className="message-quote">
      {renderParagraph(content, `${key}-quote`)}
    </blockquote>
  );
}

function renderHeading(text, key) {
  const match = text.match(/^\s*(#{1,3})\s+(.+)$/);
  if (!match) return null;
  const level = match[1].length;
  return (
    <div key={key} className={`message-heading is-level-${level}`}>
      {renderInlineMarkdown(match[2], `${key}-heading`)}
    </div>
  );
}

function renderMarkdownBlock(block, key) {
  const lines = block.split("\n").filter((line) => line.trim());
  if (!lines.length) return null;
  const heading = lines.length === 1 ? renderHeading(lines[0], key) : null;
  if (heading) return heading;
  if (lines.every((line) => /^\s*[-*+]\s+/.test(line))) {
    return renderMarkdownList(lines, key, false);
  }
  if (lines.every((line) => /^\s*\d+[.)]\s+/.test(line))) {
    return renderMarkdownList(lines, key, true);
  }
  if (lines.every((line) => /^\s*>\s?/.test(line))) {
    return renderBlockquote(lines, key);
  }
  return renderParagraph(block, key);
}

function renderMessageContent(text) {
  const source = String(text || "");
  const nodes = [];
  const fencePattern = /```([\w+-]*)?\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  function appendTextBlocks(part) {
    part
      .split(/\n{2,}/)
      .map((block) => block.trim())
      .filter(Boolean)
      .forEach((block) => {
        const renderedBlock = renderMarkdownBlock(block, `p-${nodes.length}`);
        if (renderedBlock) nodes.push(renderedBlock);
      });
  }

  while ((match = fencePattern.exec(source)) !== null) {
    appendTextBlocks(source.slice(lastIndex, match.index));
    const language = match[1]?.trim();
    nodes.push(
      <pre key={`code-${nodes.length}`} className="message-code-block">
        <code>{match[2]}</code>
      </pre>
    );
    if (language) {
      nodes[nodes.length - 1] = (
        <pre key={`code-${nodes.length}`} className="message-code-block" data-language={language}>
          <code>{match[2]}</code>
        </pre>
      );
    }
    lastIndex = match.index + match[0].length;
  }

  appendTextBlocks(source.slice(lastIndex));

  return nodes.length ? nodes : <p className="message-text">{source}</p>;
}

export default function MessageItem({ message, hiddenMessageId, itemAnimationMode = "standard", onContextMenu }) {
  const isHiddenForFlight = message.id === hiddenMessageId;
  const participantType = message.isAI ? "ai" : message.isSelf ? "self" : "human";
  const avatarSrc = message.avatarUrl || (message.isAI ? "/avatars/deepseek-logo.svg" : "");
  const resolvedAnimationMode = message.source === "local-welcome" ? "welcome" : itemAnimationMode;
  const animationPreset = isHiddenForFlight
    ? ANIMATION_PRESETS.flightTarget
    : ANIMATION_PRESETS[resolvedAnimationMode] || ANIMATION_PRESETS.standard;
  const shouldShowDivider = message.showDivider && message.source !== "local-welcome";
  const aiStateLabel = message.isAI && message.status === "failed" ? "生成失败" : "";
  const messageStatusClass = message.status ? ` is-status-${message.status}` : "";

  function handleContextMenu(e) {
    if (onContextMenu) onContextMenu(e, message);
  }

  if (message.nickname === "__system__") {
    return (
      <motion.li
        initial={animationPreset.initial}
        animate={animationPreset.animate}
        exit={animationPreset.exit}
        transition={animationPreset.transition}
        layout={animationPreset.layout}
        className="message-entry is-system"
        data-message-id={message.id}
        onContextMenu={handleContextMenu}
      >
        {shouldShowDivider ? <div className="time-divider">{message.dividerLabel}</div> : null}
        <div className="system-message">{message.text}</div>
      </motion.li>
    );
  }

  return (
    <motion.li
      initial={animationPreset.initial}
      animate={animationPreset.animate}
      exit={animationPreset.exit}
      transition={animationPreset.transition}
      layout={animationPreset.layout}
      className={`message-entry ${
        message.groupedWithPrev ? "is-grouped" : message.showDivider ? "is-first" : "is-fresh"
      } is-${participantType}`}
      data-message-id={message.id}
      data-participant-type={participantType}
      data-message-role={message.isAI ? "assistant" : "message"}
      onContextMenu={handleContextMenu}
    >
      {shouldShowDivider ? <div className="time-divider">{message.dividerLabel}</div> : null}
      <motion.article
        className={`message-block is-${participantType}${messageStatusClass}`}
        initial={false}
        animate={{
          opacity: isHiddenForFlight ? 0 : 1
        }}
        transition={{
          opacity: { duration: isHiddenForFlight ? 0.04 : 0.12, ease: EASE }
        }}
      >
        {message.showAuthor ? (
          <div className="message-meta">
            {avatarSrc ? (
              <img className="message-avatar" src={avatarSrc} alt="" />
            ) : (
              <span className={`message-avatar-fallback is-${participantType}`} aria-hidden="true">
                {String(message.nickname || "用").slice(0, 1)}
              </span>
            )}
            <span className="message-author-button">
              <span className="message-author">{message.nickname}</span>
            </span>
            {message.isSelf ? <span className="message-you">• 你</span> : null}
            {message.isAI ? <span className="message-badge is-ai">AI</span> : null}
            <span className="message-time">{message.timeLabel}</span>
          </div>
        ) : null}
        <div className="message-text-shell">
          <div className="message-content">{renderMessageContent(message.text)}</div>
        </div>
        {message.isSelf && message.status !== "sent" ? (
          <div className={`message-state ${message.status === "failed" ? "is-failed" : ""}`}>
            {message.status === "failed" ? "发送失败" : "发送中"}
          </div>
        ) : null}
        {aiStateLabel ? (
          <div className={`message-state ${message.status === "failed" ? "is-failed" : ""}`}>
            {aiStateLabel}
          </div>
        ) : null}
      </motion.article>
    </motion.li>
  );
}
