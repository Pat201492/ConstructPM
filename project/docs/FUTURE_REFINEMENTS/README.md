# Future Refinements

This folder holds planning notes for features that are **deferred but committed** — things that have been discussed, designed at a high level, and slated for future work, but aren't part of the current build.

## Terminology — important to use precisely

This codebase deals with three layered relationships and these terms must be used precisely throughout the docs:

- **Firm** — the contracting company running the platform. Pat's client. There is one firm per deployment of ConstructPM. ("the firm" = "your client")
- **Customer** — the firm's clients. The people who hire the firm to do work. General contractors (Turner, Skanska), building owners, school districts, etc. Stored in the `customers` table.
- **Location** — physical jobsite where work happens. Has an address, town, state, local union, miles from HQ. Stored in the `locations` table. A location is bid-linked to a customer (a bid joins one customer with one location).

Hierarchy: Firm → Customer → Location → Bid → Project.

When writing future-refinement notes, never use "customer" loosely to mean "the firm." That collision is what the platform itself is trying to disambiguate, and the docs should match.

## What goes here vs. what doesn't

**Goes here:**
- Designed-out features waiting for the right moment to build (firm demand, prerequisite work, time)
- Architecture sketches with implementation phasing
- Open questions to resolve with the firm before building

**Does NOT go here:**
- General TODOs (use git issues, project board, or HANDOFF.md for those)
- Bugs (use git issues)
- Vague "we should do X someday" musings (those go in a personal notes file, not the project repo)

## Naming convention

`NN-short-name.md` — numbered in roughly the order the ideas came up, so the folder stays browseable. The numbering doesn't imply implementation priority; check each doc's `Priority` line for that.

## Current entries

| # | Title | Priority | Estimated Effort |
|---|---|---|---|
| 01 | Native mobile data entry with system-driven autofill | High once initial deployment stabilizes | 3–5 weeks |
| 02 | Location-based timezone for records (vs current author-based) | Medium — firm IS multi-timezone, but author-from-phone covers common case | 1–2 days |
| 03 | Mobile equipment management for field staff | Medium — friction point for shop ops | 2–3 weeks |
| 04 | AI training data capture for improved extraction accuracy | Medium — pays off after ~6 months of usage data | 1–2 weeks |
| 05 | Auto-file contract upload window + amount confirmation | Medium — touches the bid-won → project transition | 1 week |

## Adding a new entry

Each refinement note should follow the same rough structure:

1. **Status / Priority / Effort line** at the top
2. **The vision** — what the feature is, in plain language
3. **Core principle** — what idea drives the design
4. **What needs to be built** — backend, mobile, schema changes
5. **Tradeoffs** — design choices that need to be made before building
6. **Implementation phasing** — break the work into shippable chunks
7. **Open questions** — what to ask the firm when prioritizing

Keeping these consistent makes it easy to come back months later and pick up where the thinking left off.
