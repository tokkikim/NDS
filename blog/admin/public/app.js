// 공부노트 관리 대시보드 (빌드 없이 동작하는 순수 JS)
const view = document.getElementById("view");
const CRITERIA = [
  ["demand", "수요"],
  ["competition", "경쟁여유"],
  ["monetization", "수익성"],
  ["aiResistance", "AI내성"],
  ["breadth", "확장성"],
  ["fit", "적합성"],
];
const state = { tab: "today", date: null, topics: [], curTopic: null, month: null, pendingCategory: null, openPost: null, watching: new Set() };

// ── 도우미 ────────────────────────────────────────────────────────────────

/** 요소 생성. 문자열 자식은 textContent로 넣어 HTML로 해석되지 않게 합니다. */
function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k in el && k !== "list") el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: opts.body && !(opts.body instanceof Blob) ? { "Content-Type": "application/json" } : undefined,
    body: opts.body && !(opts.body instanceof Blob) ? JSON.stringify(opts.body) : opts.body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `오류 ${res.status}`);
  return data;
}

function toast(msg) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.hidden = true), 2600);
}

async function run(fn) {
  try {
    return await fn();
  } catch (e) {
    toast(e.message);
  }
}

function modal(title, body) {
  document.getElementById("modal-title").textContent = title;
  const b = document.getElementById("modal-body");
  b.replaceChildren(body);
  document.getElementById("modal").showModal();
}

function htmlBlock(html, cls = "prose") {
  const div = h("div", { class: cls });
  div.innerHTML = html; // 서버에서 마크다운을 변환한 로컬 콘텐츠
  return div;
}

const verdictClass = (v) => (v === "GO" ? "b-go" : v === "보류" ? "b-hold" : "b-no");
const topicName = (slug) => state.topics.find((t) => t.slug === slug)?.name ?? slug;
const topicColor = (slug) => state.topics.find((t) => t.slug === slug)?.color ?? "#888";

// ── 작업(백그라운드) ───────────────────────────────────────────────────────

/** 작업 경과 시간 (예: 3분 12초) */
function elapsedText(j) {
  const sec = Math.max(0, Math.round(((j.finishedAt ? Date.parse(j.finishedAt) : Date.now()) - Date.parse(j.startedAt)) / 1000));
  return sec < 60 ? `${sec}초` : `${Math.floor(sec / 60)}분 ${sec % 60}초`;
}

function watchJob(job) {
  state.watching.add(job.id);
  toast(`작업 시작: ${job.label}`);
  renderJobs();
}

async function renderJobs() {
  const jobs = await api("/api/jobs").catch(() => []);
  const panel = document.getElementById("jobs");
  const visible = jobs.filter((j) => j.status === "running" || state.watching.has(j.id));
  panel.hidden = visible.length === 0;
  panel.replaceChildren(
    h("div", { class: "row", style: "justify-content:space-between" }, h("strong", {}, "작업"), h("button", { class: "icon", onclick: () => (state.watching.clear(), renderJobs()) }, "지우기")),
    ...visible.map((j) =>
      h(
        "div",
        { class: "job", onclick: () => showJob(j.id) },
        h(
          "div",
          { class: "row" },
          h("span", { class: `badge ${j.status === "done" ? "b-go" : j.status === "failed" ? "b-no" : "b-hold"}` }, { running: "실행 중", done: "완료", failed: "실패", stopped: "중지됨" }[j.status]),
          j.label,
          h("span", { class: "muted small" }, elapsedText(j)),
          j.status === "running"
            ? h(
                "button",
                {
                  class: "icon small",
                  title: "작업 중지",
                  onclick: (e) => {
                    e.stopPropagation();
                    if (confirm(`"${j.label}" 작업을 중지할까요? 쓰던 파일은 이전 상태로 되돌려집니다.`)) run(async () => (await api(`/api/jobs/${j.id}/stop`, { method: "POST" }), renderJobs()));
                  },
                },
                "■ 중지",
              )
            : null,
        ),
        h("pre", {}, j.tail.split("\n").slice(-3).join("\n")),
      ),
    ),
  );
  // 방금 끝난 작업이 있으면 현재 화면을 새로 고칩니다.
  for (const j of visible) {
    if (j.status !== "running" && state.watching.has(j.id) && !renderJobs.finished?.has(j.id)) {
      (renderJobs.finished ??= new Set()).add(j.id);
      toast(`${{ done: "완료", failed: "실패", stopped: "중지됨" }[j.status]}: ${j.label}`);
      render();
    }
  }
}
setInterval(renderJobs, 2500);

async function showJob(id) {
  const job = await api(`/api/jobs/${id}`);
  modal(job.label, h("pre", { class: "log" }, job.log || "(아직 출력 없음)"));
}

// ── 일정 공통 ──────────────────────────────────────────────────────────────

const STATUS_CLASS = { 게시: "b-go", 완료: "b-go", 예약: "b-go", 초안: "b-hold", "작성 중": "b-hold", 오늘: "b-today", 예정: "b-plan", 놓침: "b-no", 여유: "b-plan", "레슨 없음": "b-no", 미배정: "b-plan", "시작 전": "b-plan" };
const statusBadge = (s) => h("span", { class: `badge ${STATUS_CLASS[s] ?? ""}` }, s);
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const weekday = (date) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

const dday = (date) => {
  const n = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10)}T00:00:00Z`)) / 864e5);
  return n > 0 ? `D-${n}` : n === 0 ? "D-DAY" : `D+${-n}`;
};
const pinBadge = (l) => (l?.date ? h("span", { class: "badge b-today", title: "날짜가 고정된 레슨" }, "📌 날짜 고정") : null);

const createDraft = (body) => run(async () => watchJob(await api("/api/draft", { method: "POST", body })));

/** 하루치 할 일 카드 (홈·달력에서 공통 사용) */
function dayDetail(d, { compact = false } = {}) {
  const topic = d.topic;
  const l = d.lesson;
  const canDraft = topic && !d.post && ["오늘", "예정", "놓침", "여유"].includes(d.status);
  return h(
    "div",
    { class: "stack" },
    h("div", { class: "row" }, topic ? h("span", { class: "badge", style: `color:${topic.color}` }, topic.name) : null, statusBadge(d.status), h("span", { class: "muted small" }, `${d.date} (${weekday(d.date)})`)),
    l ? h("div", { class: "row" }, h("span", { class: "muted small" }, `${l.stage} · 레슨 ${l.number}/${l.total}`), pinBadge(l)) : null,
    d.post ? h("strong", {}, d.post.title) : l ? h("strong", {}, l.title) : null,
    l ? h("div", { class: "task" }, h("div", { class: "small muted" }, "할 일"), l.task) : null,
    l && l.keywords.length && !compact ? h("div", { class: "small muted" }, `키워드: ${l.keywords.join(", ")}`) : null,
    d.status === "레슨 없음" ? h("div", { class: "small b-no" }, "커리큘럼 레슨이 모두 배정됐습니다. 커리큘럼 탭에서 레슨을 추가하세요.") : null,
    d.status === "놓침" ? h("div", { class: "small muted" }, "이 날의 레슨은 다음 차례로 자동으로 밀렸습니다.") : null,
    d.status === "여유" ? h("div", { class: "small muted" }, "날짜가 고정된 레슨(📌)을 기다리는 여유일입니다. 자유 주제로 쓰거나 쉬어도 됩니다.") : null,
    h(
      "div",
      { class: "row" },
      h("button", { class: "ghost", onclick: () => (document.getElementById("modal").close(), (state.date = d.date), go("today")) }, "이날 할 일·체크 보기"),
      d.post ? h("button", { class: "ghost", onclick: () => (document.getElementById("modal").close(), openPost(d.post.slug)) }, "글 열기") : null,
      canDraft ? h("button", { class: "primary", onclick: () => (document.getElementById("modal").close(), createDraft({ date: d.date, topic: topic.slug })) }, "AI 초안 만들기") : null,
      canDraft ? h("button", { class: "ghost", onclick: () => (document.getElementById("modal").close(), createDraft({ date: d.date, topic: topic.slug, mode: "template" })) }, "빈 템플릿") : null,
    ),
  );
}

// ── 오늘 ───────────────────────────────────────────────────────────────────

const kstToday = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
const shiftDate = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const koreanDate = (date) => {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}년 ${m}월 ${d}일 (${weekday(date)})`;
};

