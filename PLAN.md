# Plan: Form Check

## Stack
- **Cloudflare Worker** (`site/`): serves the static site and, from Phase 3, `/api/*`.
  Deployed by Cloudflare's Git integration. **Root directory: `site`.**
- **MediaPipe Pose Landmarker** in the browser, pinned to `@mediapipe/tasks-vision@1.0.1`.
- **Supabase**: its own project (not Feed Cleaner's). Auth with anonymous sign-in, Postgres
  with row level security. Schema in `supabase/migrations/`.
- **GitHub**: one repo; `main` is production.

## Structure
```
FormCheck/
  SPEC.md, PLAN.md, README.md
  site/
    public/            static site: index.html, app.html, css/, js/
      js/form.js       rep counting + checks (pure, unit-tested)
      js/app.js        camera + MediaPipe + UI
      js/hero.js       landing-page figure
    src/index.ts       Worker: serves assets, /api/* from Phase 3
    test/              node tests for form.js
    wrangler.jsonc
  supabase/migrations/ schema (tested locally in PGlite before running)
```

## Phase 1: Camera demo (done)
- [x] Landing page and `/app` camera page
- [x] Rep counting and three checks in `form.js`, unit-tested with synthetic poses
- [x] Video file option, so the team can test on recorded clips
- [ ] Try it on a real person, side-on, laptop and phone

**Done when:** a teammate can open the link, start the camera and see reps counted.

## Phase 2: Tune against real reps
- [ ] Film 5 sets of 10 (kept locally, never committed; `.gitignore` blocks video files)
- [ ] Label real rep counts and each rep's three checks
- [ ] Adjust thresholds in `form.js`, bump `RULES_VERSION` each time
- [ ] Get one set labelled by someone with coaching experience

**Done when:** the SPEC targets are measured, even if they aren't met yet.

## Phase 3: Save workouts
- [ ] Run `supabase/migrations/...core_schema.sql` in the new Supabase project
- [ ] Turn on anonymous sign-ins
- [ ] Add `@supabase/server` + `@supabase/supabase-js` to `site/`; Worker routes for
      workouts, sets, reps and labels (`auth: 'user'`, row level security does the rest)
- [ ] Secrets: `npx wrangler secret put SUPABASE_SECRET_KEY`; `site/.dev.vars` locally
- [ ] App: sign in anonymously, save each set, a labelling screen, stats from the views

**Done when:** a finished set shows up in `daily_stats` and labels move `check_metrics`.

## Security checklist
- [ ] `git check-ignore -v .env site/.dev.vars` shows both ignored
- [ ] No secret key in `site/public/` (the publishable key is fine there)
- [ ] No video files in the repo
