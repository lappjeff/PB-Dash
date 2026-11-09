# Precise Builder API: documentation feedback

A running list of places where live API responses differ from the documentation at <https://app.precisebuilder.com/docs/>, and of questions the docs leave open. It's written to be sent to the Precise Builder team.

- **Docs version:** REST API v1 and webhook `api_version` `2026-10`, as published on 2026-11-06.
- **How the data was gathered:** read-only `GET` requests against one production account, with no writes.
- **What's left out:** account identifiers, names and customer data. Counts only.
- **How to reproduce:** `pnpm sync:check` in this repo ends with a field-by-field audit against the docs (`src/server/pb/audit.ts`). It prints field names and counts, never record contents.

Status values: **Open** (not yet reported), **Reported** (sent to PB, waiting), **Answered** (with the reply), **Fixed**.

## 1. Live responses that differ from the docs

| # | Seen | Endpoint | Docs say | Observed | Question for PB | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1.1 | 2026-11-06 | `GET /api/v1/users` | "Each entry has `id` and `name`." The list contains "Active users." | 3 of 14 users have `"name": null`. | Is a null name expected (for example an invited user who hasn't set up their profile, or a system user)? If so, please document `name` as nullable and say what these users are. Can activities be assigned to them? | Open |
| 1.2 | 2026-11-06 | `GET /api/v1/opportunities` (`include_archived=true`) | An opportunity without `sales_stage_id` "starts in the first stage of the pipeline", and its `status` "follows the stage". | 2 of 33 opportunities have `"sales_stage": null` with `"status": "pending"`. Both are archived. | When can `sales_stage` be null (for example when a stage is deleted, or on legacy records)? Where does `status` come from when there's no stage? Please document it as nullable. | Open |

## 2. Not documented (needed for a reliable integration)

### Fields and nullability

| # | Topic | Detail | Status |
| --- | --- | --- | --- |
| 2.1 | Nullability | Only `current_opportunity`, addresses, opportunity `completed_at` and activity `completed_at` are documented as possibly `null`. Fields seen as `null` on live data: customer `first_name`, `last_name`, `company`, `notes`, `lead_source`, `sales_rep`, `billing_address.address2`; opportunity `revenue`, `sales_rep`, `sales_stage` (1.2), `lost_reason`, `closed_at` (on pending), `notes`, `site_address.address2`, `site_address.state`; user `name` (1.1). A "can be null" column in each field table would settle it. | Open |
| 2.2 | Opportunity name | Webhook payloads include `opportunity.name` (e.g. "Smith Kitchen Remodel"). The REST opportunity has `description` ("the name people see") and `number`, but no `name`. How does `name` relate to `description`? | Open |
| 2.3 | `created_date` time zone | It's a date, not a timestamp. Is it in the account's local time zone? | Open |
| 2.4 | `closed_at` on reopen | If a won or lost opportunity moves back to a pending stage, is `closed_at` cleared or kept? If it's later closed again, is `closed_at` updated? | Open |
| 2.5 | `revenue` | "Expected value of the sale." Is there a contracted or final sale amount anywhere in the API once an opportunity is won? | Open |

### Change tracking and history

| # | Topic | Detail | Status |
| --- | --- | --- | --- |
| 2.6 | No `updated_at` | Customers, opportunities and activities have no last-modified timestamp, and the list endpoints have no `updated_since` filter. Integrations have to re-read everything to find changes. Request: add `updated_at` and an `updated_since` filter. | Open |
| 2.7 | Activities: no created time | Activities have no `created_at`. It's only available from the `activity.created` webhook envelope. | Open |
| 2.8 | Activities: per opportunity only | `GET /opportunities/<id>/activities` is the only way to read activities, so there's no account-wide list. Reading every activity takes one call per opportunity. | Open |
| 2.9 | No stage history | The API has no history of stage changes. It's only available from `opportunity.stage_updated` webhooks received from then on. Request: a stage history endpoint, or `stage_entered_at` on the opportunity. | Open |
| 2.10 | Deletions | There's no delete event and no documentation of what happens when a customer or opportunity is deleted (404 on GET? left out of lists?). | Open |

### People: users vs sales reps

| # | Topic | Detail | Status |
| --- | --- | --- | --- |
| 2.11 | Users vs sales reps | Activities are assigned to *users* (`/users`), but opportunities belong to *sales reps* (`/sales-reps`). Is the same person's id the same in both lists? If not, how do you link them? | Open |
| 2.12 | Former sales reps | `/sales-reps` lists only "current employees with the Sales Rep role". Opportunities still reference former reps through `sales_rep {id, name}`. Is there a way to list them, or to tell that a rep is inactive? | Open |
| 2.13 | Employee changes | Zapier has an "Updated Employee" trigger, but webhooks have no employee or user event. Is one planned? | Open |
| 2.14 | `activity.*` payloads | The webhook gives the assignee as `assigned_to` (a name string), but REST gives `assigned_user {id, name}`. Can the webhook include the user id? | Open |

### Invoices and vendors

| # | Topic | Detail | Status |
| --- | --- | --- | --- |
| 2.19 | No REST read for invoices or vendors | Both exist only as webhooks (`invoice.created`, `vendor.*`). Integrations can't import history or recover a missed event. Request: `GET /api/v1/invoices` (filterable by job and date) and `GET /api/v1/vendors`. | Open |
| 2.20 | No invoice lifecycle events | There's no `invoice.updated`, `invoice.voided` or `invoice.paid`, so `void` and amounts are only known as of creation, and payments aren't available at all. | Open |
| 2.21 | `invoice.type` values | The sample shows `"job"`; the other possible values aren't listed. Can `job` be null for non-job invoices? | Open |
| 2.22 | `invoice.total` | Is it before or after tax, and does it include retainage or credits? | Open |

### Archived records

| # | Topic | Detail | Status |
| --- | --- | --- | --- |
| 2.15 | Meaning | What does "archived" mean for an opportunity or customer, and can a record be unarchived? | Open |
| 2.16 | Single-record reads | Does `GET /opportunities/<id>` (and `/customers/<id>`) return archived records, or a 404? | Open |

### Operations

| # | Topic | Detail | Status |
| --- | --- | --- | --- |
| 2.17 | Rate limits | No rate limits are documented, and there's no mention of `429` or `Retry-After`. What are the limits, and how are they signalled? | Open |
| 2.18 | Deep links | There's no documented URL format for opening an opportunity or customer in the Precise Builder web app from another tool. | Open |

## 3. Confirmed to match the docs

These checks passed on 2026-11-06. They're listed so PB knows what has been verified.

- **Lookup lists:** `/sales-reps`, `/job-types`, `/lead-sources`, `/lost-reasons` and `/sales-stages` return exactly `id` and `name`, plus `status` on stages, with no extra fields.
- **Customers and opportunities:** list and single reads match the documented field tables, with no undocumented fields and no type mismatches. Dates are `yyyy-MM-dd` and timestamps are ISO 8601 with a time zone.
- **Status follows the stage:** every opportunity's `status` matches its stage's `status`.
- **Status filter:** `status=pending|won|lost` returns only that status.
- **`closed_at`:** it's set on every won or lost opportunity and on no pending one.
- **Activities:** they match the documented fields. Only 2 activities exist in the account, so this is a small sample.
- **`include_archived`:** the default excludes archived opportunities (31 without the parameter, 33 with it).
