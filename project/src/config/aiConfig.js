/**
 * AI Configuration
 *
 * Resolves the effective AI configuration by combining:
 *   1. Individual env vars (AI_BACKEND, OLLAMA_MODEL, etc.) — highest priority
 *   2. Active AI_PRESET defaults (from aiPresets.js)
 *   3. Hardcoded fallback defaults
 *
 * This replaces the old aiConfig.js. The new addition is preset-awareness:
 * set AI_PRESET=local-standard in .env and every AI setting snaps to tested
 * defaults for that hardware tier. Override individual fields as needed.
 */

const { getActivePreset } = require('./aiPresets');

const preset = getActivePreset();

/**
 * Resolves a config value with the precedence: env var > preset > fallback.
 * Treats empty string and "undefined" env vars as unset.
 */
function resolve(envVar, presetKey, fallback) {
  const envVal = process.env[envVar];
  if (envVal !== undefined && envVal !== '') {
    return envVal;
  }
  if (preset && preset[presetKey] !== undefined && preset[presetKey] !== null) {
    return preset[presetKey];
  }
  return fallback;
}

const config = {
  // Which preset is active (or 'none' if only individual vars are used)
  preset: preset ? preset.name : 'none',
  presetDescription: preset ? preset.description : 'No preset — using individual env vars or fallbacks',

  // ─── TEXT EXTRACTION (invoices, POs, timesheets) ───
  textBackend: resolve('AI_BACKEND', 'textBackend', 'auto'),
  ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  ollamaTextModel: resolve('OLLAMA_MODEL', 'ollamaTextModel', 'llama3:8b'),
  ollamaTextModelComplex:
    process.env.OLLAMA_MODEL_COMPLEX ||
    resolve('OLLAMA_MODEL', 'ollamaTextModel', 'llama3:8b'),

  // ─── VISION EXTRACTION (oil sample forms with template) ───
  visionBackend: resolve('VISION_AI_BACKEND', 'visionBackend', 'auto'),
  ollamaVisionModel: resolve('OLLAMA_VISION_MODEL', 'ollamaVisionModel', 'llava:13b'),

  // ─── OCR (document text layer) ───
  ocrBackend: resolve('OCR_BACKEND', 'ocrBackend', 'auto'),

  // ─── CLAUDE API (used as primary in cloud/hybrid presets, or as fallback) ───
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || null,
  claudeTextModel: process.env.CLAUDE_MODEL || 'claude-sonnet-4-5',
  claudeVisionModel: process.env.CLAUDE_VISION_MODEL || 'claude-sonnet-4-5',

  // ─── AWS TEXTRACT (OCR fallback) ───
  textractRegion: process.env.AWS_TEXTRACT_REGION || null,

  // ─── THRESHOLDS & TUNING ───
  confidenceThreshold: parseFloat(
    process.env.AI_CONFIDENCE_THRESHOLD ||
      (preset ? String(preset.confidenceThreshold) : '0.4')
  ),
  extractionTimeoutMs: parseInt(process.env.AI_TIMEOUT_MS || '180000', 10),
  temperature: parseFloat(process.env.AI_TEMPERATURE || '0.1'),
};

/**
 * Validates the resolved config, logs warnings/errors on startup.
 * Called automatically when this module is first required.
 */
function validate() {
  const warnings = [];
  const errors = [];

  // Presets that need Claude
  const textWantsClaude = config.textBackend === 'claude' || config.textBackend === 'auto';
  const visionWantsClaude = config.visionBackend === 'claude' || config.visionBackend === 'auto';
  if ((textWantsClaude || visionWantsClaude) && !config.anthropicApiKey) {
    const required =
      config.textBackend === 'claude' || config.visionBackend === 'claude';
    const msg = 'ANTHROPIC_API_KEY not set — Claude API calls will fail';
    if (required) errors.push(msg);
    else warnings.push(msg + ' (only affects auto-fallback path)');
  }

  // Vision backend needs a vision model if using Ollama
  const visionWantsOllama =
    config.visionBackend === 'ollama' || config.visionBackend === 'auto';
  if (visionWantsOllama && !config.ollamaVisionModel) {
    const required = config.visionBackend === 'ollama';
    const msg =
      'Vision backend wants Ollama but no OLLAMA_VISION_MODEL set (and preset has no vision model)';
    if (required) errors.push(msg);
    else warnings.push(msg);
  }

  // Textract needs region
  if (config.ocrBackend === 'textract' && !config.textractRegion) {
    errors.push('OCR_BACKEND=textract requires AWS_TEXTRACT_REGION');
  }

  return { warnings, errors };
}

