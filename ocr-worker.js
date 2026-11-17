// [AI 생성] 글자 인식 작업자(worker) 래퍼
// 웹페이지 호스팅에 따라 .gz 파일을 올릴 수 없는 경우가 있어서,
// 한국어·영어 데이터를 base64 글자(.txt)로 올려 두고 여기서 원래 형식으로 바꿔 넘겨줌
const realFetch = self.fetch.bind(self);
self.fetch = async (url, opts) => {
  const u = String(url);
  if (u.endsWith('.traineddata.gz')) {
    const r = await realFetch(u + '.b64.txt', opts);
    if (!r.ok) return r;
    const bin = atob((await r.text()).trim());
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Response(buf, { status: 200 });
  }
  return realFetch(url, opts);
};
importScripts('worker.min.js');
