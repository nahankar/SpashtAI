# Signup and sign-in policy

Platform Admin → Users → **Sign-in and email policy** controls Google and email-code sign-in for non-tenant SpashtAI. Platform Admin → Workspaces → create/select an organization and tenant Admin → Workspace settings expose independent tenant controls. Both switches default on. At least one method must stay enabled; validation and database constraints enforce this.

Tenant **Allowed email domains for new Learners** is optional (empty means any domain), accepts up to 20 exact domains, normalized to lowercase, e.g. `klsvdit.edu.in`. Subdomains require separate entries. Existing memberships, including pending memberships, are grandfathered; new Owners and Admins are exempt. A previously sent invitation with no membership is checked against the current rule when resent or accepted. Deletion and re-enrollment are new membership and therefore checked again. Emails remain immutable in the Profile editor.

Domain restrictions do not create public tenant signup. New tenant users still need an invitation. The single-use emailed invitation verifies the address at first acceptance and does not require another code or Google sign-in. After joining, the selected tenant sign-in methods apply. A consumed invitation cannot be reused as a sign-in credential.

Tenant sign-in links use `/auth/login?next=/w/<slug>`. The page obtains public tenant branding/methods; Google/email verification carries `workspaceSlug`. The server requires an existing active/pending membership for this context, so supplying an arbitrary tenant cannot bypass the main-site signup policy. Generic sign-in resolves a tenant-only account's active/pending organizations instead of using the main-site switch. Multiple organizations may allow different methods: identity sign-in may use a method allowed by any active organization, while entry into each organization requires its own allowed method.

Identity tokens record `authMethod`, which is copied into workspace entry tokens and checked when entering/renewing and on tenant administration requests. Existing identity tokens without a method must reauthenticate when the tenant restricts either method. Current product sessions retain their existing short-lived authorization until workspace renewal; settings do not interrupt an in-progress voice session. Invitation-authenticated initial sessions remain usable until the normal identity expiry. Production legacy password login/signup endpoints reject requests; users must use one of the two enabled methods. Local development walkthrough login is unchanged.

## API

- `GET /api/auth/sign-in-policy[?workspace=<slug>]`: public, no-store projection `{methods:{google,emailCode},workspace:null|{name,slug},learnerEmailDomains?:string[]}`; never returns users or members.
- `PUT /api/admin/platform/sign-in`: `{google:boolean,emailCode:boolean}`; requires Platform Admin; persists and audits atomically.
- Organization create/update accepts `accessPolicy:{methods:{google,emailCode},learnerEmailDomains:string[]}`.
- `PUT /api/workspaces/current/access-policy`: same access policy object; requires tenant Owner/Admin, serializes on the tenant row, audits the change.
- Disabled methods return `SIGN_IN_METHOD_DISABLED`; unauthorized tenant sign-in context returns `INVITATION_REQUIRED`; new Learner domain failures return `EMAIL_DOMAIN_NOT_ALLOWED`; workspace entry needing a different method returns HTTP 401 `SIGN_IN_REQUIRED`.

## Validation

Restricted-role local database tests cover exact domains, case normalization, existing-member preservation, manager exemptions, invitation and reacceptance rules, API policy enforcement, independent main/tenant choices, stale email challenges, forged tenant context, and all-disabled rejection. Provider/email delivery is simulated; tests never email real users. Browser checks exercise the built UI with simulated APIs.
