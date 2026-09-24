# Red team: Form Check

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
E1, E2, M1, S1, and a live look at E3, O2, O3, S2.