/** 기록 입력칸: 내용에 맞춰 높이가 늘어납니다. */
function autoGrow(el) {
  const fit = () => {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  };
  el.addEventListener("input", fit);
  requestAnimationFrame(fit);
  return el;
}

/** 입력이 멈추면 저장 (입력할 때마다 저장하지 않도록) */
function debounce(fn, ms = 700) {
  let timer;
  return (...a) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...a), ms);
  };
}

const minutesText = (m) => (m >= 60 ? `${Math.floor(m / 60)}시간${m % 60 ? ` ${m % 60}분` : ""}` : `${m}분`);

const startGuide = (body) =>
  run(async () => {
    watchJob(await api("/api/guide/generate", { method: "POST", body }));
    render(true);
  });

/** 가이드 전체 보기 (준비물·단계 설명·주의할 점·완료 기준·출처) */
function openGuide(t, onToggle) {
  const g = t.guide;
  const section = (title, ...children) => h("section", { class: "guide-section" }, h("h4", {}, title), ...children);
  const steps = h("ol", { class: "guide-steps full" });
  const drawSteps = () =>
    steps.replaceChildren(
      ...g.steps.map((st, i) =>
        h(
          "li",
          { class: t.steps.includes(i) ? "is-checked" : "" },
          h("label", {}, h("input", { type: "checkbox", checked: t.steps.includes(i), onchange: () => (onToggle(i), drawSteps()) }), h("strong", {}, st.title)),
          st.detail ? h("p", {}, st.detail) : null,
        ),
      ),
    );
  drawSteps();
  modal(
    `${t.topic.name} · ${t.day}/${t.days}일차 가이드`,
    h(
      "div",
      { class: "guide-full" },
      h("div", { class: "task big-task" }, t.task),
      h("div", { class: "row small muted" }, h("span", {}, `⏱ 약 ${minutesText(g.minutes)}`), t.lesson ? h("span", {}, `레슨 ${t.lesson.number}/${t.lesson.total} · ${t.lesson.title}`) : null),
      g.why ? h("p", { class: "guide-why" }, g.why) : null,
      g.prepare.length ? section("준비물", h("ul", {}, ...g.prepare.map((x) => h("li", {}, x)))) : null,
      section("따라 하기", steps),
      g.pitfalls.length ? section("⚠ 처음 하는 사람이 자주 하는 실수", h("ul", {}, ...g.pitfalls.map((x) => h("li", {}, x)))) : null,
      g.doneWhen ? section("✅ 이 정도면 오늘은 완료", h("p", {}, g.doneWhen)) : null,
      g.record.length ? section("📝 해보면서 기록할 것", h("ul", {}, ...g.record.map((x) => h("li", {}, x))), h("p", { class: "small muted" }, "답은 오늘 카드의 기록칸에 쓰면 글의 \"직접 해보기\"에 들어갑니다.")) : null,
      g.sources.length ? section("참고", h("ul", {}, ...g.sources.map((x) => h("li", {}, h("a", { href: x.url, target: "_blank", rel: "noopener" }, x.title))))) : null,
      h(
        "div",
        { class: "row" },
        h("button", { class: "ghost small", onclick: () => confirm("이 레슨의 가이드를 다시 만들까요? (1~3분)") && (document.getElementById("modal").close(), startGuide({ topic: t.topic.slug, lesson: t.lesson.id, force: true })) }, "가이드 다시 만들기"),
      ),
    ),
  );
  // 닫으면 카드에 체크 상태를 반영합니다.
  document.getElementById("modal").addEventListener("close", () => render(true), { once: true });
}

