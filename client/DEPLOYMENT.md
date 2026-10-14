# Framehouse deployment

Deploy the existing project's backend to Render and React frontend to Vercel:

1. Push this existing project to a Git repository. Render and Vercel both need access to that repository. The root `.gitignore` excludes private `.env` files, dependencies, build output, and the server's local mail outbox; verify no secrets are staged before pushing.
2. In Render, create a Blueprint from the repository root. It reads `render.yaml` and creates the `framehouse-api` web service. Set the prompted environment values: `MONGO_URI`, a long random `JWT_SECRET`, and `CLIENT_URL` to the Vercel production origin. Add valid Razorpay keys and SMTP values if those integrations are enabled. Do not set `PORT`; Render provides it.
3. Wait for the Render health check at `/` to pass and note the service's public origin, for example `https://framehouse-api.onrender.com`.
4. Import the same repository into Vercel. Set **Root Directory** to `client`; keep the Vite build command `npm run build` and output directory `dist`.
5. In Vercel project settings, set `VITE_API_URL` to the Render public origin (without `/api`) for Preview and Production. Set `VITE_SOCKET_URL` to that same origin, or omit it to derive it from `VITE_API_URL`.
6. Deploy, then verify the site opens publicly, test a nested route such as `/meeting/ROOMID`, and exercise sign-in and a meeting using real configured services.

The backend needs a public MongoDB connection and the production environment variables from `server/.env.example`. Set its `CLIENT_URL` to the Vercel production origin (and any preview origins that should be allowed). Keep `JWT_SECRET`, payment secrets, database credentials, and SMTP credentials server-side; never define them as `VITE_*` variables.

The Express backend starts an HTTP server for REST and Socket.IO in `server/index.js`; deploy it to a Node host that supports persistent Socket.IO connections. Render's free service may sleep after inactivity, interrupting real-time meetings until it wakes; choose an always-on plan if continuous availability is required. Vercel's WebSocket Functions are a separate integration and do not automatically adapt this existing server entry point.

For real Razorpay payments, configure valid Razorpay test or live keys on the backend and ensure checkout is configured there. Do not use demo payments in production.

`client/.env.example` documents the frontend variables. Local `.env` files are ignored and must not be committed.
