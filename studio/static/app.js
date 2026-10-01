// Estudio de personajes: interfaz.
import { Visor } from "./viewer.js";

const $ = (sel) => document.querySelector(sel);
const api = {
  async get(path) {
    const r = await fetch(path, { cache: "no-store" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
    return data;
  },
  async post(path, body, type) {
    const headers = { "X-Estudio": "1" };
    if (type) headers["Content-Type"] = type;
    const r = await fetch(path, { method: "POST", headers, body: body ?? "" });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(data.error || `Error ${r.status}`);
    return data;
  },
};

const state = {
  modelId: null,
  info: null,
  texIndex: null,
  baseImage: null,      // ImageData de la textura actual (sin ajustes)
  stamp: Date.now(),    // para no usar texturas viejas en caché
  aplicando: false,
};

let visor = null;
try {
  visor = new Visor($("#visor"));
} catch (e) {
  $("#visor-vacio").textContent = "Este navegador no pudo iniciar WebGL, así que no hay vista 3D. Igual podés editar las texturas.";
}

// ------------------------------------------------------------------ avisos
let toastTimer = null;
function toast(html, { error = false, ms = 6000 } = {}) {
  const el = $("#toast");
  el.innerHTML = html;
  el.classList.toggle("error", error);
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ------------------------------------------------------------------ estado
async function refreshStatus() {
  try {
    const st = await api.get("/api/status");
    $("#abrir-juego").href = st.urlJuego || "http://localhost:27016";
    const el = $("#estado");
    el.classList.remove("pendiente", "error");
    if (!st.baseLista) {
      el.textContent = "Faltan los archivos del juego: corré ./start.sh";
      el.classList.add("error");
      $("#aplicar").disabled = true;
      return st;
    }
    if (st.armando || state.aplicando) {
      el.textContent = "Aplicando cambios al juego…";
    } else if (st.pendiente) {
      el.textContent = "Hay cambios sin aplicar";
      el.classList.add("pendiente");
    } else {
      el.textContent = "El juego está al día";
    }
    $("#aplicar").disabled = !!(st.armando || state.aplicando);
    return st;
  } catch (e) {
    const el = $("#estado");
    el.textContent = "No hay conexión con el estudio";
    el.classList.add("error");
    return null;
  }
}

$("#aplicar").addEventListener("click", async () => {
  state.aplicando = true;
  $("#aplicar").disabled = true;
  $("#estado").textContent = "Aplicando cambios al juego…";
  try {
    const res = await api.post("/api/apply");
    const n = res.estado.cambios.length;
    const juego = escapeHtml($("#abrir-juego").href);
    toast(`Aplicado en ${res.estado.segundos} s (${n} modelo${n === 1 ? "" : "s"} con cambios). ` +
      `Recargá la pestaña del juego para verlo, o <a href="${juego}" target="_blank" rel="noopener">abrilo acá</a>.`, { ms: 9000 });
  } catch (e) {
    toast(escapeHtml(e.message), { error: true });
  } finally {
    state.aplicando = false;
    refreshStatus();
    loadModels(false);
  }
});

// ------------------------------------------------------------------ modelos
async function loadModels(selectFirst = true) {
  const data = await api.get("/api/models");
  const root = $("#categorias");
  const openState = {};
  root.querySelectorAll("details").forEach((d) => { openState[d.dataset.cat] = d.open; });
  root.innerHTML = "";
  let first = null;
  for (const cat of data.categorias) {
    if (!cat.modelos.length) continue;
    const isPlayers = cat.id === "personajes";
    const wrap = document.createElement(isPlayers ? "div" : "details");
    if (!isPlayers) {
      wrap.dataset.cat = cat.id;
      wrap.open = openState[cat.id] ?? false;
      const s = document.createElement("summary");
      s.textContent = `${cat.nombre} (${cat.modelos.length})`;
      wrap.appendChild(s);
    } else {
      const h = document.createElement("h2");
      h.textContent = cat.nombre;
      wrap.appendChild(h);
    }
    const ul = document.createElement("ul");
    for (const m of cat.modelos) {
      first ??= m.id;
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.id = m.id;
      if (m.id === state.modelId) b.setAttribute("aria-current", "true");
      const name = document.createElement("span");
      name.textContent = m.label;
      b.appendChild(name);
      const right = document.createElement("span");
      if (m.editado) {
        const mark = document.createElement("span");
        mark.className = "marca";
        mark.textContent = "editado ";
        right.appendChild(mark);
      }
      if (m.team) {
        const team = document.createElement("span");
        team.className = "equipo";
        team.textContent = m.team;
        right.appendChild(team);
      }
      b.appendChild(right);
      b.addEventListener("click", () => selectModel(m.id));
      li.appendChild(b);
      ul.appendChild(li);
    }
    wrap.appendChild(ul);
    root.appendChild(wrap);
  }
  if (!first) {
    root.innerHTML = '<p class="muted" style="padding:12px">No encontré modelos. ¿Corriste ./start.sh?</p>';
  }
  if (selectFirst && first && !state.modelId) {
    const fromHash = decodeURIComponent(location.hash.slice(1));
    selectModel(data.categorias.some((c) => c.modelos.some((m) => m.id === fromHash)) ? fromHash : first);
  }
}

function markCurrent() {
  document.querySelectorAll("#categorias button").forEach((b) => {
    if (b.dataset.id === state.modelId) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  });
}

const texUrl = (i, v = "game") =>
  `/api/texture.png?id=${encodeURIComponent(state.modelId)}&i=${i}&v=${v}&t=${state.stamp}`;

async function selectModel(id, { keepTexture = false, keepCamera = false } = {}) {
  const changed = id !== state.modelId;
  state.modelId = id;
  history.replaceState(null, "", "#" + encodeURIComponent(id));
  markCurrent();
  try {
    const info = await api.get(`/api/model?id=${encodeURIComponent(id)}`);
    if (state.modelId !== id) return;
    state.info = info;
    $("#modelo-nombre").textContent = info.team ? `${info.label} (${info.team})` : info.label;
    $("#modelo-ruta").textContent = info.path;
    $("#carpeta").textContent = info.exported ? `Texturas editables en ${info.folder}/` : "";
    $("#exportar").disabled = false;
    $("#restaurar-modelo").disabled = !info.textures.some((t) => t.edited);
    const pose = $("#pose");
    pose.innerHTML = "";
    for (const s of info.sequences) {
      const o = document.createElement("option");
      o.value = s.index;
      o.textContent = s.label;
      pose.appendChild(o);
    }
    pose.disabled = !info.sequences.length;
    if (changed || !keepCamera) {
      if (info.defaultSequence !== null) pose.value = info.defaultSequence;
    } else if (state.pose != null) {
      pose.value = state.pose;
    }
    state.pose = pose.value === "" ? null : Number(pose.value);
    renderTextures(keepTexture && !changed ? state.texIndex : null);
    await loadMesh(changed ? false : keepCamera);
  } catch (e) {
    toast(escapeHtml(e.message), { error: true });
  }
}

async function loadMesh(keepCamera) {
  if (!visor || !state.modelId) return;
  $("#visor-vacio").hidden = true;
  const seq = state.pose == null ? "" : `&seq=${state.pose}`;
  try {
    const mesh = await api.get(`/api/mesh?id=${encodeURIComponent(state.modelId)}${seq}`);
    await visor.load(mesh, (i) => texUrl(i), keepCamera);
  } catch (e) {
    $("#visor-vacio").hidden = false;
    $("#visor-vacio").textContent = `No pude mostrar este modelo en 3D: ${e.message}`;
  }
}

$("#pose").addEventListener("change", (e) => {
  state.pose = Number(e.target.value);
  loadMesh(true);
});
$("#girar").addEventListener("change", (e) => visor?.setAutoRotate(e.target.checked));
$("#fondo-gris").addEventListener("change", (e) => $("#visor").classList.toggle("gris", e.target.checked));

$("#exportar").addEventListener("click", async () => {
  try {
    const res = await api.post(`/api/export?id=${encodeURIComponent(state.modelId)}`);
    $("#carpeta").textContent = `Texturas editables en ${res.carpeta}/`;
    toast(`Copié las texturas a <b>${escapeHtml(res.carpeta)}</b> dentro de la carpeta del proyecto. ` +
      "Editalas con tu programa, guardalas con el mismo nombre y tocá «Aplicar al juego».", { ms: 10000 });
  } catch (e) {
    toast(escapeHtml(e.message), { error: true });
  }
});

$("#restaurar-modelo").addEventListener("click", async () => {
  if (!confirm("¿Volver todas las texturas de este modelo a las originales? Se borran tus PNG editados de este modelo.")) return;
  try {
    await api.post(`/api/reset?id=${encodeURIComponent(state.modelId)}`);
    state.stamp = Date.now();
    await selectModel(state.modelId, { keepCamera: true });
    refreshStatus();
    loadModels(false);
    toast("Modelo restaurado. Tocá «Aplicar al juego» para que el juego también vuelva al original.");
  } catch (e) {
    toast(escapeHtml(e.message), { error: true });
  }
});

// ----------------------------------------------------------------- texturas
function renderTextures(keepIndex) {
  const ul = $("#lista-texturas");
  ul.innerHTML = "";
  for (const t of state.info.textures) {
    const li = document.createElement("li");
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.index = t.index;
    b.title = `${t.name} (${t.width}×${t.height})`;
    const img = document.createElement("img");
    img.alt = "";
    img.loading = "lazy";
    img.src = texUrl(t.index);
    const name = document.createElement("span");
    name.className = "nombre";
    name.innerHTML = (t.edited ? '<span class="marca">● </span>' : "") + escapeHtml(t.file.replace(/\.png$/, ""));
    b.append(img, name);
    b.addEventListener("click", () => selectTexture(t.index));
    li.appendChild(b);
    ul.appendChild(li);
  }
  const keep = keepIndex != null && state.info.textures[keepIndex];
  if (keep) selectTexture(keepIndex);
  else {
    state.texIndex = null;
    $("#editor").hidden = true;
  }
}

const sliders = { tono: $("#s-tono"), sat: $("#s-sat"), brillo: $("#s-brillo") };
function resetSliders() {
  sliders.tono.value = 0;
  sliders.sat.value = 100;
  sliders.brillo.value = 100;
  updateOutputs();
}
function updateOutputs() {
  $("#o-tono").textContent = `${sliders.tono.value}°`;
  $("#o-sat").textContent = `${sliders.sat.value}%`;
  $("#o-brillo").textContent = `${sliders.brillo.value}%`;
  const dirty = Number(sliders.tono.value) !== 0 || Number(sliders.sat.value) !== 100 || Number(sliders.brillo.value) !== 100;
  $("#guardar-ajuste").disabled = !dirty;
  $("#deshacer-ajuste").disabled = !dirty;
}

async function selectTexture(index) {
  state.texIndex = index;
  const t = state.info.textures[index];
  document.querySelectorAll("#lista-texturas button").forEach((b) => {
    if (Number(b.dataset.index) === index) b.setAttribute("aria-current", "true");
    else b.removeAttribute("aria-current");
  });
  $("#editor").hidden = false;
  $("#tex-nombre").textContent = t.file;
  $("#tex-info").textContent = `${t.width}×${t.height} px` + (t.masked ? " · con transparencia" : "") +
    (t.edited ? " · editada" : " · original");
  $("#restaurar-tex").disabled = !t.edited;
  $("#descargar").href = texUrl(index, "current");
  $("#descargar").setAttribute("download", t.file);
  resetSliders();
  // Base para los ajustes: la textura como quedaría en el juego.
  const img = new Image();
  img.src = texUrl(index);
  await img.decode().catch(() => null);
  if (state.texIndex !== index) return;
  const canvas = $("#tex-canvas");
  canvas.width = img.naturalWidth || t.width;
  canvas.height = img.naturalHeight || t.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  state.baseImage = ctx.getImageData(0, 0, canvas.width, canvas.height);
}

// Ajuste de tono/saturación/brillo en HSV, igual para la vista previa y lo que se guarda.
function adjust(src, hueDeg, sat, bright) {
  const out = new ImageData(src.width, src.height);
  const s = src.data, d = out.data;
  const shift = hueDeg / 360;
  for (let i = 0; i < s.length; i += 4) {
    let r = s[i] / 255, g = s[i + 1] / 255, b = s[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), delta = max - min;
    let h = 0;
    if (delta) {
      if (max === r) h = ((g - b) / delta) % 6;
      else if (max === g) h = (b - r) / delta + 2;
      else h = (r - g) / delta + 4;
      h /= 6;
      if (h < 0) h += 1;
    }
    let sv = max ? delta / max : 0;
    let v = max;
    h = (h + shift + 1) % 1;
    sv = Math.min(1, sv * sat);
    v = Math.min(1, v * bright);
    const k = (n) => (n + h * 6) % 6;
    const f = (n) => v - v * sv * Math.max(0, Math.min(k(n), 4 - k(n), 1));
    d[i] = Math.round(f(5) * 255);
    d[i + 1] = Math.round(f(3) * 255);
    d[i + 2] = Math.round(f(1) * 255);
    d[i + 3] = s[i + 3];
  }
  return out;
}

let previewQueued = false;
function previewAdjust() {
  updateOutputs();
  if (!state.baseImage || previewQueued) return;
  previewQueued = true;
  requestAnimationFrame(() => {
    previewQueued = false;
    const canvas = $("#tex-canvas");
    const img = adjust(state.baseImage, Number(sliders.tono.value), sliders.sat.value / 100, sliders.brillo.value / 100);
    canvas.getContext("2d").putImageData(img, 0, 0);
    visor?.setTextureCanvas(state.texIndex, canvas);
  });
}
Object.values(sliders).forEach((s) => s.addEventListener("input", previewAdjust));

$("#deshacer-ajuste").addEventListener("click", () => {
  resetSliders();
  if (!state.baseImage) return;
  $("#tex-canvas").getContext("2d").putImageData(state.baseImage, 0, 0);
  visor?.reloadTexture(state.texIndex, texUrl(state.texIndex));
});

async function uploadBlob(blob, okMessage) {
  const index = state.texIndex;
  const res = await api.post(`/api/upload?id=${encodeURIComponent(state.modelId)}&i=${index}`, blob, blob.type || "image/png");
  state.stamp = Date.now();
  await selectModel(state.modelId, { keepTexture: true, keepCamera: true });
  refreshStatus();
  loadModels(false);
  let msg = okMessage;
  if (res.resized) msg += ` La imagen no tenía el tamaño original, así que la ajusté a ${res.size[0]}×${res.size[1]} px.`;
  toast(msg + " Tocá «Aplicar al juego» cuando quieras probarlo.");
}

$("#guardar-ajuste").addEventListener("click", async () => {
  $("#guardar-ajuste").disabled = true;
  try {
    const blob = await new Promise((resolve) => $("#tex-canvas").toBlob(resolve, "image/png"));
    await uploadBlob(blob, "Ajuste guardado.");
  } catch (e) {
    toast(escapeHtml(e.message), { error: true });
    updateOutputs();
  }
});

$("#subir").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  e.target.value = "";
  if (!file) return;
  try {
    await uploadBlob(file, `Subí ${escapeHtml(file.name)}.`);
  } catch (err) {
    toast(escapeHtml(err.message), { error: true });
  }
});

const drop = $("#drop");
["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => {
  e.preventDefault();
  drop.classList.add("arrastrando");
}));
["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("arrastrando")));
drop.addEventListener("drop", async (e) => {
  e.preventDefault();
  const file = e.dataTransfer?.files?.[0];
  if (!file || state.texIndex == null) return;
  try {
    await uploadBlob(file, `Subí ${escapeHtml(file.name)}.`);
  } catch (err) {
    toast(escapeHtml(err.message), { error: true });
  }
});

$("#restaurar-tex").addEventListener("click", async () => {
  try {
    await api.post(`/api/reset?id=${encodeURIComponent(state.modelId)}&i=${state.texIndex}`);
    state.stamp = Date.now();
    await selectModel(state.modelId, { keepTexture: true, keepCamera: true });
    refreshStatus();
    loadModels(false);
    toast("Textura restaurada. Tocá «Aplicar al juego» para que el juego también vuelva al original.");
  } catch (e) {
    toast(escapeHtml(e.message), { error: true });
  }
});

// Al volver de editar un PNG en otro programa, refrescar lo que se ve.
window.addEventListener("focus", async () => {
  const before = JSON.stringify(state.info?.textures?.map((t) => t.edited) ?? []);
  const st = await refreshStatus();
  if (!st || !state.modelId) return;
  state.stamp = Date.now();
  const info = await api.get(`/api/model?id=${encodeURIComponent(state.modelId)}`).catch(() => null);
  if (!info) return;
  const after = JSON.stringify(info.textures.map((t) => t.edited));
  if (before !== after || info.textures.some((t) => t.edited)) {
    await selectModel(state.modelId, { keepTexture: true, keepCamera: true });
    loadModels(false);
  }
});

refreshStatus();
loadModels(true).catch((e) => toast(escapeHtml(e.message), { error: true }));
setInterval(refreshStatus, 5000);
