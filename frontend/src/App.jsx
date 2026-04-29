import { Fragment, useDeferredValue, useEffect, useMemo, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || '/api/v1';
const currency = new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 });

const fetchJson = async (path, options = {}) => {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    }
  });

  const payload = await response.json();
  if (!response.ok || payload.success === false) {
    throw new Error(payload.message || 'İstek başarısız');
  }

  return payload;
};

const emptyLogin = { email: 'superadmin@pbssiteadmin.local', password: 'SuperAdmin123!' };

const readSelectedOrganizationId = () => {
  if (typeof window === 'undefined') {
    return '';
  }

  return new URLSearchParams(window.location.search).get('organization') || '';
};

const syncSelectedOrganizationId = (organizationId, mode = 'push') => {
  if (typeof window === 'undefined') {
    return;
  }

  const url = new URL(window.location.href);
  if (organizationId) {
    url.searchParams.set('organization', organizationId);
  } else {
    url.searchParams.delete('organization');
  }

  window.history[mode === 'replace' ? 'replaceState' : 'pushState']({}, '', `${url.pathname}${url.search}${url.hash}`);
};

function SummaryCard({ label, value, detail, tone = 'slate' }) {
  return (
    <div className={`summary-card tone-${tone}`}>
      <div className="eyebrow">{label}</div>
      <div className="summary-value">{value}</div>
      <div className="summary-detail">{detail}</div>
    </div>
  );
}

function getOrganizationMonthlyRevenue(organization) {
  return organization.subscriptions.reduce((total, subscription) => total + Number(subscription.base_price || 0), 0);
}

function getOrganizationOpenReceivable(organization) {
  return organization.subscriptions.reduce(
    (total, subscription) => total + Number(subscription.invoice_summary?.amount_total || 0),
    0
  );
}

function getOrganizationIntegrationSummary(organization) {
  const integrations = organization.subscriptions.map((subscription) => subscription.integration).filter(Boolean);

  if (!integrations.length) {
    return { label: 'Entegrasyon yok', tone: 'inactive' };
  }

  if (integrations.some((integration) => integration.status === 'offline')) {
    return { label: 'Sorun var', tone: 'integration-offline' };
  }

  if (integrations.some((integration) => integration.status === 'degraded')) {
    return { label: 'İzlenmeli', tone: 'integration-degraded' };
  }

  if (integrations.every((integration) => integration.status === 'healthy')) {
    return { label: 'Sağlıklı', tone: 'integration-healthy' };
  }

  return { label: 'Beklemede', tone: 'integration-pending' };
}

const invoiceStatusLabel = {
  paid: 'Ödendi',
  unpaid: 'Ödenmedi',
  overdue: 'Gecikmiş'
};

function MetricEditor({ subscription, draft, onChange, onSave, isSaving }) {
  const metrics = subscription.product_template.metric_definitions || [];

  return (
    <div className="metric-editor">
      {metrics.map((metric) => {
        const currentValue = draft?.[metric.key] ?? subscription.current_usage?.[metric.key] ?? 0;
        const limitValue = subscription.metric_limits?.[metric.key] ?? 0;
        const ratio = limitValue ? Math.min(Math.round((Number(currentValue) / Number(limitValue)) * 100), 100) : 0;

        return (
          <div className="metric-tile" key={`${subscription.id}-${metric.key}`}>
            <div className="metric-head">
              <div>
                <div className="metric-label">{metric.label}</div>
                <div className="metric-meta">Limit: {limitValue} {metric.unit}</div>
              </div>
              <div className="metric-ratio">%{ratio}</div>
            </div>
            <input
              type="number"
              min="0"
              value={currentValue}
              onChange={(event) => onChange(subscription.id, metric.key, Number(event.target.value))}
            />
          </div>
        );
      })}
      <button type="button" className="secondary-button" onClick={() => onSave(subscription)} disabled={isSaving}>
        {isSaving ? 'Kaydediliyor...' : 'Kullanımı Güncelle'}
      </button>
    </div>
  );
}

function OrganizationEditor({ organization, onSave, isSaving }) {
  const [form, setForm] = useState({
    organization_name: organization.name || '',
    slug: organization.slug || '',
    contact_email: organization.contact_email || '',
    contact_phone: organization.contact_phone || ''
  });

  useEffect(() => {
    setForm({
      organization_name: organization.name || '',
      slug: organization.slug || '',
      contact_email: organization.contact_email || '',
      contact_phone: organization.contact_phone || ''
    });
  }, [organization]);

  return (
    <div className="editor-card">
      <div className="editor-head">
        <div>
          <div className="eyebrow">Organizasyon Ayarları</div>
          <strong>{organization.name}</strong>
        </div>
      </div>
      <div className="form-grid two editor-form">
        <label>
          <span>Organizasyon</span>
          <input value={form.organization_name} onChange={(event) => setForm({ ...form, organization_name: event.target.value })} />
        </label>
        <label>
          <span>Slug</span>
          <input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} />
        </label>
        <label>
          <span>İletişim E-postası</span>
          <input type="email" value={form.contact_email} onChange={(event) => setForm({ ...form, contact_email: event.target.value })} />
        </label>
        <label>
          <span>Telefon</span>
          <input value={form.contact_phone} onChange={(event) => setForm({ ...form, contact_phone: event.target.value })} />
        </label>
      </div>
      <div className="editor-actions">
        <button type="button" className="secondary-button" onClick={() => onSave(organization.id, form)} disabled={isSaving}>
          {isSaving ? 'Kaydediliyor...' : 'Organizasyonu Güncelle'}
        </button>
      </div>
    </div>
  );
}