async function renderToday() {
  state.date ??= kstToday();
  const v = await api(`/api/today?date=${state.date}`);
  // 새로고침해도 보던 날짜가 유지되도록 주소에 남깁니다.
  history.replaceState(null, "", v.date === v.today ? "#today" : `#today/${v.date}`);
  const doneCount = v.tasks.filter((t) => t.done).length;
  const progress = h("div", { class: "progress big-progress" }, h("span", { style: `width:${(doneCount / Math.max(1, v.tasks.length)) * 100}%` }));
  const counter = h("strong", {}, `${doneCount}/${v.tasks.length}`);
  const streak = h("span", {}, `🔥 연속 실천 ${v.streak}일`);
  const totalMinutes = v.tasks.reduce((n, t) => n + (t.guide?.minutes ?? 0), 0);
  const missingGuides = v.tasks.filter((t) => t.lesson && (!t.guide || t.guideStale) && !t.guideGenerating).length;

  const refreshHeader = () => {
    const n = v.tasks.filter((t) => t.done).length;
    counter.textContent = `${n}/${v.tasks.length}`;
    progress.firstChild.style.width = `${(n / Math.max(1, v.tasks.length)) * 100}%`;
  };
  const saveEntry = (t) =>
    run(async () => {
      const r = await api("/api/daily", { method: "PUT", body: { date: v.date, topic: t.topic.slug, done: t.done, note: t.note, steps: t.steps, answers: t.answers } });
      streak.textContent = `🔥 연속 실천 ${r.streak}일`;
    });

  const card = (t) => {
    // 커리큘럼이 없는 카테고리: 할 일 대신 커리큘럼을 만들러 가는 안내
    if (!t.lesson) {
      return h(
        "div",
        { class: "card today-card", style: `border-top: 5px solid ${t.topic.color}` },
        h("strong", { style: `color:${t.topic.color}` }, t.topic.name),
        h("div", { class: "muted" }, "아직 커리큘럼이 없어서 매일 할 일이 없어요. 커리큘럼을 만들면 레슨마다 할 일과 가이드가 생깁니다."),
        h("button", { class: "primary", onclick: () => ((state.curTopic = t.topic.slug), go("curriculum")) }, "커리큘럼 만들러 가기"),
      );
    }
    const g = t.guide;
    const saveSoon = debounce(() => saveEntry(t));
    const cardEl = h("div", { class: `card today-card${t.done ? " is-done" : ""}`, style: `border-top: 5px solid ${t.topic.color}` });

    // ── 완료 체크 ──
    const check = h("button", { class: "check" });
    const drawCheck = () => {
      const allSteps = g && t.steps.length >= g.steps.length;
      check.className = `check${t.done ? " is-done" : allSteps ? " is-ready" : ""}`;
      check.textContent = t.done ? "✔ 완료" : allSteps ? "모든 단계 끝! 완료 체크" : "완료 체크";
      cardEl.classList.toggle("is-done", t.done);
    };
    check.addEventListener("click", () => {
      t.done = !t.done;
      cardEl.classList.remove("is-open");
      drawCheck();
      refreshHeader();
      saveEntry(t);
    });

    // ── 가이드: 단계 체크리스트 ──
    const stepCount = h("span", { class: "small muted" });
    const stepBar = h("div", { class: "progress step-progress" }, h("span", { style: `background:${t.topic.color}` }));
    const stepList = h("ol", { class: "guide-steps" });
    let openStep = null;
    const toggleStep = (i) => {
      t.steps = t.steps.includes(i) ? t.steps.filter((x) => x !== i) : [...t.steps, i].sort((a, b) => a - b);
      openStep = null;
      drawSteps();
      drawCheck();
      saveEntry(t);
    };
    const drawSteps = () => {
      if (!g) return;
      const n = t.steps.filter((i) => i < g.steps.length).length;
      stepCount.textContent = `따라 하기 ${n}/${g.steps.length}`;
      stepBar.firstChild.style.width = `${(n / g.steps.length) * 100}%`;
      // 아직 안 한 첫 단계의 설명을 펼쳐 둡니다 (지금 할 일에 집중).
      const current = g.steps.findIndex((_, i) => !t.steps.includes(i));
      stepList.replaceChildren(
        ...g.steps.map((st, i) => {
          const checked = t.steps.includes(i);
          const expanded = openStep === null ? i === current : openStep === i;
          return h(
            "li",
            { class: `${checked ? "is-checked" : ""}${i === current ? " is-current" : ""}` },
            h(
              "div",
              { class: "step-row" },
              h("input", { type: "checkbox", checked, "aria-label": st.title, onchange: () => toggleStep(i) }),
              h("button", { class: "step-title", onclick: () => ((openStep = expanded ? -1 : i), drawSteps()) }, st.title),
            ),
            expanded && st.detail ? h("p", { class: "step-detail" }, st.detail) : null,
          );
        }),
      );
    };
    drawSteps();

    const guideArea = g
      ? h(
          "div",
          { class: "guide-area" },
          t.guideStale
            ? h("div", { class: "notice small" }, "커리큘럼이 바뀌어 가이드가 오늘 할 일과 다를 수 있어요. ", h("button", { class: "link", onclick: () => startGuide({ topic: t.topic.slug, lesson: t.lesson.id, force: true }) }, "다시 만들기"))
            : null,
          g.why ? h("div", { class: "guide-why small" }, g.why) : null,
          g.prepare.length ? h("div", { class: "small muted" }, `준비: ${g.prepare.join(" · ")}`) : null,
          h("div", { class: "row", style: "justify-content:space-between" }, stepCount, h("button", { class: "link small", onclick: () => openGuide(t, toggleStep) }, "📖 가이드 크게 보기")),
          stepBar,
          stepList,
          g.pitfalls.length ? h("details", { class: "small" }, h("summary", { class: "muted" }, `⚠ 자주 하는 실수 ${g.pitfalls.length}개`), h("ul", {}, ...g.pitfalls.map((x) => h("li", {}, x)))) : null,
          g.doneWhen ? h("div", { class: "done-when small" }, "✅ ", g.doneWhen) : null,
        )
      : t.lesson
        ? h(
            "div",
            { class: "guide-area guide-empty" },
            t.guideGenerating
              ? h("div", { class: "muted small" }, "⏳ 가이드를 만드는 중이에요 (1~3분). 끝나면 여기에 단계가 나타납니다.")
              : h(
                  "button",
                  { class: "guide-make", onclick: () => startGuide({ topic: t.topic.slug, lesson: t.lesson.id }) },
                  h("strong", {}, "📘 처음이라면: 단계별 가이드 만들기"),
                  h("span", { class: "small muted" }, "준비물 · 따라 할 단계 · 자주 하는 실수 · 기록할 것 (1~3분)"),
                ),
          )
        : null;

    // ── 기록: 가이드의 질문 + 자유 메모 → 글의 "직접 해보기" 재료 ──
    const questions = [...new Set([...(g?.record ?? []), ...Object.keys(t.answers)])];
    const recordArea = h(
      "div",
      { class: "record-area" },
      h("div", { class: "small muted" }, "📝 기록 — 글의 \"직접 해보기\"에 들어갑니다"),
      ...questions.map((q) =>
        h(
          "label",
          { class: "record-q" },
          h("span", { class: "small" }, q),
          autoGrow(
            h("textarea", {
              rows: 1,
              value: t.answers[q] ?? "",
              placeholder: "숫자·비교·느낌을 짧게",
              oninput: (e) => ((t.answers = { ...t.answers, [q]: e.target.value }), saveSoon()),
            }),
          ),
        ),
      ),
      autoGrow(
        h("textarea", {
          rows: questions.length ? 1 : 2,
          value: t.note,
          placeholder: questions.length ? "그 밖에 해본 것·느낀 점" : "오늘 해본 것·기록·느낀 점",
          oninput: (e) => ((t.note = e.target.value), saveSoon()),
        }),
      ),
    );

    const answered = questions.filter((q) => t.answers[q]?.trim()).length + (t.note?.trim() ? 1 : 0);
    const postArea = t.isPostDay
      ? h(
          "div",
          { class: "post-day" },
          h("div", { class: "row" }, h("strong", {}, "✍ 오늘은 이 레슨 글 쓰는 날"), t.post?.status ? statusBadge(t.post.status) : null),
          t.post?.slug
            ? h("button", { class: "ghost", onclick: () => openPost(t.post.slug) }, `글 열기: ${t.post.title}`)
            : h(
                "div",
                { class: "row" },
                h("button", { class: "primary", onclick: () => createDraft({ date: v.date, topic: t.topic.slug }) }, "AI 초안 만들기"),
                h("button", { class: "ghost", onclick: () => createDraft({ date: v.date, topic: t.topic.slug, mode: "template" }) }, "빈 템플릿"),
                h("span", { class: "muted small" }, "이 레슨 기간의 기록과 가이드가 초안에 들어갑니다. 기록을 먼저 남기면 글이 좋아져요."),
              ),
        )
      : t.postDate
        ? h("div", { class: "muted small" }, `✍ 이 레슨 글은 ${t.postDate.slice(5).replace("-", "/")} (${weekday(t.postDate)})에 씁니다`)
        : null;

    drawCheck();
    cardEl.append(
      ...[
        h(
          "div",
          { class: "row", style: "justify-content:space-between" },
          h("strong", { style: `color:${t.topic.color}` }, t.topic.name),
          h(
            "span",
            { class: "row small muted", style: "gap:8px" },
            t.lesson ? h("span", {}, `레슨 ${t.lesson.number}/${t.lesson.total}`) : null,
            h("button", { class: "link small done-toggle", onclick: (e) => (e.target.textContent = cardEl.classList.toggle("is-open") ? "접기" : "기록 보기") }, "기록 보기"),
          ),
        ),
        t.lesson ? h("div", { class: "lesson-title" }, t.lesson.title, t.lesson.date ? h("span", { class: "badge b-today", style: "margin-left:6px" }, "📌") : null) : null,
        h(
          "div",
          { class: "task big-task" },
          h("div", { class: "small muted" }, `오늘 할 일 · ${t.day}/${t.days}일차${g ? ` · ⏱ 약 ${minutesText(g.minutes)}` : ""}`),
          t.task,
          t.done && answered ? h("div", { class: "small muted" }, `📝 기록 ${answered}개`) : null,
        ),
        t.lesson ? h("details", { class: "lesson-goal" }, h("summary", { class: "small muted" }, "이 레슨의 목표 보기"), h("div", { class: "small" }, t.lesson.task), h("div", { class: "small muted" }, t.lesson.stage)) : null,
        guideArea,
        recordArea,
        check,
        postArea,
      ].filter(Boolean),
    );
    return cardEl;
  };

  const goDate = (d) => {
    state.date = d;
    render(true);
  };

  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "row", style: "justify-content:space-between" },
      h(
        "div",
        { class: "row" },
        h("button", { class: "icon", title: "전날", onclick: () => goDate(shiftDate(v.date, -1)) }, "‹"),
        h("h2", { style: "margin:0" }, v.date === v.today ? `오늘 · ${koreanDate(v.date)}` : koreanDate(v.date)),
        h("button", { class: "icon", title: "다음날", onclick: () => goDate(shiftDate(v.date, 1)) }, "›"),
        v.date !== v.today ? h("button", { class: "ghost small", onclick: () => goDate(v.today) }, "오늘로") : null,
      ),
      h("div", { class: "row small" }, streak, ...v.events.map((e) => h("span", { class: "badge", style: `color:${e.topic.color}` }, `🏁 ${e.event.name} ${dday(e.event.date)}`))),
    ),
    h(
      "div",
      { class: "card row", style: "gap:14px" },
      h("span", {}, "오늘 실천"),
      counter,
      h("div", { style: "flex:1;min-width:120px" }, progress),
      totalMinutes ? h("span", { class: "small muted", title: "가이드가 있는 할 일의 예상 시간 합계" }, `⏱ 약 ${minutesText(totalMinutes)}`) : null,
      missingGuides ? h("button", { class: "ghost small", onclick: () => startGuide({ date: v.date }) }, `📘 가이드 한 번에 만들기 (${missingGuides})`) : null,
    ),
    v.date < v.startDate
      ? h("div", { class: "notice" }, `순환은 ${koreanDate(v.startDate)}부터 시작해요. 지금은 첫날 할 일을 미리 보는 중입니다. 가이드를 미리 만들어 두면 좋아요.`)
      : null,
    h("div", { class: "today-grid" }, ...v.tasks.map(card)),
    h("h3", {}, "이번 주 실천"),
    h(
      "div",
      { class: "week" },
      ...v.week.map((d) =>
        h(
          "button",
          { class: `card week-day${d.date === v.date ? " is-selected" : ""}`, onclick: () => goDate(d.date) },
          h("div", { class: "small muted" }, `${d.date.slice(5).replace("-", "/")} (${weekday(d.date)})`),
          h("div", { class: "dots" }, ...d.topics.map((t) => h("i", { style: t.done ? `background:${t.color};border-color:${t.color}` : `border-color:${t.color}` }))),
        ),
      ),
    ),
  );
}

