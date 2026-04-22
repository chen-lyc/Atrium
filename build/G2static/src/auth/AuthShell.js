// Defines the unified auth page with interactive demo chat and inline auth panel.
(() => {
    const { useEffect, useRef, useState } = window.React;
    const { motion, AnimatePresence } = window;
    const { EASE, FIRST_SEND_SPRING, TAP_TRANSITION } = window.AppConstants;
    const TagMicroAnimation = window.TagMicroAnimation;
    const useTagActivation = window.useTagActivation;
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
            tagId: "tag-multi-reactor",
            selfActivate: true
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
            minDelay: 15000,
            delayRange: 7000,
            duration: 2600,
            targetTagId: "tag-session-auth"
        },
        {
            id: "path-broadcast",
            d: "M -352 -166 C -262 -175 -204 -332 -12 -332 C 196 -332 286 -200 386 -126",
            minDelay: 3200,
            delayRange: 2200,
            duration: 2400,
            targetTagId: "tag-ws-broadcast"
        },
        {
            id: "path-zerocopy",
            d: "M -358.38 -115.41 C -318.00 -86.00 -228.00 288.00 38.00 336.00 C 232.00 340.00 336.00 305.00 384.00 230.00",
            minDelay: 11000,
            delayRange: 5000,
            duration: 3200,
            targetTagId: "tag-zero-copy"
        }
    ];
    const PULSE_TRAIL_STEPS = [0, 0.014, 0.028, 0.042];

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
                <span className="loading-dot" style={{ animationDelay: "0s" }} />
                <span className="loading-dot" style={{ animationDelay: "0.15s" }} />
                <span className="loading-dot" style={{ animationDelay: "0.3s" }} />
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

    function ArchitectureConnections({ reducedMotion }) {
        const pathRefs = useRef({});
        const timeoutRefs = useRef([]);
        const animationFrameRef = useRef(null);
        const [pulses, setPulses] = useState([]);

        useEffect(() => {
            timeoutRefs.current.forEach((timerId) => {
                window.clearTimeout(timerId);
            });
            timeoutRefs.current = [];

            if (animationFrameRef.current) {
                window.cancelAnimationFrame(animationFrameRef.current);
                animationFrameRef.current = null;
            }

            if (reducedMotion) {
                setPulses([]);
                return undefined;
            }

            let isDisposed = false;

            function queueTimeout(callback, delay) {
                const timerId = window.setTimeout(() => {
                    timeoutRefs.current = timeoutRefs.current.filter((activeId) => activeId !== timerId);
                    callback();
                }, delay);

                timeoutRefs.current.push(timerId);
            }

            function spawnPulse(pathConfig) {
                setPulses((prev) => [
                    ...prev,
                    {
                        id: `${pathConfig.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
                        pathId: pathConfig.id,
                        targetTagId: pathConfig.targetTagId,
                        progress: 0,
                        startTime: window.performance.now(),
                        duration: pathConfig.duration,
                        didDispatchArrival: false
                    }
                ]);
            }

            function schedulePulse(pathConfig) {
                const delay = pathConfig.minDelay + Math.random() * pathConfig.delayRange;

                queueTimeout(() => {
                    if (isDisposed) {
                        return;
                    }

                    spawnPulse(pathConfig);
                    schedulePulse(pathConfig);
                }, delay);
            }

            ARCH_PATHS.forEach((pathConfig) => {
                schedulePulse(pathConfig);
            });

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
                                window.dispatchEvent(
                                    new CustomEvent("arch-pulse-arrive", {
                                        detail: { tagId: pulse.targetTagId }
                                    })
                                );
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
                timeoutRefs.current.forEach((timerId) => {
                    window.clearTimeout(timerId);
                });
                timeoutRefs.current = [];

                if (animationFrameRef.current) {
                    window.cancelAnimationFrame(animationFrameRef.current);
                    animationFrameRef.current = null;
                }
            };
        }, [reducedMotion]);

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

    function AuthInlinePanel({
        mode,
        reducedMotion,
        shouldTypeSubtitle,
        disabled,
        onClose,
        onSwitchMode,
        onSuccess
    }) {
        const LoginPage = window.LoginPage;
        const RegisterPage = window.RegisterPage;
        const subtitleText = mode === "login" ? "欢迎回来" : "创建账号";

        return (
            <motion.section
                key={`panel-${mode}`}
                className="auth-inline-panel"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: reducedMotion ? 0.01 : 0.26, ease: EASE }}
            >
                <button
                    type="button"
                    className="auth-panel-close icon-button focus-ring"
                    onClick={onClose}
                    aria-label="关闭登录面板"
                >
                    ×
                </button>

                <div className="auth-panel-header">
                    <motion.div
                        layoutId="brand-signal"
                        className="auth-panel-brand"
                        transition={FIRST_SEND_SPRING}
                    >
                        Signal
                    </motion.div>

                    <AnimatePresence mode="wait" initial={false}>
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
                    <AnimatePresence mode="wait" initial={false}>
                        {mode === "login" ? (
                            <motion.div
                                key="login-form"
                                initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
                                transition={{ duration: 0.2, ease: EASE }}
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
                                initial={{ opacity: 0, y: reducedMotion ? 0 : 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: reducedMotion ? 0 : -6 }}
                                transition={{ duration: 0.2, ease: EASE }}
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
        const { isActivating } = useTagActivation({
            tagId: card.tagId,
            reducedMotion,
            selfActivate: Boolean(card.selfActivate)
        });

        return (
            <motion.a
                href="https://github.com/zhiyuzhang325-a11y/WebServer"
                target="_blank"
                rel="noopener"
                className={`tech-card ${card.className}`}
                data-tag-id={card.tagId}
                {...revealMotion}
            >
                <div className={`tech-card-surface ${isActivating ? "is-activating" : ""}`.trim()}>
                    <div className="tech-card-icon">
                        <TagMicroAnimation type={card.type} isActivating={isActivating} />
                    </div>
                    <div className="tech-card-title">{card.title}</div>
                    <div className="tech-card-subtitle">{card.subtitle}</div>
                </div>
            </motion.a>
        );
    }

    function AuthShell({ mode, isPanelOpen, onOpenMode, onClosePanel, onNavigateHome, onSuccess, disabled }) {
        const MessageList = window.MessageList;
        const useDemoMessages = window.useDemoMessages;
        const useAutoTyping = window.useAutoTyping;
        const reducedMotion = useReducedMotion();
        const responseTimersRef = useRef([]);
        const panelSubtitlePlayedRef = useRef({ login: false, register: false });
        const typeATriggerRef = useRef(() => {});
        const lastChitchatIndexRef = useRef(-1);
        const viewportRef = useRef(null);
        const exitTimerRef = useRef(null);
        const sendMotionTimerRef = useRef(null);

        const [themeMode, setThemeMode] = useState(window.ThemeManager?.getMode?.() || "system");
        const [resolvedTheme, setResolvedTheme] = useState(window.ThemeManager?.getResolvedMode?.() || "light");
        const [isPageExiting, setPageExiting] = useState(false);
        const [isDemoPlaybackReady, setDemoPlaybackReady] = useState(false);
        const [sendMotionPhase, setSendMotionPhase] = useState("idle");
        const [isSendHovered, setSendHovered] = useState(false);
        const prefersReducedMotion =
            reducedMotion || window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches || false;

        const demoState = useDemoMessages({
            enabled: isDemoPlaybackReady,
            fadeDuration: reducedMotion ? 1 : 300,
            onTypeATrigger: () => typeATriggerRef.current?.(),
            reducedMotion
        });

        const autoTyping = useAutoTyping({
            currentScript: demoState.activeScript,
            enabled: isDemoPlaybackReady && !isPageExiting
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
                panelSubtitlePlayedRef.current[mode] = true;
            }
        }, [isPanelOpen, mode]);

        useEffect(() => {
            return () => {
                responseTimersRef.current.forEach((timerId) => {
                    window.clearTimeout(timerId);
                });
                responseTimersRef.current = [];
                window.clearTimeout(exitTimerRef.current);
                window.clearTimeout(sendMotionTimerRef.current);
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
                    followupDelay += reducedMotion ? 0 : 1000 + Math.round(Math.random() * 500);
                    entries.push({
                        ...message,
                        source: "demo",
                        delay: followupDelay
                    });
                });

                return {
                    entries,
                    pauseScriptMs: 4000,
                    recoverDelayMs: 4000
                };
            }

            const chitchatReply = pickChitchatReply();
            if (!chitchatReply) {
                return {
                    entries: [],
                    pauseScriptMs: 2000,
                    recoverDelayMs: 2000
                };
            }

            return {
                entries: [
                    {
                        ...chitchatReply,
                        source: "demo",
                        delay: 0
                    }
                ],
                pauseScriptMs: 2000,
                recoverDelayMs: 2000
            };
        }

        function handleSend() {
            const trimmedValue = autoTyping.inputValue.trim();
            if (!trimmedValue || isPageExiting) {
                return;
            }

            demoState.appendMessage({
                nickname: "访客",
                text: trimmedValue,
                isSelf: true,
                source: "visitor"
            });

            const replyPlan = buildReplyPlan(trimmedValue);

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

        function handleAuthSuccess(username) {
            if (isPageExiting) {
                return;
            }

            setPageExiting(true);
            window.clearTimeout(exitTimerRef.current);
            exitTimerRef.current = window.setTimeout(() => {
                onSuccess(username);
            }, reducedMotion ? 16 : 280);
        }

        const nextMode = mode === "register" ? "login" : "register";
        const trimmedComposerValue = autoTyping.inputValue.trim();
        const isSendEmphasized =
            Boolean(trimmedComposerValue) &&
            autoTyping.sendState !== "typing" &&
            autoTyping.sendState !== "deleting";
        const shouldTypeSubtitle = isPanelOpen && !panelSubtitlePlayedRef.current[mode];
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

        function getRevealMotion(delay, offsetY) {
            return {
                initial: reducedMotion ? { opacity: 0 } : { opacity: 0, y: offsetY },
                animate: isPageExiting
                    ? reducedMotion
                        ? { opacity: 0 }
                        : { opacity: 0, y: -8 }
                    : { opacity: 1, y: 0 },
                transition: isPageExiting
                    ? { duration: reducedMotion ? 0.01 : 0.18, ease: EASE }
                    : { delay, duration: reducedMotion ? 0.01 : 0.4, ease: EASE }
            };
        }

        function getCardRevealMotion(delay) {
            return {
                initial: { opacity: 0 },
                animate: isPageExiting ? { opacity: 0 } : { opacity: 1 },
                transition: isPageExiting
                    ? { duration: reducedMotion ? 0.01 : 0.18, ease: EASE }
                    : { delay, duration: reducedMotion ? 0.01 : 0.32, ease: EASE }
            };
        }

        return (
            <div className={`auth-page ${isPageExiting ? "is-exiting" : ""}`}>
                <motion.header className="auth-navbar" {...getRevealMotion(0.02, -8)}>
                    <button
                        type="button"
                        className="auth-navbar-brand focus-ring"
                        onClick={onNavigateHome}
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
                            onClick={() => onOpenMode(nextMode)}
                        >
                            {nextMode === "login" ? "登录" : "注册"}
                        </button>
                    </div>
                </motion.header>

                <main className="auth-hero">
                    <div className="auth-center-column">
                        <motion.section className="auth-tagline" {...getRevealMotion(0.1, 8)}>
                            <div className="auth-tagline-title">从零手写的 C++ WebSocket 聊天室</div>
                            <div className="auth-tagline-meta">Multi-Reactor · 实时广播 · 零依赖</div>
                        </motion.section>

                        <div className="auth-topology-stage">
                            <ArchitectureConnections reducedMotion={prefersReducedMotion} />

                            {TECH_CARDS.map((card, index) => (
                                <TechCard
                                    key={card.key}
                                    card={card}
                                    reducedMotion={prefersReducedMotion}
                                    revealMotion={getCardRevealMotion(0.2 + index * 0.08)}
                                />
                            ))}

                            <motion.section
                                className="auth-chat-card-shell"
                                onAnimationComplete={() => {
                                    if (!isPageExiting) {
                                        setDemoPlaybackReady(true);
                                    }
                                }}
                                {...getRevealMotion(0.5, 16)}
                            >
                                <div className={`auth-chat-card ${isPanelOpen ? "is-panel-open" : ""}`}>
                                    <div className="auth-chat-card-bar">
                                        <div className="auth-chat-card-dots">
                                            <span className="auth-chat-card-dot is-red" />
                                            <span className="auth-chat-card-dot is-yellow" />
                                            <span className="auth-chat-card-dot is-green" />
                                        </div>
                                    </div>

                                    <div className="auth-chat-messages-shell">
                                        <MessageList
                                            messages={demoState.messages}
                                            onScrolled={() => {}}
                                            hiddenMessageId={null}
                                            suspendSmoothScroll={false}
                                            shouldAnimateEntry={false}
                                            isFading={demoState.isFading}
                                            fadeDuration={reducedMotion ? 1 : 300}
                                            itemAnimationMode="soft"
                                            className={`auth-chat-messages ${isPanelOpen ? "is-condensed" : ""}`}
                                            innerClassName="auth-chat-messages-inner"
                                            viewportRef={viewportRef}
                                            renderEmpty={() => <div className="auth-chat-empty" />}
                                        />
                                    </div>

                                    <AnimatePresence mode="wait" initial={false}>
                                        {isPanelOpen ? (
                                            <AuthInlinePanel
                                                key={`panel-${mode}`}
                                                mode={mode}
                                                reducedMotion={reducedMotion}
                                                shouldTypeSubtitle={shouldTypeSubtitle}
                                                disabled={disabled || isPageExiting}
                                                onClose={onClosePanel}
                                                onSwitchMode={onOpenMode}
                                                onSuccess={handleAuthSuccess}
                                            />
                                        ) : (
                                            <motion.div
                                                key="composer-block"
                                                className="auth-chat-card-footer"
                                                initial={{ height: 0, opacity: 0 }}
                                                animate={{ height: "auto", opacity: 1 }}
                                                exit={{ height: 0, opacity: 0 }}
                                                transition={{ duration: reducedMotion ? 0.01 : 0.2, ease: EASE }}
                                            >
                                                <div className="auth-demo-composer">
                                                    <div className="auth-demo-composer-field">
                                                        <textarea
                                                            className="auth-demo-composer-input"
                                                            value={autoTyping.inputValue}
                                                            onInput={autoTyping.handleInput}
                                                            onKeyDown={handleComposerKeyDown}
                                                            placeholder="输入一条消息..."
                                                            aria-label="访客消息输入框"
                                                            rows={1}
                                                            disabled={isPageExiting}
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
                                                                } ${isSendHovered ? "is-hovered" : ""}`}
                                                                onClick={handleSend}
                                                                onMouseEnter={() => setSendHovered(true)}
                                                                onMouseLeave={() => setSendHovered(false)}
                                                                disabled={!trimmedComposerValue || isPageExiting}
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
                                                    >
                                                        登录
                                                    </button>
                                                    <span> / </span>
                                                    <button
                                                        type="button"
                                                        className="auth-demo-guide-link focus-ring"
                                                        onClick={() => onOpenMode("register")}
                                                    >
                                                        注册
                                                    </button>
                                                </div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            </motion.section>
                        </div>
                    </div>
                </main>

                <motion.footer className="auth-footer" {...getRevealMotion(0.56, 8)}>
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
