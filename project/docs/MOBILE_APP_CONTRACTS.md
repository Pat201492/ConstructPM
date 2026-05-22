# Mobile App — Data Contracts & Feature Spec

> The React Native / Expo mobile app is a **separate project**. This
> document is the authoritative spec for what the backend must expose
> and what the app must send/receive. The web platform implements the
> endpoints; the app consumes them.
>
> Source: Pat's spec, captured during the Equipment Tickets design
> session (May 2026). Last updated: 2026-05-16.

---

## 1. Equipment Data Entry (barcode-driven)

**Flow:** Mobile user scans a barcode → form appears → user fills
fields → submits → creates/updates a row in the equipment table
(same structure as the "Equipment ID table").

**Mandatory fields (app must block submit until all present):**
- Manufacturer Name
- Equipment Name
- Equipment Type

**Optional fields:**
- Cert Date
- Maintenance Date

**Notes:**
- The barcode value is the equipment's scan key.
- Same data structure as the canonical equipment record.
- This path is NOT the OCR handwriting path — it's structured input,
  so the cascading-dropdown helpers (type→name→manufacturer) should apply.

---

## 2. Active Ticket — Fill Flow

**Flow:** App shows an "Active Tickets" view = a list of cards. Tap a
card → see the list of equipment requested on that ticket. Hit **Fill
Order** → user scans equipment barcodes → app sends the scanned list
(equipment numbers + names) to the system.

- The scanned equipment list displays at the **bottom of the ticket**
  in the Active Tickets board (web).
- When the user hits **Mark as Filled**, the system **generates the
  ticket PDF** (named by ticket number, saved to the system folder).

**Edit ticket (mobile):**
- Two buttons: **Add** and **Remove**.
  - Add → appends equipment to the ticket's list.
  - Remove → removes equipment from the list.
- ANY edit (add or remove) marks the ticket **unpicked**.
- User must **confirm picked again**, which **regenerates the PDF**,
  overwriting the previous copy.

**Payload (app → system):**
- ticket_number
- list of { equipment_id / equipment_number, equipment_name }
- action: fill | add | remove | confirm_picked

---

## 3. Return to Shop

**Flow:** App has a **Return to Shop** button → user scans a barcode →
system updates that equipment's row in the Equipment ID table:
- `location` → `shop`
- `status_change_date` → current system date

**Payload (app → system):**
- equipment barcode / equipment_number
- action: return_to_shop

---

## 4. Equipment Maintenance (mobile)

**Flow:** App has an **Equipment Maintenance** tab. User scans a piece
of equipment → app brings up the **maintenance table for that specific
equipment** + an **Add Entry** button.

- The UI must **display the EquipNum** so the user can scan the
  equipment and read the number off the screen for confirmation.
- Add Entry → new maintenance record row:
  - Date of Service → defaults to system date (editable)
  - Entered-by name → defaults to current mobile user (editable)
  - Cert Date → copied from the most recent prior entry (editable)
  - Notes
  - Flag → red / yellow / none

**Payload (app → system):**
- equipment_number
- date_of_service, entered_by_name, cert_date, notes, flag

---

## 5. UI Conventions (mobile)

- Add/Remove and similar binary actions use the **two-button toggle**
  pattern (explicit taps, no hover menus).
- Cascading selection lists (equipment name / type / manufacturer / id)
  must show a **scroll-capped window** — list does not extend forever;
  user scrolls within a fixed-height container.
- Quantity defaults to **1** when a new request line is created;
  quantity input sits on the **far left** of the line.

---

## 6. Endpoints the Backend Must Expose (for the app)

> IMPLEMENTED. Final paths below. The app is a separate project; these
> are the live contract surface as of Phase 4 (2026-05-17).

| Purpose | Method + Path | Notes |
|---|---|---|
| Equipment barcode entry | `POST /api/equipment/mobile/entry` | Mandatory: barcode_id, manufacturer, equipment_name, equipment_type. Optional: certification_date. Updates if barcode exists, else creates. Server-enforces mandatory fields. |
| Barcode lookup | `GET /api/equipment/barcode/:code` | Full equipment record + history + docs |
| Return to shop (scan) | `POST /api/equipment/mobile/return` | Body `{barcode_id}`. Unconditional → location='shop', current_project_id=null, status_change_date=today |
| Maintenance lookup (scan) | `GET /api/equipment/mobile/maintenance/:code` | Returns equipment (incl. EquipNum/barcode_id for display) + its maintenance records |
| Add maintenance entry | `POST /api/equipment/:id/maintenance-records` | date→today default, name→current user default (editable), cert copied from last entry client-side, flag |
| List active tickets | `GET /api/equipment-tickets/active` | Cards: ticket#, project#, total qty, lines, filled list |
| Ticket detail | `GET /api/equipment-tickets/:ticketNumber` | Full ticket for expanded view |
| Fill ticket (scan list) | `POST /api/equipment-tickets/:ticketNumber/fill` | Body `{items:[{equipment_number,equipment_name}]}`. Appends scanned list, status→filled |
| Edit ticket lines | `PATCH /api/equipment-tickets/:ticketNumber/lines` | Body `{lines:[...]}`. Replaces lines, status→open (unpicks) |
| Confirm picked (reconfirm) | `POST /api/equipment-tickets/:ticketNumber/confirm-picked` | Regenerates PDF (overwrites prior copy), status→filled. Does NOT archive |
| Mark picked up (final) | `POST /api/equipment-tickets/:ticketNumber/pickup` | Equipment→project location, status_change_date, archive row, PDF, deletes live rows |
| Create ticket | `POST /api/equipment-tickets` | Web request form or mobile. Lines + project/contact header |
| Archived tickets | `GET /api/equipment-tickets/archive/all` | Permanent record list |

---

## 7. Cross-References

- Equipment Tickets web spec, schema, and rollup rules: see the main
  design notes / `PROJECT_REFERENCE` once the Equipment Tickets feature
  is built.
- Ticket archival: live `ticket_equipment` + `ticket_project` rows are
  deleted after fill/pickup; an archive row (ticket #, filled_date,
  picked_up_date, pickup_person, filler) + a generated PDF (named by
  ticket #) are the permanent record.
- Equipment rollups: `equipment.cert_date` = furthest-future cert from
  maintenance records (else nearest-to-today if none future);
  `equipment.service_date` = most recent date_of_service; equipment
  flag = most recent maintenance flag.
