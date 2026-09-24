// Unit tests for the rep counter, using synthetic side-view poses with known geometry.
// Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { angleAt, torsoLean, pickSide, createSquatCounter } from "../public/js/form.js";

const W = 1000;
const H = 1000;
const rad = (d) => (d * Math.PI) / 180;

/**
 * A left-side-facing pose (the person faces +x) in normalized coordinates.
 * shinTilt: degrees the shin leans forward from vertical.
 * thigh: degrees the knee→hip line is rotated back from vertical (90 = level, >90 = hip below knee).
 * lean: torso lean from vertical. heelLift: pixels the heel rises.
 */
function pose({ shinTilt = 0, thigh = 0, lean = 5, heelLift = 0, visibility = 0.95 }) {
  const ankle = { x: 500, y: 900 };
  const knee = { x: ankle.x + 250 * Math.sin(rad(shinTilt)), y: ankle.y - 250 * Math.cos(rad(shinTilt)) };
  const hip = { x: knee.x - 250 * Math.sin(rad(thigh)), y: knee.y - 250 * Math.cos(rad(thigh)) };
  const shoulder = { x: hip.x + 300 * Math.sin(rad(lean)), y: hip.y - 300 * Math.cos(rad(lean)) };
  const heel = { x: ankle.x - 30, y: ankle.y + 10 - heelLift };

  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.1 }));
  const put = (i, p, v = visibility) => (lm[i] = { x: p.x / W, y: p.y / H, z: 0, visibility: v });
  const near = [shoulder, hip, knee, ankle, heel];
  [11, 23, 25, 27, 29].forEach((i, n) => put(i, near[n]));
  // Far side: hidden behind the near side, so it overlaps it and is barely visible.
  [12, 24, 26, 28, 30].forEach((i, n) => put(i, { x: near[n].x + 8, y: near[n].y }, 0.3));
  return lm;
}

/** Front view: both sides visible and a torso-width apart. */
function frontPose() {
  const lm = pose(standing);
  for (const [l, r] of [[11, 12], [23, 24], [25, 26], [27, 28], [29, 30]]) {
    lm[l] = { ...lm[l], x: lm[l].x - 0.09 };
    lm[r] = { ...lm[l], x: lm[l].x + 0.18, visibility: 0.95 };
  }
  return lm;
}

const standing = { shinTilt: 0, thigh: 0, lean: 5 };

/** Feed frames that go from standing to the bottom position and back, like one rep. */
function rep(counter, bottom, t0, steps = 12) {
  let t = t0;
  let last;
  const frames = [];
  for (let i = 0; i <= steps; i++) frames.push(i / steps);
  for (let i = steps - 1; i >= 0; i--) frames.push(i / steps);
  for (const f of frames) {
    const p = {};
    for (const k of Object.keys(bottom)) p[k] = (standing[k] ?? 0) + f * (bottom[k] - (standing[k] ?? 0));
    last = counter.update(pose(p), W, H, t);
    t += 33;
  }
  // Settle standing so smoothing catches up and the rep completes.
  for (let i = 0; i < 6; i++) {
    const r = counter.update(pose(standing), W, H, t);
    last = r.completed ? r : last;
    t += 33;
  }
  return { t, last };
}

test("angleAt measures the angle at the middle point", () => {
  assert.equal(Math.round(angleAt({ x: 0, y: -1 }, { x: 0, y: 0 }, { x: 1, y: 0 })), 90);
  assert.equal(Math.round(angleAt({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })), 180);
});

test("torsoLean is 0 upright and 45 on the diagonal", () => {
  assert.equal(Math.round(torsoLean({ x: 0, y: 0 }, { x: 0, y: 10 })), 0);
  assert.equal(Math.round(torsoLean({ x: 10, y: 0 }, { x: 0, y: 10 })), 45);
});

test("the pose helper produces the knee angle it claims", () => {
  const lm = pose({ shinTilt: 30, thigh: 100 });
  const px = (i) => ({ x: lm[i].x * W, y: lm[i].y * H });
  // knee→hip is 100° back from straight up; knee→ankle is 30° back from straight down: 180 - 100 - 30 = 50°.
  const angle = angleAt(px(23), px(25), px(27));
  assert.ok(Math.abs(angle - 50) < 0.5, `knee angle ${angle}`);
});

