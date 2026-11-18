// lib/ring-builder/viewer/shaders.ts — fragment shader ของ viewer (D1.1 §9.4 "เงินขัดเงา") · pure string builder ไม่แตะ GL
// ขอบเขต: แก้ได้เฉพาะ FS_METAL / FS_GEM (+ ค่าแสง) — ห้ามแตะ bypass-ring.ts · matrix.ts · กล้อง · ไม่มี texture/FBO/extension/loop
// V1 = shader ของ D1 คำต่อคำ (ไม่เปลี่ยน) เก็บไว้เป็น fallback: ถ้า V2 compile/link ไม่ผ่าน gl-renderer ถอยมาใช้ V1 ก่อนตกรูปจริง
// 🔴 ค่าสี/แสงทั้งหมดอยู่ที่ SILVER_LOOK ที่เดียว (TL เปิดเทียบรูปจริง bypass2-1.jpg แล้วขอปรับเฉพาะตรงนี้)

/** ค่าสีเงิน/แสง — ปรับที่นี่ที่เดียว (ทุกตัวเป็นค่า linear 0..1 ยกเว้นระบุ) */
export const SILVER_LOOK = {
  /** F0 ของเงิน (สะท้อนตรงหน้า) — เกือบขาว อมเหลืองนิดเดียว · |R−B| ของผลลัพธ์ต้อง ≤ 0.04 */
  silverF0: [0.97, 0.96, 0.92] as readonly [number, number, number],
  /** แสงรวมก่อน tone map */
  exposure: 0.92,
  /** env แบบเต็นท์ถ่ายรูป (สูตรล้วน): พื้นล่าง / ฟ้าบน */
  envFloor: 0.34,
  envTop: 1.0,
  /** ความสว่างของ softbox 2 ดวง (key บนขวา · fill ซ้าย) */
  softboxKey: 2.6,
  softboxFill: 1.6,
  /** เส้นมืดแคบที่ขอบฟ้า: ความลึก (0..1) และความชัน (ยิ่งมากยิ่งแคบ) — ไม่มีเส้นมืด = พลาสติกขาว */
  horizonDepth: 0.85,
  horizonSharpness: 9.0,
  /** การ์ดมืด 1 แถบ (ให้ขอบเรือนมีเส้นมืดบางเหมือนรูปจริง) */
  cardDepth: 0.7,
  /** พลอยสี: F0 ของผิวพลอย · CZ: F0 และ IOR แยก RGB (ประกายรุ้งเล็กน้อย) */
  gemF0: 0.08,
  czF0: 0.13,
  gemIor: 1.6,
  czIor: [1.56, 1.6, 1.66] as readonly [number, number, number],
  /** ความสว่างของลำแสงที่ลอดผ่านพลอย (คูณกับ env ตามทิศ refract) */
  gemTransmit: 0.55,
  /** ประกายคม 3 lobe ของ D1 — คูณเพิ่ม */
  gemSparkle: 1.0,
} as const;

export type SilverLook = { readonly [K in keyof typeof SILVER_LOOK]: (typeof SILVER_LOOK)[K] extends number ? number : (typeof SILVER_LOOK)[K] };

// ---------- V1 (D1 เดิม · คำต่อคำ) ----------
export const VS = [
  "attribute vec3 aPos;attribute vec3 aNormal;uniform mat4 uMVP;uniform mat4 uModel;",
  "varying vec3 vN;varying vec3 vW;",
  "void main(){vN=(uModel*vec4(aNormal,0.0)).xyz;vW=(uModel*vec4(aPos,1.0)).xyz;gl_Position=uMVP*vec4(aPos,1.0);}",
].join("\n");
export const PREC = "#ifdef GL_FRAGMENT_PRECISION_HIGH\nprecision highp float;\n#else\nprecision mediump float;\n#endif\n";
export const FS_METAL_V1 =
  PREC +
  [
    "varying vec3 vN;varying vec3 vW;uniform vec3 uCam;uniform vec3 uColor;",
    "vec3 env(vec3 R){",
    "  float sky=smoothstep(-0.6,0.8,R.y);",
    "  vec3 c=mix(vec3(0.16,0.17,0.19),vec3(0.98,0.98,1.0),sky);",
    "  c+=vec3(1.0)*pow(max(dot(R,normalize(vec3(0.35,0.75,0.55))),0.0),24.0)*0.8;",
    "  c+=vec3(0.9,0.92,1.0)*pow(max(dot(R,normalize(vec3(-0.8,0.2,0.4))),0.0),16.0)*0.5;",
    "  float b=(R.y+0.05)*5.0;",
    "  c*=1.0-0.55*exp(-b*b);",
    "  return c;",
    "}",
    "void main(){",
    "  vec3 N=normalize(vN);vec3 V=normalize(uCam-vW);",
    "  if(dot(N,V)<0.0)N=-N;",
    "  vec3 R=reflect(-V,N);",
    "  float ndv=max(dot(N,V),0.0);",
    "  vec3 col=uColor*(0.10+0.90*env(R))+pow(1.0-ndv,4.0)*0.06;",
    "  gl_FragColor=vec4(col,1.0);",
    "}",
  ].join("\n");
