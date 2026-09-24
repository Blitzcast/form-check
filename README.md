# Form Check

Squat feedback from your camera. The browser finds your joints with MediaPipe, counts
reps, and grades each one on depth, chest position and heels. Video never leaves the device.

See `SPEC.md` for goals and targets, `PLAN.md` for phases.

## Run locally

Needs Node 22+.

```bash
cd site
npm install
npm test          # rep-counter unit tests
npm run dev       # http://localhost:8787, open /app for the camera
```

The camera works on `localhost` and on HTTPS sites only.

## Deploy

Cloudflare builds from GitHub. In the Worker's **Settings → Build**:

| Setting        | Value                |
| -------------- | -------------------- |
| Root directory | `site`               |
| Build command  | *(empty)*            |
| Deploy command | `npx wrangler deploy` |

## Database

`supabase/migrations/` holds the schema. Paste it into the Supabase SQL Editor (or use
`npx supabase db push`), then turn on anonymous sign-ins under Authentication.
