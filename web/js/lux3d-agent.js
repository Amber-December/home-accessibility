/* Local demo adapter for the Agent → Lux3D furniture pipeline. A production build
   replaces this adapter with a server endpoint; credentials stay off the client. */
(() => {
  const stages = ['读取参数图纸', 'Agent 提取尺寸与活动部件', 'Lux3D 生成三维模型', '尺寸校准与碰撞 QA', '写入我的家具库'];
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  window.HA = window.HA || {};
  window.HA.lux3d = { async run(input, onStage) { for (let i = 0; i < stages.length; i++) { onStage({ index: i, total: stages.length, label: stages[i] }); await wait(260); } return { status: 'ready', stages }; } };
})();
