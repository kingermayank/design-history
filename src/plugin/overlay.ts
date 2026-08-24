/**
 * Standalone overlay entry — bundled to an IIFE and served at
 * /__design-history/overlay.js. Loaded by the Vite plugin's HTML injection and
 * by the plain <script> setup for non-Vite frameworks. Auto-mounts on load.
 */
import { mountOverlay } from './overlay-core.js';

mountOverlay();
