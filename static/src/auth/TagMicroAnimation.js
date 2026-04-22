// Provides tag icons with architecture-pulse-driven live motion.
(() => {
    const { useEffect, useRef, useState } = window.React;

    const LIVE_QUEUE_MAX = 2;
    const LIVE_DURATIONS = {
        "multi-reactor": 500,
        "ws-broadcast": 600,
        "session-auth": 1500,
        "zero-copy": 500
    };
    const MULTI_REACTOR_POINTS = [
        { x: 12, y: 5 },
        { x: 19, y: 12 },
        { x: 12, y: 19 },
        { x: 5, y: 12 }
    ];
    const WS_POINTS = [
        { x: 12, y: 6 },
        { x: 6, y: 18 },
        { x: 18, y: 18 }
    ];
    const SESSION_DB_LINE = { y: 11, centerY: 11.75 };
    const TAG_IDS = {
        "multi-reactor": "tag-multi-reactor",
        "ws-broadcast": "tag-ws-broadcast",
        "session-auth": "tag-session-auth",
        "zero-copy": "tag-zero-copy"
    };

    function clearTimer(timerRef) {
        if (timerRef.current) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }

    function classNames(...parts) {
        return parts.filter(Boolean).join(" ");
    }

    function getLiveDuration(type) {
        return LIVE_DURATIONS[type] || LIVE_DURATIONS["zero-copy"];
    }

    function getTagId(type, tagId) {
        return tagId || TAG_IDS[type] || "";
    }

    function pickRandomIndexExcludingLast(count, lastChoiceRef) {
        if (count <= 0) {
            return -1;
        }

        if (count === 1) {
            lastChoiceRef.current = 0;
            return 0;
        }

        let choice = Math.floor(Math.random() * count);
        if (choice === lastChoiceRef.current) {
            choice = (choice + 1 + Math.floor(Math.random() * (count - 1))) % count;
        }

        lastChoiceRef.current = choice;
        return choice;
    }

    function getPulseStyle(source, target) {
        return {
            "--live-dx": `${target.x - source.x}px`,
            "--live-dy": `${target.y - source.y}px`
        };
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
            if (reducedMotionRef.current) {
                resetLiveQueue();
                return;
            }

            if (isPlayingRef.current || queueRef.current === 0) {
                return;
            }

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
            if (reducedMotionRef.current || queueRef.current >= LIVE_QUEUE_MAX) {
                return;
            }

            queueRef.current += 1;
            processQueue();
        }

        useEffect(() => {
            reducedMotionRef.current = reducedMotion;
            durationRef.current = getLiveDuration(type);
            tagIdRef.current = getTagId(type, tagId);

            if (reducedMotion) {
                resetLiveQueue();
            }
        }, [type, tagId, reducedMotion]);

        useEffect(() => {
            if (reducedMotion) {
                return undefined;
            }

            function handleArrive(event) {
                if (event.detail?.tagId === tagIdRef.current) {
                    triggerLive();
                }
            }

            function handleDepart(event) {
                if (type === "multi-reactor" && event.detail?.sourceTagId === tagIdRef.current) {
                    triggerLive();
                }
            }

            window.addEventListener("arch-pulse-arrive", handleArrive);
            window.addEventListener("arch-pulse-depart", handleDepart);

            return () => {
                window.removeEventListener("arch-pulse-arrive", handleArrive);
                window.removeEventListener("arch-pulse-depart", handleDepart);
            };
        }, [type, tagId, reducedMotion]);

        useEffect(() => {
            return () => {
                clearTimer(liveTimerRef);
            };
        }, []);

        return { liveTrigger, isLivePlaying };
    }

    function BaseIcon({ children }) {
        return (
            <svg
                className="tag-micro"
                viewBox="0 0 24 24"
                width="24"
                height="24"
                fill="none"
                aria-hidden="true"
                focusable="false"
            >
                {children}
            </svg>
        );
    }

    function MultiReactorIcon({ liveTrigger = 0, isLivePlaying = false }) {
        const playRef = useRef(null);
        const lastTargetRef = useRef(-1);
        const source = { x: 12, y: 12 };

        if (liveTrigger > 0 && (!playRef.current || playRef.current.key !== liveTrigger)) {
            const targetIndex = pickRandomIndexExcludingLast(MULTI_REACTOR_POINTS.length, lastTargetRef);
            playRef.current = {
                key: liveTrigger,
                target: MULTI_REACTOR_POINTS[targetIndex]
            };
        }

        const play = playRef.current;

        return (
            <BaseIcon>
                <g>
                    <circle cx="12" cy="12" r="2.45" fill="currentColor" />
                    <circle cx="12" cy="5" r="1.75" fill="currentColor" />
                    <circle cx="19" cy="12" r="1.75" fill="currentColor" />
                    <circle cx="12" cy="19" r="1.75" fill="currentColor" />
                    <circle cx="5" cy="12" r="1.75" fill="currentColor" />
                </g>

                {play && isLivePlaying ? (
                    <>
                        <circle
                            key={`dispatch-${play.key}`}
                            className="tag-live-pulse tag-live-pulse--dispatch"
                            cx={source.x}
                            cy={source.y}
                            r="1.5"
                            fill="var(--accent)"
                            style={getPulseStyle(source, play.target)}
                        />
                        <circle
                            key={`dispatch-flash-${play.key}`}
                            className="tag-live-node-flash tag-live-node-flash--dispatch"
                            cx={play.target.x}
                            cy={play.target.y}
                            r="1.75"
                            fill="var(--accent)"
                        />
                    </>
                ) : null}
            </BaseIcon>
        );
    }

    function WSBroadcastIcon({ liveTrigger = 0, isLivePlaying = false }) {
        const playRef = useRef(null);
        const lastSourceRef = useRef(-1);

        if (liveTrigger > 0 && (!playRef.current || playRef.current.key !== liveTrigger)) {
            const sourceIndex = pickRandomIndexExcludingLast(WS_POINTS.length, lastSourceRef);
            playRef.current = {
                key: liveTrigger,
                source: WS_POINTS[sourceIndex],
                targets: WS_POINTS.filter((_, index) => index !== sourceIndex)
            };
        }

        const play = playRef.current;

        return (
            <BaseIcon>
                <path className="tag-micro__guide" d="M12 6L6 18" />
                <path className="tag-micro__guide" d="M12 6L18 18" />
                <path className="tag-micro__guide" d="M6 18H18" />
                <g>
                    <circle cx="12" cy="6" r="2" fill="currentColor" />
                    <circle cx="6" cy="18" r="2" fill="currentColor" />
                    <circle cx="18" cy="18" r="2" fill="currentColor" />
                </g>

                {play && isLivePlaying ? (
                    <>
                        {play.targets.map((target, index) => (
                            <circle
                                key={`broadcast-${play.key}-${index}`}
                                className="tag-live-pulse tag-live-pulse--broadcast"
                                cx={play.source.x}
                                cy={play.source.y}
                                r="1.2"
                                fill="var(--accent)"
                                style={getPulseStyle(play.source, target)}
                            />
                        ))}
                        {play.targets.map((target, index) => (
                            <circle
                                key={`broadcast-flash-${play.key}-${index}`}
                                className="tag-live-node-flash tag-live-node-flash--broadcast"
                                cx={target.x}
                                cy={target.y}
                                r="2"
                                fill="var(--accent)"
                            />
                        ))}
                    </>
                ) : null}
            </BaseIcon>
        );
    }

    function SessionAuthIcon({ liveTrigger = 0, isLivePlaying = false }) {
        const playRef = useRef(null);
        const source = { x: 7, y: 12.5 };

        if (liveTrigger > 0 && (!playRef.current || playRef.current.key !== liveTrigger)) {
            playRef.current = {
                key: liveTrigger,
                target: { x: 17, y: SESSION_DB_LINE.centerY }
            };
        }

        const play = playRef.current;

        return (
            <BaseIcon>
                <g>
                    <g>
                        <rect x="4" y="10" width="6" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
                        <path
                            d="M5.5 10V8A1.5 1.5 0 0 1 8.5 8V10"
                            stroke="currentColor"
                            strokeWidth="1.2"
                            strokeLinecap="round"
                        />
                    </g>
                    <rect x="14" y="7" width="6" height="1.5" rx="0.75" fill="currentColor" />
                    <rect x="14" y="11" width="6" height="1.5" rx="0.75" fill="currentColor" />
                    <rect x="14" y="15" width="6" height="1.5" rx="0.75" fill="currentColor" />
                </g>

                {play && isLivePlaying ? (
                    <>
                        <circle
                            key={`session-${play.key}`}
                            className="tag-live-pulse tag-live-pulse--session"
                            cx={source.x}
                            cy={source.y}
                            r="1.5"
                            fill="var(--accent)"
                            style={getPulseStyle(source, play.target)}
                        />
                        <rect
                            key={`session-flash-${play.key}`}
                            className="tag-live-db-flash"
                            x="14"
                            y={SESSION_DB_LINE.y}
                            width="6"
                            height="1.5"
                            rx="0.75"
                            fill="var(--accent)"
                        />
                    </>
                ) : null}
            </BaseIcon>
        );
    }

    function ZeroCopyIcon({ liveTrigger = 0, isLivePlaying = false }) {
        const playRef = useRef(null);
        const source = { x: 8.5, y: 12 };
        const target = { x: 26.5, y: 12 };

        if (liveTrigger > 0 && (!playRef.current || playRef.current.key !== liveTrigger)) {
            playRef.current = { key: liveTrigger };
        }

        const play = playRef.current;

        return (
            <BaseIcon>
                <g>
                    <rect x="3.5" y="8" width="7.5" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
                    <path
                        className={classNames("tag-zero-arrow", play && isLivePlaying && "is-pushing")}
                        d="M14.5 12H20M17.1 9.5L20 12L17.1 14.5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </g>

                {play && isLivePlaying ? (
                    <circle
                        key={`zero-${play.key}`}
                        className="tag-live-pulse tag-live-pulse--zero"
                        cx={source.x}
                        cy={source.y}
                        r="1.5"
                        fill="var(--accent)"
                        style={getPulseStyle(source, target)}
                    />
                ) : null}
            </BaseIcon>
        );
    }

    window.TagMicroAnimation = function TagMicroAnimation({ type, tagId, reducedMotion = false }) {
        const { liveTrigger, isLivePlaying } = useTagLive({ type, tagId, reducedMotion });

        if (type === "multi-reactor") {
            return (
                <MultiReactorIcon
                    liveTrigger={liveTrigger}
                    isLivePlaying={isLivePlaying}
                />
            );
        }

        if (type === "ws-broadcast") {
            return (
                <WSBroadcastIcon
                    liveTrigger={liveTrigger}
                    isLivePlaying={isLivePlaying}
                />
            );
        }

        if (type === "session-auth") {
            return (
                <SessionAuthIcon
                    liveTrigger={liveTrigger}
                    isLivePlaying={isLivePlaying}
                />
            );
        }

        return (
            <ZeroCopyIcon
                liveTrigger={liveTrigger}
                isLivePlaying={isLivePlaying}
            />
        );
    };
})();