// ── 달력 ───────────────────────────────────────────────────────────────────

async function renderCalendar() {
  const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 7);
  state.month ??= today;
  const cal = await api(`/api/calendar?month=${state.month}`);
  const shift = (n) => {
    const [y, m] = state.month.split("-").map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    state.month = d.toISOString().slice(0, 7);
    render(true);
  };
  const lead = new Date(`${cal.days[0].date}T00:00:00Z`).getUTCDay();
  const counts = cal.days.filter((d) => d.topic).reduce((acc, d) => ((acc[d.status] = (acc[d.status] ?? 0) + 1), acc), {});

  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "row", style: "justify-content:space-between" },
      h("h2", { style: "margin:0" }, `${state.month.slice(0, 4)}년 ${Number(state.month.slice(5))}월`),
      h("div", { class: "row" }, h("button", { class: "ghost", onclick: () => shift(-1) }, "‹ 이전"), h("button", { class: "ghost", onclick: () => ((state.month = today), render(true)) }, "이번 달"), h("button", { class: "ghost", onclick: () => shift(1) }, "다음 ›")),
    ),
    h("div", { class: "row small muted" }, ...Object.entries(counts).map(([k, v]) => h("span", {}, statusBadge(k), ` ${v}일`))),
    h(
      "div",
      { class: "calendar" },
      ...WEEKDAYS.map((w) => h("div", { class: "cal-head" }, w)),
      ...Array.from({ length: lead }, () => h("div", {})),
      ...cal.days.map((d) =>
        h(
          "div",
          {
            class: `cal-day${d.date === cal.today ? " is-today" : ""}${d.date < cal.today ? " is-past" : ""}${d.topic ? "" : " is-empty"}`,
            style: d.topic ? `border-top: 4px solid ${d.topic.color}` : "",
            onclick: d.topic ? () => modal(`${d.date} (${weekday(d.date)}) 할 일`, dayDetail(d)) : null,
          },
          h("div", { class: "row", style: "justify-content:space-between" }, h("strong", {}, Number(d.date.slice(8))), d.topic ? statusBadge(d.status) : null),
          d.topic ? h("div", { class: "small", style: `color:${d.topic.color};font-weight:700` }, d.topic.name) : null,
          h("div", { class: "small clamp" }, `${d.lesson?.date && !d.post ? "📌 " : ""}${d.post?.title ?? d.lesson?.title ?? ""}`),
          d.topic && d.date <= cal.today ? h("div", { class: "dots", title: "매일 실천 체크" }, ...d.practice.map((p) => h("i", { style: p.done ? `background:${p.color};border-color:${p.color}` : `border-color:${p.color}` }))) : null,
        ),
      ),
    ),
    h("p", { class: "muted small" }, "📌는 대회 당일·접수일처럼 날짜가 고정된 레슨입니다. 날짜를 누르면 그날의 할 일을 보고 초안을 만들 수 있습니다. 지난 날 글을 쓰지 못하면 그 레슨은 같은 카테고리의 다음 차례로 자동으로 밀립니다."),
  );
}

// ── 카테고리 ───────────────────────────────────────────────────────────────

async function renderCategories() {
  const data = await api("/api/categories");
  const rows = data.topics.map((t) => ({ ...t, isNew: false }));
  if (state.pendingCategory) {
    rows.push({ slug: "", name: state.pendingCategory.name, description: state.pendingCategory.description, color: "#7a5af8", posts: 0, isNew: true });
    state.pendingCategory = null;
    toast("시장분석 주제를 새 카테고리로 추가했습니다. 영문 주소 이름을 정하고 저장하세요");
  }
  const start = h("input", { type: "date", value: data.startDate });
  const list = h("div", { class: "stack" });

  const draw = () =>
    list.replaceChildren(
      ...rows.map((t, i) =>
        h(
          "div",
          { class: "plan-item" },
          h("span", { class: "num" }, i + 1),
          h("input", { type: "color", value: t.color, oninput: (e) => (t.color = e.target.value) }),
          h(
            "div",
            { class: "body stack" },
            h(
              "div",
              { class: "row" },
              h("input", { type: "text", value: t.name, placeholder: "이름 (예: 마라톤)", oninput: (e) => (t.name = e.target.value) }),
              h("input", { type: "text", value: t.slug, placeholder: "주소용 영문 (예: marathon)", readOnly: !t.isNew, title: t.isNew ? "" : "만든 뒤에는 바꿀 수 없습니다 (글·커리큘럼 주소)", style: "max-width:200px", oninput: (e) => (t.slug = e.target.value.trim()) }),
            ),
            h("input", { type: "text", value: t.description, placeholder: "한 줄 설명 (블로그 카테고리 페이지에 표시)", style: "width:100%", oninput: (e) => (t.description = e.target.value) }),
            h("div", { class: "muted small" }, `글 ${t.posts ?? 0}개${t.isNew ? " · 새 카테고리" : ""}`),
          ),
          h(
            "div",
            { class: "actions" },
            h("button", { class: "icon", disabled: i === 0, onclick: () => ([rows[i - 1], rows[i]] = [rows[i], rows[i - 1]], draw()) }, "↑"),
            h("button", { class: "icon", disabled: i === rows.length - 1, onclick: () => ([rows[i + 1], rows[i]] = [rows[i], rows[i + 1]], draw()) }, "↓"),
            h("button", { class: "icon", disabled: t.posts > 0, title: t.posts > 0 ? "글이 있는 카테고리는 지울 수 없습니다" : "삭제", onclick: () => confirm(`"${t.name}" 카테고리를 지울까요?`) && (rows.splice(i, 1), draw()) }, "✕"),
          ),
        ),
      ),
    );
  draw();

  const save = () =>
    run(async () => {
      await api("/api/categories", { method: "PUT", body: { startDate: start.value, topics: rows.map(({ slug, name, description, color }) => ({ slug, name, description, color })) } });
      state.topics = await api("/api/topics");
      toast("저장했습니다");
      render(true);
    });

  return h(
    "div",
    { class: "stack" },
    h("h2", {}, "카테고리"),
    h("p", { class: "muted small" }, "위에서부터 순서대로 하루씩 돌아가며 씁니다. 시작일이 첫 번째 카테고리의 날입니다. 순서·시작일을 바꾸면 오늘 이후 달력이 다시 계산됩니다."),
    h("div", { class: "card row" }, h("span", {}, "순환 시작일"), start),
    list,
    h(
      "div",
      { class: "row" },
      h("button", { class: "ghost", onclick: () => (rows.push({ slug: "", name: "", description: "", color: "#7a5af8", posts: 0, isNew: true }), draw()) }, "+ 카테고리 추가"),
      h("button", { class: "primary", onclick: save }, "저장"),
    ),
  );
}

// ── 커리큘럼 ───────────────────────────────────────────────────────────────

