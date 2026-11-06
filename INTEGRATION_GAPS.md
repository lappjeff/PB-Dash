# Precise Builder integration gaps

What the official documentation at <https://app.precisebuilder.com/docs/> (REST API v1, webhook `api_version` `2026-10`, read on 2026-11-04) does **not** provide, and how this app handles each gap. Nothing here relies on undocumented endpoints or fields.

## Verification status

| Area | Status |
| --- | --- |
| REST client (`src/server/pb/client.ts`) | **Read-only check passed against the live account on 2026-11-06** (`pnpm sync:check`): every endpoint the sync uses answered, and responses matched the documented schemas after the fix in REST gap 18. A full import (`pnpm sync:full`) hasn't been run yet. |
| Webhook signature check | Verified against the official test vector on the "Verifying signatures" page (`tests/webhooks.test.ts`). |
| Webhook delivery from PB | **Not tested end to end.** PB only delivers to a public `https://` URL, so this needs a deployment. Use **Send Test** (a `webhook.ping`) after registering the endpoint. |
| Vercel deployment | **Not done.** It needs your Vercel, Neon and Clerk accounts. |

## REST API gaps

1. **No "updated at" timestamp** on opportunities or customers, and **no updated-since filter** on the list endpoints.
   - True incremental polling isn't possible. Webhooks carry incremental changes. Hourly reconciliation re-reads every open (`status=pending`) opportunity, and fetches opportunities that are open locally but no longer open in PB one at a time. A daily full pass re-reads everything.
   - "Last change" in the UI is the **last change this app observed** (`last_changed_at`). It stays empty ("Not observed") until a change is seen after the initial import. The app never presents import time as the PB update time.
   - The spec's `pb_updated_at` column is implemented as `last_pb_event_at`: the newest webhook `created_at` seen for the record.
2. **Activities can only be listed per opportunity** (`GET /opportunities/<id>/activities`, not paged). There is no account-wide activity list.
   - One call per opportunity. Activities are synced for **open** opportunities: all of them during a full pass, a rotating batch of 40 per hourly reconciliation, and immediately for the opportunity named in `activity.created` / `activity.completed` / `opportunity.created`.
   - Activity history for closed opportunities is only as complete as what was synced while they were open.
3. **Activities have no created timestamp.** `pb_created_at` is filled only from the `activity.created` webhook envelope, so it's null for imported activities.
4. **Activities are assigned to *users* (`GET /users`), not sales reps (`GET /sales-reps`).** The docs don't say whether the ids match.
   - Users are matched to sales reps by identical, unique, case-insensitive name during each lookup sync. Admins can correct the match under **Settings → Activity assignment mapping**. Unmapped activities still count toward the opportunity owner's overdue/follow-up rules, because those rules key off the opportunity's sales rep.
5. **`GET /sales-reps` lists only *current* employees with the Sales Rep role.** Former reps who still own opportunities are created from the embedded `sales_rep {id,name}` and marked inactive.
6. **Opportunity name.** REST has `description` ("the name people see") and `number`. Webhook payloads also carry a `name` field (e.g. "Smith Kitchen Remodel") that the REST schema doesn't list. The app uses `description` (and falls back to `Job <number>`).
7. **`revenue` is "expected value of the sale".** There is no contracted, invoiced or final amount. Won metrics are labeled **Won Sales**, not revenue in the accounting sense. A null `revenue` stays null: it's excluded from sums and averages, and the UI says how many were excluded.
8. **`closed_at`** is "when it was won or lost". Behavior when a deal is reopened (moved back to a pending stage) isn't documented. The app takes whatever PB returns.
9. **`created_date` is a date, not a timestamp**, with no documented time zone. It's treated as a company-local date (`COMPANY_TIMEZONE`).
10. **`archived` semantics aren't documented.** PB list endpoints exclude archived records by default. The app imports them (`include_archived=true`), always excludes them from open pipeline, and excludes them from won/lost unless an admin turns on **Include archived** in Settings.
11. **Lead source lives on the customer**, not the opportunity. Lead-source reports use the customer's current lead source.
12. **Deletions aren't announced** (there's no delete event). An opportunity or customer is flagged `pb_missing_at` when a single-record GET returns 404 or a complete full pass no longer returns it. Flagged records are excluded from metrics but kept for history.
13. **Whether `GET /opportunities/<id>` returns archived records** isn't documented. A 404 is treated as "missing" (see 12).
14. **Rate limits aren't documented.** The client makes sequential requests, uses the documented page maximum (`limit=500`), times out after 20s, and retries 5xx, 409 and 429 responses with backoff (honoring `Retry-After`). 401/403 aren't retried.
15. **The API key is account-wide, can write, and there is one key per account.** This app only issues `GET` requests. Generating a new key in PB immediately breaks the old one, so update `PRECISE_BUILDER_API_KEY` at the same time.
16. **No documented web deep-link format** for opportunities. The detail page shows the job number instead of linking into PB.
17. **Sales stages** have `status` only in `GET /sales-stages`. Stages seen only embedded in an opportunity are stored with a null status and no position.
18. **Found on the live account (2026-11-06):**
   - `GET /users` returns some users with `name: null` (3 of 14). The docs list `name` as a string. The app accepts null and leaves those users out of the automatic name match with sales reps.
   - Opportunities include a `status` field that the docs don't list. The app ignores it and keeps deriving open/won/lost from the sales stage's documented `status`.

## Webhook gaps

1. **Stage history exists only from the go-live date.** `opportunity.stage_updated` carries `stage` and `previous_stage`, which are recorded as exact transitions. Nothing before go-live is reconstructed, and the initial import creates no transitions.
   - Stage changes found only by reconciliation (for example while the endpoint was disabled) are stored as `source = reconciliation`. Their time is when the change was detected, and the UI labels it approximate. If the webhook arrives later, it replaces the inferred record.
   - Stage aging uses only verified (webhook) entries. Otherwise it shows **Unknown**.
2. **Payloads describe the record at event time**, and retries resend the same payload. The processor always re-fetches the current record from REST, and an older fetch never overwrites a newer one.
3. **Events while an endpoint is disabled are never sent** (per the docs). Reconciliation and the daily full pass catch the resulting state changes, but not the exact transition times.
4. **Redelivery from PB's send log creates a new envelope `id`.** Deduplication is on the envelope id, so a redelivered event is processed again. That's harmless: processing is idempotent and current state comes from REST. A stage transition from a redelivery would be recorded twice with the same timestamp. This is rare and visible in the timeline.
5. **No delete events, and no event for lost-reason or revenue changes specifically.** `job.updated` covers edits to opportunities and jobs.
6. **`activity.*` payloads give the assignee as a name string (`assigned_to`)**, not an id. The processor ignores it and re-reads the opportunity's activities over REST.
7. **The webhook endpoint and its secret are managed in the PB UI**, not through the API, so registration is manual (see README).
8. **Payload retention.** Payloads contain customer contact details. PB keeps them for 14 days. This app clears stored payloads 30 days after processing (`prunePayloads`, run by reconciliation).
9. **`invoice.created`, `vendor.*`** are stored and marked `ignored`. They're kept for future job-cost work.

## Not used / out of scope

- `GET /api/v1/schedule` (job schedule). Not needed for the MVP; the client can add it for future calendar features.
- All write endpoints (`POST`/`PATCH`). The app is read-only toward PB.
- Zapier.
