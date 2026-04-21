-- Tenant color override feature: each org can pick a primary and secondary color
-- in admin branding. When set, these override the default palette CSS custom
-- properties (--color-primary / --color-secondary) on tenant subdomains only.
--
-- These columns are separate from the legacy brandColor / brandAccentColor
-- fields (which back the --brand-primary / --brand-accent tokens used by
-- existing header/logo chrome). primaryColor / secondaryColor drive the new
-- palette tokens set up in app.css @theme.
--
-- Both columns are nullable: NULL means "use the default palette value".
-- Values are stored as upper-case hex strings like "#3D6B9A". The server
-- validates /^#[0-9a-fA-F]{6}$/ before writing and before injecting the
-- override into the <style> tag at the document root.
ALTER TABLE "Org" ADD COLUMN "primaryColor" TEXT;
ALTER TABLE "Org" ADD COLUMN "secondaryColor" TEXT;
