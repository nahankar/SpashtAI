# Student traffic limits

Super Admin → Users → Student traffic limits controls the platform-wide general API and authentication limits. Existing defaults remain 100 requests per IP per minute and 5 authentication requests per IP per 15 minutes. Organizations share these settings; they are not tenant overrides.

Both request counts accept whole numbers from 1 to 1,000,000. Both windows accept whole minutes from 1 to 1,440. Zero does not disable protection. Students behind the same campus public IP share each allowance. Login traffic also consumes the general API allowance. Authentication includes Google login, email-code request/verification, registration and password recovery. Invitation lookup/acceptance and other endpoint-specific limits remain separate.

The migration `20261111130000_configurable_rate_limits` adds the settings with defaults and database bounds. Deploy the migration before the new API, then deploy the web build. Values persist across restarts. Saving applies them to the receiving API process immediately; other API processes refresh within 30 seconds. Each process still has its own in-memory request counters, as before. A shared counter store is required before treating these as aggregate limits across multiple API instances.

Changing only a request count preserves current counts. Changing a window clears that limiter's counts and starts a fresh window. Existing development/authentication bypass configuration and the separate authenticated-admin API bypass retain their behavior. Super Admin controls remain reachable through the existing general-limiter exemption, but still require authentication and the current database Super Admin role.

## API contract

`GET /api/admin/platform` includes `apiRateLimitMax`, `apiRateLimitWindowMinutes`, `authRateLimitMax`, and `authRateLimitWindowMinutes` in `settings`.

`PUT /api/admin/platform/rate-limit/settings` requires an identity bearer token and a current Super Admin database role. Submit all four numeric fields; unknown fields are rejected. A successful response is `{ "settings": ... }`. Invalid input returns 400; a non-Super Admin returns 403; persistence failure returns 500 without applying the new runtime settings. Settings and `platform.rate_limits_updated` audit metadata are written in one transaction.

Increasing these allowances does not add server capacity. Measure concurrent student sessions separately before increasing the voice allowance.
