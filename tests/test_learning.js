"use strict";
const assert = require("assert"),
  M = require("../learn/model"),
  E = require("../diagnose/engine");
const start = "2026-10-01T00:00:00Z",
  later = "2026-10-04T00:00:00Z";
const task = M.createTask(
  {
    id: "t",
    subject: "math",
    learnerId: "a",
    topicIds: ["m", "m2"],
    prompt: "解一元一次方程",
  },
  start,
);
const topics = [
  { id: "m", name: "一元一次方程" },
  { id: "m2", name: "分数" },
  { id: "cne_1", name: "分数", subject: "english" },
  { id: "cnp_1", name: "速度", subject: "physics" },
];
const graph = E.buildGraph(
  topics,
  [],
  [
    { id: "q1", topicId: "m", difficulty: "basic" },
    { id: "q2", topicId: "m", difficulty: "standard" },
    { id: "q1", topicId: "m2", difficulty: "basic" },
    { id: "q3", topicId: "m2", difficulty: "advanced" },
  ],
);
let events = [];
const input = (id, q, at, extra) =>
  Object.assign(
    {
      id,
      questionId: q,
      at,
      taskId: "t",
      learnerId: "a",
      subject: "math",
      topicId: "m",
      result: "correct",
      support: "independent",
      phase: "practice",
    },
    extra,
  );
