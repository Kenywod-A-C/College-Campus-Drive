# API conventions (v1)

Shared by the Flask backend (`backend/`) and the real HTTP services in the frontend (`src/services/`).
Base path `/api/v1`. JSON, **camelCase** keys, **string IDs** (the database uses integer keys; they are serialised as strings).

## Envelopes
Success: `{ "data": <payload> }`
Paginated: `{ "data": [ ... ], "meta": { "page": 1, "pageSize": 10, "total": 42, "totalPages": 5 } }`
  - Endpoints that also return extra list-level values put them in `meta` (e.g. `meta.industries`).
Error: `{ "error": { "code": "<code>", "message": "<human readable>", "details": { "<field>": ["<msg>"] } } }`

| HTTP | code | meaning |
|---|---|---|
| 400 | bad_request | malformed request |
| 401 | unauthenticated | missing/expired/invalid token or bad credentials |
| 403 | forbidden | authenticated but not permitted (permission, role or record ownership) |
| 404 | not_found | unknown id (also used when hiding existence is safer) |
| 409 | conflict | state conflict (duplicate, closed job, policy limit …) |
| 422 | validation_error | body/query failed validation; `details` has per-field messages |
| 429 | rate_limited | too many attempts |
| 500 | server_error | unexpected; no internals are leaked |

## Pagination / filtering
Query params `page` (1-based, default 1) and `pageSize` (default per endpoint, max 100). Filters are plain query params in camelCase (`q`, `dept`, `minCgpa`, `tab`, `sort`, `status`, `companyId`, ...). Unknown or invalid values return 422.

## Authentication
- `POST /auth/login` returns a short-lived **access token** (JWT, 15 min) in the JSON body. The client keeps it **in memory only** and sends `Authorization: Bearer <token>`.
- It also sets a **refresh token** as an `httpOnly` cookie (path `/api/v1/auth`, `SameSite` configurable, `Secure` in production) plus a script-readable `csrf_refresh_token` cookie (path `/`, because `document.cookie` only exposes cookies matching the *page* path). `POST /auth/refresh` and `POST /auth/logout` must send that value in the `X-CSRF-TOKEN` header (double-submit). The refresh cookie is read explicitly, so the call works even when an `Authorization` header is also sent. Refresh tokens rotate on every use and the old one is revoked; they also die when the password changes or the account is deactivated. `logout` always clears the cookies but only revokes the token when the CSRF header is valid.
- On page load the client calls `POST /auth/refresh` to restore the session (skipped when no CSRF cookie exists, i.e. there is no session), then uses `/auth/me`.
- Authorisation is always decided server-side from the database (user active, role, permissions, record ownership). JWT claims are never trusted for permissions.

## Endpoints implemented in the first backend milestone
Payload types are the TypeScript types in `src/types` (`User`, `Student`, `JobView`, `ApplicationView`, ...). Anything not listed answers **501 not_implemented** from the real frontend service (it is only available with `VITE_USE_MOCK=true`).

| Method | Path | Body / query | `data` |
|---|---|---|---|
| POST | /auth/login | `{identifier,password,remember}` | `{user,permissions,accessToken,expiresIn}` |
| POST | /auth/refresh | cookie + CSRF header | `{user,permissions,accessToken,expiresIn}` |
| POST | /auth/logout | cookie + CSRF header | `{ok:true}` |
| GET | /auth/me | | `{user,permissions}` |
| POST | /auth/change-password | `{currentPassword,newPassword}` | `{ok:true}` |
| POST | /auth/forgot-password | `{email}` | `{message}` (always the same message) |
| POST | /auth/reset-password | `{token,password}` | `{ok:true}` |
| GET | /reference/filters | | `{graduationYears,departments,companies,jobs}` |
| GET | /student/profile | | `Student` |
| PATCH | /student/profile | `ProfilePatch` | `Student` |
| POST | /student/onboarding | onboarding fields | `User` |
| GET | /student/dashboard | | student dashboard (see `studentApi.dashboard`) |
| GET | /jobs | `JobQuery` | `JobView[]` + meta |
| GET | /jobs/:id | | `JobView` |
| POST | /jobs/:id/save | | `{saved}` |
| POST | /applications | `{jobId}` | `ApplicationView` |
| GET | /applications/me | `status,q,page,pageSize` | `ApplicationView[]` + meta |
| GET | /applications/:id | | `ApplicationDetail` |
| POST | /applications/:id/withdraw | | `ApplicationView` |
| GET | /offers/me | | `OfferView[]` |
| GET | /offers/policies | | policy summary list |
| POST | /offers/:id/respond | `{decision:'accepted'\|'declined'}` | `OfferView` |
| GET | /notifications | | `AppNotification[]` |
| POST | /notifications/:id/read | | `AppNotification` |
| POST | /notifications/read-all | | `{ok:true}` |
| GET / PUT | /notifications/preferences | `NotificationPrefs` | `NotificationPrefs` |
| GET | /reminders | | `{reminder,jobTitle,companyName}[]` |
| POST / PUT | /reminders, /reminders/:id | `{title,at,jobId?,kind?}` | `Reminder` |
| POST | /reminders/:id/toggle | | `Reminder` |
| DELETE | /reminders/:id | | `{ok:true}` |
| GET | /companies | `q,industry,tier,page,pageSize` | `{company,jobCount,activeJobs,offers}[]` + meta (`meta.industries`) |
| GET | /companies/:id | | `{company,jobs,interviews}` |
| POST / PUT | /companies, /companies/:id | `CompanyInput` | `Company` |
| GET | /students, /students/:id | `StudentQuery` | student directory (`students.view`); detail views are audited, phones masked except for admins |
| POST | /students/:id/verify-cgpa | `{cgpa?}` | `StudentRow` (`students.edit`) |
| POST / PUT | /jobs, /jobs/:id | `JobInput` (`status`: `draft`\|`published`) | `Job` (`jobs.create`; publishing also needs `drives.publish`); one transaction |
| POST | /jobs/:id/status | `{status, reason?}` | `Job` (`drives.publish`): publish / unpublish / close / reopen / cancel, validated state machine |
| POST | /jobs/:id/archive | `{archived: true\|false}` | `Job` (`drives.publish`) soft archive; `GET /jobs?archived=exclude\|include\|only` |
| GET | /jobs/:id/drive | | drive details: counts per stage, eligible-student count, interviews, documents (aggregates only) |
| POST | /companies/:id/archive | `{archived}` | `Company` (`companies.manage`); refused while it has published jobs |
| GET | /faculty/dashboard | `dept,graduationYear,companyId,days` | see `reportsApi.facultyDashboard` |
| GET | /admin/dashboard | | see `adminApi.dashboard` |

