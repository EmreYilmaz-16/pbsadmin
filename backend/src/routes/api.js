const crypto = require('crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { query, getClient } = require('../config/database');
const { auth } = require('../middleware/auth');

const router = express.Router();

const createSlug = (value = '') => value
  .toLocaleLowerCase('tr-TR')
  .replace(/[^a-z0-9]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 80);

const verifyPassword = (plainText, stored) => {
  const [salt, originalHash] = String(stored || '').split(':');
  if (!salt || !originalHash) {
    return false;
  }

  const nextHash = crypto.scryptSync(plainText, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(originalHash, 'hex'), Buffer.from(nextHash, 'hex'));
};

const getProductTemplates = async () => {
  const { rows } = await query(
    `SELECT id, code, name, description, metric_definitions, default_base_price, currency
     FROM product_templates
     WHERE is_active = TRUE
     ORDER BY name ASC`
  );

  return rows;
};

const getPricingPlans = async () => {
  const { rows } = await query(
    `SELECT pp.id,
            pp.product_template_id,
            pp.code,
            pp.name,
            pp.description,
            pp.monthly_price,
            pp.currency,
            pp.included_limits,
            p.code AS product_code,
            p.name AS product_name
       FROM product_pricing_plans pp
       JOIN product_templates p ON p.id = pp.product_template_id
      WHERE pp.is_active = TRUE
      ORDER BY p.name ASC, pp.monthly_price ASC`
  );

  return rows.map((row) => ({
    ...row,
    monthly_price: Number(row.monthly_price || 0)
  }));
};

const buildInvoiceSummary = (rows) => rows.reduce((accumulator, row) => {
  accumulator.total += 1;
  accumulator.amount_total += Number(row.amount || 0);
  accumulator.paid_total += Number(row.paid_total || 0);
  accumulator.outstanding_total += Number(row.outstanding_amount || 0);
  accumulator[`${row.status}_count`] += 1;
  return accumulator;
}, {
  total: 0,
  amount_total: 0,
  paid_total: 0,
  outstanding_total: 0,
  paid_count: 0,
  unpaid_count: 0,
  overdue_count: 0
});

const normalizePath = (value, fallback) => {
  const normalized = String(value || fallback || '').trim() || fallback;
  if (!normalized) {
    return '/';
  }

  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const buildRemoteUrl = (baseUrl, path, fallback) => `${String(baseUrl || '').replace(/\/$/, '')}${normalizePath(path, fallback)}`;

const safeParseJson = async (response) => {
  try {
    return await response.json();
  } catch (_error) {
    return null;
  }
};

const buildRemoteHeaders = (connection, token) => {
  const headers = { Accept: 'application/json' };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  } else if (connection.auth_type === 'bearer' && connection.auth_value) {
    headers.Authorization = `Bearer ${connection.auth_value}`;
  } else if (connection.auth_type === 'api_key' && connection.auth_value) {
    headers['x-api-key'] = connection.auth_value;
  }

  return headers;
};

const loadIntegrationConnection = async (connectionId) => {
  const { rows } = await query(
    `SELECT c.*, o.name AS organization_name, o.slug AS organization_slug,
            s.id AS subscription_id, s.current_usage, s.metric_limits,
            p.code AS product_code, p.name AS product_name
       FROM product_api_connections c
       JOIN organizations o ON o.id = c.organization_id
       LEFT JOIN organization_subscriptions s
         ON s.organization_id = c.organization_id
        AND s.product_template_id = c.product_template_id
       JOIN product_templates p ON p.id = c.product_template_id
      WHERE c.id = $1
      LIMIT 1`,
    [connectionId]
  );

  return rows[0] || null;
};

const loginToRemoteConnection = async (connection) => {
  if (!connection.login_email || !connection.login_password) {
    throw new Error('Login probe için entegrasyon e-postası ve şifresi gerekli');
  }

  const loginUrl = buildRemoteUrl(connection.base_url, connection.login_path, '/api/v1/auth/login');
  const response = await fetch(loginUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      email: connection.login_email,
      password: connection.login_password
    })
  });
  const payload = await safeParseJson(response);

  if (!response.ok || payload?.success === false || !payload?.data?.token) {
    throw new Error(payload?.message || `Login başarısız (${response.status})`);
  }

  const meUrl = buildRemoteUrl(
    connection.base_url,
    connection.me_path || normalizePath(String(connection.login_path || '').replace(/\/login$/, '/me'), '/api/v1/auth/me'),
    '/api/v1/auth/me'
  );
  const meResponse = await fetch(meUrl, {
    headers: buildRemoteHeaders(connection, payload.data.token)
  });
  const mePayload = await safeParseJson(meResponse);

  if (!meResponse.ok || mePayload?.success === false) {
    throw new Error(mePayload?.message || `Profil doğrulaması başarısız (${meResponse.status})`);
  }

  return {
    token: payload.data.token,
    user: mePayload?.data || payload.data.user || null
  };
};

