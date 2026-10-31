/* Display strings and the shared clearance colour scale (PRD 5.4). */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const ROOM = { livingRoom: '客厅', masterBedroom: '主卧', guestBedroom: '次卧', bathroom: '卫生间', kitchen: '厨房', corridor: '走廊', balcony: '阳台', diningRoom: '餐厅', study: '书房' };
  const CAT = {
    bed: '床', sofa: '沙发', toilet: '马桶', wardrobe: '衣柜', diningtable: '餐桌', coffeetable: '茶几', TVStand: '电视柜',
    bathroomcabinet: '浴室柜', armchair: '扶手椅', loungechair: '躺椅', chair: '椅子', stool: '凳子', cabinet: '柜子',
    sidetable: '边几', bedsidecabinet: '床头柜', Nightstand: '床头柜', floorlamp: '落地灯', Mirror: '镜子', refrigerator: '冰箱',
    showerhead: '花洒', switch: '开关', lightfixture: '灯具', book: '书', vase: '花瓶', cosmeticbottle: '化妆品',
  };
  const CODE = {
    DOOR_WIDTH: '门洞净宽不足', CORRIDOR_WIDTH: '通道宽度不足', TURN_SPACE: '回转空间不足', TRANSFER_ZONE: '转移空间不足',
    UNREACHABLE: '到不了', REACH: '够不着', DOOR_OPEN: '开门失败', CONTACT: '擦碰',
  };
  const SOURCE = { wsr: '数据集', template: '模板估计', catalog: '商品页', lux3d: '模型量取', user: '用户修正' };
  const SHORT = { wheelchair: '轮椅', walker_elder: '助行器', upper_limb: '上肢受限', walking_control: '步行对照', stretcher: '担架' };

  // Clearance colour scale: red < 0, orange 0-5 cm, yellow 5-10 cm, green > 10 cm.
  const SCALE = [[0, '#e5484d'], [0.05, '#f2994a'], [0.10, '#f2c94c'], [Infinity, '#3fb68b']];
  const clearColor = c => SCALE.find(([lim]) => c < lim)[1];

  const m = v => (v == null ? '—' : `${(+v).toFixed(2)} m`);
  const cm = v => `${Math.round(v * 100)} cm`;

  HA.text = {
    room: t => ROOM[t] || t,
    cat: c => CAT[c] || c,
    code: c => CODE[c] || c,
    source: s => SOURCE[s] || s,
    persona: id => SHORT[id] || id,
    clearColor, SCALE, m, cm,
    roomOf(ir, id) { const r = ir.rooms.find(r => r.id === id); return r ? ROOM[r.type] || r.type : ''; },
    // Human name for an IR object id; falls back to "墙" for walls and the raw id otherwise.
    object(ir, id) {
      if (!id || id === 'wall') return '墙';
      const o = ir.objects.find(o => o.id === id);
      if (o) return `${HA.text.roomOf(ir, o.room)}${CAT[o.category] || o.category}`;
      const d = ir.doors.find(d => d.id === id);
      if (d) return d.rooms.length === 1 ? '入户门' : `${d.rooms.map(r => HA.text.roomOf(ir, r)).join('—')}门`;
      return id;
    },
    edit(ir, e) {
      const n = HA.text.object(ir, e.object_id);
      if (e.op === 'remove') return `移走${n}`;
      if (e.op === 'move') {
        return `${n}挪动 ${cm(Math.hypot(e.dx || 0, e.dy || 0))}`;
      }
      return `${e.op} ${n}`;
    },
    // One-line problem statement for a violation.
    violation(ir, v) {
      const gap = v.required - v.measured;
      return { title: `${HA.text.object(ir, v.object_id)} · ${HA.text.code(v.code)}`,
        nums: `实测 ${m(v.measured)} / 要求 ${m(v.required)}${gap > 0 ? ` · 差 ${cm(gap)}` : ''}`,
        std: v.standard, source: v.source };
    },
  };
})();
