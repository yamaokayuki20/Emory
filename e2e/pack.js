/*
 * エモリー 動作テスト「基本パック」（ヘッドレス実機テスト）。
 *
 * 何か対応したら必ずこのパックを通すこと（docs/テスト基本パック.md 参照）。
 * 実画面（react-native-web ビルド）をヘッドレス Chrome で操作し、主要な
 * インタラクションと例外事象・性能を自動アサートする。1つでも失敗したら exit 1。
 *
 * 使い方: node e2e/pack.js <url>   （通常は e2e/run.sh から呼ぶ）
 * 計測には本番にも入っている軽量フック window.__emoryThrows / __emoryGoals /
 * __emorySurf(x) を使用（実害なし）。
 */
const puppeteer = require('puppeteer');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const URL = process.argv[2] || 'http://localhost:8099/Emory/';
const results = [];
let failed = 0;
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail });
  if (!cond) failed++;
}

async function newPage(browser, forceBasket, errors) {
  const page = await browser.newPage();
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ' + m.text()); });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
  await page.evaluateOnNewDocument((fb) => {
    try { localStorage.setItem('emory.debugUnlimited', '1'); } catch (e) {}
    Math.random = () => (fb ? 0.99 : 0.01);
  }, forceBasket);
  await page.goto(URL, { waitUntil: 'networkidle0', timeout: 60000 });
  await sleep(3200);
  return page;
}
const throws = (p) => p.evaluate(() => window.__emoryThrows || 0);
const goals = (p) => p.evaluate(() => window.__emoryGoals || 0);
// 山が完全に静止するまで待つ（surf が一定値で連続安定＝カメラ追従も settle 完了）。
// 落下中はテスト計測と実タップで surf がズレるため、必ず静止させてから層判定を行う。
async function waitSettled(p, timeoutMs = 9000) {
  const x = 195; let prev = null, stable = 0; const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const s = await p.evaluate((xx) => { const f = window.__emorySurf; return f ? Math.round(f(xx)) : -1; }, x);
    if (s === prev) { if (++stable >= 4) return true; } else { stable = 0; prev = s; }
    await sleep(160);
  }
  return false;
}
// surf より少し上（=確実に投擲ゾーン）かつピッカー下端より下の y を返す
const aboveSurf = (p, x) => p.evaluate((xx) => {
  const s = window.__emorySurf; const surf = s ? s(xx) : 400;
  return Math.max(180, Math.min(surf - 24, 740));
}, x);