assert.equal(M.suggestTopics(topics, "一元一次方程怎么解", "math")[0].id, "m");
assert.deepEqual(M.suggestTopics(topics, "无法识别的任务", "math"), []);
assert.equal(M.suggestTopics(topics, "分数", "english")[0].id, "cne_1");
assert.equal(M.pickPractice(graph, task, events).questionId, "q1");
events = M.recordAttempt(events, input("1", "q1", start));
assert.equal(events[0].questionVersion, "1");
assert(events[0].firstIndependent);
assert.equal(M.recordAttempt(events, input("1", "q2", start)).length, 1);
assert.equal(M.pickPractice(graph, task, events).questionId, "q2");
assert.equal(M.summarizeTask(task, events, start).status, "independent");
assert.equal(M.planReview(task, events, start).status, "scheduled");
assert.equal(M.planReview(task, events, later).status, "due");
let immediate = M.recordAttempt(
  events,
  input("2", "q2", "2026-10-01T01:00:00Z", { phase: "review" }),
);
assert.equal(M.summarizeTask(task, immediate, later).delayedEvidence.length, 0);
let delayed = M.recordAttempt(
  events,
  input("2", "q2", later, { phase: "review" }),
);
assert.equal(M.summarizeTask(task, delayed, later).delayedEvidence.length, 1);
let repeated = M.recordAttempt(
  events,
  input("2", "q1", later, { phase: "review" }),
);
assert.equal(M.summarizeTask(task, repeated, later).delayedEvidence.length, 0);
assert.equal(
  M.summarizeTask(task, repeated, later).counts.independentCorrect,
  1,
);
let helped = M.recordAttempt(
  [],
  input("h", "q1", start, { support: "solution" }),
);
assert.equal(M.summarizeTask(task, helped, later).status, "helped");
helped = M.recordAttempt(helped, input("h2", "q1", later));
assert(!helped[1].firstIndependent);
assert.equal(M.planReview(task, helped, later).status, "practice");
let foreign = M.recordAttempt(
  events,
  input("b", "q2", later, { learnerId: "b" }),
);
foreign = M.recordAttempt(
  foreign,
  input("e", "q2", later, { subject: "english" }),
);
foreign = M.recordAttempt(
  foreign,
  input("p", "q2", later, { subject: "physics" }),
);
assert.equal(M.summarizeTask(task, foreign, later).counts.attempts, 1);
assert.equal(M.pickPractice(graph, task, foreign).questionId, "q2");
assert.equal(
  M.pickPractice(graph, task, events, { excludeQuestionIds: ["q2", "q3"] })
    .status,
  "exhausted",
);
assert.equal(
  M.pickPractice(graph, Object.assign({}, task, { topicIds: [] }), events)
    .status,
  "unmapped",
);
let revised = M.replaceAttempt(delayed, "2", { support: "hint" });
assert.equal(M.summarizeTask(task, revised, later).delayedEvidence.length, 0);
revised = M.removeAttempt(repeated, "1");
assert(revised[0].firstIndependent);
assert.equal(M.learningTrend(task, repeated)[1].independentCorrect, 0);
assert.equal(M.learningTrend(task, events)[0].attempts, 1); // multi-skill question is one event
let wrong = M.recordAttempt([], input("w", "q1", start, { result: "wrong" }));
wrong = M.recordAttempt(wrong, input("w2", "q2", later, { result: "wrong" }));
assert.equal(M.planReview(task, wrong, later).status, "clarify");
assert.equal(M.summarizeTask(task, delayed, start).counts.attempts, 1);
assert.throws(() =>
  M.recordAttempt([], input("bad", "q", start, { support: "magic" })),
);
console.log("Learning model: all boundary checks passed");
// Delay is measured from the most recent task activity, not an older success.
let recent = M.recordAttempt(
  events,
  input("recent", "q3", "2026-10-03T23:00:00Z", { result: "wrong" }),
);
recent = M.recordAttempt(
  recent,
  input("review", "q2", later, { phase: "review" }),
);
assert.equal(M.summarizeTask(task, recent, later).delayedEvidence.length, 0);
// Another task for the same learner shares exposure history; other learners and subjects do not.
const anotherTask = Object.assign({}, task, { id: "another" });
assert.equal(M.pickPractice(graph, anotherTask, events).questionId, "q2");
assert.equal(
  M.pickPractice(graph, Object.assign({}, task, { learnerId: "b" }), events)
    .questionId,
  "q1",
);
const physicsGraph = E.buildGraph(
  [{ id: "cnp_1", name: "速度" }],
  [],
  [{ id: "q1", topicId: "cnp_1", difficulty: "basic" }],
);
assert.equal(
  M.pickPractice(
    physicsGraph,
    Object.assign({}, task, { subject: "physics", topicIds: ["cnp_1"] }),
    events,
  ).questionId,
  "q1",
);
// Generic single characters cannot cause automatic mapping of everyday phrases.
const everyday = [
  { id: "round", name: "圆的面积" },
  { id: "force", name: "力的作用", subject: "physics" },
];
assert.deepEqual(
  M.suggestTopics(everyday, "小明花5元买了一支圆珠笔，还剩多少元？", "math"),
  [],
);
assert.deepEqual(
  M.suggestTopics(everyday, "努力完成今天的练习", "physics"),
  [],
);
const actualTopics = require("../data/topics.json");
assert(
  M.suggestTopics(actualTopics, "请解一元一次方程 2x+3=7", "math").length > 0,
);
assert(
  M.suggestTopics(actualTopics, "比较分数 2/3 和 3/4 的大小", "math").length >
    0,
);
for (const invalid of ["not-a-date", "", null, Infinity]) {
  assert.throws(() =>
    M.createTask({ learnerId: "a", subject: "math" }, invalid),
  );
  assert.throws(() => M.summarizeTask(task, [], invalid));
  assert.throws(() => M.planReview(task, [], invalid));
  assert.throws(() => M.recordAttempt([], input("invalid", "q", invalid)));
}
// JSON persistence does not change the derived facts after an event correction.
const fixed = M.replaceAttempt(delayed, "2", {
  at: "2026-10-01T02:00:00Z",
  support: "hint",
});
const refreshed = JSON.parse(JSON.stringify(fixed));
assert.deepEqual(
  M.summarizeTask(task, fixed, later),
  M.summarizeTask(task, refreshed, later),
);
assert.deepEqual(
  M.learningTrend(task, fixed),
  M.learningTrend(task, refreshed),
);
assert.equal(M.summarizeTask(task, refreshed, later).delayedEvidence.length, 0);
console.log("Additional history, delay, matching and refresh checks passed");
// Formula cues are explainable suggestions and stay within mathematics.
for (const expression of ["2x+3=7", "3y-2＝10"]) {
  const matches = M.suggestTopics(actualTopics, expression, "math");
  assert(
    matches.some((c) =>
      actualTopics.find((t) => t.id === c.id).name.includes("一元一次方程"),
    ),
  );
  assert(matches.every((c) => c.reasons.includes("算式形式可能相关，请确认")));
}
for (const expression of ["x²-5x+6=0", "x^2=9", "x**2-4=0"]) {
  const matches = M.suggestTopics(actualTopics, expression, "math");
  assert(
    matches.some((c) =>
      actualTopics.find((t) => t.id === c.id).name.includes("一元二次方程"),
    ),
  );
  assert(
    !matches.some((c) =>
      actualTopics.find((t) => t.id === c.id).name.includes("一元一次方程"),
    ),
  );
}
for (const expression of ["2/3+1/4", "a/b"]) {
  const matches = M.suggestTopics(actualTopics, expression, "math");
  assert(matches.length);
  assert(matches.every((c) => c.reasons.includes("算式形式可能相关，请确认")));
}
assert.deepEqual(M.suggestTopics(actualTopics, "2/x=3", "math"), []);
assert.deepEqual(M.suggestTopics(actualTopics, "x^3=8", "math"), []);
assert.deepEqual(M.suggestTopics(actualTopics, "x+y=3", "math"), []);
for (const subject of ["english", "physics", "chinese"]) {
  assert.deepEqual(M.suggestTopics(actualTopics, "2x+3=7", subject), []);
  assert.deepEqual(M.suggestTopics(actualTopics, "2/3+1/4", subject), []);
}
console.log("Formula candidate checks passed");
// The student's original is already exposed, including OCR/full-width variants.
const originalGraph = E.buildGraph(
  [{ id: "m", name: "一元一次方程" }],
  [],
  [
    {
      id: "original",
      topicId: "m",
      difficulty: "basic",
      prompt: "解方程 2x-5=9。（只填x的值）",
    },
    {
      id: "different",
      topicId: "m",
      difficulty: "standard",
      prompt: "解方程 2x-5=11。（只填x的值）",
    },
  ],
);
const originalTask = Object.assign({}, task, {
  kind: "mistake",
  topicIds: ["m"],
  prompt: "解方程 2x-5=9",
});
assert.equal(
  M.pickPractice(originalGraph, originalTask, []).questionId,
  "different",
);
assert.equal(
  M.pickPractice(
    originalGraph,
    Object.assign({}, originalTask, {
      prompt: " 解 方 程　２ Ｘ － ５ ＝ ９。 ",
    }),
    [],
  ).questionId,
  "different",
);
assert.equal(
  M.pickPractice(
    originalGraph,
    Object.assign({}, originalTask, { kind: "chapter" }),
    [],
  ).questionId,
  "original",
);
assert.equal(
  M.pickPractice(
    originalGraph,
    Object.assign({}, originalTask, { prompt: "方程" }),
    [],
  ).questionId,
  "original",
);
assert.equal(
  M.pickPractice(originalGraph, originalTask, [], {
    excludeQuestionIds: ["different"],
  }).status,
  "exhausted",
);
assert.equal(
  M.pickPractice(
    originalGraph,
    Object.assign({}, originalTask, { prompt: "解方程2x+5=9" }),
    [],
  ).questionId,
  "original",
);
console.log("Original-question exposure checks passed");
// Mathematical minus signs are equivalent in original-question exposure checks.
assert.equal(
  M.pickPractice(
    originalGraph,
    Object.assign({}, originalTask, { prompt: "解方程2x−5=9" }),
    [],
  ).questionId,
  "different",
);
// Related practice in another task resets the clock; unrelated scopes do not.
const singleTopicTask = Object.assign({}, task, { topicIds: ["m"] });
const crossActivity = M.recordAttempt(
  events,
  input("related", "other-new", "2026-10-03T23:00:00Z", { taskId: "other" }),
);
assert.equal(
  M.planReview(singleTopicTask, crossActivity, later).status,
  "scheduled",
);
assert.equal(
  M.planReview(singleTopicTask, crossActivity, later).dueAt,
  "2026-10-06T23:00:00.000Z",
);
const crossReview = M.recordAttempt(
  crossActivity,
  input("cross-review", "q2", later, { phase: "review" }),
);
assert.equal(
  M.summarizeTask(singleTopicTask, crossReview, later).delayedEvidence.length,
  0,
);
for (const scopePatch of [
  { learnerId: "b" },
  { subject: "physics" },
  { topicId: "unrelated" },
]) {
  const unrelated = M.recordAttempt(
    events,
    input(
      "unrelated",
      "another-question",
      "2026-10-03T23:00:00Z",
      Object.assign({ taskId: "other" }, scopePatch),
    ),
  );
  assert.equal(M.planReview(singleTopicTask, unrelated, later).status, "due");
  const checked = M.recordAttempt(
    unrelated,
    input("delayed-check", "q2", later, { phase: "review" }),
  );
  assert.equal(
    M.summarizeTask(singleTopicTask, checked, later).delayedEvidence.length,
    1,
  );
}
// Cross-task activity in any skill of a multi-skill event also counts once.
const multiple = M.recordAttempt(
  events,
  input("multi-related", "multi-question", "2026-10-03T23:00:00Z", {
    taskId: "other",
    topicId: "unrelated",
    topicIds: ["unrelated", "m"],
  }),
);
assert.equal(
  M.planReview(singleTopicTask, multiple, later).status,
  "scheduled",
);
assert.equal(
  M.summarizeTask(singleTopicTask, multiple, later).counts.attempts,
  1,
);
console.log("Cross-task spacing and mathematical-minus checks passed");
