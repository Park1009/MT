// ============================================================
//  먹은만큼 정산 — 앱 로직 (p5.js 전역 모드)
//  [AI 생성] 이 파일 전체는 AI(Claude)가 만든 초안입니다.
// ============================================================

const SAVE_KEY = 'meogeun-mankeum-v1';
const PALETTE = ['#e4572e', '#2e86ab', '#e9a23b', '#6a4c93', '#3a9e68', '#d1495b', '#1b998b', '#9c6644'];
let state = null;          // 저장되는 정산 데이터
const photos = {};         // 영수증 id → 사진 주소 (저장하지 않음)
let idSeq = 1;

// ---------------- 공통 도우미 ----------------

// [AI 생성] 고유 id 만들기
function newId(prefix) { return prefix + Date.now().toString(36) + (idSeq++); }

// [AI 생성] 숫자를 "12,000원" 형태로
function won(n) { return Math.round(n).toLocaleString('ko-KR') + '원'; }

// [AI 생성] 브라우저에 자동 저장 (실패해도 앱은 계속 동작)
function persist() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch (e) { /* 저장 불가 환경 */ }
}

// [AI 생성] 저장된 정산 불러오기
function restore() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && Array.isArray(s.receipts) && Array.isArray(s.people)) return s;
  } catch (e) { /* 무시 */ }
  return null;
}

// [AI 생성] 메뉴 하나
function makeItem(name, price, drink) {
  return { id: newId('i'), name: name, price: price, drink: !!drink, mode: 'none', people: [] };
}

// [AI 생성] 사람 한 명 (색은 팔레트에서 차례로)
function makePerson(name, drink) {
  const used = state ? state.people.map(p => p.c) : [];
  let c = 0;
  while (used.includes(c) && c < PALETTE.length - 1) c++;
  if (used.includes(c)) c = (state ? state.people.length : 0) % PALETTE.length;
  return { id: newId('p'), name: name, drink: !!drink, c: c };
}

// [AI 생성] 빈 정산 (처음 열었을 때, 새 정산 시작할 때)
function blankState() {
  state = { receipts: [], people: [], current: 0, payer: null, step: 1 };
  state.people.push(makePerson('나', false));
  state.people.push(makePerson('친구1', false));
  return state;
}

function curReceipt() { return state.receipts[state.current] || null; }
function personById(id) { return state.people.find(p => p.id === id); }
function receiptSum(r) { return r.items.reduce((s, it) => s + (Number(it.price) || 0), 0); }

// ---------------- 정산 계산 ----------------

// [AI 생성] 메뉴를 나눌 사람 목록
function shareOf(item) {
  if (item.mode === 'all') return state.people.map(p => p.id);
  if (item.mode === 'drinkers') return state.people.filter(p => p.drink).map(p => p.id);
  if (item.mode === 'people') return item.people.filter(id => personById(id));
  return [];
}

// [AI 생성] 사람별 금액과 먹은 메뉴 계산. 나누어떨어지지 않는 1원 단위는 앞사람부터 1원씩 더 냄
function computeTotals() {
  const per = {};
  state.people.forEach(p => { per[p.id] = { amount: 0, parts: [] }; });
  let unassigned = 0, unassignedCount = 0, assigned = 0;
  for (const r of state.receipts) {
    for (const it of r.items) {
      const price = Number(it.price) || 0;
      const ids = shareOf(it);
      if (!ids.length) { unassigned += price; unassignedCount++; continue; }
      assigned += price;
      const base = Math.floor(price / ids.length);
      let rem = price - base * ids.length;
      const order = state.people.map(p => p.id).filter(id => ids.includes(id));
      order.forEach(id => {
        const share = base + (rem > 0 ? 1 : 0);
        if (rem > 0) rem--;
        per[id].amount += share;
        per[id].parts.push(order.length > 1 ? `${it.name}(1/${order.length})` : it.name);
      });
    }
  }
  const grand = state.receipts.reduce((s, r) => s + receiptSum(r), 0);
  return { per, unassigned, unassignedCount, assigned, grand };
}

// [AI 생성] 메뉴를 한 사람에게 놓았을 때: 이미 있으면 빼고, 없으면 더함 (여러 명이면 자동으로 똑같이 나눔)
function togglePerson(item, pid) {
  if (item.mode !== 'people') { item.mode = 'people'; item.people = []; }
  if (item.people.includes(pid)) item.people = item.people.filter(x => x !== pid);
  else item.people.push(pid);
  if (!item.people.length) item.mode = 'none';
  pulse[pid] = millis();
  afterChange();
}

// [AI 생성] '모두 같이' 또는 '술 마신 사람끼리' 칸에 놓았을 때
function setGroup(item, mode) {
  if (mode === 'drinkers' && item.mode !== 'drinkers' && !state.people.some(p => p.drink)) { needDrinkerNote(); return false; }
  item.mode = item.mode === mode ? 'none' : mode;
  item.people = [];
  const ids = shareOf(item);
  ids.forEach(id => { pulse[id] = millis(); });
  afterChange();
  return true;
}

// [AI 생성] 메뉴를 고르지 않고 칸만 눌렀을 때: 지금 영수증의 안 나눈 메뉴를 한꺼번에 배정
// '모두 같이' → 안 나눈 메뉴 전부, '술 마신 사람끼리' → 안 나눈 술·음료 메뉴
function groupRest(mode) {
  const r = curReceipt();
  if (!r) return;
  if (mode === 'drinkers' && !state.people.some(p => p.drink)) { needDrinkerNote(); return; }
  const rest = r.items.filter(it => !shareOf(it).length && (mode === 'all' || it.drink));
  if (!rest.length) {
    flashHint(mode === 'all' ? '이 영수증에는 아직 안 나눈 메뉴가 없어요.'
      : '아직 안 나눈 술·음료 메뉴가 없어요. 다른 메뉴는 이 칸으로 끌어다 놓으면 술 마신 사람끼리 나눠요.');
    return;
  }
  rest.forEach(it => { it.mode = mode; it.people = []; });
  shareOf(rest[0]).forEach(id => { pulse[id] = millis(); });
  flashHint(`${rest.length}개 메뉴를 ${mode === 'all' ? '모두 같이' : '술 마신 사람끼리'} 나눴어요.`, true);
  afterChange();
}

// [AI 생성] 3단계 안내 줄에 잠깐 알림 띄우기
let hintNote = null;
function flashHint(msg, ok) {
  hintNote = { msg, ok: !!ok, until: Date.now() + 4000 };
  renderStep3Info();
  setTimeout(() => { if (hintNote && Date.now() >= hintNote.until) { hintNote = null; if (state.step === 3) renderStep3Info(); } }, 4100);
}
function needDrinkerNote() { flashHint("먼저 위쪽 사람 이름 옆의 '술 마심'을 눌러 술 마신 사람을 표시해 주세요."); }

function clearItem(item) { item.mode = 'none'; item.people = []; afterChange(); }

// [AI 생성] 데이터가 바뀌면 저장하고 화면 글자들을 갱신
function afterChange() {
  persist();
  if (state.step === 3) { renderPeopleBar(false); renderStep3Info(); }
}

// ---------------- 단계 이동 ----------------

// [AI 생성] 단계마다 갈 수 있는지 확인
function canGo(step) {
  const hasItems = state.receipts.some(r => r.items.length > 0);
  if (step === 1) return true;
  if (step === 2) return state.receipts.length > 0;
  if (step === 3) return hasItems;
  if (step === 4) return hasItems && state.people.length > 0;
  return false;
}

// [AI 생성] n단계 화면 보여주기
function goStep(n) {
  if (!canGo(n)) return;
  state.step = n;
  for (let i = 1; i <= 4; i++) document.getElementById('step' + i).hidden = i !== n;
  document.querySelectorAll('.steps button').forEach(b => {
    const s = Number(b.dataset.step);
    b.disabled = !canGo(s);
    b.classList.toggle('done', s < n);
    if (s === n) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current');
  });
  if (n === 1) renderStep1();
  if (n === 2) renderStep2();
  if (n === 3) { renderPeopleBar(true); renderStep3Info(); loop(); } else noLoop();
  if (n === 4) renderStep4();
  persist();
}

// ---------------- 1단계: 사진 올리기 + 글자 인식 ----------------

