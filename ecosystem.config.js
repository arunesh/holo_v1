// pm2 config for production: one uvicorn process on :8350 (nginx proxies
// myholodeck.app here). It serves the API, websockets, and the built
// frontend from frontend/dist. Env/API keys come from the repo-root .env,
// which the backend loads itself (backend/app/config.py).
const path = require('path')

const PORT = process.env.HOLODECK_PORT || '8350'

module.exports = {
  apps: [
    {
      name: 'holodeck',
      cwd: path.join(__dirname, 'backend'),
      script: '.venv/bin/python',
      args: `-m uvicorn app.main:app --host 0.0.0.0 --port ${PORT}`,
      interpreter: 'none',
      // Single process: the app keeps websocket/session state in memory.
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      min_uptime: '10s',
      kill_timeout: 5000,
      time: true, // timestamps in pm2 logs
    },
  ],
}
