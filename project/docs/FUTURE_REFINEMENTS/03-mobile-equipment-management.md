# Future Refinement — Mobile Equipment Management for Field Staff

> **Status:** Backlog · **Priority:** Medium — friction point for shop ops · **Estimated effort:** 2–3 weeks
> **Drafted:** May 2026 · **Trigger:** Pat (in conversation, terminology cleanup batch)

---

## The need

The current mobile app has zero equipment management features. Field staff can submit timesheets, oil samples, and field notes — that's it. Equipment workflows happen exclusively on the web (shop staff using the desktop app).

This creates two friction points:

**1. Field staff can't tag equipment for maintenance from the jobsite.**
A piece of equipment breaks at a job site. The foreman has no way to flag it — they have to call the shop, the shop has to manually open the web app, find the item by barcode, and update its status to `maintenance_required`. By the time that happens, the equipment is either back in the truck (forgotten about) or already returned to the shop (lost in the queue).

**2. Shop staff can't partially fill equipment requests from anywhere except a desktop.**
A PM creates an equipment request with 5 line items. Shop staff has 3 of them ready to go but is missing 2 — they currently have to either (a) wait until they have all 5 to mark anything filled, or (b) mark all 5 fulfilled and update the rest by memory later. Mobile partial-fill would let shop staff scan barcodes one at a time as they pick items off the shelf.

## What to build

### Mobile equipment status tagging (field staff)

**Mobile screen:** Equipment Quick-Tag

- Open camera → scan barcode (existing barcode scanner already in mobile app)
- Lookup equipment by barcode
- Show current status + last known location
- Field staff picks new status from a constrained list:
  - "Tag for maintenance" → sets `equipment.status = 'maintenance_required'`
  - "Report damaged" → sets status + flags as needing assessment
  - "Misplaced/lost" → leaves status alone, creates an audit log entry
- Optional: photo + note fields to attach to the maintenance flag

**Notification:** when field staff tags equipment, shop staff get an actionable notification ("Equipment X tagged for maintenance by Carlos at 3:42 PM").

### Mobile partial-fill for equipment requests (shop staff)

**Mobile screen:** Pick Equipment Request

- List open requests (already exists in shop UI on web)
- Pick one → see line items
- For each line item: scan barcode of the equipment being assigned to the request
- Mark line item as filled with that specific barcode-tied equipment
- Repeat for each item; partial-fill is the natural state during picking
- "Done picking" button updates request status: filled if all complete, partially_filled otherwise

This needs the shop_staff role to have mobile access — currently mobile is field-staff-only. Adding a second mobile-capable role is straightforward (the role config already supports it).

## Open design questions

1. **Should field staff have to pick a project when tagging equipment?** Currently equipment has `current_project_id` so the system knows where it's checked out to. If the foreman tagging it isn't on that project, do we trust them or require confirmation?

2. **What happens to equipment_request_lines when a partial fill is done?** Today the line probably just has a fulfilled boolean. For partial fill we need to track which barcode was assigned — already supported by `assigned_equipment_id`, just need the mobile UI.

3. **Photos for maintenance tags — required, optional, or absent entirely?** A photo is the difference between "this needs a look" and "this is clearly broken, here's the visible damage." Probably optional with a "tip: a photo helps shop staff prioritize" prompt.

## Implementation notes

- The mobile app uses React Native + expo-barcode-scanner. Both screens use existing scanner integration.
- Backend endpoints: `PATCH /equipment/:id/status` already exists for web; needs a mobile-friendly variant that accepts a barcode lookup AND a status update in one request.
- Push notifications to shop staff need to be wired (or fall back to in-app since shop staff is on mobile too in this flow).

## Why this is deferred

Both features are real friction points but neither is blocking the deployment. The current workflow (call shop → shop updates web) works, just slowly. Field staff scanning equipment status is a quality-of-life improvement, not a foundational feature. Pat's deployment timeline is "ship the platform, then iterate based on what the firm actually finds annoying." This is a likely candidate for what they'll find annoying.

## Effort estimate

- Mobile equipment status tagging: 1 week (1 screen, 1 endpoint, push wiring)
- Mobile partial-fill: 1 week (1 screen, role permission expansion, line-item tracking)
- Plus 1 week for testing on real devices, iterating with the shop crew

Total: 2–3 weeks of focused work. Could be done as one feature drop or split into two.

---

*Update this document when implementation begins.*
