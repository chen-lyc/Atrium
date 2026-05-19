import { motion } from "framer-motion";
import katex from "katex";
import { EASE } from "../constants.js";
import { getModelDisplayName } from "../utils.js";

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

const INLINE_MARKDOWN_PATTERN = /(\\\([\s\S]*?\\\)|\$[^$\n]+?\$|`[^`\n]+`|!\[[^\]\n]*\]\([^)]+\)|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)]+\)|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
const BLOCK_MATH_PATTERN = /(?:\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$)/g;
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

    if (token.startsWith("\\(") || (token.startsWith("$") && !token.startsWith("$$"))) {
      const formula = token.startsWith("\\(") ? token.slice(2, -2).trim() : token.slice(1, -1).trim();
      try {
        const html = katex.renderToString(formula, { throwOnError: false, displayMode: false });
        nodes.push(<span key={key} className="message-latex-inline" dangerouslySetInnerHTML={{ __html: html }} />);
      } catch {
        nodes.push(<span key={key} className="message-latex-inline">{formula}</span>);
      }
    } else if (token.startsWith("![")) {
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

function renderMarkdownTable(lines, key) {
  const rows = [];
  let headerRow = null;
  let alignmentRow = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|")) continue;
    if (/^\|?\s*[-:]{3,}\s*(\|\s*[-:]{3,}\s*)*\|?$/.test(trimmed)) {
      if (headerRow && !alignmentRow) { alignmentRow = trimmed; continue; }
      continue;
    }
    const cells = trimmed.replace(/^\|/, "").replace(/\|$/, "").split("|").map((s) => s.trim());
    if (!alignmentRow) { headerRow = cells; continue; }
    rows.push(cells);
  }
  if (!headerRow || !headerRow.length) return null;
  return (
    <table key={key} className="message-table">
      <thead>
        <tr>{headerRow.map((cell, i) => <th key={`th-${i}`}>{renderInlineMarkdown(cell, `${key}-th-${i}`)}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((row, ri) => (
          <tr key={`tr-${ri}`}>{row.map((cell, ci) => <td key={`td-${ci}`}>{renderInlineMarkdown(cell, `${key}-td-${ri}-${ci}`)}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function renderMarkdownBlock(block, key) {
  const lines = block.split("\n").filter((line) => line.trim());
  if (!lines.length) return null;
  const singleLine = lines.length === 1 ? lines[0] : "";
  if (singleLine && /^\s*[-*_]{3,}\s*$/.test(singleLine)) {
    return <hr key={key} className="message-hr" />;
  }
  const heading = singleLine ? renderHeading(singleLine, key) : null;
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
  if (lines.some((line) => line.trim().startsWith("|")) && lines.some((line) => /^\|?\s*[-:]{3,}\s*(\|\s*[-:]{3,}\s*)*\|?$/.test(line.trim()))) {
    const table = renderMarkdownTable(lines, key);
    if (table) return table;
  }
  return renderParagraph(block, key);
}

function renderMessageContent(text) {
  const source = String(text || "");
  const nodes = [];
  const fencePattern = /```([\w+-]*)?\n?([\s\S]*?)```/g;
  let lastIndex = 0;
  let match;

  function processTextWithMath(text) {
    const parts = [];
    let mathLastIndex = 0;
    let mathMatch;
    BLOCK_MATH_PATTERN.lastIndex = 0;
    while ((mathMatch = BLOCK_MATH_PATTERN.exec(text)) !== null) {
      if (mathMatch.index > mathLastIndex) {
        parts.push({ type: "text", content: text.slice(mathLastIndex, mathMatch.index) });
      }
      parts.push({ type: "math", content: (mathMatch[1] || mathMatch[2] || "").trim() });
      mathLastIndex = mathMatch.index + mathMatch[0].length;
    }
    if (mathLastIndex < text.length) {
      parts.push({ type: "text", content: text.slice(mathLastIndex) });
    }
    return parts;
  }

  function appendTextBlocks(part) {
    processTextWithMath(part).forEach((segment) => {
      if (segment.type === "math") {
        try {
          const html = katex.renderToString(segment.content, { throwOnError: false, displayMode: true });
          nodes.push(<div key={`math-${nodes.length}`} className="message-latex-block" dangerouslySetInnerHTML={{ __html: html }} />);
        } catch {
          nodes.push(<div key={`math-${nodes.length}`} className="message-latex-block">{segment.content}</div>);
        }
        return;
      }
      segment.content
        .split(/\n{2,}/)
        .map((block) => block.trim())
        .filter(Boolean)
        .forEach((block) => {
          const renderedBlock = renderMarkdownBlock(block, `p-${nodes.length}`);
          if (renderedBlock) nodes.push(renderedBlock);
        });
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

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : value == null ? "" : String(value).trim();
}

function resolveAiProvider(member) {
  const provider = normalizeText(member?.provider).toLowerCase();
  if (provider && provider !== "other") return provider;
  const model = normalizeText(member?.model).toLowerCase();
  if (model.startsWith("deepseek")) return "deepseek";
  if (model.startsWith("qwen")) return "qwen";
  return "";
}

function hasSameProviderAiMember(message, aiMembers = []) {
  const provider = resolveAiProvider(message);
  if (!provider) return false;
  return (Array.isArray(aiMembers) ? aiMembers : [])
    .filter((member) => resolveAiProvider(member) === provider)
    .length > 1;
}

function getMessageAuthorName(message, aiMembers = []) {
  const fallbackName = normalizeText(message?.nickname) || "AI";
  if (!message?.isAI) return fallbackName;
  const model = normalizeText(message.model);
  if (!model || !hasSameProviderAiMember(message, aiMembers)) return fallbackName;
  return getModelDisplayName({ model, provider: message.provider }, model);
}

export default function MessageItem({ message, hiddenMessageId, itemAnimationMode = "standard", onContextMenu, aiMembers = [] }) {
  const isHiddenForFlight = message.id === hiddenMessageId;
  const participantType = message.isAI ? "ai" : message.isSelf ? "self" : "human";
  const avatarSrc = message.avatarUrl || (message.isAI ? "/avatars/deepseek-logo.svg" : "");
  const authorName = getMessageAuthorName(message, aiMembers);
  const resolvedAnimationMode = message.source === "local-welcome" ? "welcome" : itemAnimationMode;
  const animationPreset = isHiddenForFlight
    ? ANIMATION_PRESETS.flightTarget
    : ANIMATION_PRESETS[resolvedAnimationMode] || ANIMATION_PRESETS.standard;
  const shouldShowDivider = message.showDivider && message.source !== "local-welcome";
  const aiInterrupted = message.isAI && (message.status === "interrupted" || message.status === "failed");
  const visibleStatus = aiInterrupted ? "interrupted" : message.status;
  const messageStatusClass = visibleStatus ? ` is-status-${visibleStatus}` : "";
  const hasMessageText = String(message.text || "").trim().length > 0;
  const shouldShowAuthor = message.showAuthor || (aiInterrupted && !hasMessageText);

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
      data-ai-error-type={aiInterrupted && message.aiErrorType ? message.aiErrorType : undefined}
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
        {shouldShowAuthor ? (
          <div className="message-meta">
            {avatarSrc ? (
              <img className="message-avatar" src={avatarSrc} alt="" />
            ) : (
              <span className={`message-avatar-fallback is-${participantType}`} aria-hidden="true">
                {String(authorName || "用").slice(0, 1)}
              </span>
            )}
            <span className="message-author-button">
              <span className="message-author">{authorName}</span>
            </span>
            {message.isSelf ? <span className="message-you">• 你</span> : null}
            {message.isAI ? <span className="message-badge is-ai">AI</span> : null}
            <span className="message-time">{message.timeLabel}</span>
          </div>
        ) : null}
        <div className={`message-text-shell ${hasMessageText ? "" : "is-empty"}`.trim()}>
          <div className="message-content">{renderMessageContent(message.text)}</div>
        </div>
        {message.isSelf && message.status !== "sent" ? (
          <div className={`message-state ${message.status === "failed" ? "is-failed" : ""}`}>
            {message.status === "failed" ? "发送失败" : "发送中"}
          </div>
        ) : null}
        {aiInterrupted ? (
          <div className="message-ai-interruption" role="status" aria-label="AI 回复中断" title="AI 回复中断">
            <span className="message-ai-interruption-dot" aria-hidden="true" />
          </div>
        ) : null}
      </motion.article>
    </motion.li>
  );
}