const updateConnectionState = async (connectionId, status, message, metadataPatch = {}) => {
  const { rows } = await query(
    `UPDATE product_api_connections
        SET status = $1,
            last_health_message = $2,
            last_health_checked_at = NOW(),
            metadata = COALESCE(metadata, '{}'::jsonb) || $3::jsonb,
            updated_at = NOW()
      WHERE id = $4
      RETURNING *`,
    [status, message, JSON.stringify(metadataPatch), connectionId]
  );

  return rows[0];
};

const syncMobilKiraTakipUsage = async (connection, token) => {
  const syncSettings = connection.sync_settings || {};
  const usersUrl = buildRemoteUrl(connection.base_url, syncSettings.users_path, '/api/v1/auth/users');
  const propertiesUrl = buildRemoteUrl(connection.base_url, syncSettings.properties_path, '/api/v1/properties');

  const [usersResponse, propertiesResponse] = await Promise.all([
    fetch(usersUrl, { headers: buildRemoteHeaders(connection, token) }),
    fetch(`${propertiesUrl}${propertiesUrl.includes('?') ? '&' : '?'}limit=1`, { headers: buildRemoteHeaders(connection, token) })
  ]);

  const usersPayload = await safeParseJson(usersResponse);
  const propertiesPayload = await safeParseJson(propertiesResponse);

  if (!usersResponse.ok || usersPayload?.success === false) {
    throw new Error(usersPayload?.message || `Kullanıcı senkronizasyonu başarısız (${usersResponse.status})`);
  }

  if (!propertiesResponse.ok || propertiesPayload?.success === false) {
    throw new Error(propertiesPayload?.message || `Mülk senkronizasyonu başarısız (${propertiesResponse.status})`);
  }

  const nextUsage = {
    ...(connection.current_usage || {}),
    users: Number(usersPayload?.summary?.user_count || 0),
    properties: Number(propertiesPayload?.meta?.total || 0)
  };

  await query(
    `UPDATE organization_subscriptions
        SET current_usage = $1,
            updated_at = NOW()
      WHERE id = $2`,
    [JSON.stringify(nextUsage), connection.subscription_id]
  );

  return {
    current_usage: nextUsage,
    remote_user: usersPayload?.summary || null,
    remote_property_total: Number(propertiesPayload?.meta?.total || 0)
  };
};

