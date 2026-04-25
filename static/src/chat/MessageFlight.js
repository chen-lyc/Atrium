// Renders the ritual launch animation from composer to message list.
(() => {
    const { motion, AnimatePresence } = window;
    const { EASE } = window.AppConstants;

    function MessageFlight({ flight, onComplete }) {
        if (!flight) {
            return <AnimatePresence initial={false} />;
        }

        const { id, text, startRect, targetRect, transition } = flight;
        const activeWidth = targetRect ? targetRect.width : startRect.width;
        const flightTransition = transition || { duration: 0.34, ease: EASE };

        return (
            <AnimatePresence initial={false}>
                <motion.div
                    key={id}
                    className="message-flight"
                    style={{
                        left: startRect.left,
                        top: startRect.top,
                        width: activeWidth
                    }}
                    initial={{
                        x: 0,
                        y: 0,
                        opacity: 0.96
                    }}
                    animate={
                        targetRect
                            ? {
                                x: targetRect.left - startRect.left,
                                y: targetRect.top - startRect.top,
                                opacity: 1
                            }
                            : {
                                x: 0,
                                y: 0,
                                opacity: 0.96
                            }
                    }
                    exit={{ opacity: 0, transition: { duration: 0.08, ease: EASE } }}
                    transition={targetRect ? flightTransition : { duration: 0.06, ease: EASE }}
                    onAnimationComplete={() => {
                        if (targetRect) {
                            onComplete(id);
                        }
                    }}
                >
                    <p className="message-text">{text}</p>
                </motion.div>
            </AnimatePresence>
        );
    }

    window.MessageFlight = MessageFlight;
})();
