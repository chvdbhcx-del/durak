# Root of chvdbhcx-del.github.io

Android only trusts invite links (`https://chvdbhcx-del.github.io/durak/#join-…`) to open the app
when the domain root serves `/.well-known/assetlinks.json`. A project site (`/durak/`) cannot serve
the domain root, so these files live in a separate repository named **chvdbhcx-del.github.io**,
published by GitHub Pages from its `main` branch.

- `.well-known/assetlinks.json`: the app id and the SHA-256 of the release signing key (same for every
  release since v1.1.4; read from the signed APKs). Change it only if the signing key changes.
- `.nojekyll`: without it GitHub Pages hides folders starting with a dot.
- `index.html`: sends anyone opening the bare domain to the game.

Check: https://chvdbhcx-del.github.io/.well-known/assetlinks.json must return this JSON, then
`adb shell pm verify-app-links --re-verify com.chvdbhcx.durak` (or reinstall) verifies the link.
