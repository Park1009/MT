// ============================================================
//  영수증 사진 다듬기 (글자 인식률을 높이기 위한 전처리)
//  [AI 생성] 이 파일 전체는 AI(Claude)가 만든 초안입니다.
//  순서: 영수증 부분 찾기 → 잘라내기·크기 맞추기 → 그림자 지우기 → 기울기 바로잡기
// ============================================================

// [AI 생성] 이미지(또는 캔버스)를 흑백 숫자 배열로 (긴 변을 maxSide 이하로 줄임)
function grayOf(src, maxSide) {
  const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
  const s = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * s)), h = Math.max(1, Math.round(sh * s));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(src, 0, 0, w, h);
  const a = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < a.length; i += 4, j++) g[j] = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114;
  return { w, h, g, scale: s };
}

// [AI 생성] 밝기 기준값 자동 계산 (오츠 방법)
function otsu(g) {
  const hist = new Float64Array(256);
  for (let i = 0; i < g.length; i++) hist[Math.max(0, Math.min(255, g[i] | 0))]++;
  let sum = 0; for (let v = 0; v < 256; v++) sum += v * hist[v];
  let sumB = 0, wB = 0, best = 0, th = 128;
  for (let v = 0; v < 256; v++) {
    wB += hist[v]; if (!wB) continue;
    const wF = g.length - wB; if (!wF) break;
    sumB += v * hist[v];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > best) { best = between; th = v; }
  }
  return th;
}

// [AI 생성] 가장 긴 연속 구간 찾기 (값이 기준보다 큰 칸들)
function longestRun(arr, min) {
  let bs = 0, be = -1, s = -1;
  for (let i = 0; i <= arr.length; i++) {
    if (i < arr.length && arr[i] > min) { if (s < 0) s = i; }
    else if (s >= 0) { if (i - 1 - s > be - bs) { bs = s; be = i - 1; } s = -1; }
  }
  return be >= bs ? [bs, be] : null;
}

// [AI 생성] 짧은 끊김은 이어 붙여서 가장 긴 구간 찾기
// 바코드·굵은 글씨 줄처럼 잠깐 어두운 줄 때문에 영수증이 두 동강 나지 않게 함
function longestRunGap(arr, min, maxGap) {
  let bs = 0, be = -1, s = -1, last = -1;
  for (let i = 0; i <= arr.length; i++) {
    const on = i < arr.length && arr[i] > min;
    if (on) { if (s < 0 || i - last - 1 > maxGap) { if (s >= 0 && last - s > be - bs) { bs = s; be = last; } s = i; } last = i; }
  }
  if (s >= 0 && last - s > be - bs) { bs = s; be = last; }
  return be >= bs ? [bs, be] : null;
}

// [AI 생성] 사진에서 영수증(밝은 종이) 부분의 네모 영역 찾기. 못 찾으면 사진 전체
function detectReceiptBox(src) {
  const { w, h, g, scale } = grayOf(src, 500);
  const th = otsu(g);
  const bright = new Uint8Array(w * h);
  for (let i = 0; i < g.length; i++) bright[i] = g[i] > th ? 1 : 0;
  // 먼저 세로 방향으로 밝은 칸이 많은 줄을 찾고, 그 줄 안에서 가로 범위를 찾음
  const rowFrac = new Float32Array(h);
  for (let y = 0; y < h; y++) { let n = 0; for (let x = 0; x < w; x++) n += bright[y * w + x]; rowFrac[y] = n / w; }
  const colFrac = new Float32Array(w);
  for (let x = 0; x < w; x++) { let n = 0; for (let y = 0; y < h; y++) n += bright[y * w + x]; colFrac[x] = n / h; }
  const cr = longestRun(colFrac, 0.3);
  if (!cr) return null;
  const rowIn = new Float32Array(h);
  const cw = cr[1] - cr[0] + 1;
  for (let y = 0; y < h; y++) { let n = 0; for (let x = cr[0]; x <= cr[1]; x++) n += bright[y * w + x]; rowIn[y] = n / cw; }
  const rr = longestRunGap(rowIn, 0.4, Math.round(h * 0.08));
  if (!rr) return null;
  const padX = Math.round(cw * 0.03), padY = Math.round((rr[1] - rr[0]) * 0.02);
  const box = {
    x: Math.max(0, cr[0] - padX) / scale, y: Math.max(0, rr[0] - padY) / scale,
    x2: Math.min(w - 1, cr[1] + padX) / scale, y2: Math.min(h - 1, rr[1] + padY) / scale
  };
  const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
  const area = (box.x2 - box.x) * (box.y2 - box.y) / (W * H);
  if (area < 0.05) return null;          // 너무 작으면 잘못 찾은 것
  return { x: box.x, y: box.y, w: box.x2 - box.x, h: box.y2 - box.y };
}

