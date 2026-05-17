# Future Refinement — Auto-File Contract Upload Window

> **Status:** Backlog · **Priority:** Medium — touches the bid-won → project transition · **Estimated effort:** 1 week
> **Drafted:** May 2026 · **Trigger:** Pat (note 8.6 + 8.9, terminology batch)

---

## The need

When a bid is marked won and becomes a project, two things follow shortly after:

1. The customer signs and returns the contract. The signed contract needs to be filed in the project's `Contract/` folder.
2. The PM needs to confirm the contract amount actually matches what was bid (no surprise revisions, no missing signatures, no dropped scope).

Today, both steps require manual action. The PM remembers (or doesn't) to drop the contract PDF in the right folder. Then they remember (or don't) to verify the dollar amount line by line. Both are easy to miss when juggling 8+ active projects.

## What to build

### Stage 1 — Open contract upload window automatically

When `bids:mark_won` triggers project creation, immediately schedule a notification to fire on a defined cadence:

- **Initial notification (immediate):** "Project [number] created from bid. Upload signed contract when ready."
- **Reminder #1 (24 hours):** "Contract folder for [project number] is empty — please upload."
- **Reminder #2 (3 days):** ⚠️ Yellow warning notification.
- **Reminder #3 (7 days):** Escalates to admin + PM.

The reminder loop stops as soon as a file appears in the project's `Contract/` folder.

When the PM clicks the notification, they land on a focused **upload window**:

- Drag-and-drop zone for the contract file
- File auto-saves to `projects/<year>/<staff>/<customer>/<projectNumber>/Contract/`
- AI extraction runs immediately (using the `contract` doc_type, which already exists)
- The extracted contract amount is shown next to the bid's contract value for visual comparison

### Stage 2 — Confirm-contract-amount actionable workflow

Once the contract is uploaded and OCR runs, the PM gets a follow-up actionable notification:

- **Title:** "Confirm contract amount: [project number]"
- **Body:** Shows OCR-extracted contract amount + line items, alongside the bid's contract value + bid quote lines, side by side.
- **Actions:**
  - **"Match — confirm"** → marks the contract as verified, sets `projects.contract_verified = true`
  - **"Mismatch — flag"** → opens an edit dialog: PM enters the actual contract value, system updates `projects.contract_value`, logs the change in audit_log, and notifies admin
  - **"Need to re-upload"** → resets the contract folder + reopens the upload window

This is the single highest-leverage check in the bid-won → project flow. A 5% discrepancy on a $400k contract is $20k. Catching it on day 1 is worth the friction.

## Implementation sketch

### Schema additions

```js
exports.up = async function(knex) {
  await knex.schema.alterTable('projects', (t) => {
    t.boolean('contract_verified').defaultTo(false);
    t.timestamp('contract_verified_at');
    t.uuid('contract_verified_by').references('users.id');
    t.decimal('contract_extracted_amount', 12, 2);  // OCR result for comparison
  });
};
```

### Backend hooks

In `routes/bids.js mark-won` (after project + folder creation):
```js
await NotificationService.notifyContractUploadDue({
  projectId: project.id,
  pmId: project.pm_id,
  delegateIds: await db('pm_notification_delegates').where({ pm_id: project.pm_id }).pluck('delegate_id'),
});
```

A new background job (extends `FileWatcher.js`):
```js
async function checkContractFolders() {
  const projects = await db('projects')
    .where('contract_verified', false)
    .where('created_at', '<', daysAgo(1));

  for (const p of projects) {
    const files = await FileService.listFiles(`${p.folder_path}/Contract/`);
    if (files.length === 0) {
      // Send escalating reminder based on age
      const ageDays = daysSince(p.created_at);
      if (ageDays >= 7) await NotificationService.escalateContractMissing(p);
      else if (ageDays >= 3) await NotificationService.warnContractMissing(p);
    }
  }
}
```

When a file is uploaded to `Contract/` (file watcher detects it):
```js
// 1. Run extraction with doc_type='contract'
const extraction = await ExtractionService.extractContract(uploadedFile);
// 2. Store extracted amount on project for comparison
await db('projects').where({ id }).update({ contract_extracted_amount: extraction.amount });
// 3. Notify PM with actionable confirmation
await NotificationService.notifyContractAmountConfirmation({
  projectId: id,
  bidValue: project.contract_value,
  extractedValue: extraction.amount,
});
```

### Frontend window

A new SPA route `/contract-upload/:projectId` that:
- Shows project info banner (name, number, customer, location)
- Shows bid's contract_value in big text
- Has a single drag-drop file input
- On upload: shows a spinner, then displays OCR result side-by-side with bid value
- "Confirm matches" / "Flag mismatch" buttons trigger the actions described above

### The confirmation modal

When PM clicks "Confirm contract amount" notification, a modal opens with two columns:

| Bid (what we promised) | Contract (what was signed) |
|---|---|
| $487,250.00 | $487,250.00  ✅ |
| Newark Office Tower Phase 2 | Newark Office Tower Phase 2  ✅ |
| 12-week duration | 14-week duration  ⚠️ |
| 6 line items, total $487,250 | 7 line items, total $487,250 (one was split)  ✅ |

Differences highlighted. PM can confirm or flag.

## Open design questions

1. **What if the customer never signs?** Some contracts get verbal-agreed and started before paper signs. A "Mark contract as verbal/pending paper" option might be needed to suppress reminders for known-pending paperwork.

2. **What if the bid value is $0 or missing?** Some projects start with TBD pricing (T&M) and contract value is determined later. The confirmation step should detect this and skip comparison, just confirm "we received and filed the document."

3. **What about contract amendments?** A change order is itself a contract. Should the upload window stay open after first contract is confirmed, ready to accept amendments? Or do amendments go through a different flow?

## Why this is deferred

The bid-won → project flow currently works without this. Contracts get filed manually. Amount discrepancies get caught (or missed) by attentive PMs. The proposed workflow is a quality-of-life and audit-trail improvement, not a foundational fix.

It becomes more valuable as:
- Project volume grows (PM can't manually track 30+ open contracts)
- Contracts come in slower (more reminders needed)
- Audit/compliance demands documentation that the firm verified contract terms day-1

## Effort estimate

- Schema + reminder cron: 2 days
- Contract upload window UI: 2 days
- Side-by-side confirmation modal: 2 days
- Notification wiring + escalation logic: 1 day
- Testing: 2 days

Total: ~1.5 weeks of focused work. Could ship Stage 1 alone (auto-folder + reminders) in 1 week, then Stage 2 (amount confirmation) as a follow-up.

---

*Update when implementation begins.*
