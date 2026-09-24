# Red team: Form Check

Two rounds. [Round 2](#round-2-real-model-real-browser) re-ran round 1 in a real browser
against the real pose model and found what the simulations missed.

# Round 1

Five axes, three concrete inputs each. Predictions were written down **before** any test ran.
"Before" is the site as demoed; "after" is with the fixes in this commit.

How each was checked:
- **Sim**: synthetic poses fed into `form.js` (`site/test/form.test.mjs` keeps these as unit tests)
- **Live**: requests against the deployed site or the Supabase API
- **Code**: confirmed by reading the code; still needs a person in a browser to see it happen

## Empty: what if there is nothing?

| # | Input | Should happen | Predicted | Before | Fix | After |
|---|---|---|---|---|---|---|
| E1 | Camera on, nobody in frame | 0 reps, "step into view" | Pass | Pass (code) | none | needs browser check |
| E2 | Camera blocked, or no camera | Clear how-to-fix message | Pass | Pass (code) | none | needs browser check |
| E3 | Offline when the pose model loads | "Model didn't load, check connection" | **Fail** | **Fail** (code): said "camera didn't start" | Separate model-load error | Fixed (code) |

## Malformed: what if it is the wrong shape?

| # | Input | Should happen | Predicted | Before | Fix | After |
|---|---|---|---|---|---|---|
| M1 | A PDF chosen as the video | "Didn't play", count stays 0 | Pass | Pass (code) | none | needs browser check |
| M2 | Squats filmed from the front | Refuse to grade, say "turn side-on" | **Fail** | **Fail** (sim): 5 counted, all "good" | Front-view guard: left/right shoulders and hips too far apart | **Pass** (sim): 0 counted, "front-view" |
| M3 | Video rotated 90° (both ways) or upside down | Refuse, say the picture is sideways | **Fail** | **Fail** (sim): chest failed every rep | Upright guard: ankles must be well below the hips | **Pass** (sim): 0 counted, "rotated". First version of the fix missed one rotation direction; a new test caught it |

## Adversarial: what if someone means harm?

| # | Input | Should happen | Predicted | Before | Fix | After |
|---|---|---|---|---|---|---|
| A1 | File named `<img src=x onerror=alert(1)>.mp4` | Shown as text, no script runs | Pass | Pass (code): names go in via `textContent` | none | Pass |
| A2 | Another site frames `/app` to trick a camera prompt | Browser refuses to frame it | **Fail** | **Fail** (live): no security headers | `_headers`: `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `nosniff`, camera limited to this site | Fixed (live headers verified) |
| A3 | Supabase with the public key: read others' data, write the catalog, forge a user id, dump the schema, sign up | All refused | Pass | **Pass** (live): reads return nothing private, writes 401 by row level security, schema dump 401, sign-up disabled | none | Pass |

## Out of scope: what if it is not your problem?

| # | Input | Should happen | Predicted | Before | Fix | After |
|---|---|---|---|---|---|---|
| O1 | Lunges instead of squats | Not counted, "squats only" | **Fail** | **Fail** (sim): 5 "good squats" | Split-stance guard: ankles a stride apart | **Pass** (sim): 0 counted, "split-stance" |
| O2 | Two people in frame | Follow one steadily, or warn | Unknown | Code: tracked 1, could swap people | Detect up to 2 people; pause and warn if 2 | Fixed (code) |
| O3 | In-app browser without camera access | "This browser can't use the camera" | Partial | Partial (code): raw error text | Feature check before starting | Fixed (code) |

## At scale: what if there is far too much?

| # | Input | Should happen | Predicted | Before | Fix | After |
|---|---|---|---|---|---|---|
| S1 | A 1-hour 4K video | Processes without crashing | Probably OK | not run | none | needs browser check |
| S2 | 50 videos chosen in a row | Memory stays flat | **Fail** | **Fail** (code): blob URLs never released | Revoke the previous video's URL | Fixed (code) |
| S3 | 100k+ requests/day to `/api/*` | Pages keep working | Pages OK, `/api` stops | **not run on purpose**: it would burn our own free quota | none needed: static pages don't count toward the Worker limit | n/a |

## Caveats

Everything the product already admits is a test above: side view only (M2), squats only (O1),
one person (O2), video never uploaded (check the Network tab: only the model, runtime and
fonts download), and "rules are guesses". That last one is **not** covered here: these tests
check behaviour, not accuracy. Accuracy is the SPEC's 5 × 10 labelled-squat session.

- Sim inputs are geometric approximations of real poses, not footage. Real video is noisier.
- The setup-guard thresholds (0.5 side spread, 0.35 hip-to-ankle drop, 0.5 stance) are
  guesses too. A wide-stance squat or a very deep squat could trip them; tune with real clips.
- Tables were empty during A3, so "no rows" alone doesn't prove blocking. The local test with
  two users and real rows is what proves row level security.
- The Content Security Policy only covers framing. A full policy (limiting scripts to
  jsDelivr) was left out because it can break MediaPipe's WebAssembly and couldn't be tested
  in a browser before the deadline.
- The MediaPipe runtime and model load from jsDelivr and Google without integrity checks.
  Self-hosting them in `site/public/` would remove that dependency.
- A Supabase secret key was pasted in a chat during setup. It must be rotated: with it, row
  level security doesn't apply.

## Still open, needs a person with a browser
E1, E2, M1, S1, and a live look at E3, O2, O3, S2. *(All run in round 2.)*

# Round 2: real model, real browser

Round 1 tested the rules on synthetic poses and left the browser checks for later. Round 2
ran the actual `/app` page, with the actual pose model, and pushed on the parts round 1
couldn't reach. There's no "Predicted" column this time: these inputs came from reading the
code and probing, not from a list written down in advance.

How each was checked:
- **Browser**: the real `/app` in headless Chromium, before (`main` at `d5a952f`) and after
  (this branch) side by side. Chromium's fake camera played still photos; video files went
  through the file picker. Same MediaPipe package (`@mediapipe/tasks-vision@1.0.1`) and
  model file as production. The test machine couldn't reach jsDelivr, so the package
  came from npm and was served at the jsDelivr URLs.
- **Real model**: MediaPipe's own test photos: a man standing front-on and a warrior-II
  lunge. Each was placed into a 1280×720 frame several ways: near, far, at the edge,
  squeezed sideways to mimic turning, rotated, two copies side by side, and cut off at the
  waist.
- **Sim**: synthetic poses into `form.js`, as in round 1, now also at phone frame rates.
- **DB**: the migrations applied to an in-memory Postgres (PGlite), two users, real rows.
  This is now part of `npm test`.

## Round 1, re-run in a browser

| # | Round 1 left it as | Browser, before | After |
|---|---|---|---|
| E1 | needs browser check | **Pass**: "Step into view", 0 reps | Pass |
| E2 | needs browser check | **Pass**: blocked camera and no camera each get their message | Pass |
| E3 | Fixed (code) | **Pass**: "model didn't load"; pressing Start again once online works | Pass |
| M1 | needs browser check | **Pass**: "That video didn't play", 0 reps | Pass |
| M2 | Pass (sim) | **Fail** (real model): a real person front-on was graded as normal, knee 172°, no warning | Pass, see R2-1 |
| M3 | Pass (sim) | **Pass**: "looks sideways" | Pass |
| O1 | Pass (sim) | **Pass**: "feet look split" | Pass ("facing the camera": this lunge's torso faces the camera) |
| O2 | Fixed (code) | **Pass**: two people detected, counting paused | Pass |
| O3 | Fixed (code) | **Pass**: "This browser can't use the camera here" | Pass |
| S1 | needs browser check | **Pass**: a 10-minute 4K file played in real time (73 s of video in 74 s) with no errors, JS heap 44 MB | Pass |
| S2 | Fixed (code) | **Pass**: after 50 files in a row, 1 is held in memory | Pass |
| A1 | Pass | **Pass**: file name shown as text, no dialog | Pass |
| A2 | Fixed (live headers) | **Pass**: a third-party page can't frame `/app` (with the headers stripped, it can: the check works) | Pass |

## New findings

| # | Input | Should happen | Before | Fix | After |
|---|---|---|---|---|---|
| R2-1 | A real person standing front-on | "Turn side-on" | **Fail** (real model): the model puts its hip points close together (0.38 of torso length vs 0.64 for the shoulders), so the shoulder-and-hip average came out 0.45 to 0.51 against a 0.5 limit. Tracked in the live camera run | Front-view guard uses shoulders only, limit 0.45 | **Pass** (real model): all four front-on framings refused; turned about 45° refused; closer to side-on graded |
| R2-2 | Deep squats on a phone (5 to 10 frames/s) | Counted, depth ✓ | **Fail** (sim): smoothing lags a frame, so the setup guards saw the bottom of the squat, where the hip sits near ankle height, and called the video "rotated". At 5 fps: 7 of 10 ass-to-grass reps counted, 1 got depth ✓. "Picture looks sideways" flashed mid-rep | Rotation is judged only on straight-legged frames; the verdict holds through the rep | **Pass** (sim): 10 of 10 counted and depth ✓ at 5, 6, 8, 10, 15, 30 fps. Rotated videos of deep squats still count 0. My first fix (shin direction) let one rotation through at the bottom; a new test caught it |
| R2-3 | Start camera pressed twice while the model loads | One camera | **Fail** (browser): 2 camera streams; after Stop camera, 1 was still live, so the camera light stays on | Presses ignored while starting; one shared model load | **Pass**: 1 stream, 0 live after Stop |
| R2-4 | Browser that rounds its clock (Tor Browser, Firefox with resistFingerprinting) | Keeps counting | **Fail** (browser): two frames got the same timestamp, MediaPipe went into "Graph has error" and the loop died with no message | Timestamps forced to increase; the loop survives a bad frame and says so | **Pass**: no errors, still grading |
| R2-5 | An audio-only file (the `video/*` picker lets `.webm` audio through) | "No picture" | **Fail** (browser): "Video finished: 0 reps counted". Worse, the model broke, so the *next* real video also finished with 0 reps | Check the file has a picture before analysing it | **Pass**: "has sound but no picture"; the next video is graded |
| R2-6 | The same video chosen twice | Plays again | **Fail** (browser): nothing happens | Clear the picker after each choice | **Pass** |
| R2-7 | Screen reader during setup | Status read once | **Fail** (browser): the status (a live region) was rewritten with the same text every frame: 13 times in 6 s at 2 fps here, about 30 a second on a laptop | Write only when the text changes | **Pass**: 0 rewrites |
| R2-8 | Injected markup loading a script from jsDelivr | Blocked | **Fail** (browser): no script policy, and jsDelivr serves every npm package | Full Content Security Policy; scripts limited to MediaPipe's exact package path | **Pass**: blocked. Across 22 scenarios the model loads and runs; the only violations are the two meant to happen (this test and R2-9) |
| R2-9 | Leave the page open for a minute | "Nothing is uploaded" | **Fail** (browser): MediaPipe POSTs 141 bytes to `odml.pa.googleapis.com/v1/log` about 60 s in: its version and timing counters, no images or joints. Round 1's Network-tab check was shorter than that | The CSP leaves that host out | **Pass**: blocked, the model keeps working |
| R2-10 | Camera permission prompt left open | Tell the person to allow it | Status still said "Loading the pose model" | "Allow camera access if your browser asks." | Pass (browser) |
| R2-11 | A video file in a tab that's switched away | Keep counting, or pause | **Fail** (code): hidden tabs get no animation frames but the video keeps playing, so reps go uncounted without a word. Headless Chromium can't really hide a tab; confirmed the original keeps playing on a simulated hide | Pause while hidden, resume on return | **Pass** (simulated hide): paused, then resumed |
| R2-12 | One anonymous user writes a 10 MB string or a 100,000-digit number | Refused | **Fail** (PGlite): accepted. About 50 such rows fill the free plan's 500 MB | `20260924170000_size_limits.sql`: length, range and decimal-place limits | **Pass** |
| R2-13 | Round 1's open caveat: row level security with two users and real rows | Every cross-user read or write refused | **Pass** (PGlite): 13 attacks (read, update, delete, attach a set to someone else's workout, forge `user_id`, label someone else's rep, write the catalog) all refused | none | Pass, now in `npm test` |

Also checked: sitting at the laptop (upper body only) and standing too close (feet cut off)
both get "can't see your ankle, heel". Pass, real model.

## Caveats, round 2

- **No real squat footage yet.** The real-model inputs are photos of two people. The thing
  being graded, a side view, still has only simulated tests. The 0.45 front-view limit
  rests on one person (front-on shoulders: 0.52 to 0.64); broad or narrow shoulders move
  it, and a side view has never been measured on the real model. If real side-on clips
  show "facing the camera", raise the limit.
- `RULES_VERSION` is now `v1-guess`: the guards changed which reps count, so v0 and v1
  numbers aren't comparable.
- At 5 fps, a squat that only just reaches parallel can still miss depth when no frame
  lands at the very bottom (9 of 10 in the sim). That's sampling, not a guard.
- Browser checks ran in headless Chromium only, on a software GPU at 1 to 2 fps. Safari,
  iPhone and Firefox weren't tested. Frame-rate results come from the sim.
- The CSP needs `'wasm-unsafe-eval'`. Safari 15 and older don't support it, so the model
  won't load there. Check an iPhone before a demo. The CSP names MediaPipe's version,
  so change `_headers` whenever `app.js` changes it.
- Size limits cap each row, not the number of rows. With anonymous sign-in on, keep
  Supabase's sign-in rate limit, and add CAPTCHA if junk shows up.
- Minor: rep ids count up from 1, so any user can tell roughly how many reps exist in
  total. Adding a label to someone else's rep fails with a different error depending on
  whether it's already labelled. Neither exposes any data; uuid ids would close both.
- Round 1's key rotation (the Supabase secret key pasted in chat) can't be checked from
  the repo. Confirm it was done.

## Still open, needs a person
A side-on squat set on a real phone (Safari and Chrome), the setup guards on real clips,
and a real hidden-tab check with a video file.
