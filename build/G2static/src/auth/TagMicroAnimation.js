// Provides static tag icons plus lightweight pulse-driven activation hooks.
(() => {
    const { useEffect, useRef, useState } = window.React;

    const ACTIVATION_DURATION_MS = 600;
    const REACTOR_SELF_MIN_MS = 5000;
    const REACTOR_SELF_RANGE_MS = 3000;

    function clearTimer(timerRef) {
        if (timerRef.current) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
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

    function MultiReactorIcon({ isActivating = false }) {
        return (
            <BaseIcon>
                <g className={`tag-icon-breathing ${isActivating ? "is-activating" : ""}`.trim()}>
                    <circle cx="12" cy="12" r="2.45" fill="currentColor" />
                    <circle cx="12" cy="5" r="1.75" fill="currentColor" />
                    <circle cx="19" cy="12" r="1.75" fill="currentColor" />
                    <circle cx="12" cy="19" r="1.75" fill="currentColor" />
                    <circle cx="5" cy="12" r="1.75" fill="currentColor" />
                </g>
            </BaseIcon>
        );
    }

    function WSBroadcastIcon({ isActivating = false }) {
        return (
            <BaseIcon>
                <path className="tag-micro__guide" d="M12 6L6 18" />
                <path className="tag-micro__guide" d="M12 6L18 18" />
                <path className="tag-micro__guide" d="M6 18H18" />
                <g className={`tag-icon-breathing ${isActivating ? "is-activating" : ""}`.trim()}>
                    <circle cx="12" cy="6" r="2" fill="currentColor" />
                    <circle cx="6" cy="18" r="2" fill="currentColor" />
                    <circle cx="18" cy="18" r="2" fill="currentColor" />
                </g>
            </BaseIcon>
        );
    }

    function SessionAuthIcon({ isActivating = false }) {
        return (
            <BaseIcon>
                <g className={`tag-icon-breathing ${isActivating ? "is-activating" : ""}`.trim()}>
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
            </BaseIcon>
        );
    }

    function ZeroCopyIcon({ isActivating = false }) {
        return (
            <BaseIcon>
                <g className={`tag-icon-breathing ${isActivating ? "is-activating" : ""}`.trim()}>
                    <rect x="3.5" y="8" width="7.5" height="8" rx="1.2" stroke="currentColor" strokeWidth="1.2" />
                    <path
                        d="M14.5 12H20M17.1 9.5L20 12L17.1 14.5"
                        stroke="currentColor"
                        strokeWidth="1.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                </g>
            </BaseIcon>
        );
    }

    window.TagMicroAnimation = function TagMicroAnimation({ type, isActivating = false }) {
        if (type === "multi-reactor") {
            return <MultiReactorIcon isActivating={isActivating} />;
        }

        if (type === "ws-broadcast") {
            return <WSBroadcastIcon isActivating={isActivating} />;
        }

        if (type === "session-auth") {
            return <SessionAuthIcon isActivating={isActivating} />;
        }

        return <ZeroCopyIcon isActivating={isActivating} />;
    };

    window.useTagActivation = function useTagActivation({ tagId, reducedMotion = false, selfActivate = false } = {}) {
        const [isActivating, setIsActivating] = useState(false);
        const activateTimerRef = useRef(null);
        const releaseTimerRef = useRef(null);
        const selfTimerRef = useRef(null);
        const reducedMotionRef = useRef(reducedMotion);

        function triggerActivation() {
            if (reducedMotionRef.current) {
                return;
            }

            clearTimer(activateTimerRef);
            clearTimer(releaseTimerRef);

            setIsActivating(false);

            activateTimerRef.current = window.setTimeout(() => {
                setIsActivating(true);

                releaseTimerRef.current = window.setTimeout(() => {
                    setIsActivating(false);
                }, ACTIVATION_DURATION_MS);
            }, 0);
        }

        useEffect(() => {
            reducedMotionRef.current = reducedMotion;

            if (reducedMotion) {
                clearTimer(activateTimerRef);
                clearTimer(releaseTimerRef);
                clearTimer(selfTimerRef);
                setIsActivating(false);
            }
        }, [reducedMotion]);

        useEffect(() => {
            if (reducedMotion) {
                return undefined;
            }

            function handleArrive(event) {
                if (event.detail?.tagId === tagId) {
                    triggerActivation();
                }
            }

            window.addEventListener("arch-pulse-arrive", handleArrive);

            return () => {
                window.removeEventListener("arch-pulse-arrive", handleArrive);
            };
        }, [tagId, reducedMotion]);

        useEffect(() => {
            clearTimer(selfTimerRef);

            if (!selfActivate || reducedMotion) {
                return undefined;
            }

            function scheduleNextSelfActivation() {
                selfTimerRef.current = window.setTimeout(() => {
                    triggerActivation();
                    scheduleNextSelfActivation();
                }, REACTOR_SELF_MIN_MS + Math.random() * REACTOR_SELF_RANGE_MS);
            }

            scheduleNextSelfActivation();

            return () => {
                clearTimer(selfTimerRef);
            };
        }, [selfActivate, reducedMotion]);

        useEffect(() => {
            return () => {
                clearTimer(activateTimerRef);
                clearTimer(releaseTimerRef);
                clearTimer(selfTimerRef);
            };
        }, []);

        return { isActivating };
    };
})();
