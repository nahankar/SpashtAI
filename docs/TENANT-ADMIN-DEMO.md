# Tenant Admin demo

A presentation preview of what a tenant administrator would see, inside the existing platform Admin panel.
Full multi-tenancy is out of scope.

## What it is (and is not)

- A toggle labelled **Tenant Admin demo** at the top of the Admin sidebar. Default **off**.
- Only an already authorized platform Admin / Super Admin can reach it (it lives under the protected `/admin`
  routes). It grants no permission, changes no role, creates no `TENANT_ADMIN` role and provides **no tenant
  isolation**. Every API call still runs as the signed-in platform Admin, with the same server authorization.
- The setting is local to the current browser tab (`sessionStorage`), tied to the signed-in user, and cleared on
  logout. It is never a platform setting.

## Navigation when on

- **Overview:** Dashboard, Users, Invitations
- **Analytics:** Feature Usage, Progress Pulse, AI Analytics, UX Analytics
- Hidden: Feedback and all **System** and **Administration** items. Opening a hidden section (via the toggle while
  it is open, or by URL) returns to the demo Dashboard with a notice. Turning the demo off restores the normal
  navigation and pages.
- A "Tenant Admin demo" banner is shown on every page, and the sidebar title reads "Tenant Admin (demo)".

## Data

- Overview pages default to **Sample data**: fictional, labelled learners and invitations on `example.com`
  (`apps/web/src/lib/tenantDemoSample.ts`). Resend/Revoke are disabled on sample rows.
- **Live platform data** can be chosen in the banner for internal walkthroughs; it is labelled as platform-wide
  and must not be presented as a customer's data.
- Analytics pages show the existing platform-wide aggregates (with existing small-cohort suppression) under a
  banner saying so. Individual learner selection is off in the demo, and a `learner` URL parameter is removed.
- **Invite user** is always real: it uses the normal invitation service (see `INVITATIONS.md`) as the signed-in
  Admin, and the dialog says so.

## Demo pages

- **Dashboard:** learner count; Pending / Accepted / Expired / Revoked invitation counts; a Pending invitations
  table (recipient, invited date, expiry, delivery status) with Invite user, Resend, Revoke and View all
  invitations; an empty state when nothing is pending. Delivery status is separate from invitation status.
- **Users:** accepted users and pending invitees in separate lists; pending invitations are never counted as
  users. Platform settings (signups, rate limits, reward points) are not shown.
- **Invitations:** the normal searchable, paginated page with status filters.

## Before real tenant administrators

Every section above is platform-wide today. Once real tenancy exists, Dashboard counts, Users, Invitations and
each analytics page must be scoped to the active tenant (and cohort suppression applied per tenant) before any
real tenant administrator is given access. Real tenant administrators must never see platform-wide users,
invitations or analytics.