// [AI 생성] 작은 크기에서 상자 흐림 (적분 영상 사용)
function boxBlur(g, w, h, r) {
  const I = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) { row += g[y * w + x]; I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + row; }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
      const s = I[(y1 + 1) * (w + 1) + x1 + 1] - I[y0 * (w + 1) + x1 + 1] - I[(y1 + 1) * (w + 1) + x0] + I[y0 * (w + 1) + x0];
      out[y * w + x] = s / ((x1 - x0 + 1) * (y1 - y0 + 1));
    }
  }
  return out;
}

// [AI 생성] 3×3 범위에서 가장 어두운 값으로 바꾸기 (가로 한 번, 세로 한 번) → 어두운 글자 획이 굵어짐
function thicken(g, w, h) {
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    tmp[i] = Math.min(g[i], x > 0 ? g[i - 1] : 255, x < w - 1 ? g[i + 1] : 255);
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    out[i] = Math.min(tmp[i], y > 0 ? tmp[i - w] : 255, y < h - 1 ? tmp[i + w] : 255);
  }
  return out;
}

// [AI 생성] 기울어진 각도 찾기: 글자 줄이 가로로 반듯할 때 줄 사이 빈칸이 가장 또렷해지는 각도
function estimateSkew(g, w, h) {
  // 글자 획만 고르기: 주변보다 확실히 어두운 점 (탁자 같은 큰 어두운 덩어리는 주변도 어두워서 빠짐)
  const m = boxBlur(g, w, h, Math.max(4, Math.round(w / 60)));
  const pts = [];
  const step = Math.max(1, Math.floor(Math.sqrt((w * h) / 60000)));
  for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) { const i = y * w + x; if (g[i] < m[i] - 30) pts.push(x, y); }
  if (pts.length < 200) return 0;
  // 칸 크기를 표본 간격(step)과 같게 해야 0도에서 줄무늬처럼 점수가 부풀지 않음
  const off = Math.ceil(w * 0.8) + 2, size = Math.ceil((h + off * 2) / step) + 1;
  const score = a => {
    const t = Math.tan((a * Math.PI) / 180);
    const bins = new Float32Array(size);
    for (let i = 0; i < pts.length; i += 2) {
      const yy = Math.round((pts[i + 1] - pts[i] * t + off) / step);
      if (yy >= 0 && yy < size) bins[yy]++;
    }
    let s = 0;
    for (let i = 1; i < size; i++) { const d = bins[i] - bins[i - 1]; s += d * d; }
    return s;
  };
  // 넓게(±35도, 1도 간격) 찾은 뒤 그 근처를 0.25도 간격으로 다시 찾음
  let bestA = 0, bestS = -1;
  for (let a = -35; a <= 35; a += 1) { const s = score(a); if (s > bestS) { bestS = s; bestA = a; } }
  const c = bestA;
  for (let a = c - 1; a <= c + 1.001; a += 0.25) { const s = score(a); if (s > bestS) { bestS = s; bestA = a; } }
  return bestA;
}