const getOrganizationOverview = async () => {
  const [organizationsResult, subscriptionsResult, invoicesResult, paymentsResult] = await Promise.all([
    query(
      `SELECT id, name, slug, contact_email, contact_phone, is_active, created_at, updated_at
       FROM organizations
       ORDER BY created_at DESC`
    ),
    query(
      `SELECT s.id,
              s.organization_id,
              s.plan_name,
              s.status,
              s.base_price,
              s.currency,
              s.billing_cycle_months,
              s.pricing_plan_id,
              s.metric_limits,
              s.current_usage,
              s.starts_at,
              s.renewal_at,
              s.note,
              p.id AS product_template_id,
              p.code AS product_code,
              p.name AS product_name,
              p.description AS product_description,
              p.metric_definitions,
              pp.code AS pricing_plan_code,
              pp.name AS pricing_plan_name,
              pp.description AS pricing_plan_description,
              pp.included_limits AS pricing_plan_limits,
              c.id AS connection_id,
              c.base_url,
              c.health_path,
              c.login_path,
              c.login_email,
              c.sync_type,
              c.auth_type,
              c.status AS integration_status,
              c.last_health_message,
              c.last_health_checked_at,
              c.metadata AS integration_metadata
       FROM organization_subscriptions s
       JOIN product_templates p ON p.id = s.product_template_id
       LEFT JOIN product_pricing_plans pp ON pp.id = s.pricing_plan_id
       LEFT JOIN product_api_connections c
         ON c.organization_id = s.organization_id
        AND c.product_template_id = s.product_template_id
       ORDER BY s.created_at DESC`
    ),
    query(
      `SELECT i.id,
              i.organization_subscription_id,
              i.invoice_number,
              i.status,
              i.amount,
              i.currency,
              i.period_start,
              i.period_end,
              i.due_date,
              i.paid_at,
              i.note,
              i.created_at,
              i.updated_at
       FROM organization_invoices i
       ORDER BY i.created_at DESC`
    ),
    query(
      `SELECT id,
              invoice_id,
              amount,
              currency,
              payment_method,
              payment_reference,
              collected_at,
              note,
              created_at
         FROM organization_invoice_payments
        ORDER BY collected_at DESC`
    )
  ]);

  const paymentsByInvoice = paymentsResult.rows.reduce((accumulator, row) => {
    const key = row.invoice_id;
    if (!accumulator[key]) {
      accumulator[key] = [];
    }
    accumulator[key].push({
      ...row,
      amount: Number(row.amount || 0)
    });
    return accumulator;
  }, {});

  const invoicesBySubscription = invoicesResult.rows.reduce((accumulator, row) => {
    const key = row.organization_subscription_id;
    if (!accumulator[key]) {
      accumulator[key] = [];
    }
    const payments = paymentsByInvoice[row.id] || [];
    const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const invoiceAmount = Number(row.amount || 0);
    accumulator[key].push({
      ...row,
      amount: invoiceAmount,
      payments,
      paid_total: paidTotal,
      outstanding_amount: Math.max(invoiceAmount - paidTotal, 0)
    });
    return accumulator;
  }, {});

  const subscriptionsByOrganization = subscriptionsResult.rows.reduce((accumulator, row) => {
    const key = row.organization_id;
    if (!accumulator[key]) {
      accumulator[key] = [];
    }

    accumulator[key].push({
      id: row.id,
      plan_name: row.plan_name,
      status: row.status,
      base_price: Number(row.base_price || 0),
      currency: row.currency,
      billing_cycle_months: row.billing_cycle_months,
      pricing_plan: row.pricing_plan_id ? {
        id: row.pricing_plan_id,
        code: row.pricing_plan_code,
        name: row.pricing_plan_name,
        description: row.pricing_plan_description,
        included_limits: row.pricing_plan_limits || {}
      } : null,
      metric_limits: row.metric_limits || {},
      current_usage: row.current_usage || {},
      starts_at: row.starts_at,
      renewal_at: row.renewal_at,
      note: row.note,
      product_template: {
        id: row.product_template_id,
        code: row.product_code,
        name: row.product_name,
        description: row.product_description,
        metric_definitions: row.metric_definitions || []
      },
      integration: row.connection_id ? {
        id: row.connection_id,
        base_url: row.base_url,
        health_path: row.health_path,
        login_path: row.login_path,
        login_email: row.login_email,
        sync_type: row.sync_type,
        auth_type: row.auth_type,
        status: row.integration_status,
        last_health_message: row.last_health_message,
        last_health_checked_at: row.last_health_checked_at,
        metadata: row.integration_metadata || {}
      } : null
      ,
      invoices: invoicesBySubscription[row.id] || [],
      invoice_summary: buildInvoiceSummary(invoicesBySubscription[row.id] || [])
    });

    return accumulator;
  }, {});

  return organizationsResult.rows.map((organization) => ({
    ...organization,
    subscriptions: subscriptionsByOrganization[organization.id] || []
  }));
};

