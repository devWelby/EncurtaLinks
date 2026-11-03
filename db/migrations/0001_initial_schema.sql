-- EncurtaLinks — esquema inicial.
--
-- Convenções:
--   * Todos os objetos ficam no schema `app` (criado pelo executor de migrações),
--     nunca no schema `public`, para não serem expostos por APIs automáticas de
--     provedores (ex.: Supabase Data API / PostgREST).
--   * Datas em timestamptz; o servidor usa UTC (now() é sempre o relógio do banco).
--   * Slugs nunca são reaproveitados: links não são apagados fisicamente;
--     a exclusão vira um "tombstone" (status = 'deleted', destino removido).
--   * Migrações devem ser compatíveis com a versão anterior da aplicação
--     (padrão expand/contract), para permitir rollback do código.

CREATE TABLE app.links (
  id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  slug              text        NOT NULL,
  destination_url   text,
  destination_host  text,
  status            text        NOT NULL DEFAULT 'active',
  status_reason     text,
  status_changed_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  expires_at        timestamptz,
  creator_ip_hash   bytea,
  CONSTRAINT links_slug_key UNIQUE (slug),
  CONSTRAINT links_slug_format CHECK (slug ~ '^[2-9A-HJ-NP-Za-km-z]{10,32}$'),
  CONSTRAINT links_status_valid CHECK (status IN ('active', 'blocked', 'deleted')),
  CONSTRAINT links_destination_presence CHECK (
    (status = 'deleted' AND destination_url IS NULL)
    OR (status <> 'deleted' AND destination_url IS NOT NULL AND destination_host IS NOT NULL)
  ),
  CONSTRAINT links_destination_length CHECK (destination_url IS NULL OR char_length(destination_url) BETWEEN 11 AND 2048),
  CONSTRAINT links_destination_scheme CHECK (destination_url IS NULL OR destination_url ~ '^https?://'),
  CONSTRAINT links_host_format CHECK (destination_host IS NULL OR destination_host ~ '^[a-z0-9.-]{1,253}$'),
  CONSTRAINT links_status_reason_length CHECK (status_reason IS NULL OR char_length(status_reason) <= 500),
  CONSTRAINT links_expiry_after_creation CHECK (expires_at IS NULL OR expires_at > created_at),
  CONSTRAINT links_ip_hash_length CHECK (creator_ip_hash IS NULL OR octet_length(creator_ip_hash) = 32)
);

CREATE INDEX links_destination_host_idx ON app.links (destination_host);
CREATE INDEX links_created_at_idx ON app.links (created_at DESC, id DESC);
CREATE INDEX links_status_created_idx ON app.links (status, created_at DESC, id DESC);
CREATE INDEX links_creator_ip_hash_idx ON app.links (creator_ip_hash) WHERE creator_ip_hash IS NOT NULL;
CREATE INDEX links_expires_at_idx ON app.links (expires_at) WHERE expires_at IS NOT NULL AND status <> 'deleted';

-- Tickets de continuação: somente o hash SHA-256 do token é armazenado.
CREATE TABLE app.continuation_tickets (
  token_hash  bytea       PRIMARY KEY,
  link_id     bigint      NOT NULL REFERENCES app.links (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  CONSTRAINT tickets_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT tickets_expiry_after_creation CHECK (expires_at > created_at),
  CONSTRAINT tickets_consumed_after_creation CHECK (consumed_at IS NULL OR consumed_at >= created_at)
);

CREATE INDEX continuation_tickets_link_idx ON app.continuation_tickets (link_id);
CREATE INDEX continuation_tickets_expires_idx ON app.continuation_tickets (expires_at);

CREATE TABLE app.reports (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  link_id          bigint REFERENCES app.links (id) ON DELETE SET NULL,
  slug             text        NOT NULL,
  reason           text        NOT NULL,
  details          text,
  contact_email    text,
  status           text        NOT NULL DEFAULT 'open',
  reporter_ip_hash bytea,
  created_at       timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz,
  resolved_by      text,
  resolution_note  text,
  CONSTRAINT reports_slug_format CHECK (slug ~ '^[2-9A-HJ-NP-Za-km-z]{10,32}$'),
  CONSTRAINT reports_reason_valid CHECK (reason IN ('phishing', 'malware', 'spam', 'fraud', 'illegal', 'other')),
  CONSTRAINT reports_status_valid CHECK (status IN ('open', 'resolved', 'dismissed')),
  CONSTRAINT reports_details_length CHECK (details IS NULL OR char_length(details) <= 2000),
  CONSTRAINT reports_email_length CHECK (contact_email IS NULL OR char_length(contact_email) <= 254),
  CONSTRAINT reports_note_length CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 1000),
  CONSTRAINT reports_resolution_consistency CHECK ((status = 'open') = (resolved_at IS NULL)),
  CONSTRAINT reports_ip_hash_length CHECK (reporter_ip_hash IS NULL OR octet_length(reporter_ip_hash) = 32)
);

CREATE INDEX reports_status_created_idx ON app.reports (status, created_at DESC, id DESC);
CREATE INDEX reports_link_idx ON app.reports (link_id, created_at DESC);

