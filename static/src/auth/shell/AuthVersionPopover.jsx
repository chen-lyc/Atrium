import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EASE } from "../../constants.js";
import { CHANGELOG_ITEMS } from "./AuthShell.constants.js";

export default function AuthVersionPopover({ label = "v3.0", className = "", placement = "bottom" }) {
  const [isOpen, setIsOpen] = useState(false);
  function handleBlur(event) { if (event.currentTarget.contains(event.relatedTarget)) return; setIsOpen(false); }
  const initialOffset = placement === "top" ? 4 : -4;
  return (
    <div className={`version-popover-shell changelog-trigger-wrap ${placement === "top" ? "is-top" : "is-bottom"} ${isOpen ? "is-open" : ""} ${className}`.trim()} onMouseEnter={() => setIsOpen(true)} onMouseLeave={() => setIsOpen(false)} onFocusCapture={() => setIsOpen(true)} onBlurCapture={handleBlur}>
      <button type="button" className="version-trigger focus-ring">{label}</button>
      <div className="version-popover-bridge" aria-hidden="true" />
      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div className="version-popover changelog-popover" role="tooltip" initial={{ opacity: 0, y: initialOffset }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: initialOffset }} transition={{ duration: 0.18, ease: EASE }}>
            {CHANGELOG_ITEMS.map((item) => <button key={item.version} type="button" className="version-popover-row focus-ring"><span className="version-popover-title">{item.title}</span><span className="version-popover-meta">{item.version}</span></button>)}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
