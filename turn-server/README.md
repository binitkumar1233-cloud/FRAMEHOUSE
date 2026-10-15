# Own TURN server

Relays call media so participants never see each other's IP addresses.
Render can't run this (it needs UDP), so use a small VPS (about 1 vCPU / 1 GB:
Hetzner, DigitalOcean, Oracle Free Tier, etc.).

1. Install Docker on the VPS and copy this folder to it.
2. `cp .env.example .env` and set `TURN_PUBLIC_IP` and a random `TURN_SECRET`.
3. Open firewall ports: **3478 UDP+TCP** and **49160-49200 UDP**.
4. `docker compose up -d`
5. On Render set:
   - `TURN_URLS` = `turn:YOUR_VPS_IP:3478?transport=udp,turn:YOUR_VPS_IP:3478?transport=tcp`
   - `TURN_SECRET` = the same secret
   - `TURN_RELAY_ONLY` = `true`
6. Redeploy. Join a call; the security panel / browser `chrome://webrtc-internals`
   should show candidate type `relay`.

Credentials are generated per user by the API and expire after 6 hours.
