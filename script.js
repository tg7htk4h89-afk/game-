/* ============================================================
 * مسابقات ماما حجية هناء — محرك اللعبة
 *
 * الأدوار:
 *   - الشاشة الرئيسية (host.html): تعرض اللوحة، السؤال، العدّاد، النتائج
 *   - شاشة الحكم (judge.html): يقرر صح/غلط، يشوف الإجابة الصحيحة
 *   - شاشة اللاعب (player.html): يختار الفئة + درجة الصعوبة
 *
 * الحالة (state) تتشارك بين الشاشات الثلاث عبر localStorage
 * (لاختبار محلي). للعبة على أجهزة متعددة، استبدل LocalTransport
 * بطبقة شبكة (n8n / Firebase / Supabase).
 * ============================================================ */

(function () {
  "use strict";

  const CFG = window.QUIZ_CONFIG;
  const CATEGORIES = window.QUIZ_CATEGORIES;

  /* ---------- أدوات ---------- */
  const $  = (sel, ctx = document) => ctx.querySelector(sel);
  const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
  const showScreen = (selector, attr = "data-screen") => {
    $$(`[${attr}]`).forEach(el => el.classList.add("hidden"));
    const target = $(`[${attr}="${selector}"]`);
    if (target) target.classList.remove("hidden");
  };
  const randCode = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 6; i++) out += chars[Math.floor(Math.random() * chars.length)];
    return out;
  };

  // اختر عناصر عشوائية من مصفوفة بدون تكرار
  const pickRandom = (arr, n) => {
    const copy = arr.slice();
    const out = [];
    while (out.length < n && copy.length > 0) {
      const idx = Math.floor(Math.random() * copy.length);
      out.push(copy.splice(idx, 1)[0]);
    }
    return out;
  };

  // درجات الصعوبة الـ ٦ (٢٠٠ سهل، ١٢٠٠ صعب)
  const POINTS_TIERS = [200, 400, 600, 800, 1000, 1200];

  // hash بسيط للسؤال (DJB2) — متطابق مع نفس النص دائماً
  const hashQuestion = (text) => {
    let h = 5381;
    for (let i = 0; i < text.length; i++) {
      h = ((h << 5) + h) + text.charCodeAt(i);
      h = h & 0xFFFFFFFF;
    }
    return "h" + Math.abs(h).toString(16);
  };

  // ابنِ فئات هذه اللعبة من بنك الأسئلة الكامل (async الآن)
  // - يستثني الأسئلة المستخدمة سابقاً
  // - يضمن العدل التام (٥ أسئلة من كل فئة)
  // - يرجع قائمة الـ hashes عشان نسجلها بعد البناء
  const buildGameCategoriesFromIndices = async (indices) => {
    let usedHashes = [];
    try {
      usedHashes = await Transport.getUsedQuestions();
    } catch (e) {
      console.warn("could not get used questions:", e);
    }
    const usedSet = new Set(usedHashes);

    const selected = indices.map(i => CATEGORIES[i]).filter(Boolean);
    const allHashesUsedThisGame = [];

    const result = selected.map(cat => {
      let available = (cat.pool || []).filter(q => !usedSet.has(hashQuestion(q.q)));
      if (available.length < POINTS_TIERS.length) {
        console.warn(`فئة ${cat.name}: استنفدنا الأسئلة، نستخدم البنك كاملاً`);
        available = cat.pool || [];
      }
      const picked = pickRandom(available, POINTS_TIERS.length);
      while (picked.length < POINTS_TIERS.length && cat.pool && cat.pool.length > 0) {
        picked.push(cat.pool[Math.floor(Math.random() * cat.pool.length)]);
      }
      picked.forEach(q => {
        allHashesUsedThisGame.push({
          hash: hashQuestion(q.q),
          category: cat.name
        });
      });
      return {
        name: cat.name,
        emoji: cat.emoji,
        questions: picked.map((q, i) => ({
          points: POINTS_TIERS[i],
          question: q.q,
          correctAnswer: q.a
        }))
      };
    });

    return { categories: result, usedEntries: allHashesUsedThisGame };
  };

  // الإصدار القديم (للتوافق): يختار فئات عشوائياً
  const buildGameCategories = async () => {
    const numCats = (CFG.categoriesPerGame || 6);
    const allIndices = CATEGORIES.map((_, i) => i);
    const indices = pickRandom(allIndices, numCats);
    return buildGameCategoriesFromIndices(indices);
  };
  // (السطر القديم بقايا — نحذفه بعد)
  const _OLD_buildGameCategories = async () => {
    const numCats = (CFG.categoriesPerGame || 6);

    // اجلب الأسئلة المستخدمة سابقاً
    let usedHashes = [];
    try {
      usedHashes = await Transport.getUsedQuestions();
    } catch (e) {
      console.warn("could not get used questions:", e);
    }
    const usedSet = new Set(usedHashes);

    const selected = pickRandom(CATEGORIES, numCats);
    const allHashesUsedThisGame = [];

    const result = selected.map(cat => {
      // فلتر الأسئلة غير المستخدمة
      let available = (cat.pool || []).filter(q => !usedSet.has(hashQuestion(q.q)));

      // لو ما في كفاية أسئلة جديدة، استخدم البنك كاملاً (يعني خلصت كل الأسئلة)
      if (available.length < POINTS_TIERS.length) {
        console.warn(`فئة ${cat.name}: استنفدنا الأسئلة، نستخدم البنك كاملاً`);
        available = cat.pool || [];
      }

      const picked = pickRandom(available, POINTS_TIERS.length);
      // ضمان العدد المطلوب
      while (picked.length < POINTS_TIERS.length && cat.pool && cat.pool.length > 0) {
        picked.push(cat.pool[Math.floor(Math.random() * cat.pool.length)]);
      }

      // سجل الـ hashes اللي اخترناها في هذي اللعبة
      picked.forEach(q => {
        allHashesUsedThisGame.push({
          hash: hashQuestion(q.q),
          category: cat.name
        });
      });

      return {
        name: cat.name,
        emoji: cat.emoji,
        questions: picked.map((q, i) => ({
          points: POINTS_TIERS[i],
          question: q.q,
          correctAnswer: q.a
        }))
      };
    });

    return { categories: result, usedEntries: allHashesUsedThisGame };
  };

  // أرقام عربية هندية
  const arDigits = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
  const ar = (n) => String(n).replace(/\d/g, d => arDigits[d]);

  /* ============================================================
   * طبقة النقل
   *   - LocalTransport: تخزين محلي (للاختبار على جهاز واحد)
   *   - N8nTransport:   خادم حقيقي عبر n8n (للأجهزة المتعددة)
   *
   * الواجهة الموحدة (كل الدوال async):
   *   - create(code, state)  → ينشئ لعبة جديدة
   *   - read(code)           → يقرأ الحالة (يرجع state أو null)
   *   - write(code, state)   → يحدّث الحالة
   *   - poll(code, callback) → يستدعي callback عند تغيّر الحالة
   * ============================================================ */

  const LocalTransport = {
    key(code) { return `mamahanaa::${code}`; },

    async create(code, state) {
      state.lastUpdate = Date.now();
      localStorage.setItem(this.key(code), JSON.stringify(state));
      return state;
    },

    async read(code) {
      try { return JSON.parse(localStorage.getItem(this.key(code))) || null; }
      catch { return null; }
    },

    async write(code, state) {
      state.lastUpdate = Date.now();
      localStorage.setItem(this.key(code), JSON.stringify(state));
      return state;
    },

    poll(code, callback, intervalMs = 300) {
      let lastUpdate = 0;
      const tick = async () => {
        const cur = await this.read(code);
        if (cur && cur.lastUpdate !== lastUpdate) {
          lastUpdate = cur.lastUpdate;
          try { callback(cur); } catch (_) {}
        }
      };
      tick();
      const id = setInterval(tick, intervalMs);
      return () => clearInterval(id);
    },

    async getUsedQuestions() {
      try {
        return JSON.parse(localStorage.getItem("mamahanaa::used") || "[]");
      } catch { return []; }
    },

    async markUsedQuestions(code, entries) {
      const cur = await this.getUsedQuestions();
      const set = new Set(cur);
      entries.forEach(e => set.add(e.hash));
      localStorage.setItem("mamahanaa::used", JSON.stringify([...set]));
      return true;
    }
  };

  const N8nTransport = {
    base() { return CFG.backend.n8nBaseUrl.replace(/\/$/, ""); },

    async create(code, state) {
      state.lastUpdate = Date.now();
      const url = `${this.base()}/mama-hanaa-create`;
      console.log("→ POST", url, { code });
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state })
        });
        const text = await r.text();
        console.log("← create response:", r.status, text.substring(0, 200));
        if (!r.ok) {
          throw new Error(`HTTP ${r.status}: ${text.substring(0, 100)}`);
        }
        return state;
      } catch (e) {
        console.error("create error details:", e);
        throw e;
      }
    },

    async read(code) {
      try {
        const r = await fetch(`${this.base()}/mama-hanaa-read?code=${encodeURIComponent(code)}`);
        if (!r.ok) {
          console.warn("read returned", r.status);
          return null;
        }
        const data = await r.json();
        return data && data.state ? data.state : null;
      } catch (e) {
        console.error("read error", e);
        return null;
      }
    },

    async write(code, state) {
      state.lastUpdate = Date.now();
      const url = `${this.base()}/mama-hanaa-write`;
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, state })
        });
        if (!r.ok) {
          const text = await r.text();
          throw new Error(`HTTP ${r.status}: ${text.substring(0, 100)}`);
        }
        return state;
      } catch (e) {
        console.error("write error:", e);
        throw e;
      }
    },

    poll(code, callback, intervalMs = 1500) {
      let lastUpdate = 0;
      const tick = async () => {
        const cur = await this.read(code);
        if (cur && cur.lastUpdate !== lastUpdate) {
          lastUpdate = cur.lastUpdate;
          try { callback(cur); } catch (_) {}
        }
      };
      tick();
      const id = setInterval(tick, intervalMs);
      return () => clearInterval(id);
    },

    async getUsedQuestions() {
      try {
        const r = await fetch(`${this.base()}/mama-hanaa-get-used`);
        if (!r.ok) return [];
        const data = await r.json();
        return (data && data.hashes) || [];
      } catch (e) {
        console.warn("getUsedQuestions error:", e);
        return [];
      }
    },

    async markUsedQuestions(code, entries) {
      try {
        const r = await fetch(`${this.base()}/mama-hanaa-mark-used`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, entries })
        });
        return r.ok;
      } catch (e) {
        console.warn("markUsedQuestions error:", e);
        return false;
      }
    }
  };

  // اختر طبقة النقل حسب الإعدادات
  const Transport = (CFG.backend && CFG.backend.mode === "n8n")
    ? N8nTransport
    : LocalTransport;

  /* ============================================================
   * شكل حالة اللعبة:
   * {
   *   code,
   *   status: "lobby" | "board" | "selecting-difficulty" | "question" | "judging" | "result" | "final",
   *   teams: { team1: {name, score}, team2: {name, score} },
   *   currentTurn: "team1" | "team2",
   *   used: ["0-200", "0-400", ...],   // الأسئلة المستخدمة
   *   selectedCategory: 0..3,
   *   selectedDifficulty: 200|400|600,
   *   questionStartedAt: ms,
   *   lastResult: { team, points, correct },
   *   judgeConnected: bool,
   *   playerConnected: bool
   * }
   * ============================================================ */

  function newGameState(code) {
    return {
      code,
      status: "lobby",
      teams: {
        team1: { name: "", score: 0, connected: false },
        team2: { name: "", score: 0, connected: false }
      },
      currentTurn: "team1",
      // قائمة كل الفئات المتاحة (بدون أسئلة، فقط أسماء + emojis للتصويت)
      availableCategories: [],
      // أصوات الفريقين على الفئات (مصفوفة من indices في availableCategories)
      team1Votes: [],
      team2Votes: [],
      // الفئات النهائية بعد التصويت + الأسئلة المختارة
      gameCategories: [],
      used: [],
      // عدّاد لكل فريق × كل فئة (للعدل التام: ٢ من كل فئة لكل فريق)
      catCounts: {
        team1: {},
        team2: {}
      },
      selectedCategory: -1,
      selectedDifficulty: 0,
      questionStartedAt: 0,
      lastResult: null,
      judgeConnected: false,
      lastUpdate: Date.now()
    };
  }

  /* ============================================================
   * الشاشة الرئيسية (host.html)
   * ============================================================ */
  function initHost() {
    const code = randCode();
    let state = newGameState(code);
    let timerInterval = null;
    let pollStop = null;

    /* ---- قاعة الانتظار ---- */
    $("#gameCodeDisplay").textContent = code.split("").join(" ");
    if ($("#lobbyHint")) $("#lobbyHint").textContent = "جارٍ تجهيز اللعبة…";

    // أنشئ اللعبة (بدون أسئلة بعد — تُبنى بعد التصويت)
    (async () => {
      try {
        // نخزن قائمة الفئات المتاحة (للتصويت)
        state.availableCategories = CATEGORIES.map(c => ({
          name: c.name,
          emoji: c.emoji
        }));

        await Transport.create(code, state);
        console.log("✓ Game created in DB:", code);
        if ($("#lobbyHint")) $("#lobbyHint").textContent = "في انتظار انضمام الفريقين والحكم…";

        pollStop = Transport.poll(code, (newState) => {
          if (!newState) return;
          state = newState;
          handleStateChange();
        });
      } catch (err) {
        console.error("✗ create failed:", err);
        alert("فشل إنشاء اللعبة: " + err.message);
        if ($("#lobbyHint")) $("#lobbyHint").textContent = "❌ " + err.message;
      }
    })();

    $("#copyTeamLink")?.addEventListener("click", () => {
      const link = `${location.origin}${location.pathname.replace("host.html","")}team.html?code=${code}`;
      navigator.clipboard?.writeText(link);
      const btn = $("#copyTeamLink");
      const original = btn.textContent;
      btn.textContent = "تم النسخ ✓";
      setTimeout(() => (btn.textContent = original), 1500);
    });
    $("#copyJudgeLink")?.addEventListener("click", () => {
      const link = `${location.origin}${location.pathname.replace("host.html","")}judge.html?code=${code}`;
      navigator.clipboard?.writeText(link);
      const btn = $("#copyJudgeLink");
      const original = btn.textContent;
      btn.textContent = "تم النسخ ✓";
      setTimeout(() => (btn.textContent = original), 1500);
    });

    let lastSeenStatus = "";
    let lastSeenQuestionStart = 0;

    function handleStateChange() {
      // تحديث مؤشرات الاتصال (٣ أشخاص: قائد فريق ١، قائد فريق ٢، الحكم)
      const t1Connected = state.teams.team1.connected;
      const t2Connected = state.teams.team2.connected;
      const jConnected = state.judgeConnected;

      const t1Status = $("#team1Status");
      const t2Status = $("#team2Status");
      const judgeStatus = $("#judgeStatus");
      if (t1Status) t1Status.classList.toggle("status-pill--ok", t1Connected);
      if (t2Status) t2Status.classList.toggle("status-pill--ok", t2Connected);
      if (judgeStatus) judgeStatus.classList.toggle("status-pill--ok", jConnected);

      if ($("#team1StatusText"))
        $("#team1StatusText").textContent = t1Connected ? state.teams.team1.name + " ✓" : "في انتظار قائد الفريق…";
      if ($("#team2StatusText"))
        $("#team2StatusText").textContent = t2Connected ? state.teams.team2.name + " ✓" : "في انتظار قائد الفريق…";
      if ($("#judgeStatusText"))
        $("#judgeStatusText").textContent = jConnected ? "متصل ✓" : "في انتظار الحكم…";

      const startBtn = $("#startGameBtn");
      if (startBtn) startBtn.disabled = !(t1Connected && t2Connected && jConnected);

      // تحديث الشاشة حسب الحالة
      if (state.status === "lobby") {
        showScreen("lobby");
      } else if (state.status === "voting") {
        renderVoting();
        showScreen("voting");
      } else if (state.status === "building") {
        showScreen("voting");
        if ($("#votingStatus")) $("#votingStatus").textContent = "جارٍ تجهيز اللعبة…";
      } else if (state.status === "board") {
        renderBoard();
        showScreen("board");
      } else if (state.status === "question") {
        renderQuestion();
        showScreen("question");
        if (state.questionStartedAt !== lastSeenQuestionStart) {
          lastSeenQuestionStart = state.questionStartedAt;
          startTimer();
        }
      } else if (state.status === "judging") {
        clearInterval(timerInterval);
        $("#timerNum").textContent = "—";
      } else if (state.status === "result") {
        clearInterval(timerInterval);
        showResult();
        showScreen("result");
      } else if (state.status === "final") {
        showFinal();
        showScreen("final");
      }
    }

    /* ---- بدء اللعبة (يفعّل التصويت) ---- */
    $("#startGameBtn")?.addEventListener("click", async () => {
      state.status = "voting";
      await Transport.write(code, state);
    });

    /* ---- زر إنهاء اللعبة (في شاشة اللوحة) ---- */
    $("#endGameBtn")?.addEventListener("click", async () => {
      const confirm1 = confirm("هل أنت متأكد إنك تبي تنهي اللعبة الحالية؟");
      if (!confirm1) return;
      const cur = await Transport.read(code);
      if (!cur) return;
      cur.status = "final";
      await Transport.write(code, cur);
    });

    /* ---- شاشة التصويت على الفئات ---- */
    function renderVoting() {
      const team1Done = (state.team1Votes || []).length >= (CFG.categoriesPerTeam || 3);
      const team2Done = (state.team2Votes || []).length >= (CFG.categoriesPerTeam || 3);

      if ($("#votingTeam1Status")) {
        $("#votingTeam1Status").textContent = team1Done
          ? `✓ اختار ${ar((state.team1Votes || []).length)} فئات`
          : `يختار ${ar((state.team1Votes || []).length)}/${ar(CFG.categoriesPerTeam || 3)}`;
        $("#votingTeam1Status").classList.toggle("voting-status--done", team1Done);
      }
      if ($("#votingTeam2Status")) {
        $("#votingTeam2Status").textContent = team2Done
          ? `✓ اختار ${ar((state.team2Votes || []).length)} فئات`
          : `يختار ${ar((state.team2Votes || []).length)}/${ar(CFG.categoriesPerTeam || 3)}`;
        $("#votingTeam2Status").classList.toggle("voting-status--done", team2Done);
      }

      if ($("#votingTeam1Name")) $("#votingTeam1Name").textContent = state.teams.team1.name || "الفريق ١";
      if ($("#votingTeam2Name")) $("#votingTeam2Name").textContent = state.teams.team2.name || "الفريق ٢";

      // إذا الفريقين خلصوا، نبني الـ gameCategories
      if (team1Done && team2Done && state.status === "voting") {
        finishVoting();
      }
    }

    async function finishVoting() {
      // امنع التكرار: نسوي حالة intermediate "building"
      const cur = await Transport.read(code);
      if (!cur || cur.status !== "voting") return;
      cur.status = "building";
      await Transport.write(code, cur);

      try {
        // دمج الأصوات (التكرار يتحول إلى وحدة)
        const votes = new Set([...(cur.team1Votes || []), ...(cur.team2Votes || [])]);
        let chosenIndices = [...votes];

        // لو ناقص (بسبب التكرار)، نكمل بفئات عشوائية
        const need = (CFG.categoriesPerGame || 6);
        while (chosenIndices.length < need) {
          const idx = Math.floor(Math.random() * CATEGORIES.length);
          if (!chosenIndices.includes(idx)) chosenIndices.push(idx);
        }
        chosenIndices = chosenIndices.slice(0, need);

        // ابنِ الفئات الفعلية مع الأسئلة (مع استثناء المستخدم سابقاً)
        const built = await buildGameCategoriesFromIndices(chosenIndices);
        cur.gameCategories = built.categories;

        // سجّل الأسئلة كمستخدمة
        await Transport.markUsedQuestions(code, built.usedEntries);
        console.log("✓ Built game with", built.categories.length, "categories");

        // ابدأ اللعبة الفعلية
        cur.status = "board";
        await Transport.write(code, cur);
      } catch (err) {
        console.error("finishVoting failed:", err);
        // ارجع للتصويت
        cur.status = "voting";
        await Transport.write(code, cur);
      }
    }

    /* ---- لوحة الفئات ---- */
    function renderBoard() {
      // عرض رمز اللعبة في الشريط العلوي
      const codeEl = $("#boardGameCode");
      if (codeEl) codeEl.textContent = code.split("").join(" ");

      // تحديث النتائج
      $("#hostTeam1Name").textContent = state.teams.team1.name;
      $("#hostTeam2Name").textContent = state.teams.team2.name;
      $("#hostTeam1Score").textContent = ar(state.teams.team1.score);
      $("#hostTeam2Score").textContent = ar(state.teams.team2.score);

      // تحديد دور الفريق
      const turnTeam = state.teams[state.currentTurn].name;
      $("#hostTurnIndicator").textContent = `دور: ${turnTeam}`;
      $("#hostTeam1Card")?.classList.toggle("team-card--active", state.currentTurn === "team1");
      $("#hostTeam2Card")?.classList.toggle("team-card--active", state.currentTurn === "team2");

      // اللوحة
      const grid = $("#boardGrid");
      grid.innerHTML = state.gameCategories.map((cat, ci) => `
        <div class="cat-col">
          <div class="cat-col__head">
            <div class="cat-col__emoji">${cat.emoji}</div>
            <div class="cat-col__name">${escapeHtml(cat.name)}</div>
          </div>
          ${cat.questions.map(q => {
            const used = state.used.includes(`${ci}-${q.points}`);
            return `<div class="cat-tile ${used ? 'cat-tile--used' : ''}">${used ? "✓" : ar(q.points)}</div>`;
          }).join("")}
        </div>
      `).join("");

      // تحقق إذا انتهت اللعبة
      if (state.used.length >= state.gameCategories.length * POINTS_TIERS.length) {
        setTimeout(async () => {
          state.status = "final";
          await Transport.write(code, state);
        }, 1500);
      }
    }

    /* ---- عرض السؤال ---- */
    function renderQuestion() {
      const cat = state.gameCategories[state.selectedCategory];
      const q = cat.questions.find(qq => qq.points === state.selectedDifficulty);
      if (!q) return;

      $("#qCategoryName").textContent = `${cat.emoji} ${cat.name}`;
      $("#qPointsValue").textContent = ar(state.selectedDifficulty);
      $("#qTeamTurn").textContent = state.teams[state.currentTurn].name;
      $("#questionText").textContent = q.question;
    }

    function startTimer() {
      const total = CFG.questionTime;
      const ring = $("#timerRing");
      const circumference = 2 * Math.PI * 54;
      ring.style.strokeDasharray = circumference;
      ring.style.strokeDashoffset = "0";
      $("#timerNum").textContent = ar(total);

      clearInterval(timerInterval);
      const tickStart = state.questionStartedAt;
      timerInterval = setInterval(() => {
        const elapsed = (Date.now() - tickStart) / 1000;
        const remaining = Math.max(0, total - elapsed);
        $("#timerNum").textContent = ar(Math.ceil(remaining));
        ring.style.strokeDashoffset = circumference * (1 - remaining / total);
        if (remaining <= 0) {
          clearInterval(timerInterval);
        }
      }, 100);
    }

    function showResult() {
      const r = state.lastResult;
      if (!r) return;
      const teamName = state.teams[r.team].name;
      const cat = state.gameCategories[state.selectedCategory];
      const q = cat.questions.find(qq => qq.points === state.selectedDifficulty);

      $("#resultIcon").textContent = r.correct ? "✓" : "✗";
      $("#resultBox").classList.toggle("result-box--correct", r.correct);
      $("#resultBox").classList.toggle("result-box--wrong", !r.correct);
      $("#resultVerdict").textContent = r.correct ? "إجابة صحيحة!" : "إجابة خاطئة";
      $("#resultPoints").textContent = r.correct
        ? `+${ar(r.points)} نقطة لـ ${teamName}`
        : `لا نقاط لـ ${teamName}`;
      $("#resultCorrectAnswer").textContent = q.correctAnswer;
    }

    function showFinal() {
      clearInterval(timerInterval);
      const t1 = state.teams.team1;
      const t2 = state.teams.team2;
      let winnerName, winnerScore, loserName, loserScore;
      if (t1.score > t2.score) {
        winnerName = t1.name; winnerScore = t1.score;
        loserName  = t2.name; loserScore  = t2.score;
      } else if (t2.score > t1.score) {
        winnerName = t2.name; winnerScore = t2.score;
        loserName  = t1.name; loserScore  = t1.score;
      } else {
        $("#finalChampion").textContent = "تعادل!";
        $("#finalScores").textContent = `${t1.name}: ${ar(t1.score)} · ${t2.name}: ${ar(t2.score)}`;
        return;
      }
      $("#finalChampion").textContent = winnerName;
      $("#finalScores").innerHTML = `
        <div class="final-row final-row--winner">
          <span>${escapeHtml(winnerName)}</span>
          <strong>${ar(winnerScore)}</strong>
        </div>
        <div class="final-row">
          <span>${escapeHtml(loserName)}</span>
          <strong>${ar(loserScore)}</strong>
        </div>
      `;
    }

    /* ---- إعادة اللعبة ---- */
    $("#restartBtn")?.addEventListener("click", async () => {
      state.teams.team1.score = 0;
      state.teams.team2.score = 0;
      state.used = [];
      state.currentTurn = "team1";
      state.status = "board";
      state.lastResult = null;
      await Transport.write(code, state);
    });
  }

  /* ============================================================
   * شاشة الحكم (judge.html)
   * ============================================================ */
  function initJudge() {
    let code = "";
    let connected = false;

    // قراءة الرمز من URL أو من localStorage (للرجوع التلقائي)
    const urlCode = new URLSearchParams(location.search).get("code");
    const savedCode = localStorage.getItem("mamahanaa::judge::lastCode");

    if (urlCode) {
      $("#judgeCodeInput").value = urlCode.toUpperCase();
    } else if (savedCode && savedCode.length === 6) {
      $("#judgeCodeInput").value = savedCode;
      // اعرض رسالة "تبي ترجع للعبة الفائتة؟"
      const hint = $("#judgeHint");
      if (hint) {
        hint.innerHTML = `<button type="button" class="restore-btn" id="judgeRestoreBtn">↻ متابعة لعبة <strong>${savedCode}</strong></button>`;
        $("#judgeRestoreBtn")?.addEventListener("click", () => {
          $("#judgeConnectBtn")?.click();
        });
      }
    }

    $("#judgeCodeInput")?.addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });

    $("#judgeConnectBtn")?.addEventListener("click", async () => {
      const c = $("#judgeCodeInput").value.trim().toUpperCase();
      const hint = $("#judgeHint");
      hint.textContent = "";

      if (c.length !== 6) {
        hint.textContent = "الرمز ٦ خانات.";
        hint.classList.add("hint--err");
        return;
      }

      const btn = $("#judgeConnectBtn");
      btn.disabled = true;
      btn.querySelector(".btn__label").textContent = "جارٍ الاتصال…";

      const state = await Transport.read(c);

      btn.disabled = false;
      btn.querySelector(".btn__label").textContent = "اتصال";

      if (!state) {
        hint.textContent = "اللعبة غير موجودة.";
        hint.classList.add("hint--err");
        return;
      }

      code = c;
      state.judgeConnected = true;
      await Transport.write(code, state);
      connected = true;

      // احفظ الرمز للرجوع التلقائي
      localStorage.setItem("mamahanaa::judge::lastCode", code);

      $("#team1NameInput").value = state.teams.team1.name;
      $("#team2NameInput").value = state.teams.team2.name;

      showScreen("setup", "data-jscreen");
      startWatching();
    });

    $("#saveTeamsBtn")?.addEventListener("click", async () => {
      const state = await Transport.read(code);
      if (!state) return;
      const n1 = $("#team1NameInput").value.trim() || CFG.teamNames.team1;
      const n2 = $("#team2NameInput").value.trim() || CFG.teamNames.team2;
      state.teams.team1.name = n1;
      state.teams.team2.name = n2;
      await Transport.write(code, state);
      showScreen("waiting", "data-jscreen");
    });

    function startWatching() {
      Transport.poll(code, (state) => {
        if (!state) return;

        if (state.status === "voting") {
          showScreen("waiting", "data-jscreen");
          const t1Done = (state.team1Votes || []).length >= (CFG.categoriesPerTeam || 3);
          const t2Done = (state.team2Votes || []).length >= (CFG.categoriesPerTeam || 3);
          $("#waitingMsg").textContent = `الفريقان يصوّتان على الفئات… (${t1Done ? '✓' : '⏳'} الفريق ١، ${t2Done ? '✓' : '⏳'} الفريق ٢)`;
        } else if (state.status === "building") {
          showScreen("waiting", "data-jscreen");
          $("#waitingMsg").textContent = "جارٍ تجهيز اللعبة…";
        } else if (state.status === "board" || state.status === "selecting-difficulty") {
          showScreen("waiting", "data-jscreen");
          $("#waitingMsg").textContent = state.status === "board"
            ? `${state.teams[state.currentTurn].name} يختار الفئة…`
            : "الفريق يختار درجة الصعوبة…";
        } else if (state.status === "question" || state.status === "judging") {
          renderJudgeQuestion(state);
          showScreen("judging", "data-jscreen");
        } else if (state.status === "result") {
          showScreen("waiting", "data-jscreen");
          $("#waitingMsg").textContent = "ينتقل للسؤال التالي…";
        } else if (state.status === "final") {
          showScreen("ended", "data-jscreen");
        } else if (state.status === "lobby") {
          showScreen("waiting", "data-jscreen");
          $("#waitingMsg").textContent = "في انتظار بدء اللعبة من الشاشة الرئيسية…";
        }
      }, 300);
    }

    function renderJudgeQuestion(state) {
      const cat = state.gameCategories[state.selectedCategory];
      const q = cat.questions.find(qq => qq.points === state.selectedDifficulty);
      if (!q) return;

      $("#judgeCategoryName").textContent = `${cat.emoji} ${cat.name}`;
      $("#judgePoints").textContent = ar(state.selectedDifficulty);
      $("#judgeTeamTurn").textContent = state.teams[state.currentTurn].name;
      $("#judgeQuestionText").textContent = q.question;
      $("#judgeAnswerText").textContent = q.correctAnswer;
      if (q.hint && q.hint.trim()) {
        $("#judgeHintRow").classList.remove("hidden");
        $("#judgeHintText").textContent = q.hint;
      } else {
        $("#judgeHintRow").classList.add("hidden");
      }
    }

    $("#judgeCorrectBtn")?.addEventListener("click", () => decide(true));
    $("#judgeWrongBtn")?.addEventListener("click", () => decide(false));

    async function decide(isCorrect) {
      const state = await Transport.read(code);
      if (!state || (state.status !== "question" && state.status !== "judging")) return;

      const team = state.currentTurn;
      const ci = state.selectedCategory;
      const points = state.selectedDifficulty;
      if (isCorrect) {
        state.teams[team].score += points;
      }
      state.lastResult = { team, points, correct: isCorrect };
      state.used.push(`${state.selectedCategory}-${state.selectedDifficulty}`);

      // عدّاد الفئات (للعدل التام)
      if (!state.catCounts) state.catCounts = { team1: {}, team2: {} };
      if (!state.catCounts[team]) state.catCounts[team] = {};
      state.catCounts[team][ci] = (state.catCounts[team][ci] || 0) + 1;

      state.status = "result";
      await Transport.write(code, state);

      // بعد ٤ ثواني، يرجع للوحة ويبدّل الدور
      setTimeout(async () => {
        const cur = await Transport.read(code);
        if (!cur) return;
        if (cur.used.length >= cur.gameCategories.length * POINTS_TIERS.length) {
          cur.status = "final";
        } else {
          cur.currentTurn = cur.currentTurn === "team1" ? "team2" : "team1";
          cur.status = "board";
        }
        cur.selectedCategory = -1;
        cur.selectedDifficulty = 0;
        await Transport.write(code, cur);
      }, 4000);
    }
  }

  /* ============================================================
   * شاشة اللاعب (player.html)
   * ============================================================ */
  /* ============================================================
   * شاشة قائد الفريق (team.html)
   * نفس الملف يخدم team1 و team2 — يتحدد بحسب ?team=1 أو ?team=2
   * ============================================================ */
  function initTeamLeader() {
    let code = "";
    let teamKey = ""; // "team1" أو "team2" — يُحدد بالنقر

    const params = new URLSearchParams(location.search);
    const urlCode = params.get("code");

    // تحميل البيانات المحفوظة للرجوع التلقائي
    const savedCode = localStorage.getItem("mamahanaa::team::lastCode");
    const savedTeam = localStorage.getItem("mamahanaa::team::lastTeam");
    const savedName = localStorage.getItem("mamahanaa::team::lastName");

    if (urlCode && $("#teamCodeInput")) {
      $("#teamCodeInput").value = urlCode.toUpperCase();
    } else if (savedCode && savedCode.length === 6 && $("#teamCodeInput")) {
      $("#teamCodeInput").value = savedCode;
      // اعرض رسالة "تبي ترجع للعبة الفائتة؟"
      const hint = $("#teamHint");
      if (hint) {
        const teamLabel = savedTeam === "team1" ? "الفريق ١" : (savedTeam === "team2" ? "الفريق ٢" : "");
        hint.innerHTML = `<button type="button" class="restore-btn" id="teamRestoreBtn">↻ متابعة لعبة <strong>${savedCode}</strong> ${teamLabel ? '— ' + teamLabel : ''}</button>`;
        $("#teamRestoreBtn")?.addEventListener("click", () => {
          // املأ الحقول من الذاكرة
          if (savedTeam) {
            const btn = $(`[data-team="${savedTeam.replace('team','')}"]`);
            if (btn && !btn.disabled) {
              teamKey = savedTeam;
              $$(".team-choice").forEach(b => b.classList.remove("team-choice--selected"));
              btn.classList.add("team-choice--selected");
            }
          }
          if (savedName && $("#teamNameInput")) {
            $("#teamNameInput").value = savedName;
          }
          // اضغط زر الاتصال
          $("#teamConnectBtn")?.click();
        });
      }
    }

    $("#teamCodeInput")?.addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
      checkAvailability(); // كل ما يكتب رمز نتحقق من حالة الفرق
    });

    // تحقق من توفر كل فريق (هل في قائد فعلاً؟)
    let availabilityTimer = null;
    async function checkAvailability() {
      const c = ($("#teamCodeInput").value || "").trim().toUpperCase();
      if (c.length !== 6) {
        $("#team1ChoiceStatus").textContent = "—";
        $("#team2ChoiceStatus").textContent = "—";
        return;
      }
      try {
        const st = await Transport.read(c);
        if (!st) {
          $("#team1ChoiceStatus").textContent = "اللعبة غير موجودة";
          $("#team2ChoiceStatus").textContent = "اللعبة غير موجودة";
          return;
        }
        const t1 = st.teams.team1;
        const t2 = st.teams.team2;
        const team1Btn = $("[data-team='1']");
        const team2Btn = $("[data-team='2']");

        if (t1.connected) {
          $("#team1ChoiceStatus").textContent = (t1.name || "محجوز") + " ✓";
          team1Btn.classList.add("team-choice--taken");
          team1Btn.disabled = true;
          // إذا كان مختار team1 وتم حجزه، نلغي الاختيار
          if (teamKey === "team1") {
            teamKey = "";
            team1Btn.classList.remove("team-choice--selected");
          }
        } else {
          $("#team1ChoiceStatus").textContent = "متاح";
          team1Btn.classList.remove("team-choice--taken");
          team1Btn.disabled = false;
        }

        if (t2.connected) {
          $("#team2ChoiceStatus").textContent = (t2.name || "محجوز") + " ✓";
          team2Btn.classList.add("team-choice--taken");
          team2Btn.disabled = true;
          if (teamKey === "team2") {
            teamKey = "";
            team2Btn.classList.remove("team-choice--selected");
          }
        } else {
          $("#team2ChoiceStatus").textContent = "متاح";
          team2Btn.classList.remove("team-choice--taken");
          team2Btn.disabled = false;
        }
      } catch (e) {
        // تجاهل
      }
    }

    // عند تحميل الصفحة، إذا فيه code في URL، نفحص فوراً
    if (urlCode && urlCode.length === 6) {
      setTimeout(checkAvailability, 100);
    }

    // تحديث دوري كل ٢ ثانية
    availabilityTimer = setInterval(checkAvailability, 2000);

    // أزرار اختيار الفريق
    $$(".team-choice").forEach(btn => {
      btn.addEventListener("click", () => {
        if (btn.disabled) return;
        const teamNum = btn.dataset.team;
        teamKey = "team" + teamNum;
        // أزل التحديد من الكل، ثم حدد المختار
        $$(".team-choice").forEach(b => b.classList.remove("team-choice--selected"));
        btn.classList.add("team-choice--selected");
      });
    });

    $("#teamConnectBtn")?.addEventListener("click", async () => {
      const c = $("#teamCodeInput").value.trim().toUpperCase();
      const teamNameInput = $("#teamNameInput").value.trim();
      const hint = $("#teamHint");
      hint.textContent = "";
      hint.classList.remove("hint--err");

      if (c.length !== 6) {
        hint.textContent = "الرمز ٦ خانات.";
        hint.classList.add("hint--err");
        return;
      }
      if (!teamKey) {
        hint.textContent = "اختر فريقك أولاً (الفريق ١ أو الفريق ٢).";
        hint.classList.add("hint--err");
        return;
      }
      if (teamNameInput.length < 2) {
        hint.textContent = "اكتب اسم الفريق (حرفان على الأقل).";
        hint.classList.add("hint--err");
        return;
      }

      const btn = $("#teamConnectBtn");
      btn.disabled = true;
      btn.querySelector(".btn__label").textContent = "جارٍ الاتصال…";

      const state = await Transport.read(c);

      btn.disabled = false;
      btn.querySelector(".btn__label").textContent = "انضمام";

      if (!state) {
        hint.textContent = "اللعبة غير موجودة.";
        hint.classList.add("hint--err");
        return;
      }
      // تحقق إذا الفريق محجوز (race condition)
      if (state.teams[teamKey].connected) {
        hint.textContent = "هذا الفريق محجوز للتو من شخص آخر. اختر الفريق الآخر.";
        hint.classList.add("hint--err");
        await checkAvailability();
        return;
      }
      // تحقق من تكرار الاسم
      const otherTeam = teamKey === "team1" ? "team2" : "team1";
      if (state.teams[otherTeam].name &&
          state.teams[otherTeam].name.toLowerCase() === teamNameInput.toLowerCase()) {
        hint.textContent = "هذا الاسم مستخدم من الفريق الآخر.";
        hint.classList.add("hint--err");
        return;
      }

      // أوقف فحص التوفر
      if (availabilityTimer) clearInterval(availabilityTimer);

      code = c;
      state.teams[teamKey].name = teamNameInput;
      state.teams[teamKey].connected = true;
      await Transport.write(code, state);

      // احفظ الرمز وبيانات الفريق للرجوع التلقائي
      localStorage.setItem("mamahanaa::team::lastCode", code);
      localStorage.setItem("mamahanaa::team::lastTeam", teamKey);
      localStorage.setItem("mamahanaa::team::lastName", teamNameInput);

      startWatching();
    });

    function startWatching() {
      Transport.poll(code, (state) => {
        if (!state) return;

        if (state.status === "lobby") {
          showScreen("waiting", "data-tscreen");
          $("#teamWaitMsg").textContent = "في انتظار بدء اللعبة من الشاشة الرئيسية…";
        } else if (state.status === "voting") {
          renderVoting(state);
        } else if (state.status === "building") {
          showScreen("waiting", "data-tscreen");
          $("#teamWaitMsg").textContent = "جارٍ تجهيز الأسئلة…";
        } else if (state.status === "board") {
          // إذا دور هذا الفريق، نعرض اختيار الفئة
          if (state.currentTurn === teamKey) {
            renderCategorySelect(state);
          } else {
            showScreen("waiting", "data-tscreen");
            $("#teamWaitMsg").textContent = "دور " + state.teams[state.currentTurn].name + "…";
          }
        } else if (state.status === "selecting-difficulty") {
          if (state.currentTurn === teamKey) {
            renderDifficultySelect(state);
          } else {
            showScreen("waiting", "data-tscreen");
            $("#teamWaitMsg").textContent = "الفريق الآخر يختار درجة الصعوبة…";
          }
        } else if (state.status === "question" || state.status === "judging") {
          showScreen("answering", "data-tscreen");
          $("#teamAnsweringTeam").textContent = state.teams[state.currentTurn].name;
        } else if (state.status === "result") {
          renderResult(state);
        } else if (state.status === "final") {
          showScreen("ended", "data-tscreen");
        }
      }, 800);
    }

    // ==== شاشة التصويت على الفئات ====
    function renderVoting(state) {
      const myVotesKey = teamKey + "Votes";
      const myVotes = state[myVotesKey] || [];
      const required = CFG.categoriesPerTeam || 3;
      const done = myVotes.length >= required;

      if (done) {
        showScreen("waiting", "data-tscreen");
        $("#teamWaitMsg").textContent = "تم اختيارك! في انتظار الفريق الآخر…";
        return;
      }

      $("#teamVotingTitle").textContent = `اختر ${ar(required)} فئات`;
      $("#teamVotingHint").textContent = `اخترت ${ar(myVotes.length)} من ${ar(required)}`;

      const grid = $("#teamVotingGrid");
      grid.innerHTML = CATEGORIES.map((cat, ci) => {
        const isPicked = myVotes.includes(ci);
        return `<button class="picker-tile ${isPicked ? 'picker-tile--voted' : ''}" data-cat="${ci}" ${isPicked ? "disabled" : ""}>
          <span class="picker-tile__emoji">${cat.emoji}</span>
          <span class="picker-tile__name">${escapeHtml(cat.name)}</span>
          ${isPicked ? '<span class="picker-tile__check">✓</span>' : ''}
        </button>`;
      }).join("");

      $$("#teamVotingGrid .picker-tile").forEach(t => {
        t.addEventListener("click", async () => {
          const ci = parseInt(t.dataset.cat);
          const cur = await Transport.read(code);
          if (!cur) return;
          if (!cur[myVotesKey]) cur[myVotesKey] = [];
          if (cur[myVotesKey].includes(ci)) return;
          if (cur[myVotesKey].length >= required) return;
          cur[myVotesKey].push(ci);
          await Transport.write(code, cur);
        });
      });

      showScreen("voting", "data-tscreen");
    }

    // عدل تام: كم سؤال أكمل هذا الفريق من هذي الفئة؟
    const teamCountInCategory = (state, team, ci) => {
      return (state.catCounts && state.catCounts[team] && state.catCounts[team][ci]) || 0;
    };

    function renderCategorySelect(state) {
      const turnTeam = state.teams[state.currentTurn].name;
      $("#teamTurnLabel").textContent = `دورك يا ${turnTeam}`;
      $("#teamStepLabel").textContent = "اختر الفئة";

      const myTeam = teamKey;
      const grid = $("#teamCategoryGrid");
      grid.innerHTML = state.gameCategories.map((cat, ci) => {
        const myCount = teamCountInCategory(state, myTeam, ci);
        const allUsed = cat.questions.every(q => state.used.includes(`${ci}-${q.points}`));
        // حد أقصى ٣ سؤال لكل فريق من كل فئة (للعدل التام: ٣ × ٦ = ١٨)
        const maxedOut = myCount >= 3;
        const disabled = allUsed || maxedOut;
        const remainingTxt = maxedOut ? "٣/٣ ✓" : `${ar(myCount)}/٣`;
        return `<button class="picker-tile ${disabled ? 'picker-tile--used' : ''}" data-cat="${ci}" ${disabled ? "disabled" : ""}>
          <span class="picker-tile__emoji">${cat.emoji}</span>
          <span class="picker-tile__name">${escapeHtml(cat.name)}</span>
          <span class="picker-tile__count">${remainingTxt}</span>
        </button>`;
      }).join("");

      $$(".picker-tile").forEach(t => {
        t.addEventListener("click", async () => {
          const ci = parseInt(t.dataset.cat);
          const cur = await Transport.read(code);
          if (!cur) return;
          cur.selectedCategory = ci;
          cur.status = "selecting-difficulty";
          await Transport.write(code, cur);
        });
      });

      $("#teamTeam1Name").textContent = state.teams.team1.name || "الفريق ١";
      $("#teamTeam2Name").textContent = state.teams.team2.name || "الفريق ٢";
      $("#teamTeam1Score").textContent = ar(state.teams.team1.score);
      $("#teamTeam2Score").textContent = ar(state.teams.team2.score);

      showScreen("picking", "data-tscreen");
    }

    function renderDifficultySelect(state) {
      const cat = state.gameCategories[state.selectedCategory];
      $("#teamStepLabelDiff").textContent = `اختر درجة الصعوبة`;
      $("#teamCatHeader").innerHTML = `<span class="cat-emoji-big">${cat.emoji}</span> ${escapeHtml(cat.name)}`;

      const grid = $("#teamDifficultyGrid");
      grid.innerHTML = POINTS_TIERS.map(p => {
        const used = state.used.includes(`${state.selectedCategory}-${p}`);
        return `<button class="diff-tile diff-tile--p${p} ${used ? 'diff-tile--used' : ''}" data-pts="${p}" ${used ? "disabled" : ""}>
          <span class="diff-tile__num">${used ? "✓" : ar(p)}</span>
          <span class="diff-tile__lbl">${used ? "مستخدم" : "نقطة"}</span>
        </button>`;
      }).join("");

      $$(".diff-tile").forEach(t => {
        t.addEventListener("click", async () => {
          const pts = parseInt(t.dataset.pts);
          const cur = await Transport.read(code);
          if (!cur) return;
          cur.selectedDifficulty = pts;
          cur.status = "question";
          cur.questionStartedAt = Date.now();
          await Transport.write(code, cur);
        });
      });

      $("#teamBackToCat")?.addEventListener("click", async () => {
        const cur = await Transport.read(code);
        if (!cur) return;
        cur.selectedCategory = -1;
        cur.status = "board";
        await Transport.write(code, cur);
      });

      showScreen("difficulty", "data-tscreen");
    }

    function renderResult(state) {
      const r = state.lastResult;
      if (!r) return;
      const teamName = state.teams[r.team].name;
      $("#teamResultIcon").textContent = r.correct ? "✓" : "✗";
      $("#teamResultBox").classList.toggle("result-box--correct", r.correct);
      $("#teamResultBox").classList.toggle("result-box--wrong", !r.correct);
      $("#teamResultVerdict").textContent = r.correct ? "إجابة صحيحة!" : "إجابة خاطئة";
      $("#teamResultPoints").textContent = r.correct
        ? `+${ar(r.points)} نقطة لـ ${teamName}`
        : `لا نقاط لـ ${teamName}`;
      showScreen("result", "data-tscreen");
    }
  }

  /* ---------- escape ---------- */
  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /* ---------- export ---------- */
  window.MamaHanaa = { initHost, initJudge, initTeamLeader };
})();
