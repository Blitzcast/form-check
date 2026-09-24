// Squat rep counting and form checks from MediaPipe pose landmarks.
// Pure functions and no DOM, so the same code runs in the browser and in node tests.
// Every threshold is a guess: not tuned, not validated. Bump RULES_VERSION when one changes.

export const RULES_VERSION = "v1-guess";

export const RULES = {
  downKneeAngle: 110, // knee angle below this: the rep has reached its bottom half
  upKneeAngle: 160, // back above this: the rep is finished
  maxTorsoLean: 45, // degrees from vertical
  maxHeelLift: 0.03, // share of leg length (thigh + shin)
  minVisibility: 0.5, // MediaPipe's 0-1 visibility per landmark
  smoothing: 0.5, // weight of the newest frame in the moving average
  // Setup guards, checked between reps. From the side, left and right joints overlap.
  maxShoulderSpread: 0.45, // left-right shoulder gap vs torso length; wider = facing the camera
  minHipToAnkleDrop: 0.35, // standing, ankle below hip by this share of leg length, or the video is rotated
  maxStanceSpread: 0.5, // ankle gap vs leg length; wider = lunge or split stance
};

// BlazePose landmark indices for each side of the body.
export const SIDES = {
  left: { shoulder: 11, hip: 23, knee: 25, ankle: 27, heel: 29 },
  right: { shoulder: 12, hip: 24, knee: 26, ankle: 28, heel: 30 },
};

export const REQUIRED_JOINTS = ["shoulder", "hip", "knee", "ankle", "heel"];

/** Angle at b, in degrees, between the lines b→a and b→c. */
export function angleAt(a, b, c) {
  const ab = Math.atan2(a.y - b.y, a.x - b.x);
  const cb = Math.atan2(c.y - b.y, c.x - b.x);
  let deg = Math.abs((ab - cb) * (180 / Math.PI));
  if (deg > 180) deg = 360 - deg;
  return deg;
}