export const FS_GEM_V1 =
  PREC +
  [
    "varying vec3 vN;varying vec3 vW;uniform vec3 uCam;uniform vec3 uTint;uniform vec3 uSpark;uniform vec3 uCap;uniform float uGlow;",
    "void main(){",
    "  vec3 N=normalize(vN);vec3 V=normalize(uCam-vW);",
    "  if(dot(N,V)<0.0)N=-N;",
    "  vec3 R=reflect(-V,N);",
    "  float dif=0.5+0.5*dot(N,normalize(vec3(0.25,0.55,0.8)));",
    "  float h=fract(sin(dot(N.xy+N.z,vec2(12.9898,78.233)))*43758.5453);",
    "  float k=(0.30+0.70*dif)*(0.85+0.30*h);",
    "  float sp=pow(max(dot(R,normalize(vec3(0.4,0.8,0.6))),0.0),8.0)*0.9",
    "          +pow(max(dot(R,normalize(vec3(-0.7,0.3,0.55))),0.0),10.0)*0.7",
    "          +pow(max(dot(R,normalize(vec3(0.0,-0.6,0.8))),0.0),6.0)*0.5;",
    "  vec3 col=uTint*k+uSpark*sp+vec3(uGlow);",
    "  gl_FragColor=vec4(min(col,uCap),1.0);",
    "}",
  ].join("\n");

// ---------- V2 (เงินขัดเงา) ----------
/** เลข → literal float ของ GLSL ES 1.00 (ต้องมีจุดทศนิยมเสมอ · NaN/Infinity = throw กัน shader พังเงียบ) */
export function glf(n: number): string {
  if (!Number.isFinite(n)) throw new Error(`shaders: ค่าไม่ใช่จำนวนจำกัด (${n})`);
  return Number.isInteger(n) ? n.toFixed(1) : String(n);
}
function glv3(v: readonly [number, number, number]): string {
  return `vec3(${glf(v[0])},${glf(v[1])},${glf(v[2])})`;
}

/** env แบบเต็นท์ถ่ายรูป — ใช้ร่วมกันทั้งโลหะและพลอย (สูตรล้วน ไม่มี texture) */
function envGlsl(l: SilverLook): string {
  return [
    "vec3 env(vec3 R){",
    "  float up=smoothstep(-0.25,0.6,R.y);",
    `  vec3 c=mix(vec3(${glf(l.envFloor)}),vec3(${glf(l.envTop)}),up);`,
    // softbox กว้าง 2 ดวง (ขอบนุ่มด้วย smoothstep บน dot)
    `  c+=vec3(1.0,1.0,1.0)*${glf(l.softboxKey)}*smoothstep(0.8,0.95,dot(R,normalize(vec3(0.35,0.75,0.55))));`,
    `  c+=vec3(0.95,0.97,1.0)*${glf(l.softboxFill)}*smoothstep(0.7,0.92,dot(R,normalize(vec3(-0.8,0.25,0.45))));`,
    // เส้นมืดแคบที่ขอบฟ้า + การ์ดมืด 1 แถบ
    `  float b=(R.y+0.05)*${glf(l.horizonSharpness)};`,
    `  c*=1.0-${glf(l.horizonDepth)}*exp(-b*b);`,
    `  c*=1.0-${glf(l.cardDepth)}*smoothstep(0.9,0.97,dot(R,normalize(vec3(0.5,0.1,0.85))));`,
    "  return c;",
    "}",
  ].join("\n");
}

