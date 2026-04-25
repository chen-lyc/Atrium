// Defines the unified auth page with interactive demo chat and floating auth panel.
(() => {
    const { useEffect, useRef, useState } = window.React;
    const { motion, AnimatePresence } = window;
    const { EASE, TAP_TRANSITION } = window.AppConstants;
    const TechCardPopover = window.TechCardPopover;
    const useReducedMotion = window.useReducedMotion;

    const CHANGELOG_ITEMS = [
        { version: "v3.0", title: "登录鉴权 + 玻璃表单" },
        { version: "v2.3", title: "sendfile 零拷贝" },
        { version: "v2.0", title: "Multi-Reactor 架构" },
        { version: "v1.x", title: "基础 WebSocket" }
    ];

    const TECH_CARDS = [
        {
            key: "card-1",
            className: "tech-card-1",
            title: "Multi-Reactor",
            subtitle: "主 + N SubReactor / epoll ET",
            type: "multi-reactor",
            tagId: "tag-multi-reactor"
        },
        {
            key: "card-2",
            className: "tech-card-2",
            title: "WebSocket 广播",
            subtitle: "跨 Reactor 帧解析",
            type: "ws-broadcast",
            tagId: "tag-ws-broadcast"
        },
        {
            key: "card-3",
            className: "tech-card-3",
            title: "Session 鉴权",
            subtitle: "Redis + Cookie · TTL 24h",
            type: "session-auth",
            tagId: "tag-session-auth"
        },
        {
            key: "card-4",
            className: "tech-card-4",
            title: "Zero-copy",
            subtitle: "sendfile · QPS +23%",
            type: "zero-copy",
            tagId: "tag-zero-copy"
        }
    ];

    const SVG_VIEWBOX = { x: -800, y: -450, width: 1600, height: 900 };
    const ARCH_PULSE_ARRIVAL_THRESHOLD = 0.95;
    const ARCH_PATHS = [
        {
            id: "path-auth",
            d: "M -392.36 -114.80 C -486.00 -86.00 -486.00 86.00 -430.00 188.00",
            sourceTagId: "tag-multi-reactor",
            targetTagId: "tag-session-auth"
        },
        {
            id: "path-broadcast",
            d: "M -352 -166 C -262 -175 -204 -332 -12 -332 C 196 -332 286 -200 386 -126",
            sourceTagId: "tag-multi-reactor",
            targetTagId: "tag-ws-broadcast"
        },
        {
            id: "path-zerocopy",
            d: "M -358.38 -115.41 C -318.00 -86.00 -228.00 288.00 38.00 336.00 C 232.00 340.00 336.00 305.00 384.00 230.00",
            sourceTagId: "tag-multi-reactor",
            targetTagId: "tag-zero-copy"
        }
    ];
    const PULSE_TRAIL_STEPS = [0, 0.014, 0.028, 0.042];
    const LOADING_DOT_DELAYS = ["0s", "0.15s", "0.3s"];

    function getPulseFadeMultiplier(progress) {
        if (progress <= 0.1) {
            return progress / 0.1;
        }
        if (progress >= 0.9) {
            return (1 - progress) / 0.1;
        }
        return 1;
    }

    function InlineError({ message, className = "" }) {
        return (
            <AnimatePresence initial={false}>
                {message ? (
                    <motion.div
                        key={message}
                        className={`auth-error ${className}`.trim()}
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.18, ease: EASE }}
                    >
                        {message}
                    </motion.div>
                ) : null}
            </AnimatePresence>
        );
    }

    function LoadingDots() {
        return (
            <span className="loading-dots" aria-hidden="true">
                {LOADING_DOT_DELAYS.map((delay) => (
                    <span key={delay} className="loading-dot" style={{ animationDelay: delay }} />
                ))}
            </span>
        );
    }

    function LoadingStage() {
        return (
            <div className="loading-page">
                <motion.div
                    className="loading-panel"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8, transition: { duration: 0.18, ease: EASE } }}
                    transition={{ duration: 0.24, ease: EASE }}
                >
                    <div className="auth-brand">Signal</div>
                    <div className="loading-copy">正在验证会话</div>
                </motion.div>
            </div>
        );
    }

    function ArchitectureConnections({ reducedMotion, enabled = true }) {
        const pathRefs = useRef({});
        const animationFrameRef = useRef(null);
        const [pulses, setPulses] = useState([]);

        useEffect(() => {
            if (animationFrameRef.current) {
                window.cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }

            if (!enabled || reducedMotion) {
                setPulses([]);
                return undefined;
            }

            let isDisposed = false;
            let dispatchedDepartKeys = new Set();
            const timerIds = new Set();

            function queueTimeout(callback, delay) {
                const timerId = window.setTimeout(() => {
                    timerIds.delete(timerId);
                    if (!isDisposed) {
                        callback();
                    }
                }, delay);

                timerIds.add(timerId);
                return timerId;
            }

            function dispatchDepart(pathConfig, departKey) {
                if (!pathConfig.sourceTagId) {
                    return;
                }

                if (departKey && dispatchedDepartKeys.has(departKey)) {
                    return;
                }

                if (departKey) {
                    dispatchedDepartKeys.add(departKey);
                }

                window.dispatchEvent(
                    new CustomEvent("arch-pulse-depart", {
                        detail: {
                            sourceTagId: pathConfig.sourceTagId,
                            pathId: pathConfig.id
                        }
                    })
                );
            }

            function dispatchArrivalAsync(tagId) {
                if (!tagId) {
                    return;
                }

                const dispatchArrival = () => {
                    if (isDisposed) {
                        return;
                    }

                    window.dispatchEvent(
                        new CustomEvent("arch-pulse-arrive", {
                            detail: { tagId }
                        })
                    );
                };

                if (typeof window.queueMicrotask === "function") {
                    window.queueMicrotask(dispatchArrival);
                    return;
                }

                window.setTimeout(dispatchArrival, 0);
            }

            function spawnPulse(pathId, duration = 1400, options = {}) {
                const pathConfig = ARCH_PATHS.find((path) => path.id === pathId);
                if (!pathConfig || isDisposed) {
                    return;
                }

                if (options.dispatchDepart !== false) {
                    dispatchDepart(pathConfig, options.departKey);
                }

                setPulses((prev) => [
                    ...prev,
                    {
                        id: `${pathConfig.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                        pathId: pathConfig.id,
                        targetTagId: pathConfig.targetTagId,
                        progress: 0,
                        startTime: window.performance.now(),
                        duration,
                        didDispatchArrival: false
                    }
                ]);
            }

            function handleBroadcast(event) {
                spawnPulse("path-broadcast", 1400, {
                    departKey: event.detail?.messageId || `${Date.now()}-${Math.random()}`
                });
            }

            function handleSystem(event) {
                const departKey = event.detail?.messageId || `${Date.now()}-${Math.random()}`;
                spawnPulse("path-auth", 1400, { departKey });
                spawnPulse("path-zerocopy", 1400, { dispatchDepart: false });
            }

            function handleScriptStart(event) {
                const departKey = `script-${event.detail?.scriptIndex ?? "x"}-${Date.now()}-${Math.random()}`;
                spawnPulse("path-auth", 1400, { departKey });
                queueTimeout(() => {
                    spawnPulse("path-zerocopy", 1400, { dispatchDepart: false });
                }, 300);
            }

            function scheduleAuthProbe() {
                const delay = 25000 + Math.random() * 10000;
                queueTimeout(() => {
                    if (Math.random() < 0.25) {
                        spawnPulse("path-auth", 1400);
                    }
                    scheduleAuthProbe();
                }, delay);
            }

            window.addEventListener("signal-message-broadcast", handleBroadcast);
            window.addEventListener("signal-message-system", handleSystem);
            window.addEventListener("signal-script-start", handleScriptStart);
            scheduleAuthProbe();

            function tick() {
                if (isDisposed) {
                    return;
                }

                const now = window.performance.now();
                setPulses((prev) => {
                    if (!prev.length) {
                        return prev;
                    }

                    return prev
                        .map((pulse) => {
                            const nextProgress = Math.min(1, (now - pulse.startTime) / pulse.duration);

                            if (
                                !pulse.didDispatchArrival &&
                                pulse.targetTagId &&
                                nextProgress >= ARCH_PULSE_ARRIVAL_THRESHOLD
                            ) {
                                dispatchArrivalAsync(pulse.targetTagId);
                            }

                            return {
                                ...pulse,
                                progress: nextProgress,
                                didDispatchArrival:
                                    pulse.didDispatchArrival ||
                                    (Boolean(pulse.targetTagId) && nextProgress >= ARCH_PULSE_ARRIVAL_THRESHOLD)
                            };
                        })
                        .filter((pulse) => pulse.progress < 1);
                });

                animationFrameRef.current = window.requestAnimationFrame(tick);
            }

            animationFrameRef.current = window.requestAnimationFrame(tick);

            return () => {
                isDisposed = true;
                dispatchedDepartKeys = new Set();
                timerIds.forEach((timerId) => {
                    window.clearTimeout(timerId);
                });
                timerIds.clear();
                window.removeEventListener("signal-message-broadcast", handleBroadcast);
                window.removeEventListener("signal-message-system", handleSystem);
                window.removeEventListener("signal-script-start", handleScriptStart);

                if (animationFrameRef.current) {
                    window.cancelAnimationFrame(animationFrameRef.current);
                    animationFrameRef.current = null;
                }
            };
        }, [enabled, reducedMotion]);

        const pulseNodes = [];

        pulses.forEach((pulse) => {
            const pathElement = pathRefs.current[pulse.pathId];
            if (!pathElement) {
                return;
            }

            const totalLength = pathElement.getTotalLength();
            const fadeMultiplier = getPulseFadeMultiplier(pulse.progress);

            PULSE_TRAIL_STEPS.forEach((offset, index) => {
                const trailProgress = Math.max(0, pulse.progress - offset);
                const point = pathElement.getPointAtLength(totalLength * trailProgress);

                pulseNodes.push(
                    <circle
                        key={`${pulse.id}-${index}`}
                        className="arch-pulse"
                        cx={point.x}
                        cy={point.y}
                        r={Math.max(1.3, 2.45 - index * 0.28)}
                        fill="var(--pulse-color)"
                        opacity={Math.max(0, 1 - index * 0.24) * fadeMultiplier}
                    />
                );
            });
        });

        return (
            <svg
                className="arch-connections"
                viewBox={`${SVG_VIEWBOX.x} ${SVG_VIEWBOX.y} ${SVG_VIEWBOX.width} ${SVG_VIEWBOX.height}`}
                preserveAspectRatio="xMidYMid meet"
                aria-hidden="true"
                focusable="false"
            >
                {ARCH_PATHS.map((path) => (
                    <path
                        key={path.id}
                        id={path.id}
                        ref={(node) => {
                            if (node) {
                                pathRefs.current[path.id] = node;
                            } else {
                                delete pathRefs.current[path.id];
                            }
                        }}
                        className="arch-connection-path"
                        d={path.d}
                        stroke="var(--line-arch)"
                        strokeWidth="1"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        fill="none"
                    />
                ))}
                {pulseNodes}
            </svg>
        );
    }

    function AnimatedSubtitle({ text, playTyping, reducedMotion, className = "auth-subtitle" }) {
        if (reducedMotion || !playTyping) {
            return (
                <motion.div
                    className={className}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.22, ease: EASE }}
                >
                    {text}
                </motion.div>
            );
        }

        return (
            <div className={className} aria-label={text}>
                {Array.from(text).map((char, index) => (
                    <motion.span
                        key={`${text}-${index}`}
                        className="auth-subtitle-letter"
                        initial={{ opacity: 0, y: 4 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: index * 0.08, duration: 0.3, ease: EASE }}
                    >
                        {char}
                    </motion.span>
                ))}
            </div>
        );
    }

    function GithubIcon() {
        return (
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                    d="M12 2C6.48 2 2 6.48 2 12.15C2 16.68 4.87 20.52 8.84 21.88C9.34 21.97 9.53 21.66 9.53 21.39C9.53 21.15 9.52 20.35 9.51 19.29C6.73 19.91 6.14 18.09 6.14 18.09C5.68 16.88 5.03 16.56 5.03 16.56C4.12 15.93 5.1 15.94 5.1 15.94C6.1 16.02 6.63 16.99 6.63 16.99C7.53 18.56 8.98 18.11 9.55 17.84C9.64 17.17 9.9 16.71 10.18 16.45C7.96 16.19 5.62 15.3 5.62 11.31C5.62 10.18 6.01 9.25 6.66 8.52C6.56 8.26 6.22 7.22 6.75 5.82C6.75 5.82 7.59 5.54 9.5 6.87C10.3 6.64 11.16 6.52 12 6.51C12.84 6.52 13.7 6.64 14.5 6.87C16.41 5.54 17.25 5.82 17.25 5.82C17.78 7.22 17.44 8.26 17.34 8.52C17.99 9.25 18.38 10.18 18.38 11.31C18.38 15.31 16.03 16.19 13.8 16.44C14.15 16.75 14.46 17.35 14.46 18.27C14.46 19.59 14.45 20.99 14.45 21.39C14.45 21.66 14.64 21.98 15.15 21.88C19.12 20.52 22 16.68 22 12.15C22 6.48 17.52 2 12 2Z"
                    fill="currentColor"
                />
            </svg>
        );
    }

    function ArrowSendIcon() {
        return (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <path
                    d="M4.25 11.75L11.75 4.25"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
                <path
                    d="M5.5 4.25H11.75V10.5"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                />
            </svg>
        );
    }

    function VersionPopover({ label = "v3.0", className = "", placement = "bottom" }) {
        const [isOpen, setIsOpen] = useState(false);

        function handleBlur(event) {
            if (event.currentTarget.contains(event.relatedTarget)) {
                return;
            }

            setIsOpen(false);
        }

        const initialOffset = placement === "top" ? 4 : -4;

        return (
            <div
                className={`version-popover-shell changelog-trigger-wrap ${placement === "top" ? "is-top" : "is-bottom"} ${
                    isOpen ? "is-open" : ""
                } ${className}`.trim()}
                onMouseEnter={() => setIsOpen(true)}
                onMouseLeave={() => setIsOpen(false)}
                onFocusCapture={() => setIsOpen(true)}
                onBlurCapture={handleBlur}
            >
                <button type="button" className="version-trigger focus-ring">
                    {label}
                </button>
                <div className="version-popover-bridge" aria-hidden="true" />

                <AnimatePresence initial={false}>
                    {isOpen ? (
                        <motion.div
                            className="version-popover changelog-popover"
                            role="tooltip"
                            initial={{ opacity: 0, y: initialOffset }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: initialOffset }}
                            transition={{ duration: 0.18, ease: EASE }}
                        >
                            {CHANGELOG_ITEMS.map((item) => (
                                <button
                                    key={item.version}
                                    type="button"
                                    className="version-popover-row focus-ring"
                                >
                                    <span className="version-popover-title">{item.title}</span>
                                    <span className="version-popover-meta">{item.version}</span>
                                </button>
                            ))}
                        </motion.div>
                    ) : null}
                </AnimatePresence>
            </div>
        );
    }

    function ThemeToggle({ mode, resolvedMode, onCycle }) {
        const icon = mode === "system" ? "🌗" : resolvedMode === "dark" ? "☀️" : "🌙";

        return (
            <button
                type="button"
                className="icon-button auth-theme-button focus-ring"
                onClick={onCycle}
                aria-label={`切换主题，当前为${mode === "system" ? "跟随系统" : mode === "dark" ? "深色" : "浅色"}`}
                title={`当前主题：${mode === "system" ? "跟随系统" : mode === "dark" ? "深色" : "浅色"}`}
            >
                <span aria-hidden="true">{icon}</span>
            </button>
        );
    }

    function AuthFloatingPanel({
        mode,
        reducedMotion,
        shouldTypeSubtitle,
        disabled,
        quietEntry = false,
        onClose,
        onSwitchMode,
        onSuccess
    }) {
        const LoginPage = window.LoginPage;
        const RegisterPage = window.RegisterPage;
        const subtitleText = mode === "login" ? "欢迎回来" : "创建账号";

        return (
            <motion.section
                className="auth-floating-panel"
                role="dialog"
                aria-modal="true"
                aria-labelledby="auth-panel-title"
                initial={reducedMotion || quietEntry ? { opacity: 0 } : { opacity: 0, y: 36 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion || quietEntry ? { opacity: 0 } : { opacity: 0, y: 44 }}
                transition={{ duration: reducedMotion ? 0.01 : 0.24, ease: EASE }}
            >
                <button
                    type="button"
                    className="auth-panel-close icon-button focus-ring"
                    onClick={onClose}
                    disabled={disabled}
                    aria-label={`关闭${mode === "login" ? "登录" : "注册"}面板`}
                >
                    ×
                </button>

                <div className="auth-panel-header">
                    <div id="auth-panel-title" className="auth-panel-brand">Signal</div>

                    <AnimatePresence initial={false}>
                        <AnimatedSubtitle
                            key={subtitleText}
                            text={subtitleText}
                            playTyping={shouldTypeSubtitle}
                            reducedMotion={reducedMotion}
                            className="auth-panel-subtitle"
                        />
                    </AnimatePresence>
                </div>

                <div className="auth-panel-form">
                    <AnimatePresence mode="popLayout" initial={false}>
                        {mode === "login" ? (
                            <motion.div
                                key="login-form"
                                layout
                                className="auth-form-pane"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: reducedMotion ? 0.01 : 0.14, ease: EASE }}
                            >
                                <LoginPage
                                    onSwitchRegister={() => onSwitchMode("register")}
                                    onSuccess={onSuccess}
                                    disabled={disabled}
                                />
                            </motion.div>
                        ) : (
                            <motion.div
                                key="register-form"
                                layout
                                className="auth-form-pane"
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0 }}
                                transition={{ duration: reducedMotion ? 0.01 : 0.14, ease: EASE }}
                            >
                                <RegisterPage
                                    onSwitchLogin={() => onSwitchMode("login")}
                                    onSuccess={onSuccess}
                                    disabled={disabled}
                                />
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
            </motion.section>
        );
    }

    function TechCard({ card, revealMotion, reducedMotion }) {
        return <TechCardPopover card={card} revealMotion={revealMotion} reducedMotion={reducedMotion} />;
    }

    function AuthShell({
        mode,
        isPanelOpen,
        onOpenMode,
        onClosePanel,
        onNavigateHome,
        onSuccess,
        disabled,
        isHandoffPending = false,
        transitionMode = "idle",
        transitionConfig = null
    }) {
        const MessageList = window.MessageList;
        const useDemoMessages = window.useDemoMessages;
        const useAutoTyping = window.useAutoTyping;
        const reducedMotion = useReducedMotion();
        const responseTimersRef = useRef([]);
        const typeATriggerRef = useRef(() => {});
        const lastChitchatIndexRef = useRef(-1);
        const viewportRef = useRef(null);
        const sendMotionTimerRef = useRef(null);
        const demoPlaybackTimerRef = useRef(null);
        const authSuccessLockedRef = useRef(false);
        const isExitingToChat = transitionMode === "exit-to-chat";
        const isEnteringFromChat = transitionMode === "enter-from-chat";
        const isSceneTransitioning = isExitingToChat || isEnteringFromChat;

        const [themeMode, setThemeMode] = useState(window.ThemeManager?.getMode?.() || "system");
        const [resolvedTheme, setResolvedTheme] = useState(window.ThemeManager?.getResolvedMode?.() || "light");
        const [isDemoPlaybackReady, setDemoPlaybackReady] = useState(false);
        const [sendMotionPhase, setSendMotionPhase] = useState("idle");
        const [isSendHovered, setSendHovered] = useState(false);
        const [isPanelBackdropActive, setPanelBackdropActive] = useState(isPanelOpen);
        const prefersReducedMotion =
            reducedMotion || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;

        const demoState = useDemoMessages({
            enabled: isDemoPlaybackReady && !isHandoffPending && !isSceneTransitioning,
            fadeDuration: reducedMotion ? 1 : 140,
            onTypeATrigger: () => typeATriggerRef.current?.(),
            reducedMotion,
            preserveMessagesOnDisable: isHandoffPending || isExitingToChat
        });

        const autoTyping = useAutoTyping({
            currentScript: demoState.activeScript,
            enabled: isDemoPlaybackReady && !isHandoffPending && !isSceneTransitioning
        });

        typeATriggerRef.current = autoTyping.triggerTypeA;

        useEffect(() => {
            function handleThemeChange(event) {
                setThemeMode(event.detail?.mode || window.ThemeManager?.getMode?.() || "system");
                setResolvedTheme(
                    event.detail?.resolvedMode || window.ThemeManager?.getResolvedMode?.() || "light"
                );
            }

            window.addEventListener("themechange", handleThemeChange);
            return () => {
                window.removeEventListener("themechange", handleThemeChange);
            };
        }, []);

        useEffect(() => {
            if (isPanelOpen) {
                setPanelBackdropActive(true);
            }
        }, [isPanelOpen, mode]);

        useEffect(() => {
            if (!disabled && !isSceneTransitioning) {
                authSuccessLockedRef.current = false;
            }
        }, [disabled, isSceneTransitioning]);

        useEffect(() => {
            if (!isHandoffPending && !isSceneTransitioning) {
                return undefined;
            }

            responseTimersRef.current.forEach((timerId) => {
                window.clearTimeout(timerId);
            });
            responseTimersRef.current = [];
            window.clearTimeout(sendMotionTimerRef.current);
            autoTyping.cancelAutoTimers();
            setSendMotionPhase("idle");
            setSendHovered(false);

            return undefined;
        }, [isHandoffPending, isSceneTransitioning]);

        useEffect(() => {
            window.clearTimeout(demoPlaybackTimerRef.current);

            if (isSceneTransitioning) {
                setDemoPlaybackReady(false);
                return undefined;
            }

            demoPlaybackTimerRef.current = window.setTimeout(() => {
                setDemoPlaybackReady(true);
            }, reducedMotion ? 0 : 120);

            return () => {
                window.clearTimeout(demoPlaybackTimerRef.current);
            };
        }, [isSceneTransitioning, reducedMotion, mode]);

        useEffect(() => {
            return () => {
                responseTimersRef.current.forEach((timerId) => {
                    window.clearTimeout(timerId);
                });
                responseTimersRef.current = [];
                window.clearTimeout(sendMotionTimerRef.current);
                window.clearTimeout(demoPlaybackTimerRef.current);
            };
        }, []);

        function scheduleResponseTimer(callback, delay) {
            const timerId = window.setTimeout(callback, delay);
            responseTimersRef.current.push(timerId);
        }

        function pickChitchatReply() {
            const pool = window.chitchatReplies || [];
            if (!pool.length) {
                return null;
            }

            if (pool.length === 1) {
                lastChitchatIndexRef.current = 0;
                return pool[0];
            }

            const candidates = pool
                .map((item, index) => ({ item, index }))
                .filter(({ index }) => index !== lastChitchatIndexRef.current);
            const picked = candidates[Math.floor(Math.random() * candidates.length)] || candidates[0];
            lastChitchatIndexRef.current = picked.index;
            return picked.item;
        }

        function buildReplyPlan(sentText) {
            const typeAContent = demoState.activeScript?.typeA?.content || "";
            const isTypeAReply = Boolean(typeAContent) && sentText === typeAContent;

            if (isTypeAReply && demoState.activeScript?.typeA?.replyOnSend) {
                let followupDelay = 0;
                const replyOnSend = demoState.activeScript.typeA.replyOnSend;
                const entries = [{ ...replyOnSend.reply, source: "demo", delay: 0 }];

                (replyOnSend.followups || []).forEach((message) => {
                    followupDelay += reducedMotion ? 0 : 1400 + Math.round(Math.random() * 500);
                    entries.push({
                        ...message,
                        source: "demo",
                        delay: followupDelay
                    });
                });

                return {
                    entries,
                    pauseScriptMs: followupDelay + 3500,
                    recoverDelayMs: followupDelay + 2200,
                    holdScriptMs: followupDelay + 5000
                };
            }

            const chitchatReply = pickChitchatReply();
            if (!chitchatReply) {
                return {
                    entries: [],
                    pauseScriptMs: 2000,
                    recoverDelayMs: 2000,
                    holdScriptMs: 3500
                };
            }

            const secondChitchatReply = pickChitchatReply();
            const secondReplyDelay = reducedMotion ? 0 : 1600 + Math.round(Math.random() * 500);
            const entries = [
                {
                    ...chitchatReply,
                    source: "demo",
                    delay: 0
                }
            ];

            if (secondChitchatReply) {
                entries.push({
                    ...secondChitchatReply,
                    source: "demo",
                    delay: secondReplyDelay
                });
            }

            return {
                entries,
                pauseScriptMs: secondReplyDelay + 3500,
                recoverDelayMs: secondReplyDelay + 2200,
                holdScriptMs: secondReplyDelay + 4500
            };
        }

        function handleSend() {
            const trimmedValue = autoTyping.inputValue.trim();
            if (!trimmedValue || isPanelOpen || isPanelBackdropActive || isSceneTransitioning || disabled) {
                return;
            }

            demoState.appendMessage({
                nickname: "访客",
                text: trimmedValue,
                isSelf: true,
                source: "visitor"
            });

            const replyPlan = buildReplyPlan(trimmedValue);
            demoState.holdScript((reducedMotion ? 0 : 1500) + replyPlan.holdScriptMs);

            scheduleResponseTimer(() => {
                demoState.injectMessages(replyPlan.entries, replyPlan.pauseScriptMs);
            }, reducedMotion ? 0 : 1500);
            autoTyping.recoverToTypeB(replyPlan.recoverDelayMs);
        }

        function handleComposerKeyDown(event) {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSend();
            }
        }

        function handleAuthSuccess(nickname) {
            if (authSuccessLockedRef.current) {
                return;
            }

            authSuccessLockedRef.current = true;
            onSuccess(nickname);
        }

        const trimmedComposerValue = autoTyping.inputValue.trim();
        const isSendEmphasized =
            Boolean(trimmedComposerValue) &&
            autoTyping.sendState !== "typing" &&
            autoTyping.sendState !== "deleting";
        const emphasizedSendBackground =
            "linear-gradient(135deg, var(--text) 0%, color-mix(in srgb, var(--text) 75%, #000) 100%)";

        useEffect(() => {
            window.clearTimeout(sendMotionTimerRef.current);

            if (!isSendEmphasized || reducedMotion) {
                setSendMotionPhase("idle");
                setSendHovered(false);
                return undefined;
            }

            setSendMotionPhase("reveal");
            sendMotionTimerRef.current = window.setTimeout(() => {
                setSendMotionPhase("breathe");
            }, 600);

            return () => {
                window.clearTimeout(sendMotionTimerRef.current);
            };
        }, [isSendEmphasized, reducedMotion]);

        function getSendButtonAnimation() {
            const baseState = {
                background: isSendEmphasized ? emphasizedSendBackground : "transparent",
                color: isSendEmphasized ? "#ffffff" : "var(--text-subtle)"
            };

            if (reducedMotion) {
                return {
                    animate: {
                        ...baseState,
                        scale: isSendHovered ? 1.08 : 1
                    },
                    transition: {
                        scale: { duration: 0.18, ease: EASE },
                        background: { duration: 0.3 },
                        color: { duration: 0.3 }
                    }
                };
            }

            if (isSendHovered) {
                return {
                    animate: {
                        ...baseState,
                        scale: 1.08
                    },
                    transition: {
                        scale: { duration: 0.2, ease: "easeOut" },
                        background: { duration: 0.3 },
                        color: { duration: 0.3 }
                    }
                };
            }

            if (!isSendEmphasized) {
                return {
                    animate: {
                        background: "transparent",
                        color: "var(--text-subtle)",
                        scale: 1
                    },
                    transition: {
                        scale: { duration: 0.2, ease: EASE },
                        background: { duration: 0.3 },
                        color: { duration: 0.3 }
                    }
                };
            }

            if (sendMotionPhase === "reveal") {
                return {
                    animate: {
                        ...baseState,
                        scale: [0.8, 1.15, 1]
                    },
                    transition: {
                        scale: {
                            duration: 0.5,
                            times: [0, 0.55, 1],
                            ease: [0.34, 1.56, 0.64, 1]
                        },
                        background: { duration: 0.3 },
                        color: { duration: 0.3 }
                    }
                };
            }

            return {
                animate: {
                    ...baseState,
                    scale: [1, 1.052, 1.014, 1.06, 1]
                },
                transition: {
                    scale: {
                        duration: 2.2,
                        times: [0, 0.24, 0.52, 0.78, 1],
                        repeat: Infinity,
                        ease: "easeInOut"
                    },
                    background: { duration: 0.3 },
                    color: { duration: 0.3 }
                }
            };
        }

        function getSendArrowAnimation() {
            if (reducedMotion) {
                return {
                    animate: { x: isSendHovered ? 3 : 0, y: isSendHovered ? -3 : 0 },
                    transition: { duration: 0.2, ease: "easeOut" }
                };
            }

            if (isSendHovered) {
                return {
                    animate: { x: 3, y: -3 },
                    transition: { duration: 0.2, ease: "easeOut" }
                };
            }

            if (!isSendEmphasized || sendMotionPhase !== "breathe") {
                return {
                    animate: { x: 0, y: 0 },
                    transition: { duration: 0.2, ease: "easeOut" }
                };
            }

            return {
                animate: {
                    x: [0, 0, 3, 0, 0],
                    y: [0, 0, -3, 0, 0]
                },
                transition: {
                    duration: 3.2,
                    times: [0, 0.28, 0.42, 0.58, 1],
                    ease: "easeOut",
                    repeat: Infinity
                }
            };
        }

        const sendButtonAnimation = getSendButtonAnimation();
        const sendArrowAnimation = getSendArrowAnimation();

        function getSceneTransition(timing) {
            return {
                delay: timing?.delay || 0,
                duration: timing?.duration || (prefersReducedMotion ? 0.08 : 0.24),
                ease: EASE
            };
        }

        function resolveSceneMotion({
            idleDelay = 0,
            idleDuration = 0.24,
            idleOffsetX = 0,
            idleOffsetY = 0,
            enterTiming = null,
            exitTiming = null
        }) {
            if (isExitingToChat && exitTiming) {
                return {
                    initial: false,
                    animate: {
                        opacity: 0,
                        x: prefersReducedMotion ? 0 : exitTiming.x || 0,
                        y: prefersReducedMotion ? 0 : exitTiming.y || 0
                    },
                    transition: getSceneTransition(exitTiming)
                };
            }

            if (isEnteringFromChat && enterTiming) {
                return {
                    initial: {
                        opacity: 0,
                        x: prefersReducedMotion ? 0 : enterTiming.x || 0,
                        y: prefersReducedMotion ? 0 : enterTiming.y || 0
                    },
                    animate: { opacity: 1, x: 0, y: 0 },
                    transition: getSceneTransition(enterTiming)
                };
            }

            return {
                initial: reducedMotion ? { opacity: 0 } : { opacity: 0, x: idleOffsetX, y: idleOffsetY },
                animate: { opacity: 1, x: 0, y: 0 },
                transition: {
                    delay: idleDelay,
                    duration: reducedMotion ? 0.01 : idleDuration,
                    ease: EASE
                }
            };
        }

        function resolveSceneOpacityMotion({
            idleDelay = 0,
            idleDuration = 0.24,
            enterTiming = null,
            exitTiming = null
        }) {
            if (isExitingToChat && exitTiming) {
                return {
                    initial: false,
                    animate: { opacity: 0 },
                    transition: getSceneTransition(exitTiming)
                };
            }

            if (isEnteringFromChat && enterTiming) {
                return {
                    initial: { opacity: 0 },
                    animate: { opacity: 1 },
                    transition: getSceneTransition(enterTiming)
                };
            }

            return {
                initial: { opacity: 0 },
                animate: { opacity: 1 },
                transition: {
                    delay: idleDelay,
                    duration: reducedMotion ? 0.01 : idleDuration,
                    ease: EASE
                }
            };
        }

        function getTechCardMotion(index) {
            return resolveSceneOpacityMotion({
                idleDelay: 0.2 + index * 0.08,
                idleDuration: 0.32,
                enterTiming: transitionConfig?.atmosphere,
                exitTiming: transitionConfig?.atmosphere
            });
        }

        const navbarMotion = resolveSceneMotion({
            idleDelay: 0.02,
            idleDuration: 0.4,
            idleOffsetY: -8,
            enterTiming: transitionConfig?.chrome,
            exitTiming: transitionConfig?.chrome
        });
        const taglineMotion = resolveSceneMotion({
            idleDelay: 0.1,
            idleDuration: 0.4,
            idleOffsetY: 8,
            enterTiming: transitionConfig?.chrome,
            exitTiming: transitionConfig?.chrome
        });
        const atmosphereMotion = resolveSceneMotion({
            idleDelay: 0.18,
            idleDuration: 0.24,
            enterTiming: transitionConfig?.atmosphere,
            exitTiming: transitionConfig?.atmosphere
        });
        const cardMotion = resolveSceneMotion({
            idleDelay: 0.08,
            idleDuration: 0.24,
            enterTiming: transitionConfig?.card,
            exitTiming: transitionConfig?.card
        });
        const footerMotion = resolveSceneMotion({
            idleDelay: 0.56,
            idleDuration: 0.28,
            idleOffsetY: 8,
            enterTiming: transitionConfig?.footer,
            exitTiming: transitionConfig?.footer
        });

        const isInteractionLocked = disabled || isSceneTransitioning;
        const shouldRenderDemoComposer = !isPanelOpen;
        const isAuthOverlayActive = isPanelOpen || isPanelBackdropActive;
        const isDemoComposerInteractive = shouldRenderDemoComposer && !isAuthOverlayActive && !isInteractionLocked;
        const shouldTypeSubtitle = isPanelOpen && !isSceneTransitioning;

        return (
            <div
                className={`auth-page ${isSceneTransitioning ? "is-transitioning" : ""}`.trim()}
            >
                <motion.header
                    className="auth-navbar"
                    initial={navbarMotion.initial}
                    animate={navbarMotion.animate}
                    transition={navbarMotion.transition}
                >
                    <button
                        type="button"
                        className="auth-navbar-brand focus-ring"
                        onClick={onNavigateHome}
                        disabled={isInteractionLocked}
                        aria-label="回到首页"
                    >
                        Signal
                    </button>

                    <div className="auth-navbar-actions">
                        <div className="auth-navbar-version">
                            <VersionPopover label="v3.0" />
                        </div>

                        <a
                            className="icon-button auth-github-link focus-ring"
                            href="https://github.com/zhiyuzhang325-a11y/WebServer"
                            target="_blank"
                            rel="noopener"
                            aria-label="查看 GitHub 仓库"
                        >
                            <GithubIcon />
                        </a>

                        <ThemeToggle
                            mode={themeMode}
                            resolvedMode={resolvedTheme}
                            onCycle={() => window.ThemeManager?.cycle?.()}
                        />

                        <button
                            type="button"
                            className="link-button auth-navbar-switch focus-ring"
                            onClick={() => onOpenMode("login")}
                            disabled={isInteractionLocked}
                        >
                            登入
                        </button>
                    </div>
                </motion.header>

                <main className="auth-hero">
                    <div className="auth-center-column">
                        <motion.section
                            className="auth-tagline"
                            initial={taglineMotion.initial}
                            animate={taglineMotion.animate}
                            transition={taglineMotion.transition}
                        >
                            <div className="auth-tagline-copy">
                                <div className="auth-tagline-title">从零手写的 C++ WebSocket 聊天室</div>
                                <div className="auth-tagline-meta">Multi-Reactor · 实时广播 · 零依赖</div>
                            </div>
                        </motion.section>

                        <div className="auth-topology-stage">
                            <motion.div
                                className="auth-arch-layer"
                                initial={atmosphereMotion.initial}
                                animate={atmosphereMotion.animate}
                                transition={atmosphereMotion.transition}
                            >
                                <ArchitectureConnections
                                    reducedMotion={prefersReducedMotion}
                                    enabled={!isSceneTransitioning}
                                />
                            </motion.div>

                            {TECH_CARDS.map((card, index) => (
                                <TechCard
                                    key={card.key}
                                    card={card}
                                    reducedMotion={prefersReducedMotion}
                                    revealMotion={getTechCardMotion(index)}
                                />
                            ))}

                            <motion.section
                                className="auth-chat-card-shell"
                                initial={cardMotion.initial}
                                animate={cardMotion.animate}
                                transition={cardMotion.transition}
                            >
                                <div className={`auth-chat-card ${isAuthOverlayActive ? "is-panel-open" : ""}`}>
                                    <div className="auth-chat-card-bar">
                                        <div className="auth-chat-card-dots">
                                            <span className="auth-chat-card-dot is-red" />
                                            <span className="auth-chat-card-dot is-yellow" />
                                            <span className="auth-chat-card-dot is-green" />
                                        </div>
                                    </div>

                                    <div
                                        className="auth-chat-background"
                                        aria-hidden={isAuthOverlayActive}
                                    >
                                        <div className="auth-chat-messages-shell">
                                            <MessageList
                                                messages={demoState.messages}
                                                onScrolled={() => {}}
                                                hiddenMessageId={null}
                                                suspendSmoothScroll={false}
                                                shouldAnimateEntry={false}
                                                isFading={demoState.isFading}
                                                fadeDuration={reducedMotion ? 1 : 140}
                                                itemAnimationMode="calm"
                                                className="auth-chat-messages"
                                                innerClassName="auth-chat-messages-inner"
                                                viewportRef={viewportRef}
                                                renderEmpty={() => <div className="auth-chat-empty" />}
                                            />
                                        </div>

                                        <AnimatePresence initial={false}>
                                            {shouldRenderDemoComposer ? (
                                                <motion.div
                                                    key="composer-block"
                                                    className="auth-chat-card-footer"
                                                    initial={false}
                                                    animate={{ opacity: 1, y: 0 }}
                                                    exit={{ opacity: 0, y: prefersReducedMotion ? 0 : 4 }}
                                                    transition={{
                                                        duration: prefersReducedMotion ? 0.01 : 0.18,
                                                        ease: EASE
                                                    }}
                                                >
                                                    <div className="auth-demo-composer">
                                                        <div className="auth-demo-composer-field">
                                                            <textarea
                                                                id="auth-demo-message"
                                                                name="demoMessage"
                                                                className="auth-demo-composer-input"
                                                                value={autoTyping.inputValue}
                                                                onInput={autoTyping.handleInput}
                                                                onKeyDown={handleComposerKeyDown}
                                                                placeholder="输入一条消息..."
                                                                aria-label="访客消息输入框"
                                                                rows={1}
                                                                disabled={!isDemoComposerInteractive}
                                                            />

                                                            <motion.div
                                                                className="auth-demo-send-wrap"
                                                                animate={{
                                                                    width: isSendEmphasized ? 40 : 32,
                                                                    height: isSendEmphasized ? 40 : 32
                                                                }}
                                                                transition={{
                                                                    width: { duration: reducedMotion ? 0.01 : 0.3, ease: EASE },
                                                                    height: { duration: reducedMotion ? 0.01 : 0.3, ease: EASE }
                                                                }}
                                                            >
                                                                <motion.button
                                                                    type="button"
                                                                    className={`send-button auth-demo-send focus-ring ${
                                                                        isSendEmphasized ? "is-active is-emphasized" : ""
                                                                    } ${trimmedComposerValue && isSendHovered ? "is-hovered" : ""}`}
                                                                    onClick={handleSend}
                                                                    onMouseEnter={() => setSendHovered(true)}
                                                                    onMouseLeave={() => setSendHovered(false)}
                                                                    disabled={!trimmedComposerValue || !isDemoComposerInteractive}
                                                                    whileTap={{ scale: 0.97 }}
                                                                    animate={sendButtonAnimation.animate}
                                                                    transition={{
                                                                        ...sendButtonAnimation.transition,
                                                                        ...TAP_TRANSITION
                                                                    }}
                                                                    aria-label="发送演示消息"
                                                                >
                                                                    <motion.div
                                                                        className="auth-demo-send-icon"
                                                                        animate={sendArrowAnimation.animate}
                                                                        transition={sendArrowAnimation.transition}
                                                                    >
                                                                        <ArrowSendIcon />
                                                                    </motion.div>
                                                                </motion.button>
                                                            </motion.div>
                                                        </div>
                                                    </div>

                                                    <div className="auth-demo-guide">
                                                        <span>你还没有身份 · </span>
                                                        <button
                                                            type="button"
                                                            className="auth-demo-guide-link focus-ring"
                                                            onClick={() => onOpenMode("login")}
                                                            disabled={!isDemoComposerInteractive}
                                                        >
                                                            登录
                                                        </button>
                                                        <span> / </span>
                                                        <button
                                                            type="button"
                                                            className="auth-demo-guide-link focus-ring"
                                                            onClick={() => onOpenMode("register")}
                                                            disabled={!isDemoComposerInteractive}
                                                        >
                                                            注册
                                                        </button>
                                                    </div>
                                                </motion.div>
                                            ) : null}
                                        </AnimatePresence>
                                    </div>

                                    <AnimatePresence
                                        initial={false}
                                        onExitComplete={() => {
                                            if (!isPanelOpen) {
                                                setPanelBackdropActive(false);
                                            }
                                        }}
                                    >
                                        {isPanelOpen ? (
                                            <AuthFloatingPanel
                                                key="auth-floating-panel"
                                                mode={mode}
                                                reducedMotion={reducedMotion}
                                                shouldTypeSubtitle={shouldTypeSubtitle}
                                                disabled={isInteractionLocked}
                                                quietEntry={isEnteringFromChat}
                                                onClose={onClosePanel}
                                                onSwitchMode={onOpenMode}
                                                onSuccess={handleAuthSuccess}
                                            />
                                        ) : null}
                                    </AnimatePresence>
                                </div>
                            </motion.section>
                        </div>
                    </div>
                </main>

                <motion.footer
                    className="auth-footer"
                    initial={footerMotion.initial}
                    animate={footerMotion.animate}
                    transition={footerMotion.transition}
                >
                    <span>made by </span>
                    <button type="button" className="auth-footer-link focus-ring">
                        lyc
                    </button>
                    <span> · WebServer </span>
                    <VersionPopover label="v3.0" className="auth-footer-version" placement="top" />
                    <span> · 2026</span>
                </motion.footer>
            </div>
        );
    }

    window.InlineError = InlineError;
    window.LoadingDots = LoadingDots;
    window.LoadingStage = LoadingStage;
    window.AuthShell = AuthShell;
})();
