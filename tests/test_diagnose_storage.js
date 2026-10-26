const assert = require('assert');
const fs = require('fs');
const vm = require('vm');
const E = require('../diagnose/engine.js');
const graph = E.buildGraph([{ id: 'T' }], [], [1,2,3].map(n => ({ id: 'T_q'+n, topicId: 'T', difficulty: 'standard' })));
let fail = false, childSave = true, writes = 0;
const store = new Map();
const node = () => ({ append(){}, prepend(){}, setAttribute(){}, addEventListener(){}, children: [] });
const context = { graph, window: { addEventListener(){}, DiagEngine: E, CnmChildren: { current: () => ({id:'kid'}), saveRecord(){writes++;return childSave;} } }, document: {getElementById:()=>node(), addEventListener(){}, createElement:node, createTextNode:s=>s}, localStorage: { getItem:k=>store.get(k)||null, setItem(k,v){if(fail)throw Error('quota');store.set(k,v);} }, location: { search:'',hash:'' }, URLSearchParams, console };
let source = fs.readFileSync(require.resolve('../diagnose/app.js'),'utf8');
source = source.replace('  init();', `  window.__test = {
setup(s,u,exposed){D={graph};session=s;sessionMeta={label:'test',exposed:exposed||{}};ui=u;},
save,restoreSession,saveToChild,
state(){return {session,ui,sessionMeta,archiveStatus,progressSaved};}
};`);
vm.runInNewContext(source, context);
const api = context.window.__test;
const session = E.createSession(graph,['T']);
const item = E.nextItem(graph,session);
for (const phase of ['auto','self','skip']) {
  const initial = {key:'T#1',phase,answer:'original wrong answer',support:'independent',verdict:{verdict:'wrong'}};
  api.setup(session,initial,{[item.question.id]:true});
  assert.strictEqual(api.save(),true);
  const saved = JSON.parse(store.get('cnmDiagnose.session.v2'));
  assert.strictEqual(saved.v,3);
  assert.strictEqual(saved.pending.qid,item.question.id);
  assert(api.restoreSession(saved));
  const restored=api.state();
  assert.strictEqual(restored.ui.answer,initial.answer);
  assert.strictEqual(restored.ui.phase,phase);
  assert.strictEqual(restored.ui.support,'independent');
  assert(restored.sessionMeta.exposed[item.question.id]);
}
api.setup(session,{key:'T#1',phase:'ask',answer:'assisted retry',support:'solution'},{[item.question.id]:true});
api.save();api.restoreSession(JSON.parse(store.get('cnmDiagnose.session.v2')));
assert.strictEqual(api.state().ui.support,'solution');
assert(api.restoreSession({v:2,targets:['T'],answers:[],seed:'old',limit:16}));
assert.strictEqual(api.state().session.policy,'legacy-v2');
api.saveToChild({asked:1});assert.strictEqual(writes,0);
let answered=E.applyAnswer(graph,session,'T','correct');
api.setup(answered,{},{});const summary=E.summarize(graph,answered);
childSave=false;api.saveToChild(summary);assert.strictEqual(api.state().archiveStatus,'failed');
childSave=true;api.saveToChild(summary);assert.strictEqual(api.state().archiveStatus,'saved');
fail=true;assert.strictEqual(api.save(),false);assert.strictEqual(api.state().progressSaved,false);
console.log('Diagnostic pending response, exposure, v2 restore and truthful storage checks passed');
