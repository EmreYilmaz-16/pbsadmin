CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS platform_users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(120) NOT NULL,
  email VARCHAR(160) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role VARCHAR(40) NOT NULL DEFAULT 'platform_admin',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(140) NOT NULL,
  description TEXT,
  metric_definitions JSONB NOT NULL DEFAULT '[]'::jsonb,
  default_base_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'TRY',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_pricing_plans (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  product_template_id UUID NOT NULL REFERENCES product_templates(id) ON DELETE CASCADE,
  code VARCHAR(80) NOT NULL,
  name VARCHAR(140) NOT NULL,
  description TEXT,
  monthly_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'TRY',
  included_limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (product_template_id, code)
);

CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(160) NOT NULL,
  slug VARCHAR(160) NOT NULL UNIQUE,
  contact_email VARCHAR(160),
  contact_phone VARCHAR(40),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_subscriptions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_template_id UUID NOT NULL REFERENCES product_templates(id),
  pricing_plan_id UUID REFERENCES product_pricing_plans(id),
  plan_name VARCHAR(120) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','suspended','cancelled')),
  base_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'TRY',
  billing_cycle_months INT NOT NULL DEFAULT 1,
  metric_limits JSONB NOT NULL DEFAULT '{}'::jsonb,
  current_usage JSONB NOT NULL DEFAULT '{}'::jsonb,
  starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  renewal_at TIMESTAMPTZ,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_subscription_id UUID NOT NULL REFERENCES organization_subscriptions(id) ON DELETE CASCADE,
  invoice_number VARCHAR(50) NOT NULL UNIQUE,
  status VARCHAR(20) NOT NULL DEFAULT 'unpaid' CHECK (status IN ('paid','unpaid','overdue')),
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'TRY',
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  due_date DATE NOT NULL,
  paid_at TIMESTAMPTZ,
  note TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS organization_invoice_payments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invoice_id UUID NOT NULL REFERENCES organization_invoices(id) ON DELETE CASCADE,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency VARCHAR(10) NOT NULL DEFAULT 'TRY',
  payment_method VARCHAR(40) NOT NULL DEFAULT 'bank_transfer',
  payment_reference VARCHAR(120),
  collected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS product_api_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  product_template_id UUID NOT NULL REFERENCES product_templates(id),
  base_url TEXT NOT NULL,
  health_path VARCHAR(160) NOT NULL DEFAULT '/health',
  login_path VARCHAR(160) NOT NULL DEFAULT '/api/v1/auth/login',
  me_path VARCHAR(160) NOT NULL DEFAULT '/api/v1/auth/me',
  auth_type VARCHAR(30) NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none','bearer','api_key')),
  auth_value TEXT,
  login_email VARCHAR(160),
  login_password TEXT,
  sync_type VARCHAR(60) NOT NULL DEFAULT 'none',
  sync_settings JSONB NOT NULL DEFAULT '{}'::jsonb,
  status VARCHAR(30) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','healthy','degraded','offline')),
  last_health_message TEXT,
  last_health_checked_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, product_template_id)
);

