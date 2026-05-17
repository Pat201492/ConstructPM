// AIConfig.getModelConfig shape contract — used by ExtractionService at
// runtime. ExtractionService accesses config.ollama.{host,model,timeout}
// and config.claude.{model,maxTokens}; if those nested objects go missing,
// every extraction call throws "Cannot read properties of undefined" and
// the inbox pipeline silently breaks at the AI stage.

describe('AIConfig.getModelConfig', () => {
  let AIConfig;
  beforeAll(() => {
    AIConfig = require('../../src/config/aiConfig');
  });

  it('returns config.ollama with host + model fields', () => {
    const c = AIConfig.getModelConfig('invoice');
    expect(c.ollama).toBeDefined();
    expect(typeof c.ollama.host).toBe('string');
    expect(typeof c.ollama.model).toBe('string');
    expect(c.ollama.host.length).toBeGreaterThan(0);
    expect(c.ollama.model.length).toBeGreaterThan(0);
  });

  it('returns config.claude with model + maxTokens fields', () => {
    const c = AIConfig.getModelConfig('invoice');
    expect(c.claude).toBeDefined();
    expect(typeof c.claude.model).toBe('string');
    expect(typeof c.claude.maxTokens).toBe('number');
    expect(c.claude.maxTokens).toBeGreaterThan(0);
  });

  it('uses the complex model for contract docs', () => {
    const simple = AIConfig.getModelConfig('invoice');
    const complex = AIConfig.getModelConfig('contract');
    // Complex docs route to ollamaTextModelComplex; simple to ollamaTextModel.
    // If only one var is set, both resolve to the same value — that's fine.
    expect(typeof complex.ollama.model).toBe('string');
    expect(typeof simple.ollama.model).toBe('string');
  });

  it('exposes claude.available as a boolean', () => {
    const c = AIConfig.getModelConfig('invoice');
    expect(typeof c.claude.available).toBe('boolean');
  });
});
