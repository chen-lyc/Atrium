import { useEffect, useRef, useState } from "react";

const LIVE_QUEUE_MAX = 2;
const LIVE_DURATIONS = {
  "co-thinking": 640,
  "ai-member": 780,
  "personal-space": 900,
  notes: 760
};
const TAG_IDS = {
  "co-thinking": "tag-co-thinking",
  "ai-member": "tag-ai-member",
  "personal-space": "tag-personal-space",
  notes: "tag-notes"
};

function clearTimer(timerRef) {
  if (timerRef.current) { window.clearTimeout(timerRef.current); timerRef.current = null; }
}
function classNames(...parts) { return parts.filter(Boolean).join(" "); }
function getLiveDuration(type) { return LIVE_DURATIONS[type] || LIVE_DURATIONS["co-thinking"]; }
function getTagId(type, tagId) { return tagId || TAG_IDS[type] || ""; }
function getPulseStyle(source, target) {
  return { "--live-dx": `${target.x - source.x}px`, "--live-dy": `${target.y - source.y}px` };
}

function useTagLive({ type, tagId, reducedMotion = false }) {
  const [liveTrigger, setLiveTrigger] = useState(0);
  const [isLivePlaying, setIsLivePlaying] = useState(false);
  const queueRef = useRef(0);
  const isPlayingRef = useRef(false);
  const liveTimerRef = useRef(null);
  const reducedMotionRef = useRef(reducedMotion);
  const durationRef = useRef(getLiveDuration(type));
  const tagIdRef = useRef(getTagId(type, tagId));

  function resetLiveQueue() {
    clearTimer(liveTimerRef);
    queueRef.current = 0;
    isPlayingRef.current = false;
    setIsLivePlaying(false);
  }

  function processQueue() {
    if (reducedMotionRef.current) { resetLiveQueue(); return; }
    if (isPlayingRef.current || queueRef.current === 0) return;
    isPlayingRef.current = true;
    setIsLivePlaying(true);
    setLiveTrigger((value) => value + 1);
    clearTimer(liveTimerRef);
    liveTimerRef.current = window.setTimeout(() => {
      queueRef.current = Math.max(0, queueRef.current - 1);
      isPlayingRef.current = false;
      liveTimerRef.current = null;
      setIsLivePlaying(false);
      processQueue();
    }, durationRef.current);
  }

  function triggerLive() {
    if (reducedMotionRef.current || queueRef.current >= LIVE_QUEUE_MAX) return;
    queueRef.current += 1;
    processQueue();
  }

  useEffect(() => {
    reducedMotionRef.current = reducedMotion;
    durationRef.current = getLiveDuration(type);
    tagIdRef.current = getTagId(type, tagId);
    if (reducedMotion) resetLiveQueue();
  }, [type, tagId, reducedMotion]);

  useEffect(() => {
    if (reducedMotion) return undefined;
    function handleArrive(event) {
      if (event.detail?.tagId === tagIdRef.current) triggerLive();
    }
    function handleDepart(event) {
      if (type === "co-thinking" && event.detail?.sourceTagId === tagIdRef.current) triggerLive();
    }
    window.addEventListener("arch-pulse-arrive", handleArrive);
    window.addEventListener("arch-pulse-depart", handleDepart);
    return () => {
      window.removeEventListener("arch-pulse-arrive", handleArrive);
      window.removeEventListener("arch-pulse-depart", handleDepart);
    };
  }, [type, tagId, reducedMotion]);

  useEffect(() => { return () => { clearTimer(liveTimerRef); }; }, []);

  return { liveTrigger, isLivePlaying };
}

