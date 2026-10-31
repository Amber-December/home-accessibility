/* Rule-based reading of the chat input (PRD 5.2). It only recognises words; every number it returns is copied
   from the user's own text, and the app echoes the result for confirmation before anything runs. */
(() => {
  'use strict';
  const HA = window.HA = window.HA || {};
  const PERSONA = [
    [/轮椅/, 'wheelchair'],
    [/助行器|助步器|拐杖|拄拐|走路不稳|腿脚不好/, 'walker_elder'],
    [/上肢|手臂|胳膊|手抬不|手不方便|够不着|够不到/, 'upper_limb'],
    [/正常走|走路正常|对照|健全/, 'walking_control'],
  ];
  const TASK = [
    [/厕所|卫生间|洗手间|如厕|马桶/, 'T2'],
    [/沙发|入户|进门|回家|客厅/, 'T1'],
    [/冰箱|厨房|做饭/, 'T3'],
    [/上床|下床|床|转移/, 'T4'],
  ];
  const ROOM_WORD = { 主卧: 'masterBedroom', 次卧: 'guestBedroom', 客厅: 'livingRoom', 卫生间: 'bathroom', 厨房: 'kitchen', 阳台: 'balcony', 书房: 'study' };
  const CN = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const UNIT = { 万: 1e4, w: 1e4, W: 1e4, 千: 1e3, k: 1e3, K: 1e3 };

  // "3", "1.5", "两", "二十" -> number.
  function num(s) {
    if (/^\d/.test(s)) return parseFloat(s);
    const i = s.indexOf('十');
    if (i < 0) return CN[s] ?? NaN;
    return (i ? CN[s.slice(0, i)] : 1) * 10 + (s.slice(i + 1) ? CN[s.slice(i + 1)] : 0);
  }

  // Locked objects: "衣柜不要动", "主卧的床别挪", "保留沙发". Room words narrow the match.
  function locks(text, ir) {
    const out = [], spans = [], names = Object.entries(HA.text.CAT).sort((a, b) => b[1].length - a[1].length);
    const re = /([\u4e00-\u9fa5]{1,8}?)(?:不要|不想|不能|不用|别)(?:动|挪|移|换|拆|搬)|(?:保留|留着)([\u4e00-\u9fa5]{1,8})/g;
    for (const m of text.matchAll(re)) {
      const said = m[1] || m[2], hit = names.find(([, n]) => said.includes(n));
      if (!hit) continue;
      const room = Object.entries(ROOM_WORD).find(([w]) => said.includes(w));
      const cats = names.filter(([, n]) => n === hit[1]).map(([c]) => c);
      const objs = ir.objects.filter(o => cats.includes(o.category) && (!room || ir.rooms.some(r => r.id === o.room && r.type === room[1])));
      objs.forEach(o => { if (!out.some(x => x.id === o.id)) out.push({ id: o.id, name: HA.text.object(ir, o.id) }); });
      // Drop only the object phrase from the text, so "我坐轮椅衣柜别动" still finds the wheelchair.
      const from = Math.min(...[hit[1], room && room[0]].filter(Boolean).map(w => said.indexOf(w)));
      spans.push(m[1] ? m[0].slice(from) : m[0]);
    }
    return { locks: out, spans };
  }

  function parse(text, ir) {
    const L = locks(text, ir);
    let rest = text; L.spans.forEach(s => { rest = rest.replace(s, ''); });
    const persona = (PERSONA.find(([re]) => re.test(rest)) || [])[1] || null;
    const tasks = TASK.filter(([re]) => re.test(rest)).map(([, t]) => t);
    let budget = null;
    const b = /(\d+(?:\.\d+)?|[一二两三四五六七八九十]+)\s*(万|千|[wWkK](?![a-zA-Z])|元|块)/.exec(rest) || /预算\D{0,4}(\d+)/.exec(rest) || /(\d{3,})\s*(?:以内|之内|以下)/.exec(rest);
    if (b) { const v = num(b[1]) * (UNIT[b[2]] || 1); if (Number.isFinite(v)) budget = Math.round(v); }
    const rent = /租/.test(rest) ? true : /自己的房|自有|买的房|自住/.test(rest) ? false : null;
    const noWall = /不(?:想|要|能|准)?(?:动|拆|改|砸)墙|墙(?:不要|不能|别)?(?:不动|别动|不拆)/.test(text);
    const understood = !!(persona || tasks.length || budget != null || rent != null || noWall || L.locks.length);
    return { text, persona, tasks, budget, rent, noWall, locks: L.locks, understood };
  }

  HA.intent = { parse };
})();
