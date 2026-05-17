# AI Setup Guide

> **Companion documents:**
> - `HANDOFF.md` — master index, start here if this is your first time opening this package
> - `PROJECT_REFERENCE.md` — original backend architecture
> - `MOBILE_APP_REFERENCE.md` — mobile app spec + new data models (Form Templates use this AI config)

This guide covers how to install Ollama, pull the right models for your hardware, and switch AI configurations without changing code.

---

## TL;DR for your hardware (RTX 4070 Ti 12GB, 32GB RAM, Windows)

```powershell
# 1. Install Ollama (one-time)
#    Download from: https://ollama.com/download/windows
#    Run the installer.

# 2. Open PowerShell in the project's scripts/ folder and run:
.\setup-ollama-windows.ps1 -Preset local-standard

# 3. In your .env file, set:
#    AI_PRESET=local-standard

# 4. Restart backend, then verify:
node scripts/test-ai-config.js
```

That's it. `local-standard` uses llama3:8b for text + llava:13b for vision — the best accuracy combo that fits your 12GB card (with occasional model swapping when toggling between text and vision tasks).

---

## Choosing a preset

Set `AI_PRESET=<name>` in your `.env` file. You can switch any time — just re-run the setup script if the new preset uses different models.

| Preset | Text Model | Vision Model | Hardware | Monthly Cost |
|--------|-----------|--------------|----------|--------------|
| `cloud-only` | Claude API | Claude API | Any + internet | $5–25 |
| `hybrid-lite` | llama3:8b (local) | Claude API | 6GB+ VRAM | $1–5 |
| `local-lite` | llama3:8b | llava:7b | 10GB+ VRAM | $0 |
| **`local-standard`** | **llama3:8b** | **llava:13b** | **12GB+ VRAM** | **$0** |
| `local-heavy` | llama3:70b | llava:34b | 24GB+ VRAM | $0 |
| `cpu-only` | llama3:8b | llava:7b | 16GB+ RAM | $0 (slow) |

### When to pick each

- **`cloud-only`** — You want zero local setup, have reliable internet, and don't mind paying per document. Best for first-time trials.
- **`hybrid-lite`** — You have a modest GPU but want free text extraction (the common case) while paying only for occasional form vision.
- **`local-lite`** — You have a mid-range GPU (10–12GB VRAM) and want both text and vision to always stay loaded in VRAM (no swap delay).
- **`local-standard`** — Your GPU (your case) has 12GB VRAM. Best vision accuracy the card can handle. Accepts a 2–4 sec model swap delay when alternating between text and vision tasks.
- **`local-heavy`** — You have a workstation-class GPU (3090/4090/A100) and want top accuracy on both.
- **`cpu-only`** — No GPU. Works but extractions take 30–90 seconds each.

---

## File changes required in the project

The handoff package delivers these files flat — here's where each one goes in the project:

| File from handoff package | Goes to in project | Notes |
|---------------------------|--------------------|-------|
| `aiPresets.js` | `src/config/aiPresets.js` | New file |
| `aiConfig.js` | `src/config/aiConfig.js` | **Replaces** existing file |
| `env-ai-section.txt` | Append contents into `.env` AND `.env.example` | Do not create a file — paste into existing ones |
| `setup-ollama-windows.ps1` | `scripts/setup-ollama-windows.ps1` | New file |
| `test-ai-config.js` | `scripts/test-ai-config.js` | New file |

After placing the files, all script paths (`scripts/setup-ollama-windows.ps1`, `scripts/test-ai-config.js`) will work as documented in the rest of this guide.

---

## Switching presets later

All of this is live — no code changes needed to switch.

```powershell
# 1. Edit .env
#    AI_PRESET=local-lite    (for example)

# 2. Pull new models if the preset changed them
.\scripts\setup-ollama-windows.ps1 -Preset local-lite

# 3. Restart the backend
docker compose restart
# or: node src/server.js

# 4. Verify
node scripts/test-ai-config.js
```

---

## Overriding individual models within a preset

If you want mostly a preset but with a specific tweak — say, you like `local-standard` but want to try llava:34b on vision — uncomment the relevant env var:

```bash
AI_PRESET=local-standard
OLLAMA_VISION_MODEL=llava:34b   # this overrides the preset's llava:13b
```

Precedence: individual env var > preset default > hardcoded fallback.

---

## Model swapping explained (for `local-standard` on 12GB cards)

Your card has 12GB VRAM. The two `local-standard` models need:
- llama3:8b: ~5GB
- llava:13b: ~9GB
- **Total: ~14GB** (exceeds 12GB)

Ollama handles this automatically by loading models on demand:

1. First text extraction → Ollama loads llama3:8b (~3 sec first time, then fast)
2. Second text extraction → already loaded, instant
3. First vision extraction → Ollama unloads llama3:8b, loads llava:13b (~4 sec)
4. Second vision extraction → llava:13b still loaded, instant
5. Next text extraction → swap again (~3 sec)

**In practice** — text extractions (invoices/POs/timesheets) and vision extractions (oil samples) rarely interleave within a single request. Text runs happen throughout the day; vision runs only when a foreman submits a form. You'll notice the occasional 3–4 second delay on the first extraction after a long idle period, but sustained throughput is fast.

If the swap delay ever bothers you, switch to `local-lite` (both models fit together, no swap). You'll lose a small amount of form reading accuracy but gain consistent latency.

---

## Troubleshooting

### "Ollama not found on PATH"
Install from https://ollama.com/download/windows, then open a NEW PowerShell window (PATH updates don't apply to existing terminals).

### "Model not pulled" after running setup script
Check disk space. llava:13b is ~8GB, llama3:70b is ~40GB. Pull failures sometimes leave partial downloads — delete from `%USERPROFILE%\.ollama\models` and retry.

### "Out of VRAM" errors during extraction
Your chosen preset's total model size exceeds your VRAM and Ollama couldn't swap fast enough, OR another process is using the GPU. Try:
1. Close other GPU-using apps (games, Chrome hardware acceleration, etc.)
2. Switch to a lighter preset: `AI_PRESET=local-lite`
3. Restart Ollama: `taskkill /F /IM ollama.exe` then `ollama serve`

### Extractions are very slow (60+ seconds)
- Verify Ollama is actually using GPU: `ollama ps` should show model with GPU label
- If it shows CPU only, your driver may not support CUDA for this Ollama build — reinstall Ollama, update NVIDIA drivers, reboot

### Docker can't reach Ollama
In `docker-compose.yml`, set `OLLAMA_HOST=http://host.docker.internal:11434`. This lets the container reach Ollama running on your Windows host.

### "Cannot find module '../src/config/aiConfig'" when running test script
You're running the test script from the wrong directory. Run it from the project root: `node scripts/test-ai-config.js`

---

## For other hardware tiers (future-proofing)

The preset system was designed so you can upgrade/downgrade hardware without editing the app. Just change `AI_PRESET` and re-run the setup script.

Specific migration paths:
- **If you upgrade to 16GB+ VRAM** → try `local-standard` still, or bump OLLAMA_VISION_MODEL override to `llava:34b`
- **If you upgrade to 24GB+ VRAM (e.g. 3090/4090)** → try `local-heavy`
- **If you downsize to a laptop with 8GB VRAM** → `hybrid-lite` is your friend
- **If your GPU fails entirely** → `cpu-only` keeps you running while you fix it