// [AI 생성] 올린 영수증 목록
function renderStep1() {
  const box = document.getElementById('receiptList');
  box.innerHTML = '';
  if (!state.receipts.length) {
    box.innerHTML = '<span class="muted">아직 없어요. 위에서 사진을 고르거나 직접 입력하세요.</span>';
  }
  state.receipts.forEach((r, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const name = document.createElement('b'); name.textContent = r.name;
    const num = document.createElement('span'); num.className = 'num';
    num.textContent = `메뉴 ${r.items.length}개 · ${won(receiptSum(r))}`;
    const edit = document.createElement('button'); edit.type = 'button'; edit.textContent = '확인';
    edit.onclick = () => { state.current = i; goStep(2); };
    chip.append(name, num, edit);
    box.append(chip);
  });
  document.getElementById('toStep2').disabled = !canGo(2);
}

let ocrWorkerP = null;
let ocrReadLabel = '영수증 글자 읽는 중';
let ocrBusy = false;

// [AI 생성] 글자 인식 진행 상황 표시
function ocrProgress(label, p) {
  document.getElementById('ocrBox').hidden = false;
  document.getElementById('ocrLabel').textContent = label;
  document.getElementById('ocrPct').textContent = Math.round(p * 100) + '%';
  document.getElementById('ocrBar').style.width = Math.round(p * 100) + '%';
}

// [AI 생성] 글자 인식 엔진 준비 (한 번만 만듦). 페이지 옆에 ocr/ 폴더가 있으면 그 파일을, 없으면 CDN을 씀
function getOcrWorker() {
  if (!ocrWorkerP) ocrWorkerP = makeOcrWorker().catch(e => { ocrWorkerP = null; throw e; });
  return ocrWorkerP;
}

async function makeOcrWorker() {
  if (!window.Tesseract) throw new Error('글자 인식 라이브러리를 불러오지 못했어요.');
  const LABEL = {
    'loading tesseract core': '인식 엔진 불러오는 중',
    'initializing tesseract': '인식 엔진 준비 중',
    'loading language traineddata': '한국어 데이터 받는 중 (처음 한 번만)',
    'initializing api': '인식 준비 마무리 중'
  };
  const opts = {
    logger: m => {
      if (!ocrBusy && m.status !== 'recognizing text') return;   // 사진을 맞추는 동안에는 준비 상황을 띄우지 않음
      ocrProgress(m.status === 'recognizing text' ? ocrReadLabel : (LABEL[m.status] || '글자 인식 준비 중'), m.progress || 0);
    }
  };
  // 페이지 옆 ocr/ 폴더에는 한글 전용 정밀 모델(Hangul)이 있음. 없으면 CDN의 기본 한국어+영어 모델을 씀
  // 파일을 ocr/ 폴더에 넣었든, 저장소 맨 위에 그냥 올렸든 둘 다 찾음
  let langs = ['kor', 'eng'];
  // 이 저장소는 맨 위에 올려 두었으므로 맨 위부터 찾음 (없는 쪽을 먼저 찾으면 콘솔에 404가 찍힘)
  for (const dir of ['', 'ocr/']) {
    try {
      const res = await fetch(dir + 'ocr-worker.js', { cache: 'force-cache' });
      if (!res.ok) continue;
      // './' 를 기준으로 해야 주소 뒤에 ?나 #이 붙어 있어도(카톡 공유 링크 등) 폴더 주소가 맞게 나옴
      const base = new URL(dir || './', location.href).href;
      Object.assign(opts, { workerPath: base + 'ocr-worker.js', corePath: base, langPath: base, workerBlobURL: false });
      langs = ['Hangul'];
      break;
    } catch (e) { /* 다음 위치 확인 */ }
  }
  const timeout = ms => new Promise((_, rej) => setTimeout(() => rej(new Error('글자 인식 엔진이 제때 준비되지 않았어요.')), ms));
  try {
    return await Promise.race([Tesseract.createWorker(langs, 1, opts), timeout(90000)]);
  } catch (e) {
    if (langs[0] !== 'Hangul') throw (e instanceof Error ? e : new Error(String(e)));
    // 같이 올린 한글 모델을 못 쓰면 CDN의 기본 한국어+영어 모델로 다시 시도
    console.warn('한글 모델 준비 실패, 기본 모델로 다시 시도:', e);
    delete opts.workerPath; delete opts.corePath; delete opts.langPath; delete opts.workerBlobURL;
    return Promise.race([Tesseract.createWorker(['kor', 'eng'], 1, opts), timeout(90000)]);
  }
}

// ---------------- 영수증 부분 맞추기 (자르기 화면) ----------------

// [AI 생성] 사진 위에서 읽을 부분을 네 귀퉁이로 고르기.
// 네 점을 메뉴 부분의 네 귀퉁이에 맞추면, 비스듬히 찍힌 영수증도 반듯하게 펴서 그 안만 읽음.
// 고르면 { src, quad: [왼위, 오위, 오아래, 왼아래] }, 취소하면 null
function askCrop(img, index, count) {
  return new Promise(resolve => {
    const panel = document.getElementById('cropBox');
    const cv = document.getElementById('cropCanvas');
    const ctx = cv.getContext('2d');
    document.getElementById('cropCount').textContent = count > 1 ? `${index + 1} / ${count}장` : '';
    panel.hidden = false;
    let src = img, q, k = 1, drag = null;
    const SW = () => src.naturalWidth || src.width, SH = () => src.naturalHeight || src.height;
    const rectQuad = b => [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
    const fit = () => {
      const maxW = Math.min(panel.clientWidth - 30 || 560, 620);
      const maxH = Math.max(360, window.innerHeight * 0.72);
      k = Math.min(maxW / SW(), maxH / SH());
      cv.width = Math.round(SW() * k); cv.height = Math.round(SH() * k);
    };
    // 처음 네모: 자동으로 찾은 영수증 영역. 사진 전체에 가까우면 귀퉁이를 잡기 쉽게 조금 안쪽으로
    const reset = () => {
      let b = detectReceiptBox(src) || { x: 0, y: 0, w: SW(), h: SH() };
      // (너무 안쪽으로 넣으면 영수증이 꽉 찬 사진에서 가장자리 금액이 잘림. '읽기' 때 4% 넓히므로 2%만 넣음)
      if (b.w * b.h > SW() * SH() * 0.85) b = { x: SW() * 0.02, y: SH() * 0.02, w: SW() * 0.96, h: SH() * 0.96 };
      q = rectQuad(b); fit(); paint();
    };
    const path = () => { ctx.beginPath(); q.forEach(([x, y], i) => (i ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k))); ctx.closePath(); };
    function paint() {
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.drawImage(src, 0, 0, cv.width, cv.height);
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.save(); path(); ctx.clip(); ctx.drawImage(src, 0, 0, cv.width, cv.height); ctx.restore();
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#0d7f62';
      ctx.lineWidth = 2.5; path(); ctx.stroke();
      ctx.fillStyle = '#ffffff';
      q.forEach(([x, y]) => { ctx.beginPath(); ctx.arc(x * k, y * k, 12, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); });
    }
    const pos = e => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) * (cv.width / r.width) / k, (e.clientY - r.top) * (cv.height / r.height) / k]; };
    const clampX = x => Math.max(0, Math.min(SW(), x)), clampY = y => Math.max(0, Math.min(SH(), y));
    // 점과 선분 사이 거리 (테두리를 잡았는지 확인용)
    const segDist = (p, a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
      return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
    };
    cv.onpointerdown = e => {
      const p = pos(e);
      const hit = q.findIndex(([x, y]) => Math.hypot(x - p[0], y - p[1]) * k < 30);
      const edge = hit < 0 ? [0, 1, 2, 3].find(i => segDist(p, q[i], q[(i + 1) % 4]) * k < 14) : undefined;
      if (hit >= 0) drag = { corner: hit };
      else if (edge !== undefined) drag = { edge, last: p };
      else drag = { draw: true, x0: clampX(p[0]), y0: clampY(p[1]) };   // 그 밖은 끌어서 네모를 새로 그림
      cv.setPointerCapture(e.pointerId);
    };
    cv.onpointermove = e => {
      if (!drag) return;
      const p = pos(e), x = clampX(p[0]), y = clampY(p[1]);
      if (drag.draw) {
        if (Math.abs(x - drag.x0) * k > 8 && Math.abs(y - drag.y0) * k > 8)
          q = rectQuad({ x: Math.min(drag.x0, x), y: Math.min(drag.y0, y), w: Math.abs(x - drag.x0), h: Math.abs(y - drag.y0) });
      } else if (drag.corner !== undefined) {
        q[drag.corner] = [x, y];                       // 귀퉁이 하나만 따로 움직임 → 사다리꼴도 맞출 수 있음
      } else {
        const dx = p[0] - drag.last[0], dy = p[1] - drag.last[1];
        [drag.edge, (drag.edge + 1) % 4].forEach(i => { q[i] = [clampX(q[i][0] + dx), clampY(q[i][1] + dy)]; });
        drag.last = p;
      }
      paint();
    };
    cv.onpointerup = cv.onpointercancel = () => { drag = null; };
    const done = val => {
      panel.hidden = true;
      ['cropOk', 'cropCancel', 'rotL', 'rotR', 'cropReset'].forEach(id => { document.getElementById(id).onclick = null; });
      resolve(val);
    };
    document.getElementById('rotL').onclick = () => { src = rotate90(src, -1); reset(); };
    document.getElementById('rotR').onclick = () => { src = rotate90(src, 1); reset(); };
    document.getElementById('cropReset').onclick = reset;
    // 귀퉁이가 글자에 딱 붙어 잘리지 않도록 가운데에서 바깥쪽으로 조금 넓혀서 읽음
    document.getElementById('cropOk').onclick = () => {
      const cx = q.reduce((t, p) => t + p[0], 0) / 4, cy = q.reduce((t, p) => t + p[1], 0) / 4;
      done({ src, quad: q.map(([x, y]) => [clampX(cx + (x - cx) * 1.04), clampY(cy + (y - cy) * 1.04)]) });
    };
    document.getElementById('cropCancel').onclick = () => done(null);
    reset();
    panel.scrollIntoView({ block: 'nearest' });
  });
}

