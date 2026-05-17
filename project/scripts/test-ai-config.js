/**
 * AI Config Test Script
 *
 * Run: node scripts/test-ai-config.js
 *
 * Verifies:
 *   - aiConfig.js loads without errors
 *   - Ollama server is reachable (if configured)
 *   - Required models are pulled (if using Ollama)
 *   - Claude API key works (if configured)
 *
 * Exits with code 0 if healthy, 1 if any required check fails.
 */

// Load environment from .env if dotenv is available
try {
  require('dotenv').config();
} catch (e) {
  // dotenv optional — env vars may be set externally
}

const path = require('path');
const config = require(path.join(__dirname, '..', 'src', 'config', 'aiConfig'));
const { listPresets } = require(path.join(__dirname, '..', 'src', 'config', 'aiPresets'));

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const RESET = '\x1b[0m';

let failures = 0;

function ok(msg)   { console.log(`  ${GREEN}✓${RESET} ${msg}`); }
function fail(msg) { console.log(`  ${RED}✗${RESET} ${msg}`); failures++; }
function warn(msg) { console.log(`  ${YELLOW}⚠${RESET} ${msg}`); }
function info(msg) { console.log(`  ${CYAN}ℹ${RESET} ${msg}`); }

async function main() {
  console.log('');
  console.log(`${CYAN}╔══════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}║  AI Configuration Test                       ║${RESET}`);
  console.log(`${CYAN}╚══════════════════════════════════════════════╝${RESET}`);
  console.log('');

  // ─── Step 1: Show active config ───
  console.log('Active configuration:');
  info(`Preset:           ${config.preset}`);
  info(`Text backend:     ${config.textBackend}  (model: ${config.ollamaTextModel || 'n/a'})`);
  info(`Vision backend:   ${config.visionBackend}  (model: ${config.ollamaVisionModel || 'n/a'})`);
  info(`OCR backend:      ${config.ocrBackend}`);
  info(`Claude API key:   ${config.anthropicApiKey ? '***set***' : 'not set'}`);
  info(`Ollama host:      ${config.ollamaHost}`);
  console.log('');

  // ─── Step 2: Ollama tests (if configured) ───
  const ollamaInUse =
    config.textBackend === 'ollama' || config.textBackend === 'auto' ||
    config.visionBackend === 'ollama' || config.visionBackend === 'auto';

  if (ollamaInUse) {
    console.log('Ollama checks:');
    let ollamaReachable = false;
    let availableModels = [];
    try {
      const res = await fetch(`${config.ollamaHost}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        availableModels = (data.models || []).map(m => m.name);
        ok(`Ollama reachable at ${config.ollamaHost}`);
        ok(`${availableModels.length} model(s) pulled: ${availableModels.join(', ') || '(none)'}`);
        ollamaReachable = true;
      } else {
        fail(`Ollama returned HTTP ${res.status}`);
      }
    } catch (e) {
      const required = config.textBackend === 'ollama' || config.visionBackend === 'ollama';
      if (required) {
        fail(`Ollama not reachable at ${config.ollamaHost}: ${e.message}`);
      } else {
        warn(`Ollama not reachable — auto backend will use Claude fallback (${e.message})`);
      }
    }

    if (ollamaReachable) {
      const needed = [];
      if (config.ollamaTextModel && (config.textBackend === 'ollama' || config.textBackend === 'auto')) {
        needed.push({ model: config.ollamaTextModel, purpose: 'text' });
      }
      if (config.ollamaVisionModel && (config.visionBackend === 'ollama' || config.visionBackend === 'auto')) {
        needed.push({ model: config.ollamaVisionModel, purpose: 'vision' });
      }
      for (const { model, purpose } of needed) {
        if (availableModels.includes(model)) {
          ok(`${model} (${purpose}) is pulled`);
        } else {
          fail(`${model} (${purpose}) NOT pulled — run: ollama pull ${model}`);
        }
      }
    }
    console.log('');
  }

  // ─── Step 3: Claude API test (if configured) ───
  const claudeInUse =
    config.textBackend === 'claude' || config.textBackend === 'auto' ||
    config.visionBackend === 'claude' || config.visionBackend === 'auto';

  if (claudeInUse) {
    console.log('Claude API checks:');
    if (!config.anthropicApiKey) {
      const required = config.textBackend === 'claude' || config.visionBackend === 'claude';
      if (required) {
        fail('ANTHROPIC_API_KEY not set but preset requires Claude');
      } else {
        warn('ANTHROPIC_API_KEY not set — auto backend cannot fall back to Claude');
      }
    } else {
      try {
        const res = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'x-api-key': config.anthropicApiKey,
            'anthropic-version': '2023-06-01',
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            model: config.claudeTextModel,
            max_tokens: 5,
            messages: [{ role: 'user', content: 'Reply: ok' }],
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (res.ok) {
          const data = await res.json();
          const text = data.content?.[0]?.text || '(empty)';
          ok(`Claude API responsive (model: ${config.claudeTextModel})`);
          ok(`Response: "${text.trim()}"`);
        } else {
          const err = await res.text();
          fail(`Claude API error ${res.status}: ${err.substring(0, 200)}`);
        }
      } catch (e) {
        fail(`Claude API unreachable: ${e.message}`);
      }
    }
    console.log('');
  }

  // ─── Step 4: Summary ───
  console.log('─'.repeat(48));
  if (failures === 0) {
    console.log(`${GREEN}All checks passed. AI pipeline is ready.${RESET}`);
    process.exit(0);
  } else {
    console.log(`${RED}${failures} check(s) failed. See messages above.${RESET}`);
    console.log('');
    console.log('Available presets to try:');
    for (const p of listPresets()) {
      console.log(`  ${CYAN}${p.name.padEnd(16)}${RESET} ${p.description}`);
      console.log(`  ${' '.repeat(18)}${p.hardwareMin}`);
    }
    process.exit(1);
  }
}

main().catch(e => {
  console.error(`${RED}Fatal error:${RESET}`, e);
  process.exit(1);
});
