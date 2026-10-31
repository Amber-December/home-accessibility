/* Deterministic accessibility checks mapped to the project's GB / ADA threshold table. */
(() => {
  'use strict';
  const L = window.IndoorLab;

  const THRESHOLDS = Object.freeze({
    gbExistingDoorClearWidthM: .80,
    gbNewDoorClearWidthM: .90,
    adaDoorClearWidthM: .815,
    gbIndoorRouteWidthM: .90,
    gbTurnDiameterM: 1.50,
    adaTurnDiameterM: 1.525,
    adaParkingWidthM: .76,
    adaParkingDepthM: 1.22,
    gbTransferWidthM: 1.20,
    adaReachMinM: .38,
    adaReachMaxM: 1.22,
    gbHandleMinHeightM: .85,
    gbHandleMaxHeightM: 1.00,
    adaDoorForceN: 22.2,
    gbDoorForceN: 25,
    gbThresholdHeightM: .015,
    adaThresholdHeightM: .013
  });

  const standardRefs = Object.freeze({
    DOOR_WIDTH: ['GB 55019-2021 2.5.4 / 既有改造', 'GB 50763-2012 3.5.3', 'ADA 2010 404.2.3'],
    CORRIDOR_WIDTH: ['GB 55019-2021 3.1.2', 'GB 50763-2012 3.12.2', 'ADA 2010 403.5.1'],
    TURN_SPACE: ['GB 50763-2012 3.5.3 / 3.9.1', 'ADA 2010 304.3'],
    PARK_SPACE: ['ADA 2010 305.3'],
    TRANSFER_ZONE: ['GB 55019-2021 3.4.6'],
    REACH_HEIGHT: ['ADA 2010 308.2 / 308.3', 'GB 55019-2021 3.1.6 / 3.1.7'],
    DOOR_OPERATION: ['GB 55019-2021 2.5.4', 'ADA 2010 404.2.9 / 309.4'],
    DOOR_SWING_BLOCK: ['ADA 2010 404.2.4.1', 'GB 50763-2012 3.5.3'],
    THRESHOLD: ['GB 55019-2021 2.5.3', 'ADA 2010 404.2.5'],
    TASK_EXECUTION: ['项目仿真任务执行器（非规范认证）'],
    LIGHT_DARK: ['GB 55019-2021 3.1.8', 'ADA 2010 302.1 / 302.2'],
    STRETCHER_BLOCK: ['GB 50763-2012 3.9.1 / 3.12.2', '项目担架通行示意分析'],
    CLUTTER_MARGIN: ['GB 55019-2021 3.1.2', '项目门口杂物容错示意分析']
  });
  const requirementTaskIds = Object.freeze({sofa:'T1', bathroom:'T2', fridge:'T3', transfer:'T4', evacuate:'T5', night:'T6', stretcher:'T7', clutter:'T8'});

  const finite = value => Number.isFinite(Number(value));
  const check = (code, status, fields = {}) => ({
    code,
    status,
    standard: fields.standard || standardRefs[code] || [],
    source: fields.source || 'simulation',
    ...fields
  });

  const recommendationFor = code => ({
    DOOR_WIDTH: '增大门净宽，或改为不占用通行宽度的推拉门。',
    CORRIDOR_WIDTH: '移开造成受阻的家具，重新检查通道净宽和转向空间。',
    TURN_SPACE: '释放转身区，优先移开门后家具和床侧小件。',
    TRANSFER_ZONE: '释放床侧转移区，保证轮椅或助行器有连续靠近空间。',
    REACH_HEIGHT: '调整把手、开关或取物点高度，并缩短操作距离。',
    DOOR_OPERATION: '降低门操作阻力，或更换为易握执手。',
    DOOR_SWING_BLOCK: '调整门开启方向，清空门扇扫掠区域。',
    LIGHT_DARK: '补充夜间照明并确认开关在住户可触达范围内。',
    STRETCHER_BLOCK: '加宽门洞或释放转角，按担架矩形长宽重新复核。',
    CLUTTER_MARGIN: '保持入户门前连续净空，移走或限制门口临时杂物。'
  });
  function issueChecks(result, profile, model) {
    const out = [];
    const findObject = id => {
      if (!id || !model) return null;
      const door = (model.doors || []).find(d => String(d.id) === String(id));
      if (door) return {name: door.name || door.id, kind: 'door'};
      const item = (model.spec?.items || []).find(i => String(i.id) === String(id));
      if (item) return {name: item.name || item.kind || item.id, kind: item.kind || 'furniture'};
      return null;
    };
    for (const issue of result?.issues || []) {
      const object = findObject(issue.itemId);
      const base = {
        task: result.task,
        requirementTaskId: requirementTaskIds[result.task] || null,
        taskName: result.name,
        objectId: issue.itemId || null,
        objectName: object?.name || null,
        measured: finite(result.minClearance) ? result.minClearance : null,
        evidence: issue.reason || issue.code,
        source: 'simulation'
      };
      if (issue.code === 'path_blocked' || issue.code === 'closed_door') {
        const measured = finite(result.minClearance) ? Number(profile?.width || 0) + 2 * Number(result.minClearance) : null;
        out.push(check('CORRIDOR_WIDTH', 'fail', {
          ...base,
          measured,
          required: THRESHOLDS.gbIndoorRouteWidthM,
          evidence: `${issue.reason || '路径不可达'}；按当前身体包络记录归因`,
          recommendation: recommendationFor('CORRIDOR_WIDTH')
        }));
      } else if (issue.code === 'turn_failed') {
        out.push(check('TURN_SPACE', 'fail', {...base, measured: null, required: THRESHOLDS.gbTurnDiameterM, recommendation: recommendationFor('TURN_SPACE')}));
      } else if (issue.code === 'transfer_failed') {
        out.push(check('TRANSFER_ZONE', 'fail', {...base, measured: null, required: THRESHOLDS.gbTransferWidthM, recommendation: recommendationFor('TRANSFER_ZONE')}));
      } else if (issue.code === 'reach_failed') {
        const match = String(issue.reason || '').match(/距离\s*([\d.]+)\s*m\s*\/\s*高度\s*([\d.]+)\s*m/);
        const distance = match ? Number(match[1]) : null;
        const height = match ? Number(match[2]) : null;
        out.push(check('REACH_HEIGHT', 'fail', {
          ...base,
          measured: height,
          required: {min: THRESHOLDS.adaReachMinM, max: THRESHOLDS.adaReachMaxM},
          evidence: `${issue.reason || '触达失败'}；距离 ${finite(distance) ? distance.toFixed(2) : '?'} m`,
          recommendation: recommendationFor('REACH_HEIGHT')
        }));
      } else if (issue.code === 'door_operation') {
        out.push(check('DOOR_OPERATION', 'fail', {
          ...base,
          measured: null,
          required: {gbMaxN: THRESHOLDS.gbDoorForceN, adaMaxN: THRESHOLDS.adaDoorForceN},
          source: 'template',
          evidence: `${issue.reason || '门操作失败'}；当前模型阻力不是牛顿实测值`,
          recommendation: recommendationFor('DOOR_OPERATION')
        }));
      } else if (issue.code === 'door_swing') {
        out.push(check('DOOR_SWING_BLOCK', 'fail', {...base, measured: null, required: '开启扫掠区无障碍', recommendation: recommendationFor('DOOR_SWING_BLOCK')}));
      }
    }
    return out;
  }

  function buildStandardsReport(results = [], model = null, profile = null, options = {}) {
    const checks = [], doors = Array.isArray(model?.doors) ? model.doors : [];
    for (const door of doors) {
      if (finite(door.width)) {
        const width = Number(door.width);
        checks.push(check('DOOR_WIDTH', width >= THRESHOLDS.gbExistingDoorClearWidthM ? 'pass' : 'fail', {
          objectId: door.id,
          objectName: door.name || door.id,
          measured: width,
          required: {gbExistingM: THRESHOLDS.gbExistingDoorClearWidthM, gbNewM: THRESHOLDS.gbNewDoorClearWidthM, adaM: THRESHOLDS.adaDoorClearWidthM},
          evidence: '按模型门宽字段检查；未扣除门扇厚度时应标记为估算',
          source: door.clearWidth != null ? 'simulation' : 'template'
        }));
      }
      if (finite(door.handleHeight)) {
        const h = Number(door.handleHeight);
        checks.push(check('REACH_HEIGHT', h >= THRESHOLDS.gbHandleMinHeightM && h <= THRESHOLDS.gbHandleMaxHeightM ? 'pass' : 'fail', {
          objectId: door.id,
          objectName: door.name || door.id,
          measured: h,
          required: {gbMinM: THRESHOLDS.gbHandleMinHeightM, gbMaxM: THRESHOLDS.gbHandleMaxHeightM, adaMaxM: 1.22},
          evidence: '门把手高度；门操作点未提供时仅做高度检查',
          source: 'simulation'
        }));
      }
    }

    const taskIds = new Set((results || []).map(r => r.task));
    for (const result of results || []) {
      checks.push(...issueChecks(result, profile, model));
      if (!result.issues?.length) {
        checks.push(check('TASK_EXECUTION', result.success ? 'pass' : 'not_checked', {
          task: result.task,
          requirementTaskId: requirementTaskIds[result.task] || null,
          taskName: result.name,
          measured: result.minClearance,
          required: '任务动作链完成',
          evidence: result.success ? `任务完成，最小包络余量 ${Number(result.minClearance || 0).toFixed(3)} m` : '任务未完成但没有结构化失败原因',
          source: 'simulation'
        }));
      }
      if (result.task === 'night') {
        const light = result.lighting || result.light;
        checks.push(check('LIGHT_DARK', light && finite(light.minLux) ? (Number(light.minLux) >= 30 ? 'pass' : 'fail') : 'not_checked', {
          task: result.task,
          requirementTaskId: requirementTaskIds[result.task] || null,
          taskName: result.name,
          measured: light && finite(light.minLux) ? Number(light.minLux) : null,
          required: 30,
          evidence: light && finite(light.minLux) ? `夜间路径最小照度 ${Number(light.minLux).toFixed(1)} lx` : '当前夜间任务只有路径与动作结果，尚未接入照度场和开关触达数据',
          source: light && finite(light.minLux) ? 'simulation' : 'not_available'
        }));
      }
      if (result.task === 'stretcher') {
        const blocked = (result.issues || []).some(issue => issue.code === 'path_blocked' || issue.code === 'stretcher_blocked');
        checks.push(check('STRETCHER_BLOCK', result.stretcher ? (blocked ? 'fail' : result.success ? 'pass' : 'not_checked') : 'not_checked', {
          task: result.task,
          requirementTaskId: requirementTaskIds[result.task] || null,
          taskName: result.name,
          objectId: result.issues?.[0]?.itemId || 'stretcher-route',
          measured: finite(result.minClearance) ? result.minClearance : null,
          required: 0,
          evidence: result.stretcher ? (blocked ? '担架安全包络无法通过当前路径' : result.success ? '担架路径完成' : '担架任务未完成') : '当前场景未输出担架包络检查结果',
          source: result.stretcher ? 'simulation' : 'not_available'
        }));
      }
      if (result.task === 'clutter') {
        const clutter = result.clutter;
        checks.push(check('CLUTTER_MARGIN', clutter ? (clutter.firstBlockedPoint ? 'fail' : 'pass') : 'not_checked', {
          task: result.task,
          requirementTaskId: requirementTaskIds[result.task] || null,
          taskName: result.name,
          objectId: clutter?.firstBlockedPoint ? `clutter-${clutter.acceptedBoxes}` : null,
          measured: Number.isFinite(clutter?.acceptedBoxes) ? clutter.acceptedBoxes : null,
          required: '门口杂物加入后仍保持通行',
          evidence: clutter ? (clutter.firstBlockedPoint ? `已容纳 ${clutter.acceptedBoxes} 箱后首次受阻` : `测试的 ${clutter.acceptedBoxes} 箱均未阻断入户路径`) : '当前场景未输出门口杂物容错结果',
          source: clutter ? 'simulation' : 'not_available'
        }));
      }
    }

    // A completed turn/transfer task is evidence that the action executor found a
    // valid local envelope, but it is still reported separately from a standard
    // measurement because the scene does not expose a full free-space diameter.
    for (const id of ['bathroom', 'transfer']) {
      if (!taskIds.has(id)) continue;
      const result = results.find(r => r.task === id);
      if (result && !result.issues?.some(i => i.code === 'turn_failed')) checks.push(check('TURN_SPACE', 'not_checked', {
        task: id,
        taskName: result.name,
        measured: null,
        required: {gbDiameterM: THRESHOLDS.gbTurnDiameterM, adaDiameterM: THRESHOLDS.adaTurnDiameterM},
        evidence: '动作链完成；当前前端未输出完整转身圆直径，需 Scene IR 几何测量',
        source: 'simulation'
      }));
    }

    const applicable = checks.filter(item => item.status !== 'not_checked');
    const failed = applicable.filter(item => item.status === 'fail');
    const passed = applicable.filter(item => item.status === 'pass');
    return {
      schema: 'access-lab/standards-report',
      version: '0.1',
      generatedAt: options.generatedAt || new Date().toISOString(),
      profile: profile ? JSON.parse(JSON.stringify(profile)) : null,
      thresholds: THRESHOLDS,
      checks,
      summary: {
        total: checks.length,
        applicable: applicable.length,
        passed: passed.length,
        failed: failed.length,
        notChecked: checks.length - applicable.length,
        passRate: applicable.length ? passed.length / applicable.length : null,
        status: failed.length ? 'attention' : applicable.length ? 'pass' : 'not_checked'
      },
      limitations: [
        '结果用于设计比较，不构成 GB 55019、GB 50763 或 ADA 合规认证。',
        '导入模型若没有 clearWidth、门槛、门操作力和 Scene IR 空间字段，相关检查会标记为估算或未检查。',
        '门宽按模型字段检查；若字段是外框宽度，需在 Scene IR 中扣除门扇厚度后复核。'
      ]
    };
  }

  L.STANDARDS_THRESHOLDS = THRESHOLDS;
  L.buildStandardsReport = buildStandardsReport;
  if (typeof module !== 'undefined') module.exports = L;
})();