/** ACES (Narkowicz) ย่อ 1 บรรทัด + gamma 1/2.2 — ใช้ทั้งโลหะและพลอย */
const TONEMAP_GLSL = [
  "vec3 tonemap(vec3 x){",
  "  x=(x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14);",
  "  return pow(clamp(x,0.0,1.0),vec3(0.45454545));",
  "}",
].join("\n");

export function buildFsMetalV2(l: SilverLook = SILVER_LOOK): string {
  return (
    PREC +
    [
      "varying vec3 vN;varying vec3 vW;uniform vec3 uCam;",
      envGlsl(l),
      TONEMAP_GLSL,
      "void main(){",
      "  vec3 N=normalize(vN);vec3 V=normalize(uCam-vW);",
      "  if(dot(N,V)<0.0)N=-N;",
      "  vec3 R=reflect(-V,N);",
      "  float ndv=max(dot(N,V),0.0);",
      `  vec3 F0=${glv3(l.silverF0)};`,
      "  vec3 F=F0+(vec3(1.0)-F0)*pow(1.0-ndv,5.0);",
      `  vec3 col=F*env(R)*${glf(l.exposure)};`,
      "  gl_FragColor=vec4(tonemap(col),1.0);",
      "}",
    ].join("\n")
  );
}

export function buildFsGemV2(l: SilverLook = SILVER_LOOK): string {
  return (
    PREC +
    [
      "varying vec3 vN;varying vec3 vW;uniform vec3 uCam;uniform vec3 uTint;uniform vec3 uSpark;uniform vec3 uCap;uniform float uGlow;uniform float uCz;",
      envGlsl(l),
      TONEMAP_GLSL,
      "void main(){",
      "  vec3 N=normalize(vN);vec3 V=normalize(uCam-vW);",
      "  if(dot(N,V)<0.0)N=-N;",
      "  vec3 R=reflect(-V,N);",
      "  float ndv=max(dot(N,V),0.0);",
      "  vec3 tint=pow(uTint,vec3(2.2));vec3 cap=pow(uCap,vec3(2.2));vec3 spark=pow(uSpark,vec3(2.2));",
      "  float dif=0.5+0.5*dot(N,normalize(vec3(0.25,0.55,0.8)));",
      "  float h=fract(sin(dot(N.xy+N.z,vec2(12.9898,78.233)))*43758.5453);",
      "  float k=(0.30+0.70*dif)*(0.85+0.30*h);",
      "  float sp=pow(max(dot(R,normalize(vec3(0.4,0.8,0.6))),0.0),8.0)*0.9",
      "          +pow(max(dot(R,normalize(vec3(-0.7,0.3,0.55))),0.0),10.0)*0.7",
      `          +pow(max(dot(R,normalize(vec3(0.0,-0.6,0.8))),0.0),6.0)*0.5;sp*=${glf(l.gemSparkle)};`,
      "  vec3 inner;float f0;",
      "  if(uCz>0.5){",
      // CZ: แยก IOR ราย RGB — env 3 ครั้ง (ประกายรุ้งเล็กน้อย) · ทรงเดียวกับพลอยสี แต่ใสกว่า
      `    inner=vec3(env(refract(-V,N,1.0/${glf(l.czIor[0])})).r,env(refract(-V,N,1.0/${glf(l.czIor[1])})).g,env(refract(-V,N,1.0/${glf(l.czIor[2])})).b)*0.85;`,
      `    f0=${glf(l.czF0)};`,
      "  }else{",
      // พลอยสี: ลำแสงที่ลอดผ่าน × สีพลอย — ด้านที่รับแสงสว่างสีสด ด้านมืดสีเข้ม (ไม่ซีดขาว)
      `    inner=tint*(0.25+1.15*env(refract(-V,N,1.0/${glf(l.gemIor)})))*${glf(l.gemTransmit)};`,
      `    f0=${glf(l.gemF0)};`,
      "  }",
      "  float fr=f0+(1.0-f0)*pow(1.0-ndv,5.0);",
      "  vec3 body=(uCz>0.5)?(tint*k*0.6+inner*0.55):(inner*(0.55+0.45*k));",
      "  vec3 col=mix(body,env(R),fr)+spark*sp+vec3(uGlow);",
      "  col=min(col*" + glf(l.exposure) + ",cap);",
      "  gl_FragColor=vec4(tonemap(col),1.0);",
      "}",
    ].join("\n")
  );
}

export const FS_METAL_V2 = buildFsMetalV2();
export const FS_GEM_V2 = buildFsGemV2();