// [AI 생성] 네 점(왼쪽 위, 오른쪽 위, 오른쪽 아래, 왼쪽 아래)으로 고른 영역을 반듯한 직사각형으로 펴기
// 비스듬히 찍혀 사다리꼴로 보이는 영수증을 정면에서 본 것처럼 만듦 (원근 변환)
function warpQuad(src, q) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let W = Math.round(Math.max(d(q[0], q[1]), d(q[3], q[2])));
  let H = Math.round(Math.max(d(q[0], q[3]), d(q[1], q[2])));
  const lim = 2400 / Math.max(W, H);
  const os = lim < 1 ? lim : 1;
  W = Math.max(2, Math.round(W * os)); H = Math.max(2, Math.round(H * os));
  // 결과 좌표 (0,0),(W,0),(W,H),(0,H) → 사진 좌표 q 로 보내는 변환식 구하기
  const dst = [[0, 0], [W, 0], [W, H], [0, H]];
  const A = [], B = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = dst[i], [u, v] = q[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.push(u);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); B.push(v);
  }
  const h = solveLinear(A, B);
  const sW = src.naturalWidth || src.width, sH = src.naturalHeight || src.height;
  const sc = document.createElement('canvas'); sc.width = sW; sc.height = sH;
  const sctx = sc.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(src, 0, 0);
  const sd = sctx.getImageData(0, 0, sW, sH).data;
  const out = document.createElement('canvas'); out.width = W; out.height = H;
  const octx = out.getContext('2d');
  const od = octx.createImageData(W, H), o = od.data;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const den = h[6] * x + h[7] * y + 1;
      const u = (h[0] * x + h[1] * y + h[2]) / den, v = (h[3] * x + h[4] * y + h[5]) / den;
      const j = (y * W + x) * 4;
      if (u < 0 || v < 0 || u >= sW - 1 || v >= sH - 1) { o[j] = o[j + 1] = o[j + 2] = 255; o[j + 3] = 255; continue; }
      const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0;
      const i00 = (y0 * sW + x0) * 4, i10 = i00 + 4, i01 = i00 + sW * 4, i11 = i01 + 4;
      for (let c = 0; c < 3; c++) {
        o[j + c] = (sd[i00 + c] * (1 - fx) + sd[i10 + c] * fx) * (1 - fy) + (sd[i01 + c] * (1 - fx) + sd[i11 + c] * fx) * fy;
      }
      o[j + 3] = 255;
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

// [AI 생성] 연립방정식 풀기 (가우스 소거법)
function solveLinear(A, B) {
  const n = B.length, M = A.map((r, i) => [...r, B[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((r, i) => r[n] / r[i]);
}

// [AI 생성] 인식용 영수증 이미지 만들기: 잘라내기 → 폭 1600px 맞춤 → 그림자 지우기 → 기울기 바로잡기
// opts.scale: 확대 배율을 직접 정할 때 (칸별로 읽을 때 칸마다 글자 크기를 같게 하려고), opts.deskew: false면 기울기 보정 안 함
function prepareReceipt(src, box, opts) {
  opts = opts || {};
  const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
  box = box || { x: 0, y: 0, w: W, h: H };
  const s = opts.scale || Math.min(3, 1600 / box.w);
  const cw = Math.round(box.w * s), ch = Math.round(box.h * s);
  const c = document.createElement('canvas'); c.width = cw; c.height = ch;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, box.x, box.y, box.w, box.h, 0, 0, cw, ch);
  const img = ctx.getImageData(0, 0, cw, ch), a = img.data;
  const g = new Float32Array(cw * ch);
  for (let i = 0, j = 0; i < a.length; i += 4, j++) g[j] = a[i] * 0.299 + a[i + 1] * 0.587 + a[i + 2] * 0.114;

  // 그림자 지우기: 크게 흐린 배경 밝기로 나눠서 종이 밝기를 고르게
  const k = 8, sw = Math.ceil(cw / k), sh = Math.ceil(ch / k);
  const small = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
    // 글자(어두운 점)를 피하려고 칸 안에서 밝은 쪽 값을 씀
    let mx = 0;
    for (let dy = 0; dy < k; dy++) { const yy = y * k + dy; if (yy >= ch) break; for (let dx = 0; dx < k; dx++) { const xx = x * k + dx; if (xx >= cw) break; const v = g[yy * cw + xx]; if (v > mx) mx = v; } }
    small[y * sw + x] = mx;
  }
  const bg = boxBlur(small, sw, sh, 4);
  for (let y = 0; y < ch; y++) {
    const sy = Math.min(sh - 1, (y / k) | 0);
    for (let x = 0; x < cw; x++) {
      const b = Math.max(30, bg[sy * sw + Math.min(sw - 1, (x / k) | 0)]);
      g[y * cw + x] = Math.min(255, (g[y * cw + x] / b) * 245);
    }
  }
  // 대비 늘리기 (어두운 1% ~ 밝은 쪽 기준)
  const hist = new Uint32Array(256);
  for (let i = 0; i < g.length; i++) hist[g[i] | 0]++;
  let lo = 0, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > g.length * 0.01) { lo = v; break; } }
  const hi = 235, span = Math.max(1, hi - lo);
  for (let i = 0, j = 0; j < g.length; i += 4, j++) {
    const v = Math.max(0, Math.min(255, ((g[j] - lo) * 255) / span));
    g[j] = v;
  }
  // 글자 획을 한 칸씩 굵게 (점으로 찍힌 감열지 글자가 이어져서 한글 인식이 좋아짐)
  const t = thicken(g, cw, ch);
  for (let i = 0, j = 0; j < t.length; i += 4, j++) { a[i] = a[i + 1] = a[i + 2] = t[j]; a[i + 3] = 255; }
  ctx.putImageData(img, 0, 0);

  if (opts.deskew === false) return c;
  // 기울기 바로잡기
  const sm = grayOf(c, 700);
  const angle = estimateSkew(sm.g, sm.w, sm.h);
  if (Math.abs(angle) < 0.25) return c;
  const rad = (-angle * Math.PI) / 180;
  const rw = Math.round(Math.abs(cw * Math.cos(rad)) + Math.abs(ch * Math.sin(rad)));
  const rh = Math.round(Math.abs(cw * Math.sin(rad)) + Math.abs(ch * Math.cos(rad)));
  const r = document.createElement('canvas');
  r.width = rw; r.height = rh;
  const rc = r.getContext('2d');
  rc.fillStyle = '#ffffff'; rc.fillRect(0, 0, rw, rh);
  rc.translate(rw / 2, rh / 2); rc.rotate(rad); rc.translate(-cw / 2, -ch / 2);
  rc.drawImage(c, 0, 0);
  return r;
}

