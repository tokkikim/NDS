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
const state = { tab: "home", topics: [], curTopic: null, month: null, pendingCategory: null, openPost: null, watching: new Set() };

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
        h("div", { class: "row" }, h("span", { class: `badge ${j.status === "done" ? "b-go" : j.status === "failed" ? "b-no" : "b-hold"}` }, { running: "실행 중", done: "완료", failed: "실패" }[j.status]), j.label),
        h("pre", {}, j.tail.split("\n").slice(-3).join("\n")),
      ),
    ),
  );
  // 방금 끝난 작업이 있으면 현재 화면을 새로 고칩니다.
  for (const j of visible) {
    if (j.status !== "running" && state.watching.has(j.id) && !renderJobs.finished?.has(j.id)) {
      (renderJobs.finished ??= new Set()).add(j.id);
      toast(`${j.status === "done" ? "완료" : "실패"}: ${j.label}`);
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

const STATUS_CLASS = { 게시: "b-go", 완료: "b-go", 예약: "b-go", 초안: "b-hold", "작성 중": "b-hold", 오늘: "b-today", 예정: "b-plan", 놓침: "b-no", "레슨 없음": "b-no", 미배정: "b-plan", "시작 전": "b-plan" };
const statusBadge = (s) => h("span", { class: `badge ${STATUS_CLASS[s] ?? ""}` }, s);
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const weekday = (date) => WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];

const createDraft = (body) => run(async () => watchJob(await api("/api/draft", { method: "POST", body })));

/** 하루치 할 일 카드 (홈·달력에서 공통 사용) */
function dayDetail(d, { compact = false } = {}) {
  const topic = d.topic;
  const l = d.lesson;
  const canDraft = topic && !d.post && ["오늘", "예정", "놓침"].includes(d.status);
  return h(
    "div",
    { class: "stack" },
    h("div", { class: "row" }, topic ? h("span", { class: "badge", style: `color:${topic.color}` }, topic.name) : null, statusBadge(d.status), h("span", { class: "muted small" }, `${d.date} (${weekday(d.date)})`)),
    l ? h("div", { class: "muted small" }, `${l.stage} · 레슨 ${l.number}/${l.total}`) : null,
    d.post ? h("strong", {}, d.post.title) : l ? h("strong", {}, l.title) : null,
    l ? h("div", { class: "task" }, h("div", { class: "small muted" }, "할 일"), l.task) : null,
    l && l.keywords.length && !compact ? h("div", { class: "small muted" }, `키워드: ${l.keywords.join(", ")}`) : null,
    d.status === "레슨 없음" ? h("div", { class: "small b-no" }, "커리큘럼 레슨이 모두 배정됐습니다. 커리큘럼 탭에서 레슨을 추가하세요.") : null,
    d.status === "놓침" ? h("div", { class: "small muted" }, "이 날의 레슨은 다음 차례로 자동으로 밀렸습니다.") : null,
    h(
      "div",
      { class: "row" },
      d.post ? h("button", { class: "ghost", onclick: () => (document.getElementById("modal").close(), openPost(d.post.slug)) }, "글 열기") : null,
      canDraft ? h("button", { class: "primary", onclick: () => (document.getElementById("modal").close(), createDraft({ date: d.date, topic: topic.slug })) }, "AI 초안 만들기") : null,
      canDraft ? h("button", { class: "ghost", onclick: () => (document.getElementById("modal").close(), createDraft({ date: d.date, topic: topic.slug, mode: "template" })) }, "빈 템플릿") : null,
    ),
  );
}

// ── 홈 ─────────────────────────────────────────────────────────────────────

async function renderHome() {
  const s = await api("/api/status");
  const tool = (ok, label, hint) => h("div", {}, h("span", { class: `dot ${ok ? "ok" : "off"}` }), label, ok ? null : h("div", { class: "muted small" }, hint));

  return h(
    "div",
    { class: "stack" },
    h("h2", {}, `오늘 ${s.today} (${weekday(s.today)})`),
    h(
      "div",
      { class: "grid" },
      h(
        "div",
        { class: "card", style: `grid-column: span 2; border-left: 4px solid ${s.todayPlan?.topic?.color ?? "var(--border)"}` },
        s.todayPlan?.status === "시작 전"
          ? (() => {
              const first = s.week.find((d) => d.topic);
              return first
                ? h("div", { class: "stack" }, h("strong", {}, `${first.date} (${weekday(first.date)})부터 시작합니다. 첫날 할 일:`), dayDetail(first))
                : h("div", {}, "카테고리 탭에서 순환 시작일을 확인하세요.");
            })()
          : s.todayPlan
            ? dayDetail(s.todayPlan)
            : "일정 없음",
      ),
      h(
        "div",
        { class: "card stack" },
        h("div", {}, h("div", { class: "muted small" }, "연속 공부"), h("div", { class: "big" }, `${s.streak}일`)),
        h("div", { class: "row" }, ...Object.entries(s.counts).map(([k, v]) => h("span", { class: `badge b-${k}` }, `${k} ${v}`))),
      ),
    ),
    h("h3", {}, "다음 7일"),
    h(
      "div",
      { class: "week" },
      ...s.week.map((d) =>
        h(
          "div",
          { class: "card week-day", style: `border-top: 4px solid ${d.topic?.color ?? "var(--border)"}`, onclick: () => modal(`${d.date} 할 일`, dayDetail(d)) },
          h("div", { class: "muted small" }, `${d.date.slice(5)} (${weekday(d.date)})`),
          h("div", { class: "small", style: `color:${d.topic?.color ?? "inherit"};font-weight:700` }, d.topic?.name ?? ""),
          h("div", { class: "small clamp" }, d.post?.title ?? d.lesson?.title ?? d.status),
        ),
      ),
    ),
    h("h3", {}, "커리큘럼 진행"),
    h(
      "div",
      { class: "grid" },
      ...s.curricula.map((c) =>
        h(
          "div",
          { class: "card", style: `border-left:4px solid ${c.color};cursor:pointer`, onclick: () => ((state.curTopic = c.slug), go("curriculum")) },
          h("strong", {}, c.name),
          c.hasCurriculum
            ? h(
                "div",
                { class: "stack" },
                h("div", { class: "progress" }, h("span", { style: `width:${c.lessons ? (c.done / c.lessons) * 100 : 0}%;background:${c.color}` })),
                h("div", { class: c.daysLeft !== null && c.daysLeft < 21 ? "small b-no" : "muted small" }, `레슨 ${c.done}/${c.lessons}${c.daysLeft !== null ? ` · ${c.daysLeft}일 뒤 레슨 소진` : ""}`),
              )
            : h("div", { class: "small b-no" }, "커리큘럼이 없습니다 — 만들어 주세요"),
        ),
      ),
    ),
    h("h3", {}, "도구 상태"),
    h(
      "div",
      { class: "card grid" },
      tool(s.tools.claude, "Claude CLI", "npm i -g @anthropic-ai/claude-code 후 claude로 로그인"),
      tool(s.tools.naverAd, "네이버 검색광고 API (검색량)", ".env.local에 NAVER_AD_* 키 입력 후 대시보드 재시작"),
      tool(s.tools.naverDatalab, "네이버 데이터랩 (추세)", ".env.local에 NAVER_CLIENT_* 키 입력 후 대시보드 재시작"),
      tool(s.tools.profile, "운영자 프로필", "프로필 탭에서 작성하면 분석·커리큘럼이 내 수준에 맞춰집니다"),
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
  const counts = cal.days.reduce((acc, d) => ((acc[d.status] = (acc[d.status] ?? 0) + 1), acc), {});

  return h(
    "div",
    { class: "stack" },
    h(
      "div",
      { class: "row", style: "justify-content:space-between" },
      h("h2", { style: "margin:0" }, `${state.month.replace("-", "년 ")}월`),
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
            class: `cal-day${d.date === cal.today ? " is-today" : ""}${d.date < cal.today ? " is-past" : ""}`,
            style: d.topic ? `border-top: 4px solid ${d.topic.color}` : "",
            onclick: () => modal(`${d.date} (${weekday(d.date)}) 할 일`, dayDetail(d)),
          },
          h("div", { class: "row", style: "justify-content:space-between" }, h("strong", {}, Number(d.date.slice(8))), d.topic ? statusBadge(d.status) : null),
          d.topic ? h("div", { class: "small", style: `color:${d.topic.color};font-weight:700` }, d.topic.name) : null,
          h("div", { class: "small clamp" }, d.post?.title ?? d.lesson?.title ?? ""),
        ),
      ),
    ),
    h("p", { class: "muted small" }, "날짜를 누르면 그날의 할 일을 보고 초안을 만들 수 있습니다. 지난 날 글을 쓰지 못하면 그 레슨은 같은 카테고리의 다음 차례로 자동으로 밀립니다."),
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
  const { topic, curriculum, lessonStatus } = await api(`/api/curriculum?topic=${state.curTopic}`);
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
    modal(
      i < stage.lessons.length ? "레슨 수정" : "레슨 추가",
      h(
        "div",
        { class: "stack", style: "padding-top:12px" },
        h("label", { class: "small muted" }, "제목 (글 제목 후보)"),
        title,
        h("label", { class: "small muted" }, "할 일 (다음 차례까지 실제로 할 것)"),
        task,
        h("label", { class: "small muted" }, "키워드 (쉼표로 구분)"),
        keywords,
        h(
          "button",
          {
            class: "primary",
            onclick: () => {
              stage.lessons[i] = { id: l.id, title: title.value, task: task.value, keywords: keywords.value.split(",").map((k) => k.trim()).filter(Boolean) };
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
  return h(
    "div",
    { class: "stack" },
    h("h2", {}, "커리큘럼"),
    tabs,
    h(
      "div",
      { class: "card stack", style: `border-left:4px solid ${topic.color}` },
      h("div", { class: "row", style: "justify-content:space-between" }, h("strong", {}, c.goal || "(목표 없음)"), h("button", { class: "icon", onclick: editGoal }, "✎ 목표 수정")),
      h("div", { class: "muted small" }, `출발 수준: ${c.level || "-"}`),
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
      ),
    ),
    ...c.stages.map((s, si) =>
      h(
        "div",
        { class: "stack" },
        h(
          "div",
          { class: "row", style: "justify-content:space-between;margin-top:18px" },
          h("div", {}, h("h3", { style: "margin:0" }, s.title), s.goal ? h("div", { class: "muted small" }, `목표: ${s.goal}`) : null),
          h(
            "div",
            { class: "row" },
            h("button", { class: "icon", onclick: () => editStage(si) }, "✎"),
            h("button", { class: "icon", disabled: s.lessons.some((l) => st(l.id).status === "완료" || st(l.id).status === "작성 중"), title: "단계 삭제", onclick: () => confirm(`"${s.title}" 단계와 레슨 ${s.lessons.length}개를 지울까요?`) && (c.stages.splice(si, 1), save(c)) }, "✕"),
          ),
        ),
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
              h("div", { class: "row" }, h("strong", {}, l.title), statusBadge(info.status), info.date ? h("span", { class: "muted small" }, `${info.date} (${weekday(info.date)})`) : null),
              h("div", { class: "small" }, `할 일: ${l.task}`),
              l.keywords.length ? h("div", { class: "muted small" }, l.keywords.join(" · ")) : null,
            ),
            h(
              "div",
              { class: "actions" },
              h("button", { class: "icon", disabled: i === 0, onclick: () => ([s.lessons[i - 1], s.lessons[i]] = [s.lessons[i], s.lessons[i - 1]], save(c)) }, "↑"),
              h("button", { class: "icon", disabled: i === s.lessons.length - 1, onclick: () => ([s.lessons[i + 1], s.lessons[i]] = [s.lessons[i], s.lessons[i + 1]], save(c)) }, "↓"),
              h("button", { class: "icon", onclick: () => editLesson(s, i) }, "✎"),
              h("button", { class: "icon", disabled: locked, title: locked ? "글로 쓴 레슨은 지울 수 없습니다" : "삭제", onclick: () => confirm(`"${l.title}" 레슨을 지울까요?`) && (s.lessons.splice(i, 1), save(c)) }, "✕"),
            ),
          );
        }),
        h("button", { class: "ghost small", style: "align-self:flex-start", onclick: () => editLesson(s, s.lessons.length) }, "+ 레슨 추가"),
      ),
    ),
    h("button", { class: "ghost", onclick: () => editStage(c.stages.length) }, "+ 단계 추가"),
  );
}

// ── 시장분석 ───────────────────────────────────────────────────────────────

async function renderResearch() {
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
                {},
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
                                go("categories");
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
  const subject = h("input", { type: "text", placeholder: "소재 (비우면 계획의 다음 소재)" });
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
            h("td", { class: "small muted" }, [p.todo ? "TODO 남음" : null, p.errors.length ? `문제 ${p.errors.length}개` : null].filter(Boolean).join(" · ") || "—"),
          ),
        ),
      ),
    ),
  );
}