async function renderCurriculum() {
  if (!state.topics.some((t) => t.slug === state.curTopic)) state.curTopic = state.topics[0]?.slug;
  const { topic, curriculum, lessonStatus, guides } = await api(`/api/curriculum?topic=${state.curTopic}`);
  const tabs = h("div", { class: "row" }, ...state.topics.map((t) => h("button", { class: t.slug === state.curTopic ? "primary" : "ghost", onclick: () => ((state.curTopic = t.slug), render(true)) }, t.name)));
  const count = h("input", { type: "number", value: 30, min: 5, max: 60, style: "width:80px" });
  const generate = (append) =>
    run(async () => {
      if (!append && curriculum && !confirm("커리큘럼을 AI로 다시 설계할까요? 이미 글로 쓴 레슨은 그대로 유지됩니다.")) return;
      watchJob(await api("/api/curriculum/generate", { method: "POST", body: { topic: topic.slug, lessons: Number(count.value), append } }));
    });

  if (!curriculum) {
    return h(
      "div",
      { class: "stack" },
      h("h2", {}, "커리큘럼"),
      tabs,
      h(
        "div",
        { class: "card stack" },
        h("strong", {}, `${topic.name} 커리큘럼이 아직 없습니다`),
        h("div", { class: "muted small" }, "AI가 프로필·시장분석·검색 데이터를 보고 단계별 레슨을 설계합니다. 레슨 1개 = 글 1편 = 카테고리 차례 사이의 실천입니다."),
        h("div", { class: "row" }, h("span", {}, "레슨"), count, h("span", {}, "개로"), h("button", { class: "primary", onclick: () => generate(false) }, "AI로 커리큘럼 만들기")),
        h("button", { class: "ghost", onclick: () => save({ topic: topic.slug, goal: "", level: "", stages: [{ title: "1단계", goal: "", lessons: [] }] }) }, "직접 만들기 (빈 커리큘럼)"),
      ),
    );
  }

  const c = structuredClone(curriculum);
  async function save(next) {
    await run(async () => {
      await api(`/api/curriculum?topic=${topic.slug}`, { method: "PUT", body: next });
      render(true);
    });
  }
  const lessons = c.stages.flatMap((s) => s.lessons);
  const st = (id) => lessonStatus[id] ?? { status: "미배정" };
  const done = lessons.filter((l) => st(l.id).status === "완료").length;
  const writing = lessons.filter((l) => st(l.id).status === "작성 중").length;
  const lastDate = lessons.map((l) => st(l.id).date).filter(Boolean).sort().pop();

  const editLesson = (stage, i) => {
    const l = stage.lessons[i] ?? { id: "", title: "", task: "", keywords: [] };
    const title = h("input", { type: "text", value: l.title, style: "width:100%" });
    const task = h("textarea", { rows: 4, value: l.task });
    const keywords = h("input", { type: "text", value: l.keywords.join(", "), style: "width:100%" });
    const fixed = h("input", { type: "date", value: l.date ?? "" });
    const daily = h("textarea", { rows: 4, value: (l.daily ?? []).join("\n"), placeholder: "1일차 할 일\n2일차 할 일\n마지막 날(글 쓰는 날) 할 일" });
    modal(
      i < stage.lessons.length ? "레슨 수정" : "레슨 추가",
      h(
        "div",
        { class: "stack", style: "padding-top:12px" },
        h("label", { class: "small muted" }, "제목 (글 제목 후보)"),
        title,
        h("label", { class: "small muted" }, "할 일 (다음 차례까지 실제로 할 것)"),
        task,
        h("label", { class: "small muted" }, "매일 할 일 (한 줄에 하루씩, 마지막 줄이 글 쓰는 날)"),
        daily,
        h("label", { class: "small muted" }, "키워드 (쉼표로 구분)"),
        keywords,
        h("label", { class: "small muted" }, "날짜 고정 (대회 당일·접수일처럼 꼭 그날 써야 하는 레슨만. 비우면 순서대로 배정)"),
        fixed,
        h(
          "button",
          {
            class: "primary",
            onclick: () => {
              const days = daily.value.split("\n").map((d) => d.trim()).filter(Boolean);
              stage.lessons[i] = { id: l.id, title: title.value, task: task.value, keywords: keywords.value.split(",").map((k) => k.trim()).filter(Boolean), ...(fixed.value ? { date: fixed.value } : {}), ...(days.length ? { daily: days } : {}) };
              document.getElementById("modal").close();
              save(c);
            },
          },
          "저장",
        ),
      ),
    );
  };
  const editStage = (si) => {
    const s = c.stages[si] ?? { title: `${c.stages.length + 1}단계: `, goal: "", lessons: [] };
    const title = h("input", { type: "text", value: s.title, style: "width:100%" });
    const goal = h("input", { type: "text", value: s.goal, style: "width:100%" });
    modal(
      si < c.stages.length ? "단계 수정" : "단계 추가",
      h(
        "div",
        { class: "stack", style: "padding-top:12px" },
        h("label", { class: "small muted" }, "단계 이름"),
        title,
        h("label", { class: "small muted" }, "단계 목표"),
        goal,
        h("button", { class: "primary", onclick: () => ((c.stages[si] = { ...s, title: title.value, goal: goal.value }), document.getElementById("modal").close(), save(c)) }, "저장"),
      ),
    );
  };
  const editEvent = () => {
    const e = c.event ?? { name: "", date: "", registrationDate: "", url: "" };
    const name = h("input", { type: "text", value: e.name, placeholder: "예: 2027 대구마라톤", style: "width:100%" });
    const date = h("input", { type: "date", value: e.date });
    const reg = h("input", { type: "date", value: e.registrationDate ?? "" });
    const url = h("input", { type: "text", value: e.url ?? "", placeholder: "공식 페이지 주소", style: "width:100%" });
    modal(
      "목표 대회·날짜",
      h(
        "div",
        { class: "stack", style: "padding-top:12px" },
        h("div", { class: "muted small" }, "대회·시험처럼 날짜가 정해진 목표입니다. 바꾼 뒤 \"다시 설계\"를 누르면 이 날짜에 맞춰 레슨 수와 훈련 주기를 다시 계산하고, 접수일·대회 당일 레슨을 그 날짜에 고정합니다."),
        h("label", { class: "small muted" }, "대회 이름"),
        name,
        h("label", { class: "small muted" }, "대회 날짜"),
        date,
        h("label", { class: "small muted" }, "접수 시작일 (선택)"),
        reg,
        h("label", { class: "small muted" }, "공식 페이지 (선택)"),
        url,
        h(
          "div",
          { class: "row" },
          h(
            "button",
            {
              class: "primary",
              onclick: () => {
                if (!name.value.trim() || !date.value) return toast("대회 이름과 날짜를 입력하세요");
                c.event = { name: name.value.trim(), date: date.value, ...(reg.value ? { registrationDate: reg.value } : {}), ...(url.value.trim() ? { url: url.value.trim() } : {}) };
                document.getElementById("modal").close();
                save(c);
              },
            },
            "저장",
          ),
          c.event ? h("button", { class: "ghost", onclick: () => (delete c.event, document.getElementById("modal").close(), save(c)) }, "목표 대회 없애기") : null,
        ),
      ),
    );
  };
  const editGoal = () => {
    const goal = h("input", { type: "text", value: c.goal, style: "width:100%" });
    const level = h("input", { type: "text", value: c.level, style: "width:100%" });
    modal(
      "커리큘럼 목표",
      h(
        "div",
        { class: "stack", style: "padding-top:12px" },
        h("label", { class: "small muted" }, "최종 목표"),
        goal,
        h("label", { class: "small muted" }, "출발 수준"),
        level,
        h("button", { class: "primary", onclick: () => ((c.goal = goal.value), (c.level = level.value), document.getElementById("modal").close(), save(c)) }, "저장"),
      ),
    );
  };

  let n = 0;
  const currentStage = Math.max(0, c.stages.findIndex((s) => s.lessons.some((l) => st(l.id).status !== "완료")));
  return h(
    "div",
    { class: "stack" },
    h("h2", {}, "커리큘럼"),
    tabs,
    h(
      "div",
      { class: "card stack", style: `border-left:4px solid ${topic.color}` },
      h("div", { class: "row", style: "justify-content:space-between;flex-wrap:nowrap;align-items:flex-start" }, h("strong", { class: "clamp3", title: "눌러서 전체 보기", onclick: (e) => e.currentTarget.classList.toggle("clamp3") }, c.goal || "(목표 없음)"), h("button", { class: "icon", style: "flex:none", onclick: editGoal }, "✎ 목표 수정")),
      h("div", { class: "muted small clamp3", onclick: (e) => e.currentTarget.classList.toggle("clamp3") }, `출발 수준: ${c.level || "-"}`),
      h(
        "div",
        { class: "row" },
        c.event
          ? h(
              "span",
              {},
              h("strong", {}, `🏁 ${c.event.name}`),
              ` · ${c.event.date} (${weekday(c.event.date)}) `,
              h("span", { class: "badge b-today" }, dday(c.event.date)),
              c.event.registrationDate ? ` · 접수 ${c.event.registrationDate} ${dday(c.event.registrationDate)}` : "",
              c.event.url ? [" · ", h("a", { href: c.event.url, target: "_blank", rel: "noopener" }, "공식 페이지")] : "",
            )
          : h("span", { class: "muted small" }, "목표 대회·날짜 없음"),
        h("button", { class: "icon", onclick: editEvent }, c.event ? "✎ 대회 수정" : "+ 목표 대회 설정"),
      ),
      h("div", { class: "progress" }, h("span", { style: `width:${lessons.length ? (done / lessons.length) * 100 : 0}%;background:${topic.color}` })),
      h("div", { class: "small" }, `레슨 ${lessons.length}개 · 완료 ${done} · 작성 중 ${writing}${lastDate ? ` · 예상 종료 ${lastDate}` : ""}`),
      h(
        "div",
        { class: "row" },
        h("span", { class: "small" }, "AI로 레슨"),
        count,
        h("span", { class: "small" }, "개"),
        h("button", { class: "ghost", onclick: () => generate(true) }, "이어서 추가"),
        h("button", { class: "ghost", onclick: () => generate(false) }, "다시 설계"),
        lessons.some((l) => !l.daily?.length)
          ? h(
              "button",
              { class: "primary", onclick: () => run(async () => watchJob(await api("/api/curriculum/generate", { method: "POST", body: { topic: topic.slug, daily: true } }))) },
              `AI로 매일 할 일 채우기 (${lessons.filter((l) => !l.daily?.length).length}개 레슨)`,
            )
          : null,
      ),
    ),
    ...c.stages.map((s, si) => {
      const stageDone = s.lessons.filter((l) => st(l.id).status === "완료").length;
      const dates = s.lessons.map((l) => st(l.id).date).filter(Boolean).sort();
      // 지금 진행 중인 단계(아직 끝나지 않은 첫 단계)만 펼쳐 둡니다.
      const isCurrent = si === currentStage;
      const stop = (fn) => (e) => (e.preventDefault(), e.stopPropagation(), fn());
      return h(
        "details",
        { class: "stage", open: isCurrent },
        h(
          "summary",
          {},
          h(
            "div",
            { class: "stage-head" },
            h(
              "div",
              { style: "min-width:0" },
              h("h3", { style: "margin:0" }, s.title, isCurrent ? h("span", { class: "badge b-today", style: "margin-left:8px" }, "진행 중") : null),
              h("div", { class: "muted small" }, `레슨 ${s.lessons.length}개 · 완료 ${stageDone}${dates.length ? ` · ${dates[0]} ~ ${dates[dates.length - 1]}` : ""}`),
              s.goal ? h("div", { class: "muted small" }, `목표: ${s.goal}`) : null,
            ),
            h(
              "div",
              { class: "row", style: "flex:none" },
              h("button", { class: "icon", title: "단계 수정", onclick: stop(() => editStage(si)) }, "✎"),
              h("button", { class: "icon", disabled: s.lessons.some((l) => st(l.id).status === "완료" || st(l.id).status === "작성 중"), title: "단계 삭제", onclick: stop(() => confirm(`"${s.title}" 단계와 레슨 ${s.lessons.length}개를 지울까요?`) && (c.stages.splice(si, 1), save(c))) }, "✕"),
            ),
          ),
        ),
        h(
          "div",
          { class: "stack stage-body" },
          ...s.lessons.map((l, i) => {
            const info = st(l.id);
            const locked = info.status === "완료" || info.status === "작성 중";
            n++;
            return h(
              "div",
              { class: "plan-item" },
              h("span", { class: "num" }, n),
              h(
                "div",
                { class: "body" },
                h("div", { class: "row" }, h("strong", {}, l.title), statusBadge(info.status), pinBadge(l), guides?.[l.id] ? h("span", { class: "badge b-go", title: "매일 할 일 가이드가 있습니다" }, "📘 가이드") : null, info.date ? h("span", { class: "muted small" }, `${info.date} (${weekday(info.date)})`) : null),
                h("div", { class: "small" }, `목표: ${l.task}`),
                l.daily?.length ? h("ol", { class: "daily-list small" }, ...l.daily.map((d) => h("li", {}, d))) : h("div", { class: "small b-no" }, "매일 할 일 없음"),
                l.keywords.length ? h("div", { class: "muted small" }, l.keywords.join(" · ")) : null,
              ),
              h(
                "div",
                { class: "actions" },
                h("button", { class: "icon", disabled: i === 0, title: "위로", onclick: () => ([s.lessons[i - 1], s.lessons[i]] = [s.lessons[i], s.lessons[i - 1]], save(c)) }, "↑"),
                h("button", { class: "icon", disabled: i === s.lessons.length - 1, title: "아래로", onclick: () => ([s.lessons[i + 1], s.lessons[i]] = [s.lessons[i], s.lessons[i + 1]], save(c)) }, "↓"),
                h("button", { class: "icon", title: "레슨 수정", onclick: () => editLesson(s, i) }, "✎"),
                h("button", { class: "icon", disabled: locked, title: locked ? "글로 쓴 레슨은 지울 수 없습니다" : "삭제", onclick: () => confirm(`"${l.title}" 레슨을 지울까요?`) && (s.lessons.splice(i, 1), save(c)) }, "✕"),
              ),
            );
          }),
          h("button", { class: "ghost small", onclick: () => editLesson(s, s.lessons.length) }, "+ 레슨 추가"),
        ),
      );
    }),
    h("button", { class: "ghost", onclick: () => editStage(c.stages.length) }, "+ 단계 추가"),
  );
}

