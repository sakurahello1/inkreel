/* 场记 · Slate — landing page behaviour. No dependencies. */
(() => {
  "use strict";
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ------------------------------------------------------------ i18n */
  const T = {
    "nav.why": ["为什么", "Why"], "nav.flow": ["流程", "Pipeline"], "nav.previz": ["预演", "Previz"], "nav.kf": ["关键帧", "Keyframes"], "nav.screens": ["工作台", "Workbench"], "nav.start": ["开始", "Start"],
    "hero.eyebrow": ["开源 · AI 短剧生产工作台", "OPEN SOURCE · AI SHORT-DRAMA STUDIO"],
    "hero.tagline": ["把一章小说，拍成一集短剧。", "Turn a chapter into an episode."],
    "hero.lead": ["拆镜、资产、预演截帧、出片、字幕对齐、导出——一个人、一台机器、一条流水线。图和视频走 fal.ai 上的 gpt-image-2.5 与 MiniMax H3，也支持任何 OpenAI 兼容接口。", "Storyboard, assets, previz frame-picking, generation, subtitle alignment, export — one person, one machine, one pipeline. Images and video run on gpt-image-2.5 and MiniMax H3 via fal.ai, or any OpenAI-compatible relay."],
    "hero.cta1": ["在 GitHub 上看代码", "Read the code on GitHub"], "hero.cta2": ["看它怎么工作 ↓", "See how it works ↓"],
    "reel.cap": ["全部画面由本工具生成 · 《同桌说：你压到我头发了》第一集", "Every frame here was made with Slate · Episode 1 of a test drama"],
    "stat.shots": ["镜头", "shots"], "stat.eps": ["集", "episodes"], "stat.min": ["分钟成片", "minutes of film"], "stat.person": ["人", "person"],
    "why.k": ["问题", "The problem"], "why.title": ["为什么以视频为中心", "Why video-first"],
    "why.intro": ["用图片模型画首帧、再喂给视频模型出片，是最常见的流水线。做了几百个镜头之后，两个问题绕不过去。", "Draw a first frame with an image model, hand it to a video model — that's the usual pipeline. A few hundred shots in, two problems won't go away."],
    "why.b.title": ["赛璐璐会横跳", "Cel-shading flickers"],
    "why.b.body": ["同一条视频里，模型会在 2D 平涂和 3D 渲染之间反复切换。只有三维动画那一档是稳的。", "Within a single clip the model flips between flat 2D and 3D rendering. Only the 3D-anime look holds."],
    "why.b.sol": ["→ 风格写死为动漫 3D，每条提示词最前面都带", "→ Style is pinned to 3D anime, prepended to every prompt"],
    "why.b.hint": ["拖动分界线", "Drag the divider"],
    "why.a.title": ["图是图，视频是视频", "A picture is not a film"],
    "why.a.body": ["同一套提示词，图片模型画出来的人和视频模型渲染出来的人就是两个人。每镜首帧各画一次，进了视频模型再各漂一次，一集下来人物不像同一个。", "Same prompt, two different people: the one the image model drew and the one the video model renders. Every shot drifts once at the frame and once more in the video; by the end of an episode the lead is a stranger."],
    "why.a.sol": ["→ 首帧从视频模型自己的预演里截", "→ Pick first frames out of the video model's own previz"],
    "drift.old": ["以前", "BEFORE"], "drift.new": ["现在", "NOW"], "drift.img": ["图片模型", "image model"], "drift.frame": ["首帧", "frame"], "drift.vid": ["视频模型", "video model"],
    "drift.drift1": ["漂一次", "drift"], "drift.drift2": ["再漂一次", "drift again"], "drift.previz": ["预演", "previz"], "drift.pick": ["截帧", "pick"], "drift.zero": ["零漂移", "zero drift"],
    "flow.k": ["流程", "Pipeline"], "flow.title": ["六步流水线", "Six steps"],
    "s1.t": ["拆镜", "Storyboard"], "s1.b": ["Agent 把原文拆成分镜组和镜头：景别、运镜、台词、时长、两套提示词。", "An agent splits the text into units and shots: framing, camera, lines, duration, two prompts."],
    "s2.t": ["资产", "Assets"], "s2.b": ["人设三视图、场景图、道具图、画风参考。人物按 tag 分版本。", "Character sheets, scene plates, props, style refs. Characters are versioned by tag."],
    "s3.t": ["预演", "Previz"], "s3.b": ["全能参考把整章镜头闪一遍，每镜不到一秒。首帧从这里人工截。", "Reference-to-video flashes the whole chapter, under a second per shot. First frames are picked here by hand."],
    "s4.t": ["出片", "Generate"], "s4.b": ["首帧、首尾帧、分段拼接。关键帧钉死起止，模型只补运动。", "First frame, first + last, or segments. Keyframes pin the ends; the model fills in the motion."],
    "s5.t": ["字幕对齐", "Align"], "s5.b": ["Whisper 字级时间戳把台词对到真正开口的那一秒。", "Whisper word timestamps snap each line to the moment it's actually spoken."],
    "s6.t": ["导出", "Export"], "s6.b": ["ffmpeg 拼接、裁切、烧字幕、BGM 连续段落、片尾字卡。", "ffmpeg cuts, trims, burns subtitles, lays continuous BGM, adds the end card."],
    "pv.k": ["预演", "Previz"], "pv.title": ["预演截帧", "Frame picking from previz"],
    "pv.body": ["一条 15 秒的视频装下 20 个镜头。拖动进度条，找到最清楚的一帧，采用——它天然就是视频模型自己的世界观，之后出片零漂移。", "Twenty shots fit in one 15-second clip. Scrub to the cleanest frame and adopt it — it already lives in the video model's own world, so the final shot won't drift."],
    "pv.l1": ["参考图：人设三视图 ≤5、场景图 ≤2、道具图 ≤2，按本批实际出场自动挑", "References: up to 5 character sheets, 2 scene plates, 2 props — picked per batch from who actually appears"],
    "pv.l2": ["每镜 0.5 / 0.75 / 1 秒，一条最长 15 秒，超了自动分批", "0.5 / 0.75 / 1 s per shot, 15 s per clip, auto-batched beyond that"],
    "pv.l3": ["截帧一律人工：进度条自动跳回上次截的位置", "Picking is always manual; the scrubber jumps back to where you last picked"],
    "pv.l4": ["截下来的帧走版本库，和 gpt-image 画的、上传的并列", "Picked frames are versions, side by side with drawn or uploaded ones"],
    "pv.tray": ["已截首帧", "PICKED"], "pv.stampL": ["✓ 首帧", "✓ FRAME"], "pv.hint": ["试试拖动 ↑", "Try scrubbing ↑"], "pv.btn": ["采用当前帧为首帧", "Adopt as first frame"],
    "kf.k": ["出片", "Generation"], "kf.title": ["关键帧与分段", "Keyframes and segments"],
    "kf.body": ["只有首帧时，结束画面全看模型发挥。加一张尾帧，起止都钉死；加中间关键帧，就按帧切成几段，每段一次首尾帧生成，出完拼接——接缝是同一张图，画面连续。", "With only a first frame, the ending is whatever the model feels like. Add a last frame and both ends are pinned. Add a mid keyframe and the shot splits into segments, each generated first-to-last and concatenated — the seam is the same image, so it cuts clean."],
    "kf.c1": ["① 只有首帧", "① First frame only"], "kf.c2": ["② 加尾帧：起止钉死", "② Add a last frame: both ends pinned"], "kf.c3": ["③ 加中间帧：切成两段，各自首尾帧，拼接", "③ Add a mid keyframe: two segments, each first-to-last, concatenated"],
    "kf.seg1": ["段 1", "SEG 1"], "kf.seg2": ["段 2", "SEG 2"], "kf.first": ["首帧 · 0s", "FIRST · 0s"], "kf.mid": ["关键帧 · 6s", "KEY · 6s"], "kf.last": ["尾帧 · 13s", "LAST · 13s"],
    "kf.m1": ["首帧模式 · Turbo", "first-frame · Turbo"], "kf.m2": ["首尾帧 · 起止钉死", "first + last · pinned"], "kf.m3": ["分段 · 2 × 首尾帧 → 拼接", "segments · 2 × first+last → concat"],
    "ln.k": ["版本", "Versions"], "ln.title": ["版本与血缘", "Versions and lineage"],
    "ln.body": ["每一次生成都是一个版本，能回看、能切回、能弃。每个产物记着生成那一刻全部输入的指纹——改了上游不用传播，重算一遍就知道谁过期了。点一个上游节点试试。", "Every generation is a version you can revisit, restore or discard. Every output stores a fingerprint of all its inputs — nothing to propagate; recompute and you know what's stale. Click an upstream node."],
    "ln.hint": ["点击节点 = 改了它", "click a node = you edited it"], "ln.regen": ["重新生成 ↻", "Regenerate ↻"],
    "ln.sheet": ["三视图", "Char. sheet"], "ln.scene": ["场景图", "Scene plate"], "ln.fprompt": ["首帧提示词", "Frame prompt"], "ln.frame": ["首帧", "First frame"], "ln.vprompt": ["视频提示词", "Video prompt"], "ln.video": ["视频", "Video"], "ln.clip": ["成片片段", "Clip"], "ln.stale": ["已过期", "STALE"],
    "sc.k": ["界面", "Interface"], "sc.title": ["工作台", "The workbench"],
    "sc.t0": ["分镜", "Storyboard"], "sc.t1": ["预演", "Previz"], "sc.t2": ["版本", "Versions"], "sc.t3": ["时间线", "Timeline"], "sc.t4": ["画布", "Canvas"], "sc.t5": ["人物库", "Characters"], "sc.t6": ["场景库", "Scenes"], "sc.t7": ["导出", "Export"],
    "sc.c0": ["左栏分镜组与镜头缩略图，中栏镜头编辑器，右栏参考 · 首帧 · 视频三个阶段。首帧页顶上是预演截帧的进度条。", "Units and shot thumbnails on the left, the shot editor in the middle, three stages on the right — references, first frame, video. The previz scrubber sits at the top of the frame stage."],
    "sc.c1": ["预演面板：一批 20 镜 15 秒，参考图按本批实际出场的人自动挑；格子上的「去截帧」直接跳到那一镜。", "Previz panel: 20 shots in 15 seconds, references picked per batch; “pick” on a cell jumps straight to that shot."],
    "sc.c2": ["视频页的版本面板：并排比较，「再出一版」可以不替换当前，采用 / 备注 / 弃。", "Version panel on the video stage: compare side by side, generate another take without replacing the current one, adopt / label / discard."],
    "sc.c3": ["时间线面板：拖圆点改关键帧时间点，右侧列出将怎样切段出片。", "Timeline panel: drag dots to move keyframes; the right side lists exactly how the shot will be segmented."],
    "sc.c4": ["画布：一镜的资产 → 首帧 → 关键帧 → 视频 → 片段摊成节点图，过期的标红。", "Canvas: one shot's assets → frame → keyframes → video → clip as a node graph, stale ones flagged."],
    "sc.c5": ["人物库：按人设 tag 分版本，每个版本一张三视图和一个声音样本。", "Characters: versioned by persona tag, each with a three-view sheet and a voice sample."],
    "sc.c6": ["场景库：两格正反打的空间基准图，出首帧和预演时作为参考。", "Scenes: two-panel shot/reverse-shot plates used as references for frames and previz."],
    "sc.c7": ["时间线与导出：裁切、淡入淡出、BGM 连续段落、对齐字幕、一键导出。", "Timeline and export: trims, fades, continuous BGM runs, aligned subtitles, one-click export."],
    "st.k": ["技术", "Stack"], "st.title": ["站在这些肩膀上", "Built on"],
    "st.body": ["单进程自带任务队列，一台机器就能跑。切供应商只改一个环境变量；每一次生成的成本都记在版本上。", "One process with its own job queue; runs on a single machine. Switching providers is one env var; every generation's cost is recorded on its version."],
    "go.k": ["开始", "Start"], "go.title": ["五分钟跑起来", "Up in five minutes"],
    "go.body": ["需要 ffmpeg / ffprobe（带 libass）。数据库与生成文件放在项目目录外，别让文件监听把生成当成源码变更。", "Needs ffmpeg / ffprobe (with libass). Keep the database and generated files outside the project folder so the file watcher doesn't mistake output for source changes."],
    "go.deploy": ["部署到服务器", "Deploy to a server"], "go.copy": ["复制", "Copy"],
    "foot.line": ["名字来自片场的「场记」：记板、对镜号、管连戏。这个工具干的也是这些事。", "Named after the slate operator on set — the one who claps the board, numbers the takes and keeps continuity. Same job."],
  };
  const TITLES = ["场记 · Slate — AI 短剧生产工作台", "Slate (场记) — AI short-drama studio"];
  const WIN = [["分镜工作台", "storyboard"], ["预演", "previz"], ["版本", "versions"], ["时间线", "timeline"], ["画布", "canvas"], ["人物库", "characters"], ["场景库", "scenes"], ["导出", "export"]];

  let lang = (new URLSearchParams(location.search).get("lang") || localStorage.getItem("slate.lang") || (navigator.language.startsWith("zh") ? "zh" : "en")) === "en" ? 1 : 0;
  const t = (k) => (T[k] ? T[k][lang] : null);

  function applyLang(animate) {
    document.documentElement.lang = lang ? "en" : "zh-CN";
    document.title = TITLES[lang];
    $("#lang").textContent = lang ? "中" : "EN";
    $$("[data-i]").forEach((el) => {
      const v = t(el.dataset.i);
      if (v == null || el.id === "tagline") return;
      el.textContent = v;
    });
    // captions that live in JS state
    setWinCaption(curTab);
    setTlCap(tlStage);
    typewrite($("#tagline"), t("hero.tagline"), animate);
    try { localStorage.setItem("slate.lang", lang ? "en" : "zh"); } catch {}
  }
  function toggleLang() { lang = lang ? 0 : 1; applyLang(true); }
  $("#lang").addEventListener("click", toggleLang);
  $$("[data-lang-toggle]").forEach((b) => b.addEventListener("click", toggleLang));

  /* ------------------------------------------------------------ typewriter */
  let typeTimer = 0;
  function typewrite(el, text, animate) {
    clearTimeout(typeTimer);
    if (reduce || !animate) { el.textContent = text; return; }
    el.textContent = "";
    let i = 0;
    const step = () => {
      el.textContent = text.slice(0, ++i);
      if (i < text.length) typeTimer = setTimeout(step, /[，。,.]/.test(text[i - 1]) ? 260 : 70 + Math.random() * 60);
    };
    typeTimer = setTimeout(step, 1200);
  }

  /* ------------------------------------------------------------ nav / progress / parallax */
  const nav = $("#nav"), prog = $(".progress i"), heroBg = $("#heroBg"), hero = $(".hero"), glow = $("#heroGlow");
  let ticking = false;
  const onScroll = () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const y = scrollY;
      nav.classList.toggle("solid", y > innerHeight * 0.7);
      const h = document.documentElement;
      prog.style.width = ((y / (h.scrollHeight - h.clientHeight)) * 100).toFixed(2) + "%";
      if (!reduce && y < innerHeight * 1.2) heroBg.style.transform = `translateY(${y * 0.28}px)`;
      ticking = false;
    });
  };
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  if (!reduce) {
    let gx = 30, gy = 50, tx = 30, ty = 50;
    hero.addEventListener("pointermove", (e) => { const r = hero.getBoundingClientRect(); tx = ((e.clientX - r.left) / r.width) * 100; ty = ((e.clientY - r.top) / r.height) * 100; });
    (function loop() { gx += (tx - gx) * 0.06; gy += (ty - gy) * 0.06; glow.style.setProperty("--mx", gx + "%"); glow.style.setProperty("--my", gy + "%"); requestAnimationFrame(loop); })();
  }

  /* ------------------------------------------------------------ reveal */
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -10% 0px", threshold: 0.08 });
  $$("[data-reveal]").forEach((el) => io.observe(el));
  const stepsIo = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); stepsIo.unobserve(e.target); } }), { threshold: 0.3 });
  stepsIo.observe($("#steps"));

  /* ------------------------------------------------------------ filmstrip */
  const FRAMES = 16;
  const frames = Array.from({ length: FRAMES }, (_, i) => `assets/frames/f${String(i).padStart(2, "0")}.jpg`);
  const fill = (track, list) => { track.innerHTML = [...list, ...list].map((s) => `<img src="${s}" alt="" loading="lazy">`).join(""); };
  fill($("#track1"), frames);
  fill($("#track2"), [...frames.slice(8), ...frames.slice(0, 8)]);

  /* ------------------------------------------------------------ counters */
  const numIo = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return;
    numIo.unobserve(e.target);
    const el = e.target, n = +el.dataset.n, t0 = performance.now(), dur = 1400;
    const tick = (now) => { const p = Math.min(1, (now - t0) / dur), k = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(n * k); if (p < 1) requestAnimationFrame(tick); };
    if (reduce) el.textContent = n; else requestAnimationFrame(tick);
  }), { threshold: 0.6 });
  $$(".num").forEach((el) => numIo.observe(el));

  /* ------------------------------------------------------------ split slider */
  const split = $("#split"), splitIn = $("input", split);
  const setSplit = (v) => split.style.setProperty("--p", v + "%");
  splitIn.addEventListener("input", () => setSplit(splitIn.value));
  // gentle idle sway until touched
  let splitTouched = false, splitT = 0;
  splitIn.addEventListener("pointerdown", () => (splitTouched = true), { once: true });
  if (!reduce) (function sway() { if (!splitTouched) { splitT += 0.012; const v = 50 + Math.sin(splitT) * 18; splitIn.value = v; setSplit(v); } requestAnimationFrame(sway); })();

  /* ------------------------------------------------------------ previz demo */
  const PV = [
    ["#01", 0.31], ["#02", 1.04], ["#03", 1.78], ["#04", 2.64], ["#05", 3.25], ["#06", 4.11], ["#07", 5.34], ["#08", 6.20], ["#09", 7.19],
    ["#10", 8.41], ["#11", 9.27], ["#12", 10.01], ["#13", 10.50], ["#14", 11.48], ["#15", 12.10], ["#16", 12.83], ["#17", 13.57],
  ];
  const scrub = $("#scrub"), strip = $("#scrubStrip"), monImg = $("#monImg"), monShot = $("#monShot"), monTime = $("#monTime"), monStamp = $("#monStamp"), tray = $(".tray-items"), pvHint = $("#pvHint");
  strip.innerHTML = PV.map((_, i) => `<img src="assets/previz/p${String(i).padStart(2, "0")}.jpg" alt="" data-k="${i}">`).join("");
  const stripImgs = $$("img", strip);
  const picked = new Set();
  function showPv(i) {
    i = Math.max(0, Math.min(PV.length - 1, i));
    monImg.src = `assets/previz/p${String(i).padStart(2, "0")}.jpg`;
    monShot.textContent = PV[i][0];
    monTime.textContent = PV[i][1].toFixed(2) + "s";
    stripImgs.forEach((im, k) => im.classList.toggle("on", k === i));
    monStamp.classList.toggle("show", picked.has(i));
    if (!picked.has(i)) monStamp.classList.remove("show");
  }
  let pvAuto = true, pvIdx = 0;
  scrub.addEventListener("input", () => { pvAuto = false; pvHint.style.opacity = "0"; showPv(pvIdx = +scrub.value); });
  stripImgs.forEach((im) => im.addEventListener("click", () => { pvAuto = false; scrub.value = pvIdx = +im.dataset.k; showPv(pvIdx); }));
  const emptyTray = () => { if (!tray.children.length) tray.innerHTML = `<span class="empty">—</span>`; };
  emptyTray();
  $("#adopt").addEventListener("click", () => {
    pvAuto = false;
    picked.add(pvIdx);
    monStamp.classList.remove("show"); void monStamp.offsetWidth; monStamp.classList.add("show");
    if (tray.querySelector(".empty")) tray.innerHTML = "";
    if (!tray.querySelector(`[data-k="${pvIdx}"]`)) {
      const im = document.createElement("img"); im.src = monImg.src; im.dataset.k = pvIdx; im.title = PV[pvIdx][0]; tray.appendChild(im);
    }
  });
  showPv(0);
  const pvIo = new IntersectionObserver((es) => es.forEach((e) => { pvVisible = e.isIntersecting; }), { threshold: 0.4 });
  let pvVisible = false; pvIo.observe($(".monitor"));
  if (!reduce) setInterval(() => { if (pvAuto && pvVisible) { pvIdx = (pvIdx + 1) % PV.length; scrub.value = pvIdx; showPv(pvIdx); } }, 800);

  /* ------------------------------------------------------------ keyframe cycle */
  const tl = $("#tl"), tlCap = $("#tlCap");
  let tlStage = 1;
  const setTlCap = (s) => { tlCap.textContent = t(`kf.c${s}`); };
  const setStage = (s) => { tlStage = s; tl.dataset.stage = s; tlCap.style.opacity = "0"; setTimeout(() => { setTlCap(s); tlCap.style.opacity = "1"; }, 200); };
  setStage(1);
  let tlVisible = false;
  new IntersectionObserver((es) => es.forEach((e) => (tlVisible = e.isIntersecting)), { threshold: 0.3 }).observe(tl);
  if (!reduce) setInterval(() => { if (tlVisible) setStage((tlStage % 3) + 1); }, 2800);
  else setStage(3);

  /* ------------------------------------------------------------ lineage graph */
  const G = { sheet: ["frame"], scene: ["frame"], fprompt: ["frame"], frame: ["video"], vprompt: ["video"], video: ["clip"], clip: [] };
  const EDGES = { "sheet-frame": ["sheet", "frame"], "scene-frame": ["scene", "frame"], "fprompt-frame": ["fprompt", "frame"], "frame-video": ["frame", "video"], "vprompt-video": ["vprompt", "video"], "video-clip": ["video", "clip"] };
  const graph = $("#graph"), edited = new Set();
  const node = (id) => $(`.node[data-id="${id}"]`, graph);
  function recompute() {
    const stale = new Set();
    const walk = (id) => G[id].forEach((n) => { if (!stale.has(n)) { stale.add(n); walk(n); } });
    edited.forEach(walk);
    $$(".node", graph).forEach((n) => { n.classList.toggle("edited", edited.has(n.dataset.id)); n.classList.toggle("stale", stale.has(n.dataset.id)); });
    $$(".edges path", graph).forEach((p) => { const [a, b] = EDGES[p.dataset.e]; p.classList.toggle("hot", (edited.has(a) || stale.has(a)) && stale.has(b)); });
  }
  $$(".node.up", graph).forEach((n) => n.addEventListener("click", () => { const id = n.dataset.id; if (edited.has(id)) edited.delete(id); else edited.add(id); recompute(); }));
  $("#regen").addEventListener("click", () => {
    const wasStale = $$(".node.stale", graph);
    edited.clear(); recompute();
    wasStale.forEach((n) => { n.classList.add("fresh"); setTimeout(() => n.classList.remove("fresh"), 1300); });
  });
  // one-shot demo when it scrolls into view
  new IntersectionObserver((es, o) => es.forEach((e) => { if (e.isIntersecting && !reduce) { o.disconnect(); setTimeout(() => { edited.add("fprompt"); recompute(); }, 900); } }), { threshold: 0.5 }).observe(graph);

  /* ------------------------------------------------------------ screens */
  const SCREENS = ["01-storyboard", "02-previz", "03-video-versions", "04-timeline-panel", "05-canvas", "06-characters", "07-scenes", "08-export"];
  const tabs = $$("#tabs button"), winImg = $("#winImg"), winTitle = $("#winTitle"), winCap = $("#winCap"), win = $("#window");
  let curTab = 0, tabAuto = true;
  function setWinCaption(i) { winCap.textContent = t(`sc.c${i}`); winTitle.textContent = `localhost:3000 · ${WIN[i][lang]}`; }
  function showTab(i) {
    curTab = i;
    tabs.forEach((b, k) => b.classList.toggle("on", k === i));
    const im = new Image(); im.src = `assets/screens/${SCREENS[i]}.jpg`; im.onload = () => { winImg.src = im.src; };
    setWinCaption(i);
  }
  tabs.forEach((b) => b.addEventListener("click", () => { tabAuto = false; showTab(+b.dataset.t); }));
  SCREENS.forEach((s) => { const im = new Image(); im.src = `assets/screens/${s}.jpg`; });
  let winVisible = false;
  new IntersectionObserver((es) => es.forEach((e) => (winVisible = e.isIntersecting)), { threshold: 0.3 }).observe(win);
  if (!reduce) setInterval(() => { if (tabAuto && winVisible && !win.matches(":hover")) showTab((curTab + 1) % SCREENS.length); }, 4200);
  if (!reduce) {
    win.addEventListener("pointermove", (e) => { const r = win.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5; win.style.transform = `perspective(1400px) rotateY(${x * 6}deg) rotateX(${-y * 5}deg)`; });
    win.addEventListener("pointerleave", () => { win.style.transform = ""; });
  }

  /* ------------------------------------------------------------ copy */
  $("#copy").addEventListener("click", async () => {
    const txt = $("#codeBlock").innerText.replace(/\s+#.*$/gm, "");
    try { await navigator.clipboard.writeText(txt); $("#copy").textContent = lang ? "Copied" : "已复制"; setTimeout(() => ($("#copy").textContent = t("go.copy")), 1500); } catch {}
  });

  /* ------------------------------------------------------------ go */
  applyLang(true);
})();