## Endpoints added for faculty and administrators
All are authorised server-side on every request (permission or role re-read from the database); lists are paginated (`page`, `pageSize` ≤ 100) with camelCase filters; unknown fields and values are 422.

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | /applications | `applications.review` | `q,status,companyId,jobId,dept,eligibility,sort(recent\|cgpa\|name)` → `ApplicationView[]` + meta |
| POST | /applications/stage | `applications.review` | `{ids[1..100],status:shortlisted\|interview\|selected\|rejected,note?,exception?{reason,approvedBy}}` → `{updated:[id],failed:[{id,reason}]}` |
| GET | /applications/export | `reports.view` + `applications.review` | CSV text in `data`; audited |
| GET / POST | /interviews | students: own rounds · staff: `applications.review` | `{jobId,applicationIds,round,at,durationMins,location}` → `InterviewView` |
| PUT | /interviews/:id | `applications.review` | scheduled interviews only |
| POST | /interviews/:id/status, /notify | `applications.review` | `{status:scheduled\|completed\|cancelled\|no_show}`; notify → `{notified}` |
| GET | /offers | `offers.manage` | rows + `meta.{byDept,byCompany,totals,selectedWithoutOffer}` |
| POST | /offers | `offers.manage` | `{applicationId,ctcLpa,acceptBy}`; 409 on policy failure |
| POST | /offers/:id/status | `offers.manage` | `{status:received\|accepted\|declined\|withdrawn,reason?}` |
| GET / POST | /users | `users.manage` | `q,role,status,dept`; create → status `invited` |
| PUT | /users/:id | `users.manage` | admin accounts additionally need the administrator role |
| POST | /users/:id/status, /reset-password, /users/import | `users.manage` | `{status:active\|inactive}`; import `{rows[≤500]}` → `{total,imported,errors[]}` |
| GET / PUT | /admin/roles, /admin/roles/:role/permissions/:perm | `roles.manage` (+ administrator role to edit) | `{enabled}` → permission keys of the role |
| GET / POST / PUT / DELETE | /admin/policies[/:id] | `policies.manage` | DELETE body `{reason}` |
| GET | /admin/academic | administrator | departments (+counts), courses, academic years |
| POST / PUT / DELETE | /admin/departments, /admin/courses, /admin/academic-years | administrator | 409 when a department is still in use |
| GET | /admin/audit-logs | `audit.view` | `actor,action,resource,result,from,to` + `meta.actions` |
| GET | /reports/placement, /reports/placement/export.csv | `reports.view` | `academicYear,dept,companyId,jobId,appStatus,offerStatus`; aggregates / audited CSV |

## AI assistant endpoints
Every route needs a signed-in active user; conversations and actions are scoped to that user (another user's id is `404`, and the attempt is audited). The server derives identity, role and permissions; the body never carries them (`extra` fields are `422`).

| Method | Path | Body | `data` |
|---|---|---|---|
| GET | /assistant/status | | `{available, provider, model?, reason?}` (never a key). `available:false` = no credentials configured |
| GET | /assistant/suggestions | | `string[]` for the caller's role/permissions |
| GET | /assistant/conversations | | `{id,title,updatedAt,count}[]`, own, newest first |
| POST | /assistant/conversations | | `Conversation` (empty), `201` |
| GET | /assistant/conversations/:id | | `Conversation` (`messages[]` with `jobIds?`, `sources?[{documentId,title,page,snippet}]`, `charts?[{title,subtitle?,type,types[],labels[],series[{name,values[]}],unit?}]` (server-computed aggregates), `reports?[{title,subtitle?,generatedAt,kpis[{label,value}],sections[{heading,note?,table?{columns,rows},chart?}],truncated?}]` (server-built), `tools?[{tool,args,status}]`, `action?`) |
| DELETE | /assistant/conversations/:id | | `{ok:true}`: archives (retention purge later) and cancels pending actions |
| POST | /assistant/chat | `{conversationId?, message}` (≤ `ASSISTANT_MAX_INPUT_CHARS`) | the updated `Conversation` (a new one if no id). Per-user rate limit (`429`); `503 assistant_unavailable`, `504 assistant_timeout`, `502 assistant_upstream_error`: nothing is saved, retry |
| POST | /assistant/actions/:id/confirm | | `PendingAction` (`kind` includes `user_create|user_update|user_status|student_import|company_save|company_archive|policy_save|policy_delete|verify_cgpa`; `destructive: true` for deactivate/archive/delete): `confirmed` only after the service call committed; `failed` + `resultMessage` when the rules refuse it now. `409` if already handled/expired |
| POST | /assistant/actions/:id/reject | | `PendingAction` (`cancelled`) |
