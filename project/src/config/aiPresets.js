/**
 * AI Configuration Presets
 *
 * Pre-configured bundles of AI backend settings tuned for different hardware tiers.
 * Set AI_PRESET env var in .env to choose one. Individual env vars below always
 * override preset defaults, so you can start with a preset and tweak specific
 * models without losing everything else.
 *
 * Full guide with hardware-to-preset mapping, Ollama install, and troubleshooting:
 *   docs/AI_SETUP.md
 *
 * To switch presets at any time:
 *   1. Edit .env and change AI_PRESET=<name>
 *   2. If the new preset uses different models, run scripts/setup-ollama-windows.ps1
 *   3. Restart the backend (docker compose restart or node src/server.js)
 *   4. Verify: node scripts/test-ai-config.js
 */

const PRESETS = {
  'cloud-only': {
    description: 'All AI via Claude API. No local models. Requires ANTHROPIC_API_KEY.',
    hardwareMin: 'Any machine + internet connection + Claude API key',
    textBackend: 'claude',
    visionBackend: 'claude',
    ocrBackend: 'auto',
    ollamaTextModel: null,
    ollamaVisionModel: null,
    confidenceThreshold: 0.3,
    estimatedMonthlyCost: '$5-25 depending on document volume',
  },

  'hybrid-lite': {
    description: 'Local text extraction + Claude Vision API for forms. Small local footprint.',
    hardwareMin: '6GB+ VRAM, 16GB+ RAM',
    textBackend: 'ollama',
    visionBackend: 'claude',
    ocrBackend: 'tesseract',
    ollamaTextModel: 'llama3:8b',
    ollamaVisionModel: null,
    confidenceThreshold: 0.4,
    estimatedMonthlyCost: '$1-5 (vision only, low volume)',
  },

  'local-lite': {
    description: 'All local. llama3:8b text + llava:7b vision. Both fit in VRAM simultaneously.',
    hardwareMin: '10GB+ VRAM, 16GB+ RAM. No model swapping.',
    textBackend: 'ollama',
    visionBackend: 'ollama',
    ocrBackend: 'tesseract',
    ollamaTextModel: 'llama3:8b',
    ollamaVisionModel: 'llava:7b',
    confidenceThreshold: 0.4,
    estimatedMonthlyCost: '$0 (electricity only)',
  },

  'local-standard': {
    description: 'All local. llama3:8b text + llava:13b vision. Best accuracy at 12GB+ VRAM.',
    hardwareMin: '12GB+ VRAM, 32GB+ RAM. Ollama swaps models if total exceeds VRAM (~14GB needed).',
    textBackend: 'ollama',
    visionBackend: 'ollama',
    ocrBackend: 'tesseract',
    ollamaTextModel: 'llama3:8b',
    ollamaVisionModel: 'llava:13b',
    confidenceThreshold: 0.4,
    estimatedMonthlyCost: '$0 (electricity only)',
  },

  'local-heavy': {
    description: 'Large local models. llama3:70b text + llava:34b vision. Top accuracy.',
    hardwareMin: '24GB+ VRAM, 64GB+ RAM',
    textBackend: 'ollama',
    visionBackend: 'ollama',
    ocrBackend: 'tesseract',
    ollamaTextModel: 'llama3:70b',
    ollamaVisionModel: 'llava:34b',
    confidenceThreshold: 0.3,
    estimatedMonthlyCost: '$0 (electricity only)',
  },

  'cpu-only': {
    description: 'No GPU. Runs small models on CPU. Slow but works on any machine with enough RAM.',
    hardwareMin: '16GB+ RAM. Expect 30-90 seconds per extraction.',
    textBackend: 'ollama',
    visionBackend: 'ollama',
    ocrBackend: 'tesseract',
    ollamaTextModel: 'llama3:8b',
    ollamaVisionModel: 'llava:7b',
    confidenceThreshold: 0.4,
    estimatedMonthlyCost: '$0 (electricity only)',
  },
};

/**
 * Reads AI_PRESET env var and returns the matching preset definition.
 * Returns null if AI_PRESET is not set (individual env vars are then expected).
 * Throws if AI_PRESET is set but invalid.
 */
function getActivePreset() {
  const presetName = process.env.AI_PRESET;
  if (!presetName || presetName.trim() === '') {
    return null;
  }
  const preset = PRESETS[presetName];
  if (!preset) {
    const valid = Object.keys(PRESETS).join(', ');
    throw new Error(
      `Invalid AI_PRESET: "${presetName}". Valid options: ${valid}`
    );
  }
  return { name: presetName, ...preset };
}

/**
 * Lists all available presets with their descriptions.
 * Useful for CLI tools and admin UI.
 */
function listPresets() {
  return Object.entries(PRESETS).map(([name, config]) => ({
    name,
    description: config.description,
    hardwareMin: config.hardwareMin,
    estimatedMonthlyCost: config.estimatedMonthlyCost,
  }));
}

module.exports = {
  PRESETS,
  getActivePreset,
  listPresets,
};