router.get('/health', async (_req, res) => {
  try {
    await query('SELECT 1');
    res.json({ success: true, service: 'pbssiteadmin-api', database: 'ok' });
  } catch (error) {
    res.status(500).json({ success: false, service: 'pbssiteadmin-api', message: error.message });
  }
});

router.post('/auth/login', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  if (!email || !password) {
    return res.status(400).json({ success: false, message: 'E-posta ve şifre zorunlu' });
  }

  const { rows } = await query(
    `SELECT id, name, email, password_hash, role, is_active
     FROM platform_users
     WHERE email = $1
     LIMIT 1`,
    [email]
  );

  const user = rows[0];
  if (!user || !user.is_active || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ success: false, message: 'Giriş bilgileri hatalı' });
  }

  const token = jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );

  return res.json({
    success: true,
    data: {
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    }
  });
});

router.get('/auth/me', auth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, name, email, role
     FROM platform_users
     WHERE id = $1
     LIMIT 1`,
    [req.user.id]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'Kullanıcı bulunamadı' });
  }

  return res.json({ success: true, data: rows[0] });
});

router.get('/product-templates', auth, async (_req, res) => {
  const templates = await getProductTemplates();
  res.json({ success: true, data: templates });
});

router.get('/catalog/plans', auth, async (_req, res) => {
  const plans = await getPricingPlans();
  res.json({ success: true, data: plans });
});

router.get('/dashboard/summary', auth, async (_req, res) => {
  const [statsResult, productsResult, integrationsResult, invoiceResult] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS organization_count,
              COUNT(*) FILTER (WHERE is_active = TRUE)::int AS active_organization_count
       FROM organizations`
    ),
    query(
      `SELECT p.code,
              p.name,
              COUNT(*)::int AS subscription_count,
              COALESCE(SUM(s.base_price), 0)::numeric(12,2) AS monthly_revenue
       FROM organization_subscriptions s
       JOIN product_templates p ON p.id = s.product_template_id
       WHERE s.status IN ('trial', 'active')
       GROUP BY p.code, p.name
       ORDER BY p.name ASC`
    ),
    query(
      `SELECT COUNT(*) FILTER (WHERE status = 'healthy')::int AS healthy_count,
              COUNT(*) FILTER (WHERE status = 'offline')::int AS offline_count,
              COUNT(*) FILTER (WHERE status = 'degraded')::int AS degraded_count,
              COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count
       FROM product_api_connections`
    ),
    query(
      `SELECT COUNT(*)::int AS invoice_total,
              COUNT(*) FILTER (WHERE status = 'paid')::int AS paid_count,
              COUNT(*) FILTER (WHERE status = 'unpaid')::int AS unpaid_count,
              COUNT(*) FILTER (WHERE status = 'overdue')::int AS overdue_count,
              COALESCE(SUM(amount) FILTER (WHERE status IN ('unpaid','overdue')), 0)::numeric(12,2) AS receivable_total,
              COALESCE((SELECT SUM(amount) FROM organization_invoice_payments), 0)::numeric(12,2) AS collected_total
       FROM organization_invoices`
    )
  ]);

  const revenueTotal = productsResult.rows.reduce((sum, item) => sum + Number(item.monthly_revenue || 0), 0);
  res.json({
    success: true,
    data: {
      organization_count: statsResult.rows[0].organization_count,
      active_organization_count: statsResult.rows[0].active_organization_count,
      monthly_revenue: revenueTotal,
      product_breakdown: productsResult.rows.map((row) => ({
        ...row,
        subscription_count: Number(row.subscription_count || 0),
        monthly_revenue: Number(row.monthly_revenue || 0)
      })),
      integration_summary: integrationsResult.rows[0],
      invoice_summary: {
        ...invoiceResult.rows[0],
        receivable_total: Number(invoiceResult.rows[0].receivable_total || 0),
        collected_total: Number(invoiceResult.rows[0].collected_total || 0)
      }
    }
  });
});

router.get('/organizations/overview', auth, async (_req, res) => {
  const rows = await getOrganizationOverview();
  res.json({ success: true, data: rows });
});

