# Panduan Integrasi: API Kirim Pesan WhatsApp

Dokumen ini untuk developer yang ingin mengirim pesan WhatsApp dari **aplikasi lain**
(backend service, worker, microservice, script, atau dashboard eksternal) melalui endpoint
`POST /api/send-message` milik WhatsApp Funbot.

Endpoint ini bersifat **server-to-server**: aplikasi klien memanggil API bot, lalu bot
meneruskan pesan ke WhatsApp memakai koneksi Baileys yang aktif.

---

## Daftar Isi

1. [Ringkasan](#ringkasan)
2. [Base URL & Autentikasi](#base-url--autentikasi)
3. [Prasyarat](#prasyarat)
4. [Endpoint](#endpoint)
5. [Format JID](#format-jid)
6. [Rate Limiting](#rate-limiting)
7. [Batas & Validasi](#batas--validasi)
8. [Contoh Integrasi](#contoh-integrasi)
9. [Praktik Aman & Rekomendasi](#praktik-aman--rekomendasi)
10. [Troubleshooting](#troubleshooting)
11. [Referensi Environment Variable](#referensi-environment-variable)

---

## Ringkasan

| Item | Nilai |
| :--- | :--- |
| Method | `POST` |
| Path | `/api/send-message` |
| Auth | HTTP Basic Auth (wajib) |
| Content-Type | `application/json` |
| Sukses | `200 OK` |
| Sifat | Sinkron — response dikirim setelah Baileys menerima pesan |

Alur: aplikasi klien → `POST /api/send-message` → bot (Baileys) → WhatsApp.

---

## Base URL & Autentikasi

Base URL mengikuti host dan port tempat server API dijalankan.

| Lingkungan | Contoh Base URL |
| :--- | :--- |
| Lokal | `http://localhost:5000` |
| Produksi | `https://bot.example.com` |

Autentikasi memakai **HTTP Basic Auth**. Kredensial diambil dari environment
variable di sisi server (`API_USERNAME`, `API_PASSWORD`); klien cukup mengirim
header `Authorization`.

> **Penting:** ganti kredensial default (`admin` / `admin123`) sebelum dipakai di
> produksi, dan selalu akses lewat **HTTPS** karena Basic Auth mengirim kredensial
> dalam bentuk base64 (bukan terenkripsi).

---

## Prasyarat

1. Server API (dan bot) sedang berjalan.
2. Bot WhatsApp **sudah terhubung** (sesi sudah login, bukan menunggu scan QR).
   - Jika belum, endpoint membalas `503 Service Unavailable`.
3. Aplikasi klien bisa menjangkau host/port API.

Untuk mengecek status koneksi bot sebelum mengirim, aplikasi klien dapat memanggil
`GET /api/status` (juga dilindungi Basic Auth) dan memeriksa field `connected`.

---

## Endpoint

### Request

`POST /api/send-message`

Header:

| Header | Wajib | Nilai |
| :--- | :--- | :--- |
| `Authorization` | Ya | `Basic <base64(username:password)>` |
| `Content-Type` | Disarankan | `application/json` |

Body (JSON):

| Field | Tipe | Wajib | Keterangan |
| :--- | :--- | :--- | :--- |
| `jid` | `string` | Ya | Tujuan pesan. JID WhatsApp lengkap **atau** nomor telepon (lihat [Format JID](#format-jid)). |
| `text` | `string` | Ya | Isi pesan teks. Tidak boleh kosong/whitespace. Maksimum lihat [Batas & Validasi](#batas--validasi). |

Field selain `jid` dan `text` diabaikan.

```json
{
  "jid": "628123456789@s.whatsapp.net",
  "text": "Halo dari aplikasi lain!"
}
```

### Response Sukses — `200 OK`

```json
{
  "success": true,
  "messageId": "3EB0A1B2C3D4E5F6",
  "jid": "628123456789@s.whatsapp.net",
  "requestId": "8f0b2c1e-6a44-4d0e-9c2a-1b7d9f3e5a10"
}
```

| Field | Tipe | Keterangan |
| :--- | :--- | :--- |
| `success` | `boolean` | Selalu `true` bila berhasil. |
| `messageId` | `string \| null` | ID pesan dari WhatsApp. Bisa `null` bila WhatsApp tidak mengembalikan key. |
| `jid` | `string` | JID hasil normalisasi yang benar-benar dipakai untuk mengirim. |
| `requestId` | `string` | ID unik request, berguna untuk korelasi log. Sama dengan header `X-Request-Id`. |

> Catatan: `200 OK` berarti pesan **diterima oleh server/bot untuk dikirim**. Ini bukan
> bukti pesan sudah dibaca atau sampai ke penerima. Endpoint ini tidak menyediakan
> callback status pengiriman.

### Response Error

Semua error mengembalikan JSON dengan field `error`, ditambah `requestId`. Beberapa
jenis error menambahkan `details` atau `retryAfterSeconds`.

| Status | `error` | Kapan terjadi |
| :--- | :--- | :--- |
| `400` | `Request body must be valid JSON` | Body bukan JSON yang valid. |
| `400` | `Request body must be a JSON object` | Body valid JSON tapi bukan object (mis. array/string). |
| `400` | `Invalid request body` | Field gagal validasi (disertai `details`). |
| `400` | `Invalid 'jid'. ...` | Format `jid` tidak dikenali. |
| `415` | `Content-Type must be application/json` | Mengirim `Content-Type` non-JSON secara eksplisit. |
| `429` | `Rate limit exceeded. Please retry later.` | Melebihi kuota pengiriman. |
| `502` | `Failed to send message` | Bot gagal mengirim (mis. JID tidak dijangkau). |
| `503` | `Bot is not ready or not connected` | Bot belum terhubung. |

Contoh error validasi (`400`) dengan detail per-field:

```json
{
  "error": "Invalid request body",
  "details": [
    { "field": "text", "message": "'text' must not exceed 4096 characters" }
  ],
  "requestId": "8f0b2c1e-6a44-4d0e-9c2a-1b7d9f3e5a10"
}
```

Contoh error rate limit (`429`), disertai header `Retry-After`:

```json
{
  "error": "Rate limit exceeded. Please retry later.",
  "retryAfterSeconds": 37,
  "requestId": "8f0b2c1e-6a44-4d0e-9c2a-1b7d9f3e5a10"
}
```

---

## Format JID

Field `jid` menerima dua bentuk:

1. **JID WhatsApp lengkap** (disarankan). Pola yang diterima (suffix tidak case-sensitive):

   | Suffix | Jenis | Contoh |
   | :--- | :--- | :--- |
   | `@s.whatsapp.net` | Chat pribadi | `628123456789@s.whatsapp.net` |
   | `@lid` | Chat pribadi (Linked ID) | `24898126741545@lid` |
   | `@g.us` | Grup | `120363348483999661@g.us` |
   | `@broadcast` | Broadcast / status | `status@broadcast` |
   | `@newsletter` | Channel | `1203630xxxxx@newsletter` |

2. **Nomor telepon (E.164)** tanpa suffix. Angka saja (boleh ada spasi, `+`, `-`, `()`, `.`).
   Server otomatis menambahkan `@s.whatsapp.net`.
   - Panjang digit yang diterima: **6–15** (batas E.164).
   - Contoh: `628123456789` → `628123456789@s.whatsapp.net`

Contoh valid:

```
628123456789@s.whatsapp.net
628123456789
24898126741545@lid
120363348483999661@g.us
```

Contoh tidak valid (ditolak `400`): `foo@bar.com`, `@@@`, `abc`, `123` (terlalu pendek).

> Group JID (`@g.us`) hanya bisa dipakai jika bot adalah **anggota grup** tersebut.
> Untuk `@lid`, pesan hanya berhasil jika LID dapat di-resolve oleh sesi bot.

---

## Rate Limiting

Endpoint dibatasi **per alamat IP klien** memakai jendela waktu tetap (_fixed window_).

| Parameter | Default | Env var |
| :--- | :--- | :--- |
| Maksimum request per jendela | 60 | `SEND_MESSAGE_RATE_MAX` |
| Panjang jendela | 60000 ms (1 menit) | `SEND_MESSAGE_RATE_WINDOW_MS` |

Klien harus menangani `429` dengan:

1. Membaca header `Retry-After` (detik) atau field `retryAfterSeconds`.
2. Menunggu sekian detik sebelum mencoba lagi.
3. Menerapkan _backoff_ dan antrean, bukan _retry_ agresif (risiko ban WhatsApp).

> IP klien diambil dari header `X-Forwarded-For` (hop pertama) bila ada, jika tidak dari
> koneksi TCP. Jika bot berjalan di belakang reverse proxy, pastikan proxy meneruskan
> `X-Forwarded-For` dengan benar.

---

## Batas & Validasi

| Aturan | Nilai | Env var |
| :--- | :--- | :--- |
| Panjang maksimum `text` | 4096 karakter | `SEND_MESSAGE_MAX_LENGTH` |
| Panjang maksimum `jid` | 128 karakter | — |
| `text` kosong / hanya whitespace | Ditolak | — |

`text` dan `jid` di-_trim_ otomatis. Nilai `text` yang melebihi batas ditolak dengan `400`.

---

## Contoh Integrasi

### cURL

```bash
curl -X POST "http://localhost:5000/api/send-message" \
  -u "admin:admin123" \
  -H "Content-Type: application/json" \
  -d '{"jid":"628123456789@s.whatsapp.net","text":"Halo dari cURL!"}'
```

### Node.js / TypeScript

```ts
const BASE_URL = process.env.BOT_API_URL ?? "http://localhost:5000";
const USER = process.env.BOT_API_USER!;
const PASS = process.env.BOT_API_PASS!;

async function sendMessage(jid: string, text: string) {
  const res = await fetch(`${BASE_URL}/api/send-message`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization:
        "Basic " + Buffer.from(`${USER}:${PASS}`).toString("base64"),
    },
    body: JSON.stringify({ jid, text }),
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const retryAfter = res.headers.get("retry-after");
    throw new Error(
      `Send failed (${res.status}): ${data?.error ?? "unknown"}` +
        (retryAfter ? ` — retry after ${retryAfter}s` : ""),
    );
  }

  return data as {
    success: true;
    messageId: string | null;
    jid: string;
    requestId: string;
  };
}
```

### Python

```python
import os
import requests

BASE_URL = os.environ.get("BOT_API_URL", "http://localhost:5000")
AUTH = (os.environ["BOT_API_USER"], os.environ["BOT_API_PASS"])

def send_message(jid: str, text: str) -> dict:
    resp = requests.post(
        f"{BASE_URL}/api/send-message",
        json={"jid": jid, "text": text},
        auth=AUTH,
        timeout=15,
    )
    payload = resp.json()
    if resp.status_code == 429:
        retry_after = payload.get("retryAfterSeconds", 60)
        raise RuntimeError(f"Rate limited, retry in {retry_after}s")
    resp.raise_for_status()
    return payload
```

### PHP

```php
<?php
$base = getenv('BOT_API_URL') ?: 'http://localhost:5000';
$user = getenv('BOT_API_USER');
$pass = getenv('BOT_API_PASS');

$ch = curl_init("$base/api/send-message");
curl_setopt_array($ch, [
    CURLOPT_POST           => true,
    CURLOPT_POSTFIELDS     => json_encode([
        'jid'  => '628123456789@s.whatsapp.net',
        'text' => 'Halo dari PHP!',
    ]),
    CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
    CURLOPT_USERPWD        => "$user:$pass",
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
]);

$body = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

$data = json_decode($body, true);
if ($status === 200) {
    echo "Terkirim, messageId=" . ($data['messageId'] ?? 'null') . PHP_EOL;
} else {
    echo "Gagal ($status): " . ($data['error'] ?? 'unknown') . PHP_EOL;
}
```

### Go

```go
package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
)

func main() {
	payload, _ := json.Marshal(map[string]string{
		"jid":  "628123456789@s.whatsapp.net",
		"text": "Halo dari Go!",
	})

	req, _ := http.NewRequest("POST", "http://localhost:5000/api/send-message", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.SetBasicAuth("admin", "admin123")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		panic(err)
	}
	defer resp.Body.Close()

	fmt.Println("status:", resp.StatusCode)
}
```

---

## Praktik Aman & Rekomendasi

- **Jangan expose endpoint ini ke publik.** Batasi dengan firewall, VPN, atau
  _allowlist_ IP. Endpoint memakai Basic Auth, bukan API key per-klien.
- **Selalu pakai HTTPS** dan simpan kredensial di secret manager / environment
  variable, bukan di source code.
- **Hormati rate limit.** Gunakan antrean (queue) + _exponential backoff_ untuk
  mengirim banyak pesan. Ini juga melindungi nomor WhatsApp dari ban.
- **Validasi & sanitasi di sisi klien** sebelum memanggil API (mis. batas panjang
  teks) agar tidak membuang kuota rate limit untuk request yang pasti gagal.
- **Simpan `messageId` dan `requestId`** untuk keperluan audit dan korelasi log.
- **Tidak ada idempotency key.** Bila request di-retry, pesan bisa terkirim lebih
  dari sekali. Terapkan dedupe di sisi klien (mis. berdasarkan ID bisnis unik)
  sebelum mengirim ulang.
- **Rate limit bersifat in-memory per proses.** Bila menjalankan banyak instance
  API di belakang load balancer, tiap instance punya kuota sendiri.

---

## Troubleshooting

| Gejala | Kemungkinan Penyebab | Solusi |
| :--- | :--- | :--- |
| `401 Unauthorized` | Kredensial salah/kosong | Cek `API_USERNAME` / `API_PASSWORD` dan header `Authorization`. |
| `415` | `Content-Type` bukan JSON | Kirim `Content-Type: application/json`. |
| `400` + `Invalid request body` | Field kurang/salah tipe | Periksa `details` pada response. |
| `400` + `Invalid 'jid'` | Format JID salah | Pakai JID lengkap atau nomor E.164 (lihat [Format JID](#format-jid)). |
| `429` | Terlalu banyak request | Tunggu sesuai `Retry-After`, pakai antrean/backoff. |
| `503` | Bot belum terhubung | Pastikan sesi bot sudah login; cek `GET /api/status`. |
| `502` | Gagal kirim (mis. bukan anggota grup, LID tak resolve) | Cek log server via `requestId`; pastikan tujuan valid. |

Saat melaporkan masalah, sertakan `requestId` dari response agar log server mudah
ditelusuri.

---

## Referensi Environment Variable

Environment variable di sisi **server** yang memengaruhi endpoint ini:

| Variable | Deskripsi | Default |
| :--- | :--- | :--- |
| `API_USERNAME` | Username Basic Auth | `admin` |
| `API_PASSWORD` | Password Basic Auth | `admin123` |
| `DASHBOARD_PORT` | Port server API | `5000` |
| `SEND_MESSAGE_MAX_LENGTH` | Panjang maksimum `text` (karakter) | `4096` |
| `SEND_MESSAGE_RATE_MAX` | Maksimum request per IP per jendela | `60` |
| `SEND_MESSAGE_RATE_WINDOW_MS` | Panjang jendela rate limit (ms) | `60000` |
