const assert = require('node:assert/strict');
global.window = global;
const L = require('../js/core.js');
require('../js/simulation.js');
require('../js/resident-tasks.js');
require('../js/standards-report.js');

const model = {
  doors: [
    {id: 'wide', name: '宽门', width: 1.0, handleHeight: .95},
    {id: 'narrow', name: '窄门', width: .74, handleHeight: 1.15}
  ]
};
const profile = L.RESIDENT_PROFILES.wheelchair;
const results = [
  {task: 'sofa', name: '入户到沙发', success: true, minClearance: .12, issues: []},
  {task: 'fridge', name: '取用冰箱', success: false, minClearance: 0, issues: [
    {code: 'reach_failed', itemId: 'fridge', reason: '操作点距离 0.84 m / 高度 1.55 m，超出此画像的模拟触达范围'}
  ]},
  {task: 'transfer', name: '床椅转移', success: false, minClearance: 0, issues: [
    {code: 'transfer_failed', itemId: 'transferChair', reason: '床侧转移包络与扶手椅或床体重叠'}
  ]}
];
const report = L.buildStandardsReport(results, model, profile, {generatedAt: '2026-10-31T00:00:00.000Z'});
assert.equal(report.schema, 'access-lab/standards-report');
assert.equal(report.generatedAt, '2026-10-31T00:00:00.000Z');
assert(report.checks.some(c => c.code === 'DOOR_WIDTH' && c.objectId === 'narrow' && c.status === 'fail'));
const reach = report.checks.find(c => c.code === 'REACH_HEIGHT' && c.objectId === 'fridge');
assert.equal(reach.status, 'fail');
assert.equal(reach.measured, 1.55);
assert(report.checks.some(c => c.code === 'TRANSFER_ZONE' && c.status === 'fail'));
assert(report.summary.failed >= 3);
assert.equal(report.summary.status, 'attention');
console.log('PASS: standards report maps door, reach and transfer findings with GB / ADA thresholds.');
