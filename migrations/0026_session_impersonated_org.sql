-- Migration number: 0026 	 2026-04-25T23:55:55.259Z

-- Session.impersonatedOrgId: set when a district admin impersonates a
-- school. The per-request middleware honors this over User.orgId so the
-- existing tenant-extension scopes the request to the impersonated school.
ALTER TABLE "Session" ADD COLUMN "impersonatedOrgId" TEXT;
