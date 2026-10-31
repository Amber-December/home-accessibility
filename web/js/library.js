/* 素材库 (PRD 5.10.7): furniture from the IKEA set and the homes from the WSR set. Filters left, cards middle, detail
   right; on phones the detail opens as a sheet. ?tab=home and ?id=<product or scene id> deep-link into it. */
import { turntable } from './turntable.js';

const HA = window.HA, T = HA.text, $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
const q = new URLSearchParams(location.search);
const phone = matchMedia('(max-width: 760px)');
const GLB = { scene000064: 'models/H1/scene000064.glb' };
const AREA = [['all', '全部'], ['s', '60 m² 以下', a => a < 60], ['m', '60–90 m²', a => a >= 60 && a <= 90], ['l', '90 m² 以上', a => a > 90]];
const st = { tab: q.get('tab') === 'home' ? 'home' : 'furn', q: '', cat: 'all', motion: 'all', used: false, area: 'all', id: q.get('id') };
let C, L, stop = null;
const CUSTOM_KEY = 'livefirst-custom-furniture-v1';
const customItems = () => { try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) || '[]'); } catch { return []; } };
const saveCustom = items => localStorage.setItem(CUSTOM_KEY, JSON.stringify(items));
const readDataUrl = file => new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = bad; r.readAsDataURL(file); });

const cm = size => size.map(v => Math.round(v * 100)).join('×') + ' cm';
const homeName = id => { const h = L.homes.find(h => h.id === id); return h && h.hero ? h.hero : id === 'H1' ? 'H1' : id.replace('scene', '#'); };
// The H1 home opens the default 试住 data (same scene, the richer fixture); others open their lab IR and result.
const homeLink = (id, extra = {}) => {
  const h = L.homes.find(h => h.id === id), u = new URLSearchParams();
  if (h && h.hero !== 'H1') { u.set('ir', h.ir); u.set('result', h.result); if (GLB[h.id]) u.set('glb', GLB[h.id]); }
  Object.entries(extra).forEach(([k, v]) => u.set(k, v));
  return `index.html${u.size ? `?${u}` : ''}`;
};

function furniture() {
  const s = st.q.trim().toLowerCase();
  return C.items.filter(i => (st.cat === 'all' || i.category === st.cat) &&
    (st.motion === 'all' || (st.motion === 'rig') === !!i.harness.joints) && (!st.used || i.used_in.length) &&
    (!s || `${i.name} ${i.variant} ${i.category}`.toLowerCase().includes(s)));
}
function homes() {
  const s = st.q.trim().toLowerCase(), f = (AREA.find(a => a[0] === st.area) || AREA[0])[2];
  return L.homes.filter(h => (!f || f(h.area_m2)) && (!s || `${h.id} ${h.hero || ''} ${h.rooms.map(roomName).join(' ')}`.toLowerCase().includes(s)));
}
const roomName = r => T.room(r.replace(/\d+$/, ''));

const radio = (name, rows, cur) => `<div class="opts" role="radiogroup">${rows.map(([v, label, n]) =>
  `<label><input type="radio" name="${name}" value="${esc(v)}"${v === cur ? ' checked' : ''}> ${esc(label)}${n != null ? ` <span class="muted num">${n}</span>` : ''}</label>`).join('')}</div>`;

function renderFilters() {
  if (st.tab === 'furn') {
    const cats = [...new Set(C.items.map(i => i.category))];
    $('#filters').innerHTML = '<h3>品类</h3>' + radio('cat', [['all', '全部', C.items.length], ...cats.map(c => [c, c, C.items.filter(i => i.category === c).length])], st.cat) +
      '<h3>活动部件</h3>' + radio('motion', [['all', '全部'], ['rig', '门、抽屉可开合'], ['static', '固定']], st.motion) +
      `<h3>改造方案</h3><div class="opts"><label><input type="checkbox" name="used"${st.used ? ' checked' : ''}> 只看试住方案里用到的</label></div>`;
  } else {
    $('#filters').innerHTML = '<h3>面积</h3>' + radio('area', AREA.map(([v, n]) => [v, n]), st.area) +
      `<p class="muted">${esc(L.source)}</p>`;
  }
}