CREATE INDEX IF NOT EXISTS idx_org_subscriptions_org ON organization_subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_subscriptions_template ON organization_subscriptions(product_template_id);
CREATE INDEX IF NOT EXISTS idx_api_connections_org ON product_api_connections(organization_id);
CREATE INDEX IF NOT EXISTS idx_product_pricing_plans_template ON product_pricing_plans(product_template_id);
CREATE INDEX IF NOT EXISTS idx_org_invoices_subscription ON organization_invoices(organization_subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_invoices_status ON organization_invoices(status, due_date);
CREATE INDEX IF NOT EXISTS idx_org_invoice_payments_invoice ON organization_invoice_payments(invoice_id, collected_at DESC);

INSERT INTO platform_users (name, email, password_hash, role)
VALUES ('PBS Platform Super Admin', 'superadmin@pbssiteadmin.local', '2ef0bd6ef37c08ca5657d2178de0babd:4e351bb9208c72f4b46b3f9e76cf6337c777f532353998e1a3472ba18a3b1e13d9322e735fda6565962149196361c55e1019c51f51a5d54b907527dbbbcb7f40', 'platform_admin')
ON CONFLICT (email) DO NOTHING;

INSERT INTO product_templates (code, name, description, metric_definitions, default_base_price, currency)
VALUES
  (
    'property_management',
    'Mülk Yönetimi',
    'Kullanıcı ve mülk sayısı bazlı kiralama yönetimi.',
    '[{"key":"users","label":"Kullanıcı Sayısı","unit":"adet"},{"key":"properties","label":"Mülk Sayısı","unit":"adet"}]'::jsonb,
    3999,
    'TRY'
  ),
  (
    'fleet_tracking',
    'Filo Takip',
    'Kullanıcı ve araç kotası ile filo operasyonu.',
    '[{"key":"users","label":"Kullanıcı Sayısı","unit":"adet"},{"key":"vehicles","label":"Araç Sayısı","unit":"adet"}]'::jsonb,
    3499,
    'TRY'
  ),
  (
    'clinic_app',
    'Klinik Uygulaması',
    'Sadece kullanıcı bazlı kiralanan klinik yönetim uygulaması.',
    '[{"key":"users","label":"Kullanıcı Sayısı","unit":"adet"}]'::jsonb,
    2499,
    'TRY'
  )
ON CONFLICT (code) DO NOTHING;

INSERT INTO product_pricing_plans (product_template_id, code, name, description, monthly_price, currency, included_limits)
SELECT p.id,
       plan_data.code,
       plan_data.name,
       plan_data.description,
       plan_data.monthly_price,
       'TRY',
       plan_data.included_limits
FROM product_templates p
JOIN (
  VALUES
    ('property_management', 'property_starter', 'Portföy Starter', 'Küçük portföyler için', 1999::numeric, '{"users":3,"properties":50}'::jsonb),
    ('property_management', 'property_pro', 'Portföy Pro', 'Aktif emlak ofisleri için', 3999::numeric, '{"users":10,"properties":250}'::jsonb),
    ('property_management', 'property_enterprise', 'Portföy Enterprise', 'Yüksek hacimli portföy için', 7999::numeric, '{"users":25,"properties":1000}'::jsonb),
    ('fleet_tracking', 'fleet_starter', 'Filo Starter', 'Başlangıç filosu için', 2499::numeric, '{"users":5,"vehicles":25}'::jsonb),
    ('fleet_tracking', 'fleet_standard', 'Filo Standart', 'Büyüyen lojistik ekipleri için', 3499::numeric, '{"users":12,"vehicles":80}'::jsonb),
    ('fleet_tracking', 'fleet_enterprise', 'Filo Enterprise', 'Geniş filo operasyonu için', 6999::numeric, '{"users":40,"vehicles":300}'::jsonb),
    ('clinic_app', 'clinic_basic', 'Klinik Basic', 'Tek şube klinikler için', 1499::numeric, '{"users":8}'::jsonb),
    ('clinic_app', 'clinic_team', 'Klinik Team', 'Doktor ve sekreter ekipleri için', 2499::numeric, '{"users":25}'::jsonb),
    ('clinic_app', 'clinic_multi', 'Klinik Multi Branch', 'Çok şubeli klinikler için', 4999::numeric, '{"users":80}'::jsonb)
) AS plan_data(template_code, code, name, description, monthly_price, included_limits)
  ON p.code = plan_data.template_code
WHERE NOT EXISTS (
  SELECT 1
  FROM product_pricing_plans pp
  WHERE pp.product_template_id = p.id
    AND pp.code = plan_data.code
);

INSERT INTO organizations (name, slug, contact_email, contact_phone)
VALUES
  ('Emin Emlak', 'emin-emlak', 'operasyon@eminemlak.com', '0553 012 46 00'),
  ('Kuzey Lojistik', 'kuzey-lojistik', 'bilgi@kuzeylojistik.com', '0212 555 44 33'),
  ('Mavi Klinik', 'mavi-klinik', 'iletisim@maviklinik.com', '0216 455 88 11')
ON CONFLICT (slug) DO NOTHING;

WITH source_data AS (
  SELECT o.id AS organization_id,
         values_table.template_code,
         p.id AS product_template_id,
         pp.id AS pricing_plan_id,
         values_table.plan_name,
         values_table.status,
         values_table.base_price,
         values_table.metric_limits,
         values_table.current_usage,
         values_table.note,
         values_table.base_url,
         values_table.health_status,
         values_table.health_message,
         values_table.renewal_offset
  FROM (VALUES
    ('emin-emlak', 'property_management', 'property_pro', 'Pro Portföy', 'active', 3999::numeric, '{"users":10,"properties":250}'::jsonb, '{"users":7,"properties":184}'::jsonb, 'Mevcut mülk yönetimi müşterisi', 'http://host.docker.internal:8300', 'pending', 'Harici API henüz test edilmedi', INTERVAL '1 month'),
    ('kuzey-lojistik', 'fleet_tracking', 'fleet_standard', 'Filo Standart', 'trial', 3499::numeric, '{"users":12,"vehicles":80}'::jsonb, '{"users":9,"vehicles":52}'::jsonb, 'Filo takip deneme hesabı', 'https://fleet.example.com/api', 'offline', 'Bağlantı testi bekleniyor', INTERVAL '14 day'),
    ('mavi-klinik', 'clinic_app', 'clinic_team', 'Klinik Team', 'active', 2499::numeric, '{"users":25}'::jsonb, '{"users":14}'::jsonb, 'Klinik kullanıcı lisansı', 'https://clinic.example.com/api', 'healthy', 'Son health-check başarılı', INTERVAL '1 month')
  ) AS values_table(org_slug, template_code, plan_code, plan_name, status, base_price, metric_limits, current_usage, note, base_url, health_status, health_message, renewal_offset)
  JOIN organizations o ON o.slug = values_table.org_slug
  JOIN product_templates p ON p.code = values_table.template_code
  LEFT JOIN product_pricing_plans pp ON pp.product_template_id = p.id AND pp.code = values_table.plan_code
), inserted_subscriptions AS (
  INSERT INTO organization_subscriptions (
    organization_id,
    product_template_id,
    pricing_plan_id,
    plan_name,
    status,
    base_price,
    currency,
    billing_cycle_months,
    metric_limits,
    current_usage,
    starts_at,
    renewal_at,
    note
  )
  SELECT organization_id,
         product_template_id,
      pricing_plan_id,
         plan_name,
         status,
         base_price,
         'TRY',
         1,
         metric_limits,
         current_usage,
         NOW(),
         NOW() + renewal_offset,
         note
  FROM source_data
  WHERE NOT EXISTS (
    SELECT 1
    FROM organization_subscriptions s
    WHERE s.organization_id = source_data.organization_id
      AND s.product_template_id = source_data.product_template_id
  )
  RETURNING organization_id, product_template_id
)
INSERT INTO product_api_connections (
  organization_id,
  product_template_id,
  base_url,
  health_path,
  login_path,
  me_path,
  auth_type,
  login_email,
  login_password,
  sync_type,
  sync_settings,
  status,
  last_health_message,
  metadata,
  last_health_checked_at
)
SELECT source_data.organization_id,
       source_data.product_template_id,
       source_data.base_url,
       '/health',
       '/api/v1/auth/login',
       '/api/v1/auth/me',
       'none',
       CASE WHEN source_data.template_code = 'property_management' THEN 'superadmin@kiratakip.local' ELSE NULL END,
       CASE WHEN source_data.template_code = 'property_management' THEN 'SuperAdmin123!' ELSE NULL END,
       CASE WHEN source_data.template_code = 'property_management' THEN 'mobilkiratakip_property_management' ELSE 'none' END,
       CASE WHEN source_data.template_code = 'property_management'
         THEN jsonb_build_object('users_path', '/api/v1/auth/users', 'properties_path', '/api/v1/properties')
         ELSE '{}'::jsonb
       END,
       source_data.health_status,
       source_data.health_message,
       jsonb_build_object('source', 'seed'),
       CASE WHEN source_data.health_status = 'pending' THEN NULL ELSE NOW() END
FROM source_data
WHERE NOT EXISTS (
  SELECT 1
  FROM product_api_connections c
  WHERE c.organization_id = source_data.organization_id
    AND c.product_template_id = source_data.product_template_id
);

INSERT INTO organization_invoices (
  organization_subscription_id,
  invoice_number,
  status,
  amount,
  currency,
  period_start,
  period_end,
  due_date,
  paid_at,
  note,
  metadata
)
SELECT s.id,
       CONCAT('PBS-', TO_CHAR(CURRENT_DATE, 'YYYYMM'), '-', UPPER(SUBSTRING(REPLACE(s.id::text, '-', '') FROM 1 FOR 6))),
       CASE
         WHEN s.status = 'trial' THEN 'unpaid'
         WHEN s.renewal_at::date < CURRENT_DATE THEN 'overdue'
         ELSE 'paid'
       END,
       s.base_price,
       s.currency,
       date_trunc('month', CURRENT_DATE)::date,
       (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date,
       COALESCE(s.renewal_at::date, (CURRENT_DATE + INTERVAL '7 day')::date),
       CASE WHEN s.status = 'active' AND s.renewal_at::date >= CURRENT_DATE THEN NOW() ELSE NULL END,
       CONCAT(s.plan_name, ' aylık kullanım faturası'),
       jsonb_build_object('source', 'seed', 'subscription_status', s.status)
FROM organization_subscriptions s
WHERE NOT EXISTS (
  SELECT 1
  FROM organization_invoices i
  WHERE i.organization_subscription_id = s.id
);

INSERT INTO organization_invoice_payments (
  invoice_id,
  amount,
  currency,
  payment_method,
  payment_reference,
  collected_at,
  note
)
SELECT i.id,
       i.amount,
       i.currency,
       'bank_transfer',
       CONCAT('SEED-', UPPER(SUBSTRING(REPLACE(i.id::text, '-', '') FROM 1 FOR 8))),
       NOW(),
       'Seed ödeme kaydı'
FROM organization_invoices i
WHERE i.status = 'paid'
  AND NOT EXISTS (
    SELECT 1
    FROM organization_invoice_payments p
    WHERE p.invoice_id = i.id
  );
