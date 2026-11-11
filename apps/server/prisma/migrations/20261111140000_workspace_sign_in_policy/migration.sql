ALTER TABLE "Workspace"
 ADD COLUMN "googleSignInEnabled" BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN "emailCodeSignInEnabled" BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN "learnerEmailDomains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 ADD CONSTRAINT "Workspace_sign_in_method_required" CHECK ("googleSignInEnabled" OR "emailCodeSignInEnabled");
ALTER TABLE "PlatformSettings"
 ADD COLUMN "googleSignInEnabled" BOOLEAN NOT NULL DEFAULT true,
 ADD COLUMN "emailCodeSignInEnabled" BOOLEAN NOT NULL DEFAULT true,
 ADD CONSTRAINT "Platform_sign_in_method_required" CHECK ("googleSignInEnabled" OR "emailCodeSignInEnabled");
-- Public, bounded projection for the sign-in page before an identity is available.
-- No caller-controlled SQL or membership/user columns are exposed.
CREATE FUNCTION public.workspace_sign_in_policy(requested_slug TEXT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET row_security = off AS $$
 SELECT jsonb_build_object('methods', jsonb_build_object('google', "googleSignInEnabled", 'emailCode', "emailCodeSignInEnabled"),
   'workspace', jsonb_build_object('name', name, 'slug', slug), 'learnerEmailDomains', to_jsonb("learnerEmailDomains"))
 FROM public."Workspace" WHERE slug = requested_slug AND kind = 'ORGANIZATION' AND state = 'ACTIVE'
 LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.workspace_sign_in_policy(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.workspace_sign_in_policy(TEXT) TO PUBLIC;
