/**
 * Liquid glass, as one fragment pass.
 *
 * Adapted from Liquid Glass Studio by Charles Yin (MIT License,
 * https://github.com/iyinchao/liquid-glass-studio, Copyright (c) 2024
 * Charles Yin): the refraction edge from Snell's law over a rounded-rect SDF,
 * per-channel dispersion, a Fresnel rim and an angular glare. The studio runs
 * this as a multi-pass pipeline over a full-screen canvas; here the canvas is
 * only the size of the control, so the blur is taken in the same pass and the
 * whole thing costs a few thousand pixels.
 *
 * Coordinates are CSS px with the origin at the glass's top left.
 */

export const VERTEX = `#version 300 es
in vec2 a_position;
void main() { gl_Position = vec4(a_position, 0.0, 1.0); }
`;

export const FRAGMENT = `#version 300 es
precision highp float;

uniform sampler2D u_bg;     // the backdrop: glass + margin, top row first
uniform vec2 u_size;        // the glass, CSS px
uniform float u_margin;     // backdrop margin, CSS px
uniform float u_dpr;
uniform vec2 u_light;       // unit vector the glare comes from
uniform vec4 u_tint;        // rgb, strength
uniform float u_thickness;  // refraction band, CSS px
uniform float u_bend;       // refraction distance, CSS px

out vec4 fragColor;

float sdStadium(vec2 p, vec2 half_) {
  float r = min(half_.x, half_.y);
  vec2 d = abs(p) - half_ + vec2(r);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - r;
}

float sd(vec2 p) { return sdStadium(p - u_size * 0.5, u_size * 0.5); }

vec2 bgSize() { return u_size + vec2(u_margin * 2.0); }

vec3 bg(vec2 p) {
  return texture(u_bg, clamp((p + vec2(u_margin)) / bgSize(), 0.0, 1.0)).rgb;
}

// A soft 9-tap blur — frosted, not smeared.
vec3 frost(vec2 p, float r) {
  vec3 c = bg(p) * 0.2;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    c += bg(p + vec2(cos(a), sin(a)) * r) * 0.1;
  }
  return c;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, u_size.y * u_dpr - gl_FragCoord.y) / u_dpr;
  float d = sd(p);
  float alpha = 1.0 - smoothstep(-0.75, 0.75, d);
  if (alpha <= 0.0) { fragColor = vec4(0.0); return; }

  float depth = max(-d, 0.0);
  float e = 0.5;
  vec2 n = normalize(vec2(sd(p + vec2(e, 0.0)) - sd(p - vec2(e, 0.0)),
                          sd(p + vec2(0.0, e)) - sd(p - vec2(0.0, e))) + 1e-6);

  // Snell at the rim: the thinner the glass under this pixel, the harder it bends.
  float edge = 0.0;
  if (depth < u_thickness) {
    float x = 1.0 - depth / u_thickness;
    float ti = asin(clamp(x * x, -1.0, 1.0));
    float tt = asin(clamp(sin(ti) / 1.5, -1.0, 1.0));
    edge = -tan(tt - ti);
  }
  vec2 off = -n * edge * u_bend;

  // Dispersion: red bends a little less than blue.
  float blur = mix(3.5, 6.0, clamp(depth / u_thickness, 0.0, 1.0));
  vec3 col = vec3(
    frost(p + off * 0.985, blur).r,
    frost(p + off, blur).g,
    frost(p + off * 1.015, blur).b
  );

  // Smoked glass: the slide stays readable through it, the label stays readable on it.
  col = mix(col, u_tint.rgb, u_tint.a);

  // Fresnel rim.
  float fres = pow(clamp(1.0 - depth / (u_thickness * 0.9), 0.0, 1.0), 3.0);
  col = mix(col, vec3(1.0), fres * 0.07);

  // Glare, from the light's side and faintly from the opposite one.
  float g = dot(n, u_light);
  float glare = pow(max(g, 0.0), 3.0) + 0.25 * pow(max(-g, 0.0), 4.0);
  float band = pow(clamp(1.0 - depth / (u_thickness * 0.5), 0.0, 1.0), 3.0);
  col += vec3(glare * band * 0.22);

  fragColor = vec4(clamp(col, 0.0, 1.0) * alpha, alpha);
}
`;
