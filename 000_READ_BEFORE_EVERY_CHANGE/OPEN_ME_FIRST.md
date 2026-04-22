# Edit Gate

Read this file before every code change.

This note should stay general and reusable.
It may also include a brief note on the current situation, the next decision, and why that decision makes sense.
Do not keep stale task-specific conclusions from abandoned directions here.

## Pre-Edit Check

- State the current task in one sentence before editing.
- Keep the scope narrow and explicit.
- Separate root cause from symptom before changing code.
- Separate model problems from parameter problems.
- Explain important frontend decisions in plain user-facing language first. The user does not know frontend internals; translate concepts into visible effects and everyday cause/effect before naming technical terms.
- If two rounds of tuning do not work, question the model, not just the numbers.
- For line-start issues, verify whether the perceived start is really the path's `M` point or the first visible intersection after the line exits a real boundary.
- If a line emerges from a card, panel, mask, or container edge, separate the hidden segment, contact segment, release segment, and main arc before editing.
- For connector or arc problems, list invariants first: what must stay smooth, what is only a start-point perception issue, and what is part of the core composition.
- Identify all layers that can affect the result: geometry, CSS, transforms, masks, responsive scaling, rendering order.
- If an element is transformed, prefer defining anchors in local coordinates and mapping them through the transform.
- Before editing, name the layer you are changing: boundary anchor, release segment, main arc, or visibility/occlusion.
- If a visual override seems ignored, check CSS precedence before changing more values.
- If a curve joins a straight segment, verify tangent continuity at the join.
- If a line departs from a boundary or surface, define the release point on the real boundary.
- If stroke width changes, re-check any geometry derived from half-stroke offsets.
- If a design still feels wrong after local fixes, reconsider the element's compositional role.
- Do not use color or thickness tweaks to solve a layout hierarchy problem.
- Use reference images to infer intent, hierarchy, continuity, and emphasis, not just endpoints.

## While Working

- Change one focused issue at a time.
- Do not let temporary debug styling become the final visual output.
- Do not promote a suspicion to "the problem" unless it explains the user-visible failure.
- Distinguish root cause, concrete mechanism, design constraint, edge case, and unrelated noise.
- If a scheme is abandoned, stop carrying its local conclusions into later work.
- If contact, helper, mask, or state layers exist, verify that the rendered issue is actually caused by the layer you are editing.
- Do not reshape the whole main curve just to guess at a start-point problem; solve boundary, release, and visibility issues at the correct layer first.
- If a line reads as a smooth framing arc, protect its overall composition and continuity before making local fixes.
- If the reference reads as visible framing arcs around a central panel, draw those visible arcs first and map semantics second.
- If the reference reads more like compositional arcs than functional connectors, model composition first and map semantics second.
- Do not introduce a shared trunk unless the reference image clearly shows one.

## Update Rule

- Read this file before each edit.
- After each task, keep reusable lessons and, when helpful, a brief note on the current situation, the next decision, and the reason for that decision.
- Record important decisions, large frontend changes, and serious mistakes here in concise notes. Each note should say what changed, why it changed, what visible effect it should have, and what lesson to carry forward.
- Keep explanations readable for a non-frontend user: say "the card follows the real chat area" before saying "measured handoff", and say "a hidden layer overlapped" before naming DOM/CSS details.
- Remove notes that are stale, tied to an abandoned direction, or only useful for a one-off composition.

## Current Situation

- The old card-morph ritual is retired. The final direction is a stronger staggered crossfade: the auth scene exits in layers, and the real chat scene enters in layers, with no geometry handoff at all.
- The auth page still has a clear exit hierarchy: demo chat card first, architecture and tech-card layer next, navbar and tagline after that, footer last.
- The auth tech cards own their ring placement through the outer `.tech-card` transform. Treat that wrapper as a positioning layer: fade it if needed, but do not add Framer Motion `x/y` travel there or the cards collapse toward the center and read as "gone".
- Backend collaboration rule: for C++ backend problems, inspect and explain the root cause, but do not edit backend source unless the user explicitly changes that rule. The user wants to modify backend code personally.
- The real chat shell establishes the new place in pieces: Sidebar first, Header during Sidebar's middle, Composer during Header's middle, the message-list container after the shell settles, and the welcome message last.
- The local welcome message remains front-end only and stays at the top once it appears. The list itself must stay top-aligned; never center a welcome-only state.
- The WebSocket should connect as soon as login succeeds, not after the ritual finishes. The transition is presentation, not connection gating.
- The auth demo card should not slide on ordinary auth-page entry or logout return. In plain terms: the card is already placed; it can fade, but it should not feel like it is traveling before the user has acted.
- If the login panel is already open during logout return, do not let the floating panel perform its own mini ceremony. It should arrive quietly as part of the auth card.
- Logout should read as the current chat scene receding while the auth scene reforms in layers, not as a hard cut. Keep the chat shell visually alive through its short exit, and only drop the connection/session presentation after the exit finishes.
- For the real chat shell, the viewport should stay structurally fixed while only the message area scrolls. If long histories start pushing the composer, sidebar, or header around, the problem is the shell height/overflow model, not the message spacing. Burst sending should also skip any "flight" ritual that depends on one message at a time.
- New composer-anchor lesson: the logged-in send button should stay anchored inside the real composer field, matching the demo composer. Keeping it as a separate grid cell makes the icon read as offset even when the spacing math is technically correct.
- New tag-event correction: do not dispatch `arch-pulse-arrive` synchronously from inside a React state updater. Queue it after the update so TagMicroAnimation does not set state while ArchitectureConnections is rendering.
- New tech-card hover rule: the interview-detail window should behave like one combined hover zone with the tag card, not like a generic tooltip. Delay the trigger so fly-by hovers do nothing, keep an invisible bridge so moving into the panel does not break hover, and place the panel outward from the chat so the extra depth feels intentional instead of intrusive.
- New tech-card stability rule: when a hover detail opens, do not move the card's outer positioning wrapper. If the hit area shifts under the cursor, edge hovers will jitter. Keep the card body stable, do any lift on the inner surface only, and use a side-pointing triangle instead of a floating diamond so the relationship reads clearly.
- Avoid reintroducing morph or handoff ideas like measured card travel, `layoutId`, `LayoutGroup`, or brand-word flight unless the direction is explicitly changed again.

## Next Decision and Why

- Treat the ritual as two overlapping scenes, not one element traveling between places. That keeps the user's eye on scene rhythm instead of on geometry precision.
- Keep the auth-scene exits and chat-scene entries staggered. If a change makes whole groups move in lockstep, it is probably flattening the rhythm too much.
- Preserve the core invariants: login panel closes first, WebSocket connects during the ritual, welcome message appears last and stays local-only, and chat input is interactive once the ritual completes.
