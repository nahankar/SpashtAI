# Google Sign-In — Production Setup for spasht.ai

SpashtAI uses **Google Identity Services (GIS)** — a sign-in button that returns an ID token. No OAuth redirect/callback URL is required.

See also: [EC2 production](./EC2-PRODUCTION.md) for host setup (Cloudflare SSL, PM2, Nginx).

## Prerequisites

- Domain **spasht.ai** live with HTTPS
- Canonical URL chosen: `https://spasht.ai` (recommended) or `https://www.spasht.ai`
- Support email: **info@spasht.ai**

---

## Step 1 — Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project (e.g. `spashtai-prod`) or select an existing one
3. Enable **Google Identity Services** / OAuth (usually enabled by default when creating OAuth credentials)

## Step 2 — OAuth consent screen

1. **APIs & Services → OAuth consent screen**
2. User type: **External** (for public users)
3. Fill in:
   - App name: `SpashtAI`
   - User support email: `info@spasht.ai`
   - Developer contact: `info@spasht.ai`
   - App logo (optional)
   - App domain: `spasht.ai`
   - Authorized domains: `spasht.ai`
4. Scopes: keep defaults — `openid`, `email`, `profile`
5. **Publish** the app when ready (Testing mode only allows listed test users)

## Step 3 — Create Web Client ID

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**
2. Application type: **Web application**
3. Name: `SpashtAI Web`
4. **Authorized JavaScript origins** (add all that apply):
   ```
   https://spasht.ai
   https://www.spasht.ai
   http://localhost:5173
   ```
5. **Authorized redirect URIs**: leave empty (GIS button flow does not use redirects)
6. Copy the **Client ID** (ends with `.apps.googleusercontent.com`)

> You do **not** need `GOOGLE_CLIENT_SECRET` for this flow.

## Step 4 — Server environment

In production `apps/server/.env`:

```env
GOOGLE_CLIENT_ID=<paste-client-id>
FRONTEND_URL=https://spasht.ai
JWT_SECRET=<long-random-secret-min-32-chars>
DATABASE_URL=postgresql://...
```

Rebuild and deploy the server:

```bash
cd apps/server && npm run build
```

## Step 5 — Frontend environment (build-time)

Set these in your CI/hosting **before** `npm run build`:

```env
VITE_GOOGLE_CLIENT_ID=<same-client-id-as-server>
VITE_API_BASE_URL=https://api.spasht.ai
```

Rebuild and deploy the web app. Env vars are baked in at build time.

## Step 6 — DNS & CORS

- Point `spasht.ai` → frontend (Vercel/CloudFront/etc.)
- Point `api.spasht.ai` → API server
- `FRONTEND_URL` must match the exact origin users visit (scheme + host, no trailing slash)
- Redirect `www` → apex (or vice versa) and add both origins in Google Console if both are used

## Step 7 — Database

Ensure production DB has Google auth columns:

```bash
cd apps/server && npx prisma migrate deploy
# or: npx prisma db push
```

Required: `googleId`, optional `passwordHash`, profile fields.

## Step 8 — Verify

| Test | Expected |
|------|----------|
| Login page shows Google button (not "not configured") | `VITE_GOOGLE_CLIENT_ID` set at build |
| New Google user | Redirect to `/auth/complete-profile` |
| After profile completion | Access to app |
| Returning Google user | Direct login |
| Email user with same email | Google links account |
| Browser console | No GIS/CORS errors |

## Troubleshooting

| Error | Fix |
|-------|-----|
| `origin_mismatch` | Add exact origin to Google Console JS origins |
| Button disabled "not configured" | Rebuild web with `VITE_GOOGLE_CLIENT_ID` |
| `Invalid token` on server | Client ID mismatch between web and server |
| CORS errors | Set `FRONTEND_URL` to match browser URL |

## Optional follow-ups

- Add terms acceptance on Google sign-up / complete-profile
- Use `info@spasht.ai` for SMTP `SMTP_FROM` for password reset emails
- Add Google Search Console verification for `spasht.ai`
