# telegram-minions Library Versions

Notable library versions and the changes they introduce. Use this to gate UI features or show version requirement messages.

## v1.120.0 (2026-04-23)

**Enriched error events**
- Error events now include `phase`, `detail`, `exitCode`, and `subtype` fields
- Telegram formatter shows phase badge, bold headline, exit/subtype metadata line
- Detail text truncated at 1200 chars in `<pre>` blocks
- PR: https://github.com/tprei/telegram-minions/pull/517
- Type changes in `GooseStreamEvent` error variant
- **Backward compatible**: old UI ignores new fields
- **No feature flag**: changes are additive to internal event stream
- UI can show richer error messages when available; otherwise falls back to generic error display

## Earlier versions

See `package.json` in https://github.com/tprei/telegram-minions for version history.