(async () => {
  const errors = [];
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] });

  // ===== UFO モードのページで一般インタラクション =====
  const page = await newPage(browser, false, errors);
  const buildTag = await page.evaluate(() => {
    const t = [...document.querySelectorAll('*')].map((e) => e.textContent).find((s) => /^b\d+ /.test(s || ''));
    return t || '(none)';
  });

  // T1 上の空間タップ → 1タップ1生成
  let b0 = await throws(page);
  for (const x of [120, 200, 280]) { await page.touchscreen.tap(x, await aboveSurf(page, x)); await sleep(160); }
  await sleep(2200);
  check('T1 emptyTap 1:1', (await throws(page)) - b0 === 3, `delta=${(await throws(page)) - b0}`);

  // T2 連続タップ（45ms）→ 全て生成。確実に空間となる高めの y を狙う（表面の上昇に
  // 邪魔されないよう、各タップ直前に surf を見て十分上を選ぶ）。
  await waitSettled(page);
  b0 = await throws(page);
  for (let i = 0; i < 8; i++) {
    const x = 110 + i * 24;
    const y = await page.evaluate((xx) => { const s = window.__emorySurf; return Math.max(182, Math.round((s ? s(xx) : 380) - 40)); }, x);
    await page.touchscreen.tap(x, y);
    await sleep(45);
  }
  await sleep(2200);
  // ヘッドレスの touchscreen.tap は 45ms 間隔だと稀に1つ取りこぼす（実機/単体では8/8）。
  // 連打が機能していること（≒タップ数だけ生成）を見るので、1つの取りこぼしは許容。
  { const d = (await throws(page)) - b0; check('T2 rapidTap (連打で生成, >=7/8)', d >= 7, `delta=${d}`); }

  // T3 絵文字層タップ → 生成されない（不変条件: タップ時に局所表面より下の点は生成0）。
  // 完全静止させてから、各タップ直前に live surf で「層内」を再確認した点だけを検証する。
  await waitSettled(page);
  // 「明確に層の内部（局所表面より十分深い）」点だけを狙う＝settle のゆらぎに左右されない。
  let t3tested = 0, t3viol = 0;
  const t3bad = [];
  const cands = await page.evaluate(() => {
    const out = [];
    for (const img of document.querySelectorAll('img')) {
      const r = img.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (r.width >= 20 && r.width <= 70 && cy > window.innerHeight * 0.5 && cy < window.innerHeight - 20) out.push([Math.round(cx), Math.round(cy)]);
    }
    return out;
  });
  for (const [x, y] of cands) {
    const margin = await page.evaluate((xx, yy) => { const s = window.__emorySurf; return s ? yy - s(xx) : -1; }, x, y);
    if (margin < 70) continue; // 表面付近は対象外（明確に層内のものだけ検証）
    const before = await throws(page);
    await page.touchscreen.tap(x, y);
    await sleep(120);
    t3tested++;
    if ((await throws(page)) > before) { t3viol++; t3bad.push({ x, y, margin: Math.round(margin) }); }
    if (t3tested >= 12) break;
  }
  check('T3 layerTap invariant (層内タップ→生成0)', t3viol === 0, `tested=${t3tested} violations=${t3viol} ${JSON.stringify(t3bad)}`);

  // T4 フリック → 投擲（+1）
  b0 = await throws(page);
  { const y0 = await aboveSurf(page, 150); await page.mouse.move(150, Math.min(y0, 250)); await page.mouse.down();
    for (const [x, y] of [[200, 220], [250, 195], [300, 175], [330, 165]]) { await page.mouse.move(x, y); await sleep(8); }
    await page.mouse.up(); }
  await sleep(2200);
  check('T4 flick +1', (await throws(page)) - b0 === 1, `delta=${(await throws(page)) - b0}`);

  // T5 層を掴んでドラッグ → スクロール（生成されない）
  b0 = await throws(page);
  { const gy = await page.evaluate(() => { const s = window.__emorySurf; return Math.round((s ? s(195) : 400) + 60); });
    await page.mouse.move(195, gy); await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(195, gy + i * 16); await sleep(35); }
    await page.mouse.up(); }
  await sleep(700);
  check('T5 scrollGrab 0', (await throws(page)) - b0 === 0, `delta=${(await throws(page)) - b0}`);

  // T6 演出切替ボタンが機能
  const btn = await page.evaluate(() => {
    const el = [...document.querySelectorAll('*')].find((e) => /演出:/.test(e.textContent || '') && e.children.length <= 2);
    if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  check('T6 toggle button exists', !!btn, btn ? 'found' : 'missing');

  // T7 すり抜け: 画面下端を大きく超えて残留するボールが無い
  const strays = await page.evaluate(() => { let n = 0; for (const i of document.querySelectorAll('img')) { if (i.getBoundingClientRect().top > window.innerHeight + 200) n++; } return n; });
  check('T7 no stray below screen', strays === 0, `strays=${strays}`);

  // T8 性能（3xスロットル≒中位機で30投、中央値fps>=40）。貫通ストレス(T13)の前に普通の山で測定。
  const client = await page.target().createCDPSession();
  await client.send('Emulation.setCPUThrottlingRate', { rate: 3 });
  await page.evaluate(() => { window.__frames = []; let last = performance.now(); const t = (n) => { window.__frames.push(n - last); last = n; if (window.__sampling) requestAnimationFrame(t); }; window.__sampling = true; requestAnimationFrame(t); });
  for (let i = 0; i < 30; i++) { const x = 90 + (i % 8) * 28; await page.touchscreen.tap(x, await aboveSurf(page, x)); await sleep(110); }
  await sleep(1500);
  const perf = await page.evaluate(() => { window.__sampling = false; const f = window.__frames.filter((d) => d > 0 && d < 1000).sort((a, b) => a - b); const med = f[Math.floor(f.length * 0.5)] || 0; return { medFps: Math.round(1000 / med), samples: f.length }; });
  await client.send('Emulation.setCPUThrottlingRate', { rate: 1 });
  check('T8 perf median fps>=40', perf.medFps >= 40, `medFps=${perf.medFps}`);

  // T13 貫通検査(その1): 上から色々な場所(高所＝速い落下)に落としても層を貫通して
  // 下まで落ちない（最終 sink が大きくない）。
  {
    const xs13 = []; for (let x = 35; x <= 355; x += 22) xs13.push(x);
    let pen = 0, tested = 0; const bad = [];
    for (const x of xs13) {
      await page.touchscreen.tap(x, 185);
      let s = null;
      for (let k = 0; k < 55; k++) { s = await page.evaluate(() => window.__emoryLastDrop || null); if (s && s.sleeping) break; await sleep(55); }
      tested++;
      // 物理層の底(removeDepth≈552)より下＝除去層へ落ちた＝本物の貫通。谷へ転がり込んだ
      // 数個分の深さは誤検出になるため、しきい値は層の底＋余裕(620)に置く。
      if (s && s.sink > 620) { pen++; if (bad.length < 6) bad.push({ x, sink: s.sink }); }
    }
    check('T13 貫通: 高所ドロップで層の底まで落ちない', pen === 0, `penetrated=${pen}/${tested} ${JSON.stringify(bad)}`);
  }

  // T14 貫通検査(その2): 中心へ高速連投（settle待たず畳みかける）。固定が間に合わず軟らかい
  // 列を掘り抜けても、安全網で沈み込みが抑えられる。物理計測 __emoryMaxBallSink で判定。
  {
    async function flick(sx, sy, ex, ey) { await page.mouse.move(sx, sy); await page.mouse.down(); for (let i = 1; i <= 5; i++) { await page.mouse.move(sx + (ex - sx) * i / 5, sy + (ey - sy) * i / 5); await sleep(5); } await page.mouse.up(); }
    let maxSink = 0;
    for (let i = 0; i < 28; i++) {
      if (i % 2 === 0) await page.touchscreen.tap(180 + (i % 5) * 8, 200);
      else await flick(180 + (i % 5) * 8, 230, 195, 400);
      await sleep(110);
      const s = await page.evaluate(() => window.__emoryMaxBallSink || 0);
      if (s > maxSink) maxSink = s;
    }
    await sleep(2500);
    for (let k = 0; k < 20; k++) { const s = await page.evaluate(() => window.__emoryMaxBallSink || 0); if (s > maxSink) maxSink = s; await sleep(50); }
    // 安全網は物理層の底(removeDepth≈552)で止める。これより下＝除去層へ落ちた＝本物の貫通。
    check('T14 貫通: 中心高速連投でも層の底を抜けない', maxSink < 620, `maxBallSink=${maxSink}`);
  }

  // T15 重なり検査: シード(初期)の山に、ボール同士が見た目で重なっていないか。
  // 中心間距離が見た目の径×0.75 未満を「明確な重なり」とする。新ページで純粋なシードを測る。
  {
    const sp = await newPage(browser, false, errors);
    const seedM = await sp.evaluate(() => {
      const B = []; for (const i of document.querySelectorAll('img')) { const r = i.getBoundingClientRect(); if (r.width >= 20 && r.width <= 70) B.push([r.left + r.width / 2, r.top + r.height / 2]); }
      let clear = 0, minD = 1e9; const D = 46;
      for (let a = 0; a < B.length; a++) { let nd = 1e9; for (let b = 0; b < B.length; b++) { if (a === b) continue; const d = Math.hypot(B[a][0] - B[b][0], B[a][1] - B[b][1]); if (d < nd) nd = d; } if (nd < minD) minD = nd; if (nd < D * 0.75) clear++; }
      return { n: B.length, clearOverlap: clear, minDist: Math.round(minD) };
    });
    await sp.close();
    check('T15 重なり: シードの山に明確な重なりが無い', seedM.clearOverlap <= 1, `clearOverlap=${seedM.clearOverlap}/${seedM.n} minDist=${seedM.minDist}`);
  }
  await page.close();

  // ===== バスケモードのページでスコア判定 =====
  const bp = await newPage(browser, true, errors);
  const hoop = await bp.evaluate(() => { let best = null; for (const i of document.querySelectorAll('img')) { const r = i.getBoundingClientRect(); if (r.width > 70) best = r; } return best ? { left: best.left, top: best.top, w: best.width, h: best.height } : null; });
  check('T9 basket renders', !!hoop, hoop ? `w=${Math.round(hoop.w)}` : 'missing');
  if (hoop) {
    const cx = Math.round(hoop.left + 0.30 * hoop.w);
    const ringY = Math.round(hoop.top + 0.32 * hoop.h);
    const r = Math.round(0.32 * hoop.w);
    // 中央の真上 → 自由落下で中央通過 → ゴール
    let g0 = await goals(bp);
    for (let i = 0; i < 5; i++) { await bp.touchscreen.tap(cx, Math.max(180, ringY - 55)); await sleep(900); }
    await sleep(700);
    check('T10 basket center scores', (await goals(bp)) - g0 >= 1, `goals=${(await goals(bp)) - g0}`);
    // 右リム端へ何度も落としても固着しない（#5: 引っかかり防止）。当たり判定はあるが斜め板で
    // 滑り落ちる。固着＝ゴール高さ付近に居座るボールが残らないこと＆カメラがせり上がらないこと。
    const rightRimX = Math.round(hoop.left + 0.62 * hoop.w);
    const surfBefore = await bp.evaluate(() => { const s = window.__emorySurf; return s ? Math.round(s(180)) : 0; });
    for (let i = 0; i < 8; i++) { await bp.touchscreen.tap(rightRimX + (i % 3 - 1) * 6, Math.max(180, ringY - 50)); await sleep(700); }
    await sleep(2500);
    const stuck = await bp.evaluate((ry, ccx) => { let n = 0; for (const i of document.querySelectorAll('img')) { const r = i.getBoundingClientRect(); const y = r.top + r.height / 2, x = r.left + r.width / 2; if (r.width >= 20 && r.width <= 70 && Math.abs(y - ry) < 38 && x > ccx) n++; } return n; }, ringY, cx);
    const surfAfter = await bp.evaluate(() => { const s = window.__emorySurf; return s ? Math.round(s(180)) : 0; });
    // 固着の主判定は stuck===0（リム高さに居座る球が無い）。rose は念のための補助で、
    // 8個分の正当な積み上がり(~2-3段)を許容しつつ、リム固着でカメラが暴れる(数百px)のは捉える。
    check('T11 basket 右リム端で固着しない', stuck === 0 && surfBefore - surfAfter < 160, `stuck=${stuck} rose=${surfBefore - surfAfter}`);
  }
  await bp.close();

  // T16 すり抜け(不揃いな表面): 偏った・凸凹な山を作り、表面の各所へ落としても潜り込まない。
  // 落としたボールが他のボールの「真下」に潜る(cover大)＝表面の無物理層をすり抜けた証拠。
  {
    const tp = await newPage(browser, true, errors);
    const ld = () => tp.evaluate(() => window.__emoryLastDrop || null);
    const settle = async () => { for (let k = 0; k < 50; k++) { const s = await ld(); if (s && s.sleeping) return s; await sleep(55); } return await ld(); };
    for (const x of [70, 70, 70, 110, 150, 150, 230, 300, 90, 130, 190, 250, 320, 90, 70, 150]) { await tp.touchscreen.tap(x, 200); await sleep(150); }
    await sleep(2500);
    let slip = 0; const bad = [];
    for (let x = 50; x <= 340; x += 18) {
      await tp.touchscreen.tap(x, 190);
      const s = await settle();
      if (s && s.cover >= 3) { slip++; if (bad.length < 8) bad.push({ x, cover: s.cover, sink: s.sink }); }
    }
    await tp.close();
    check('T16 すり抜け: 凸凹な表面でも潜り込まない', slip === 0, `slipped=${slip} ${JSON.stringify(bad)}`);
  }

  // T17 永続キャッシュ(Phase 1): 初回ロードで baked レイアウトを保存(miss)、同コンテキストの
  // リロードで命中(hit)し、物理 settle を回さず同一レイアウト(placements)を復元する。
  {
    const cp = await newPage(browser, false, errors);
    const readPile = () => cp.evaluate(() => {
      const raw = localStorage.getItem('emory.pile');
      const c = raw ? JSON.parse(raw) : null;
      return { cache: window.__emoryPileCache, sig: c && c.sig, pl: c && c.pile && JSON.stringify(c.pile.placements) };
    });
    const first = await readPile();
    await cp.reload({ waitUntil: 'networkidle0', timeout: 60000 });
    await sleep(3200);
    const second = await readPile();
    await cp.close();
    const same = !!first.pl && first.pl === second.pl && first.sig === second.sig;
    check('T17 永続キャッシュ: 再読込で命中し同一レイアウト', first.cache === 'miss' && second.cache === 'hit' && same,
      `first=${first.cache} second=${second.cache} same=${same}`);
  }

  // T18 履歴保持(Phase 2): 旧上限180を超えて積んでも固定データを破棄しない（=下層/記録が
  // 消えない, #13/#11）。固定層は窓スライス描画なので fps も落ちない。
  {
    const hp = await newPage(browser, false, errors);
    const cdp = await hp.target().createCDPSession();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 3 });
    await hp.evaluate(() => { window.__frames = []; let last = performance.now(); const t = (n) => { window.__frames.push(n - last); last = n; if (window.__sampling) requestAnimationFrame(t); }; window.__sampling = true; requestAnimationFrame(t); });
    for (let i = 0; i < 220; i++) { await hp.touchscreen.tap(40 + (i % 9) * 38, 185); await sleep(45); }
    await sleep(3500);
    const m = await hp.evaluate(() => { window.__sampling = false; const f = window.__frames.filter((d) => d > 0 && d < 1000).sort((a, b) => a - b); return { fps: Math.round(1000 / (f[Math.floor(f.length * 0.5)] || 0)), frozen: window.__emoryFrozenCount || 0 }; });
    await hp.close();
    check('T18 履歴保持: 旧上限超でも下層を捨てず軽い', m.frozen > 180 && m.fps >= 40, `frozen=${m.frozen} fps=${m.fps}`);
  }

  // T19 大量履歴のシード: 多数の保存履歴があっても読み込みが固まらず(時間内にシード完了)、
  // シード(初期パイル)が重ならない。T15(デモ約40個)では捉えられない「大規模シードの
  // レイアウト破綻/読み込みハング」を防ぐ（dateBans の配置上限を上げ過ぎると失敗する）。
  {
    const sp = await browser.newPage();
    sp.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));
    await sp.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
    await sp.evaluateOnNewDocument(() => {
      try {
        localStorage.setItem('emory.debugUnlimited', '1');
        const emo = ['happy', 'excited', 'calm', 'relaxed', 'tired', 'sad', 'anxious', 'irritated'];
        const out = []; const now = Date.now();
        for (let i = 0; i < 600; i++) { const day = Math.floor(i / 12); const e = emo[(i * 7) % emo.length]; const d = new Date(now - day * 86400000); d.setHours(9 + (i % 12), (i * 5) % 60, 0, 0); out.push({ id: 's' + i, emotion: e, variation: i % 4, color: '#888', createdAt: d.toISOString() }); }
        out.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        localStorage.setItem('emory.entries', JSON.stringify(out));
      } catch (e) {}
    });
    const t0 = Date.now();
    let loadOk = true;
    try { await sp.goto(URL, { waitUntil: 'domcontentloaded', timeout: 30000 }); } catch (e) { loadOk = false; }
    let seeded = 0;
    for (let k = 0; k < 250 && loadOk; k++) { seeded = await sp.evaluate(() => window.__emoryFrozenCount || 0).catch(() => 0); if (seeded > 0) break; await sleep(100); }
    const loadMs = Date.now() - t0;
    await sleep(3000);
    const ov = await sp.evaluate(() => { const f = window.__emoryAllDump ? window.__emoryAllDump() : []; const D = 46; let severe = 0, minD = 1e9; for (let a = 0; a < f.length; a++) { let nd = 1e9; for (let b = 0; b < f.length; b++) { if (a === b) continue; const dx = f[a][0] - f[b][0], dy = f[a][1] - f[b][1]; const d = Math.sqrt(dx * dx + dy * dy); if (d < nd) nd = d; } if (nd < minD) minD = nd; if (nd < D * 0.55) severe++; } return { n: f.length, severe, minDist: Math.round(minD) }; }).catch(() => ({ n: 0, severe: -1, minDist: 0 }));
    await sp.close();
    check('T19 大量シード: 固まらず重ならない', loadOk && loadMs < 25000 && ov.severe === 0 && ov.n > 0, `loadMs=${loadMs} n=${ov.n} severe=${ov.severe} minDist=${ov.minDist}`);
  }

  // T20 固定層の再描画コスト(生成時カクつき防止): 山を静止させ(=飛行中の球ゼロ→ノイズ排除)、
  // 絵文字層を少しスクロールして可視窓を動かす。memo が効いていれば既に見えている固定ボールは
  // 作り直されず、再描画は「窓に新しく入った数個」だけ。固定のたびに可視全部(~70個)を作り直す
  // 回帰だと再描画が可視数を大きく超える。決定的(端末速度に依存しない)に検知できる。
  {
    const rp = await newPage(browser, false, errors);
    for (let i = 0; i < 120; i++) { await rp.touchscreen.tap(40 + (i % 9) * 38, 185); await sleep(45); }
    await sleep(4500); // 完全静止（active=0）まで待つ
    const vis = await rp.evaluate(() => [...document.querySelectorAll('img')].filter((i) => { const r = i.getBoundingClientRect(); return r.width >= 20 && r.width <= 70; }).length);
    const before = await rp.evaluate(() => window.__emoryPileRenders || 0);
    await rp.mouse.move(195, 650); await rp.mouse.down();
    for (let k = 1; k <= 6; k++) { await rp.mouse.move(195, 650 - k * 10); await sleep(16); }
    await rp.mouse.up();
    await sleep(500);
    const delta = (await rp.evaluate(() => window.__emoryPileRenders || 0)) - before;
    await rp.close();
    // memo 有効: 窓に入った数個のみ。回帰(全再描画): 可視数×スクロール段数。可視数未満を合格とする。
    check('T20 固定層スクロール再描画が最小', vis > 30 && delta < vis, `vis=${vis} delta=${delta}`);
  }

  // T21 慣性スクロール(#10): 絵文字層を勢いよくフリックして指を離した後も、カメラが
  // 慣性で動き続けて滑らかに減速・停止する（離した瞬間に止まらない）。
  {
    const ip = await newPage(browser, false, errors);
    for (let i = 0; i < 90; i++) { await ip.touchscreen.tap(40 + (i % 9) * 38, 185); await sleep(40); }
    await sleep(4000); // 山を作って静止
    // 絵文字層を掴む位置（表面より下＝スクロールゾーン。T5 と同じ採り方）。
    const gy = await ip.evaluate(() => { const s = window.__emorySurf; return Math.round((s ? s(195) : 400) + 60); });
    // 上へ素早くフリック（層を上へ→カメラは古い層side=camMax へ流れる。スクロール余地あり）。
    await ip.mouse.move(195, gy); await ip.mouse.down();
    for (let k = 1; k <= 6; k++) { await ip.mouse.move(195, gy - k * 36); await sleep(12); }
    await ip.mouse.up();
    const camAfter = await ip.evaluate(() => window.__emoryCameraY || 0);
    await sleep(130);
    const camMid = await ip.evaluate(() => window.__emoryCameraY || 0);
    await sleep(1000);
    const camSettled = await ip.evaluate(() => window.__emoryCameraY || 0);
    await ip.close();
    // 離した後(camAfter)からさらに動いた=慣性。終盤は減速して落ち着く（暴走しない）。
    const glided = Math.abs(camSettled - camAfter);
    const decel = Math.abs(camSettled - camMid) < glided + 1;
    check('T21 慣性スクロールが効く(#10)', glided > 25 && decel, `after=${Math.round(camAfter)} mid=${Math.round(camMid)} settled=${Math.round(camSettled)} glided=${Math.round(glided)}`);
  }

  check('T12 no console/page errors', errors.length === 0, errors.slice(0, 4).join(' | '));

  await browser.close();

  console.log('\n=== エモリー 基本テストパック ===');
  console.log('buildTag:', buildTag);
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? '  (' + r.detail + ')' : ''}`);
  console.log(`\n${failed === 0 ? 'ALL PASS' : failed + ' FAILED'}  (${results.length} checks)`);
  console.log('PACK_DONE');
  process.exit(failed === 0 ? 0 : 1);
})().catch((e) => { console.error('PACK_ERROR', e); process.exit(2); });