router.post('/onboarding', auth, async (req, res) => {
  const payload = req.body || {};
  const organizationName = String(payload.organization_name || '').trim();
  const productTemplateId = String(payload.product_template_id || '').trim();
  const pricingPlanId = String(payload.pricing_plan_id || '').trim();
  const planName = String(payload.plan_name || '').trim();
  const baseUrl = String(payload.base_url || '').trim();
  const loginEmail = String(payload.login_email || '').trim();
  const loginPassword = String(payload.login_password || '').trim();

  if (!organizationName || !productTemplateId || !planName) {
    return res.status(400).json({ success: false, message: 'Organizasyon, ürün ve plan bilgisi zorunlu' });
  }

  const templateResult = pricingPlanId
    ? await query(
      `SELECT p.id, p.code, p.name, p.metric_definitions, p.default_base_price, p.currency,
              pp.id AS pricing_plan_id,
              pp.name AS pricing_plan_name,
              pp.monthly_price,
              pp.included_limits
         FROM product_pricing_plans pp
         JOIN product_templates p ON p.id = pp.product_template_id
        WHERE pp.id = $1
        LIMIT 1`,
      [pricingPlanId]
    )
    : await query(
      `SELECT id, code, name, metric_definitions, default_base_price, currency
       FROM product_templates
       WHERE id = $1
       LIMIT 1`,
      [productTemplateId]
    );

  if (!templateResult.rows.length) {
    return res.status(404).json({ success: false, message: 'Ürün şablonu bulunamadı' });
  }

  const template = templateResult.rows[0];
  const metricLimits = payload.metric_limits && typeof payload.metric_limits === 'object'
    ? payload.metric_limits
    : (template.included_limits || {});
  const currentUsage = payload.current_usage && typeof payload.current_usage === 'object' ? payload.current_usage : {};
  const client = await getClient();

  try {
    await client.query('BEGIN');
    const slug = createSlug(payload.slug || organizationName);
    const organizationInsert = await client.query(
      `INSERT INTO organizations (name, slug, contact_email, contact_phone)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        organizationName,
        slug,
        payload.contact_email || null,
        payload.contact_phone || null
      ]
    );

    const organization = organizationInsert.rows[0];
    const subscriptionInsert = await client.query(
      `INSERT INTO organization_subscriptions (
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
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW() + make_interval(months => $8::int),$11)
        RETURNING *`,
      [
        organization.id,
        template.id,
        template.pricing_plan_id || null,
        planName || template.pricing_plan_name || `${template.name} Standart`,
        payload.status || 'trial',
        Number(payload.base_price ?? template.monthly_price ?? template.default_base_price),
        template.currency,
        Number(payload.billing_cycle_months || 1),
        JSON.stringify(metricLimits),
        JSON.stringify(currentUsage),
        payload.note || null
      ]
    );

    await client.query(
      `INSERT INTO organization_invoices (
        organization_subscription_id,
        invoice_number,
        status,
        amount,
        currency,
        period_start,
        period_end,
        due_date,
        note,
        metadata
      ) VALUES (
        $1,
        $2,
        $3,
        $4,
        $5,
        date_trunc('month', CURRENT_DATE)::date,
        (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date,
        (CURRENT_DATE + interval '7 day')::date,
        $6,
        $7
      )`,
      [
        subscriptionInsert.rows[0].id,
        `PBS-${new Date().toISOString().slice(0, 7).replace('-', '')}-${subscriptionInsert.rows[0].id.replace(/-/g, '').slice(0, 6).toUpperCase()}`,
        payload.status === 'active' ? 'paid' : 'unpaid',
        Number(payload.base_price ?? template.monthly_price ?? template.default_base_price),
        template.currency,
        `${planName || template.pricing_plan_name || `${template.name} Standart`} onboarding faturası`,
        JSON.stringify({ source: 'onboarding' })
      ]
    );

    let connection = null;
    if (baseUrl) {
      const connectionInsert = await client.query(
        `INSERT INTO product_api_connections (
          organization_id,
          product_template_id,
          base_url,
          health_path,
          login_path,
          me_path,
          auth_type,
          auth_value,
          login_email,
          login_password,
          sync_type,
          sync_settings,
          status,
          metadata
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'pending',$12)
        RETURNING *`,
        [
          organization.id,
          template.id,
          baseUrl,
          payload.health_path || '/health',
          payload.login_path || '/api/v1/auth/login',
          payload.me_path || '/api/v1/auth/me',
          payload.auth_type || 'none',
          payload.auth_value || null,
          loginEmail || null,
          loginPassword || null,
          payload.sync_type || 'none',
          JSON.stringify(payload.sync_settings || {}),
          JSON.stringify({ source: 'onboarding' })
        ]
      );
      connection = connectionInsert.rows[0];
    }

    await client.query('COMMIT');
    return res.status(201).json({
      success: true,
      data: {
        organization,
        subscription: subscriptionInsert.rows[0],
        integration: connection
      }
    });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      return res.status(409).json({ success: false, message: 'Aynı slug veya ürün bağlantısı zaten mevcut' });
    }
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    client.release();
  }
});

router.patch('/subscriptions/:id/usage', auth, async (req, res) => {
  const usage = req.body.current_usage;
  if (!usage || typeof usage !== 'object') {
    return res.status(400).json({ success: false, message: 'current_usage json nesnesi olmalı' });
  }

  const { rows } = await query(
    `UPDATE organization_subscriptions
        SET current_usage = $1,
            updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [JSON.stringify(usage), req.params.id]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'Abonelik bulunamadı' });
  }

  return res.json({ success: true, data: rows[0] });
});