// ── 시장분석 ───────────────────────────────────────────────────────────────

async function renderResearch() {
  const keywords = await renderKeywords();
  const [groups, jobs] = await Promise.all([api("/api/research"), api("/api/jobs")]);
  const busy = new Set(jobs.filter((j) => j.kind === "research" && j.status === "running").flatMap((j) => j.topics ?? []));
  const reanalyze = (topics) =>
    run(async () => {
      watchJob(await api("/api/research", { method: "POST", body: { topics } }));
      render(true);
    });
  const change = (r) => {
    if (!r.prev) return h("span", { class: "muted small" }, "—");
    const d = r.total - r.prev.total;
    const mode = r.prev.dataMode !== r.dataMode ? ` (${r.prev.dataMode === "naver" ? "실측" : "추정"}→${r.dataMode === "naver" ? "실측" : "추정"})` : "";
    return h(
      "span",
      { class: `small ${d > 0 ? "b-go" : d < 0 ? "b-no" : "muted"}`, title: `${r.prev.date} 분석: ${r.prev.total}점` },
      `${d > 0 ? "▲" : d < 0 ? "▼" : "="}${Math.abs(d) || ""}${mode}`,
    );
  };
  const input = h("input", { type: "text", placeholder: "분석할 주제를 쉼표로 구분 (예: 일본어, 회사원 업무자동화, 절세 재테크)" });
  const start = () =>
    run(async () => {
      const topics = input.value.split(",").map((t) => t.trim()).filter(Boolean);
      watchJob(await api("/api/research", { method: "POST", body: { topics } }));
      input.value = "";
    });

  return h(
    "div",
    { class: "stack" },
    h("h2", {}, "시장분석"),
    h("div", { class: "card stack" }, h("div", { class: "row" }, input, h("button", { class: "primary", onclick: start }, "분석 시작")), h("div", { class: "muted small" }, "주제당 몇 분 걸립니다. 네이버 키가 없으면 추정 모드로 분석합니다. 같은 날 분석한 주제는 한 표에 모이고, 재분석하면 '이전 대비'에 점수 변화가 표시됩니다.")),
    ...(groups.length ? groups : [{ date: null, rows: [] }]).map((g) =>
      g.date
        ? h(
            "div",
            {},
            h(
              "div",
              { class: "row", style: "justify-content:space-between;margin-top:22px" },
              h("h3", { style: "margin:0" }, `${g.date} 분석`),
              h(
                "button",
                { class: "ghost", disabled: g.rows.every((r) => busy.has(r.topic)), onclick: () => confirm(`${g.rows.length}개 주제를 모두 다시 분석할까요? (주제당 몇 분)`) && reanalyze(g.rows.map((r) => r.topic).filter((t) => !busy.has(t))) },
                "전체 재분석",
              ),
            ),
            h(
              "div",
              { class: "table-wrap" },
              h(
                "table",
                { class: "research-table" },
                h("tr", {}, h("th", {}, "#"), h("th", {}, "주제"), h("th", {}, "종합"), h("th", {}, "판정"), ...CRITERIA.map(([, n]) => h("th", {}, n)), h("th", {}, "데이터"), h("th", {}, "이전 대비"), h("th", {}, "")),
                ...g.rows.map((r, i) =>
                  h(
                    "tr",
                    { class: "click", onclick: () => openReport(r) },
                    h("td", { class: "num" }, i + 1),
                    h("td", {}, h("strong", {}, r.topic), h("div", { class: "muted small" }, r.summary.slice(0, 90) + (r.summary.length > 90 ? "…" : ""))),
                    h("td", { style: "white-space:nowrap" }, h("strong", {}, r.total), h("span", { class: "bar", style: `width:${r.total * 0.6}px` })),
                    h("td", {}, h("span", { class: `badge ${verdictClass(r.verdict)}` }, r.verdict)),
                    ...CRITERIA.map(([k]) => h("td", { class: "num" }, r.scores[k])),
                    h("td", {}, h("span", { class: "badge" }, r.dataMode === "naver" ? "실측" : "추정")),
                    h("td", { class: "num" }, change(r)),
                    h(
                      "td",
                      {},
                      h(
                        "button",
                        {
                          class: "ghost small",
                          style: "white-space:nowrap",
                          disabled: busy.has(r.topic),
                          onclick: (e) => (e.stopPropagation(), reanalyze([r.topic])),
                        },
                        busy.has(r.topic) ? "분석 중…" : "재분석",
                      ),
                      state.topics.some((t) => t.name === r.topic)
                        ? null
                        : h(
                            "button",
                            {
                              class: "ghost small",
                              style: "white-space:nowrap;margin-top:4px",
                              onclick: (e) => {
                                e.stopPropagation();
                                state.pendingCategory = { name: r.topic, description: r.summary.split(/(?<=[.다])\s/)[0].slice(0, 80) };
                                go("settings");
                              },
                            },
                            "카테고리로 등록",
                          ),
                    ),
                  ),
                ),
              ),
            ),
          )
        : h("p", { class: "muted" }, "아직 분석 결과가 없습니다."),
    ),
    h("div", { style: "margin-top:28px" }, keywords),
  );
}