// [AI 생성] 붙여넣은 글로 새 영수증 만들기 (휴대폰 글자 인식으로 복사한 글)
function addPastedReceipt() {
  const ta = document.getElementById('pasteText');
  const err = document.getElementById('pasteError');
  const parsed = parsePasted(ta.value);
  if (!parsed.items.length) {
    err.textContent = '메뉴와 가격을 찾지 못했어요. 메뉴 이름과 금액이 들어 있는지 확인해 주세요.';
    err.hidden = false;
    return;
  }
  err.hidden = true;
  const r = { id: newId('r'), name: (state.receipts.length + 1) + '차', total: parsed.total, items: parsed.items.map(x => makeItem(x.name, x.price, x.drink)) };
  state.receipts.push(r);
  state.current = state.receipts.length - 1;
  ta.value = '';
  persist();
  goStep(2);
}

// [AI 생성] 잘라낸 영수증 부분을 2단계 비교용 사진으로
function cropPreview(src, box) {
  const s = Math.min(1, 900 / box.w);
  const c = document.createElement('canvas');
  c.width = Math.round(box.w * s); c.height = Math.round(box.h * s);
  c.getContext('2d').drawImage(src, box.x, box.y, box.w, box.h, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85);
}

// [AI 생성] 파일 → 이미지 요소
function loadImageFile(file) {
  return new Promise((ok, fail) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => ok({ img, url });
    img.onerror = () => fail(new Error('사진을 열 수 없어요. JPG나 PNG 파일인지 확인해 주세요.'));
    img.src = url;
  });
}

// [AI 생성] 사진 한 장: 영수증 부분 맞추기 → 사진 다듬기 → 여러 방식으로 읽기 → 새 영수증 추가
async function handleReceiptFile(file, index, count) {
  const err = document.getElementById('ocrError');
  err.hidden = true;
  let img;
  try { img = (await loadImageFile(file)).img; }
  catch (e) { err.textContent = e.message; err.hidden = false; return null; }
  getOcrWorker().catch(() => {});                 // 사진을 맞추는 동안 인식 엔진을 미리 준비
  const crop = await askCrop(img, index, count);
  if (!crop) return null;
  const r = { id: newId('r'), name: (state.receipts.length + 1) + '차', total: null, items: [] };
  const flat = warpQuad(crop.src, crop.quad);     // 고른 네 귀퉁이 안을 반듯하게 펴기
  photos[r.id] = cropPreview(flat, { x: 0, y: 0, w: flat.width, h: flat.height });
  ocrBusy = true;
  try {
    ocrProgress('사진 다듬는 중', 0.02);
    await new Promise(ok => setTimeout(ok, 30));  // 진행 표시가 먼저 그려지도록
    ocrProgress('글자 인식 준비 중', 0.05);
    const worker = await getOcrWorker();
    // 고른 부분만 다듬어서 읽기 (결과가 미심쩍으면 방식을 바꿔 다시 읽고 가장 그럴듯한 결과를 고름)
    const canvas = prepareReceipt(flat, null);
    const best = await recognizeBest(worker, canvas, (i, n) => {
      ocrReadLabel = i === 0 ? '고른 부분 글자 읽는 중' : `더 정확하게 다시 읽는 중 (${i + 1}/${n})`;
    });
    r.items = best.parsed.items.map(x => makeItem(x.name, x.price, x.drink));
    r.total = best.parsed.total;
    r.rawText = best.text.trim();
    ocrProgress('다 읽었어요', 1);
    if (!r.items.length) {
      r.note = '사진에서 메뉴와 가격을 찾지 못했어요. 아래 "읽은 글 보기"에서 무엇을 읽었는지 확인하고 고쳐서 다시 정리하거나, 귀퉁이를 메뉴 부분에 더 꼭 맞춰 다시 올려 보세요.';
      r.items.push(makeItem('', 0));
    }
  } catch (e) {
    r.note = (e && e.message ? e.message : '글자 인식에 실패했어요.') + ' 메뉴는 여기서 직접 입력하거나, 1단계의 "사진 대신 글 붙여넣기"를 써 보세요.';
    document.getElementById('ocrBox').hidden = true;
    if (!r.items.length) r.items.push(makeItem('', 0));
  }
  ocrBusy = false;
  state.receipts.push(r);
  state.current = state.receipts.length - 1;
  persist();
  return r;
}

// [AI 생성] 여러 장을 고르면 한 장씩 차례로 처리
async function handleFiles(files) {
  const list = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (!list.length) return;
  let added = 0;
  for (let i = 0; i < list.length; i++) if (await handleReceiptFile(list[i], i, list.length)) added++;
  if (added) goStep(2); else renderStep1();
}

// ---------------- 2단계: 메뉴 확인 ----------------

// [AI 생성] 영수증 탭 + 메뉴 표 + 합계 확인
function renderStep2() {
  const r = curReceipt();
  if (!r) { goStep(1); return; }
  const tabs = document.getElementById('receiptTabs2');
  tabs.innerHTML = '';
  state.receipts.forEach((x, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(i === state.current));
    b.textContent = x.name;
    b.onclick = () => { state.current = i; renderStep2(); };
    tabs.append(b);
  });
  const nameIn = document.getElementById('receiptName');
  nameIn.value = r.name;
  nameIn.oninput = () => { r.name = nameIn.value || '영수증'; tabs.children[state.current].textContent = r.name; persist(); };

  const list = document.getElementById('itemList');
  list.innerHTML = '<div class="item head"><span>메뉴</span><span style="text-align:right">가격(원)</span><span></span><span></span></div>';
  r.items.forEach(it => list.append(itemRow(r, it)));
  renderSum();

  const note = document.getElementById('readNote');
  note.textContent = r.note || '';
  note.hidden = !r.note;
  const raw = document.getElementById('rawBox');
  raw.hidden = !r.rawText;
  if (r.rawText) {
    const ta = document.getElementById('rawText');
    ta.value = r.rawText;
    document.getElementById('reparse').onclick = () => {
      const parsed = parsePasted(ta.value);
      if (!parsed.items.length) { note.textContent = '이 글에서도 메뉴와 가격을 찾지 못했어요. 메뉴 이름과 금액이 같은 줄에 오도록 고쳐 보세요.'; note.hidden = false; return; }
      r.items = parsed.items.map(x => makeItem(x.name, x.price, x.drink));
      if (parsed.total) r.total = parsed.total;
      r.rawText = ta.value; r.note = '';
      persist(); renderStep2();
    };
  }
  const pb = document.getElementById('photoBox');
  if (photos[r.id]) { document.getElementById('photoImg').src = photos[r.id]; pb.hidden = false; }
  else pb.hidden = true;
  document.getElementById('toStep3').disabled = !canGo(3);
}

