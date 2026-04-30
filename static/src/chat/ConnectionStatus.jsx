import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { EASE, STATUS_LABEL, STATUS_COLOR } from "../constants.js";

export default function ConnectionStatus({ state, allowPulse = true }) {
  const prevStateRef = useRef(state);
  const ringTimerRef = useRef(null);
  const [showRing, setShowRing] = useState(false);
  const label = STATUS_LABEL[state] || STATUS_LABEL.idle;
  const color = STATUS_COLOR[state] || STATUS_COLOR.idle;

  useEffect(() => {
    if (allowPulse && prevStateRef.current !== "connected" && state === "connected") {
      setShowRing(true);
      window.clearTimeout(ringTimerRef.current);
      ringTimerRef.current = window.setTimeout(() => {
        setShowRing(false);
      }, 620);
    } else if (!allowPulse) {
      setShowRing(false);
    }
    prevStateRef.current = state;
    return () => {
      window.clearTimeout(ringTimerRef.current);
    };
  }, [allowPulse, state]);

  const animateProps = showRing
    ? { backgroundColor: color, scale: [1, 1.6, 1], opacity: 1 }
    : { backgroundColor: color, scale: 1, opacity: 1 };

  return (
    <div className="status-inline" aria-live="polite">
      <span className="status-signal">
        <AnimatePresence initial={false}>
          {showRing ? (
            <motion.span
              key="status-ring"
              className="status-ring"
              initial={{ scale: 0, opacity: 0.4 }}
              animate={{ scale: 5, opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.6, ease: EASE }}
            />
          ) : null}
        </AnimatePresence>
        <motion.span
          className="status-dot"
          animate={animateProps}
          transition={{ duration: 0.4, ease: EASE }}
        />
      </span>
      <span>{label}</span>
    </div>
  );
}