async function openReport(row) {
  const { html } = await api(`/api/research/report?file=${encodeURIComponent(row.report)}`);
  modal(`${row.topic} — ${row.total}점 ${row.verdict}`, htmlBlock(html));
}

// ── 글 ─────────────────────────────────────────────────────────────────────

async function renderPosts() {
  if (state.openPost) return renderEditor(state.openPost);
  const posts = await api("/api/posts");

  const topic = h("select", {}, h("option", { value: "" }, "오늘의 주제 (자동)"), ...state.topics.map((t) => h("option", { value: t.slug }, t.name)));
  const date = h("input", { type: "date" });
  const subject = h("input", { type: "text", placeholder: "소재 (비우면 커리큘럼의 다음 레슨)" });
  const create = (mode) =>
    run(async () =>
      watchJob(await api("/api/draft", { method: "POST", body: { mode, topic: topic.value || undefined, date: date.value || undefined, subject: subject.value || undefined } })),
    );

  return h(
    "div",
    { class: "stack" },
    h("h2", {}, "글"),
    h(
      "div",
      { class: "card stack" },
      h("div", { class: "row" }, topic, date, subject),
      h("div", { class: "row" }, h("button", { class: "primary", onclick: () => create("ai") }, "AI 초안 만들기"), h("button", { class: "ghost", onclick: () => create("template") }, "빈 템플릿"), h("span", { class: "muted small" }, "날짜를 미래로 하면 예약 글로 미리 써둘 수 있어요")),
    ),
    h(
      "div",
      { class: "table-wrap" },
      h(
        "table",
        {},
        h("tr", {}, h("th", {}, "날짜"), h("th", {}, "주제"), h("th", {}, "제목"), h("th", {}, "상태"), h("th", {}, "확인할 것")),
        ...posts.map((p) =>
          h(
            "tr",
            { class: "click", onclick: () => openPost(p.slug) },
            h("td", { style: "white-space:nowrap" }, p.date),
            h("td", {}, h("span", { class: "badge", style: `color:${topicColor(p.topic)}` }, topicName(p.topic))),
            h("td", {}, p.title),
            h("td", {}, h("span", { class: `badge b-${p.status}` }, p.status)),
            h("td", { class: "small muted" }, p.status === "초안" ? (p.publishErrors.length ? `게시 전 할 일 ${p.publishErrors.length}개` : "게시 준비됨") : p.errors.length ? `문제 ${p.errors.length}개` : "—"),
          ),
        ),
      ),
    ),
  );
}

function openPost(slug) {
  navigate(`posts/${encodeURIComponent(slug)}`);
}

async function renderEditor(slug) {
  const post = await api(`/api/posts/${slug}`);
  state.dirty = false;
  const unsaved = h("span", { class: "badge b-hold", hidden: true }, "저장 안 됨");
  const text = h("textarea", { value: post.raw, spellcheck: false, oninput: () => ((state.dirty = true), (unsaved.hidden = false)) });
  const preview = h("div", { class: "card preview" });
  const info = h("div", {});
  const show = (p) => {
    preview.replaceChildren(htmlBlock(p.html));
    // 초안은 형식 검사가 느슨하므로, 게시하려면 무엇이 남았는지(게시 기준 검사)를 따로 보여줍니다.
    const todo = p.status === "초안" ? p.publishErrors : p.errors;
    info.replaceChildren(
      h("div", { class: "row" }, h("span", { class: `badge b-${p.status}` }, p.status), unsaved, h("span", { class: "muted small" }, `본문 ${p.chars}자 (게시하려면 800자 이상)`)),
      todo.length
        ? h("div", { class: "small" }, h("strong", {}, p.status === "초안" ? `게시 전에 할 일 ${todo.length}개` : `문제 ${todo.length}개`), h("ul", { class: "errors" }, ...todo.map((e) => h("li", {}, e))))
        : h("div", { class: "small b-go" }, p.status === "초안" ? "✔ 게시할 준비가 됐습니다. \"게시 준비\"를 누르세요" : "✔ 검사 통과"),
    );
  };
  show(post);

  const markSaved = () => {
    state.dirty = false;
    unsaved.hidden = true;
  };
  const save = () => run(async () => (show(await api(`/api/posts/${slug}`, { method: "PUT", body: { raw: text.value } })), markSaved(), toast("저장했습니다")));
  const publish = () =>
    run(async () => {
      await api(`/api/posts/${slug}`, { method: "PUT", body: { raw: text.value } });
      markSaved();
      const r = await api(`/api/posts/${slug}/publish`, { method: "POST" });
      if (!r.ok) {
        toast("아직 게시할 수 없습니다. 문제를 확인하세요");
        show({ ...(await api(`/api/posts/${slug}`)), errors: r.errors });
        return;
      }
      const fresh = await api(`/api/posts/${slug}`);
      text.value = fresh.raw;
      show(fresh);
      toast("게시 준비 완료 (draft: false). git push하면 배포됩니다");
    });

  const file = h("input", { type: "file", accept: "image/png,image/jpeg,image/webp,image/gif", hidden: true });
  file.addEventListener("change", () =>
    run(async () => {
      const f = file.files[0];
      if (!f) return;
      const r = await api(`/api/posts/${slug}/images?name=${encodeURIComponent(f.name)}`, { method: "POST", body: f });
      const at = text.selectionStart ?? text.value.length;
      text.value = `${text.value.slice(0, at)}\n${r.markdown}\n${text.value.slice(at)}`;
      state.dirty = true;
      unsaved.hidden = false;
      toast(`이미지 추가 (${r.sizeKB}KB) — 설명(alt)을 고친 뒤 저장하세요${r.sizeKB > 1024 ? ". 1MB 이하로 줄이는 걸 권장해요" : ""}`);
      file.value = "";
    }),
  );
  text.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      save();
    }
  });

  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "row", style: "justify-content:space-between" },
      h("div", { class: "row" }, h("button", { class: "ghost", onclick: () => go("posts") }, "← 목록"), h("strong", {}, post.title || slug)),
      h(
        "div",
        { class: "row" },
        h("button", { class: "ghost", onclick: () => file.click() }, "이미지 넣기"),
        h("button", { class: "ghost", onclick: save }, "저장 (Ctrl+S)"),
        post.status === "초안" ? h("button", { class: "primary", onclick: publish }, "게시 준비") : null,
      ),
    ),
    info,
    file,
    h("div", { class: "editor" }, text, preview),
  );
}