// [AI 생성] 메뉴 한 줄 (이름, 가격, 술·음료 표시, 삭제)
function itemRow(r, it) {
  const row = document.createElement('div');
  row.className = 'item';
  const name = document.createElement('input');
  name.type = 'text'; name.value = it.name; name.placeholder = '메뉴 이름'; name.setAttribute('aria-label', '메뉴 이름');
  name.oninput = () => { it.name = name.value; persist(); };
  const price = document.createElement('input');
  price.type = 'text'; price.inputMode = 'numeric'; price.className = 'price';
  price.value = it.price ? Number(it.price).toLocaleString('ko-KR') : '';
  price.placeholder = '0'; price.setAttribute('aria-label', '가격');
  price.oninput = () => { it.price = (/^\s*-/.test(price.value) ? -1 : 1) * (parseInt(price.value.replace(/[^\d]/g, ''), 10) || 0); renderSum(); persist(); };  // 할인 줄은 '-780'처럼 음수
  price.onblur = () => { price.value = it.price ? it.price.toLocaleString('ko-KR') : ''; };
  const drink = document.createElement('button');
  drink.type = 'button'; drink.className = 'toggle'; drink.textContent = '술·음료';
  drink.setAttribute('aria-pressed', String(it.drink));
  drink.onclick = () => { it.drink = !it.drink; drink.setAttribute('aria-pressed', String(it.drink)); persist(); };
  const del = document.createElement('button');
  del.type = 'button'; del.className = 'quiet'; del.textContent = '삭제';
  del.setAttribute('aria-label', '메뉴 삭제');
  del.onclick = () => { r.items = r.items.filter(x => x !== it); row.remove(); renderSum(); persist(); };
  row.append(name, price, drink, del);
  return row;
}

// [AI 생성] 메뉴 합계와 영수증 합계 비교
function renderSum() {
  const r = curReceipt(); if (!r) return;
  const box = document.getElementById('sumBox');
  const sum = receiptSum(r);
  box.innerHTML = '';
  const a = document.createElement('span'); a.innerHTML = `메뉴 합계 <b>${won(sum)}</b>`;
  const lab = document.createElement('label');
  lab.innerHTML = '<span class="muted">영수증에 적힌 합계</span>';
  const t = document.createElement('input');
  t.type = 'text'; t.inputMode = 'numeric'; t.className = 'price';
  t.value = r.total ? r.total.toLocaleString('ko-KR') : ''; t.placeholder = '선택';
  t.onchange = () => { r.total = parseInt(t.value.replace(/[^\d]/g, ''), 10) || null; persist(); renderSum(); };
  lab.append(t);
  const st = document.createElement('span');
  if (r.total) {
    const diff = r.total - sum;
    if (diff === 0) { st.textContent = '합계가 맞아요'; st.style.color = 'var(--accent)'; }
    else { st.className = 'warn'; st.textContent = `${won(Math.abs(diff))} ${diff > 0 ? '모자라요' : '많아요'}. 빠진 메뉴나 가격을 확인하세요`; }
  }
  box.append(a, lab, st);
  document.getElementById('toStep3').disabled = !canGo(3);
}

// ---------------- 3단계: 사람 목록 (HTML) ----------------

// [AI 생성] 참여자 칩: 이름 고치기, 술 마셨는지, 빼기, 사람 추가
function renderPeopleBar(full) {
  const bar = document.getElementById('peopleBar');
  if (!full && bar.childElementCount) return;
  bar.innerHTML = '';
  state.people.forEach(p => {
    const chip = document.createElement('span'); chip.className = 'person';
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = PALETTE[p.c];
    const nm = document.createElement('input'); nm.type = 'text'; nm.value = p.name; nm.maxLength = 8;
    nm.setAttribute('aria-label', '이름');
    nm.oninput = () => { p.name = nm.value || '이름'; persist(); };
    const dr = document.createElement('button'); dr.type = 'button'; dr.className = 'toggle';
    dr.textContent = '술 마심'; dr.setAttribute('aria-pressed', String(p.drink));
    dr.onclick = () => { p.drink = !p.drink; dr.setAttribute('aria-pressed', String(p.drink)); afterChange(); };
    const rm = document.createElement('button'); rm.type = 'button'; rm.className = 'quiet'; rm.textContent = '빼기';
    rm.disabled = state.people.length <= 1;
    rm.onclick = () => {
      state.people = state.people.filter(x => x !== p);
      state.receipts.forEach(r => r.items.forEach(it => {
        it.people = it.people.filter(id => id !== p.id);
        if (it.mode === 'people' && !it.people.length) it.mode = 'none';
      }));
      if (state.payer === p.id) state.payer = null;
      renderPeopleBar(true); afterChange();
    };
    chip.append(dot, nm, dr, rm);
    bar.append(chip);
  });
  const add = document.createElement('form'); add.className = 'add-person';
  const inp = document.createElement('input'); inp.type = 'text'; inp.placeholder = '이름'; inp.maxLength = 8;
  inp.setAttribute('aria-label', '추가할 사람 이름');
  const btn = document.createElement('button'); btn.type = 'submit'; btn.textContent = '사람 추가';
  add.onsubmit = e => {
    e.preventDefault();
    if (state.people.length >= 12) return;
    state.people.push(makePerson(inp.value.trim() || ('친구' + state.people.length), false));
    renderPeopleBar(true); afterChange();
    bar.querySelector('.add-person input').focus();
  };
  add.append(inp, btn);
  bar.append(add);
}

// [AI 생성] 캔버스 아래 안내 문구와 남은 메뉴 표시
function renderStep3Info() {
  const t = computeTotals();
  const left = document.getElementById('leftover');
  const btn = document.getElementById('splitRest');
  if (t.unassignedCount) {
    left.textContent = `아직 안 나눈 메뉴 ${t.unassignedCount}개 · ${won(t.unassigned)}`;
    btn.hidden = false;
  } else { left.textContent = ''; btn.hidden = true; }
  const hint = document.getElementById('hint3');
  const sel = selectedItem();
  hint.classList.toggle('warn', !!(hintNote && !hintNote.ok));
  if (hintNote && Date.now() < hintNote.until) hint.textContent = hintNote.msg;
  else if (sel) hint.innerHTML = `<b>${escapeHtml(sel.name || '이름 없는 메뉴')}</b> 선택됨 · 얼굴이나 아래 칸을 누르면 배정돼요. 다시 누르면 선택이 풀려요.`;
  else hint.innerHTML = '메뉴를 <b>사람 얼굴</b>이나 아래 <b>칸</b>으로 끌어다 놓으세요. 칸을 그냥 누르면 안 나눈 메뉴를 한꺼번에 나눠요. 같은 메뉴를 여러 명에게 놓으면 똑같이 나눠요. 영수증 쪽으로 다시 끌어오면 배정이 풀려요. 휴대폰에서는 메뉴를 누른 뒤 얼굴을 누르면 돼요.';
  document.getElementById('toStep4').disabled = !canGo(4);
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// ---------------- 4단계: 결과 카드 + 카톡 문구 ----------------

let cardG = null;

// [AI 생성] 결과 단계 그리기
function renderStep4() {
  const sel = document.getElementById('payerSel');
  sel.innerHTML = '<option value="">선택 안 함</option>' +
    state.people.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  sel.value = state.payer && personById(state.payer) ? state.payer : '';
  sel.onchange = () => { state.payer = sel.value || null; persist(); renderStep4(); };
  const t = computeTotals();
  drawResultCard(t);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (state.step === 4) drawResultCard(computeTotals()); });
  document.getElementById('kakaoText').value = kakaoText(t);
  document.getElementById('toast').textContent = '';
}