function furnCard(i) {
  return `<button class="card${i.id === st.id ? ' on' : ''}" data-id="${esc(i.id)}" aria-pressed="${i.id === st.id}">` +
    `<span class="pic"><img src="${esc(i.img)}" alt="" loading="lazy" width="240" height="240"><img class="ref" src="${esc(i.ref)}" alt="" loading="lazy" width="240" height="240"></span>` +
    `<b>${esc(i.name)}</b><span class="v">${esc(i.variant)}</span>` +
    `<span class="meta"><span class="num">${cm(i.size_m)}</span><span class="num">${i.price_cny ? T.cny(i.price_cny) : '价格待定'}</span></span>` +
    `${i.harness.joints ? '<span class="tag">可开合</span>' : ''}</button>`;
}
function homeCard(h) {
  const rooms = new Set(h.rooms.map(roomName)).size;
  return `<button class="card home${h.id === st.id ? ' on' : ''}" data-id="${esc(h.id)}" aria-pressed="${h.id === st.id}">` +
    `<span class="pic"><img src="${esc(h.preview)}" alt="" loading="lazy" width="240" height="240"></span>` +
    `<b>${esc(h.hero ? `${h.hero} · ${h.id}` : h.id)}</b>` +
    `<span class="meta"><span class="num">${h.area_m2} m²</span><span>${h.rooms.length} 个房间 · ${rooms} 类</span></span></button>`;
}

