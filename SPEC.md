# Form Check (draft spec for the team)

# Problem
People training at home or without a coach can't see their own squat. Mirrors show the
front, not the side, and filming yourself means watching the clip afterwards and guessing.
Nobody tells you, rep by rep, whether you hit depth or let your chest drop.

# Product
Web app, laptop or phone browser. The camera films you side-on; a pose model (MediaPipe
Pose Landmarker) runs in the browser and finds 33 body points per frame. Angle rules count
reps and grade each one on three checks: depth (hip reaches knee height), chest up (torso
within 45° of vertical), heels down. Video never leaves the device; only numbers are saved.
Rules are guessed. Never call them tuned or validated.

# Success looks like
One session: 5 sets of 10 bodyweight squats, filmed side-on. For each set, write down the
real rep count. For each rep, label the three checks yourself (good / needs work).
- Rep count: within ±1 of the real count on ≥95% of sets
- Check precision (reps flagged "needs work" that really needed work): ≥80% per check
- Check recall (bad reps that got flagged): ≥60% per check
- Speed: ≥20 frames per second on a mid-range laptop
- Visibility: required joints visible in ≥90% of frames with a sensible camera setup
Kill condition: rep count within ±1 on fewer than 80% of sets after two rounds of tuning.
Limit: the labeller isn't a coach. Get at least one set labelled by someone with coaching
experience before trusting the precision numbers.

# Why an on-device pose model, not a cloud video model
We considered sending video to a hosted video-language model (e.g. NVIDIA Cosmos Reason).
We chose MediaPipe Pose in the browser instead:
- Speed: it grades every frame live; a hosted model takes seconds per clip
- Precision: it measures joint positions; a language model estimates them by looking
- Privacy: video never leaves the device; a hosted model needs the clip uploaded
- Cost and limits: free with no rate limits; a hosted model has quotas and needs a server key
A hosted video model would add scene understanding (wrong exercise, bad camera angle). We
cover the common cases with setup guards (front view, rotated video, split stance) and
could add an opt-in "second opinion" review later.

# Out of scope
- Other exercises: squat first; each new exercise is new rules and new labels
- Front-view checks (knees caving in): needs a second camera angle
- Injury prevention or medical advice: it's practice feedback
- Uploading or storing video: privacy, and nothing needs it
- Multiple people in frame
- Native apps: the browser already has camera access on phones
