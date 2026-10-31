/* Runs B's resident engine off the main thread. Messages:
   {type:'load', ir, occ, names}            -> {type:'ready', grid, doors, profiles, names}
   {type:'run', id, residents:[{id, profile}], tasks:[T..], edits:[]} -> {type:'runs', id, runs[]}
   {type:'hazard', id, kind:'fire'|'quake', intensity, residents, edits, room} -> {type:'hazard', id, result} (bsim-hazard.js) */
self.window = self;
importScripts(
  '../../prototypes/indoor-space-interaction/js/core.js',
  '../../prototypes/indoor-space-interaction/js/resident-nav.js',
  '../../prototypes/indoor-space-interaction/js/simulation.js',
  '../../prototypes/indoor-space-interaction/js/resident-tasks.js',
  '../../prototypes/indoor-space-interaction/js/standards-report.js',
  '../../prototypes/indoor-space-interaction/js/fire-core.js',
  '../../prototypes/indoor-space-interaction/js/earthquake-core.js',
  'bsim-model.js', 'bsim-hazard.js');
const A = self.IndoorLab.HAAdapter;
let sc = null;
self.onmessage = ({ data: m }) => {
  try {
    if (m.type === 'load') {
      A.reset(); sc = { ir: m.ir, occ: m.occ, names: m.names || {} };
      self.postMessage({ type: 'ready', grid: A.gridMeta(sc), doors: A.doorsOf(sc, []), profiles: self.IndoorLab.RESIDENT_PROFILES, names: A.namesFor(sc.ir) });
      return;
    }
    if (m.type === 'run') {
      const runs = [];
      for (const r of m.residents) runs.push(...A.runSuite(sc, r.id, r.profile, m.tasks, m.edits || []));
      self.postMessage({ type: 'runs', id: m.id, runs, score: A.score(runs) });
    }
    if (m.type === 'hazard') {
      const result = self.IndoorLab.HAHazard.run(sc, m);
      // Field frames are byte arrays: hand their buffers over instead of copying them.
      const moved = result.frames.flatMap(f => [f.smoke, f.heat].filter(Boolean).map(x => x.buffer));
      self.postMessage({ type: 'hazard', id: m.id, result }, moved);
    }
  } catch (e) {
    self.postMessage({ type: 'error', id: m.id, message: String(e && e.stack || e) });
  }
};