-- Bloqueio por domínio: bloqueia o domínio informado e todos os subdomínios.
CREATE TABLE app.blocked_domains (
  domain     text        PRIMARY KEY,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by text,
  CONSTRAINT blocked_domains_format CHECK (
    char_length(domain) <= 253
    AND domain ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  ),
  CONSTRAINT blocked_domains_reason_length CHECK (reason IS NULL OR char_length(reason) <= 500)
);

-- Sessões administrativas: o cookie contém um token aleatório; o banco guarda só o hash.
CREATE TABLE app.admin_sessions (
  token_hash      bytea       PRIMARY KEY,
  csrf_token      text        NOT NULL,
  admin_github_id bigint      NOT NULL,
  admin_login     text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  CONSTRAINT admin_sessions_hash_length CHECK (octet_length(token_hash) = 32),
  CONSTRAINT admin_sessions_csrf_length CHECK (char_length(csrf_token) BETWEEN 32 AND 128),
  CONSTRAINT admin_sessions_login_length CHECK (char_length(admin_login) BETWEEN 1 AND 100),
  CONSTRAINT admin_sessions_expiry CHECK (expires_at > created_at)
);

CREATE INDEX admin_sessions_admin_idx ON app.admin_sessions (admin_github_id);
CREATE INDEX admin_sessions_expires_idx ON app.admin_sessions (expires_at);

CREATE TABLE app.admin_audit_log (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at      timestamptz NOT NULL DEFAULT now(),
  admin_github_id bigint      NOT NULL,
  admin_login     text        NOT NULL,
  action          text        NOT NULL,
  target_type     text,
  target_id       text,
  details         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT audit_action_format CHECK (action ~ '^[a-z_.]{3,64}$'),
  CONSTRAINT audit_target_length CHECK (target_id IS NULL OR char_length(target_id) <= 300)
);

CREATE INDEX admin_audit_log_created_idx ON app.admin_audit_log (created_at DESC, id DESC);

-- Chaves operacionais (lidas a cada requisição, sem cache).
CREATE TABLE app.app_settings (
  key        text        PRIMARY KEY,
  value      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  CONSTRAINT app_settings_key_valid CHECK (key IN ('link_creation_enabled', 'ads_enabled', 'reports_enabled')),
  CONSTRAINT app_settings_boolean CHECK (jsonb_typeof(value) = 'boolean')
);

CREATE TABLE app.legal_documents (
  kind                 text        PRIMARY KEY,
  title                text        NOT NULL,
  body                 text        NOT NULL,
  responsible_name     text,
  responsible_contact  text,
  responsible_document text,
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           text,
  CONSTRAINT legal_kind_valid CHECK (kind IN ('terms', 'privacy')),
  CONSTRAINT legal_title_length CHECK (char_length(title) BETWEEN 1 AND 200),
  CONSTRAINT legal_body_length CHECK (char_length(body) BETWEEN 1 AND 60000),
  CONSTRAINT legal_responsible_length CHECK (
    (responsible_name IS NULL OR char_length(responsible_name) <= 200)
    AND (responsible_contact IS NULL OR char_length(responsible_contact) <= 300)
    AND (responsible_document IS NULL OR char_length(responsible_document) <= 100)
  )
);

-- Métricas agregadas por dia (UTC). Não representam pessoas únicas.
CREATE TABLE app.daily_metrics (
  day    date   NOT NULL,
  metric text   NOT NULL,
  count  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric),
  CONSTRAINT daily_metrics_metric_valid CHECK (
    metric IN ('link_created', 'link_rejected', 'interstitial_view', 'continuation', 'report_created')
  ),
  CONSTRAINT daily_metrics_count_nonnegative CHECK (count >= 0)
);

CREATE TABLE app.link_daily_metrics (
  link_id            bigint  NOT NULL REFERENCES app.links (id) ON DELETE CASCADE,
  day                date    NOT NULL,
  interstitial_views integer NOT NULL DEFAULT 0,
  continuations      integer NOT NULL DEFAULT 0,
  PRIMARY KEY (link_id, day),
  CONSTRAINT link_daily_metrics_nonnegative CHECK (interstitial_views >= 0 AND continuations >= 0)
);

CREATE INDEX link_daily_metrics_day_idx ON app.link_daily_metrics (day);

-- Contadores de rate limiting (janela fixa), compartilhados entre todas as instâncias.
CREATE TABLE app.rate_limit_counters (
  bucket       text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL,
  expires_at   timestamptz NOT NULL,
  PRIMARY KEY (bucket, window_start),
  CONSTRAINT rate_limit_bucket_length CHECK (char_length(bucket) <= 200),
  CONSTRAINT rate_limit_count_positive CHECK (count > 0)
);

CREATE INDEX rate_limit_counters_expires_idx ON app.rate_limit_counters (expires_at);

-- Defesa em profundidade: RLS habilitado sem políticas. O papel dono das
-- tabelas (usado pela aplicação) não é afetado; qualquer outro papel
-- (ex.: anon/authenticated do Supabase) fica sem acesso às linhas.
ALTER TABLE app.links ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.continuation_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.blocked_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.admin_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.legal_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.link_daily_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.rate_limit_counters ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA app FROM PUBLIC;
