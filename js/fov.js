// Field of view like in Minecraft: one slider in degrees (vertical angle). 62° is the old "normal" view,
// 110° a very wide "Quake pro" look, 30° zoomed in. Older settings stored a lens in mm; it is converted once.
export const FOV_MIN = 30, FOV_MAX = 130, FOV_DEFAULT = 80; /* Freddy 11.11.: wider by default (was 62°) */
export function fovOf(s) {
  if (s.fov) return s.fov;
  if (!s.lensMm) return FOV_DEFAULT;
  const h = 2 * Math.atan(36 / (2 * s.lensMm)); // horizontal angle of a 36 mm wide sensor, on a 16:9 screen
  return Math.round(Math.max(FOV_MIN, Math.min(FOV_MAX, 2 * Math.atan(Math.tan(h / 2) * 9 / 16) * 180 / Math.PI)));
}
