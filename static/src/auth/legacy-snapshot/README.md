# Auth Homepage Snapshot

Snapshot taken before the `auth-entry-redesign-split` branch starts the login/homepage redesign.

Keep this copy as a rollback and comparison reference for the current usable auth experience:

- demo chat script playback
- architecture/star-ring background
- floating value cards
- interactive tags and popovers
- login/register panel behavior

Do not import these files into the live app. The active code remains in `static/src/auth/`.

This JSX snapshot preserves the old pre-split module shape, so its relative imports intentionally describe the old `static/src/auth/` root layout. Use it as a source reference or copy it back together with the matching support files from git history when a full rollback is needed.