// [AI 생성] 카톡에 붙여넣을 문구
function kakaoText(t) {
  const d = new Date();
  const lines = [`[먹은만큼 정산] ${d.getMonth() + 1}월 ${d.getDate()}일`];
  state.receipts.forEach(r => lines.push(`${r.name} ${won(receiptSum(r))}`));
  lines.push(`총 ${won(t.grand)} (${state.people.length}명)`, '');
  const payer = personById(state.payer);
  state.people.forEach(p => {
    const mark = payer && payer.id === p.id ? ' (결제함)' : '';
    lines.push(`${p.name} ${won(t.per[p.id].amount)}${mark}`);
  });
  if (t.unassigned) lines.push('', `아직 안 나눈 메뉴 ${won(t.unassigned)}은 빠져 있어요.`);
  if (payer) lines.push('', `${payer.name}에게 보내 주세요.`);
  return lines.join('\n');
}

// [AI 생성] 결과 카드를 p5 그래픽으로 그려 이미지로 보여줌
function drawResultCard(t) {
  const W = 720, pad = 48, inner = W - pad * 2;
  const g0 = createGraphics(W, 10);
  g0.textFont(FONT_BODY); g0.textSize(16);
  const blocks = state.people.map(p => {
    const lines = wrapWords(g0, t.per[p.id].parts.join(' · ') || '먹은 메뉴 없음', inner - 64);
    return { p, lines };
  });
  g0.remove();
  const H = 24 + 64 + 36 + 32 + state.receipts.length * 30 + 28 + 40 +
    blocks.reduce((s, b) => s + 32 + b.lines.length * 24 + 26, 0) + 24 + (t.unassigned ? 28 : 0) + 64 + 24;
  if (cardG) cardG.remove();
  const g = createGraphics(W, H);
  g.pixelDensity(2);
  g.background('#e9ecef');
  // 종이
  const top = 24, bottom = H - 24;
  g.noStroke(); g.fill('#fffdf5');
  g.rect(24, top + 10, W - 48, bottom - top - 20);
  zigzag(g, 24, W - 24, top + 10, -1, '#fffdf5');
  zigzag(g, 24, W - 24, bottom - 10, 1, '#fffdf5');
  let y = top + 64;
  g.fill('#26241f'); g.textFont(FONT_DISPLAY); g.textSize(38); g.textAlign(LEFT, BASELINE);
  g.text('먹은만큼 정산', pad, y);
  const d = new Date();
  g.textFont(FONT_NUM); g.textSize(15); g.fill('#6b665b'); g.textAlign(RIGHT, BASELINE);
  g.text(`${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`, W - pad, y);
  y += 36;
  dashed(g, pad, W - pad, y); y += 32;
  g.textSize(16);
  state.receipts.forEach(r => {
    g.fill('#26241f'); g.textFont(FONT_BODY); g.textAlign(LEFT, BASELINE); g.text(r.name, pad, y);
    g.textFont(FONT_NUM); g.textAlign(RIGHT, BASELINE); g.text(won(receiptSum(r)), W - pad, y);
    y += 30;
  });
  g.textFont(FONT_BODY); g.textStyle(BOLD); g.textAlign(LEFT, BASELINE);
  g.text(`합계 · ${state.people.length}명`, pad, y + 4);
  g.textFont(FONT_NUM); g.textAlign(RIGHT, BASELINE); g.text(won(t.grand), W - pad, y + 4);
  g.textStyle(NORMAL);
  y += 28; dashed(g, pad, W - pad, y); y += 40;
  const payer = personById(state.payer);
  blocks.forEach(b => {
    drawFace(g, pad + 22, y - 6, 44, PALETTE[b.p.c], false, b.p.drink);
    g.fill('#26241f'); g.textFont(FONT_BODY); g.textStyle(BOLD); g.textSize(22); g.textAlign(LEFT, BASELINE);
    g.text(b.p.name, pad + 58, y + 2);
    if (payer && payer.id === b.p.id) {
      const nw = g.textWidth(b.p.name);
      g.textStyle(NORMAL); g.textSize(13); g.fill('#0d7f62');
      g.text('결제함', pad + 66 + nw, y);
    }
    g.textStyle(NORMAL);
    g.textFont(FONT_NUM); g.textSize(26); g.fill('#26241f'); g.textAlign(RIGHT, BASELINE);
    g.text(won(t.per[b.p.id].amount), W - pad, y + 4);
    g.textFont(FONT_BODY); g.textSize(16); g.fill('#6b665b'); g.textAlign(LEFT, BASELINE);
    let ly = y + 32;
    b.lines.forEach(line => { g.text(line, pad + 58, ly); ly += 24; });
    y = ly + 26;
  });
  dashed(g, pad, W - pad, y - 14); y += 24;
  g.textFont(FONT_BODY); g.textSize(17); g.fill('#26241f'); g.textAlign(LEFT, BASELINE);
  if (t.unassigned) { g.fill('#b5420f'); g.text(`아직 안 나눈 메뉴 ${won(t.unassigned)}은 빠져 있어요`, pad, y); y += 28; g.fill('#26241f'); }
  g.text(payer ? `${payer.name}에게 보내 주세요` : '각자 금액만큼 보내 주세요', pad, y);
  cardG = g;
  document.getElementById('cardImg').src = g.elt.toDataURL('image/png');
}

// [AI 생성] 글자를 폭에 맞춰 줄바꿈
function wrapWords(g, s, maxW) {
  const words = s.split(' ');
  const lines = []; let cur = '';
  words.forEach(w => {
    const next = cur ? cur + ' ' + w : w;
    if (g.textWidth(next) > maxW && cur) { lines.push(cur); cur = w; } else cur = next;
  });
  if (cur) lines.push(cur);
  return lines.slice(0, 6);
}

// [AI 생성] 점선
function dashed(g, x1, x2, y) {
  g.stroke('#c9c2b0'); g.strokeWeight(1.5);
  for (let x = x1; x < x2; x += 12) g.line(x, y, Math.min(x + 6, x2), y);
  g.noStroke();
}

// [AI 생성] 영수증 종이의 톱니 모양 가장자리 (dir: -1 위쪽, 1 아래쪽)
function zigzag(g, x1, x2, y, dir, col) {
  g.noStroke(); g.fill(col);
  g.beginShape();
  g.vertex(x1, y);
  const step = 14;
  for (let x = x1; x <= x2; x += step) {
    g.vertex(x + step / 2, y + dir * 9);
    g.vertex(Math.min(x + step, x2), y);
  }
  g.vertex(x2, y - dir * 2); g.vertex(x1, y - dir * 2);
  g.endShape(CLOSE);
}

// ============================================================
//  p5.js: 3단계 캔버스 (영수증 종이, 얼굴, 칸, 막대그래프)
// ============================================================

const FONT_BODY = 'IBM Plex Sans KR';
const FONT_NUM = 'IBM Plex Mono';
const FONT_DISPLAY = 'Do Hyeon';
let cnv, wrapEl;
let COL = {};             // 테마 색 (CSS 변수에서 읽음)
let LAY = null;           // 화면 배치
let dragging = null;      // { item, x0, y0, moved }
let selectedId = null;    // 눌러서 선택한 메뉴 id
let shownBars = {};       // 막대 애니메이션용 현재 길이
let pulse = {};           // 메뉴를 받은 사람 → 시각(ms)
let hoverTarget = null;
let reduceMotion = false;

// [AI 생성] CSS 색 토큰 읽기 (다크 모드 전환 시 다시 읽음)
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  ['bg', 'surface', 'ink', 'muted', 'line', 'paper', 'paper-ink', 'paper-line', 'accent', 'accent-soft', 'warn', 'warn-soft']
    .forEach(k => { COL[k] = cs.getPropertyValue('--' + k).trim() || '#888'; });
}

function selectedItem() {
  if (!selectedId) return null;
  for (const r of state.receipts) for (const it of r.items) if (it.id === selectedId) return it;
  return null;
}

// [AI 생성] p5 시작: 캔버스를 만들고 앱을 켬
function setup() {
  wrapEl = document.getElementById('canvasWrap');
  cnv = createCanvas(Math.max(320, wrapEl.clientWidth || 800), 560);
  cnv.parent(wrapEl);
  cnv.elt.setAttribute('aria-label', '영수증 메뉴를 사람에게 끌어다 놓는 화면');
  readColors();
  reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  bootApp();
}