function renderList() {
  const rows = st.tab === 'furn' ? furniture() : homes();
  $('#list-title').textContent = st.tab === 'furn' ? '家具' : '户型';
  $('#count').textContent = `${rows.length} ${st.tab === 'furn' ? '件' : '套'}`;
  $('#cards').innerHTML = rows.map(st.tab === 'furn' ? furnCard : homeCard).join('') || '<p class="muted">没有符合条件的素材。</p>';
  document.querySelectorAll('.tabs button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === st.tab));
}
// What happened between the IKEA page and the model the resident walks around.
function steps(i) {
  const h = i.harness, out = [];
  const src = [...new Set(Object.values(h.dims_src).map(v => v[0]))].join('、');
  const [w, d, ht] = i.size_m.map(v => Math.round(v * 100));
  out.push(`读标称尺寸：宽 ${w} · 深 ${d} · 高 ${ht} cm${src ? `（${esc(src)}）` : ''}`);
  const mech = Object.entries(h.mechanisms);
  out.push(`${mech.length ? `识别活动部件：${mech.map(([k, n]) => `${esc(k)} ×${n}`).join('、')}` : '没有活动部件，按固定家具处理'}` +
    (h.route_note ? `<details><summary>判断依据</summary>${esc(h.route_note)}</details>` : ''));
  if (h.rescale) out.push(`Lux3D 按商品图生成网格，原始 ${h.rescale.from.join('×')} m，按标称尺寸缩放到 ${h.rescale.to.join('×')} m`);
  if (h.joints) {
    out.push(`${i.lux3d ? '在生成的网格上' : '按商品结构拆出部件，'}加 ${h.joints.n} 个关节骨骼，门和抽屉可以开合`);
    out.push(`MuJoCo 检查 ${h.joints.configs} 种开合姿态：最大穿模 ${Math.round((h.joints.penetration_m || 0) * 1000)} mm，${h.joints.passed ? '通过' : '未通过'}`);
  }
  if (h.review) out.push(`对照商品图复核外观：相似度 ${h.review} / 5`);
  return out.map(s => `<li>${s}</li>`).join('');
}

function furnDetail(i) {
  const h = i.harness, used = [];
  i.used_in.forEach(u => { const n = homeName(u.home); if (!used.some(x => x.n === n)) used.push({ n, u }); });
  return `<button class="close" data-close aria-label="关闭详情">×</button>` +
    `<h2>${esc(i.name)}</h2><p class="muted">${esc(i.variant)} · ${esc(i.category)}</p>` +
    `<dl class="facts"><dt>尺寸</dt><dd class="num">${cm(i.size_m)}</dd><dt>价格</dt><dd><span class="num">${i.price_cny ? T.cny(i.price_cny) : '待定'}</span> <span class="muted">${esc(i.price_src || '')}</span></dd>` +
    `<dt>商品页</dt><dd><a href="${esc(i.url)}" target="_blank" rel="noopener">宜家官网 ↗</a></dd></dl>` +
    `<h3>从商品图到可试住的模型</h3><ol class="chain">` +
    `<li><h4><span class="k">1</span>宜家商品图</h4><div class="figs"><figure class="main"><img src="${esc(i.ref)}" alt="宜家官网商品图"><figcaption>主图</figcaption></figure>` +
    h.inputs.map(x => `<figure><img src="${esc(x.img)}" alt="${esc(x.kind)}"><figcaption>${esc(x.kind)}</figcaption></figure>`).join('') + '</div></li>' +
    `<li><h4><span class="k">2</span>我们的处理</h4><ul class="proc">${steps(i)}</ul></li>` +
    `<li><h4><span class="k">3</span>生成的模型</h4><div class="figs"><figure class="main"><div class="stage" id="stage"><img src="${esc(i.img)}" alt="模型渲染图"></div>` +
    `<figcaption>${i.glb ? '拖动旋转' : '渲染图'}</figcaption></figure>` +
    (h.open_img ? `<figure><img src="${esc(h.open_img)}" alt="打开状态"><figcaption>打开状态</figcaption></figure>` : '') + '</div></li></ol>' +
    (i.limitations.length ? `<h3>已知简化</h3><ul class="small">${i.limitations.map(s => `<li>${esc(s)}</li>`).join('')}</ul>` : '') +
    `<h3>用在哪些改造方案</h3>` + (used.length ? `<ul class="small">${used.map(({ n, u }) =>
      `<li><a href="${esc(homeLink(u.home === 'H1' ? 'scene000064' : u.home, { step: 'fix', plan: u.plan }))}">${esc(n)}</a> · ${esc(u.plan)} ${esc(u.title)}</li>`).join('')}</ul>` :
      '<p class="muted">还没有方案用到它。</p>');
}

function homeDetail(h) {
  const counts = {};
  h.rooms.forEach(r => { const n = roomName(r); counts[n] = (counts[n] || 0) + 1; });
  const live = Object.values(h.runs).filter(v => v !== 'na'), ok = live.filter(v => v === 'ok').length;
  return `<button class="close" data-close aria-label="关闭详情">×</button>` +
    `<h2>${esc(h.hero ? `${h.hero} · ${h.id}` : h.id)}</h2><p class="muted">${esc(L.source)}</p>` +
    `<img class="plan" src="${esc(h.preview)}" alt="户型俯视图">` +
    `<dl class="facts"><dt>面积</dt><dd class="num">${h.area_m2} m²</dd>` +
    `<dt>房间</dt><dd>${Object.entries(counts).map(([n, k]) => (k > 1 ? `${esc(n)} ×${k}` : esc(n))).join('、')}</dd>` +
    `<dt>已体检</dt><dd><span class="num">${h.score}</span> 分 · <span class="num">${ok} / ${live.length}</span> 项通过 · ${h.plans.length} 个改造方案</dd></dl>` +
    `<p class="row"><a class="btn primary" href="${esc(homeLink(h.id))}">用这套户型试住</a><a class="btn" href="lab.html">放进批量实验</a></p>`;
}

function renderDetail() {
  if (stop) { stop(); stop = null; }
  const it = st.id && (st.tab === 'furn' ? C.items : L.homes).find(x => x.id === st.id);
  $('#item').innerHTML = it ? (st.tab === 'furn' ? furnDetail(it) : homeDetail(it)) : '<p class="muted">点一张卡片看详情。</p>';
  $('#item').classList.toggle('open', !!it);
  document.body.classList.toggle('sheet', !!it && phone.matches);
  if (it && it.glb) {
    const el = $('#stage');
    stop = turntable(el, it.glb, () => el.classList.add('failed'));
  }
}
function render() {
  renderFilters(); renderList(); renderDetail();
  const u = new URLSearchParams();
  if (st.tab === 'home') u.set('tab', 'home');
  if (st.id) u.set('id', st.id);
  history.replaceState(null, '', `library.html${u.size ? `?${u}` : ''}`);
}

function select(id) {
  st.id = id; render();
  if (phone.matches) $('#item').scrollTop = 0;
}
function close() { st.id = null; render(); }

async function boot() {
  [C, L] = await Promise.all(['library/catalog.json', 'lab/index.json'].map(u => fetch(u).then(r => {
    if (!r.ok) throw new Error(`${u}: HTTP ${r.status}`);
    return r.json();
  })));
  C.items = [...C.items, ...customItems()];
  $('#n-furn').textContent = C.items.length; $('#n-home').textContent = L.homes.length;
  $('#note').textContent = `${C.items.length} 件家具 · ${L.homes.length} 套户型`;
  if (st.id) {
    if (L.homes.some(h => h.id === st.id)) st.tab = 'home';
    else if (!C.items.some(i => i.id === st.id)) st.id = null;
  }
  if (!st.id && !phone.matches) st.id = st.tab === 'furn' ? (C.items.find(i => i.glb) || C.items[0]).id : L.homes[0].id;
  document.querySelector('.tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]');
    if (!b || b.dataset.tab === st.tab) return;
    st.tab = b.dataset.tab; st.q = ''; $('#q').value = '';
    st.id = phone.matches ? null : st.tab === 'furn' ? (C.items.find(i => i.glb) || C.items[0]).id : L.homes[0].id;
    render();
  });
  $('#q').addEventListener('input', e => { st.q = e.target.value; renderList(); });
  $('#filters').addEventListener('change', e => {
    const el = e.target;
    if (el.name === 'used') st.used = el.checked; else st[el.name] = el.value;
    renderList();
  });
  $('#cards').addEventListener('click', e => { const c = e.target.closest('.card'); if (c) select(c.dataset.id); });
  $('#item').addEventListener('click', e => { if (e.target.closest('[data-close]')) close(); });
  const dialog = $('#furniture-dialog'), form = $('#furniture-form'), progress = $('#furniture-progress');
  $('#add-furniture').addEventListener('click', () => { form.reset(); progress.hidden = true; dialog.showModal(); });
  form.addEventListener('submit', async e => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const fd = new FormData(form), ref = fd.get('reference'), drawing = fd.get('drawing');
    if (!(ref instanceof File) || !(drawing instanceof File)) return;
    const refUrl = await readDataUrl(ref);
    progress.hidden = false; progress.textContent = '准备上传…';
    await HA.lux3d.run({ reference: ref, drawing }, s => { progress.textContent = `${s.index + 1} / ${s.total} · ${s.label}`; });
    const id = `custom-${Date.now()}`;
    const item = { id, name: fd.get('name'), variant: '我的家具', category: fd.get('category'), size_m: [+fd.get('width') / 100, +fd.get('depth') / 100, +fd.get('height') / 100], price_cny: 0, price_src: '用户上传', url: '', img: refUrl, ref: refUrl, glb: '', lux3d: true, inputs: [], used_in: [], limitations: ['模型由 Agent + Lux3D 生成，当前为本地演示资产'], harness: { dims_src: { width: ['user', '参数图纸'], depth: ['user', '参数图纸'], height: ['user', '参数图纸'] }, mechanisms: fd.get('joints') ? { '活动部件': 1 } : {}, joints: fd.get('joints') ? { n: 1, configs: 1, penetration_m: 0, passed: true } : null, rescale: null, review: null } };
    const customs = customItems(); customs.push(item); saveCustom(customs); C.items.push(item);
    dialog.close(); st.tab = 'furn'; st.id = id; render();
  });
  document.addEventListener('click', e => { if (document.body.classList.contains('sheet') && !e.target.closest('#item, .card')) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('sheet')) close(); });
  render();
  window.HA_READY = true;
}
boot().catch(err => { $('#cards').textContent = '加载失败：' + err.message; console.error(err); });
