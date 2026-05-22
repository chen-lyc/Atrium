import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import TagMicroAnimation from "./TagMicroAnimation.jsx";

const HOVER_OPEN_DELAY = 420;
const POPOVER_EASE = [0.2, 0.82, 0.24, 1];
const DETAIL_PLACEMENTS = {
  "co-thinking": "top-left",
  "ai-member": "top-right",
  "personal-space": "bottom-left",
  notes: "bottom-right"
};
const DETAIL_CONTENT = {
  "co-thinking": {
    title: "一起进入讨论",
    points: ["公共房间承载多人实时对话", "话题自然聚在同一处", "不靠未读数制造压力"]
  },
  "ai-member": {
    title: "AI 在讨论里补角度",
    points: ["一个问题可以请多个 AI 接住", "有人整理下一步，有人提醒风险", "回答留在同一条讨论流里"]
  },
  "personal-space": {
    title: "保留自己的安静房间",
    points: ["老用户默认回到个人空间", "适合私下思考和整理", "不想进大厅时也有落点"]
  },
  notes: {
    title: "把讨论变成笔记",
    points: ["重要消息可以快速整理", "结论能保存而不是丢在聊天里", "笔记可个人使用也可共享"]
  }
};
const DIAGRAM_VIEWBOX = "0 0 220 112";

function classNames(...parts) { return parts.filter(Boolean).join(" "); }
function clearTimer(timerRef) { if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; } }
function getPlacement(type) { return DETAIL_PLACEMENTS[type] || "top-right"; }
function getMotionOffset(placement, reducedMotion) {
  if (reducedMotion) return { x: 0, y: 0 };
  if (placement === "top-left") return { x: 8, y: 5 };
  if (placement === "top-right") return { x: -8, y: 5 };
  if (placement === "bottom-left") return { x: 8, y: -5 };
  return { x: -8, y: -5 };
}

function DiagramFrame({ children }) {
  return <svg className="tech-detail-diagram" viewBox={DIAGRAM_VIEWBOX} fill="none" aria-hidden="true" focusable="false">{children}</svg>;
}

function CoThinkingDiagram() {
  return (
    <DiagramFrame>
      <rect x="64" y="36" width="92" height="38" rx="19" className="tech-detail-diagram__shape is-accent" />
      <circle cx="82" cy="55" r="7" className="tech-detail-diagram__dot" />
      <circle cx="110" cy="55" r="7" className="tech-detail-diagram__dot is-accent" />
      <circle cx="138" cy="55" r="7" className="tech-detail-diagram__dot" />
      <path d="M78 82C88 91 101 95 116 94C131 93 143 88 151 78" className="tech-detail-diagram__stroke" />
      <path d="M72 30C84 18 101 12 122 15C138 17 151 24 160 36" className="tech-detail-diagram__stroke" />
    </DiagramFrame>
  );
}

function AiMemberDiagram() {
  return (
    <DiagramFrame>
      <circle cx="76" cy="58" r="18" className="tech-detail-diagram__shape" />
      <circle cx="144" cy="58" r="22" className="tech-detail-diagram__shape is-accent" />
      <path d="M94 56C105 48 115 48 126 56" className="tech-detail-diagram__stroke is-accent" />
      <path d="M144 37L148 50L161 54L148 58L144 71L140 58L127 54L140 50L144 37Z" className="tech-detail-diagram__shape is-accent" />
      <path d="M66 58h20M76 48v20" className="tech-detail-diagram__stroke" />
      <text x="136" y="88" className="tech-detail-diagram__label is-accent">AI</text>
    </DiagramFrame>
  );
}

function PersonalSpaceDiagram() {
  return (
    <DiagramFrame>
      <rect x="70" y="28" width="80" height="58" rx="14" className="tech-detail-diagram__shape is-accent" />
      <path d="M92 86V48C92 42 97 37 103 37H128" className="tech-detail-diagram__stroke" />
      <circle cx="127" cy="58" r="2.6" className="tech-detail-diagram__dot is-accent" />
      <path d="M64 92C78 100 99 103 122 100C140 98 153 93 162 84" className="tech-detail-diagram__stroke" />
      <path d="M86 28C96 19 116 15 135 20" className="tech-detail-diagram__stroke" />
    </DiagramFrame>
  );
}

