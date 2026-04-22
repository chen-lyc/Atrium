// Renders tech cards with delayed hover details and static architecture diagrams.
(() => {
    const { useEffect, useRef, useState } = window.React;
    const { motion, AnimatePresence } = window;
    const TagMicroAnimation = window.TagMicroAnimation;

    const HOVER_OPEN_DELAY = 520;
    const REPO_URL = "https://github.com/zhiyuzhang325-a11y/WebServer";
    const POPOVER_EASE = [0.2, 0.82, 0.24, 1];
    const DETAIL_PLACEMENTS = {
        "multi-reactor": "top-left",
        "ws-broadcast": "top-right",
        "session-auth": "bottom-left",
        "zero-copy": "bottom-right"
    };
    const DETAIL_CONTENT = {
        "multi-reactor": {
            title: "主从 Reactor 架构",
            points: [
                "主 Reactor 负责 accept",
                "N 个从 Reactor 各持 epoll",
                "一连接一从, ET 边缘触发"
            ]
        },
        "ws-broadcast": {
            title: "跨 Reactor 消息广播",
            points: [
                "eventfd 唤醒目标 Reactor",
                "checkComplete + parseFrame",
                "shared_ptr 共享只读广播帧"
            ]
        },
        "session-auth": {
            title: "Redis + Cookie 会话鉴权",
            points: [
                "32 字符十六进制 session_id",
                "Redis TTL 24h",
                "密码 hash + salt 存储"
            ]
        },
        "zero-copy": {
            title: "sendfile 零拷贝传输",
            points: [
                "静态文件内核态直传",
                "避免用户态/内核态多次拷贝",
                "QPS 实测提升约 23%"
            ]
        }
    };
    const DIAGRAM_VIEWBOX = "0 0 220 112";

    function classNames(...parts) {
        return parts.filter(Boolean).join(" ");
    }

    function clearTimer(timerRef) {
        if (timerRef.current) {
            window.clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }

    function getPlacement(type) {
        return DETAIL_PLACEMENTS[type] || "top-right";
    }

    function getMotionOffset(placement, reducedMotion) {
        if (reducedMotion) {
            return { x: 0, y: 0 };
        }

        if (placement === "top-left") {
            return { x: 8, y: 5 };
        }

        if (placement === "top-right") {
            return { x: -8, y: 5 };
        }

        if (placement === "bottom-left") {
            return { x: 8, y: -5 };
        }

        return { x: -8, y: -5 };
    }

    function DiagramFrame({ children }) {
        return (
            <svg
                className="tech-detail-diagram"
                viewBox={DIAGRAM_VIEWBOX}
                fill="none"
                aria-hidden="true"
                focusable="false"
            >
                {children}
            </svg>
        );
    }

    function DiagramLine({ x1, y1, x2, y2, accent = false, dashed = false }) {
        return (
            <line
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                className={classNames("tech-detail-diagram__stroke", accent && "is-accent", dashed && "is-dashed")}
            />
        );
    }

    function DiagramArrow({ x1, y1, x2, y2, accent = false, dashed = false }) {
        const angle = Math.atan2(y2 - y1, x2 - x1);
        const headLength = 5;
        const headSpread = Math.PI / 7;
        const headX1 = x2 - headLength * Math.cos(angle - headSpread);
        const headY1 = y2 - headLength * Math.sin(angle - headSpread);
        const headX2 = x2 - headLength * Math.cos(angle + headSpread);
        const headY2 = y2 - headLength * Math.sin(angle + headSpread);

        return (
            <>
                <DiagramLine x1={x1} y1={y1} x2={x2} y2={y2} accent={accent} dashed={dashed} />
                <path
                    d={`M ${headX1} ${headY1} L ${x2} ${y2} L ${headX2} ${headY2}`}
                    className={classNames("tech-detail-diagram__stroke", accent && "is-accent", dashed && "is-dashed")}
                />
            </>
        );
    }

    function MultiReactorDiagram() {
        const center = { x: 110, y: 46 };
        const nodes = [
            { x: 110, y: 20 },
            { x: 148, y: 46 },
            { x: 110, y: 72 },
            { x: 72, y: 46 }
        ];

        return (
            <DiagramFrame>
                {nodes.map((node, index) => (
                    <DiagramLine key={`link-${index}`} x1={center.x} y1={center.y} x2={node.x} y2={node.y} />
                ))}

                <circle cx={center.x} cy={center.y} r="9" className="tech-detail-diagram__stroke is-accent" />
                <circle cx={center.x} cy={center.y} r="2.4" className="tech-detail-diagram__dot is-accent" />

                {nodes.map((node, index) => (
                    <g key={`node-${index}`}>
                        <circle cx={node.x} cy={node.y} r="6.2" className="tech-detail-diagram__stroke" />
                        <circle cx={node.x} cy={node.y} r="1.5" className="tech-detail-diagram__dot" />
                        <circle cx={node.x - 6} cy={node.y + 12} r="1.2" className="tech-detail-diagram__dot" />
                        <circle cx={node.x} cy={node.y + 12} r="1.2" className="tech-detail-diagram__dot" />
                        <circle cx={node.x + 6} cy={node.y + 12} r="1.2" className="tech-detail-diagram__dot" />
                    </g>
                ))}
            </DiagramFrame>
        );
    }

    function WSBroadcastDiagram() {
        return (
            <DiagramFrame>
                <rect x="28" y="36" width="20" height="14" rx="4.5" className="tech-detail-diagram__shape is-accent" />
                <rect x="164" y="20" width="22" height="13" rx="4.5" className="tech-detail-diagram__shape" />
                <rect x="152" y="48" width="24" height="13" rx="4.5" className="tech-detail-diagram__shape" />
                <rect x="170" y="76" width="22" height="13" rx="4.5" className="tech-detail-diagram__shape" />

                <circle cx="102" cy="50" r="2.8" className="tech-detail-diagram__dot is-accent" />

                <DiagramArrow x1={48} y1={43} x2={94} y2={50} accent={true} />
                <DiagramArrow x1={108} y1={50} x2={164} y2={26} accent={true} />
                <DiagramArrow x1={108} y1={50} x2={152} y2={54} accent={true} />
                <DiagramArrow x1={108} y1={50} x2={170} y2={82} accent={true} />
            </DiagramFrame>
        );
    }

    function SessionAuthDiagram() {
        return (
            <DiagramFrame>
                <text x="28" y="23" className="tech-detail-diagram__label">Cookie</text>
                <text x="92" y="23" className="tech-detail-diagram__label">Redis</text>
                <text x="162" y="23" className="tech-detail-diagram__label">MySQL</text>

                <rect x="26" y="37" width="24" height="24" rx="6" className="tech-detail-diagram__shape" />
                <rect x="84" y="34" width="50" height="30" rx="8" className="tech-detail-diagram__shape" />
                <path d="M162 37C162 33.9 170.1 31.4 180 31.4C189.9 31.4 198 33.9 198 37V61C198 64.1 189.9 66.6 180 66.6C170.1 66.6 162 64.1 162 61V37Z" className="tech-detail-diagram__shape" />
                <path d="M162 37C162 40.1 170.1 42.6 180 42.6C189.9 42.6 198 40.1 198 37" className="tech-detail-diagram__shape" />
                <path d="M162 61C162 57.9 170.1 55.4 180 55.4C189.9 55.4 198 57.9 198 61" className="tech-detail-diagram__shape" />

                <rect x="36" y="45" width="8" height="8" rx="2" className="tech-detail-diagram__fill" />
                <rect x="96" y="42" width="26" height="3.6" rx="1.8" className="tech-detail-diagram__fill" />
                <rect x="96" y="48.6" width="26" height="3.6" rx="1.8" className="tech-detail-diagram__fill" />
                <rect x="96" y="55.2" width="22" height="3.6" rx="1.8" className="tech-detail-diagram__fill" />

                <DiagramArrow x1={50} y1={49} x2={84} y2={49} accent={true} />
                <DiagramArrow x1={134} y1={49} x2={162} y2={49} dashed={true} />
            </DiagramFrame>
        );
    }

    function ZeroCopyDiagram() {
        return (
            <DiagramFrame>
                <text x="16" y="24" className="tech-detail-diagram__label">传统</text>
                <text x="16" y="82" className="tech-detail-diagram__label is-accent">sendfile</text>

                <rect x="74" y="18" width="16" height="12" rx="4" className="tech-detail-diagram__shape" />
                <rect x="106" y="44" width="16" height="12" rx="4" className="tech-detail-diagram__shape" />
                <rect x="138" y="18" width="16" height="12" rx="4" className="tech-detail-diagram__shape" />
                <rect x="170" y="44" width="16" height="12" rx="4" className="tech-detail-diagram__shape" />

                <DiagramArrow x1={90} y1={24} x2={106} y2={50} />
                <DiagramArrow x1={122} y1={50} x2={138} y2={24} />
                <DiagramArrow x1={154} y1={24} x2={170} y2={50} />

                <rect x="82" y="72" width="20" height="14" rx="5" className="tech-detail-diagram__shape is-accent" />
                <rect x="146" y="72" width="20" height="14" rx="5" className="tech-detail-diagram__shape is-accent" />
                <DiagramArrow x1={102} y1={79} x2={146} y2={79} accent={true} />
            </DiagramFrame>
        );
    }

    function TechDetailDiagram({ type }) {
        if (type === "multi-reactor") {
            return <MultiReactorDiagram />;
        }

        if (type === "ws-broadcast") {
            return <WSBroadcastDiagram />;
        }

        if (type === "session-auth") {
            return <SessionAuthDiagram />;
        }

        return <ZeroCopyDiagram />;
    }

    function TechCardPopover({ card, revealMotion, reducedMotion = false }) {
        const placement = getPlacement(card.type);
        const detail = DETAIL_CONTENT[card.type] || DETAIL_CONTENT["multi-reactor"];
        const openTimerRef = useRef(null);
        const [isOpen, setIsOpen] = useState(false);
        const tooltipId = `tech-detail-${card.tagId || card.key || card.type}`;
        const motionOffset = getMotionOffset(placement, reducedMotion);

        function queueOpen() {
            clearTimer(openTimerRef);
            openTimerRef.current = window.setTimeout(() => {
                openTimerRef.current = null;
                setIsOpen(true);
            }, HOVER_OPEN_DELAY);
        }

        function openNow() {
            clearTimer(openTimerRef);
            setIsOpen(true);
        }

        function closeNow() {
            clearTimer(openTimerRef);
            setIsOpen(false);
        }

        function handleBlur(event) {
            if (event.currentTarget.contains(event.relatedTarget)) {
                return;
            }

            closeNow();
        }

        useEffect(() => {
            return () => {
                clearTimer(openTimerRef);
            };
        }, []);

        return (
            <motion.div
                className={classNames("tech-card", card.className, isOpen && "is-detail-open")}
                data-tag-id={card.tagId}
                {...revealMotion}
                onMouseEnter={queueOpen}
                onMouseLeave={closeNow}
                onFocusCapture={openNow}
                onBlurCapture={handleBlur}
            >
                <div className="tech-card-popover-unit">
                    <a
                        href={REPO_URL}
                        target="_blank"
                        rel="noopener"
                        className="tech-card-link focus-ring"
                        aria-describedby={isOpen ? tooltipId : undefined}
                    >
                        <div className="tech-card-surface">
                            <div className="tech-card-icon">
                                <TagMicroAnimation type={card.type} tagId={card.tagId} reducedMotion={reducedMotion} />
                            </div>
                            <div className="tech-card-title">{card.title}</div>
                            <div className="tech-card-subtitle">{card.subtitle}</div>
                        </div>
                    </a>

                    <AnimatePresence initial={false}>
                        {isOpen ? (
                            <>
                                <div className={classNames("tech-detail-bridge", `is-${placement}`)} aria-hidden="true" />

                                <motion.div
                                    id={tooltipId}
                                    role="tooltip"
                                    className={classNames("tech-detail-popover", `is-${placement}`)}
                                    style={{
                                        transformOrigin:
                                            placement === "top-left"
                                                ? "100% 78%"
                                                : placement === "top-right"
                                                  ? "0% 78%"
                                                  : placement === "bottom-left"
                                                    ? "100% 24%"
                                                    : "0% 24%"
                                    }}
                                    initial={{
                                        opacity: 0,
                                        x: motionOffset.x,
                                        y: motionOffset.y
                                    }}
                                    animate={{
                                        opacity: 1,
                                        x: 0,
                                        y: 0,
                                        transition: {
                                            duration: reducedMotion ? 0.12 : 0.2,
                                            ease: POPOVER_EASE
                                        }
                                    }}
                                    exit={{
                                        opacity: 0,
                                        x: motionOffset.x,
                                        y: motionOffset.y,
                                        transition: {
                                            duration: reducedMotion ? 0.1 : 0.15,
                                            ease: POPOVER_EASE
                                        }
                                    }}
                                >
                                    <span className={classNames("tech-detail-arrow", `is-${placement}`)} aria-hidden="true" />

                                    <div className="tech-detail-figure">
                                        <TechDetailDiagram type={card.type} />
                                    </div>

                                    <div className="tech-detail-title">{detail.title}</div>

                                    <ul className="tech-detail-points">
                                        {detail.points.map((point) => (
                                            <li key={point}>{point}</li>
                                        ))}
                                    </ul>
                                </motion.div>
                            </>
                        ) : null}
                    </AnimatePresence>
                </div>
            </motion.div>
        );
    }

    window.TechCardPopover = TechCardPopover;
})();
