// Camera demo: MediaPipe finds the body points, form.js counts reps and grades them.
// Everything runs in this tab. The model and its runtime are downloaded; video is never uploaded.
import { FilesetResolver, PoseLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs";
import { createSquatCounter, REQUIRED_JOINTS, RULES, SIDES } from "./form.js";

const MEDIAPIPE = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm";
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";

const $ = (id) => document.getElementById(id);
const stage = $("stage");
const video = $("video");
const canvas = $("overlay");
const ctx = canvas.getContext("2d");
const ui = {
  status: $("status"),
  reps: $("reps"),
  knee: $("knee"),
  lean: $("lean"),
  fps: $("fps"),
  log: $("rep-log"),
  empty: $("rep-empty"),
  camera: $("camera"),
  file: $("file"),
  reset: $("reset"),
};

const COLORS = { good: "#3fbf7f", fix: "#ff6b5e", joint: "#f2f4f1", line: "rgba(242, 244, 241, 0.75)" };
const JOINT_NAMES = { shoulder: "shoulder", hip: "hip", knee: "knee", ankle: "ankle", heel: "heel" };
// Setups form.js refuses to grade, and what to tell the person.
const SETUP_PROBLEMS = {
  "front-view": "You're facing the camera. Turn side-on: Form Check grades squats from the side.",
  rotated: "The picture looks sideways or upside down. Hold the phone upright, or use an upright video.",
  "split-stance": "Your feet look split, like a lunge. Form Check only grades squats, so stand with your feet side by side.",
};

let landmarker = null;
let counter = createSquatCounter();
let stream = null;
let videoUrl = null;
let running = false;
let lastFrameTime = -1;
let fpsFrames = 0;
let fpsSince = performance.now();

function setStatus(text, tone = "info") {
  ui.status.textContent = text;
  ui.status.dataset.tone = tone;
}

async function loadModel() {
  if (landmarker) return landmarker;
  setStatus("Loading the pose model. This takes a few seconds the first time.", "wait");
  const vision = await FilesetResolver.forVisionTasks(MEDIAPIPE);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL, delegate },
    runningMode: "VIDEO",
    numPoses: 2, // so a second person is noticed instead of silently swapped in
  });
  try {
    landmarker = await PoseLandmarker.createFromOptions(vision, options("GPU"));
  } catch {
    landmarker = await PoseLandmarker.createFromOptions(vision, options("CPU"));
  }
  return landmarker;
}

/** Loads the model, or explains the failure. Returns false if it didn't load. */
async function ensureModel() {
  try {
    await loadModel();
    return true;
  } catch {
    setStatus("The pose model didn't load. Check your internet connection, then try again.", "problem");
    return false;
  }
}

/** Frees the previously chosen video file so repeated picks don't pile up in memory. */
function releaseVideo() {
  if (videoUrl) URL.revokeObjectURL(videoUrl);
  videoUrl = null;
}

function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  ui.camera.textContent = "Start camera";
}

function cameraError(err) {
  if (err?.name === "NotAllowedError") {
    return "Camera access is blocked. Allow the camera for this site in your browser settings, then press Start camera again.";
  }
  if (err?.name === "NotFoundError") return "No camera found on this device. Choose a video file instead.";
  return `The camera didn't start (${err?.message ?? "unknown error"}). Try again or choose a video file.`;
}

function begin(mirrored) {
  counter = createSquatCounter();
  lastFrameTime = -1;
  ui.log.replaceChildren();
  ui.empty.hidden = false;
  ui.reps.textContent = "0";
  stage.classList.toggle("mirrored", mirrored);
  stage.classList.add("live");
  if (!running) {
    running = true;
    requestAnimationFrame(tick);
  }
}

ui.camera.addEventListener("click", async () => {
  if (stream) {
    stopCamera();
    setStatus("Camera stopped. Your reps stay listed until you reset.");
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("This browser can't use the camera here. Open the page in Chrome, Edge or Safari, or choose a video file.", "problem");
    return;
  }
  if (!(await ensureModel())) return;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.removeAttribute("src");
    releaseVideo();
    video.srcObject = stream;
    await video.play();
    ui.camera.textContent = "Stop camera";
    begin(true);
    setStatus("Stand side-on to the camera, 2 to 3 metres away, with your whole body in view.");
  } catch (err) {
    stopCamera();
    setStatus(cameraError(err), "problem");
  }
});

ui.file.addEventListener("change", async () => {
  const file = ui.file.files?.[0];
  if (!file) return;
  if (!(await ensureModel())) return;
  try {
    stopCamera();
    video.srcObject = null;
    releaseVideo();
    videoUrl = URL.createObjectURL(file);
    video.src = videoUrl;
    video.muted = true;
    await video.play();
    begin(false);
    setStatus(`Checking ${file.name}.`);
  } catch (err) {
    setStatus(`That video didn't play (${err?.message ?? "unknown error"}). Try an MP4 or WebM file.`, "problem");
  }
});

