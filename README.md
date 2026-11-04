# Ryza Chat (Lyravein fork)

A local-first client for a conversational agent with a real-time 2D avatar. Forked from [zeroa234/ryza-ai-revive](https://github.com/zeroa234/ryza-ai-revive) with full internationalization, per-sentence TTS, session resume, and foreign-language leak guards.

The application is a static HTML/JavaScript runtime. Thin native hosts load the same tree on Windows (Electron) and Android (WebView). Language and speech models are attached at run time through operator-configured HTTP APIs (OpenAI-compatible chat completions, plus optional TTS backends like Fish Audio).

Version is pinned in `config/version.json` (single source of truth for the exe and the APK). License: [MIT](LICENSE).

---

## Architecture

| Layer | Role |
|---|---|
| `web/` | Shared client: UI, avatar renderer, local state, i18n |
| `desktop/` | Frameless Electron host (`ryza://app/`) |
| `android/` | `Activity` + local `AssetServer` |
| `scripts/` | Dev server, indexes, packaging, regression tests |
| `config/` | Version pin (`version.json`) and provider templates |

The three hosts share one proxy contract, `GET/POST /_proxy`, so browser and WebView code can call operator endpoints without a CORS failure. The development server is `python scripts/serve.py` (`http://127.0.0.1:8765/`). A plain `http.server` is insufficient because it does not implement the proxy.

Inference is not bundled. Settings require an OpenAI-compatible base URL, model identifier, and API key; TTS is optional and uses per-provider credential fields (`openai` / `qwen` / `fish`). NSFW/undress is disabled by default and can only be enabled explicitly in Settings; the AI cannot enable it while permission is off.

Further module-level notes: [docs/PROJECT.md](docs/PROJECT.md).
First-run help (keys, base URLs, save slots, costumes): [docs/SETUP.md](docs/SETUP.md).
User setup (OpenRouter and Fish Audio): [docs/SETUP.md#user-setup](docs/SETUP.md#user-setup).

---

## User setup

The app does not provide an AI account or proxy key. Create provider accounts
yourself, then enter the credentials only in the in-app Settings screen.

### OpenRouter (LLM)

1. Sign in at [openrouter.ai](https://openrouter.ai/).
2. Open [Keys](https://openrouter.ai/keys), create a key, and copy it once.
3. In the game, open **Settings → LLM** and enter:
   - Base URL: `https://openrouter.ai/api/v1`
   - API key: the key you just created
   - Model: select one with **Fetch model list**, or enter the provider model id
4. Save the settings and send a test message. Free models can be slower or
   temporarily unavailable; the provider may also apply usage limits.

### Fish Audio (TTS)

1. Sign in at [fish.audio](https://fish.audio/).
2. Create or copy an API key from your Fish Audio account.
3. In the game, open **Settings → TTS**, choose **Fish Audio**, and enter:
   - Base URL: leave empty to use `https://api.fish.audio`
   - API key: your Fish Audio key
   - Model: `s2.1-pro-free` when that model is available to your account
   - Voice ID: optional; leave empty to use Fish Audio's default voice
4. Enable TTS and use the voice test. The selected voice is stored locally in
   the app profile, not in this repository.

Never paste API keys into GitHub issues, screenshots, `config/providers.json`,
source files, or committed documentation. If a key is exposed, revoke it at
the provider immediately and create a replacement.

## Capabilities

- Dialogue modes: chat, story, immersive, ASMR, text
- Spine 4.2 portrait and scene graph (posture, camera, tap hit-testing)
- Local RPG-style state: stamina, quests, inventory, daily rewards (`localStorage`)
- Two-layer session memory plus a dated long-term layer, independent of adventure logs
- Sitting variants (normal / cross-legged) when the worn outfit ships both
- Storage-pressure canary: a full origin is reported instead of failing silently
- Four language slots (UI, bundled voice, LLM output, TTS), seven UI locales
- Tagged replies for scene side effects; numeric deltas in a trailing `<state>` block (no function-calling requirement)

### Lyravein additions

- **Mood & Dynamic Affection System**: Tracks companion affection (0..100) across 4 relationship tiers (Acquaintance, Companion, Close Friend, Soulmate) and 4 dynamic moods (Normal, Happy, Tired, Sulk). Adapts LLM system prompts, avatar idle expressions, and tiered touch tap reactions.
- **Proactive Idle Spark (`proactive.js`)**: Ryza autonomously sparks casual remarks or alerts when idle, reacting to stamina depletion/faint, time of day (TOD), mood shifts, and relationship tiers. Features sticky user preemption, anti-spam cooldown, and configurable frequency settings (Low, Normal, High, or Off) with complete 7-locale translations.
- **Polished Companion UI**: Dedicated frosted companion status badge on the character chat card with glowing pink affection counter and mood-reactive badges, alongside a streamlined RPG HUD level pill.
- **Full i18n coverage**: every map field, stage name, settings panel, provider message, toast, and adventure log entry follows the selected UI language instead of leaking Japanese or Chinese defaults.
- **Per-sentence TTS**: replies are synthesized and played one sentence at a time (opt-in), with opening-clip caching and failed-clip reporting.
- **Translation leak guard**: when the model repeats its own reply in another language (e.g., Indonesian followed by Chinese), CJK-heavy segments are dropped for non-CJK targets. Translation beats are preserved as UI labels and never spoken aloud. Proper nouns (e.g., Japanese names inside an Indonesian sentence) survive intact.
- **Session resume**: closing and reopening the app continues the running conversation instead of starting over.
- **Fish Audio cloning**: voice cloning support via Fish Audio API, bounded by safety limits and verified through ES5 compatibility guards.
- **Voice test localization**: the settings voice test speaks in the chosen output language, and untranslated lines are never voiced.

---

## Runtime resources

Structural tables (JSON, atlas, SVG) live in `web/assets/` and are versioned with the client. Large binaries (raster, audio, skeleton) are excluded from version control and restored before a full session or packaged build:

```powershell
python scripts/restore_media.py path\to\RyzaChat-1.2.24.apk
python scripts/restore_media.py path\to\win-unpacked\resources\web
```

If asset files change, regenerate indexes with `python scripts/build_indexes.py`.

---

## Configuration and secrets

Copy `config/providers.example.json` to `config/providers.json` for local hydration. That file is gitignored. Packaged hosts do not embed it; keys remain in the app profile (`localStorage` or `%AppData%\RyzaChat`). `scripts/privacy_check.py` is a packaging gate: a non-zero exit aborts desktop and APK builds when a secret-shaped token or machine-local path would be included.

---

## Build

```powershell
python scripts/serve.py                          # browser
cd desktop; npm install; npx electron .          # desktop
powershell -File scripts/build_desktop.ps1       # NSIS installer
powershell -File scripts/setup_android_tools.ps1 # JDK 17 + SDK (once)
powershell -File scripts/build_apk.ps1           # APK
```

Android toolchain path: environment `RYZA_ANDROID_TOOLS`, or gitignored `config/android-tools.local.txt`.

---

## Tests

The full list (19 node suites including `npc_foreign_regression.js`, the boundary guard and the packaging gate) lives in
[docs/PROJECT.md §4](docs/PROJECT.md). One-liner for the whole thing:

```bash
python scripts/privacy_check.py web && node scripts/layering_check.js --strict
node scripts/boot_smoke.js && node scripts/motion_regression.js
node scripts/npc_foreign_regression.js
```

Contribution rules: [CONTRIBUTING.md](CONTRIBUTING.md).