// [AI 생성] 화면 배치 계산 (넓은 화면: 좌우 2단, 좁은 화면: 위아래)
function computeLayout() {
  const W = Math.max(300, wrapEl.clientWidth);
  const r = curReceipt();
  const n = r ? r.items.length : 0;
  const wide = W >= 720;
  const rw = wide ? Math.min(380, Math.floor(W * 0.42)) : W;
  const tabsH = 38, rowH = 38;
  const paperTop = tabsH + 8;
  const headH = 74, footH = 82;
  const paperH = headH + n * rowH + footH;
  const rec = { x: 0, w: rw, tabsH, paperTop, paperH, rowH, rowsTop: paperTop + headH };
  const rx = wide ? rw + 36 : 0;
  const ry = wide ? 4 : paperTop + paperH + 34;
  const rW = W - rx;
  const cellW = 100, cellH = 124;
  const cols = Math.max(2, Math.min(state.people.length, Math.floor((rW + 8) / (cellW + 8))));
  const gridW = cols * cellW + (cols - 1) * 8;
  const gx = rx + Math.max(0, (rW - gridW) / 2);
  const avatars = state.people.map((p, i) => ({
    id: p.id, x: gx + (i % cols) * (cellW + 8), y: ry + Math.floor(i / cols) * cellH, w: cellW, h: cellH - 6
  }));
  const rows = Math.ceil(state.people.length / cols);
  const zy = ry + rows * cellH + 8;
  const zw = (rW - 12) / 2;
  const zones = [
    { mode: 'all', x: rx, y: zy, w: zw, h: 60 },
    { mode: 'drinkers', x: rx + zw + 12, y: zy, w: zw, h: 60 }
  ];
  const by = zy + 60 + 30;
  const bars = { x: rx, y: by, w: rW, rowH: 30 };
  const H = Math.max(paperTop + paperH + 16, by + 34 + state.people.length * bars.rowH + 12);
  LAY = { W, wide, rec, avatars, zones, bars, H };
  if (Math.abs(width - W) > 1 || Math.abs(height - H) > 1) resizeCanvas(W, H);
}

// [AI 생성] 매 프레임 그리기
function draw() {
  if (!state || state.step !== 3) return;
  computeLayout();
  clear();
  const t = computeTotals();
  drawReceiptTabs();
  drawReceiptPaper();
  drawZones();
  drawAvatars(t);
  drawBars(t);
  if (dragging && dragging.moved) drawDragTicket(dragging.item);
  cursor(hoverRow() || hoverTarget ? (dragging ? 'grabbing' : 'pointer') : ARROW);
}

// [AI 생성] 1차·2차 영수증 탭
function drawReceiptTabs() {
  const rec = LAY.rec;
  let x = rec.x;
  textFont(FONT_BODY); textSize(14);
  LAY.tabs = [];
  state.receipts.forEach((r, i) => {
    const w = Math.min(textWidth(r.name) + 28, 160);
    const on = i === state.current;
    noStroke(); fill(on ? COL.paper : COL['accent-soft']);
    rect(x, 0, w, rec.tabsH + 10, 10, 10, 0, 0);
    fill(on ? COL['paper-ink'] : COL.ink);
    textAlign(CENTER, CENTER); textStyle(on ? BOLD : NORMAL);
    text(fitText(r.name, w - 16), x + w / 2, rec.tabsH / 2 + 2);
    textStyle(NORMAL);
    LAY.tabs.push({ i, x, y: 0, w, h: rec.tabsH });
    x += w + 6;
  });
}

// [AI 생성] 영수증 종이와 메뉴 줄
function drawReceiptPaper() {
  const rec = LAY.rec, r = curReceipt();
  if (!r) return;
  const x = rec.x, y = rec.paperTop, w = rec.w;
  noStroke(); fill(0, 0, 0, 18);
  rect(x + 3, y + 4, w, rec.paperH, 4);
  fill(COL.paper);
  rect(x, y, w, rec.paperH - 10, 4, 4, 0, 0);
  zigzag(window, x, x + w, y + rec.paperH - 10, 1, COL.paper);
  // 머리말
  fill(COL['paper-ink']); textFont(FONT_DISPLAY); textSize(24); textAlign(CENTER, BASELINE);
  text('영 수 증', x + w / 2, y + 34);
  textFont(FONT_BODY); textSize(13); fill('#6b665b');
  text(r.name + (photos[r.id] ? ' · 사진에서 읽음' : ''), x + w / 2, y + 54);
  dashed(window, x + 16, x + w - 16, y + 66);
  // 메뉴 줄
  const sel = selectedId;
  r.items.forEach((it, i) => {
    const ry = rec.rowsTop + i * rec.rowH;
    const isDrag = dragging && dragging.moved && dragging.item === it;
    const hover = !dragging && hoverRow() === it;
    if (it.id === sel) { noStroke(); fill(COL.accent); rect(x + 6, ry + 2, w - 12, rec.rowH - 4, 6); fill(COL.paper); rect(x + 8, ry + 4, w - 16, rec.rowH - 8, 5); }
    else if (hover) { noStroke(); fill(0, 0, 0, 12); rect(x + 6, ry + 2, w - 12, rec.rowH - 4, 6); }
    push();
    if (isDrag) drawingContext.globalAlpha = 0.35;
    drawAssignMark(it, x + 22, ry + rec.rowH / 2);
    let nx = x + 40;
    if (it.drink) { drawMug(window, nx + 6, ry + rec.rowH / 2, 0.8, '#6b665b'); nx += 18; }
    const priceStr = won(Number(it.price) || 0);
    textFont(FONT_NUM); textSize(14);
    const pw = textWidth(priceStr);
    textFont(FONT_BODY); textSize(15); fill(COL['paper-ink']); textAlign(LEFT, CENTER);
    const nm = fitText(it.name || '이름 없는 메뉴', w - (nx - x) - pw - 30);
    text(nm, nx, ry + rec.rowH / 2);
    const nmw = textWidth(nm);
    stroke(COL['paper-line']); strokeWeight(1.2);
    for (let dx = nx + nmw + 8; dx < x + w - 16 - pw - 8; dx += 6) point(dx, ry + rec.rowH / 2 + 5);
    noStroke(); textFont(FONT_NUM); textSize(14); textAlign(RIGHT, CENTER); fill(COL['paper-ink']);
    text(priceStr, x + w - 16, ry + rec.rowH / 2);
    pop();
  });
  // 합계
  const fy = rec.rowsTop + r.items.length * rec.rowH + 8;
  dashed(window, x + 16, x + w - 16, fy);
  textFont(FONT_BODY); textSize(15); textStyle(BOLD); fill(COL['paper-ink']); textAlign(LEFT, BASELINE);
  text('합계', x + 16, fy + 28);
  textFont(FONT_NUM); textAlign(RIGHT, BASELINE); text(won(receiptSum(r)), x + w - 16, fy + 28);
  textStyle(NORMAL);
  const left = r.items.filter(it => !shareOf(it).length);
  textFont(FONT_BODY); textSize(13); textAlign(LEFT, BASELINE);
  if (left.length) { fill('#b5420f'); text(`안 나눈 메뉴 ${left.length}개 · ${won(left.reduce((s, it) => s + (Number(it.price) || 0), 0))}`, x + 16, fy + 52); }
  else { fill('#0d7f62'); text('이 영수증은 다 나눴어요', x + 16, fy + 52); }
}

// [AI 생성] 메뉴 줄 왼쪽의 배정 표시 (사람 색 점 / '모두' / '술' / 빈 동그라미)
function drawAssignMark(it, cx, cy) {
  const ids = shareOf(it);
  if (it.mode === 'all' || it.mode === 'drinkers') {
    const label = it.mode === 'all' ? '모두' : '술';
    noStroke(); fill(it.mode === 'all' ? '#0d7f62' : '#6a4c93');
    rect(cx - 15, cy - 9, 30, 18, 9);
    fill('#ffffff'); textFont(FONT_BODY); textSize(11); textAlign(CENTER, CENTER); text(label, cx, cy);
    return;
  }
  if (!ids.length) {
    noFill(); stroke('#b5420f'); strokeWeight(1.6); circle(cx, cy, 13); noStroke();
    return;
  }
  const shown = ids.slice(0, 3);
  shown.forEach((id, k) => {
    const p = personById(id);
    stroke(COL.paper); strokeWeight(2); fill(PALETTE[p.c]);
    circle(cx - (shown.length - 1) * 5 + k * 10, cy, 14);
  });
  noStroke();
  if (ids.length > 3) { fill('#6b665b'); textFont(FONT_NUM); textSize(10); textAlign(LEFT, CENTER); text('+' + (ids.length - 3), cx + 12, cy); }
}

