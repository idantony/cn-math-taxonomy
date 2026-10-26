/* 学习页面：本地输入、人工确认范围和可复核的作答事实。 */
(function () {
  "use strict";
  const M = window.LearningModel,
    E = window.DiagEngine,
    $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search),
    names = { math: "数学", english: "英语", chinese: "语文", physics: "物理" };
  let subject = names[params.get("subject")]
    ? params.get("subject")
    : /^cne_/.test(params.get("target") || "")
      ? "english"
      : /^cnp_/.test(params.get("target") || "")
        ? "physics"
        : /^cnc_/.test(params.get("target") || "")
          ? "chinese"
          : "math";
  let learner = (window.CnmChildren && CnmChildren.current()) || null,
    learnerId = learner ? learner.id : "anonymous";
  let data,
    graph,
    state,
    task = null,
    practice = null,
    photo = null,
    photoURL = null,
    storageOK = true,
    tab = "mistake",
    confirmed = new Set(),
    candidates = [],
    sessionId = "session-" + Date.now();
  let draft = { prompt: "", attempt: "", stuck: "", chapter: "", query: "" };
  const key = () => `cnmLearn.v1.${learnerId}.${subject}`;
  function el(tag, attrs, ...children) {
    const n = document.createElement(tag);
    Object.entries(attrs || {}).forEach(([k, v]) => {
      if (k === "text") n.textContent = v;
      else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
      else if (k === "class") n.className = v;
      else if (k === "value") n.value = v;
      else if (v !== false && v != null) n.setAttribute(k, v === true ? "" : v);
    });
    children.flat().forEach((c) => {
      if (c != null)
        n.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return n;
  }
  const button = (text, fn, primary) =>
    el(
      "button",
      { type: "button", class: primary ? "primary" : "", onclick: fn },
      text,
    );
  function figure(svg) {
    if (typeof svg !== "string" || !/^<svg\b/.test(svg) ||
        /<script|foreignObject|<image|on\w+=|https?:/i.test(
          svg.replace('xmlns="http://www.w3.org/2000/svg"', ""))) return null;
    const node = el("div", { class: "q-figure" });
    node.innerHTML = svg;
    return node;
  }
  function markExposed(questionId) {
    if (!questionId) return;
    state.exposures = state.exposures || [];
    if (!state.exposures.some((item) => item.questionId === questionId)) {
      state.exposures.push({ questionId, at: new Date().toISOString(), source: "viewed-answer" });
    }
  }
  function resetTopicSelection() {
    confirmed.clear();
    document.querySelectorAll('input[data-topic-id]').forEach((input) => {
      input.checked = false;
    });
    const selection = $("selected-topics");
    if (selection) selection.textContent = "已选择：尚未选择（题目已更新，请重新确认）";
  }
  function notice(text, bad) {
    $("notice").replaceChildren(...(text ? [
      el("div", { class: "alert " + (bad ? "" : "success"), text }),
    ] : []));
  }
  function read() {
    try {
      const v = JSON.parse(localStorage.getItem(key()) || "null");
      return v && Array.isArray(v.tasks) && Array.isArray(v.events)
        ? v
        : { tasks: [], events: [] };
    } catch (e) {
      storageOK = false;
      return { tasks: [], events: [] };
    }
  }
  function save() {
    if (task) task.savedPractice = practice;
    state.draft = draft;
    state.activeTaskId = task && task.id;
    state.practice = practice;
    state.confirmed = [...confirmed];
    state.tab = tab;
    try {
      localStorage.setItem(key(), JSON.stringify(state));
      storageOK = true;
      return true;
    } catch (e) {
      storageOK = false;
      notice(
        "浏览器无法保存（权限或空间不足）。本次可继续，但刷新后可能丢失；请导出学习记录。",
        true,
      );
      return false;
    }
  }
  function field(label, value, oninput, extra) {
    const input = el(
      "textarea",
      Object.assign(
        { value, oninput: (e) => oninput(e.target.value) },
        extra || {},
      ),
    );
    return el("label", {}, label, input);
  }
  function scopeEvents() {
    return state.events.filter(
      (e) => e.learnerId === learnerId && e.subject === subject,
    );
  }
  function chrome() {
    $("subject").value = subject;
    document.querySelectorAll("nav a,.brand").forEach((a) => {
      const u = new URL(a.href);
      u.searchParams.set("subject", subject);
      a.href = u.href;
    });
    const identity = $("identity");
    identity.replaceChildren(
      el("span", {
        text: learner
          ? `当前：${learner.name} · 本机独立学习记录`
          : "本机匿名学习 · 无需注册或建立档案",
      }),
    );
    if (window.CnmChildren && CnmChildren.list().length) {
      const select = el("select", { "aria-label": "切换学习者" });
      select.append(el("option", { value: "anonymous", text: "匿名学习" }));
      CnmChildren.list().forEach((c) =>
        select.append(el("option", { value: c.id, text: c.name })),
      );
      select.value = learnerId;
      select.addEventListener("change", () => {
        save();
        learnerId = select.value;
        learner = CnmChildren.get(learnerId);
        CnmChildren.setCurrent(learner ? learnerId : null);
        restore();
        chrome();
        render();
      });
      identity.append(select);
    }
  }
  function restore() {
    notice("");
    candidates = [];
    state = read();
    draft = Object.assign(
      { prompt: "", attempt: "", stuck: "", chapter: "", query: "" },
      state.draft || {},
    );
    if (draft.chapter) draft.chapter = chapterKey(draft.chapter);
    confirmed = new Set(state.confirmed || []);
    tab = state.tab || "mistake";
    task = state.tasks.find((t) => t.id === state.activeTaskId) || null;
    practice = (task && task.savedPractice) || state.practice || null;
    photo = null;
    if (photoURL) URL.revokeObjectURL(photoURL);
    photoURL = null;
    const photoScope = key();
    if (draft.photoId)
      getPhoto(draft.photoId).then((blob) => {
        if (blob && photoScope === key()) {
          photo = blob;
          photoURL = URL.createObjectURL(blob);
          render();
        }
      });
  }
  function db() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(Error("无法使用图片存储"));
      const r = indexedDB.open("cnm-learning-photos", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("photos");
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function putPhoto(id, blob) {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction("photos", "readwrite");
      tx.objectStore("photos").put(blob, id);
      tx.oncomplete = () => {
        d.close();
        resolve();
      };
      tx.onerror = () => {
        d.close();
        reject(tx.error);
      };
    });
  }
  async function getPhoto(id) {
    try {
      const d = await db();
      return await new Promise((resolve) => {
        const r = d.transaction("photos").objectStore("photos").get(id);
        r.onsuccess = () => {
          d.close();
          resolve(r.result);
        };
        r.onerror = () => {
          d.close();
          resolve(null);
        };
      });
    } catch (e) {
      return null;
    }
  }
  async function acceptPhoto(blob) {
    if (!blob || !blob.type.startsWith("image/")) return;
    resetTopicSelection();
    photo = blob;
    if (photoURL) URL.revokeObjectURL(photoURL);
    photoURL = URL.createObjectURL(blob);
    const photoScope = key(),
      capturedDraft = draft;
    draft.ocrConfirmed = false;
    draft.ocrNeedsConfirmation = false;
    draft.photoId = `${learnerId}-${subject}-${Date.now()}`;
    const capturedPhotoId = draft.photoId;
    try {
      await putPhoto(capturedPhotoId, blob);
      if (
        photoScope !== key() ||
        capturedDraft !== draft ||
        draft.photoId !== capturedPhotoId
      )
        return;
      if (save()) notice("图片已保存在本机，可识别后核对题目。");
    } catch (e) {
      if (
        photoScope !== key() ||
        capturedDraft !== draft ||
        draft.photoId !== capturedPhotoId
      )
        return;
      delete draft.photoId;
      save();
      notice(
        "图片仅保留在当前会话，浏览器无法保存图片；请先识别或输入题目。",
        true,
      );
    }
    render();
  }
  async function recognize(b) {
    if (!photo) return;
    const scope = key(), capturedDraft = draft, capturedPhoto = photo, capturedPrompt = draft.prompt;
    b.disabled = true;
    try {
      if (!window.LocalOCR) throw Error("识别组件尚未加载");
      const result = await LocalOCR.recognize(photo, {
        onProgress: (p) => {
          b.textContent =
            "正在识别 " +
            (typeof p === "number"
              ? Math.round(p * 100) + "%"
              : (p && p.status) || "…");
        },
      });
      if (scope !== key() || draft !== capturedDraft || photo !== capturedPhoto) return;
      if (draft.prompt !== capturedPrompt) {
        notice("识别期间题目文字已修改，已保留你输入的内容。如需替换，可重新识别。");
        return;
      }
      draft.prompt = typeof result === "string" ? result : result.text || "";
      resetTopicSelection();
      draft.ocrNeedsConfirmation = true;
      draft.ocrConfirmed = false;
      const saved = save();
      render();
      if (saved)
        notice("识别完成，请逐字核对题目，特别是公式、上下标和手写内容。");
    } catch (e) {
      if (scope !== key() || draft !== capturedDraft || photo !== capturedPhoto) return;
      notice(
        "图片文字识别未完成：" + e.message + "。仍可手动输入或粘贴题目。",
        true,
      );
    } finally {
      b.disabled = false;
      b.textContent = "识别图片文字";
    }
  }
  function render() {
    const root = $("root");
    root.replaceChildren();
    const layout = el("div", { class: "layout" }),
      left = el("div"),
      right = el("aside");
    left.append(task ? taskPanel() : entryPanel());
    right.append(
      taskList(),
      el(
        "div",
        { class: "card" },
        el("h2", { text: "学习记录属于你" }),
        el("p", {
          class: "muted",
          text: "保存的是实际作答、使用帮助和评分更正。一次答对不能说明整章已经掌握。",
        }),
        button("导出本学科学习记录", exportData),
      ),
    );
    layout.append(left, right);
    root.append(layout);
    if (!storageOK)
      notice("浏览器无法保存。本次记录仅在内存中，请及时导出。", true);
  }
  function chapterKey(value) {
    const p = E.parseChapter(value);
    return [p.volume, p.chapterNo, p.chapterName].filter(Boolean).join(" ");
  }
  function entryPanel() {
    const box = el(
      "section",
      { class: "card" },
      el("h2", { text: "今天想学什么？" }),
    );
    box.append(
      el(
        "div",
        { class: "tabs" },
        button("这道题卡住了", () => {
          tab = "mistake";
          save();
          render();
        }),
        button("我正在学这一章", () => {
          tab = "chapter";
          save();
          render();
        }),
      ),
    );
    box
      .querySelectorAll(".tabs button")
      [tab === "chapter" ? 1 : 0].classList.add("active");
    if (tab === "mistake") {
      const f = el("input", {
        type: "file",
        accept: "image/*",
        "aria-label": "选择题目照片",
        onchange: (e) => acceptPhoto(e.target.files[0]),
      });
      box.append(
        el("label", {}, "拍照或选一张题目图片", f),
        el("p", {
          class: "note",
          text: "也可直接粘贴截图。图片在本机识别；印刷文字较适合，公式与手写请自行核对。",
        }),
      );
      if (photoURL)
        box.append(
          el("img", {
            src: photoURL,
            class: "preview",
            alt: "待识别的题目图片",
          }),
        );
      const o = button("识别图片文字", (e) => recognize(e.currentTarget));
      o.disabled = !photo;
      box.append(o);
      box.append(
        field(
          "题目文字（可直接粘贴、修改识别结果）",
          draft.prompt,
          (v) => {
            draft.prompt = v;
            resetTopicSelection();
            save();
          },
          { id: "prompt" },
        ),
        field(
          "我已经尝试了什么？",
          draft.attempt,
          (v) => {
            draft.attempt = v;
            save();
          },
          { placeholder: "写下算式、思路，或写“还没想法”" },
        ),
        field(
          "我卡在这里",
          draft.stuck,
          (v) => {
            draft.stuck = v;
            save();
          },
          {
            placeholder: "例如：题意读不懂、不知道用什么方法、算到这一步不确定",
          },
        ),
      );
      if (draft.ocrNeedsConfirmation)
        box.append(
          el(
            "label",
            { class: "candidate" },
            el("input", {
              type: "checkbox",
              checked: draft.ocrConfirmed,
              onchange: (e) => {
                draft.ocrConfirmed = e.target.checked;
                save();
              },
            }),
            "我已核对并修正识别文字",
          ),
        );
      box.append(
        button(
          "找可能相关的知识点",
          () => {
            candidates = M.suggestTopics(data, draft.prompt, subject);
            render();
          },
          true,
        ),
      );
    }
    const chapters = [
      ...new Set(
        data
          .filter((t) => t.subject === subject && !t.external)
          .map((t) => chapterKey(t.chapter))
          .filter(Boolean),
      ),
    ];
    const select = el("select", {
      "aria-label": "选择课本章节",
      onchange: (e) => {
        draft.chapter = e.target.value;
        confirmed.clear();
        save();
        render();
      },
    });
    select.append(el("option", { value: "", text: "请选择课本章节" }));
    const volumeGroups = new Map();
    chapters.forEach((c) => {
      const representative = data.find((t) => chapterKey(t.chapter) === c);
      const info = E.parseChapter(representative ? representative.chapter : c);
      const volume = info.volume || "其他章节";
      if (!volumeGroups.has(volume)) {
        const group = el("optgroup", { label: volume });
        volumeGroups.set(volume, group);
        select.append(group);
      }
      volumeGroups.get(volume).append(
        el("option", {
          value: c,
          text: [info.chapterNo, info.chapterName].filter(Boolean).join(" "),
        }),
      );
    });
    select.value = draft.chapter;
    box.append(
      el("h3", {
        text:
          tab === "chapter" ? "选择你正在学的章节" : "没有匹配到？按课本章节找",
      }),
      select,
    );
    box.append(
      el(
        "label",
        {},
        "搜索知识点",
        el("input", {
          type: "search",
          value: draft.query,
          placeholder: "例如：一元二次方程",
          oninput: (e) => {
            draft.query = e.target.value;
            save();
          },
          onchange: () => {
            candidates = M.suggestTopics(
              data,
              draft.prompt,
              subject,
              draft.query,
            );
            render();
          },
        }),
      ),
      button("搜索", () => {
        candidates = M.suggestTopics(data, draft.prompt, subject, draft.query);
        render();
      }),
    );
    let choices = draft.chapter
      ? data
          .filter(
            (t) =>
              t.subject === subject &&
              chapterKey(t.chapter) === chapterKey(draft.chapter) &&
              !t.external,
          )
          .map((t) => ({ id: t.id, reasons: ["所选章节"] }))
      : candidates;
    box.append(
      el("h3", { text: "可能相关，请确认" }),
      el("p", {
        class: "note",
        text: "本机按名称与词语查找，并未理解任意题目或诊断错因。只勾选你想练的知识点。",
      }),
    );
    if (!choices.length)
      box.append(
        el("p", {
          class: "empty",
          text: "输入题目后查找，或选择章节、搜索名称。暂未匹配到时不自动猜测。",
        }),
      );
    choices.forEach((c) => {
      const t = graph.byId[c.id];
      if (t)
        box.append(
          el(
            "label",
            { class: "candidate" },
            el("input", {
              type: "checkbox",
              checked: confirmed.has(t.id),
              "data-topic-id": t.id,
              onchange: (e) => {
                e.target.checked ? confirmed.add(t.id) : confirmed.delete(t.id);
                save();
                const selection = $("selected-topics");
                if (selection)
                  selection.textContent =
                    "已选择：" +
                    ([...confirmed]
                      .map((id) => (graph.byId[id] || {}).name)
                      .filter(Boolean)
                      .join("、") || "尚未选择");
              },
            }),
            t.name,
            el("small", {
              text: t.chapter + " · " + (c.reasons || []).join("；"),
            }),
          ),
        );
    });
    box.append(
      el("p", {
        class: "note",
        id: "selected-topics",
        text:
          "已选择：" +
          ([...confirmed]
            .map((id) => (graph.byId[id] || {}).name)
            .filter(Boolean)
            .join("、") || "尚未选择"),
      }),
      button("保存任务，开始练习", startTask, true),
    );
    return box;
  }
  function startTask() {
    if (!confirmed.size) return notice("请先勾选并确认至少一个知识点。", true);
    if (tab === "mistake" && !draft.prompt.trim())
      return notice("请先输入题目文字。", true);
    if (draft.ocrNeedsConfirmation && !draft.ocrConfirmed)
      return notice("请先核对识别文字，并勾选确认。", true);
    task = M.createTask({
      learnerId,
      subject,
      kind: tab,
      prompt: tab === "chapter" ? draft.chapter : draft.prompt,
      attempt: draft.attempt,
      topicIds: [...confirmed],
    });
    Object.assign(task, {
      stuck: draft.stuck,
      photoId: draft.photoId,
      reviewDays: 3,
    });
    state.tasks.unshift(task);
    practice = null;
    save();
    nextPractice();
    render();
  }
  function nextPractice() {
    if (!task) return;
    notice("");
    const previous = practice && practice.questionId;
    const shown = task.shownQuestionIds || [];
    if (previous && !shown.includes(previous)) shown.push(previous);
    task.shownQuestionIds = shown;
    const pick = M.pickPractice(graph, task, state.events, {
      excludeQuestionIds: shown.concat((state.exposures || []).map((item) => item.questionId)),
    });
    practice =
      pick.status === "ready"
        ? {
            questionId: pick.questionId,
            topicId: pick.topicId,
            answer: "",
            support: "independent",
            phase:
              M.planReview(task, state.events, Date.now(), task.reviewDays)
                .status === "due"
                ? "review"
                : "practice",
          }
        : { status: pick.status, reason: pick.reason };
    if (practice.questionId && !shown.includes(practice.questionId))
      shown.push(practice.questionId);
    save();
    render();
  }
  function question() {
    return (
      practice &&
      practice.questionId &&
      (graph.bank[practice.topicId] || []).find(
        (q) => q.id === practice.questionId,
      )
    );
  }
  function reveal() {
    practice.support = "solution";
    practice.revealed = true;
    markExposed(practice.questionId);
    save();
    render();
  }
  function record(result, source) {
    const q = question();
    if (!q) return;
    const input = {
      id:
        practice.eventId ||
        "event-" + Date.now() + "-" + Math.random().toString(36).slice(2, 6),
      learnerId,
      subject,
      taskId: task.id,
      topicId: practice.topicId,
      questionId: q.id,
      questionVersion: "1",
      result,
      support: practice.pendingSubmission
        ? practice.pendingSubmission.support
        : practice.support,
      phase: practice.phase,
      at: practice.pendingSubmission
        ? practice.pendingSubmission.at
        : new Date().toISOString(),
      sessionId,
      answer: practice.pendingSubmission
        ? practice.pendingSubmission.answer
        : practice.answer,
      gradingSource: source,
    };
    if (practice.eventId)
      state.events = M.replaceAttempt(state.events, practice.eventId, {
        result,
        gradingSource: source,
      });
    else state.events = M.recordAttempt(state.events, input);
    if (!practice.eventId) practice.submittedSupport = input.support;
    practice.eventId = input.id;
    practice.verdict = result;
    save();
    render();
  }
  function submit() {
    if (practice.eventId || practice.pendingSubmission) return;
    if (!practice.answer.trim())
      return notice(
        "先写下你的答案或选择一个选项；不会时可选择“暂时不会”。",
        true,
      );
    const verdict = E.judgeQuestion(question(), practice.answer);
    if (verdict.verdict === "manual") {
      practice.manual = true;
      practice.pendingSubmission = {
        answer: practice.answer,
        support: practice.support,
        at: new Date().toISOString(),
      };
      practice.support = "solution";
      practice.revealed = true;
      markExposed(practice.questionId);
      save();
      render();
    } else record(verdict.verdict, "automatic");
  }
  function taskPanel() {
    const summary = M.summarizeTask(task, state.events),
      box = el("section", { class: "card" });
    box.append(
      button("← 返回任务入口", () => {
        task = null;
        practice = null;
        save();
        render();
      }),
      el("h2", {
        text: task.kind === "chapter" ? "正在巩固这一章" : "从这道题继续",
      }),
      el("span", { class: "tag", text: summary.label }),
      el("p", { text: task.prompt }),
    );
    if (task.attempt)
      box.append(
        el("p", { class: "muted", text: "最初的尝试：" + task.attempt }),
      );
    if (task.stuck)
      box.append(
        el("p", { class: "muted", text: "卡住的位置：" + task.stuck }),
      );
    task.topicIds.forEach((id) => {
      const t = graph.byId[id];
      if (!t) return;
      const d = el(
        "details",
        {},
        el("summary", { text: t.name + " · 看掌握标准与样题" }),
        el("p", { text: t.description || "" }),
        el(
          "ul",
          {},
          (t.mastery_criteria || []).map((s) => el("li", { text: s })),
        ),
      );
      if (t.diagnostic_question) {
        const example = el(
          "details",
          {},
          el("summary", { text: "按需打开：原有样题与参考答案" }),
          el("p", { text: t.diagnostic_question.question }),
          el("p", { text: "参考答案：" + t.diagnostic_question.answer }),
        );
        example.addEventListener("toggle", () => {
          if (example.open) {
            const sourceQuestion = (graph.bank[id] || []).find((item) => item.id === id + "_q1");
            if (sourceQuestion) markExposed(sourceQuestion.id);
            if (practice && !practice.eventId && !practice.pendingSubmission) practice.support = "solution";
            if (save()) notice(
              practice && (practice.eventId || practice.pendingSubmission)
                ? "已打开作答后的反馈，保留首次提交时的作答条件。"
                : "已查看样题帮助，本次作答会记为借助帮助。之后可换新题独立检查。",
            );
          }
        });
        d.append(example);
      }
      box.append(d);
    });
    const q = question();
    if (!q) {
      box.append(
        el("div", {
          class: "alert",
          text: (practice && practice.reason) || "开始一道新题检查。",
        }),
        button("寻找未见过的新题", nextPractice, true),
        el("p", {
          class: "note",
          text: "题库用尽时不会凭空生成题目。可以回到入口另选范围，或请老师提供新题。",
        }),
      );
    } else {
      box.append(
        el("h3", {
          text:
            (practice.phase === "review" ? "隔时检查" : "先自己试一试") +
            " · " +
            (graph.byId[practice.topicId] || {}).name,
        }),
        el("p", {
          class: "note",
          text:
            "来源：本地题库 " +
            q.id +
            " · " +
            ({ basic: "基础", standard: "标准", advanced: "提高" }[
              q.difficulty
            ] || "题目") +
            "。自动评分仅作参考。",
        }),
        el("div", { class: "question", text: q.prompt }),
      );
      const stem = figure(q.figure);
      if (stem) box.append(stem);
      if (q.choices)
        q.choices.forEach((c) => {
          const option = button(c.key + (q.hideChoiceText && c.figure ? "" : "．" + c.text), () => {
              practice.answer = c.key;
              save();
              render();
          });
          option.classList.add("choice");
          option.classList.toggle("selected", practice.answer === c.key);
          option.disabled = !!(practice.eventId || practice.pendingSubmission);
          option.setAttribute("aria-label", q.hideChoiceText && c.figure ? "选项 " + c.key : c.key + "．" + c.text);
          const diagram = figure(c.figure);
          if (diagram) option.append(diagram);
          box.append(option);
        });
      box.append(
        field("我的答案 / 解题过程", practice.answer, (v) => {
          practice.answer = v;
          save();
        }, { disabled: !!(practice.eventId || practice.pendingSubmission) }),
      );
      box.append(
        el(
          "div",
          { class: "row" },
          el(
            "button",
            {
              type: "button",
              class: "primary",
              disabled: !!(practice.eventId || practice.pendingSubmission),
              onclick: submit,
            },
            practice.eventId
              ? "本次已提交"
              : practice.pendingSubmission
                ? "已提交，请核对评分"
                : "提交答案",
          ),
          el(
            "button",
            {
              type: "button",
              disabled: !!(practice.eventId || practice.pendingSubmission),
              onclick: () => record("skip", "self"),
            },
            "暂时不会",
          ),
          button(practice.eventId || practice.pendingSubmission ? "查看提交后的解析" : "查看答案与解析（计为有帮助）", reveal),
        ),
      );
      if (practice.manual || practice.revealed)
        box.append(
          el("div", {
            class: "explanation",
            text:
              "参考答案：" +
              (q.type === "choice" ? q.answer + "．" + ((q.choices || []).find((item) => item.key === q.answer) || {}).text : q.answer) +
              "\n" +
              (q.explanation || "题库未提供解析。可请老师一起核对。"),
          }),
        );
      if (practice.manual || practice.eventId)
        box.append(
          el(
            "div",
            { class: "row" },
            el("span", { text: "核对后可自行更正：" }),
            button("判为正确", () => record("correct", "manual")),
            button("判为错误", () => record("wrong", "manual")),
          ),
        );
      if (practice.eventId)
        box.append(
          el("div", {
            class: "alert " + (practice.verdict === "correct" ? "success" : ""),
            text:
              practice.verdict === "correct"
                ? (practice.submittedSupport || practice.support) ===
                  "independent"
                  ? (state.events.find((e) => e.id === practice.eventId) || {})
                      .firstIndependent
                    ? "本次独立答对。仍需不同题目与后续检查。"
                    : "本题重复练习答对，不计作新题独立证据。"
                  : "借助帮助完成。接下来换一道新题独立试试。"
                : practice.verdict === "skip"
                  ? "本次暂时不会，允许查看帮助后再练。"
                  : "本次作答有误，可核对解析与自己的步骤。",
          }),
          button("换一道不同题目独立检查", nextPractice, true),
        );
    }
    if (task.kind === "mistake") {
      const original = el(
        "details",
        {},
        el("summary", { text: "回到原题：重做并解释为什么" }),
        field("我现在的解法与解释", task.originalRedo || "", (v) => {
          task.originalRedo = v;
          save();
        }),
        button("记录原题已重做（自评）", () => {
          task.originalRedoAt = new Date().toISOString();
          if (save())
            notice(
              "已记录原题重做。这是原题完成记录，独立检查需要使用不同题目。",
            );
        }),
      );
      box.append(original);
    }
    const days = el("input", {
      type: "number",
      min: "1",
      max: "365",
      value: task.reviewDays || 3,
      class: "review-days",
      onchange: (e) => {
        task.reviewDays = Math.max(
          1,
          Math.min(365, Number(e.target.value) || 3),
        );
        save();
        render();
      },
    });
    box.append(
      el("h3", { text: "下一次检查" }),
      el("label", {}, "提醒间隔（天）", days),
      el("p", {
        class: "note",
        text:
          summary.review.message +
          (summary.review.dueAt
            ? " · " + new Date(summary.review.dueAt).toLocaleString()
            : "") +
          "。提醒天数可自行调整，并非通用最佳曲线。",
      }),
      historyPanel(),
    );
    return box;
  }
  function taskList() {
    const box = el(
      "section",
      { class: "card" },
      el("h2", { text: "我的任务与复查" }),
    );
    if (!state.tasks.length)
      box.append(
        el("p", {
          class: "empty",
          text: "还没有任务，从一道题或一个章节开始。",
        }),
      );
    state.tasks.forEach((t) => {
      const s = M.summarizeTask(t, state.events),
        n = el(
          "div",
          { class: "task" },
          el("span", { class: "tag", text: s.label }),
          el("strong", { text: (t.prompt || "学习任务").slice(0, 75) }),
          el("small", {
            text:
              s.review.message +
              (s.review.dueAt
                ? " · " + new Date(s.review.dueAt).toLocaleDateString()
                : ""),
          }),
          el(
            "div",
            { class: "row" },
            button(task && task.id === t.id ? "当前任务" : "继续学习", () => {
              task = t;
              practice = t.savedPractice || null;
              if (!practice) nextPractice();
              save();
              render();
            }),
          ),
        );
      box.append(n);
    });
    return box;
  }
  function historyPanel() {
    const box = el("section", {}, el("h3", { text: "实际作答记录" }));
    const trend = M.learningTrend(task, state.events, { groupBy: "day" }),
      events = scopeEvents()
        .filter((e) => e.taskId === task.id)
        .sort((a, b) => b.at.localeCompare(a.at));
    box.append(
      el("p", {
        class: "note",
        text: `共 ${events.length} 次记录。独立首次正确、借助帮助、错误分别展示；同题重复正确另计。空白日期没有作答样本，不连线。`,
      }),
    );
    if (trend.length) box.append(chart(trend));
    events.forEach((e) => {
      const n = el(
        "div",
        { class: "record" },
        el("strong", {
          text:
            {
              correct:
                e.support === "independent"
                  ? e.firstIndependent
                    ? "独立首次正确"
                    : "重复题正确"
                  : "借助帮助完成",
              wrong: "错误",
              skip: "暂时不会",
            }[e.result] +
            " · " +
            e.questionId,
        }),
        el("div", {
          text:
            new Date(e.at).toLocaleString() +
            " · " +
            (e.gradingSource === "automatic" ? "自动评分" : "人工自评/更正") +
            " · " +
            (e.phase === "review" ? "复查" : "练习"),
        }),
        el("div", { text: "作答：" + (e.answer || "未填写") }),
      );
      n.append(
        el(
          "div",
          { class: "row" },
          button("改为正确", () => {
            state.events = M.replaceAttempt(state.events, e.id, {
              result: "correct",
              gradingSource: "manual",
            });
            if (practice && practice.eventId === e.id)
              practice.verdict = "correct";
            save();
            render();
          }),
          button("改为错误", () => {
            state.events = M.replaceAttempt(state.events, e.id, {
              result: "wrong",
              gradingSource: "manual",
            });
            if (practice && practice.eventId === e.id)
              practice.verdict = "wrong";
            save();
            render();
          }),
          button("删除这条记录", () => {
            state.events = M.removeAttempt(state.events, e.id);
            if (practice && practice.eventId === e.id) {
              delete practice.eventId;
              delete practice.verdict;
            }
            save();
            render();
          }),
        ),
      );
      box.append(n);
    });
    return box;
  }
  function chart(rows) {
    const ns = "http://www.w3.org/2000/svg",
      svg = document.createElementNS(ns, "svg");
    svg.setAttribute(
      "viewBox",
      `0 0 600 ${Math.max(100, rows.length * 38 + 45)}`,
    );
    svg.setAttribute("class", "chart");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      "每天实际作答次数，独立首次正确、借助帮助、错误、跳过及重复正确，按颜色分段",
    );
    const colors = ["#157a3a", "#cf850b", "#c13939", "#8c96a1", "#5777a0"],
      fields = [
        "independentCorrect",
        "helped",
        "wrong",
        "skipped",
        "repeatedCorrect",
      ],
      max = Math.max(...rows.map((r) => r.attempts), 1);
    const add = (tag, a, text) => {
      const n = document.createElementNS(ns, tag);
      Object.entries(a).forEach(([k, v]) => n.setAttribute(k, v));
      if (text) n.textContent = text;
      svg.append(n);
      return n;
    };
    rows.forEach((r, i) => {
      add("text", { x: 0, y: i * 38 + 24 }, r.key);
      let x = 105;
      fields.forEach((f, j) => {
        const w = (r[f] / max) * 400;
        if (w)
          add("rect", {
            x,
            y: i * 38 + 10,
            width: w,
            height: 20,
            fill: colors[j],
          });
        x += w;
      });
      add("text", { x: x + 8, y: i * 38 + 25 }, String(r.attempts));
    });
    ["独立首次正确", "有帮助", "错误", "跳过", "重复正确"].forEach((t, i) => {
      add("rect", {
        x: i * 118,
        y: rows.length * 38 + 10,
        width: 9,
        height: 9,
        fill: colors[i],
      });
      add("text", { x: i * 118 + 13, y: rows.length * 38 + 20 }, t);
    });
    return svg;
  }
  function exportData() {
    const blob = new Blob(
        [
          JSON.stringify(
            {
              version: 1,
              exportedAt: new Date().toISOString(),
              learnerId,
              subject,
              tasks: state.tasks,
              exposures: state.exposures || [],
              events: state.events,
            },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
      url = URL.createObjectURL(blob),
      a = el("a", {
        href: url,
        download:
          "learning-" +
          subject +
          "-" +
          new Date().toISOString().slice(0, 10) +
          ".json",
      });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  document.addEventListener("paste", (e) => {
    if (task) return;
    const item = [...((e.clipboardData && e.clipboardData.items) || [])].find(
      (i) => i.type.startsWith("image/"),
    );
    if (item) {
      e.preventDefault();
      acceptPhoto(item.getAsFile());
    }
  });
  $("subject").addEventListener("change", () => {
    if (state) save();
    const u = new URL(location.href);
    u.searchParams.set("subject", $("subject").value);
    u.searchParams.delete("target");
    u.searchParams.delete("chapter");
    location.href = u.href;
  });
  (async () => {
    try {
      if (!M || !E) throw Error("学习组件未加载");
      const responses = await Promise.all(
        ["topics", "dependencies", "questions"].map((n) =>
          fetch("../data/" + n + ".json"),
        ),
      );
      responses.forEach((r) => {
        if (!r.ok) throw Error("题库读取失败 HTTP " + r.status);
      });
      const [topics, deps, questions] = await Promise.all(
        responses.map((r) => r.json()),
      );
      data = topics.map((t) =>
        Object.assign({}, t, { subject: E.subjectOf(t) }),
      );
      graph = E.buildGraph(data, deps, questions);
      restore();
      if (params.get("target")) {
        const ids = params
          .get("target")
          .split(",")
          .filter((id) => graph.byId[id] && graph.byId[id].subject === subject);
        if (ids.length) {
          task = null;
          practice = null;
          confirmed = new Set(ids);
          candidates = ids.map((id) => ({
            id,
            reasons: ["从链接导入，请确认"],
          }));
          tab = "chapter";
          draft.chapter = chapterKey(graph.byId[ids[0]].chapter || "");
        }
      }
      if (params.get("chapter")) {
        task = null;
        practice = null;
        tab = "chapter";
        draft.chapter = chapterKey(params.get("chapter"));
      }
      if (params.has("target") || params.has("chapter")) {
        const cleanURL = new URL(location.href);
        cleanURL.searchParams.delete("target");
        cleanURL.searchParams.delete("chapter");
        history.replaceState(null, "", cleanURL.href);
        save();
      }
      chrome();
      render();
    } catch (e) {
      $("root").replaceChildren(
        el("div", {
          class: "card alert",
          text:
            "学习页未能启动：" +
            e.message +
            "。请通过本地 HTTP 服务打开，检查数据文件后刷新。",
        }),
      );
    }
  })();
})();