// Run validation on module load, log results
const { warnings, errors } = validate();
if (process.env.NODE_ENV !== 'test') {
  console.log(`[aiConfig] Preset: ${config.preset} (${config.presetDescription})`);
  console.log(
    `[aiConfig] Text: ${config.textBackend}/${config.ollamaTextModel || 'n/a'} | ` +
      `Vision: ${config.visionBackend}/${config.ollamaVisionModel || 'n/a'} | ` +
      `OCR: ${config.ocrBackend}`
  );
  if (warnings.length > 0) {
    console.warn('[aiConfig] Warnings:');
    warnings.forEach((w) => console.warn('  -', w));
  }
  if (errors.length > 0) {
    console.error('[aiConfig] Errors:');
    errors.forEach((e) => console.error('  -', e));
  }
}

module.exports = config;

// ═══════════════════════════════════════════════════════════
// BACKWARD COMPATIBILITY — ExtractionService uses the old API shape.
// These properties map old names → new flat config. Remove once
// ExtractionService is refactored to use the new flat API.
// ═══════════════════════════════════════════════════════════

// Old: AIConfig.backend → textBackend
config.backend = config.textBackend;

// Old: AIConfig.claude.available
config.claude = {
  get available() { return !!config.anthropicApiKey; },
  model: config.claudeTextModel,
  visionModel: config.claudeVisionModel,
  apiKey: config.anthropicApiKey,
};

// Old: AIConfig.ollama.* 
config.ollama = {
  host: config.ollamaHost,
  model: config.ollamaTextModel,
  modelComplex: config.ollamaTextModelComplex,
  visionModel: config.ollamaVisionModel,
  escalationThreshold: config.confidenceThreshold,
  timeout: config.extractionTimeoutMs,
};

// Old: AIConfig.getModelConfig(docType)
//
// ExtractionService accesses fields like config.ollama.host, config.ollama.model,
// config.claude.model, and config.claude.maxTokens off the return value, so the
// returned object MUST mirror the top-level config.ollama / config.claude shape.
// The earlier flat-object form ({model, visionModel, ...}) caused
// "Cannot read properties of undefined (reading 'host')" because config.ollama
// was undefined on the return value.
//
// Per-docType behavior preserved: 'contract' and 'oil_sample_request' use the
// complex model; everything else uses the standard text model.
config.getModelConfig = function (docType) {
  const isComplex = ['contract', 'oil_sample_request'].includes(docType);
  const ollamaModel = isComplex ? config.ollamaTextModelComplex : config.ollamaTextModel;
  return {
    ollama: {
      host: config.ollamaHost,
      model: ollamaModel,
      visionModel: config.ollamaVisionModel,
      timeout: config.extractionTimeoutMs,
      escalationThreshold: config.confidenceThreshold,
    },
    claude: {
      model: config.claudeTextModel,
      visionModel: config.claudeVisionModel,
      // Reasonable default for structured extraction; large enough to hold
      // long line-item arrays but well under any plan's per-call cap.
      maxTokens: 4096,
      apiKey: config.anthropicApiKey,
      get available() { return !!config.anthropicApiKey; },
    },
    temperature: config.temperature,
    timeout: config.extractionTimeoutMs,
  };
};

// Old: AIConfig.validation.validate(docType, data)
config.validation = {
  validate(docType, data) {
    if (!data || typeof data !== 'object') return { valid: false, errors: ['No data extracted'] };
    return { valid: true, errors: [] };
  },
};

// Old: AIConfig.confidence.calculateOverall(scores)
config.confidence = {
  calculateOverall(scores) {
    if (!scores || typeof scores !== 'object') return 0;
    const vals = Object.values(scores).filter(v => typeof v === 'number');
    if (vals.length === 0) return 0;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  },
};