// [AI 생성] '모두 같이' / '술 마신 사람끼리' 칸
function drawZones() {
  const drinkers = state.people.filter(p => p.drink).length;
  LAY.zones.forEach(z => {
    const hot = hoverTarget && hoverTarget.zone === z.mode;
    const label = z.mode === 'all' ? '모두 같이 나누기' : '술 마신 사람끼리';
    const sub = z.mode === 'all' ? `${state.people.length}명이 똑같이 · 누르면 남은 메뉴 전부`
      : (drinkers ? `${drinkers}명이 똑같이 · 누르면 남은 술·음료` : "먼저 '술 마심'을 표시하세요");
    stroke(hot ? COL.accent : COL.line); strokeWeight(hot ? 2.5 : 1.5);
    drawingContext.setLineDash(hot ? [] : [6, 5]);
    fill(hot ? COL['accent-soft'] : COL.surface);
    rect(z.x, z.y, z.w, z.h, 12);
    drawingContext.setLineDash([]);
    noStroke(); fill(COL.ink); textFont(FONT_BODY); textSize(15); textStyle(BOLD); textAlign(CENTER, BASELINE);
    text(fitText(label, z.w - 16), z.x + z.w / 2, z.y + 27);
    textStyle(NORMAL); textSize(12); fill(z.mode === 'drinkers' && !drinkers ? COL.warn : COL.muted);
    text(fitText(sub, z.w - 16), z.x + z.w / 2, z.y + 46);
  });
}

// [AI 생성] 사람 얼굴 (메뉴를 끌고 오면 입을 벌림)
function drawAvatars(t) {
  LAY.avatars.forEach(a => {
    const p = personById(a.id);
    const hot = hoverTarget && hoverTarget.pid === a.id;
    const since = pulse[a.id] ? millis() - pulse[a.id] : 9999;
    const bump = reduceMotion ? 0 : (since < 400 ? Math.sin((since / 400) * Math.PI) * 6 : 0);
    const cx = a.x + a.w / 2, cy = a.y + 40;
    if (hot) { noStroke(); fill(COL['accent-soft']); rect(a.x, a.y, a.w, a.h, 14); }
    drawFace(window, cx, cy, 60 + bump, PALETTE[p.c], hot, p.drink);
    noStroke(); fill(COL.ink); textFont(FONT_BODY); textStyle(BOLD); textSize(14); textAlign(CENTER, BASELINE);
    text(fitText(p.name, a.w - 8), cx, a.y + 92);
    textStyle(NORMAL); textFont(FONT_NUM); textSize(12); fill(COL.muted);
    text(won(t.per[p.id].amount), cx, a.y + 110);
  });
}

// [AI 생성] 얼굴 그리기 (g: 캔버스나 그래픽, open: 입 벌림, drink: 술잔 표시)
function drawFace(g, cx, cy, d, col, open, drink) {
  g.noStroke(); g.fill(col); g.circle(cx, cy, d);
  g.fill(255, 255, 255, 60); g.circle(cx - d * 0.18, cy - d * 0.2, d * 0.28);
  g.fill('#1f1d1a');
  g.circle(cx - d * 0.17, cy - d * 0.06, d * 0.1);
  g.circle(cx + d * 0.17, cy - d * 0.06, d * 0.1);
  if (open) { g.fill('#5a1f1f'); g.ellipse(cx, cy + d * 0.18, d * 0.26, d * 0.22); }
  else { g.noFill(); g.stroke('#1f1d1a'); g.strokeWeight(Math.max(1.5, d * 0.045)); g.arc(cx, cy + d * 0.08, d * 0.32, d * 0.24, 0.15 * Math.PI, 0.85 * Math.PI); g.noStroke(); }
  g.fill(255, 120, 120, 70);
  g.circle(cx - d * 0.3, cy + d * 0.1, d * 0.14);
  g.circle(cx + d * 0.3, cy + d * 0.1, d * 0.14);
  if (drink) {
    g.fill('#ffffff'); g.circle(cx + d * 0.38, cy + d * 0.34, d * 0.36);
    drawMug(g, cx + d * 0.38, cy + d * 0.35, d / 64, '#b07d12');
  }
}

// [AI 생성] 작은 맥주잔 아이콘
function drawMug(g, cx, cy, s, col) {
  g.noFill(); g.stroke(col); g.strokeWeight(1.6 * s);
  g.rect(cx - 5 * s, cy - 5 * s, 8 * s, 11 * s, 1.5 * s);
  g.arc(cx + 3 * s, cy + 0.5 * s, 7 * s, 6 * s, -Math.PI / 2, Math.PI / 2);
  g.noStroke(); g.fill(col); g.rect(cx - 5 * s, cy - 7 * s, 8 * s, 3 * s, 1.5 * s);
}

// [AI 생성] 사람별 금액 막대그래프 (배정할 때마다 늘어남)
function drawBars(t) {
  const b = LAY.bars;
  noStroke(); fill(COL.ink); textFont(FONT_BODY); textStyle(BOLD); textSize(15); textAlign(LEFT, BASELINE);
  text('사람별 금액', b.x, b.y);
  textStyle(NORMAL); textSize(13); fill(COL.muted); textAlign(RIGHT, BASELINE);
  text(`나눈 금액 ${won(t.assigned)} / ${won(t.grand)}`, b.x + b.w, b.y);
  const max = Math.max(1, ...state.people.map(p => t.per[p.id].amount));
  const nameW = 64, amtW = 92;
  const trackW = Math.max(40, b.w - nameW - amtW);
  state.people.forEach((p, i) => {
    const y = b.y + 18 + i * b.rowH;
    const target = t.per[p.id].amount;
    const cur = shownBars[p.id] == null ? target : shownBars[p.id];
    const next = reduceMotion ? target : cur + (target - cur) * 0.18;
    shownBars[p.id] = Math.abs(next - target) < 1 ? target : next;
    fill(COL.ink); textFont(FONT_BODY); textSize(13); textAlign(LEFT, CENTER);
    text(fitText(p.name, nameW - 8), b.x, y + 10);
    fill(COL.line); rect(b.x + nameW, y + 3, trackW, 14, 7);
    fill(PALETTE[p.c]); rect(b.x + nameW, y + 3, trackW * (shownBars[p.id] / max), 14, 7);
    fill(COL.ink); textFont(FONT_NUM); textSize(13); textAlign(RIGHT, CENTER);
    text(won(shownBars[p.id]), b.x + b.w, y + 10);
  });
}

// [AI 생성] 끌고 다니는 메뉴 표
function drawDragTicket(it) {
  const label = (it.name || '메뉴') + '  ' + won(Number(it.price) || 0);
  textFont(FONT_BODY); textSize(14);
  const w = Math.min(textWidth(label) + 28, 260), h = 34;
  const x = mouseX - w / 2, y = mouseY - h - 6;
  noStroke(); fill(0, 0, 0, 40); rect(x + 2, y + 4, w, h, 8);
  fill(COL.paper); stroke(COL.accent); strokeWeight(2); rect(x, y, w, h, 8);
  noStroke(); fill(COL['paper-ink']); textAlign(CENTER, CENTER);
  text(fitText(label, w - 16), x + w / 2, y + h / 2);
}

// [AI 생성] 글자가 길면 … 로 줄임
function fitText(s, maxW) {
  s = String(s);
  if (textWidth(s) <= maxW) return s;
  while (s.length > 1 && textWidth(s + '…') > maxW) s = s.slice(0, -1);
  return s + '…';
}

// ---------------- 캔버스 안 위치 찾기 ----------------

