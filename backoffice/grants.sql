-- Run as the database administrator after provisioning clubiq_backoffice.
-- Existing POS tables remain in public, identity and audit tables in backoffice.
GRANT CONNECT ON DATABASE vereinskasse TO clubiq_backoffice;
CREATE SCHEMA IF NOT EXISTS backoffice AUTHORIZATION clubiq_backoffice;
GRANT USAGE,CREATE ON SCHEMA backoffice TO clubiq_backoffice;
GRANT USAGE ON SCHEMA public TO clubiq_backoffice;
GRANT SELECT,INSERT,UPDATE ON public.configuration_state TO clubiq_backoffice;
GRANT SELECT(id,name,active) ON public.profiles TO clubiq_backoffice;
GRANT REFERENCES(id) ON public.profiles TO clubiq_backoffice;
GRANT SELECT(id,name,role,initials,active,invoice_email,invoice_email_consent_at) ON public.members TO clubiq_backoffice;
REVOKE UPDATE(invoice_email,invoice_email_consent_at) ON public.members FROM clubiq_backoffice;
GRANT INSERT(id,name,role,code,initials,active),UPDATE(name,initials) ON public.members TO clubiq_backoffice;
GRANT SELECT(id,profile_id,name,price,member_price,category,updated_at),UPDATE(name,price,member_price,category,updated_at) ON public.products TO clubiq_backoffice;
GRANT INSERT(id,profile_id,name,price,member_price,icon,category,color,updated_at) ON public.products TO clubiq_backoffice;
GRANT SELECT ON public.monthly_closures,public.account_transactions,public.sales,public.sale_items,public.sale_allocations,public.guest_accounts,public.reversals TO clubiq_backoffice;
GRANT INSERT ON public.account_transactions,public.payments,public.audit_logs TO clubiq_backoffice;
-- NO access to profile PINs, POS sessions, RFID secrets, cash shifts, or sale mutations.

-- The existing full-database pg_dump runs as vereinskasse. Keep it compatible,
-- and include the new identity/audit schema in USB and encrypted R2 backups.
GRANT USAGE ON SCHEMA backoffice TO vereinskasse;
GRANT SELECT ON ALL TABLES IN SCHEMA backoffice TO vereinskasse;
ALTER DEFAULT PRIVILEGES FOR ROLE clubiq_backoffice IN SCHEMA backoffice GRANT SELECT ON TABLES TO vereinskasse;

-- Scoped ownership repair after a --no-owner restore; never touches public tables.
DO $$ DECLARE target record; BEGIN
  FOR target IN SELECT tablename FROM pg_tables WHERE schemaname='backoffice' LOOP
    EXECUTE format('ALTER TABLE backoffice.%I OWNER TO clubiq_backoffice',target.tablename);
  END LOOP;
END $$;
ALTER SCHEMA backoffice OWNER TO clubiq_backoffice;
ALTER ROLE clubiq_backoffice IN DATABASE vereinskasse SET search_path=backoffice,public;
