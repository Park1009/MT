// [AI 생성] 영수증 글자 인식 결과(텍스트)에서 메뉴·가격·합계를 뽑는 함수
// 인식이 조금 틀려도 버티도록: 숫자 속 O→0 같은 오인식 고치기, 줄 끝 잡문자 지우기,
// '107 000'처럼 끊긴 금액 잇기, 이름과 가격이 두 줄로 나뉜 경우 합치기
const DRINK = /(소주|맥주|생맥|하이볼|막걸리|와인|사케|위스키|칵테일|콜라|사이다|음료|커피|아메리카노|라떼|에이드|주스|참이슬|처음처럼|진로|카스|테라|켈리|클라우드|하이트|소맥|청하|맥콜|환타|스프라이트|탄산|토닉|보드카|데킬라|뱅쇼|beer|soju|cola|coke|wine|highball)/i;
// 세금·공급가 줄 (합계보다 먼저 걸러야 '공급가액'을 합계로 착각하지 않음)
const TAX = /(공\s*급|부\s*가|과\s*세|면\s*세|가\s*[액맥]|vat)/i;
// 합계 줄. 인식이 흔히 틀리는 모양(합겨, 금맥, 받율 등)도 받아 줌
const TOTAL = /(합\s*[계겨게]|총\s*[액앧]|총\s*금|결\s*제\s*[금급액맥]|카\s*드\s*결\s*제|받\s*[을율울은]|청\s*구|주\s*문\s*금|판\s*매\s*금|금\s*[맥백]$|금\s*[맥백]\s)/;
const PAY_TOTAL = /(결\s*제|받\s*[을율울은]|청\s*구)/;
const SKIP = /(카\s*드|승\s*인|사\s*업\s*자|대\s*표|전\s*화|tel|주\s*소|일\s*시|날\s*짜|테\s*이\s*블|영\s*수\s*증|거\s*스\s*름|현\s*금|포\s*인\s*트|할\s*부|가\s*맹|단\s*말|매\s*출|번\s*호|no\.|pos|단\s*가|수\s*량|품\s*명|메\s*뉴|소\s*[계게겨]|봉\s*사\s*료|할\s*인|잔\s*돈|\d{2,4}[-./]\d{1,2}[-./]\d{1,2}|\d{1,2}:\d{2})/i;
const toNum = s => parseInt(String(s).replace(/[^\d]/g, ''), 10);
// 숫자처럼 보이는 낱말이면 O→0, l·I·|→1, S→5, B→8 로 고침
const fixToken = t => {
  // '₩5,000', 'W\\3600', '\\5,000' 처럼 원 표시가 붙은 금액
  let core = t.replace(/원$/, '').replace(/^[W₩\\]+(?=\d)/, '');
  // '6,00', '1,20' 처럼 끝자리 0이 빠진 금액 (메뉴 가격은 거의 100원 단위)
  if (/^\d{1,3}[,.]\d0$/.test(core)) return core.replace('.', ',') + '0';
  if (!/^[\dOoDlI|SB,.]+$/.test(core)) return t;
  if (/^\d{1,3}([,.][\dOoD]{3})+$/.test(core)) return core.replace(/[OoD]/g, '0');
  const digits = (core.match(/\d/g) || []).length;
  if (digits < Math.ceil(core.replace(/[,.]/g, '').length * 0.5)) return t;
  return core.replace(/[OoD]/g, '0').replace(/[lI|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
};
const isNum = t => /^[\d,.xX×*@]+$/.test(t) && /\d/.test(t);
// [AI 생성] 메뉴 이름 다듬기
const cleanName = s => {
  let t = s.normalize('NFKC')
    .replace(/^[\d\s.)*\-·•|:;'"`~_]+/, '')
    .replace(/[|:;'"`~_*§¦\[\]{}<>]+/g, ' ')
    .replace(/\s+/g, ' ').trim()
    .split(' ')
    // 가격이 깨져서 이름에 붙은 조각(g,000 / L000 / 3,O00) 지우기
    .filter(w => !/^[A-Za-z]?[,.]?\d{0,3}[,.]?[0Oo]{3}[!]?$/.test(w));
  // '된 장 찌개'처럼 한 글자씩 띄어 읽힌 글자들은 붙임 (한 글자 낱말이 두 개 이상 이어질 때)
  const merged = [];
  for (let i = 0; i < t.length; i++) {
    if (/^[가-힣]$/.test(t[i]) && /^[가-힣]$/.test(t[i + 1] || '')) {
      let run = '';
      while (i < t.length && /^[가-힣]$/.test(t[i])) run += t[i++];
      if (i < t.length && /^[가-힣]/.test(t[i])) run += t[i]; else i--;
      merged.push(run);
    } else merged.push(t[i]);
  }
  t = merged;
  // 맨 앞의 한 글자 조각(옆 칸 글자가 섞여 들어온 것) 지우기
  if (t.length > 1 && t[0].length === 1 && t.slice(1).join('').length >= 2) t = t.slice(1);
  // 맨 뒤의 영문 한 글자 잡티('꼬마김밥A j') 지우기
  // 한글 메뉴 이름 뒤에 붙은 영문 한두 글자('하이볼 WA')는 접힌 자국·잡티가 글자로 읽힌 것
  while (t.length > 1 && /^[A-Za-z]{1,2}$/.test(t[t.length - 1]) && /[가-힣]{2,}/.test(t.slice(0, -1).join(''))) t = t.slice(0, -1);
  if (t.length > 1 && /^[A-Za-z]$/.test(t[t.length - 1])) t = t.slice(0, -1);
  return t.join(' ').replace(/[.\s-]+$/, '').trim();
};


function parseReceipt(raw) {
  const items = [];
  let total = null, payTotal = null, pendingName = null, orphan = null, seenTotal = false, subTotal = null, bare = null;
  const discounts = new Set();

  const lines = String(raw)
    .replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[，]/g, ',')
    .split(/\r?\n/);

  for (let line of lines) {
    // 줄 앞뒤의 잡문자(|, §, ] 등) 지우기
    line = line.replace(/^[\s|§¦!ㅣ\[\]{}<>«»"'`~_=+\\/#$%^&:;,.-]+/, '')
               .replace(/[\s|§¦!ㅣ\[\]{}<>«»"'`~_=+\\/#$%^&:;,-]+$/, '')
               .replace(/\(\s*비?\s*[과면]\s*세\s*\)/g, ' ')   // 메뉴 이름 옆 '(과세)', '(면세)' 표시는 세금 줄이 아님
               .replace(/\s+/g, ' ').trim();
    if (line.length < 2) continue;
    let tokens = line.split(' ').map(fixToken).filter(t => !/^[^\d가-힣A-Za-z]+$/.test(t));
    // '6,000 1개 6,000'의 '1개'·'개'는 수량
    for (let i = 1; i < tokens.length; i++) {
      const m = tokens[i].match(/^(\d{0,2})(개|잔|병|EA|ea)$/);
      if (m && isNum(tokens[i - 1])) tokens[i] = m[1] || '1';
    }
    // 금액 뒤에 붙은 한 글자 잡티('9,500 i') 지우기
    while (tokens.length > 1 && /^[A-Za-z]$/.test(tokens[tokens.length - 1]) && /\d/.test(tokens[tokens.length - 2])) tokens.pop();
    // '30 ,600' 처럼 쉼표가 뒤 조각에 붙은 경우 잇기
    for (let i = 0; i < tokens.length - 1; i++) {
      if (/^\d{1,3}$/.test(tokens[i]) && /^[,.]\d{3}$/.test(tokens[i + 1])) tokens.splice(i, 2, tokens[i] + ',' + tokens[i + 1].slice(1));
    }
    // '107 000', '16, 000' 처럼 끊긴 금액 잇기
    for (let i = 0; i < tokens.length - 1; i++) {
      // 왼쪽이 한 자리 수면 수량일 수 있어서('공기밥 1,000 2 200') 쉼표가 있을 때만 이음
      if (/^\d{1,3}[,.]?$/.test(tokens[i]) && /^\d{3}$/.test(tokens[i + 1]) &&
          (/[,.]$/.test(tokens[i]) || (i + 1 === tokens.length - 1 && /^\d{2,3}$/.test(tokens[i])))) {
        tokens.splice(i, 2, tokens[i].replace(/[,.]$/, '') + ',' + tokens[i + 1]);
      }
    }
    const text = tokens.join(' ');
    const nums = text.match(/\d{1,3}(?:[,.]\d{3})+|\d{3,7}/g);

    // 할인 줄(-780 등): 금액만 기억해 두고 나중에 합계와 맞춰 '할인' 줄로 넣음
    if (/할\s*인/.test(text) && /-\s*\d/.test(text)) {
      if (nums) discounts.add(toNum(nums[nums.length - 1]));
      pendingName = null;
      continue;
    }
    if (TAX.test(text)) { pendingName = null; continue; }
    if (TOTAL.test(text)) {
      seenTotal = true;
      if (nums) {
        const v = toNum(nums[nums.length - 1]);
        // 끝자리가 0이 아니면 숫자가 깨진 것(100,009)이라 쓰지 않음
        if (v >= 100 && v % 10 === 0) { if (PAY_TOTAL.test(text)) payTotal = v; else total = v; }
      }
      pendingName = null;
      continue;
    }
    if (SKIP.test(text)) {
      // 소계는 합계를 못 읽었을 때 대신 씀
      if (/소\s*[계게겨]/.test(text) && nums) { const v = toNum(nums[nums.length - 1]); if (v >= 100 && v % 10 === 0) subTotal = v; }
      pendingName = null;
      continue;
    }

    // 줄 끝쪽 숫자 묶음(단가·수량·금액)을 떼어 내고 앞부분을 메뉴 이름으로
    const tail = [];
    while (tokens.length && isNum(tokens[tokens.length - 1])) tail.unshift(tokens.pop());
    // 8자리 넘는 숫자는 상품 바코드라 금액 계산에서 뺌
    // 쉼표 있는 금액이 같이 있으면 7자리 이상 쉼표 없는 숫자도 상품 코드로 봄
    const hasComma = tail.some(t => /\d,\d{3}/.test(t));
    for (let i = tail.length - 1; i >= 0; i--) if (/^\d{8,}$/.test(tail[i]) || (hasComma && /^\d{7,}$/.test(tail[i]))) tail.splice(i, 1);
    let name = cleanName(tokens.join(' '));
    if (!tail.length) {
      // 숫자가 없는 줄: 바로 앞 줄에 이름 없는 가격만 있었으면 그 이름으로 씀
      if (orphan && /[가-힣]{2,}/.test(name) && !seenTotal) {
        name = fixMenuName(name);
        items.push({ name: orphan.qty > 1 ? `${name} ×${orphan.qty}` : name, price: orphan.amount, drink: DRINK.test(name) });
        orphan = null; pendingName = null;
        continue;
      }
      // 아니면 다음 줄에 가격만 있을 수 있어서 이름을 기억해 둠
      pendingName = /[가-힣]{2,}/.test(name) ? name : null;
      continue;
    }
    orphan = null;
    // 이름이 없거나 'SD'처럼 깨진 짧은 영문이면 바로 앞 줄의 한글 이름을 씀
    const noName = !/[가-힣A-Za-z]/.test(name);
    // 이름 자리에 상품 코드('DY1025001')만 있으면 바로 앞 줄의 한글 이름을 씀
    const codeOnly = !/[가-힣]/.test(name) && /^[A-Za-z]{0,4}[\d)]{5,}[A-Za-z\d)]*$/.test(name.replace(/\s/g, ''));
    if (pendingName && (noName || codeOnly || (!/[가-힣]/.test(name) && name.replace(/\s/g, '').length <= 3))) name = pendingName;
    const prevName = pendingName;
    pendingName = null;
    let amount = toNum(tail[tail.length - 1]);
    // 수량: 금액 앞의 작은 정수. 단가 × 수량 = 금액이 맞는 쪽을 우선
    let qty = 1, unit = null;
    const smalls = tail.slice(0, -1).filter(t => /^\d{1,2}$/.test(t) && +t > 0).map(Number);
    const units = tail.slice(0, -1).filter(t => !/^\d{1,2}$/.test(t)).map(toNum).filter(v => v >= 100 && v % 10 === 0);
    if (smalls.length) {
      const hit = smalls.find(q => units.some(u => u * q === amount));
      qty = hit || smalls[smalls.length - 1];
    }
    if (units.length) unit = units.find(u => u * qty === amount) || units[0];
    // 금액이 깨져서 자릿수가 빠진 경우(2.00 → 200): 단가 × 수량으로 바로잡음
    if (unit && unit * qty !== amount) {
      const exp = unit * qty;
      if (amount < unit || amount * 10 === exp || amount * 100 === exp || !(amount % 10 === 0)) amount = exp;
    }
    // 금액이 이상한 줄: 이름만 맞으면 다음 줄 가격의 이름일 수 있어서 기억해 둠 ('고추장떡볶이 00')
    if (!(amount >= 100 && amount <= 5000000) || amount % 10 !== 0) {
      pendingName = /[가-힣]{2,}/.test(name) ? name : prevName;
      continue;
    }
    if (!/[가-힣A-Za-z]/.test(name)) { if (!seenTotal) orphan = { amount, qty }; bare = { amount, at: items.length }; continue; }
    // 합계 줄을 지난 뒤의 금액 줄은 결제·포인트 정보라 메뉴로 넣지 않음
    if (seenTotal && items.length) continue;
    if (name.length > 24) name = name.slice(0, 24);
    // 합계 줄이 '가 계'처럼 깨져 읽힌 경우 (두세 글자이고 '계'로 끝남)
    if (/^[가-힣\s,.]{1,4}[계겨게]$/.test(name.replace(/\s/g, '')) && name.replace(/\s/g, '').length <= 3) { total = total || amount; seenTotal = true; continue; }
    name = fixMenuName(name);
    items.push({ name: qty > 1 ? `${name} ×${qty}` : name, price: amount, drink: DRINK.test(name) });
  }
  // '합계' 글자를 못 읽고 금액만 남은 줄이 앞 메뉴들의 합과 같으면 그게 합계
  if (total == null && payTotal == null && subTotal == null && bare && bare.at >= 2 &&
      items.slice(0, bare.at).reduce((a, x) => a + x.price, 0) === bare.amount) total = bare.amount;
  let finalTotal = payTotal != null ? payTotal : (total != null ? total : subTotal);
  if (total == null) total = subTotal;
  // 합계 끝자리가 빠져 읽힌 경우(36,000 → 3600): 메뉴 누적합이 합계의 10배·100배면 누적합을 합계로
  if (finalTotal) {
    let sum = 0;
    for (const it of items) {
      sum += it.price;
      if (sum === finalTotal) break;
      if (sum === finalTotal * 10 || sum === finalTotal * 100) { if (payTotal != null) payTotal = sum; else total = sum; finalTotal = sum; break; }
    }
  }
  // 메뉴 금액을 차례로 더하다가 합계와 딱 맞으면, 그 뒤 줄들은 소계·합계·결제 줄이 깨져 읽힌 것이라 버림
  // 딱 맞는 곳이 없으면, 합계와 같은 금액의 줄(결제 수단 줄 등)만 버림
  // 메뉴 하나의 끝자리 0이 빠져 읽힌 경우(100,00): 그 메뉴만 10배 하면 합계와 딱 맞을 때 고침
  if (finalTotal) {
    const s0 = items.reduce((a, x) => a + x.price, 0);
    if (s0 !== finalTotal) {
      const fix = items.filter(x => s0 + x.price * 9 === finalTotal);
      if (fix.length === 1) fix[0].price *= 10;
    }
  }
  // 할인 전 합계(total)와 맞는 곳도 찾아봄 (결제액 = 합계 − 할인)
  let kept = items;
  const cutAt = t => { let sum = 0; for (let i = 0; i < items.length; i++) { sum += items[i].price; if (sum === t) return i; } return -1; };
  if (finalTotal) {
    let cut = cutAt(finalTotal);
    if (cut < 0 && total && total !== finalTotal) cut = cutAt(total);
    if (cut >= 0) kept = items.slice(0, cut + 1);
    else if (items.length > 1) kept = items.filter(x => x.price !== finalTotal);
    // 할인: 메뉴 합 − 결제액이 영수증의 할인 금액과 맞으면 '할인' 줄을 음수로 넣음 (사람들이 같이 나누면 됨)
    const s = kept.reduce((a, x) => a + x.price, 0), d = s - finalTotal;
    const dsum = [...discounts].reduce((a, x) => a + x, 0);
    if (d > 0 && (discounts.has(d) || dsum === d)) kept = kept.concat({ name: '할인', price: -d, drink: false });
  }
  return { items: kept, total: finalTotal };
}

// [AI 생성] 자주 나오는 메뉴 낱말 사전. 인식이 한 글자만 틀린 경우(된장피개 → 된장찌개) 바로잡는 데 씀
const MENU_WORDS = new Set('오겹살 생삼겹살 꽃삼겹살 대패삼겹살 냉동삼겹살 통삼겹 날치알 계란찜 날치알계란찜 도시락 도시락김치볶음 김치볶음밥 볶음밥 서비스 생수 치즈돈까스 메밀국수 꼬마김밥 포케 포케볼 샌드위치 크림스프 쫄면사리 버블티 밀크티 소맥 맥사 청포도 복숭아 자몽 레몬 하이볼 칭따오 아사히 하이네켄 버드와이저 호가든 잭다니엘 짐빔 구워먹는치즈 치즈볼 감자전 두부김치 골뱅이 골뱅이무침 오뎅탕 어묵탕 계란탕 순두부 뚝배기 껍데기 막창 곱창 대창 양념갈비 생갈비 목살구이 등갈비 쭈꾸미 오징어 문어 새우 전복 장어 홍합탕 조개구이 회덮밥 물회 매운탕 지리 해물탕 알탕 동태탕 닭발 닭똥집 근위 똥집 모듬 모둠 세트 정식 추가 곱빼기 대 중 소 삼겹살 목살 항정살 갈매기살 가브리살 차돌박이 우삼겹 갈비 갈비살 돼지갈비 소갈비 등심 안심 채끝 부채살 살치살 토시살 불고기 제육볶음 오징어볶음 낙지볶음 쭈꾸미 닭갈비 닭볶음탕 찜닭 보쌈 족발 순대 떡볶이 튀김 어묵 김밥 라면 라볶이 쫄면 우동 냉면 물냉면 비빔냉면 비빔밥 돌솥비빔밥 김치찌개 된장찌개 순두부찌개 부대찌개 청국장 김치찜 육개장 설렁탕 곰탕 갈비탕 삼계탕 감자탕 해장국 국밥 순대국 칼국수 수제비 만두 군만두 물만두 계란말이 계란찜 계란후라이 파전 해물파전 김치전 감자전 공기밥 볶음밥 주먹밥 치킨 후라이드 양념치킨 간장치킨 반반 치즈볼 감자튀김 피자 파스타 스테이크 샐러드 햄버거 마라탕 마라샹궈 꿔바로우 탕수육 짜장면 짬뽕 깐풍기 양장피 초밥 모둠회 연어 사시미 돈까스 카레 덮밥 규동 우삼겹 소주 맥주 생맥주 참이슬 처음처럼 진로 새로 카스 테라 켈리 하이트 클라우드 막걸리 하이볼 와인 사케 청하 콜라 사이다 제로콜라 환타 음료수 아메리카노 카페라떼 바닐라라떼 카푸치노 에스프레소 콜드브루 녹차 아이스티 에이드 레몬에이드 자몽에이드 스무디 케이크 치즈케이크 크로플 와플 마카롱 쿠키 빙수 후레쉬 오리지널 추가 사리 치즈 계란 김치 된장 공기 반찬 양념 간장 마늘 매운 순살'.split(' '));

// [AI 생성] 한 글자 차이 나는 사전 낱말이 딱 하나면 그것으로 고침 (세 글자 이상 낱말만)
function fixMenuName(name) {
  return name.replace(/[가-힣]{3,}/g, w => {
    if (MENU_WORDS.has(w)) return w;
    let found = null, count = 0;
    for (const d of MENU_WORDS) {
      if (d.length !== w.length) continue;
      let diff = 0;
      for (let i = 0; i < w.length && diff < 2; i++) if (w[i] !== d[i]) diff++;
      if (diff === 1) { found = d; count++; }
    }
    return count === 1 ? found : w;
  });
}


// [AI 생성] 글 한 줄에서 금액 하나 읽기 (맨 뒤 숫자, 100원 이상·10원 단위). 없으면 null
function readAmount(text) {
  const tokens = String(text).normalize('NFKC').replace(/[|§¦\[\]{}]/g, ' ').trim().split(/\s+/).map(fixToken);
  for (let i = 0; i < tokens.length - 1; i++) {
    if (/^\d{1,3}[,.]?$/.test(tokens[i]) && /^\d{3}$/.test(tokens[i + 1])) tokens.splice(i, 2, tokens[i].replace(/[,.]$/, '') + ',' + tokens[i + 1]);
  }
  const nums = tokens.join(' ').match(/\d{1,3}(?:[,.]\d{3})+|\d{3,7}/g);
  if (!nums) return null;
  const v = toNum(nums[nums.length - 1]);
  return v >= 100 && v <= 5000000 && v % 10 === 0 ? v : null;
}

// [AI 생성] 붙여넣은 글이 '메뉴 이름들 → 가격들'처럼 칸별로 따로 나온 경우 순서대로 짝짓기
// (휴대폰 글자 인식으로 복사하면 영수증의 칸이 이렇게 나뉘어 나올 때가 많음)
function zipColumns(raw) {
  const names = [], prices = [], qtys = [];
  String(raw).split(/\r?\n/).forEach(line => {
    const t = line.normalize('NFKC').trim();
    if (!t) return;
    if (TAX.test(t) || TOTAL.test(t) || SKIP.test(t)) return;
    if (/[가-힣]{2,}|[A-Za-z]{3,}/.test(t) && !/\d{1,3}[,.]\d{3}/.test(t)) { names.push(cleanName(t)); return; }
    if (/^\d{1,2}(개|잔|병|인분)?$/.test(t)) { qtys.push(+t.match(/\d+/)[0]); return; }
    t.split(/\s+/).forEach(tok => { const v = readAmount(tok); if (v) prices.push(v); });
  });
  if (!names.length || !prices.length) return [];
  // 가격이 '단가, 금액' 짝으로 나왔는지 확인 (금액이 단가의 배수)
  let units = null, amounts = prices;
  if (prices.length % 2 === 0) {
    const u = prices.filter((_, i) => i % 2 === 0), am = prices.filter((_, i) => i % 2 === 1);
    if (am.every((v, i) => v >= u[i] && v % u[i] === 0) && am.length <= names.length) { units = u; amounts = am; }
  }
  const n = amounts.length;
  if (n > names.length) return [];
  const used = names.slice(names.length - n);      // 앞쪽 남는 이름은 가게 이름 같은 머리말
  return used.map((nm, i) => {
    let q = qtys.length === n ? qtys[i] : (units ? amounts[i] / units[i] : 1);
    const name = fixMenuName(nm);
    return { name: q > 1 ? `${name} ×${q}` : name, price: amounts[i], drink: DRINK.test(name) };
  });
}

// [AI 생성] 붙여넣은 글 정리: 줄 단위 읽기와 칸 짝짓기 중 합계가 맞는 쪽을 고름
function parsePasted(raw) {
  const a = parseReceipt(raw);
  const zipped = zipColumns(raw);
  if (!zipped.length) return a;
  const b = { items: zipped, total: a.total };
  const sumA = a.items.reduce((s, x) => s + x.price, 0), sumB = zipped.reduce((s, x) => s + x.price, 0);
  if (a.total) {
    if (sumB === a.total && sumA !== a.total) return b;
    if (sumA === a.total) return a;
  }
  return zipped.length > a.items.length ? b : a;
}

