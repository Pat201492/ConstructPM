// Type-to-filter picker. Replaces the old `<select>` dropdowns on mobile
// screens — works much better than a 200-item native picker on a phone.
//
// Usage:
//   import { pickerHtml, bindPicker, escForAttr } from '../lib/pickers.js';
//   // 1) Render: emit the HTML
//   wrap.innerHTML = pickerHtml({
//     id: 'project_id',
//     label: 'Project',
//     selectedDisplay: currentProject ? currentProject.name : '',
//     placeholder: 'Type to search…',
//     addModalType: null,         // or 'project', 'customer' etc to show a + button
//   });
//   // 2) After append, bind behavior
//   bindPicker(wrap, {
//     id: 'project_id',
//     items: projects,
//     labelFn: p => p.primary_number || p.name,
//     onPick: (id, item) => { /* update your state, re-render */ },
//   });
//
// HTML emitted carries data-picker / data-picker-list / data-picker-wrap
// attributes so the binder can find them with a query selector.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escForAttr = (s) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

export function pickerHtml({ id, label, selectedDisplay = '', placeholder = 'Type to search…', addModalType = null, addTargetField = null }) {
  const addBtn = addModalType ? `<button class="btn secondary" data-add="${escForAttr(addModalType)}" data-target="${escForAttr(addTargetField || id)}" style="min-width:48px;padding:8px 12px">+</button>` : '';
  return `
    <div style="margin-top:8px" data-picker-wrap="${escForAttr(id)}">
      <label>${escForAttr(label)}</label>
      <div class="row" style="gap:6px;position:relative">
        <div class="grow" style="position:relative">
          <input data-picker="${escForAttr(id)}" placeholder="${escForAttr(placeholder)}" autocomplete="off" value="${escForAttr(selectedDisplay)}" style="width:100%" />
          <div data-picker-list="${escForAttr(id)}" style="display:none;position:absolute;top:100%;left:0;right:0;background:var(--surface);border:1px solid var(--border);border-radius:8px;max-height:240px;overflow:auto;z-index:20;margin-top:2px;box-shadow:0 4px 12px rgba(0,0,0,0.1)"></div>
        </div>
        ${addBtn}
      </div>
    </div>
  `;
}

// Wires the input + dropdown. `onPick` is called with (pickedId, pickedItem)
// when the user picks an item (click / tap / Enter). Typing in the input
// is treated as SEARCH ONLY — it does NOT clear or change the bound state.
// If the user types and clicks away without picking, the visible text
// reverts to the last committed display so the input never drifts out of
// sync with the underlying selection.
export function bindPicker(root, { id, items, labelFn, onPick }) {
  const input = root.querySelector(`[data-picker="${cssEscape(id)}"]`);
  const list = root.querySelector(`[data-picker-list="${cssEscape(id)}"]`);
  if (!input || !list) return;

  // Snapshot at bind time. pickerHtml sets input.value to the currently
  // selected item's label (or ''), so this is the source of truth for
  // what the visible text should be when the user isn't actively typing.
  let committedDisplay = input.value;

  const renderList = (filter) => {
    const f = (filter || '').toLowerCase().trim();
    const matches = (f ? items.filter(i => labelFn(i).toLowerCase().includes(f)) : items).slice(0, 30);
    if (matches.length === 0) {
      list.innerHTML = `<div style="padding:10px;color:var(--muted);font-size:14px">No matches</div>`;
    } else {
      list.innerHTML = matches.map(i =>
        `<div data-pick-id="${escForAttr(i.id)}" style="padding:10px 12px;cursor:pointer;border-bottom:1px solid var(--border);min-height:var(--tap);display:flex;align-items:center">${escForAttr(labelFn(i))}</div>`
      ).join('');
    }
    list.style.display = 'block';
    // mousedown beats blur so the click registers before the list hides.
    list.querySelectorAll('[data-pick-id]').forEach(el => {
      el.onmousedown = (e) => { e.preventDefault(); pick(el.dataset.pickId); };
      el.ontouchstart = (e) => { e.preventDefault(); pick(el.dataset.pickId); };
    });
  };

  const pick = (pickedId) => {
    const item = items.find(i => i.id === pickedId) || null;
    committedDisplay = item ? labelFn(item) : '';
    input.value = committedDisplay;
    list.style.display = 'none';
    onPick?.(pickedId || '', item);
  };

  input.onfocus = () => renderList(input.value);
  input.oninput = () => renderList(input.value);
  input.onblur = () => setTimeout(() => {
    list.style.display = 'none';
    // Revert visible text to the committed selection if the user typed
    // but didn't pick — otherwise the next render() would still show
    // stale text and they'd see two different "current values" at once.
    if (input.value !== committedDisplay) input.value = committedDisplay;
  }, 180);
}

// Minimal CSS.escape polyfill for old browsers — used to safely embed an
// arbitrary id (UUIDs are fine but defensive code costs nothing).
function cssEscape(s) {
  if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
  return String(s).replace(/[^\w-]/g, '\\$&');
}