function openPost(slug) {
  state.openPost = slug;
  state.tab = "posts";
  location.hash = "posts";
  render(true);
}

async function renderEditor(slug) {
  const post = await api(`/api/posts/${slug}`);
  const text = h("textarea", { value: post.raw, spellcheck: false });
  const preview = h("div", { class: "card preview" });
  const info = h("div", {});
  const show = (p) => {
    preview.replaceChildren(htmlBlock(p.html));
    info.replaceChildren(
      h("div", { class: "row" }, h("span", { class: `badge b-${p.status}` }, p.status), h("span", { class: "muted small" }, `본문 ${p.chars}자`)),
      p.errors.length ? h("ul", { class: "errors small" }, ...p.errors.map((e) => h("li", {}, e))) : h("div", { class: "small b-go" }, "✔ 검사 통과"),
    );
  };
  show(post);

  const save = () => run(async () => (show(await api(`/api/posts/${slug}`, { method: "PUT", body: { raw: text.value } })), toast("저장했습니다")));
  const publish = () =>
    run(async () => {
      await api(`/api/posts/${slug}`, { method: "PUT", body: { raw: text.value } });
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
  const area = h("textarea", { value: text, rows: 24 });
  return h(
    "div",
    { class: "stack" },
    h("h2", {}, "운영자 프로필"),
    h("p", { class: "muted small" }, "시장분석의 '운영자 적합성' 점수와 틈새 추천, 계획의 실습 과제에 쓰입니다."),
    area,
    h("button", { class: "primary", onclick: () => run(async () => (await api("/api/profile", { method: "PUT", body: { text: area.value } }), toast("저장했습니다"))) }, "저장"),
  );
}

// ── 라우팅 ─────────────────────────────────────────────────────────────────

const RENDER = { home: renderHome, calendar: renderCalendar, research: renderResearch, categories: renderCategories, curriculum: renderCurriculum, posts: renderPosts, keywords: renderKeywords, profile: renderProfile };

function go(tab) {
  state.openPost = null;
  location.hash = tab;
  state.tab = tab;
  render(true);
}

/** force가 아니면(작업 완료 등 자동 새로고침) 글 편집 화면은 그대로 둡니다 (입력 중인 내용 보호). */
async function render(force = false) {
  if (!force && state.openPost && view.querySelector(".editor")) return;
  document.querySelectorAll("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === state.tab));
  const node = await run(() => RENDER[state.tab]());
  if (node) view.replaceChildren(node);
}

document.querySelectorAll("#tabs button").forEach((b) => b.addEventListener("click", () => go(b.dataset.tab)));
(async () => {
  state.topics = await api("/api/topics");
  const tab = location.hash.slice(1);
  state.tab = RENDER[tab] ? tab : "home";
  render();
  renderJobs();
})();