/** Torso lean in degrees from vertical (0 = upright). Image y grows downward. */
export function torsoLean(shoulder, hip) {
  return Math.atan2(Math.abs(shoulder.x - hip.x), hip.y - shoulder.y) * (180 / Math.PI);
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** The side facing the camera: whichever has the more visible joints. */
export function pickSide(landmarks) {
  const score = (side) => REQUIRED_JOINTS.reduce((sum, j) => sum + (landmarks[SIDES[side][j]]?.visibility ?? 0), 0);
  return score("left") >= score("right") ? "left" : "right";
}

/**
 * Tracks one set of squats. Call update() once per video frame.
 * Landmarks are MediaPipe's normalized coordinates; width/height convert them to pixels
 * so angles aren't distorted by the video's aspect ratio.
 */
export function createSquatCounter(rules = RULES) {
  let phase = "up";
  let side = null;
  let smoothed = null;
  let heelBaseline = null;
  let lastUpAt = null;
  let current = null;
  let rotated = null; // verdict from the last straight-legged frame; null until there is one
  const reps = [];
  let frames = 0;
  let visibleFrames = 0;

  const ema = (prev, next) => (prev === null ? next : prev + rules.smoothing * (next - prev));

  function update(landmarks, width, height, timeMs) {
    frames++;
    if (!landmarks || landmarks.length < 33) return { status: "no-person", phase, reps: reps.length };

    if (phase === "up" || side === null) side = pickSide(landmarks);
    const idx = SIDES[side];
    const hidden = REQUIRED_JOINTS.filter((j) => (landmarks[idx[j]].visibility ?? 0) < rules.minVisibility);
    if (hidden.length > 0) return { status: "not-visible", hidden, side, phase, reps: reps.length };
    visibleFrames++;

    const px = (j) => ({ x: landmarks[idx[j]].x * width, y: landmarks[idx[j]].y * height });
    const shoulder = px("shoulder");
    const hip = px("hip");
    const knee = px("knee");
    const ankle = px("ankle");
    const heel = px("heel");
    const legLength = dist(hip, knee) + dist(knee, ankle);

    // Refuse to grade setups the rules can't judge. Checked only between reps, but a fast
    // or low-frame-rate rep can reach the bottom before the smoothed angle says "down", so
    // every guard must also hold at the bottom of a deep squat.
    if (phase === "up") {
      const gap = (j) => Math.abs(landmarks[SIDES.left[j]].x - landmarks[SIDES.right[j]].x) * width;
      // Upright video: standing straight, the ankles are far below the hip and the shoulders
      // above it. A deep squat can sink the hip to ankle height, so the call is made only on
      // straight-legged frames and holds until the next one.
      if (rotated === null || angleAt(hip, knee, ankle) > rules.upKneeAngle) {
        rotated = !((ankle.y - hip.y) / legLength > rules.minHipToAnkleDrop && hip.y > shoulder.y);
      }
      let problem = null;
      if (rotated) problem = "rotated";
      // Shoulders only: MediaPipe puts the hip points close together even front-on.
      else if (gap("shoulder") / dist(shoulder, hip) > rules.maxShoulderSpread) problem = "front-view";
      else if (gap("ankle") / legLength > rules.maxStanceSpread) problem = "split-stance";
      if (problem) {
        smoothed = null;
        return { status: problem, side, phase, reps: reps.length };
      }
    }

    smoothed = {
      knee: ema(smoothed?.knee ?? null, angleAt(hip, knee, ankle)),
      lean: ema(smoothed?.lean ?? null, torsoLean(shoulder, hip)),
    };
    const kneeAngle = smoothed.knee;
    const lean = smoothed.lean;
    let completed = null;

    if (phase === "up") {
      if (kneeAngle > rules.upKneeAngle) {
        lastUpAt = timeMs;
        heelBaseline = heelBaseline === null ? heel.y : heelBaseline + 0.1 * (heel.y - heelBaseline);
      }
      if (kneeAngle < rules.downKneeAngle) {
        phase = "down";
        current = {
          startedAt: lastUpAt ?? timeMs,
          minKnee: kneeAngle,
          maxLean: lean,
          maxHipDrop: (hip.y - knee.y) / legLength,
          maxHeelLift: 0,
        };
      }
    } else {
      current.minKnee = Math.min(current.minKnee, kneeAngle);
      current.maxLean = Math.max(current.maxLean, lean);
      current.maxHipDrop = Math.max(current.maxHipDrop, (hip.y - knee.y) / legLength);
      if (heelBaseline !== null) {
        current.maxHeelLift = Math.max(current.maxHeelLift, (heelBaseline - heel.y) / legLength);
      }
      if (kneeAngle > rules.upKneeAngle) {
        completed = {
          rep_number: reps.length + 1,
          started_at_ms: current.startedAt,
          duration_ms: Math.max(1, Math.round(timeMs - current.startedAt)),
          min_knee_angle: round(current.minKnee, 1),
          max_torso_lean: round(current.maxLean, 1),
          max_heel_lift: round(Math.max(0, current.maxHeelLift), 3),
          depth_ok: current.maxHipDrop >= 0, // hip reached knee height or lower
          torso_ok: current.maxLean <= rules.maxTorsoLean,
          heels_ok: current.maxHeelLift <= rules.maxHeelLift,
        };
        reps.push(completed);
        phase = "up";
        lastUpAt = timeMs;
        current = null;
      }
    }

    return {
      status: "tracking",
      side,
      phase,
      kneeAngle,
      torsoLean: lean,
      hipBelowKnee: hip.y >= knee.y,
      reps: reps.length,
      completed,
    };
  }

  function summary() {
    return {
      rules_version: RULES_VERSION,
      counted_reps: reps.length,
      visible_frame_ratio: frames === 0 ? 0 : round(visibleFrames / frames, 3),
      reps: [...reps],
    };
  }

  return { update, summary };
}

function round(n, places) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
