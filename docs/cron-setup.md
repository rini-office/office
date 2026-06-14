# cron-job.org Setup

Trigger pipeline tiap 5 menit (free) — endpoint akan cek sendiri apakah sudah waktunya run.

---

## 1. Generate CRON_SECRET

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Copy output-nya.

## 2. Set di Vercel

Buka Vercel Dashboard → **Settings → Environment Variables**:

| Key | Value |
|-----|-------|
| `CRON_SECRET` | (paste hasil generate) |

Redeploy project (biarkan Vercel Cron tetap `0 0 * * *` sebagai fallback harian).

## 3. Daftar cron-job.org

Buka [cron-job.org](https://cron-job.org) → **Sign up** (gratis, no credit card).

## 4. Buat Cronjob

1. Klik **Create Cronjob**
2. Isi:

| Field | Value |
|-------|-------|
| Title | `rini-office` |
| URL | `https://domainkamu.vercel.app/api/cron` |
| Execution schedule | **Every 5 minutes** |
| Request method | `GET` |
| Headers | Klik **+** tambah: |
|  | `Authorization` : `Bearer <CRON_SECRET>` |

3. Klik **Create**

## 5. Verifikasi

Buka **Execution History** — status harus `200 OK` (atau `skipped` kalau belum waktunya run).

---

Cara kerjanya: cron-job.org panggil endpoint tiap 5 menit → endpoint baca `schedule_cron` dari database → cek `shouldRunCron()` → eksekusi pipeline kalau sudah waktunya.
