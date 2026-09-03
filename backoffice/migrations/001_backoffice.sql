-- Better Auth 1.7.2 schema, generated with scripts/auth-schema.mjs.
-- Runs ONLY in the dedicated backoffice schema, never in public.
create table "bo_user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "twoFactorEnabled" boolean);
create table "bo_session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references "bo_user" ("id") on delete cascade);
create table "bo_account" ("id" text not null primary key, "issuer" text not null, "accountId" text not null, "providerId" text not null, "userId" text not null references "bo_user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);
create table "bo_verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);
create table "bo_two_factor" ("id" text not null primary key, "secret" text not null, "backupCodes" text not null, "userId" text not null references "bo_user" ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);
create index "bo_session_userId_idx" on "bo_session" ("userId");
create index "bo_account_userId_idx" on "bo_account" ("userId");
create index "bo_verification_identifier_idx" on "bo_verification" ("identifier");
create index "bo_two_factor_secret_idx" on "bo_two_factor" ("secret");
create unique index "bo_two_factor_userId_idx" on "bo_two_factor" ("userId");
create unique index "bo_account_issuer_accountId_uidx" on "bo_account" ("issuer", "accountId");

CREATE TABLE bo_grants (
  user_id text PRIMARY KEY REFERENCES bo_user(id) ON DELETE CASCADE,
  profile_id text NOT NULL REFERENCES public.profiles(id),
  role text NOT NULL CHECK (role IN ('viewer','treasurer','admin')),
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE bo_audit (
  id text PRIMARY KEY, user_id text, profile_id text,
  action text NOT NULL, entity text NOT NULL, details jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bo_audit_profile_time ON bo_audit(profile_id,created_at);
CREATE TABLE bo_limits (key text PRIMARY KEY, count integer NOT NULL, reset_at timestamptz NOT NULL);
CREATE TABLE bo_outbox (
  id text PRIMARY KEY, payload text, state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL,
  locked_at timestamptz, finished_at timestamptz
);
CREATE INDEX bo_outbox_pending ON bo_outbox(state,available_at);
CREATE TABLE bo_invoice_notes (
  profile_id text NOT NULL, month text NOT NULL, member_id text NOT NULL,
  note text NOT NULL DEFAULT '', version integer NOT NULL DEFAULT 1,
  updated_by text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(profile_id,month,member_id)
);
CREATE TABLE bo_mutations (
  id text PRIMARY KEY, user_id text NOT NULL, fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
