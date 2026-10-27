# Release checklist

Public source and public binaries are separate release steps. Do not publish a
download asset just because a local package command succeeds.

1. Run `npm ci` and `npm test` on Windows x64, macOS and Linux x64.
2. Review the source diff and export for private data and proprietary material.
3. Verify third-party license notices and provide corresponding source and build
   material for the actual bundled GPL binaries (including their linked components).
   The FFmpeg commit alone is not a complete source bundle for its external libraries.
   Mirror required source archives alongside binary release assets. Record hashes.
   Review the yt-dlp executable's bundled components too if it is included.
4. `npm run dist` builds an unsigned per-user NSIS installer. `npm run dist:linux`
   builds an unsigned AppImage and Debian package. Test each on a clean machine for
   its platform without Node.js: install or launch, extension setup, native
   handoff, download with audio, completion, update, and uninstall.
   Run `npm run fetch:yt-dlp -- win32` (or `darwin`) first so the pinned,
   checksum-verified yt-dlp is bundled.
   On a Mac, `npm run dist:mac` builds ad-hoc signed, not notarized Apple Silicon
   and Intel DMGs. ffmpeg-static only installs the build machine's FFmpeg, so
   `scripts/after-pack.cjs` swaps in the other architecture's binary from the same
   pinned release. Test each DMG on a Mac of its architecture, including the
   first-launch **Open Anyway** step and the move to Applications.
   `npm run dist:mac:signed` builds Developer ID signed, hardened-runtime DMGs
   and notarizes them. It needs an Apple Developer Program membership and these
   environment variables (never commit their values):
   - `CSC_LINK` (the Developer ID Application certificate as a base64 `.p12` or a
     file path) and `CSC_KEY_PASSWORD`
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization
   The release workflow reads them from the repository secrets
   `MAC_CERTIFICATE_P12_BASE64`, `MAC_CERTIFICATE_PASSWORD`, `APPLE_ID`,
   `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID`, and builds ad-hoc signed
   DMGs when they are not set.
5. Publish a **prerelease** until the clean-machine checks and known limitations
   are documented. Attach installer, checksums, notices, and required source assets.
6. Never attach research, browser profiles, diagnostics with media URLs, or user data.
7. Enable repository Issues and private vulnerability reporting. Review incoming
   pull requests; contributors do not need write/admin access to submit them.

Current gates: GitHub authentication, dependency source-distribution audit,
clean-machine installer QA, and first release publication. Windows code signing and
browser store publication are not configured, and macOS signing needs the secrets
above. Do not advertise them as available.