function NotesDiagram() {
  return (
    <DiagramFrame>
      <rect x="42" y="30" width="68" height="38" rx="13" className="tech-detail-diagram__shape" />
      <path d="M65 68L58 80L82 68" className="tech-detail-diagram__stroke" />
      <rect x="122" y="24" width="58" height="70" rx="10" className="tech-detail-diagram__shape is-accent" />
      <path d="M135 44H166M135 56H164M135 68H156" className="tech-detail-diagram__stroke is-accent" />
      <path d="M110 50C119 50 124 48 132 42" className="tech-detail-diagram__stroke is-accent" />
    </DiagramFrame>
  );
}

function ProductValueDiagram({ type }) {
  if (type === "co-thinking") return <CoThinkingDiagram />;
  if (type === "ai-member") return <AiMemberDiagram />;
  if (type === "personal-space") return <PersonalSpaceDiagram />;
  return <NotesDiagram />;
}

export default function TechCardPopover({ card, revealMotion, reducedMotion = false }) {
  const placement = getPlacement(card.type);
  const detail = DETAIL_CONTENT[card.type] || DETAIL_CONTENT["co-thinking"];
  const openTimerRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);
  const tooltipId = `value-detail-${card.tagId || card.key || card.type}`;
  const motionOffset = getMotionOffset(placement, reducedMotion);

  function queueOpen() { clearTimer(openTimerRef); openTimerRef.current = window.setTimeout(() => { openTimerRef.current = null; setIsOpen(true); }, HOVER_OPEN_DELAY); }
  function openNow() { clearTimer(openTimerRef); setIsOpen(true); }
  function closeNow() { clearTimer(openTimerRef); setIsOpen(false); }
  function handleBlur(event) { if (event.currentTarget.contains(event.relatedTarget)) return; closeNow(); }
  function handleKeyDown(event) { if (event.key === "Escape") closeNow(); }
  useEffect(() => { return () => { clearTimer(openTimerRef); }; }, []);

  return (
    <motion.div
      className={classNames("tech-card", card.className, isOpen && "is-detail-open")}
      data-tag-id={card.tagId}
      {...revealMotion}
      onMouseEnter={queueOpen}
      onMouseLeave={closeNow}
      onFocusCapture={openNow}
      onBlurCapture={handleBlur}
      onKeyDown={handleKeyDown}
    >
      <div className="tech-card-popover-unit">
        <button type="button" className="tech-card-link focus-ring" aria-describedby={isOpen ? tooltipId : undefined} aria-label={`${card.title}：${card.subtitle}`}>
          <div className="tech-card-surface">
            <div className="tech-card-icon">
              <TagMicroAnimation type={card.type} tagId={card.tagId} reducedMotion={reducedMotion} />
            </div>
            <div className="tech-card-title">{card.title}</div>
            <div className="tech-card-subtitle">{card.subtitle}</div>
          </div>
        </button>
        <AnimatePresence initial={false}>
          {isOpen ? (
            <>
              <div className={classNames("tech-detail-bridge", `is-${placement}`)} aria-hidden="true" />
              <motion.div
                id={tooltipId}
                role="tooltip"
                className={classNames("tech-detail-popover", `is-${placement}`)}
                style={{ transformOrigin: placement === "top-left" ? "100% 78%" : placement === "top-right" ? "0% 78%" : placement === "bottom-left" ? "100% 24%" : "0% 24%" }}
                initial={{ opacity: 0, x: motionOffset.x, y: motionOffset.y }}
                animate={{ opacity: 1, x: 0, y: 0, transition: { duration: reducedMotion ? 0.12 : 0.2, ease: POPOVER_EASE } }}
                exit={{ opacity: 0, x: motionOffset.x, y: motionOffset.y, transition: { duration: reducedMotion ? 0.1 : 0.15, ease: POPOVER_EASE } }}
              >
                <span className={classNames("tech-detail-arrow", `is-${placement}`)} aria-hidden="true" />
                <div className="tech-detail-figure"><ProductValueDiagram type={card.type} /></div>
                <div className="tech-detail-title">{detail.title}</div>
                <ul className="tech-detail-points">{detail.points.map((point) => <li key={point}>{point}</li>)}</ul>
              </motion.div>
            </>
          ) : null}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
