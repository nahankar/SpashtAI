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

- **Sample data only.** Every demo page (Dashboard, Users, Invitations, Feature Usage, Progress Pulse,
  AI Analytics, UX Analytics) shows fictional, labelled "Sample Organization" data from
  `apps/web/src/lib/tenantDemoSample.ts` (`example.com` addresses). No platform users, invitations or
  analytics are loaded in the demo, and there is no live-data switch.
- AI Analytics shows example questions with canned aggregate answers: no question box, no saved queries and
  no individual learner results.
- Resend and Revoke are disabled on sample rows.
- **Invite user** is the one real action. It uses the normal invitation service as the signed-in Admin, and the
  dialog says it creates an actual platform invitation that appears on the platform Invitations page (demo off),
  not in the sample view.

## Demo pages

- **Dashboard:** sample learner figures; Pending / Accepted / Expired / Revoked invitation counts; a Pending
  invitations table (recipient, invited date, expiry, delivery status) with Invite user, View all invitations
  and an empty state. Delivery status is separate from invitation status.
- **Users:** sample accepted users and pending invitees in separate lists; pending invitations are never
  counted as users. Platform settings (signups, rate limits, reward points) are not shown.
- **Invitations:** the normal searchable, paginated page with status filters, over sample rows.
- **Analytics:** sample organization charts and tables for each of the four pages.

The normal (demo off) platform Dashboard has the same invitation section with real platform data.

## Before real tenant administrators

The demo shows sample data, but the real sections it previews (Dashboard counts, Users, Invitations and
analytics) are platform-wide today. Once real tenancy exists, each of them must be scoped to the active tenant (and cohort suppression applied per tenant) before any
real tenant administrator is given access. Real tenant administrators must never see platform-wide users,
invitations or analytics.