function BaseIcon({ children }) {
  return (
    <svg className="tag-micro" viewBox="0 0 24 24" width="24" height="24" fill="none" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function CoThinkingIcon({ liveTrigger = 0, isLivePlaying = false }) {
  const playKey = liveTrigger || 0;
  const source = { x: 12, y: 12 };
  const targets = [{ x: 7, y: 8 }, { x: 17, y: 8 }, { x: 12, y: 18 }];
  return (
    <BaseIcon>
      <path className="tag-micro__guide" d="M7 8L17 8L12 18Z" />
      <circle cx="7" cy="8" r="2" fill="currentColor" />
      <circle cx="17" cy="8" r="2" fill="currentColor" />
      <circle cx="12" cy="18" r="2" fill="currentColor" />
      <circle cx="12" cy="12" r="1.7" fill="currentColor" opacity="0.72" />
      {isLivePlaying ? targets.map((target, index) => (
        <circle key={`talk-${playKey}-${index}`} className="tag-live-pulse tag-live-pulse--broadcast" cx={source.x} cy={source.y} r="1.15" fill="var(--accent)" style={getPulseStyle(source, target)} />
      )) : null}
    </BaseIcon>
  );
}

function AiMemberIcon({ liveTrigger = 0, isLivePlaying = false }) {
  const playKey = liveTrigger || 0;
  const source = { x: 7, y: 17 };
  const target = { x: 17, y: 7 };
  return (
    <BaseIcon>
      <circle cx="7" cy="17" r="2.3" fill="currentColor" opacity="0.78" />
      <path d="M16.5 4.5L18 8.2L21.5 9.5L18 10.8L16.5 14.5L15 10.8L11.5 9.5L15 8.2L16.5 4.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path className="tag-micro__guide" d="M8.8 15.6C11 12.4 13.2 10.4 15.4 9.4" />
      {isLivePlaying ? (
        <circle key={`ai-${playKey}`} className="tag-live-pulse tag-live-pulse--dispatch" cx={source.x} cy={source.y} r="1.3" fill="var(--accent)" style={getPulseStyle(source, target)} />
      ) : null}
    </BaseIcon>
  );
}

function PersonalSpaceIcon({ liveTrigger = 0, isLivePlaying = false }) {
  const playKey = liveTrigger || 0;
  const source = { x: 12, y: 18 };
  const target = { x: 12, y: 9 };
  return (
    <BaseIcon>
      <rect x="5" y="5" width="14" height="15" rx="3" stroke="currentColor" strokeWidth="1.2" />
      <path d="M10 20V10.8C10 9.25 11.25 8 12.8 8H16" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <circle cx="15.6" cy="13" r="1.1" fill="currentColor" />
      {isLivePlaying ? (
        <circle key={`room-${playKey}`} className="tag-live-pulse tag-live-pulse--session" cx={source.x} cy={source.y} r="1.25" fill="var(--accent)" style={getPulseStyle(source, target)} />
      ) : null}
    </BaseIcon>
  );
}

function NotesIcon({ liveTrigger = 0, isLivePlaying = false }) {
  const playKey = liveTrigger || 0;
  const source = { x: 7, y: 9 };
  const target = { x: 15, y: 16 };
  return (
    <BaseIcon>
      <path d="M5 6.5H13C14.1 6.5 15 7.4 15 8.5V17.5C15 18.6 14.1 19.5 13 19.5H5V6.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M8 10H12M8 13H16M8 16H15" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path className="tag-micro__guide" d="M16 5L19 8L16 11" />
      {isLivePlaying ? (
        <circle key={`notes-${playKey}`} className="tag-live-pulse tag-live-pulse--zero" cx={source.x} cy={source.y} r="1.25" fill="var(--accent)" style={getPulseStyle(source, target)} />
      ) : null}
    </BaseIcon>
  );
}

export default function TagMicroAnimation({ type, tagId, reducedMotion = false }) {
  const { liveTrigger, isLivePlaying } = useTagLive({ type, tagId, reducedMotion });
  if (type === "ai-member") return <AiMemberIcon liveTrigger={liveTrigger} isLivePlaying={isLivePlaying} />;
  if (type === "personal-space") return <PersonalSpaceIcon liveTrigger={liveTrigger} isLivePlaying={isLivePlaying} />;
  if (type === "notes") return <NotesIcon liveTrigger={liveTrigger} isLivePlaying={isLivePlaying} />;
  return <CoThinkingIcon liveTrigger={liveTrigger} isLivePlaying={isLivePlaying} />;
}
