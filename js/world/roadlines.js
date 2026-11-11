// Road markings drawn analytically in the road shader instead of from the asphalt texture: always the same
// dash and gap along the whole route, sharp up close and without shimmer in the distance (each line is
// box-filtered over the pixel footprint, so far away it fades to its true average instead of flickering).
// Road uv: x 0..1 across the asphalt (2 * ROAD_W = 6.6 m), y = metres along the centreline / 40.
// Layout like a Norwegian country road, but white: edge lines 12 cm, 2.86 m from the centre, continuous;
// centre line 10 cm, 3 m dash, 9 m gap.
export const ROAD_LINES_GLSL = /* glsl */`
float rlBand(float x, float a, float b, float w) { // share of the pixel [x-w/2, x+w/2] inside [a, b]
  return clamp((min(x + w * .5, b) - max(x - w * .5, a)) / w, 0., 1.);
}
float rlDashInt(float y) { return floor(y / 12.) * 3. + min(mod(y, 12.), 3.); } // painted metres up to y
float roadPaint(vec2 uv, float blurM) {
  float X = (uv.x - .5) * 6.6, Y = uv.y * 40.;
  float wx = max(fwidth(X), 1e-4), wy = max(fwidth(Y) + blurM, 1e-3);
  float edge = rlBand(abs(X), 2.80, 2.92, wx);
  float y = mod(Y, 12.); // small numbers: the difference below stays exact even 40 km into the route
  float dash = (rlDashInt(y + wy * .5) - rlDashInt(y - wy * .5)) / wy;
  float centre = rlBand(X, -.05, .05, wx) * clamp(dash, 0., 1.) * .9;
  return max(edge, centre);
}
`;
