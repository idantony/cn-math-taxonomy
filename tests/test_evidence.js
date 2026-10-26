#!/usr/bin/env node
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const E = require('../diagnose/engine.js');
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ok ' + name); }
const topics = ['A', 'B', 'T'].map(id => ({ id }));
const deps = [{ topicId: 'T', prerequisiteId: 'A', strength: 'hard' }, { topicId: 'T', prerequisiteId: 'B', strength: 'soft' }];
const qs = topics.flatMap(t => [1, 2, 3, 4].map(n => ({ id: t.id + '_q' + n, topicId: t.id, difficulty: n === 2 ? 'standard' : 'basic' })));
const G = E.buildGraph(topics, deps, qs);
const start = o => E.createSession(G, ['T'], Object.assign({ limit: 30, seed: 'evidence-test' }, o));
const answer = (s, r, x) => E.applyAnswer(G, s, E.nextQuestion(G, s), r, x);
test('default requires two independent answers and never propagates to ancestors', () => {
  let s = start(); assert.equal(s.policy, 'evidence-v1');
  assert.equal(E.nextItem(G, s).question.difficulty, 'standard');
  s = answer(s, 'correct'); assert.equal(E.statusOf(s, 'T'), 'unknown'); assert(E.isUnconfirmed(s, 'T'));
  s = answer(s, 'correct'); assert.equal(E.statusOf(s, 'T'), 'mastered');
  assert.equal(E.statusOf(s, 'A'), 'unknown'); assert.equal(E.statusOf(s, 'B'), 'unknown'); assert.equal(E.nextItem(G, s), null);
});
test('two failures trace only hard prerequisites; soft nodes are neither asked nor candidate causes', () => {
  let s = answer(answer(start(), 'wrong'), 'skip');
  assert.equal(E.nextQuestion(G, s), 'A');
  s = answer(answer(s, 'wrong'), 'wrong'); assert.equal(E.nextQuestion(G, s), null);
  const sum = E.summarize(G, s); assert.deepEqual(sum.roots.map(r => r.id), ['A']);
  assert(!sum.path.some(p => p.id === 'B')); assert(!s.attempts.B);
});
test('mixed correct/wrong requires a third distinct item', () => {
  let s = answer(answer(start(), 'correct'), 'wrong'); assert.equal(E.statusOf(s, 'T'), 'unknown');
  assert.equal(E.nextItem(G, s).attempt, 3);
  s = answer(s, 'correct'); assert.equal(E.statusOf(s, 'T'), 'mastered');
  assert.equal(new Set(s.answers.map(a => a.qid)).size, 3);
});
test('hint and solution success require independent verification', () => {
  for (const support of ['hint', 'solution']) {
    let s = answer(start(), 'correct', { support, at: '2026-10-26T01:02:03Z' });
    assert.equal(E.statusOf(s, 'T'), 'shaky'); assert.equal(E.nextQuestion(G, s), 'T');
    assert.deepEqual(E.summarize(G, s).helped, ['T']);
    s = answer(s, 'correct'); assert.equal(E.statusOf(s, 'T'), 'shaky');
    s = answer(s, 'correct'); assert.equal(E.statusOf(s, 'T'), 'mastered');
    assert.equal(s.answers[0].at, '2026-10-26T01:02:03Z');
  }
});
test('three mixed helped responses finish shaky and trace hard prerequisites', () => {
  let s = answer(start(), 'correct', { support: 'hint' });
  s = answer(answer(s, 'correct'), 'wrong');
  assert.equal(E.statusOf(s, 'T'), 'shaky'); assert.equal(E.nextQuestion(G, s), 'A');
});
test('budget cutoff leaves one correct or wrong unknown, never weak', () => {
  for (const r of ['correct', 'wrong', 'skip']) {
    const s = answer(start({ limit: 1 }), r); const sum = E.summarize(G, s);
    assert.equal(E.statusOf(s, 'T'), 'unknown'); assert.deepEqual(sum.weak, []);
    assert.deepEqual(sum.pendingEvidence, ['T']); assert(sum.limitReached);
  }
});
test('single-item banks remain unknown regardless of result', () => {
  const g = E.buildGraph([{ id: 'X' }], [], [{ id: 'X_q1', topicId: 'X' }]);
  for (const r of ['correct', 'wrong']) {
    const s = E.applyAnswer(g, E.createSession(g, ['X']), 'X', r);
    assert.equal(E.nextItem(g, s), null); assert.equal(E.statusOf(s, 'X'), 'unknown'); assert(E.isUnconfirmed(s, 'X'));
  }
});
test('seed replay preserves metadata and undo/correction reuses recorded distinct questions', () => {
  let s = answer(start(), 'wrong', { at: 'timestamp', text: 'answer' }); s = answer(s, 'correct'); s = answer(s, 'correct');
  const opts = { limit: 30, seed: s.seed, policy: s.policy };
  assert.deepEqual(E.replay(G, s.targets, s.answers, opts), s);
  const undo = E.replay(G, s.targets, s.answers.slice(0, -1), opts);
  assert.equal(E.nextItem(G, undo).question.id, s.answers[2].qid);
  const corrected = s.answers.map((a, i) => Object.assign({}, a, i === 2 ? { result: 'wrong' } : {}));
  const rebuilt = E.replay(G, s.targets, corrected, opts); assert.equal(E.statusOf(rebuilt, 'T'), 'weak');
  assert.equal(rebuilt.answers[0].at, 'timestamp');
  // Correcting the first result may make the second sufficient; retain the third historical fact.
  const earlyPass = E.replay(G, s.targets, s.answers.map((a, i) => Object.assign({}, a, i === 0 ? { result: 'correct' } : {})), opts);
  assert.equal(earlyPass.answers.length, 3); assert.equal(E.statusOf(earlyPass, 'T'), 'mastered');
});
test('invalid IDs, repeated questions, and out-of-order live answers are rejected', () => {
  const s = answer(start(), 'wrong');
  assert.throws(() => E.applyAnswer(G, s, 'T', 'correct', { qid: s.answers[0].qid }));
  assert.throws(() => E.applyAnswer(G, s, 'B', 'correct'));
  assert.throws(() => E.applyAnswer(G, s, 'T', 'correct', { qid: 'invalid' }));
  assert.throws(() => E.createSession(G, ['T'], { policy: 'typo' }));
});
test('all real subjects finish with distinct items, bounded attempts, and replayable mixed evidence', () => {
  const read = name => JSON.parse(fs.readFileSync(path.join(__dirname, '../data', name + '.json'), 'utf8'));
  const g = E.buildGraph(read('topics'), read('dependencies'), read('questions'));
  for (const subject of ['math', 'english', 'physics', 'chinese']) {
    const ids = g.topics.filter(t => !t.external && E.subjectOf(t) === subject).map(t => t.id);
    assert(ids.length);
    let s = E.createSession(g, ids, { mode: 'screen', limit: ids.length * 3 + 1, seed: 'real-' + subject });
    let item; let guard = 0;
    while ((item = E.nextItem(g, s))) {
      assert(++guard <= ids.length * 3);
      s = E.applyAnswer(g, s, item.topicId, item.attempt === 2 ? 'wrong' : 'correct', { qid: item.question.id });
    }
    assert.equal(new Set(s.answers.map(a => a.qid)).size, s.answers.length);
    assert(Object.values(s.attempts).every(a => a.length <= 3));
    assert(E.summarize(g, s).finished);
    assert.deepEqual(E.replay(g, ids, s.answers, { mode: 'screen', limit: s.limit, seed: s.seed, policy: s.policy }), s);
  }
});
console.log('\n' + passed + ' evidence tests passed');
