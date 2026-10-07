import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export type Gltf = { scene: THREE.Group; animations: THREE.AnimationClip[] };

const loader = new GLTFLoader();
const cache = new Map<string, Promise<Gltf>>();

/**
 * Loads public/models/<file>.glb once. Single-file builds (the web demo) can embed models as base64
 * in window.__DOMINO_MODELS instead of shipping .glb files.
 */
export function loadGlb(file: string): Promise<Gltf> {
  let pending = cache.get(file);
  if (!pending) {
    const embedded = (globalThis as { __DOMINO_MODELS?: Record<string, string> }).__DOMINO_MODELS?.[file];
    pending = (embedded
      ? loader.parseAsync(Uint8Array.from(atob(embedded), (c) => c.charCodeAt(0)).buffer, './models/')
      : loader.loadAsync(`./models/${file}.glb`)) as Promise<Gltf>;
    cache.set(file, pending);
  }
  return pending;
}
