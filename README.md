# Vefa Auto – Web sürümü (SQLite veritabanlı)

Galeri uygulamasının sunucuda çalışan sürümü. Veriler tarayıcıda değil, sunucudaki **SQLite** veritabanında (`vefa.sqlite`) tutulur. Telefon, tablet ve bilgisayardan aynı hesapla girip aynı verilere ulaşırsınız.

- Harici paket gerekmez. Yalnızca **Node.js 22.5 veya üstü** yeterlidir (`node:sqlite` yerleşiktir).
- Kullanıcı girişi (şifreler `scrypt` ile saklanır), oturum 30 gün, hatalı girişte 10 dakikalık kilit.
- Birden çok kullanıcı eklenebilir (Ayarlar → Hesap ve web sürümü). Roller: **Yönetici** (her şey), **Satışçı** (Kasa ve Raporlar menüsünü görmez), **İzleyici** (yalnızca görüntüler; sunucu yazmayı reddeder). Satışçı kısıtı arayüz düzeyindedir; gizli tutulması gereken veri için ayrı hesap/sunucu kullanın.
- Cihazlar arası otomatik eşitleme (15 sn). İki cihazda aynı anda düzenleme olursa en son kaydedilen geçerli olur, diğer cihaz güncel veriyi yükler.
- Ağ kesilirse değişiklikler cihazda bekler, bağlantı gelince kaydedilir.
- Telefonda "Ana ekrana ekle" ile uygulama gibi açılır.
- Tarayıcıdaki mevcut verileriniz, sunucu boşsa ilk girişte otomatik olarak sunucuya taşınır.

## Kurulum sihirbazı (ilk açılış)
Sunucu ilk kez açıldığında kullanıcı yoksa **site adresi doğrudan kurulum sihirbazını açar**. Adımlar: sistem kontrolü (disk, HTTPS, veritabanı) → işletme bilgileri → yönetici hesabı → başlangıç verisi (boş / örnek / yedekten geri yükle) → tamam. Kurulum bitince sihirbaz kapanır, `/kurulum` adresi ana sayfaya yönlenir.

**Kurulum kodu:** Siteyi başkası ilk açıp yönetici olmasın diye sihirbaz bir kod ister.
- Kod, sunucu açılışında günlüğe (Logs) “KURULUM KODU: XXXX-XXXX” olarak yazılır.
- Kendiniz belirlemek için `SETUP_CODE` ortam değişkenini ayarlayın (Render’da `render.yaml` rastgele bir değer üretir ve panelde Environment bölümünde görürsünüz).
- Sağlık kontrolü adresi: `/healthz`

## Bilgisayarda çalıştırma
```bash
node server.js          # http://localhost:3000
```
İlk açılışta yönetici hesabını oluşturursunuz.
Ayarlar (ortam değişkeni): `PORT` (3000), `DATA_DIR` (./data), `SESSION_DAYS` (30).

## Sunucuya kurma
**Docker (VPS):**
```bash
docker compose up -d --build
```
Veri `vefa-data` biriminde kalıcıdır. İnternete açacaksanız **mutlaka HTTPS** kullanın. En kolayı Caddy:
```
vefa.alanadiniz.com {
    reverse_proxy localhost:3000
}
```
**Fly.io:** `fly.toml` hazır (`fly launch --copy-config`, önce volume oluşturun). **Render / Railway:** Depoyu bağlayın, Dockerfile otomatik algılanır. **Kalıcı disk** ekleyip `/data` olarak bağlayın (`render.yaml` hazır). Disk olmadan veriler yeniden başlatmada silinir.

## Yedekleme
- Uygulama içinden: Ayarlar → **Sunucu yedeğini indir** (tüm veri ve fotoğraflar, tek JSON).
- Dosya olarak: `DATA_DIR/vefa.sqlite` dosyasını kopyalayın (`sqlite3 vefa.sqlite ".backup yedek.sqlite"` çalışan sunucuda da güvenlidir).

## Veritabanı yapısı
`users`, `sessions`, `docs` (koleksiyon, kayıt id, JSON: araçlar, cariler, satışlar, taksitler, kasa hareketleri, makbuzlar…), `kv` (firma, vergi ayarları), `photos`, `meta` (sürüm sayacı).

## Uygulamayı güncelleme
`galeri-defteri.html` değişirse:
```bash
python3 build.py        # public/index.html'i yeniden üretir
```
Docker kullanıyorsanız yeniden derleyin (`docker compose up -d --build`).
