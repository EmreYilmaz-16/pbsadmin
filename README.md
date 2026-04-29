# PBS Site Admin

Çoklu ürün kiralama süreçlerini tek panelden yöneten Docker tabanlı merkezi platform admin projesi.

Bu proje tek bir ürün için değil, farklı ürün tipleri için ürün şablonu bazlı çalışır.

- Mülk Yönetimi: kullanıcı + mülk sayısı
- Filo Takip: kullanıcı + araç sayısı
- Klinik Uygulaması: sadece kullanıcı sayısı

## Mimari

- Nginx: `http://localhost:9180`
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL

## Varsayılan giriş

- E-posta: `superadmin@pbssiteadmin.local`
- Şifre: `SuperAdmin123!`

## Çalıştırma

```bash
cd C:\Users\User\Desktop\Projects\ColdfusionProjects\pbssiteadmin
copy .env.example .env
docker compose up -d --build
```

## Sunulan yönetim akışları

- Ürün şablonlarını dinamik metric tanımı ile okur.
- Ürün şablonlarının altında ayrı plan kataloğu bulunur; onboarding sırasında hazır plan seçilebilir.
- Organizasyon + ürün aboneliği + API bağlantısı tek onboarding formundan açılır.
- Her abonelik için güncel kullanım değerleri admin panelinden güncellenebilir.
- Her abonelik için invoice üretilebilir ve invoice durumu `paid / unpaid / overdue` olarak yönetilir.
- Her ürün bağlantısı için health-check/probe yapılabilir.
- Dashboard aylık toplam gelir, açık tahsilat, ürün bazlı dağılım ve entegrasyon sağlık durumunu özetler.

## API uç noktaları

- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me`
- `GET /api/v1/health`
- `GET /api/v1/product-templates`
- `GET /api/v1/catalog/plans`
- `GET /api/v1/dashboard/summary`
- `GET /api/v1/organizations/overview`
- `POST /api/v1/onboarding`
- `PATCH /api/v1/subscriptions/:id/usage`
- `POST /api/v1/subscriptions/:id/invoices`
- `PATCH /api/v1/invoices/:id/status`
- `POST /api/v1/integrations/:id/probe`

## Plan ve Fatura Modeli

- `product_templates`: ürün tipleri ve metric tanımı
- `product_pricing_plans`: her ürün için satılabilir plan kataloğu
- `organization_subscriptions`: organizasyonun ürün aboneliği, limit ve kullanım snapshot'ı
- `organization_invoices`: abonelik bazlı faturalar ve ödeme durumu

Örnek plan katalogları:

- Mülk Yönetimi: Starter / Pro / Enterprise
- Filo Takip: Starter / Standart / Enterprise
- Klinik Uygulaması: Basic / Team / Multi Branch

## Harici ürün API bağlantısı

Bu proje ürünlerin kendi operasyon API'lerini taşımak zorunda değil. Bunun yerine `product_api_connections` tablosunda ürün bazlı `base_url`, `health_path`, `auth_type` ve `auth_value` tutar.

Örnek:

- Mevcut Mülk Yönetimi API: `http://host.docker.internal:8300`
- Ayrı filo takip servisi: `https://fleet.example.com/api`
- Klinik uygulaması: `https://clinic.example.com/api`

Not:

- MobilKiraTakip backend'inde gerçek health endpoint zaten `GET /health` olarak mevcut.
- Bu yüzden merkezi admin panelde MobilKiraTakip entegrasyonu için `base_url=http://host.docker.internal:8300` ve `health_path=/health` kullanılmalıdır.

Bu sayede merkezi admin paneli farklı ürünlerin kiralama ve kapasite yönetimini tek yerden koordine eder.
