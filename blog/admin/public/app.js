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
const state = { tab: "home", topics: [], planTopic: null, openPost: null, watching: new Set() };

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

// ── 홈 ─────────────────────────────────────────────────────────────────────

async function renderHome() {
  const s = await api("/api/status");
  const today = s.todayPost;
  const tool = (ok, label, hint) => h("div", {}, h("span", { class: `dot ${ok ? "ok" : "off"}` }), label, ok ? null : h("div", { class: "muted small" }, hint));

  return h(
    "div",
    { class: "stack" },
    h("h2", {}, `오늘 ${s.today}`),
    h(
      "div",
      { class: "grid" },
      h(
        "div",
        { class: "card stack" },
        h("div", { class: "muted small" }, "오늘의 주제"),
        h("div", { class: "big", style: `color:${s.todayTopic.color}` }, s.todayTopic.name),
        today
          ? h("div", { class: "row" }, h("span", { class: `badge b-${today.status}` }, today.status), h("a", { href: "#", onclick: (e) => (e.preventDefault(), openPost(today.slug)) }, today.title))
          : h(
              "div",
              { class: "row" },
              h("button", { class: "primary", onclick: () => run(async () => watchJob(await api("/api/draft", { method: "POST", body: {} }))) }, "AI 초안 만들기"),
              h("button", { class: "ghost", onclick: () => run(async () => watchJob(await api("/api/draft", { method: "POST", body: { mode: "template" } }))) }, "빈 템플릿"),
            ),
      ),
      h("div", { class: "card" }, h("div", { class: "muted small" }, "연속 공부"), h("div", { class: "big" }, `${s.streak}일`)),
      h(
        "div",
        { class: "card" },
        h("div", { class: "muted small" }, "글 현황"),
        h("div", { class: "row", style: "margin-top:6px" }, ...Object.entries(s.counts).map(([k, v]) => h("span", { class: `badge b-${k}` }, `${k} ${v}`))),
      ),
    ),
    h("h3", {}, "주제별 계획"),
    h(
      "div",
      { class: "grid" },
      ...s.plans.map((p) =>
        h(
          "div",
          { class: "card", style: `border-left:4px solid ${p.color};cursor:pointer`, onclick: () => ((state.planTopic = p.slug), go("plan")) },
          h("strong", {}, p.name),
          h("div", { class: p.pending < 5 ? "small b-no" : "muted small" }, `대기 ${p.pending} · 완료 ${p.done}${p.pending < 5 ? " — 계획을 보충하세요" : ""}`),
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
      tool(s.tools.profile, "운영자 프로필", "프로필 탭에서 작성하면 적합성 점수가 정확해집니다"),
    ),
  );
}

// ── 시장분석 ───────────────────────────────────────────────────────────────

async function renderResearch() {
  const groups = await api("/api/research");
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
    h("div", { class: "card stack" }, h("div", { class: "row" }, input, h("button", { class: "primary", onclick: start }, "분석 시작")), h("div", { class: "muted small" }, "주제당 몇 분 걸립니다. 네이버 키가 없으면 추정 모드로 분석합니다. 같은 날 분석한 주제는 한 표에 모입니다.")),
    ...(groups.length ? groups : [{ date: null, rows: [] }]).map((g) =>
      g.date
        ? h(
            "div",
            {},
            h("h3", {}, `${g.date} 분석`),
            h(
              "div",
              { class: "table-wrap" },
              h(
                "table",
                {},
                h("tr", {}, h("th", {}, "#"), h("th", {}, "주제"), h("th", {}, "종합"), h("th", {}, "판정"), ...CRITERIA.map(([, n]) => h("th", {}, n)), h("th", {}, "데이터")),
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

// ── 계획 ───────────────────────────────────────────────────────────────────

async function renderPlan() {
  state.planTopic ??= state.topics[0]?.slug;
  const plan = await api(`/api/plan?topic=${state.planTopic}`);
  let items = plan.pending;

  const save = async (next) => {
    const r = await api(`/api/plan?topic=${state.planTopic}`, { method: "PUT", body: { pending: next } });
    items = r.pending;
    list.replaceChildren(...itemsView());
    heading.textContent = headingText();
  };
  const headingText = () => `대기 ${items.length}개 — 맨 위부터 초안으로 씁니다`;
  const heading = h("h3", {}, headingText());
  const move = (i, d) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    run(() => save(next));
  };
  const remove = (i) => confirm(`"${items[i].title}" 소재를 계획에서 뺄까요?`) && run(() => save(items.filter((_, j) => j !== i)));

  const itemsView = () =>
    items.length
      ? items.map((it, i) =>
          h(
            "div",
            { class: "plan-item" },
            h("span", { class: "num" }, i + 1),
            h("div", { class: "body" }, h("strong", {}, it.title), it.details.length ? h("ul", {}, ...it.details.map((d) => h("li", {}, d))) : null),
            h(
              "div",
              { class: "actions" },
              h("button", { class: "icon", title: "위로", disabled: i === 0, onclick: () => move(i, -1) }, "↑"),
              h("button", { class: "icon", title: "아래로", disabled: i === items.length - 1, onclick: () => move(i, 1) }, "↓"),
              h("button", { class: "icon", title: "맨 위로 (다음 초안 소재)", disabled: i === 0, onclick: () => run(() => save([it, ...items.filter((_, j) => j !== i)])) }, "⤒"),
              h("button", { class: "icon", title: "빼기", onclick: () => remove(i) }, "✕"),
            ),
          ),
        )
      : [h("p", { class: "muted" }, "대기 중인 소재가 없습니다. AI로 추가하거나 직접 추가하세요.")];
  const list = h("div", { class: "stack" }, ...itemsView());

  const count = h("input", { type: "number", value: 20, min: 5, max: 50, style: "width:80px" });
  const title = h("input", { type: "text", placeholder: "소재 제목" });
  const details = h("textarea", { rows: 2, placeholder: "세부 메모 (한 줄에 하나, 예: 키워드: ... / 실습: ...)" });
  const addManual = () =>
    run(async () => {
      if (!title.value.trim()) throw new Error("소재 제목을 입력하세요");
      await save([...items, { title: title.value.trim(), details: details.value.split("\n").map((d) => d.trim()).filter(Boolean) }]);
      title.value = details.value = "";
      toast("추가했습니다");
    });

  return h(
    "div",
    { class: "stack" },
    h("h2", {}, "콘텐츠 계획"),
    h(
      "div",
      { class: "row" },
      ...state.topics.map((t) =>
        h("button", { class: t.slug === state.planTopic ? "primary" : "ghost", onclick: () => ((state.planTopic = t.slug), render(true)) }, t.name),
      ),
    ),
    h(
      "div",
      { class: "card row" },
      h("span", {}, "AI로 소재"),
      count,
      h("span", {}, "개 추가"),
      h("button", { class: "primary", onclick: () => run(async () => watchJob(await api("/api/plan/generate", { method: "POST", body: { topic: state.planTopic, count: Number(count.value) } }))) }, "계획 만들기"),
      h("span", { class: "muted small" }, "키워드 조사 → 핵심/하위 글 구성 → 대기 목록 맨 아래에 추가"),
    ),
    heading,
    list,
    h("h3", {}, "직접 추가"),
    h("div", { class: "card stack" }, title, details, h("button", { class: "ghost", onclick: addManual }, "대기 목록에 추가")),
    h("h3", {}, `완료 ${plan.done.length}개`),
    plan.done.length ? h("ul", { class: "muted small" }, ...plan.done.map((d) => h("li", {}, d))) : h("p", { class: "muted small" }, "아직 없습니다."),
  );
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

const RENDER = { home: renderHome, research: renderResearch, plan: renderPlan, posts: renderPosts, keywords: renderKeywords, profile: renderProfile };

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
