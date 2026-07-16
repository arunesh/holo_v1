● Here are the steps. The app is already wired to use the client ID — you only need to create it in Google Cloud and drop it in an env file.

  1. Create/pick a Google Cloud project
  - Go to https://console.cloud.google.com/ → project picker (top bar) → New project → name it e.g. holodeck → Create.

  2. Configure the OAuth consent screen (one-time, required before you can create credentials)
  - Menu → APIs & Services → OAuth consent screen (Google now calls this "Google Auth Platform → Branding").
  - User type: External → Create.
  - Fill the minimum: app name Holodeck, your email for both support and developer contact → Save.
  - Scopes: you can skip adding any — the app only requests openid email profile, which are non-sensitive and don't need review.
  - Audience/Test users: while the app is in Testing status, add the Google accounts (yours + anyone trying it) as test users. You can stay in Testing indefinitely for a hobby app; "Publish" only matters
  when you want any Google account to sign in.

  3. Create the OAuth client ID
  - APIs & Services → Credentials → Create credentials → OAuth client ID.
  - Application type: Web application, name it holodeck-web.
  - Under Authorized JavaScript origins, add every origin you'll open the app from:
    - http://localhost:8350
    - http://localhost:4173 (if you ever use vite preview)
    - your real domain later, e.g. https://holodeck.example.com
  - You do not need any redirect URI — the app uses Google Identity Services' token popup flow, which only checks origins.
  - Create → copy the Client ID. You don't need the client secret; this is a browser-only flow.

  4. Give it to the app
  echo 'VITE_GOOGLE_CLIENT_ID=<your-client-id>' > /home/azureuser/holodeck/holo_v1/frontend/.env.local
  Then restart the vite dev server (env vars are read at startup — I can do this for you once you've added the ID). The "Continue with Google" button will then open the real account picker, and the app
  stores your name/email/avatar in the session.

  One important caveat for how you currently access the app: you've been opening it via http://20.64.234.8:8350. Google rejects raw IP addresses and non-HTTPS origins (localhost is the only http
  exception), so Google sign-in will not work from that URL. Two options:

  - SSH tunnel (quickest): ssh -L 8350:localhost:8350 azureuser@20.64.234.8 on your laptop, then open http://localhost:8350 — that origin is allowed.
  - Proper setup for later: point a domain at the VM and serve over HTTPS (e.g. Caddy or nginx with Let's Encrypt — note we don't have sudo on this box, so that would need the admin), then add
  https://yourdomain as an origin.

  Also worth knowing: sign-in is currently client-side only — the backend doesn't verify anything, so it personalizes the UI but doesn't protect the API. If you later want real protection, the next step
  would be sending Google's ID token to FastAPI and verifying it there; happy to build that when you're ready.
