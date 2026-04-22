// Initializes framer-motion globals with browser-safe fallbacks.
(() => {
    const motionRuntime = window.Motion || {};
    const fallbackMotion = (tag) => window.React.forwardRef((props, ref) => {
        const {
            initial,
            animate,
            exit,
            transition,
            layout,
            whileTap,
            whileHover,
            children,
            ...rest
        } = props;
        return window.React.createElement(tag, { ...rest, ref }, children);
    });

    window.motion = motionRuntime.motion || {
        div: fallbackMotion("div"),
        aside: fallbackMotion("aside"),
        button: fallbackMotion("button"),
        article: fallbackMotion("article"),
        a: fallbackMotion("a"),
        header: fallbackMotion("header"),
        li: fallbackMotion("li"),
        main: fallbackMotion("main"),
        section: fallbackMotion("section"),
        span: fallbackMotion("span")
    };
    window.AnimatePresence = motionRuntime.AnimatePresence || ((props) => props.children);
    window.useReducedMotion = motionRuntime.useReducedMotion || (() => false);
})();
