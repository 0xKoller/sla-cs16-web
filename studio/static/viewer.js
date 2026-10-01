// Visor 3D de modelos GoldSrc (geometría armada por el estudio en /api/mesh).
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

export class Visor {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.5, 5000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 1.6;

    this.scene.add(new THREE.HemisphereLight(0xf1f4ec, 0x4a4436, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(60, 120, 140);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xffffff, 0.5);
    rim.position.set(-80, 40, -120);
    this.scene.add(rim);

    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.materials = new Map();   // índice de textura -> material
    this.loadToken = 0;
    this.reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (this.reducedMotion) this.controls.autoRotate = false;

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    this.renderer.setAnimationLoop(() => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    });
  }

  resize() {
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  setAutoRotate(on) {
    this.controls.autoRotate = on && !this.reducedMotion;
  }

  clear() {
    for (const child of [...this.group.children]) {
      child.geometry?.dispose();
      this.group.remove(child);
    }
    for (const mat of this.materials.values()) {
      mat.map?.dispose();
      mat.dispose();
    }
    this.materials.clear();
  }

  // mesh: respuesta de /api/mesh; textureUrl(i) devuelve la URL de la textura i
  async load(mesh, textureUrl, keepCamera = false) {
    const token = ++this.loadToken;
    const loader = new THREE.TextureLoader();
    const textures = await Promise.all(mesh.textures.map((t) => new Promise((resolve) => {
      loader.load(textureUrl(t.index), (tex) => resolve(tex), undefined, () => resolve(null));
    })));
    if (token !== this.loadToken) {
      textures.forEach((t) => t?.dispose());
      return;
    }
    this.clear();
    mesh.textures.forEach((info, i) => {
      const mat = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
      if (info.masked) mat.alphaTest = 0.5;
      if (info.additive) {
        mat.transparent = true;
        mat.blending = THREE.AdditiveBlending;
        mat.depthWrite = false;
      }
      this.materials.set(info.index, mat);
      this._setMap(info.index, textures[i]);
    });
    for (const g of mesh.groups) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(g.positions, 3));
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(g.normals, 3));
      geo.setAttribute("uv", new THREE.Float32BufferAttribute(g.uvs, 2));
      geo.setIndex(g.indices);
      const mat = this.materials.get(g.texture) || new THREE.MeshLambertMaterial({ color: 0x999999 });
      this.group.add(new THREE.Mesh(geo, mat));
    }
    if (!keepCamera) this.frame(mesh.bounds);
  }

  _setMap(index, tex) {
    const mat = this.materials.get(index);
    if (!mat) return;
    if (mat.map && mat.map !== tex) mat.map.dispose();
    if (tex) {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false;            // en GoldSrc la fila 0 es la de arriba
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.needsUpdate = true;
    }
    mat.map = tex;
    mat.color.set(tex ? 0xffffff : 0x888888);
    mat.needsUpdate = true;
  }

  // Vista previa en vivo desde un canvas (ajustes de tono/brillo sin guardar).
  setTextureCanvas(index, canvas) {
    const mat = this.materials.get(index);
    if (!mat) return;
    if (mat.map && mat.map.isCanvasTexture && mat.map.image === canvas) {
      mat.map.needsUpdate = true;
      return;
    }
    this._setMap(index, new THREE.CanvasTexture(canvas));
  }

  reloadTexture(index, url) {
    new THREE.TextureLoader().load(url, (tex) => this._setMap(index, tex));
  }

  frame(bounds) {
    const [lo, hi] = bounds;
    const center = new THREE.Vector3((lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2);
    const size = Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2], 1);
    const dist = size / (2 * Math.tan((this.camera.fov * Math.PI) / 360)) * 1.25;
    this.camera.near = Math.max(dist / 100, 0.1);
    this.camera.far = dist * 20;
    this.camera.position.set(center.x + dist * 0.35, center.y + size * 0.12, center.z + dist);
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.minDistance = size * 0.2;
    this.controls.maxDistance = dist * 4;
    this.controls.update();
  }
}
