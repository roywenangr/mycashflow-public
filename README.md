# Bot pencatat pengeluaran (versi umum)

Bot Telegram untuk mencatat pengeluaran dengan bahasa bebas atau foto struk. Tiap orang punya data sendiri (dompet, pengeluaran, pemasukan, transfer) yang tidak terlihat orang lain. Masuk pakai kode undangan. Tidak ada dashboard web; semuanya lewat Telegram.

Versi pribadi (dua orang + dashboard) ada di project terpisah `mycashflow`.

## Setup

1. Buat bot di @BotFather, isi `TELEGRAM_BOT_TOKEN` dan `TELEGRAM_BOT_USERNAME` di `.env.local`.
2. Isi `GOOGLE_GENERATIVE_AI_API_KEY`, `TELEGRAM_WEBHOOK_SECRET_TOKEN` (string acak), dan `INVITE_CODES`.
3. `npx vercel env pull .env.local` untuk variabel database, lalu `npm run db:migrate`.
4. Deploy: `npx vercel deploy --prod`, lalu `npm run telegram:webhook -- https://<alamat-deploy>`.

Skema database diubah lewat `npm run db:generate` lalu `npm run db:migrate` (jangan `drizzle-kit push`: tabel `chat_state_*` milik Chat SDK).

## Kode undangan

`INVITE_CODES` berisi satu atau beberapa kode dipisah koma. Orang baru mengirim kodenya ke bot, atau membuka `https://t.me/<bot>?start=<kode>`. Menghapus sebuah kode hanya menghentikan pendaftaran baru; yang sudah terdaftar tetap bisa memakai. Kode yang dipakai tiap orang tercatat di tabel `users`.

## Perintah

Semua juga tersedia sebagai tombol di bawah kolom ketik.

- `/cek` — pengeluaran hari ini, 1 minggu terakhir, atau satu bulan; per dompet atau semua
- `/dompet`, `/dompet tambah BCA 1,5jt`, `/dompet hapus`
- `/masuk 5jt gaji` — pemasukan
- `/pindah 500rb` — pindah dana antar dompet sendiri
- `/transfer 500rb ke Budi` — transfer ke orang lain; dicatat sebagai pengeluaran kategori Transfer, jadi muncul di `/cek` dan memotong saldo dompet yang dipilih. Foto bukti transfer juga dibaca otomatis.
- `/hapus` — hapus catatan pengeluaran terakhir (dengan konfirmasi)
- `/hapusakun` — hapus semua data milik pengirim