// [AI 생성] 사진을 90도 돌린 캔버스 만들기 (dir: 1 시계, -1 반시계)
function rotate90(src, dir) {
  const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
  const c = document.createElement('canvas'); c.width = H; c.height = W;
  const ctx = c.getContext('2d');
  ctx.translate(H / 2, W / 2); ctx.rotate(dir * Math.PI / 2); ctx.drawImage(src, -W / 2, -H / 2);
  return c;
}

// [AI 생성] 인식 결과가 얼마나 그럴듯한지 점수
// 메뉴 합계가 영수증 합계와 맞으면 크게 더하고, 사전에 있는 메뉴 낱말이 많을수록 조금 더함
function parseScore(p) {
  const sum = p.items.reduce((s, x) => s + x.price, 0);
  let sc = p.items.length;
  if (p.total) sc += 2;
  if (p.total && sum === p.total) sc += 10;
  p.items.forEach(x => {
    if (!/[가-힣]{2,}|[A-Za-z]{3,}/.test(x.name)) sc -= 0.7;
    if ((x.name.match(/[가-힣]{2,}/g) || []).some(w => MENU_WORDS.has(w))) sc += 0.4;
  });
  return sc;
}

// [AI 생성] 폭을 바꾼 캔버스 사본
function scaleCanvas(c, W) {
  const o = document.createElement('canvas');
  o.width = W; o.height = Math.round(c.height * W / c.width);
  const x = o.getContext('2d'); x.imageSmoothingQuality = 'high';
  x.drawImage(c, 0, 0, o.width, o.height);
  return o;
}

// [AI 생성] 여러 방식으로 읽어 보고 가장 그럴듯한 결과 고르기
// 1) 기본 크기·줄 단위(PSM 6) → 2) 크게 키워서 다시 → 3) 단 나눔 방식(PSM 4)
// 메뉴 합계가 영수증 합계와 맞고 이름도 멀쩡하면 거기서 멈춤
async function recognizeBest(worker, canvas, onStep) {
  const tries = [
    { make: () => canvas, psm: '6' },
    { make: () => scaleCanvas(canvas, 2200), psm: '6' },
    { make: () => canvas, psm: '4' }
  ];
  let best = null;
  for (let i = 0; i < tries.length; i++) {
    if (onStep) onStep(i, tries.length);
    await worker.setParameters({ tessedit_pageseg_mode: tries[i].psm, preserve_interword_spaces: '1', user_defined_dpi: '300' });
    const out = await worker.recognize(tries[i].make());
    const parsed = parseReceipt(out.data.text);
    const score = parseScore(parsed);
    if (!best || score > best.score) best = { parsed, score, text: out.data.text, psm: tries[i].psm + '#' + i };
    const sum = parsed.items.reduce((s, x) => s + x.price, 0);
    const clean = parsed.items.every(x => /[가-힣]{2,}|[A-Za-z]{3,}/.test(x.name));
    if (parsed.total && sum === parsed.total && parsed.items.length >= 1 && clean) break;
  }
  return best;
}