function SubscriptionPlanEditor({ subscription, plans, onSave, isSaving }) {
  const [pricingPlanId, setPricingPlanId] = useState(subscription.pricing_plan?.id || '');
  const [note, setNote] = useState('');

  useEffect(() => {
    setPricingPlanId(subscription.pricing_plan?.id || '');
    setNote('');
  }, [subscription]);

  if (!plans.length) {
    return null;
  }

  return (
    <div className="editor-card editor-card-soft">
      <div className="editor-head">
        <div>
          <div className="eyebrow">Paket Yönetimi</div>
          <strong>{subscription.product_template.name} planını güncelle</strong>
        </div>
      </div>
      <div className="form-grid two editor-form">
        <label>
          <span>Fiyat Planı</span>
          <select value={pricingPlanId} onChange={(event) => setPricingPlanId(event.target.value)}>
            <option value="">Plan seçin</option>
            {plans.map((plan) => (
              <option key={plan.id} value={plan.id}>{plan.name} • {currency.format(plan.monthly_price)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>İşlem Notu</span>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Opsiyonel açıklama" />
        </label>
      </div>
      <div className="editor-note">Property Management ürününde bu işlem MobilKiraTakip tenant paketini de günceller.</div>
      <div className="editor-actions">
        <button
          type="button"
          className="secondary-button"
          onClick={() => onSave(subscription.id, { pricing_plan_id: pricingPlanId, note })}
          disabled={isSaving || !pricingPlanId || pricingPlanId === (subscription.pricing_plan?.id || '')}
        >
          {isSaving ? 'Paket güncelleniyor...' : 'Paketi Güncelle'}
        </button>
      </div>
    </div>
  );
}

function PlanRequestPanel({ requests, onResolve, resolvingId }) {
  const pendingCount = requests.filter((request) => request.status === 'pending').length;

  return (
    <div className="panel">
      <div className="panel-head">
        <div>
          <div className="eyebrow">MobilKiraTakip Talepleri</div>
          <h3>Paket yükseltme talepleri site admin paneline düşüyor</h3>
        </div>
      </div>
      <div className="invoice-summary-strip">
        <div><strong>{requests.length}</strong><span>Toplam talep</span></div>
        <div><strong>{pendingCount}</strong><span>Bekleyen</span></div>
        <div><strong>{requests.filter((request) => request.status === 'approved').length}</strong><span>Onaylanan</span></div>
      </div>
      <div className="invoice-list">
        {requests.length ? requests.map((request) => (
          <div className="invoice-row" key={request.id}>
            <div>
              <strong>{request.local_organization_name || request.organization_name}</strong>
              <span>{request.metadata?.current_plan || '-'} → {request.metadata?.requested_plan || '-'}</span>
              <span>{request.actor_name || '-'} • {request.actor_email || '-'} • {new Date(request.created_at).toLocaleString('tr-TR')}</span>
              <span>{request.metadata?.note || request.description || 'Not yok'}</span>
              {request.decision && <span>Karar: {request.decision.event_label} • {request.decision.note || 'Not yok'}</span>}
            </div>
            <div className="invoice-actions">
              <span className={`status-pill ${request.status === 'approved' ? 'active' : request.status === 'rejected' ? 'inactive' : 'integration-pending'}`}>
                {request.status === 'approved' ? 'Onaylandı' : request.status === 'rejected' ? 'Reddedildi' : 'Bekliyor'}
              </span>
              {request.status === 'pending' && (
                <>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => onResolve(request, 'approve')}
                    disabled={resolvingId === request.id}
                  >
                    {resolvingId === request.id ? 'İşleniyor...' : 'Onayla'}
                  </button>
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => onResolve(request, 'reject')}
                    disabled={resolvingId === request.id}
                  >
                    {resolvingId === request.id ? 'İşleniyor...' : 'Reddet'}
                  </button>
                </>
              )}
            </div>
          </div>
        )) : <div className="invoice-row"><div><strong>Talep yok</strong><span>MobilKiraTakip tarafından açılan paket yükseltme talebi henüz gelmedi.</span></div></div>}
      </div>
    </div>
  );
}

function IntegrationEditor({ integration, onSave, isSaving }) {
  const [form, setForm] = useState({
    base_url: integration.base_url || '',
    health_path: integration.health_path || '/health',
    login_path: integration.login_path || '/api/v1/auth/login',
    me_path: integration.me_path || '/api/v1/auth/me',
    auth_type: integration.auth_type || 'none',
    auth_value: integration.auth_value || '',
    login_email: integration.login_email || '',
    login_password: '',
    sync_type: integration.sync_type || 'none'
  });

  useEffect(() => {
    setForm({
      base_url: integration.base_url || '',
      health_path: integration.health_path || '/health',
      login_path: integration.login_path || '/api/v1/auth/login',
      me_path: integration.me_path || '/api/v1/auth/me',
      auth_type: integration.auth_type || 'none',
      auth_value: integration.auth_value || '',
      login_email: integration.login_email || '',
      login_password: '',
      sync_type: integration.sync_type || 'none'
    });
  }, [integration]);

  return (
    <div className="editor-card editor-card-soft">
      <div className="editor-head">
        <div>
          <div className="eyebrow">Entegrasyon Düzenle</div>
          <strong>{integration.base_url}</strong>
        </div>
      </div>
      <div className="form-grid two editor-form">
        <label>
          <span>API Base URL</span>
          <input value={form.base_url} onChange={(event) => setForm({ ...form, base_url: event.target.value })} />
        </label>
        <label>
          <span>Health Path</span>
          <input value={form.health_path} onChange={(event) => setForm({ ...form, health_path: event.target.value })} />
        </label>
        <label>
          <span>Login Path</span>
          <input value={form.login_path} onChange={(event) => setForm({ ...form, login_path: event.target.value })} />
        </label>
        <label>
          <span>Me Path</span>
          <input value={form.me_path} onChange={(event) => setForm({ ...form, me_path: event.target.value })} />
        </label>
        <label>
          <span>Login E-postası</span>
          <input type="email" value={form.login_email} onChange={(event) => setForm({ ...form, login_email: event.target.value })} />
        </label>
        <label>
          <span>Yeni Login Şifresi</span>
          <input type="password" value={form.login_password} onChange={(event) => setForm({ ...form, login_password: event.target.value })} placeholder="Boş bırakırsanız değişmez" />
        </label>
        <label>
          <span>Auth Type</span>
          <select value={form.auth_type} onChange={(event) => setForm({ ...form, auth_type: event.target.value })}>
            <option value="none">None</option>
            <option value="bearer">Bearer</option>
            <option value="api_key">API Key</option>
          </select>
        </label>
        <label>
          <span>Auth Value</span>
          <input value={form.auth_value} onChange={(event) => setForm({ ...form, auth_value: event.target.value })} placeholder="Bearer token veya API key" />
        </label>
        <label>
          <span>Senkronizasyon Tipi</span>
          <select value={form.sync_type} onChange={(event) => setForm({ ...form, sync_type: event.target.value })}>
            <option value="none">Senkronizasyon yok</option>
            <option value="mobilkiratakip_property_management">MobilKiraTakip kullanım senkronizasyonu</option>
          </select>
        </label>
      </div>
      <div className="editor-note">Şifre alanı yalnızca yeni bir değer yazarsanız güncellenir.</div>
      <div className="editor-actions">
        <button type="button" className="secondary-button" onClick={() => onSave(integration.id, form)} disabled={isSaving}>
          {isSaving ? 'Kaydediliyor...' : 'Entegrasyonu Güncelle'}
        </button>
      </div>
    </div>
  );
}

function OnboardingForm({ templates, plans, onCreate, isSaving }) {
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [form, setForm] = useState({
    organization_name: '',
    slug: '',
    contact_email: '',
    contact_phone: '',
    plan_name: '',
    base_price: '',
    status: 'trial',
    billing_cycle_months: 1,
    base_url: '',
    health_path: '/health',
    login_path: '/api/v1/auth/login',
    me_path: '/api/v1/auth/me',
    auth_type: 'none',
    login_email: '',
    login_password: '',
    sync_type: 'none',
    note: ''
  });
  const [limits, setLimits] = useState({});
  const [usage, setUsage] = useState({});

  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || null,
    [selectedTemplateId, templates]
  );
  const availablePlans = useMemo(
    () => plans.filter((plan) => plan.product_template_id === selectedTemplateId),
    [plans, selectedTemplateId]
  );
  const selectedPlan = useMemo(
    () => availablePlans.find((plan) => plan.id === selectedPlanId) || null,
    [availablePlans, selectedPlanId]
  );

  useEffect(() => {
    if (!selectedTemplate) {
      return;
    }

    const nextLimits = {};
    const nextUsage = {};
    selectedTemplate.metric_definitions.forEach((metric) => {
      nextLimits[metric.key] = limits[metric.key] ?? 0;
      nextUsage[metric.key] = usage[metric.key] ?? 0;
    });
    setLimits(nextLimits);
    setUsage(nextUsage);
    setForm((current) => ({
      ...current,
      plan_name: current.plan_name || `${selectedTemplate.name} Standart`,
      base_price: current.base_price || selectedTemplate.default_base_price,
      sync_type: selectedTemplate.code === 'property_management' ? 'mobilkiratakip_property_management' : 'none'
    }));
  }, [selectedTemplate]);

  useEffect(() => {
    if (!selectedPlan) {
      return;
    }

    setLimits(selectedPlan.included_limits || {});
    setForm((current) => ({
      ...current,
      plan_name: selectedPlan.name,
      base_price: selectedPlan.monthly_price
    }));
  }, [selectedPlan]);

  const submit = (event) => {
    event.preventDefault();
    onCreate({
      ...form,
      product_template_id: selectedTemplateId,
      pricing_plan_id: selectedPlanId,
      base_price: Number(form.base_price || 0),
      billing_cycle_months: Number(form.billing_cycle_months || 1),
      metric_limits: limits,
      current_usage: usage
    });
  };

  return (
    <form className="panel panel-form" onSubmit={submit}>
      <div className="panel-head">
        <div>
          <div className="eyebrow">Yeni Kiralama</div>
          <h3>Organizasyon + ürün aboneliği aç</h3>
        </div>
      </div>

      <div className="form-grid two">
        <label>
          <span>Organizasyon</span>
          <input value={form.organization_name} onChange={(event) => setForm({ ...form, organization_name: event.target.value })} required />
        </label>
        <label>
          <span>Slug</span>
          <input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder="opsiyonel" />
        </label>
        <label>
          <span>İletişim E-postası</span>
          <input type="email" value={form.contact_email} onChange={(event) => setForm({ ...form, contact_email: event.target.value })} />
        </label>
        <label>
          <span>Telefon</span>
          <input value={form.contact_phone} onChange={(event) => setForm({ ...form, contact_phone: event.target.value })} />
        </label>
      </div>

      <div className="form-grid three">
        <label>
          <span>Ürün</span>
          <select value={selectedTemplateId} onChange={(event) => { setSelectedTemplateId(event.target.value); setSelectedPlanId(''); }} required>
            <option value="">Ürün seçin</option>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>{template.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Plan Kataloğu</span>
          <select value={selectedPlanId} onChange={(event) => setSelectedPlanId(event.target.value)} disabled={!selectedTemplateId}>
            <option value="">Elle tanımla / plan seç</option>
            {availablePlans.map((plan) => (
              <option key={plan.id} value={plan.id}>{plan.name} • {currency.format(plan.monthly_price)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Plan Adı</span>
          <input value={form.plan_name} onChange={(event) => setForm({ ...form, plan_name: event.target.value })} required />
        </label>
      </div>

      <div className="form-grid three">
        <label>
          <span>Aylık Bedel</span>
          <input type="number" min="0" value={form.base_price} onChange={(event) => setForm({ ...form, base_price: event.target.value })} />
        </label>
        <label>
          <span>Fatura Döngüsü (ay)</span>
          <input type="number" min="1" value={form.billing_cycle_months} onChange={(event) => setForm({ ...form, billing_cycle_months: event.target.value })} />
        </label>
        <label>
          <span>Durum</span>
          <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
            <option value="trial">Trial</option>
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label>
          <span>API Base URL</span>
          <input value={form.base_url} onChange={(event) => setForm({ ...form, base_url: event.target.value })} placeholder="https://product.example.com/api" />
        </label>
      </div>

      <div className="form-grid three">
        <label>
          <span>Login Path</span>
          <input value={form.login_path} onChange={(event) => setForm({ ...form, login_path: event.target.value })} />
        </label>
        <label>
          <span>Me Path</span>
          <input value={form.me_path} onChange={(event) => setForm({ ...form, me_path: event.target.value })} />
        </label>
        <label>
          <span>Senkronizasyon Tipi</span>
          <select value={form.sync_type} onChange={(event) => setForm({ ...form, sync_type: event.target.value })}>
            <option value="none">Senkronizasyon yok</option>
            <option value="mobilkiratakip_property_management">MobilKiraTakip kullanım senkronizasyonu</option>
          </select>
        </label>
      </div>

      <div className="form-grid two">
        <label>
          <span>Entegrasyon Login E-postası</span>
          <input type="email" value={form.login_email} onChange={(event) => setForm({ ...form, login_email: event.target.value })} placeholder="tenant-admin@example.com" />
        </label>
        <label>
          <span>Entegrasyon Login Şifresi</span>
          <input type="password" value={form.login_password} onChange={(event) => setForm({ ...form, login_password: event.target.value })} placeholder="Harici ürün şifresi" />
        </label>
      </div>

      {selectedTemplate && (
        <div className="metric-config">
          <div className="section-title">Kota ve kullanım tanımı</div>
          <div className="form-grid two">
            {selectedTemplate.metric_definitions.map((metric) => (
              <div className="metric-config-row" key={metric.key}>
                <label>
                  <span>{metric.label} limiti</span>
                  <input type="number" min="0" value={limits[metric.key] ?? 0} onChange={(event) => setLimits({ ...limits, [metric.key]: Number(event.target.value) })} />
                </label>
                <label>
                  <span>{metric.label} mevcut kullanım</span>
                  <input type="number" min="0" value={usage[metric.key] ?? 0} onChange={(event) => setUsage({ ...usage, [metric.key]: Number(event.target.value) })} />
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="form-grid three">
        <label>
          <span>Health Path</span>
          <input value={form.health_path} onChange={(event) => setForm({ ...form, health_path: event.target.value })} />
        </label>
        <label>
          <span>Auth Type</span>
          <select value={form.auth_type} onChange={(event) => setForm({ ...form, auth_type: event.target.value })}>
            <option value="none">None</option>
            <option value="bearer">Bearer</option>
            <option value="api_key">API Key</option>
          </select>
        </label>
        <label>
          <span>Not</span>
          <input value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
        </label>
      </div>

      <button className="primary-button" disabled={isSaving}>
        {isSaving ? 'Açılıyor...' : 'Organizasyonu Aç'}
      </button>
    </form>
  );
}

function OrganizationWorkspace({
  organization,
  plans,
  usageDrafts,
  onBack,
  onSaveOrganization,
  onSaveUsage,
  onSavePlan,
  onProbeConnection,
  onSyncConnection,
  onSaveIntegration,
  onExportBilling,
  onCreateInvoice,
  onUpdateInvoiceNote,
  onRecordInvoicePayment,
  onSetInvoiceStatus,
  onUsageChange,
  savingOrganizationId,
  savingSubscriptionId,
  savingPlanSubscriptionId,
  probingConnectionId,
  syncingConnectionId,
  savingIntegrationId,
  invoiceActionId,
  exportingScope
}) {
  const integrationSummary = getOrganizationIntegrationSummary(organization);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedSubscriptionId, setSelectedSubscriptionId] = useState(organization.subscriptions[0]?.id || '');

  useEffect(() => {
    setActiveTab('overview');
    setSelectedSubscriptionId(organization.subscriptions[0]?.id || '');
  }, [organization.id]);

  const selectedSubscription = organization.subscriptions.find((subscription) => subscription.id === selectedSubscriptionId)
    || organization.subscriptions[0]
    || null;

  const workspaceTabs = [
    { id: 'overview', label: 'Genel Bakis' },
    { id: 'operations', label: 'Operasyon' },
    { id: 'integration', label: 'Entegrasyon' },
    { id: 'billing', label: 'Faturalama' }
  ];

  return (
    <section className="workspace-shell">
      <div className="workspace-header panel">
        <div>
          <div className="eyebrow">Organizasyon Detay Sayfası</div>
          <h2>{organization.name}</h2>
          <p>{organization.slug} • {organization.contact_email || 'E-posta yok'} • {organization.contact_phone || 'Telefon yok'}</p>
        </div>
        <div className="workspace-actions">
          <span className={`status-pill ${organization.is_active ? 'active' : 'inactive'}`}>
            {organization.is_active ? 'Aktif organizasyon' : 'Pasif organizasyon'}
          </span>
          <button type="button" className="secondary-button" onClick={onBack}>Organizasyon Listesine Dön</button>
        </div>
      </div>

      <section className="workspace-summary-grid">
        <SummaryCard
          label="Abonelik Sayısı"
          value={organization.subscriptions.length}
          detail="bu organizasyona bağlı ürün"
          tone="sky"
        />
        <SummaryCard
          label="Aylık Gelir"
          value={currency.format(getOrganizationMonthlyRevenue(organization))}
          detail="aktif ve trial gelir toplamı"
          tone="emerald"
        />
        <SummaryCard
          label="Açık Tahsilat"
          value={currency.format(getOrganizationOpenReceivable(organization))}
          detail="organizasyon bazlı tahsilat durumu"
          tone="amber"
        />
        <SummaryCard
          label="Entegrasyon"
          value={integrationSummary.label}
          detail="bağlantı sağlık özeti"
          tone="rose"
        />
      </section>

      <section className="workspace-layout">
        <div className="workspace-sidebar">
          <OrganizationEditor
            organization={organization}
            onSave={onSaveOrganization}
            isSaving={savingOrganizationId === organization.id}
          />
          <div className="panel workspace-subscription-index">
            <div className="panel-head compact-head">
              <div>
                <div className="eyebrow">Ürünler</div>
                <h3>Bağlı abonelikler</h3>
              </div>
            </div>
            <div className="workspace-index-list">
              {organization.subscriptions.map((subscription) => (
                <button
                  type="button"
                  className={`workspace-index-item ${selectedSubscription?.id === subscription.id ? 'is-active' : ''}`}
                  key={`${organization.id}-${subscription.id}`}
                  onClick={() => setSelectedSubscriptionId(subscription.id)}
                >
                  <strong>{subscription.product_template.name}</strong>
                  <span>{subscription.plan_name}</span>
                  <span>{currency.format(subscription.base_price)} / {subscription.billing_cycle_months} ay</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="workspace-main">
          {selectedSubscription && (
            <>
              <div className="panel workspace-tab-panel">
                <div className="workspace-tab-list" role="tablist" aria-label="Organizasyon detay sekmeleri">
                  {workspaceTabs.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      className={`workspace-tab ${activeTab === tab.id ? 'is-active' : ''}`}
                      onClick={() => setActiveTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="workspace-selected-hero">
                  <div>
                    <div className="subscription-product">{selectedSubscription.product_template.name}</div>
                    <h3>{selectedSubscription.plan_name}</h3>
                    <p>{currency.format(selectedSubscription.base_price)} / {selectedSubscription.billing_cycle_months} ay • Yenileme: {selectedSubscription.renewal_at ? new Date(selectedSubscription.renewal_at).toLocaleDateString('tr-TR') : '-'}</p>
                  </div>
                  <span className={`status-pill status-${selectedSubscription.status}`}>{selectedSubscription.status}</span>
                </div>
              </div>

              {activeTab === 'overview' && (
                <div className="workspace-overview-grid">
                  <div className="subscription-card workspace-subscription-card">
                    <div className="subscription-head">
                      <div>
                        <div className="eyebrow">Plan Özeti</div>
                        <h3>{selectedSubscription.plan_name}</h3>
                        <p>{selectedSubscription.pricing_plan ? `${selectedSubscription.pricing_plan.name} • Plan kataloğundan bağlı` : 'Özel plan tanımı'}</p>
                      </div>
                      <span className={`status-pill status-${selectedSubscription.status}`}>{selectedSubscription.status}</span>
                    </div>
                    <div className="workspace-facts-grid">
                      <div className="workspace-fact-card"><span>Aylık Bedel</span><strong>{currency.format(selectedSubscription.base_price)}</strong></div>
                      <div className="workspace-fact-card"><span>Fatura Döngüsü</span><strong>{selectedSubscription.billing_cycle_months} ay</strong></div>
                      <div className="workspace-fact-card"><span>Açık Tahsilat</span><strong>{currency.format(selectedSubscription.invoice_summary.amount_total || 0)}</strong></div>
                      <div className="workspace-fact-card"><span>Entegrasyon</span><strong>{selectedSubscription.integration?.status || 'yok'}</strong></div>
                    </div>
                  </div>
                  <div className="subscription-card workspace-subscription-card">
                    <div className="panel-head compact-head">
                      <div>
                        <div className="eyebrow">Kullanım Özeti</div>
                        <h3>Seçili ürün metrikleri</h3>
                      </div>
                    </div>
                    <div className="workspace-metric-list">
                      {(selectedSubscription.product_template.metric_definitions || []).map((metric) => {
                        const currentValue = usageDrafts[selectedSubscription.id]?.[metric.key] ?? selectedSubscription.current_usage?.[metric.key] ?? 0;
                        const limitValue = selectedSubscription.metric_limits?.[metric.key] ?? 0;
                        return (
                          <div className="workspace-metric-row" key={`${selectedSubscription.id}-${metric.key}`}>
                            <div>
                              <strong>{metric.label}</strong>
                              <span>{currentValue} / {limitValue} {metric.unit}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {activeTab === 'operations' && (
                <div className="subscription-card workspace-subscription-card">
                  <MetricEditor
                    subscription={selectedSubscription}
                    draft={usageDrafts[selectedSubscription.id]}
                    onChange={onUsageChange}
                    onSave={onSaveUsage}
                    isSaving={savingSubscriptionId === selectedSubscription.id}
                  />
                  <SubscriptionPlanEditor
                    subscription={selectedSubscription}
                    plans={plans.filter((plan) => plan.product_template_id === selectedSubscription.product_template.id)}
                    onSave={onSavePlan}
                    isSaving={savingPlanSubscriptionId === selectedSubscription.id}
                  />
                </div>
              )}

              {activeTab === 'integration' && (
                <div className="subscription-card workspace-subscription-card">
                  {selectedSubscription.integration ? (
                    <Fragment>
                      <div className="integration-box">
                        <div>
                          <div className="eyebrow">API Entegrasyonu</div>
                          <strong>{selectedSubscription.integration.base_url}</strong>
                          <div className="integration-meta">{selectedSubscription.integration.health_path} • {selectedSubscription.integration.last_health_message || 'Health-check yok'}</div>
                          <div className="integration-meta">Login: {selectedSubscription.integration.login_email || 'tanımsız'} • Sync: {selectedSubscription.integration.sync_type || 'none'}</div>
                        </div>
                        <div className="integration-actions">
                          <span className={`status-pill integration-${selectedSubscription.integration.status}`}>{selectedSubscription.integration.status}</span>
                          <div className="action-wrap">
                            <button type="button" className="ghost-button" onClick={() => onProbeConnection(selectedSubscription.integration.id)} disabled={probingConnectionId === selectedSubscription.integration.id}>
                              {probingConnectionId === selectedSubscription.integration.id ? 'Test ediliyor...' : 'Health Probe'}
                            </button>
                            <button type="button" className="ghost-button" onClick={() => onProbeConnection(selectedSubscription.integration.id, 'login')} disabled={probingConnectionId === selectedSubscription.integration.id}>
                              {probingConnectionId === selectedSubscription.integration.id ? 'Login deneniyor...' : 'Login Probe'}
                            </button>
                            <button type="button" className="secondary-button" onClick={() => onSyncConnection(selectedSubscription.integration.id)} disabled={syncingConnectionId === selectedSubscription.integration.id}>
                              {syncingConnectionId === selectedSubscription.integration.id ? 'Senkronize ediliyor...' : 'Tenant Sync'}
                            </button>
                          </div>
                        </div>
                      </div>
                      <IntegrationEditor
                        integration={selectedSubscription.integration}
                        onSave={onSaveIntegration}
                        isSaving={savingIntegrationId === selectedSubscription.integration.id}
                      />
                    </Fragment>
                  ) : (
                    <div className="empty-compact-state">
                      <strong>Entegrasyon tanımı yok</strong>
                      <span>Bu abonelik için ayrı bir API bağlantısı bulunmuyor.</span>
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'billing' && (
                <div className="subscription-card workspace-subscription-card">
                  <div className="billing-box workspace-billing-box">
                    <div className="billing-head">
                      <div>
                        <div className="eyebrow">Faturalama</div>
                        <strong>{selectedSubscription.invoice_summary.total} fatura • {currency.format(selectedSubscription.invoice_summary.amount_total)}</strong>
                        <div className="integration-meta">Açık: {selectedSubscription.invoice_summary.unpaid_count + selectedSubscription.invoice_summary.overdue_count} • Gecikmiş: {selectedSubscription.invoice_summary.overdue_count} • Tahsil edilen: {currency.format(selectedSubscription.invoice_summary.paid_total || 0)}</div>
                      </div>
                      <div className="action-wrap">
                        <button type="button" className="ghost-button" onClick={() => onExportBilling(organization.id)} disabled={exportingScope === organization.id}>
                          {exportingScope === organization.id ? 'CSV...' : 'CSV Aktar'}
                        </button>
                        <button type="button" className="ghost-button" onClick={() => onCreateInvoice(selectedSubscription.id)} disabled={invoiceActionId === selectedSubscription.id}>
                          {invoiceActionId === selectedSubscription.id ? 'Üretiliyor...' : 'Fatura Üret'}
                        </button>
                      </div>
                    </div>
                    <div className="invoice-list">
                      {selectedSubscription.invoices.map((invoice) => (
                        <div className="invoice-row" key={invoice.id}>
                          <div>
                            <strong>{invoice.invoice_number}</strong>
                            <span>{currency.format(invoice.amount)} • Vade: {new Date(invoice.due_date).toLocaleDateString('tr-TR')}</span>
                            <span>Tahsil edilen: {currency.format(invoice.paid_total || 0)} • Kalan: {currency.format(invoice.outstanding_amount || 0)}</span>
                            <span>Son tahsilat: {invoice.payments?.[0]?.collected_at ? new Date(invoice.payments[0].collected_at).toLocaleString('tr-TR') : '-'}</span>
                            {invoice.note && <span>Not: {invoice.note}</span>}
                          </div>
                          <div className="invoice-actions">
                            <span className={`status-pill invoice-${invoice.status}`}>{invoiceStatusLabel[invoice.status] || invoice.status}</span>
                            <button type="button" className="ghost-button" onClick={() => onUpdateInvoiceNote(invoice)} disabled={invoiceActionId === invoice.id}>Not</button>
                            {invoice.outstanding_amount > 0 && (
                              <button type="button" className="ghost-button" onClick={() => onRecordInvoicePayment(invoice)} disabled={invoiceActionId === invoice.id}>Ödeme Kaydı</button>
                            )}
                            {invoice.status !== 'paid' && (
                              <button type="button" className="ghost-button" onClick={() => onSetInvoiceStatus(invoice.id, 'paid')} disabled={invoiceActionId === invoice.id}>Ödendi</button>
                            )}
                            {invoice.status === 'paid' && (
                              <button type="button" className="ghost-button" onClick={() => onSetInvoiceStatus(invoice.id, 'unpaid')} disabled={invoiceActionId === invoice.id}>Açık Yap</button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </section>
  );
}

export default function App() {
  const [credentials, setCredentials] = useState(emptyLogin);
  const [token, setToken] = useState(() => localStorage.getItem('pbssiteadmin_token') || '');
  const [user, setUser] = useState(null);
  const [summary, setSummary] = useState(null);
  const [organizations, setOrganizations] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [plans, setPlans] = useState([]);
  const [planRequests, setPlanRequests] = useState([]);
  const [loading, setLoading] = useState(Boolean(token));
  const [error, setError] = useState('');
  const [organizationQuery, setOrganizationQuery] = useState('');
  const [integrationFilter, setIntegrationFilter] = useState('all');
  const [selectedOrganizationId, setSelectedOrganizationId] = useState(() => readSelectedOrganizationId());
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [usageDrafts, setUsageDrafts] = useState({});
  const [savingOrganizationId, setSavingOrganizationId] = useState('');
  const [savingIntegrationId, setSavingIntegrationId] = useState('');
  const [savingSubscriptionId, setSavingSubscriptionId] = useState('');
  const [savingPlanSubscriptionId, setSavingPlanSubscriptionId] = useState('');
  const [probingConnectionId, setProbingConnectionId] = useState('');
  const [syncingConnectionId, setSyncingConnectionId] = useState('');
  const [resolvingPlanRequestId, setResolvingPlanRequestId] = useState('');
  const [onboardingPending, setOnboardingPending] = useState(false);
  const [invoiceActionId, setInvoiceActionId] = useState('');
  const [exportingScope, setExportingScope] = useState('');
  const deferredOrganizationQuery = useDeferredValue(organizationQuery);

  const authorizedRequest = async (path, options = {}) => fetchJson(path, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {})
    }
  });

  const bootstrap = async () => {
    if (!token) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError('');
    try {
      const [me, dashboard, overview, productTemplates, catalogPlans, remotePlanRequests] = await Promise.all([
        authorizedRequest('/auth/me'),
        authorizedRequest('/dashboard/summary'),
        authorizedRequest('/organizations/overview'),
        authorizedRequest('/product-templates'),
        authorizedRequest('/catalog/plans'),
        authorizedRequest('/organizations/plan-requests')
      ]);
      setUser(me.data);
      setSummary(dashboard.data);
      setOrganizations(overview.data);
      setTemplates(productTemplates.data);
      setPlans(catalogPlans.data);
      setPlanRequests(remotePlanRequests.data);
      const draftMap = {};
      overview.data.forEach((organization) => {
        organization.subscriptions.forEach((subscription) => {
          draftMap[subscription.id] = subscription.current_usage || {};
        });
      });
      setUsageDrafts(draftMap);
    } catch (requestError) {
      localStorage.removeItem('pbssiteadmin_token');
      setToken('');
      setError(requestError.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    bootstrap();
  }, [token]);

  useEffect(() => {
    const handlePopState = () => {
      setSelectedOrganizationId(readSelectedOrganizationId());
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (selectedOrganizationId && !organizations.some((organization) => organization.id === selectedOrganizationId)) {
      setSelectedOrganizationId('');
      syncSelectedOrganizationId('', 'replace');
    }
  }, [organizations, selectedOrganizationId]);

  const handleLogin = async (event) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetchJson('/auth/login', {
        method: 'POST',
        body: JSON.stringify(credentials)
      });
      localStorage.setItem('pbssiteadmin_token', response.data.token);
      setToken(response.data.token);
    } catch (requestError) {
      setError(requestError.message);
      setLoading(false);
    }
  };

  const handleUsageChange = (subscriptionId, metricKey, nextValue) => {
    setUsageDrafts((current) => ({
      ...current,
      [subscriptionId]: {
        ...(current[subscriptionId] || {}),
        [metricKey]: nextValue
      }
    }));
  };

  const saveUsage = async (subscription) => {
    setSavingSubscriptionId(subscription.id);
    setError('');
    try {
      await authorizedRequest(`/subscriptions/${subscription.id}/usage`, {
        method: 'PATCH',
        body: JSON.stringify({ current_usage: usageDrafts[subscription.id] || {} })
      });
      await bootstrap();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingSubscriptionId('');
    }
  };

  const saveOrganizationSettings = async (organizationId, payload) => {
    setSavingOrganizationId(organizationId);
    setError('');
    try {
      const response = await authorizedRequest(`/organizations/${organizationId}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      const nextOrganization = response.data;
      setOrganizations((current) => current.map((organization) => (
        organization.id === organizationId
          ? { ...organization, ...nextOrganization }
          : organization
      )));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingOrganizationId('');
    }
  };

  const saveIntegrationSettings = async (integrationId, payload) => {
    setSavingIntegrationId(integrationId);
    setError('');
    try {
      const body = { ...payload };
      if (!body.login_password) {
        delete body.login_password;
      }

      const response = await authorizedRequest(`/integrations/${integrationId}`, {
        method: 'PATCH',
        body: JSON.stringify(body)
      });
      const nextIntegration = response.data;
      setOrganizations((current) => current.map((organization) => ({
        ...organization,
        subscriptions: organization.subscriptions.map((subscription) => (
          subscription.integration?.id === integrationId
            ? { ...subscription, integration: { ...subscription.integration, ...nextIntegration } }
            : subscription
        ))
      })));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingIntegrationId('');
    }
  };

  const probeConnection = async (connectionId, mode = 'health') => {
    setProbingConnectionId(connectionId);
    setError('');
    try {
      const response = await authorizedRequest(`/integrations/${connectionId}/${mode === 'login' ? 'probe-login' : 'probe'}`, { method: 'POST' });
      const nextConnection = response.data?.connection || response.data;
      if (nextConnection?.id) {
        setOrganizations((current) => current.map((organization) => ({
          ...organization,
          subscriptions: organization.subscriptions.map((subscription) => (
            subscription.integration?.id === nextConnection.id
              ? { ...subscription, integration: { ...subscription.integration, ...nextConnection } }
              : subscription
          ))
        })));
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setProbingConnectionId('');
    }
  };

  const syncConnection = async (connectionId) => {
    setSyncingConnectionId(connectionId);
    setError('');
    try {
      await authorizedRequest(`/integrations/${connectionId}/sync`, { method: 'POST' });
      await bootstrap();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSyncingConnectionId('');
    }
  };

  const onboardOrganization = async (payload) => {
    setOnboardingPending(true);
    setError('');
    try {
      await authorizedRequest('/onboarding', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      await bootstrap();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setOnboardingPending(false);
    }
  };

  const logout = () => {
    localStorage.removeItem('pbssiteadmin_token');
    setToken('');
    setUser(null);
    setSummary(null);
    setOrganizations([]);
    setTemplates([]);
    setPlans([]);
    setPlanRequests([]);
  };

  const saveSubscriptionPlan = async (subscriptionId, payload) => {
    setSavingPlanSubscriptionId(subscriptionId);
    setError('');
    try {
      await authorizedRequest(`/subscriptions/${subscriptionId}/plan`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      await bootstrap();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSavingPlanSubscriptionId('');
    }
  };

  const resolvePlanRequest = async (request, action) => {
    const note = window.prompt(action === 'approve' ? 'Onay notu' : 'Red nedeni', '') ?? null;
    if (note === null) {
      return;
    }

    setResolvingPlanRequestId(request.id);
    setError('');
    try {
      await authorizedRequest(`/organizations/plan-requests/${request.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          action,
          note,
          subscription_id: request.local_subscription_id,
          remote_organization_id: request.remote_tenant_id,
          requested_plan: request.metadata?.requested_plan || ''
        })
      });
      await bootstrap();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setResolvingPlanRequestId('');
    }
  };

  const createInvoice = async (subscriptionId) => {
    setInvoiceActionId(subscriptionId);
    setError('');
    try {
      await authorizedRequest(`/subscriptions/${subscriptionId}/invoices`, {
        method: 'POST',
        body: JSON.stringify({})
      });
      await bootstrap();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setInvoiceActionId('');
    }
  };

  const setInvoiceStatus = async (invoiceId, status) => {
    setInvoiceActionId(invoiceId);
    setError('');
    try {
      await authorizedRequest(`/invoices/${invoiceId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      await bootstrap();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setInvoiceActionId('');
    }
  };

  const updateInvoiceNote = async (invoice) => {
    const nextNote = window.prompt('Fatura notu', invoice.note || '');
    if (nextNote === null) {
      return;
    }

    setInvoiceActionId(invoice.id);
    setError('');
    try {
      await authorizedRequest(`/invoices/${invoice.id}/note`, {
        method: 'PATCH',
        body: JSON.stringify({ note: nextNote })
      });
      await bootstrap();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setInvoiceActionId('');
    }
  };

  const recordInvoicePayment = async (invoice) => {
    const suggestedAmount = String(invoice.outstanding_amount || invoice.amount || 0);
    const amount = window.prompt('Tahsil edilen tutar', suggestedAmount);
    if (amount === null) {
      return;
    }

    const paymentMethod = window.prompt('Ödeme yöntemi', 'bank_transfer');
    if (paymentMethod === null) {
      return;
    }

    const collectedAt = window.prompt('Tahsilat tarihi (ISO veya boş bırakın)', new Date().toISOString().slice(0, 16));
    if (collectedAt === null) {
      return;
    }

    const note = window.prompt('Ödeme notu', '');
    if (note === null) {
      return;
    }

    setInvoiceActionId(invoice.id);
    setError('');
    try {
      await authorizedRequest(`/invoices/${invoice.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          amount: Number(amount),
          payment_method: paymentMethod,
          collected_at: collectedAt || undefined,
          note
        })
      });
      await bootstrap();
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setInvoiceActionId('');
    }
  };

  const exportBilling = async (organizationId = '') => {
    setExportingScope(organizationId || 'all');
    setError('');
    try {
      const query = organizationId ? `?organization_id=${encodeURIComponent(organizationId)}` : '';
      const response = await fetch(`${API_BASE}/billing/export${query}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!response.ok) {
        const payload = await response.text();
        throw new Error(payload || 'CSV dışa aktarım başarısız');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = organizationId ? `billing-${organizationId}.csv` : 'pbssiteadmin-billing.csv';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(url);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setExportingScope('');
    }
  };

  const filteredOrganizations = useMemo(() => {
    const query = deferredOrganizationQuery.trim().toLocaleLowerCase('tr-TR');

    return organizations.filter((organization) => {
      const integrationSummary = getOrganizationIntegrationSummary(organization);
      const matchesFilter = integrationFilter === 'all'
        ? true
        : integrationFilter === 'active'
          ? organization.is_active
          : integrationSummary.tone === integrationFilter;

      if (!matchesFilter) {
        return false;
      }

      if (!query) {
        return true;
      }

      return [
        organization.name,
        organization.slug,
        organization.contact_email,
        organization.contact_phone,
        ...organization.subscriptions.map((subscription) => subscription.plan_name),
        ...organization.subscriptions.map((subscription) => subscription.product_template.name)
      ].some((value) => String(value || '').toLocaleLowerCase('tr-TR').includes(query));
    });
  }, [deferredOrganizationQuery, integrationFilter, organizations]);

  const pendingRequestCount = useMemo(
    () => planRequests.filter((request) => request.status === 'pending').length,
    [planRequests]
  );

  const selectedOrganization = useMemo(
    () => organizations.find((organization) => organization.id === selectedOrganizationId) || null,
    [organizations, selectedOrganizationId]
  );

  const openOrganizationWorkspace = (organizationId) => {
    setSelectedOrganizationId(organizationId);
    syncSelectedOrganizationId(organizationId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeOrganizationWorkspace = () => {
    setSelectedOrganizationId('');
    syncSelectedOrganizationId('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (!token) {
    return (
      <div className="login-shell">
        <div className="login-panel">
          <div className="eyebrow">PBS Site Admin</div>
          <h1>Çoklu ürün kiralama yönetimi</h1>
          <p>Mülk yönetimi, filo takip ve klinik uygulaması gibi ürünleri tek super admin panelinden yönetin.</p>
          <form onSubmit={handleLogin} className="login-form">
            <label>
              <span>E-posta</span>
              <input type="email" value={credentials.email} onChange={(event) => setCredentials({ ...credentials, email: event.target.value })} />
            </label>
            <label>
              <span>Şifre</span>
              <input type="password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} />
            </label>
            <button className="primary-button" disabled={loading}>{loading ? 'Giriş yapılıyor...' : 'Panele Gir'}</button>
          </form>
          {error && <div className="error-box">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <header className="hero">
        <div>
          <div className="eyebrow">Merkezi Kiralama Yönetimi</div>
          <h1>PBS ürün ailesi için daha net operasyon yüzeyi</h1>
          <p>Yoğun işleri tek akışta toplayan, daha kısa satırlı ve filtrelenebilir bir yönetim ekranı.</p>
        </div>
        <div className="hero-actions">
          <div className="hero-kpis">
            <div>
              <strong>{organizations.length}</strong>
              <span>organizasyon</span>
            </div>
            <div>
              <strong>{pendingRequestCount}</strong>
              <span>bekleyen talep</span>
            </div>
          </div>
          <div className="user-badge">
            <strong>{user?.name}</strong>
            <span>{user?.email}</span>
          </div>
          <button type="button" className="ghost-button" onClick={logout}>Çıkış</button>
        </div>
      </header>

      {error && <div className="error-box floating">{error}</div>}

      {loading ? (
        <div className="panel">Yükleniyor...</div>
      ) : (
        <>
          <section className="summary-grid">
            <SummaryCard label="Toplam Organizasyon" value={summary?.organization_count ?? 0} detail={`${summary?.active_organization_count ?? 0} aktif organizasyon`} tone="sky" />
            <SummaryCard label="Aylık Gelir" value={currency.format(summary?.monthly_revenue ?? 0)} detail="Aktif + trial ürün abonelikleri" tone="emerald" />
            <SummaryCard label="Açık Tahsilat" value={currency.format(summary?.invoice_summary?.receivable_total ?? 0)} detail={`${summary?.invoice_summary?.overdue_count ?? 0} gecikmiş fatura`} tone="amber" />
            <SummaryCard label="Toplanan Ödeme" value={currency.format(summary?.invoice_summary?.collected_total ?? 0)} detail={`${summary?.invoice_summary?.paid_count ?? 0} tam ödenmiş fatura`} tone="rose" />
          </section>

          <section className="control-strip panel">
            <div className="panel-head compact-head">
              <div>
                <div className="eyebrow">Operasyon Kontrolleri</div>
                <h3>Listeyi daralt, yeni açılışı gerektiğinde göster</h3>
              </div>
              <button type="button" className="secondary-button" onClick={() => setShowOnboarding((current) => !current)}>
                {showOnboarding ? 'Yeni Kiralama Alanını Gizle' : 'Yeni Kiralama Aç'}
              </button>
            </div>
            <div className="toolbar-grid">
              <label>
                <span>Organizasyon Ara</span>
                <input
                  value={organizationQuery}
                  onChange={(event) => setOrganizationQuery(event.target.value)}
                  placeholder="isim, slug, e-posta veya plan"
                />
              </label>
              <label>
                <span>Entegrasyon Durumu</span>
                <select value={integrationFilter} onChange={(event) => setIntegrationFilter(event.target.value)}>
                  <option value="all">Tümü</option>
                  <option value="integration-healthy">Sağlıklı</option>
                  <option value="integration-degraded">İzlenmeli</option>
                  <option value="integration-offline">Sorun var</option>
                  <option value="inactive">Entegrasyon yok</option>
                  <option value="active">Sadece aktif organizasyon</option>
                </select>
              </label>
              <div className="toolbar-stat">
                <strong>{filteredOrganizations.length}</strong>
                <span>görünen organizasyon</span>
              </div>
            </div>
          </section>

          {selectedOrganization ? (
            <OrganizationWorkspace
              organization={selectedOrganization}
              plans={plans}
              usageDrafts={usageDrafts}
              onBack={closeOrganizationWorkspace}
              onSaveOrganization={saveOrganizationSettings}
              onSaveUsage={saveUsage}
              onSavePlan={saveSubscriptionPlan}
              onProbeConnection={probeConnection}
              onSyncConnection={syncConnection}
              onSaveIntegration={saveIntegrationSettings}
              onExportBilling={exportBilling}
              onCreateInvoice={createInvoice}
              onUpdateInvoiceNote={updateInvoiceNote}
              onRecordInvoicePayment={recordInvoicePayment}
              onSetInvoiceStatus={setInvoiceStatus}
              onUsageChange={handleUsageChange}
              savingOrganizationId={savingOrganizationId}
              savingSubscriptionId={savingSubscriptionId}
              savingPlanSubscriptionId={savingPlanSubscriptionId}
              probingConnectionId={probingConnectionId}
              syncingConnectionId={syncingConnectionId}
              savingIntegrationId={savingIntegrationId}
              invoiceActionId={invoiceActionId}
              exportingScope={exportingScope}
            />
          ) : (
            <>
              <section className="dashboard-grid">
                <div className="panel">
                  <div className="panel-head">
                    <div>
                      <div className="eyebrow">Ürün Dağılımı</div>
                      <h3>Şablon bazlı aktif gelir görünümü</h3>
                    </div>
                  </div>
                  <div className="breakdown-list">
                    {(summary?.product_breakdown || []).map((item) => (
                      <div className="breakdown-row" key={item.code}>
                        <div>
                          <strong>{item.name}</strong>
                          <span>{item.subscription_count} aktif/trial abonelik</span>
                        </div>
                        <div>{currency.format(item.monthly_revenue)}</div>
                      </div>
                    ))}
                  </div>
                  <div className="invoice-summary-strip">
                    <div><strong>{summary?.invoice_summary?.paid_count ?? 0}</strong><span>Ödenen</span></div>
                    <div><strong>{summary?.invoice_summary?.unpaid_count ?? 0}</strong><span>Ödenmeyen</span></div>
                    <div><strong>{summary?.invoice_summary?.overdue_count ?? 0}</strong><span>Gecikmiş</span></div>
                  </div>
                  <button type="button" className="secondary-button" onClick={() => exportBilling()} disabled={exportingScope === 'all'}>
                    {exportingScope === 'all' ? 'CSV hazırlanıyor...' : 'Tüm Faturaları CSV Dışa Aktar'}
                  </button>
                </div>
                <div className="panel panel-form-shell">
                  <div className="panel-head compact-head">
                    <div>
                      <div className="eyebrow">Yeni Kiralama</div>
                      <h3>Yeni tenant açılışını ikincil akışa aldık</h3>
                    </div>
                    <span className={`status-pill ${showOnboarding ? 'active' : 'inactive'}`}>{showOnboarding ? 'Açık' : 'Gizli'}</span>
                  </div>
                  <p className="panel-copy">Ana operasyon görünümü sabit kalsın diye onboarding formu ihtiyaç halinde genişletiliyor.</p>
                  {showOnboarding ? (
                    <OnboardingForm templates={templates} plans={plans} onCreate={onboardOrganization} isSaving={onboardingPending} />
                  ) : (
                    <div className="empty-compact-state">
                      <strong>Yeni kiralama formu gizli</strong>
                      <span>Yeni organizasyon açacağınız zaman üstteki butonla görünür yapabilirsiniz.</span>
                    </div>
                  )}
                </div>
              </section>

              <PlanRequestPanel requests={planRequests} onResolve={resolvePlanRequest} resolvingId={resolvingPlanRequestId} />

              <section className="panel org-table-panel">
            <div className="panel-head">
              <div>
                <div className="eyebrow">Organizasyonlar</div>
                <h3>Masaüstü odaklı liste görünümü</h3>
              </div>
            </div>
            <div className="org-table-shell">
              <table className="org-table">
                <thead>
                  <tr>
                    <th>Organizasyon</th>
                    <th>İletişim</th>
                    <th>Abonelik</th>
                    <th>Entegrasyon</th>
                    <th>Aylık Gelir</th>
                    <th>Açık Tahsilat</th>
                    <th>Durum</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrganizations.map((organization) => {
                    const integrationSummary = getOrganizationIntegrationSummary(organization);

                    return (
                      <Fragment key={organization.id}>
                        <tr>
                          <td>
                            <div className="org-table-primary">
                              <strong>{organization.name}</strong>
                              <span>{organization.slug}</span>
                            </div>
                          </td>
                          <td>
                            <div className="org-table-primary">
                              <strong>{organization.contact_email || 'E-posta yok'}</strong>
                              <span>{organization.contact_phone || 'Telefon yok'}</span>
                            </div>
                          </td>
                          <td>{organization.subscriptions.length} ürün</td>
                          <td>
                            <span className={`status-pill ${integrationSummary.tone}`}>{integrationSummary.label}</span>
                          </td>
                          <td>{currency.format(getOrganizationMonthlyRevenue(organization))}</td>
                          <td>{currency.format(getOrganizationOpenReceivable(organization))}</td>
                          <td>
                            <div className="row-actions">
                              <span className={`status-pill ${organization.is_active ? 'active' : 'inactive'}`}>
                                {organization.is_active ? 'Aktif' : 'Pasif'}
                              </span>
                              <button
                                type="button"
                                className="table-toggle-button"
                                onClick={() => openOrganizationWorkspace(organization.id)}
                              >
                                Sayfaya Git
                              </button>
                            </div>
                          </td>
                        </tr>
                      </Fragment>
                    );
                  })}
                  {!filteredOrganizations.length && (
                    <tr>
                      <td colSpan="7">
                        <div className="empty-compact-state inline-empty-state">
                          <strong>Eşleşen organizasyon yok</strong>
                          <span>Arama veya filtreyi gevşetip tekrar deneyin.</span>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