test("pickSide chooses the more visible side", () => {
  const lm = pose(standing);
  assert.equal(pickSide(lm), "left");
});

test("counts reps and grades each check", () => {
  const c = createSquatCounter();
  let t = 0;
  for (let i = 0; i < 10; i++) c.update(pose(standing), W, H, (t += 33));

  // 1. Good rep: deep (hip below knee), upright enough, heels down.
  ({ t } = rep(c, { shinTilt: 30, thigh: 100, lean: 30 }, t));
  // 2. Shallow: bends past the down threshold but the hip stays above the knee.
  ({ t } = rep(c, { shinTilt: 25, thigh: 60, lean: 25 }, t));
  // 3. Leaning: deep but the torso tips past 45°.
  ({ t } = rep(c, { shinTilt: 30, thigh: 100, lean: 60 }, t));
  // 4. Heels up: deep, upright, but the heel rises 60px (~12% of leg length).
  ({ t } = rep(c, { shinTilt: 30, thigh: 100, lean: 30, heelLift: 60 }, t));
  // 5. Half bend that never reaches the down threshold: not a rep.
  ({ t } = rep(c, { shinTilt: 10, thigh: 30, lean: 10 }, t));

  const s = c.summary();
  assert.equal(s.counted_reps, 4);
  const checks = s.reps.map((r) => [r.depth_ok, r.torso_ok, r.heels_ok]);
  assert.deepEqual(checks, [
    [true, true, true],
    [false, true, true],
    [true, false, true],
    [true, true, false],
  ]);
  assert.equal(s.visible_frame_ratio, 1);
  for (const r of s.reps) {
    assert.ok(r.duration_ms > 0);
    assert.ok(r.min_knee_angle > 0 && r.min_knee_angle < 110);
  }
});

test("setups it can't judge are refused, not graded", () => {
  const rotate90 = (lm) => lm.map((p) => ({ ...p, x: 1 - p.y, y: p.x }));
  const upsideDown = (lm) => lm.map((p) => ({ ...p, x: 1 - p.x, y: 1 - p.y }));
  const lunge = () => {
    const lm = pose(standing);
    lm[28] = { ...lm[28], x: lm[27].x - 0.35 }; // back foot a stride behind
    return lm;
  };
  const cases = [
    ["front-view", frontPose],
    ["rotated", () => rotate90(pose(standing))],
    ["rotated", () => upsideDown(pose(standing))],
    ["split-stance", lunge],
  ];
  for (const [status, make] of cases) {
    const c = createSquatCounter();
    assert.equal(c.update(make(), W, H, 0).status, status);
    assert.equal(c.summary().counted_reps, 0);
  }
});

test("full squats in a rotated video are never counted", () => {
  const rotations = [
    (lm) => lm.map((p) => ({ ...p, x: 1 - p.y, y: p.x })), // 90° one way
    (lm) => lm.map((p) => ({ ...p, x: p.y, y: 1 - p.x })), // 90° the other way
    (lm) => lm.map((p) => ({ ...p, x: 1 - p.x, y: 1 - p.y })), // upside down
  ];
  for (const rotate of rotations) {
    const c = createSquatCounter();
    let t = 0;
    for (let r = 0; r < 3; r++) {
      for (const d of [0, 0.2, 0.4, 0.6, 0.8, 1, 0.8, 0.6, 0.4, 0.2, 0, 0, 0]) {
        c.update(rotate(pose({ shinTilt: 30 * d, thigh: 100 * d, lean: 5 + 25 * d })), W, H, (t += 33));
      }
    }
    assert.equal(c.summary().counted_reps, 0);
  }
});

test("a normal side view passes the setup guards", () => {
  const c = createSquatCounter();
  assert.equal(c.update(pose(standing), W, H, 0).status, "tracking");
});

test("frames with hidden joints are skipped, not counted", () => {
  const c = createSquatCounter();
  const r = c.update(pose({ ...standing, visibility: 0.2 }), W, H, 0);
  assert.equal(r.status, "not-visible");
  assert.ok(r.hidden.includes("knee"));
  assert.equal(c.update(null, W, H, 33).status, "no-person");
  c.update(pose(standing), W, H, 66);
  assert.equal(c.summary().visible_frame_ratio, 0.333);
});