router.post('/subscriptions/:id/invoices', auth, async (req, res) => {
  const { rows } = await query(
    `SELECT id, plan_name, base_price, currency
       FROM organization_subscriptions
      WHERE id = $1
      LIMIT 1`,
    [req.params.id]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'Abonelik bulunamadı' });
  }

  const subscription = rows[0];
  const invoiceNumber = `PBS-${new Date().toISOString().slice(0, 7).replace('-', '')}-${subscription.id.replace(/-/g, '').slice(0, 6).toUpperCase()}-${Date.now().toString().slice(-4)}`;
  const invoiceResult = await query(
    `INSERT INTO organization_invoices (
      organization_subscription_id,
      invoice_number,
      status,
      amount,
      currency,
      period_start,
      period_end,
      due_date,
      note,
      metadata
    ) VALUES (
      $1,$2,'unpaid',$3,$4,
      date_trunc('month', CURRENT_DATE)::date,
      (date_trunc('month', CURRENT_DATE) + interval '1 month - 1 day')::date,
      (CURRENT_DATE + interval '7 day')::date,
      $5,
      $6
    ) RETURNING *`,
    [
      subscription.id,
      invoiceNumber,
      Number(req.body.amount ?? subscription.base_price),
      subscription.currency,
      req.body.note || `${subscription.plan_name} ek fatura`,
      JSON.stringify({ source: 'manual_generate' })
    ]
  );

  return res.status(201).json({ success: true, data: invoiceResult.rows[0] });
});

