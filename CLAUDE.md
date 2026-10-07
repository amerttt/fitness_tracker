# Fitness Log

Düz HTML/JS, derleme yok. Ayrıntı için README.md.

## Sürüm kuralı
- Telefonların yeni dosyaları alması için her yayınlanan değişiklikte `sw.js` `VERSION` ve `app.js` `APP_VERSION` birlikte artar ve `CHANGELOG`'a satır eklenir.
- Artış **noktalı** olur: 54.1, 54.2, 54.3… Tam sayı (55) **sadece sahibi açıkça isteyince** artar.
- Her değişiklik kendi commit'i olur.

## Supabase
- Proje `qiuciwbpdpyvhgedfped`. İstemcide sadece publishable anahtar bulunur; `service_role` anahtarını koda koyma.
- Şema `supabase/migrations/` altında, RLS her tabloda açık.