function rowAt(x, y) {
  const rec = LAY && LAY.rec, r = curReceipt();
  if (!rec || !r || x < rec.x || x > rec.x + rec.w) return null;
  const i = Math.floor((y - rec.rowsTop) / rec.rowH);
  return i >= 0 && i < r.items.length ? r.items[i] : null;
}
function avatarAt(x, y) {
  const a = LAY && LAY.avatars.find(a => x >= a.x && x <= a.x + a.w && y >= a.y && y <= a.y + a.h);
  return a ? a.id : null;
}
function zoneAt(x, y) {
  const z = LAY && LAY.zones.find(z => x >= z.x && x <= z.x + z.w && y >= z.y && y <= z.y + z.h);
  return z ? z.mode : null;
}
function tabAt(x, y) {
  const t = LAY && LAY.tabs && LAY.tabs.find(t => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h);
  return t ? t.i : null;
}
function inReceipt(x, y) {
  const rec = LAY && LAY.rec;
  return rec && x >= rec.x && x <= rec.x + rec.w && y >= rec.paperTop && y <= rec.paperTop + rec.paperH;
}
function hoverRow() { return LAY ? rowAt(mouseX, mouseY) : null; }

// ---------------- 마우스·터치 ----------------

// [AI 생성] 누르기: 탭 전환, 메뉴 잡기, 선택한 메뉴를 사람/칸에 배정
function pressAt(x, y) {
  const tab = tabAt(x, y);
  if (tab != null) { state.current = tab; selectedId = null; renderStep3Info(); persist(); return true; }
  const it = rowAt(x, y);
  if (it) { dragging = { item: it, x0: x, y0: y, moved: false }; return true; }
  const sel = selectedItem();
  const pid = avatarAt(x, y);
  if (pid && sel) { togglePerson(sel, pid); return true; }
  const z = zoneAt(x, y);
  if (z && sel) { if (setGroup(sel, z)) { selectedId = null; renderStep3Info(); } return true; }
  if (z) { groupRest(z); return true; }
  return false;
}

// [AI 생성] 끌기: 어디 위에 있는지 표시
function moveAt(x, y) {
  if (dragging && !dragging.moved && Math.hypot(x - dragging.x0, y - dragging.y0) > 6) dragging.moved = true;
  if (dragging && dragging.moved) {
    const pid = avatarAt(x, y), z = zoneAt(x, y);
    hoverTarget = pid ? { pid } : z ? { zone: z } : null;
  } else {
    const pid = avatarAt(x, y), z = zoneAt(x, y);
    hoverTarget = selectedItem() && (pid || z) ? (pid ? { pid } : { zone: z }) : null;
  }
}

// [AI 생성] 놓기: 사람이면 추가/빼기, 칸이면 묶어서 나누기, 영수증이면 배정 풀기, 그냥 누른 것이면 선택
function releaseAt(x, y) {
  if (!dragging) return;
  const it = dragging.item;
  if (!dragging.moved) {
    selectedId = selectedId === it.id ? null : it.id;
    renderStep3Info();
  } else {
    const pid = avatarAt(x, y), z = zoneAt(x, y);
    if (pid) togglePerson(it, pid);
    else if (z) setGroup(it, z);
    else if (inReceipt(x, y)) clearItem(it);
    selectedId = null;
    renderStep3Info();
  }
  dragging = null; hoverTarget = null;
}

function onCanvas(e) { return e && cnv && e.target === cnv.elt; }

function mousePressed(e) { if (state && state.step === 3 && onCanvas(e)) pressAt(mouseX, mouseY); }
function mouseDragged() { if (state && state.step === 3) moveAt(mouseX, mouseY); }
function mouseMoved() {
  if (!(state && state.step === 3)) return;
  moveAt(mouseX, mouseY);
  if (cnv) cnv.elt.style.cursor = (zoneAt(mouseX, mouseY) || rowAt(mouseX, mouseY) || tabAt(mouseX, mouseY) || (selectedItem() && avatarAt(mouseX, mouseY))) ? 'pointer' : 'default';
}
function mouseReleased() { if (state && state.step === 3) releaseAt(mouseX, mouseY); }
function touchStarted(e) {
  if (!(state && state.step === 3 && onCanvas(e))) return;
  if (pressAt(mouseX, mouseY)) return false;
}
function touchMoved() { if (dragging) { moveAt(mouseX, mouseY); return false; } }
function touchEnded() { if (dragging) { releaseAt(mouseX, mouseY); return false; } }
function windowResized() { if (state && state.step === 3) computeLayout(); }

// ============================================================
//  시작
// ============================================================

// [AI 생성] 버튼 연결과 첫 화면
function bootApp() {
  // 저장된 정산이 있으면 불러오되(예전 예시 데이터는 버림), 화면은 항상 1단계 '사진 올리기'부터
  state = restore();
  if (!state || state.example) blankState();
  state.step = 1;
  state.people.forEach(p => { if (p.c == null) p.c = 0; });
  document.querySelectorAll('.steps button').forEach(b => { b.onclick = () => goStep(Number(b.dataset.step)); });
  document.getElementById('manualBtn').onclick = () => {
    const r = { id: newId('r'), name: (state.receipts.length + 1) + '차', total: null, items: [makeItem('', 0)] };
    state.receipts.push(r); state.current = state.receipts.length - 1; goStep(2);
  };
  const fileInput = document.getElementById('fileInput');
  fileInput.onchange = () => { handleFiles(fileInput.files); fileInput.value = ''; };
  const dz = document.getElementById('dropZone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('over'));
  dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); handleFiles(e.dataTransfer.files); });
  document.getElementById('pasteBtn').onclick = addPastedReceipt;
  document.getElementById('toStep2').onclick = () => goStep(2);
  document.getElementById('back1').onclick = () => goStep(1);
  document.getElementById('toStep3').onclick = () => goStep(3);
  document.getElementById('toStep4').onclick = () => goStep(4);
  document.getElementById('back3').onclick = () => goStep(3);
  document.getElementById('addItem').onclick = () => {
    const r = curReceipt(); if (!r) return;
    const it = makeItem('', 0); r.items.push(it); persist();
    const row = itemRow(r, it); document.getElementById('itemList').append(row); row.querySelector('input').focus();
  };
  document.getElementById('deleteReceipt').onclick = () => {
    const r = curReceipt(); if (!r) return;
    state.receipts = state.receipts.filter(x => x !== r);
    delete photos[r.id];
    state.current = Math.max(0, state.current - 1);
    persist();
    if (state.receipts.length) renderStep2(); else goStep(1);
  };
  document.getElementById('splitRest').onclick = () => {
    state.receipts.forEach(r => r.items.forEach(it => { if (!shareOf(it).length) { it.mode = 'all'; it.people = []; } }));
    state.people.forEach(p => { pulse[p.id] = millis(); });
    afterChange();
  };
  // 파일 이름이 'meogeun-jeongsan_날짜.png'로 확실히 붙도록 직접 내려받기 링크를 만듦 (한글 파일 이름은 일부 브라우저에서 'download'로 바뀜)
  document.getElementById('saveCard').onclick = () => {
    if (!cardG) return;
    const d = new Date(), pad = n => String(n).padStart(2, '0');
    const name = `meogeun-jeongsan_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.png`;
    cardG.elt.toBlob(blob => {
      if (!blob) { saveCanvas(cardG, '먹은만큼정산', 'png'); return; }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }, 'image/png');
  };
  document.getElementById('copyText').onclick = () => {
    const ta = document.getElementById('kakaoText');
    const toast = document.getElementById('toast');
    const done = () => { toast.textContent = '복사했어요. 카톡에 붙여넣으세요.'; };
    const fallback = () => { ta.focus(); ta.select(); try { document.execCommand('copy'); done(); } catch (e) { toast.textContent = '문구를 선택해 두었어요. 직접 복사하세요.'; } };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(ta.value).then(done, fallback);
    else fallback();
  };
  const conf = document.getElementById('restartConfirm');
  document.getElementById('restart').onclick = () => { conf.hidden = false; };
  document.getElementById('restartNo').onclick = () => { conf.hidden = true; };
  document.getElementById('restartYes').onclick = () => { conf.hidden = true; blankState(); selectedId = null; shownBars = {}; goStep(1); };
  const fsBtn = document.getElementById('fsBtn');
  fsBtn.onclick = () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) { if (el.requestFullscreen) el.requestFullscreen().catch(() => { fsBtn.textContent = '전체화면 안 됨'; }); }
    else document.exitFullscreen().catch(() => {});
  };
  document.addEventListener('fullscreenchange', () => { fsBtn.textContent = document.fullscreenElement ? '전체화면 끝내기' : '전체화면'; });
  if (state.step === 3 && !canGo(3)) state.step = 1;
  goStep(state.step || 1);
}