router.patch('/invoices/:id/status', auth, async (req, res) => {
  const nextStatus = String(req.body.status || '').trim();
  if (!['paid', 'unpaid', 'overdue'].includes(nextStatus)) {
    return res.status(400).json({ success: false, message: 'Geçersiz fatura durumu' });
  }

  const { rows } = await query(
    `UPDATE organization_invoices
      SET status = $1::varchar,
        paid_at = CASE WHEN $1::text = 'paid' THEN NOW() ELSE NULL END,
            updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [nextStatus, req.params.id]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'Fatura bulunamadı' });
  }

  return res.json({ success: true, data: rows[0] });
});

router.patch('/invoices/:id/note', auth, async (req, res) => {
  const note = String(req.body.note || '').trim();
  const { rows } = await query(
    `UPDATE organization_invoices
        SET note = $1,
            updated_at = NOW()
      WHERE id = $2
      RETURNING *`,
    [note || null, req.params.id]
  );

  if (!rows.length) {
    return res.status(404).json({ success: false, message: 'Fatura bulunamadı' });
  }

  return res.json({ success: true, data: rows[0] });
});

router.post('/invoices/:id/payments', auth, async (req, res) => {
  const amount = Number(req.body.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ success: false, message: 'Geçerli bir ödeme tutarı girin' });
  }

  const invoiceResult = await query(
    `SELECT *
       FROM organization_invoices
      WHERE id = $1
      LIMIT 1`,
    [req.params.id]
  );

  if (!invoiceResult.rows.length) {
    return res.status(404).json({ success: false, message: 'Fatura bulunamadı' });
  }

  const invoice = invoiceResult.rows[0];
  const paymentInsert = await query(
    `INSERT INTO organization_invoice_payments (
        invoice_id,
        amount,
        currency,
        payment_method,
        payment_reference,
        collected_at,
        note
      ) VALUES ($1,$2,$3,$4,$5,$6,$7)
      RETURNING *`,
    [
      invoice.id,
      amount,
      invoice.currency,
      req.body.payment_method || 'bank_transfer',
      req.body.payment_reference || null,
      req.body.collected_at || new Date().toISOString(),
      req.body.note || null
    ]
  );

  const paymentTotalResult = await query(
    `SELECT COALESCE(SUM(amount), 0)::numeric(12,2) AS total_paid,
            MAX(collected_at) AS last_collected_at
       FROM organization_invoice_payments
      WHERE invoice_id = $1`,
    [invoice.id]
  );

  const totalPaid = Number(paymentTotalResult.rows[0].total_paid || 0);
  const dueDate = invoice.due_date ? new Date(invoice.due_date) : null;
  const nextStatus = totalPaid >= Number(invoice.amount || 0)
    ? 'paid'
    : (dueDate && dueDate < new Date() ? 'overdue' : 'unpaid');
    const nextPaidAt = nextStatus === 'paid'
      ? paymentTotalResult.rows[0].last_collected_at
      : null;

  const updateResult = await query(
    `UPDATE organization_invoices
      SET status = $1::varchar,
            paid_at = $2::timestamptz,
            updated_at = NOW()
      WHERE id = $3
      RETURNING *`,
      [nextStatus, nextPaidAt, invoice.id]
  );

  return res.status(201).json({
    success: true,
    data: {
      payment: paymentInsert.rows[0],
      invoice: updateResult.rows[0],
      total_paid: totalPaid
    }
  });
});

router.get('/billing/export', auth, async (req, res) => {
  const organizationId = String(req.query.organization_id || '').trim();
  const params = [];
  let whereClause = '';

  if (organizationId) {
    params.push(organizationId);
    whereClause = 'WHERE o.id = $1';
  }

  const { rows } = await query(
    `SELECT o.name AS organization_name,
            o.slug AS organization_slug,
            p.name AS product_name,
            s.plan_name,
            i.invoice_number,
            i.status,
            i.amount,
            i.currency,
            i.due_date,
            i.paid_at,
            i.note,
            COALESCE(SUM(pay.amount), 0)::numeric(12,2) AS paid_total,
            MAX(pay.collected_at) AS last_collection_date
       FROM organization_invoices i
       JOIN organization_subscriptions s ON s.id = i.organization_subscription_id
       JOIN organizations o ON o.id = s.organization_id
       JOIN product_templates p ON p.id = s.product_template_id
       LEFT JOIN organization_invoice_payments pay ON pay.invoice_id = i.id
       ${whereClause}
      GROUP BY o.name, o.slug, p.name, s.plan_name, i.invoice_number, i.status, i.amount, i.currency, i.due_date, i.paid_at, i.note
      ORDER BY o.name ASC, i.due_date DESC`,
    params
  );

  const escapeCsv = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const csv = [
    ['organization_name', 'organization_slug', 'product_name', 'plan_name', 'invoice_number', 'status', 'amount', 'currency', 'paid_total', 'due_date', 'paid_at', 'last_collection_date', 'note'].join(','),
    ...rows.map((row) => [
      row.organization_name,
      row.organization_slug,
      row.product_name,
      row.plan_name,
      row.invoice_number,
      row.status,
      Number(row.amount || 0).toFixed(2),
      row.currency,
      Number(row.paid_total || 0).toFixed(2),
      row.due_date ? new Date(row.due_date).toISOString() : '',
      row.paid_at ? new Date(row.paid_at).toISOString() : '',
      row.last_collection_date ? new Date(row.last_collection_date).toISOString() : '',
      row.note || ''
    ].map(escapeCsv).join(','))
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="pbssiteadmin-billing-${new Date().toISOString().slice(0, 10)}.csv"`);
  return res.send(csv);
});

