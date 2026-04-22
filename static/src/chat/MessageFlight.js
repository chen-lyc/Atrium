// Renders the ritual launch animation from composer to message list.
(() => {
    const { motion, AnimatePresence } = window;
    const { EASE } = window.AppConstants;

    function MessageFlight({ flight, onComplete }) {
        if (!flight) {
            return null;
        }

        const { id, text, startRect, targetRect, spring } = flight;

        return (
            <AnimatePresence initial={false}>
                <motion.div
                    key={id}
                    className="message-flight"
                    style={{
                        left: startRect.left,
                        top: startRect.top,
                        width: startRect.width
                    }}
                    initial={{
                        x: 0,
                        y: 0,
                        width: startRect.width,
                        opacity: 0.96
                    }}
                    animate={
                        targetRect
                            ? {
                                x: targetRect.left - startRect.left,
                                y: targetRect.top - startRect.top,
                                width: targetRect.width,
                                opacity: 1
                            }
                            : {
                                x: 0,
                                y: 0,
                                width: startRect.width,
                                opacity: 0.96
                            }
                    }
                    exit={{ opacity: 0 }}
                    transition={targetRect ? spring : { duration: 0.08, ease: EASE }}
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