video.addEventListener("ended", () => {
  const n = counter.summary().counted_reps;
  setStatus(`Video finished: ${n} ${n === 1 ? "rep" : "reps"} counted.`, "ok");
});

ui.reset.addEventListener("click", () => {
  counter = createSquatCounter();
  ui.log.replaceChildren();
  ui.empty.hidden = false;
  ui.reps.textContent = "0";
  setStatus("Count reset.");
});

window.addEventListener("pagehide", stopCamera);

function tick() {
  if (!running) return;
  if (landmarker && video.readyState >= 2 && video.currentTime !== lastFrameTime && !video.paused) {
    lastFrameTime = video.currentTime;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const now = performance.now();
    const people = landmarker.detectForVideo(video, now).landmarks;
    if (people.length > 1) {
      // Don't guess which person to follow: that would invent or drop reps.
      ctx.clearRect(0, 0, w, h);
      setStatus("Two people are in view. Form Check follows one person, so ask others to step out of frame.", "problem");
    } else {
      const result = counter.update(people[0], w, h, now);
      draw(people[0], result, w, h);
      showResult(result);
    }
    countFrame(now);
  }
  requestAnimationFrame(tick);
}

function draw(landmarks, result, w, h) {
  ctx.clearRect(0, 0, w, h);
  if (!landmarks || !result.side) return;
  const idx = SIDES[result.side];
  const p = (j) => ({ x: landmarks[idx[j]].x * w, y: landmarks[idx[j]].y * h });
  const scale = Math.max(2, w / 320);

  const segment = (a, b, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = scale * 1.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p(a).x, p(a).y);
    ctx.lineTo(p(b).x, p(b).y);
    ctx.stroke();
  };
  const tracking = result.status === "tracking";
  segment("shoulder", "hip", tracking && result.torsoLean > RULES.maxTorsoLean ? COLORS.fix : COLORS.line);
  segment("hip", "knee", tracking && result.hipBelowKnee ? COLORS.good : COLORS.line);
  segment("knee", "ankle", COLORS.line);
  segment("ankle", "heel", COLORS.line);

  for (const j of REQUIRED_JOINTS) {
    const hidden = result.hidden?.includes(j);
    ctx.fillStyle = hidden ? COLORS.fix : COLORS.joint;
    ctx.beginPath();
    ctx.arc(p(j).x, p(j).y, scale * 2.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function showResult(result) {
  if (result.status === "no-person") {
    setStatus("Step into view so the camera can see your whole body.", "problem");
    ui.knee.textContent = "–";
    ui.lean.textContent = "–";
    return;
  }
  if (result.status === "not-visible") {
    const names = result.hidden.map((j) => JOINT_NAMES[j]).join(", ");
    setStatus(`Turn side-on and step back. The camera can't see your ${names}.`, "problem");
    return;
  }
  if (SETUP_PROBLEMS[result.status]) {
    setStatus(SETUP_PROBLEMS[result.status], "problem");
    return;
  }
  ui.knee.textContent = `${Math.round(result.kneeAngle)}°`;
  ui.lean.textContent = `${Math.round(result.torsoLean)}°`;
  ui.reps.textContent = String(result.reps);
  if (result.completed) addRep(result.completed);
  else if (ui.status.dataset.tone === "problem" || ui.status.dataset.tone === "wait") {
    setStatus(result.phase === "down" ? "Tracking. Stand all the way up to finish the rep." : "Tracking. Squat when you're ready.");
  }
}

function addRep(rep) {
  ui.empty.hidden = true;
  const item = document.createElement("li");
  item.className = "rep";
  const checks = [
    ["Depth", rep.depth_ok],
    ["Chest up", rep.torso_ok],
    ["Heels down", rep.heels_ok],
  ];
  const good = checks.every(([, ok]) => ok);
  item.innerHTML = `
    <span class="rep-number">${rep.rep_number}</span>
    <ul class="checks">${checks
      .map(([name, ok]) => `<li class="check ${ok ? "good" : "fix"}"><span aria-hidden="true">${ok ? "✓" : "✗"}</span> ${name}<span class="visually-hidden">: ${ok ? "good" : "needs work"}</span></li>`)
      .join("")}</ul>
    <span class="rep-detail">Knee ${Math.round(rep.min_knee_angle)}°, lean ${Math.round(rep.max_torso_lean)}°</span>`;
  ui.log.prepend(item);
  setStatus(good ? `Rep ${rep.rep_number}: good rep.` : `Rep ${rep.rep_number}: ${checks.filter(([, ok]) => !ok).map(([n]) => n.toLowerCase()).join(" and ")} needs work.`, good ? "ok" : "fix");
}

function countFrame(now) {
  fpsFrames++;
  if (now - fpsSince >= 1000) {
    ui.fps.textContent = String(Math.round((fpsFrames * 1000) / (now - fpsSince)));
    fpsFrames = 0;
    fpsSince = now;
  }
}
