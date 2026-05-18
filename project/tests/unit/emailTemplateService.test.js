// EmailTemplateService.renderString — the substitution + escape helper
// driving every templated email. The v0 shipped two real bugs that this
// suite locks in fixes for:
//
//   1. Subjects were HTML-escaped, so `Acme & Co` arrived as `Acme &amp; Co`
//      in the Subject: header (entities are literal there).
//   2. Triple-mustache `{{{var}}}` values containing a `{{...}}` substring
//      got re-substituted by a second regex pass — silently emptying any
//      lookalike token in pre-rendered HTML blocks.
//
// The pure helpers are exported as `_renderString` / `_escapeHtml` for tests.

describe('EmailTemplateService.renderString', () => {
  let renderString;
  let escapeHtml;
  beforeAll(() => {
    const svc = require('../../src/services/EmailTemplateService');
    renderString = svc._renderString;
    escapeHtml = svc._escapeHtml;
  });

  function fresh() { return new Set(); }

  it('escapes HTML in {{var}} by default', () => {
    const u = fresh();
    expect(renderString('Hello {{name}}', { name: '<script>alert(1)</script>' }, u))
      .toBe('Hello &lt;script&gt;alert(1)&lt;/script&gt;');
    expect([...u]).toEqual([]);
  });

  it('does NOT escape when opts.escape is false (used for subjects)', () => {
    const u = fresh();
    expect(renderString('[ConstructPM] {{name}}', { name: 'Acme & Co' }, u, { escape: false }))
      .toBe('[ConstructPM] Acme & Co');
  });

  it('{{{var}}} renders raw regardless of the escape option', () => {
    const u = fresh();
    expect(renderString('{{{html}}}', { html: '<b>x</b>' }, u)).toBe('<b>x</b>');
    expect(renderString('{{{html}}}', { html: '<b>x</b>' }, u, { escape: false })).toBe('<b>x</b>');
  });

  it('does not double-substitute when a raw value contains {{...}}', () => {
    // The bug: the v0 two-pass implementation would re-process the inner
    // `{{cmd}}` after substituting the outer triple. With a single-pass
    // alternation regex the inner braces survive verbatim.
    const u = fresh();
    expect(renderString('{{{block}}}', { block: 'before {{cmd}} after' }, u))
      .toBe('before {{cmd}} after');
    expect([...u]).toEqual([]); // `cmd` is NOT looked up and not marked unresolved
  });

  it('tracks unresolved variables but renders them as empty', () => {
    const u = fresh();
    expect(renderString('Hi {{name}} — your {{role}}', { name: 'Pat' }, u))
      .toBe('Hi Pat — your ');
    expect([...u]).toEqual(['role']);
  });

  it('treats null and undefined values as unresolved', () => {
    const u = fresh();
    expect(renderString('{{a}}-{{b}}', { a: null, b: undefined }, u)).toBe('-');
    expect([...u].sort()).toEqual(['a', 'b']);
  });

  it('coerces non-string values to strings', () => {
    const u = fresh();
    expect(renderString('count={{n}}, ok={{ok}}', { n: 42, ok: true }, u))
      .toBe('count=42, ok=true');
  });

  it('handles empty and non-string input', () => {
    const u = fresh();
    expect(renderString('', { a: 1 }, u)).toBe('');
    expect(renderString(null, { a: 1 }, u)).toBe('');
    expect(renderString(undefined, { a: 1 }, u)).toBe('');
  });

  it('allows the same variable to appear multiple times', () => {
    const u = fresh();
    expect(renderString('{{x}} / {{x}} / {{{x}}}', { x: '<a>' }, u))
      .toBe('&lt;a&gt; / &lt;a&gt; / <a>');
  });

  it('leaves single braces and stray triples alone (they are not mustache tags)', () => {
    const u = fresh();
    expect(renderString('cost: ${price} on { line 1 }', { price: 5 }, u))
      .toBe('cost: ${price} on { line 1 }'); // single braces don't match
    expect(renderString('{{{{x}}}}', { x: 'V' }, u))
      .toBe('{V}'); // the inner `{{{x}}}` matches the triple, leaving outer `{` + `}` literal
  });
});

describe('EmailTemplateService._escapeHtml', () => {
  let escapeHtml;
  beforeAll(() => { escapeHtml = require('../../src/services/EmailTemplateService')._escapeHtml; });

  it('escapes the five HTML-significant characters', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('leaves safe characters alone', () => {
    expect(escapeHtml('hello world 123')).toBe('hello world 123');
  });
});
