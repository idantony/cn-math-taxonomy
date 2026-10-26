/* Local, factual learning records. No inference of mastery or causes. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.LearningModel = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";
  const DAY = 86400000;
  function time(v) {
    if (v === null || v === "" || typeof v === "boolean")
      throw Error("Invalid time");
    const n = v === undefined ? Date.now() : new Date(v).getTime();
    if (!Number.isFinite(n)) throw Error("Invalid time");
    return n;
  }
  function iso(v) {
    return new Date(time(v)).toISOString();
  }
  function required(v, k) {
    if (typeof v !== "string" || !v.trim()) throw Error("Missing " + k);
    return v;
  }
  function unique(a) {
    return Array.from(new Set(a || []));
  }
  function createTask(input, now) {
    return {
      id:
        input.id ||
        "task-" + time(now) + "-" + Math.random().toString(36).slice(2, 9),
      learnerId: required(input.learnerId, "learnerId"),
      subject: required(input.subject, "subject"),
      kind: input.kind === "chapter" ? "chapter" : "mistake",
      prompt: String(input.prompt || ""),
      attempt: String(input.attempt || ""),
      topicIds: unique(input.topicIds),
      createdAt: iso(now),
    };
  }
  function subjectOf(t) {
    return (
      t.subject ||
      (/^cne_/.test(t.id)
        ? "english"
        : /^cnp_/.test(t.id)
          ? "physics"
          : /^cnc_/.test(t.id)
            ? "chinese"
            : "math")
    );
  }
  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/[\s，。！？、：:()（）\[\]「」“”]/g, "");
  }
  function suggestTopics(topics, prompt, subject, query) {
    const text = norm(query || prompt);
    if (text.length < 2) return [];
    // These are visible expression cues, not a mathematical parser or diagnosis.
    // Restrict them to mathematics and require the learner to confirm the range.
    const formula = text.replace(/＝/g, "=");
    const variables = unique(formula.match(/[xyz]/g) || []);
    const variableDenominator = /[/÷][(]?[a-z]/.test(formula);
    const square = /[xyz](?:²|\^2|\*\*2)/.test(formula);
    const otherPower =
      /[xyz](?:[³⁴⁵⁶⁷⁸⁹]|\^(?!2(?:[^0-9]|$))\d+|\*\*(?!2(?:[^0-9]|$))\d+)/.test(
        formula,
      );
    const equationCue =
      subject === "math" &&
      formula.includes("=") &&
      variables.length === 1 &&
      !variableDenominator &&
      !otherPower;
    const fractionCue =
      subject === "math" &&
      !formula.includes("=") &&
      /(?:\d+\s*[/／]\s*\d+|(?:^|[+−\-*])\s*[a-z]\s*[/／]\s*[a-z](?:$|[+−\-*]))/.test(
        formula,
      );
    const terms = [
      "一元一次",
      "一元二次",
      "二元一次",
      "分数",
      "小数",
      "百分数",
      "分式",
      "方程",
      "函数",
      "三角形",
      "平行线",
      "圆",
      "导数",
      "复数",
      "概率",
      "电流",
      "电压",
      "力",
      "速度",
      "光",
      "时态",
      "过去式",
      "现在进行",
      "名词",
      "代词",
      "比较级",
    ];
    return topics
      .filter((t) => subjectOf(t) === subject && !t.external)
      .map((t) => {
        const name = norm(t.name || t.title);
        let score = 0,
          reasons = [];
        if (name.length >= 2 && text.includes(name)) {
          score += 100;
          reasons.push("题目包含知识点名称：" + (t.name || t.title));
        }
        if (query && name.includes(text)) {
          score += 60;
          reasons.push("名称包含搜索词");
        }
        terms.forEach((w) => {
          if (text.includes(w) && name.includes(w)) {
            score += w.length * 4;
            reasons.push("共同词语：" + w);
          }
        });
        const equationName = square ? "一元二次方程" : "一元一次方程";
        if (
          (equationCue && name.includes(equationName)) ||
          (fractionCue && name.includes("分数"))
        ) {
          score += 20;
          reasons.push("算式形式可能相关，请确认");
        }
        return { id: t.id, score, reasons };
      })
      .filter((x) => x.score >= 8)
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .slice(0, 12);
  }
  function sameScope(e, t) {
    return e.learnerId === t.learnerId && e.subject === t.subject;
  }
  function scoped(task, events, now) {
    if (now !== undefined) time(now);
    return (events || [])
      .filter(
        (e) =>
          sameScope(e, task) &&
          e.taskId === task.id &&
          (now === undefined || time(e.at) <= time(now)),
      )
      .sort((a, b) => time(a.at) - time(b.at));
  }
  // Recent practice on the same confirmed range matters across task boundaries.
  // Other learners, subjects and unrelated topics never reset this task's clock.
  function relatedActivity(task, events, now) {
    const topics = new Set(task.topicIds || []);
    if (now !== undefined) time(now);
    return (events || [])
      .filter(
        (e) =>
          sameScope(e, task) &&
          (now === undefined || time(e.at) <= time(now)) &&
          (e.taskId === task.id ||
            topics.has(e.topicId) ||
            (Array.isArray(e.topicIds) &&
              e.topicIds.some((id) => topics.has(id)))),
      )
      .sort((a, b) => time(a.at) - time(b.at));
  }
  function identity(e) {
    return [e.learnerId, e.subject, e.questionId].join("|");
  }
  function recompute(events) {
    const seen = new Set();
    return events
      .slice()
      .sort((a, b) => time(a.at) - time(b.at))
      .map((e) => {
        const k = identity(e),
          repeat = seen.has(k);
        seen.add(k);
        return Object.assign({}, e, {
          repeated: repeat,
          firstIndependent: e.support === "independent" && !repeat,
        });
      });
  }
  function normalizeEvent(input) {
    required(input.id, "id");
    required(input.taskId, "taskId");
    required(input.learnerId, "learnerId");
    required(input.subject, "subject");
    required(input.questionId, "questionId");
    if (!["correct", "wrong", "skip"].includes(input.result))
      throw Error("Invalid result");
    if (!["independent", "hint", "solution"].includes(input.support))
      throw Error("Invalid support");
    return Object.assign({}, input, {
      at: iso(input.at),
      questionVersion: String(input.questionVersion || "1"),
      phase: input.phase === "review" ? "review" : "practice",
    });
  }
  function recordAttempt(events, input) {
    if ((events || []).some((e) => e.id === input.id)) return recompute(events);
    return recompute((events || []).concat(normalizeEvent(input)));
  }
  function replaceAttempt(events, id, patch) {
    return recompute(
      events.map((e) =>
        e.id === id ? normalizeEvent(Object.assign({}, e, patch, { id })) : e,
      ),
    );
  }
  function removeAttempt(events, id) {
    return recompute(events.filter((e) => e.id !== id));
  }
  // Preserve arithmetic operators and decimal points: removing them would merge
  // distinct questions. NFKC covers full-width OCR letters, digits and symbols.
  function promptIdentity(value) {
    return String(value || "")
      .normalize("NFKC")
      .replace(/[−﹣－]/g, "-")
      .toLowerCase()
      .replace(
        /[\s\u200b-\u200d\ufeff，,。！？!?、：:；;“”"'「」『』（）()【】\[\]]/g,
        "",
      );
  }
  function repeatsOriginal(task, question) {
    if (task.kind !== "mistake") return false;
    const original = promptIdentity(task.prompt);
    const candidate = promptIdentity(question.prompt);
    if (!original || !candidate) return false;
    if (original === candidate) return true;
    const shorter = original.length < candidate.length ? original : candidate;
    const longer = original.length < candidate.length ? candidate : original;
    // Only explicit substantial text/formula containment, never topic keywords.
    const substantial =
      shorter.length >= 12 ||
      (shorter.length >= 6 && /\d/.test(shorter) && /[=+*/−-]/.test(shorter));
    return substantial && longer.includes(shorter);
  }
  function pickPractice(graph, task, events, opts) {
    opts = opts || {};
    const ids = task.topicIds.filter(
      (id) => graph.byId[id] && subjectOf(graph.byId[id]) === task.subject,
    );
    if (!ids.length)
      return { status: "unmapped", reason: "请先人工确认知识点" };
    const used = new Set(
      (events || []).filter((e) => sameScope(e, task)).map((e) => e.questionId),
    );
    (opts.excludeQuestionIds || opts.avoid || []).forEach((id) => used.add(id));
    const choices = [],
      seen = new Set();
    ids.forEach((id) =>
      (graph.bank[id] || []).forEach((q) => {
        if (!used.has(q.id) && !seen.has(q.id) && !repeatsOriginal(task, q)) {
          seen.add(q.id);
          choices.push({ topicId: id, question: q });
        }
      }),
    );
    choices.sort(
      (a, b) =>
        (({ basic: 0, standard: 1, advanced: 2 })[a.question.difficulty] ?? 1) -
        ({ basic: 0, standard: 1, advanced: 2 }[b.question.difficulty] ?? 1),
    );
    if (!choices.length)
      return {
        status: "exhausted",
        reason:
          "当前范围没有未见过的新题；可查阅讲解或调整范围，同题重做仅记为重复练习",
      };
    return Object.assign(
      {
        status: "ready",
        questionId: choices[0].question.id,
        reason: "人工确认范围内的未见题，优先基础和标准题",
      },
      choices[0],
    );
  }
  function countsOf(es) {
    return es.reduce(
      (c, e) => {
        c.attempts++;
        if (e.result === "skip") c.skipped++;
        else if (e.result === "wrong") c.wrong++;
        else if (e.support !== "independent") c.helped++;
        else if (e.firstIndependent) c.independentCorrect++;
        else c.repeatedCorrect++;
        return c;
      },
      {
        attempts: 0,
        independentCorrect: 0,
        helped: 0,
        wrong: 0,
        skipped: 0,
        repeatedCorrect: 0,
      },
    );
  }
  function planReview(task, events, now, reviewDays) {
    const days =
        Number.isFinite(Number(reviewDays)) && Number(reviewDays) > 0
          ? Number(reviewDays)
          : 3,
      es = scoped(task, recompute(events || []), now),
      last = es[es.length - 1];
    const base = {
      reviewDays: days,
      parameterNote: "提醒间隔是可调整、待检验的参数，不是科学最优天数",
    };
    if (!last)
      return Object.assign(base, {
        status: "unchecked",
        dueAt: null,
        message: "先做一次独立检查",
      });
    const trailing = es.slice(-2);
    if (trailing.length === 2 && trailing.every((e) => e.result === "wrong"))
      return Object.assign(base, {
        status: "clarify",
        dueAt: null,
        message: "连续作答有困难，先缩小范围检查或寻求讲解",
      });
    if (
      last.result !== "correct" ||
      last.support !== "independent" ||
      !last.firstIndependent
    )
      return Object.assign(base, {
        status: "practice",
        dueAt: null,
        message: "用不同题目再独立练习，帮助下完成与重复题另行记录",
      });
    const activity = relatedActivity(task, events, now);
    const latestActivity = activity[activity.length - 1] || last;
    const due = time(latestActivity.at) + days * DAY;
    return Object.assign(base, {
      status: time(now) >= due ? "due" : "scheduled",
      dueAt: iso(due),
      message: time(now) >= due ? "可以用未见题进行隔时检查" : "尚未到提醒时间",
    });
  }
  function summarizeTask(task, events, now) {
    const es = scoped(task, recompute(events || []), now),
      counts = countsOf(es),
      last = es[es.length - 1] || null;
    const days =
      Number.isFinite(Number(task.reviewDays)) && Number(task.reviewDays) > 0
        ? Number(task.reviewDays)
        : 3;
    const activity = relatedActivity(task, events, now);
    const lastActivityBefore = (e) => {
      const index = activity.findIndex((a) => a.id === e.id);
      return index > 0 ? activity[index - 1] : null;
    };
    const delayed = es.filter(
      (e, i) =>
        e.phase === "review" &&
        e.result === "correct" &&
        e.firstIndependent &&
        i > 0 &&
        lastActivityBefore(e) &&
        time(e.at) - time(lastActivityBefore(e).at) >= days * DAY &&
        es
          .slice(0, i)
          .some(
            (p) =>
              p.result === "correct" &&
              p.firstIndependent &&
              p.questionId !== e.questionId &&
              time(e.at) - time(p.at) >= days * DAY,
          ),
    );
    let status = "unchecked",
      label = "未检查";
    if (es.length) {
      status = "pending";
      label = "待进一步检查";
    }
    if (counts.helped) {
      status = "helped";
      label = "借助帮助完成";
    }
    if (counts.independentCorrect) {
      status = "independent";
      label = "已有本次独立完成记录";
    }
    if (delayed.length) {
      status = "delayed";
      label = "已有隔时独立证据";
    }
    if (last && last.result === "correct" && last.support !== "independent") {
      status = "helped";
      label = "借助帮助完成，待不同题独立检查";
    }
    if (last && last.result !== "correct") {
      status = "pending";
      label = "待再次独立检查";
    }
    return {
      status,
      label,
      counts,
      delayedEvidence: delayed.map((e) => ({
        eventId: e.id,
        questionId: e.questionId,
        at: e.at,
      })),
      lastEvent: last,
      review: planReview(task, events, now, days),
    };
  }
  function learningTrend(task, events, opts) {
    opts = opts || {};
    const groups = new Map();
    scoped(task, recompute(events || [])).forEach((e) => {
      const key =
        opts.groupBy === "session"
          ? e.sessionId || e.at.slice(0, 10)
          : e.at.slice(0, 10);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });
    return Array.from(groups, ([key, es]) =>
      Object.assign({ key, label: "作答记录趋势" }, countsOf(es)),
    );
  }
  return {
    createTask,
    suggestTopics,
    pickPractice,
    recordAttempt,
    replaceAttempt,
    removeAttempt,
    summarizeTask,
    planReview,
    learningTrend,
  };
});