// ── 키워드 ─────────────────────────────────────────────────────────────────

async function renderKeywords() {
  const q = h("input", { type: "text", placeholder: "키워드를 쉼표로 구분 (예: 일본어독학, JLPT N3)" });
  const cmd = h("select", {}, h("option", { value: "keywords" }, "연관 키워드·검색량"), h("option", { value: "trend" }, "12개월 추세 (최대 5개)"), h("option", { value: "bid" }, "광고 입찰가"));
  const out = h("div", {});

  const lookup = () =>
    run(async () => {
      out.replaceChildren(h("p", { class: "muted" }, "조회 중…"));
      const r = await api(`/api/naver?cmd=${cmd.value}&q=${encodeURIComponent(q.value)}`);
      if (!r.available) return out.replaceChildren(h("div", { class: "card b-no" }, r.reason || r.error || "사용할 수 없습니다"));
      const table = (head, rows) => h("div", { class: "table-wrap" }, h("table", {}, h("tr", {}, ...head.map((x) => h("th", {}, x))), ...rows.map((cells) => h("tr", {}, ...cells.map((c) => h("td", {}, c))))));
      if (cmd.value === "keywords")
        out.replaceChildren(
          h("p", { class: "muted small" }, `${r.source} · ${r.total}개 중 상위 ${r.keywords.length}개`),
          table(["키워드", "월간 검색량", "모바일 비중", "월 광고 클릭", "광고 경쟁도"], r.keywords.map((k) => [k.keyword, k.monthly.toLocaleString(), `${k.mobileShare}%`, k.adClicks, k.adCompetition])),
        );
      else if (cmd.value === "trend")
        out.replaceChildren(h("p", { class: "muted small" }, r.source), table(["키워드", "평균", "성장률(최근3개월 vs 1년전)", "최고 월", "월별"], r.results.map((t) => [t.keyword, t.average, t.growth, t.peakMonth, t.monthly])));
      else out.replaceChildren(h("p", { class: "muted small" }, r.source), table(["키워드", "입찰가(원)"], r.bids.map((b) => [b.keyword, b.bid.toLocaleString()])));
    });
  q.addEventListener("keydown", (e) => e.key === "Enter" && lookup());

  return h("div", { class: "stack" }, h("h2", {}, "키워드 조회"), h("div", { class: "card row" }, cmd, q, h("button", { class: "primary", onclick: lookup }, "조회")), out);
}

// ── 프로필 ─────────────────────────────────────────────────────────────────

async function renderProfile() {
  const { text } = await api("/api/profile");
  // 카테고리를 저장하면 설정 화면이 다시 그려지므로, 저장 전 프로필 입력은 따로 보관합니다.
  const area = h("textarea", { value: state.profileDraft ?? text, rows: 24, oninput: (e) => (state.profileDraft = e.target.value) });
  return h(
    "div",
    { class: "stack" },
    h("h2", {}, "운영자 프로필"),
    h("p", { class: "muted small" }, "시장분석의 '운영자 적합성' 점수, 커리큘럼 설계, 할 일 가이드, 글 초안의 관점에 쓰입니다."),
    area,
    h("button", { class: "primary", onclick: () => run(async () => (await api("/api/profile", { method: "PUT", body: { text: area.value } }), (state.profileDraft = null), toast("저장했습니다"))) }, "저장"),
  );
}

// ── 설정 (카테고리·프로필·도구 상태) ─────────────────────────────────────────

async function renderSettings() {
  const [categories, profile, s] = await Promise.all([renderCategories(), renderProfile(), api("/api/status")]);
  const tool = (ok, label, hint) => h("div", {}, h("span", { class: `dot ${ok ? "ok" : "off"}` }), label, ok ? null : h("div", { class: "muted small" }, hint));
  return h(
    "div",
    { class: "stack" },
    h("h2", {}, "설정"),
    h("div", { class: "row" }, ...["카테고리", "프로필", "도구 상태"].map((n, i) => h("a", { href: `#settings-${i}`, class: "ghost small", onclick: (e) => (e.preventDefault(), document.getElementById(`settings-${i}`).scrollIntoView({ behavior: "smooth" })) }, n))),
    h("section", { id: "settings-0" }, categories),
    h("section", { id: "settings-1" }, profile),
    h(
      "section",
      { id: "settings-2", class: "stack" },
      h("h2", {}, "도구 상태"),
      h(
        "div",
        { class: "card grid" },
        tool(s.tools.claude, "Claude CLI", "npm i -g @anthropic-ai/claude-code 후 claude로 로그인"),
        tool(s.tools.naverAd, "네이버 검색광고 API (검색량)", ".env.local에 NAVER_AD_* 키 입력 후 대시보드 재시작"),
        tool(s.tools.naverDatalab, "네이버 데이터랩 (추세)", ".env.local에 NAVER_CLIENT_* 키 입력 후 대시보드 재시작"),
        tool(s.tools.profile, "운영자 프로필", "위 프로필을 작성하면 분석·커리큘럼이 내 수준에 맞춰집니다"),
      ),
    ),
  );
}

// ── 라우팅 ─────────────────────────────────────────────────────────────────

const RENDER = { today: renderToday, calendar: renderCalendar, curriculum: renderCurriculum, posts: renderPosts, research: renderResearch, settings: renderSettings };
// 예전 주소(#home, #categories 등)로 들어와도 새 화면으로 연결합니다.
const TAB_ALIAS = { home: "today", categories: "settings", profile: "settings", keywords: "research" };

/** 글 편집 화면에 저장하지 않은 내용이 있으면 나가기 전에 확인합니다. */
function leaveEditorOk() {
  if (!state.dirty) return true;
  if (!confirm("저장하지 않은 수정 내용이 있습니다. 저장하지 않고 나갈까요?")) return false;
  state.dirty = false;
  return true;
}

/** 주소(#탭/값)를 화면 상태로 옮깁니다. 뒤로·앞으로 가기와 새로고침에서도 같은 화면이 나옵니다. */
function applyHash() {
  const [hash, param] = location.hash.slice(1).split("/");
  const tab = TAB_ALIAS[hash] ?? hash;
  state.tab = RENDER[tab] ? tab : "today";
  if (state.tab === "today" && /^\d{4}-\d{2}-\d{2}$/.test(param ?? "")) state.date = param;
  state.openPost = state.tab === "posts" && param ? decodeURIComponent(param) : null;
  return render(true);
}

let currentHash = location.hash;
window.addEventListener("hashchange", () => {
  if (location.hash === currentHash) return;
  if (!leaveEditorOk()) {
    history.replaceState(null, "", currentHash);
    return;
  }
  currentHash = location.hash;
  applyHash();
});
window.addEventListener("beforeunload", (e) => {
  if (state.dirty) e.preventDefault();
});

function navigate(hash) {
  if (!leaveEditorOk()) return;
  if (location.hash === `#${hash}`) applyHash();
  else location.hash = hash;
}
const go = (tab) => navigate(tab);

/** force가 아니면(작업 완료 등 자동 새로고침) 글 편집 화면은 그대로 둡니다 (입력 중인 내용 보호). */
async function render(force = false) {
  if (!force && state.openPost && view.querySelector(".editor")) return;
  // 메모 등을 입력하는 중에는 자동 새로고침으로 입력이 사라지지 않게 합니다.
  if (!force && view.contains(document.activeElement) && /^(TEXTAREA|INPUT|SELECT)$/.test(document.activeElement.tagName)) return;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  const node = await run(() => RENDER[state.tab]());
  if (node) view.replaceChildren(node);
  currentHash = location.hash;
}

// 탭의 "오늘"은 언제나 실제 오늘로 갑니다 (다른 날을 보다가 돌아올 때).
document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => (b.dataset.tab === "today" && (state.date = null), go(b.dataset.tab))));
(async () => {
  state.topics = await api("/api/topics");
  applyHash();
  renderJobs();
})();
