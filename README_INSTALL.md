# Docker Demo Installer

Paket ini menjalankan seluruh aplikasi dengan Docker Compose:

- React frontend
- Express API
- BullMQ worker
- PostgreSQL
- Redis

Penguji tidak perlu menginstal Node.js, PostgreSQL, atau Redis secara manual.

## Yang Perlu Disiapkan

1. Install Docker Desktop.
   - Windows: https://www.docker.com/products/docker-desktop/
   - macOS: https://www.docker.com/products/docker-desktop/
2. Windows biasanya perlu WSL2. Ikuti wizard Docker Desktop jika diminta.
3. Buka Docker Desktop dan tunggu sampai statusnya running.
4. Pastikan port `8080` belum dipakai aplikasi lain.
5. Koneksi internet diperlukan saat install pertama karena Docker perlu mengunduh base image dan dependency.

## Cara Install Pertama Kali

Jalankan perintah dari folder utama project, yaitu folder yang berisi `docker-compose.yml`.

Windows:

```bat
install.bat
```

macOS / Linux:

```sh
sh install.sh
```

Setelah selesai, buka:

```text
http://localhost:8080
```

Akun demo:

```text
Email: admin@upj.ac.id
Password: Admin12345
```

## Menjalankan Lagi Setelah Komputer Restart

Windows:

```bat
start.bat
```

macOS / Linux:

```sh
sh start.sh
```

## Menghentikan Aplikasi

Windows:

```bat
stop.bat
```

macOS / Linux:

```sh
sh stop.sh
```

Data PostgreSQL tetap tersimpan di Docker volume selama Anda tidak menghapus volume Docker.

## Jika Port 8080 Bentrok

Jalankan dengan port lain, misalnya `8090`:

Windows PowerShell:

```powershell
$env:APP_PORT="8090"; docker compose up -d
```

macOS / Linux:

```sh
APP_PORT=8090 docker compose up -d
```

Lalu buka `http://localhost:8090`.

## Perintah Manual Jika Diperlukan

Build image:

```sh
docker compose build
```

Migrasi dan seed ulang:

```sh
docker compose run --rm api sh -c "npx prisma migrate deploy && npm run db:seed && npm run db:seed:demo-user"
```

Lihat status container:

```sh
docker compose ps
```

Lihat log:

```sh
docker compose logs -f
```

## Troubleshooting Cepat

Jika muncul pesan:

```text
Cannot connect to the Docker daemon
```

Buka Docker Desktop terlebih dahulu, tunggu sampai statusnya running, lalu ulangi perintah.

Jika halaman tidak bisa dibuka di `http://localhost:8080`, cek apakah container sudah berjalan:

```sh
docker compose ps
```

Jika salah satu service gagal, lihat lognya:

```sh
docker compose logs -f api worker frontend postgres redis
```
