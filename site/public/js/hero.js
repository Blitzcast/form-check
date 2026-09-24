// Landing-page figure: a side-view squat drawn with the same angle math the checker uses.
import { angleAt } from "./form.js";

const svg = document.getElementById("figure");
if (svg) {
  const el = (id) => svg.querySelector(`#${id}`);
  const parts = {
    shin: el("fig-shin"),
    thigh: el("fig-thigh"),
    torso: el("fig-torso"),
    foot: el("fig-foot"),
    head: el("fig-head"),
    arc: el("fig-arc"),
    level: el("fig-level"),
    joints: [...svg.querySelectorAll(".fig-joint")],
  };
  const kneeOut = document.getElementById("fig-knee");
  const depthOut = document.getElementById("fig-depth");
  const rad = (d) => (d * Math.PI) / 180;
  const ANKLE = { x: 190, y: 360 };

  function frame(t) {
    const shinTilt = 32 * t;
    const thigh = 102 * t; // degrees back from vertical; past 90 the hip is below the knee
    const lean = 8 + 30 * t;
    const knee = { x: ANKLE.x + 118 * Math.sin(rad(shinTilt)), y: ANKLE.y - 118 * Math.cos(rad(shinTilt)) };
    const hip = { x: knee.x - 118 * Math.sin(rad(thigh)), y: knee.y - 118 * Math.cos(rad(thigh)) };
    const shoulder = { x: hip.x + 135 * Math.sin(rad(lean)), y: hip.y - 135 * Math.cos(rad(lean)) };
    const head = { x: shoulder.x + 30 * Math.sin(rad(lean)), y: shoulder.y - 30 * Math.cos(rad(lean)) };

    line(parts.shin, ANKLE, knee);
    line(parts.thigh, knee, hip);
    line(parts.torso, hip, shoulder);
    line(parts.foot, { x: ANKLE.x - 22, y: ANKLE.y + 6 }, { x: ANKLE.x + 48, y: ANKLE.y + 6 });
    parts.head.setAttribute("cx", head.x.toFixed(1));
    parts.head.setAttribute("cy", head.y.toFixed(1));
    [ANKLE, knee, hip, shoulder].forEach((p, i) => {
      parts.joints[i].setAttribute("cx", p.x.toFixed(1));
      parts.joints[i].setAttribute("cy", p.y.toFixed(1));
    });

    // Knee-angle arc, from the shin direction to the thigh direction.
    const r = 34;
    const a0 = Math.atan2(ANKLE.y - knee.y, ANKLE.x - knee.x);
    const a1 = Math.atan2(hip.y - knee.y, hip.x - knee.x);
    const start = { x: knee.x + r * Math.cos(a0), y: knee.y + r * Math.sin(a0) };
    const end = { x: knee.x + r * Math.cos(a1), y: knee.y + r * Math.sin(a1) };
    const angle = angleAt(hip, knee, ANKLE);
    parts.arc.setAttribute("d", `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} A ${r} ${r} 0 0 1 ${end.x.toFixed(1)} ${end.y.toFixed(1)}`);

    // Knee-height guide: turns "good" once the hip reaches it.
    const deep = hip.y >= knee.y;
    parts.level.setAttribute("x1", (knee.x - 150).toFixed(1));
    parts.level.setAttribute("x2", (knee.x + 20).toFixed(1));
    parts.level.setAttribute("y1", knee.y.toFixed(1));
    parts.level.setAttribute("y2", knee.y.toFixed(1));
    svg.classList.toggle("deep", deep);

    kneeOut.textContent = `${Math.round(angle)}°`;
    depthOut.textContent = deep ? "Hip below knee" : "Above knee";
  }

  function line(node, a, b) {
    node.setAttribute("x1", a.x.toFixed(1));
    node.setAttribute("y1", a.y.toFixed(1));
    node.setAttribute("x2", b.x.toFixed(1));
    node.setAttribute("y2", b.y.toFixed(1));
  }

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const PERIOD = 2800;
  function loop(now) {
    if (reduced.matches) {
      frame(1);
      return;
    }
    frame((1 - Math.cos((2 * Math.PI * now) / PERIOD)) / 2);
    requestAnimationFrame(loop);
  }
  reduced.addEventListener("change", () => requestAnimationFrame(loop));
  requestAnimationFrame(loop);
}
