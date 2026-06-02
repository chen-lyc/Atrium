import { motion, AnimatePresence } from "framer-motion";
import { EASE } from "../../constants.js";
import { LOADING_DOT_DELAYS } from "./AuthShell.constants.js";

export function InlineError({ message, className = "" }) {
  return (
    <AnimatePresence initial={false}>
      {message ? (
        <motion.div key={message} className={`auth-error ${className}`.trim()} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: EASE }}>
          {message}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function LoadingDots() {
  return (
    <span className="loading-dots" aria-hidden="true">
      {LOADING_DOT_DELAYS.map((delay) => <span key={delay} className="loading-dot" style={{ animationDelay: delay }} />)}
    </span>
  );
}

export function LoadingStage() {
  return (
    <div className="loading-page">
      <motion.div className="loading-panel" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8, transition: { duration: 0.18, ease: EASE } }} transition={{ duration: 0.24, ease: EASE }}>
        <div className="auth-brand">Atrium</div>
        <div className="loading-copy">正在验证会话</div>
      </motion.div>
    </div>
  );
}

export function AnimatedSubtitle({ text, playTyping, reducedMotion, className = "auth-subtitle" }) {
  if (reducedMotion || !playTyping) {
    return <motion.div className={className} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.22, ease: EASE }}>{text}</motion.div>;
  }
  return (
    <div className={className} aria-label={text}>
      {Array.from(text).map((char, i) => (
        <motion.span key={`${text}-${i}`} className="auth-subtitle-letter" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08, duration: 0.3, ease: EASE }}>{char}</motion.span>
      ))}
    </div>
  );
}