router.post('/integrations/:id/probe', auth, async (req, res) => {
  const connection = await loadIntegrationConnection(req.params.id);

  if (!connection) {
    return res.status(404).json({ success: false, message: 'API bağlantısı bulunamadı' });
  }

  const targetUrl = buildRemoteUrl(connection.base_url, connection.health_path, '/health');

  let status = 'healthy';
  let message = 'Health-check başarılı';

  try {
    const response = await fetch(targetUrl, { headers: buildRemoteHeaders(connection) });
    if (!response.ok) {
      status = response.status >= 500 ? 'offline' : 'degraded';
      message = `HTTP ${response.status}`;
    }
  } catch (error) {
    status = 'offline';
    message = error.message;
  }

  const updateResult = await updateConnectionState(connection.id, status, message, {
    last_probe_type: 'health',
    last_probe_at: new Date().toISOString(),
    last_probe_url: targetUrl
  });

  return res.json({ success: true, data: updateResult });
});

router.post('/integrations/:id/probe-login', auth, async (req, res) => {
  const connection = await loadIntegrationConnection(req.params.id);

  if (!connection) {
    return res.status(404).json({ success: false, message: 'API bağlantısı bulunamadı' });
  }

  try {
    const session = await loginToRemoteConnection(connection);
    const updatedConnection = await updateConnectionState(connection.id, 'healthy', 'Login tabanlı probe başarılı', {
      last_probe_type: 'login',
      last_probe_at: new Date().toISOString(),
      last_remote_user: session.user
    });

    return res.json({
      success: true,
      data: {
        connection: updatedConnection,
        remote_user: session.user
      }
    });
  } catch (error) {
    const updatedConnection = await updateConnectionState(connection.id, 'offline', error.message, {
      last_probe_type: 'login',
      last_probe_at: new Date().toISOString()
    });

    return res.status(502).json({
      success: false,
      message: error.message,
      data: { connection: updatedConnection }
    });
  }
});

router.post('/integrations/:id/sync', auth, async (req, res) => {
  const connection = await loadIntegrationConnection(req.params.id);

  if (!connection) {
    return res.status(404).json({ success: false, message: 'API bağlantısı bulunamadı' });
  }

  if (!connection.subscription_id) {
    return res.status(400).json({ success: false, message: 'Bu entegrasyon için bağlı abonelik bulunamadı' });
  }

  if (connection.sync_type !== 'mobilkiratakip_property_management') {
    return res.status(400).json({ success: false, message: 'Bu entegrasyon için otomatik senkronizasyon tanımlı değil' });
  }

  try {
    const session = await loginToRemoteConnection(connection);
    const syncResult = await syncMobilKiraTakipUsage(connection, session.token);
    const updatedConnection = await updateConnectionState(connection.id, 'healthy', 'Tenant kullanım verisi senkronize edildi', {
      last_probe_type: 'sync',
      last_probe_at: new Date().toISOString(),
      last_sync: syncResult,
      last_remote_user: session.user
    });

    return res.json({
      success: true,
      data: {
        connection: updatedConnection,
        sync: syncResult
      }
    });
  } catch (error) {
    const updatedConnection = await updateConnectionState(connection.id, 'offline', error.message, {
      last_probe_type: 'sync',
      last_probe_at: new Date().toISOString()
    });

    return res.status(502).json({
      success: false,
      message: error.message,
      data: { connection: updatedConnection }
    });
  }
});

module.exports = router;
