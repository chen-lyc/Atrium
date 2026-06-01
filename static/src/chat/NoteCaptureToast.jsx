import { AnimatePresence, motion } from "framer-motion";
import { EASE } from "../constants.js";

export default function NoteCaptureToast({ toast, className = "" }) {
  return (
    <AnimatePresence>
      {toast ? (
        <motion.div
          key={toast.id || toast.text}
          className={`note-capture-toast ${className}`.trim()}
          initial={{ opacity: 0, y: 8, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 6, scale: 0.98 }}
          transition={{ duration: 0.18, ease: EASE }}
          role="status"
          aria-live="polite"
        >
          <div className="note-capture-title">已摘录到笔记草稿</div>
          <div className="note-capture-preview">{toast.text || ""}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
