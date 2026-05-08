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

  // درجات الصعوبة الـ ٥ (٢٠٠ سهل، ١٠٠٠ صعب)
  const POINTS_TIERS = [200, 400, 600, 800, 1000];

  // ابنِ فئات هذه اللعبة من بنك الأسئلة الكامل
  // اختر N فئات عشوائياً، ومن كل فئة اختر ٥ أسئلة وزّعها على درجات الصعوبة
  const buildGameCategories = () => {
    const numCats = (CFG.categoriesPerGame || 6);
    const selected = pickRandom(CATEGORIES, numCats);
    return selected.map(cat => {
      const picked = pickRandom(cat.pool || [], POINTS_TIERS.length);
      // إذا الفئة فيها أقل من العدد المطلوب، نكمّل من البنك (نادر)
      while (picked.length < POINTS_TIERS.length && cat.pool && cat.pool.length > 0) {
        picked.push(cat.pool[Math.floor(Math.random() * cat.pool.length)]);
      }
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
    }
  };

  const N8nTransport = {
    base() { return CFG.backend.n8nBaseUrl.replace(/\/$/, ""); },

    async create(code, state) {
      state.lastUpdate = Date.now();
      const r = await fetch(`${this.base()}/mama-hanaa-create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: { code, state } })
      });
      if (!r.ok) throw new Error("فشل إنشاء اللعبة");
      return state;
    },

    async read(code) {
      try {
        const r = await fetch(`${this.base()}/mama-hanaa-read?code=${encodeURIComponent(code)}`);
        if (!r.ok) return null;
        const data = await r.json();
        return data && data.state ? data.state : null;
      } catch (e) {
        console.error("read error", e);
        return null;
      }
    },

    async write(code, state) {
      state.lastUpdate = Date.now();
      const r = await fetch(`${this.base()}/mama-hanaa-write`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: { code, state } })
      });
      if (!r.ok) throw new Error("فشل تحديث الحالة");
      return state;
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
        team1: { name: CFG.teamNames.team1, score: 0 },
        team2: { name: CFG.teamNames.team2, score: 0 }
      },
      currentTurn: "team1",
      // الفئات المختارة لهذه اللعبة (من بنك الأسئلة الكامل)
      gameCategories: buildGameCategories(),
      used: [],
      selectedCategory: -1,
      selectedDifficulty: 0,
      questionStartedAt: 0,
      lastResult: null,
      judgeConnected: false,
      playerConnected: false,
      lastUpdate: Date.now()
    };
  }

  /* ============================================================
   * الشاشة الرئيسية (host.html)
   * ============================================================ */
  function initHost() {
    const code = randCode();
    let state = newGameState(code);

    // أنشئ اللعبة على الخادم
    Transport.create(code, state).catch(err => {
      console.error("create failed", err);
      alert("فشل الاتصال بالخادم. تأكد من إعدادات n8n.");
    });

    let timerInterval = null;

    /* ---- قاعة الانتظار ---- */
    $("#gameCodeDisplay").textContent = code.split("").join(" ");
    $("#copyJudgeLink")?.addEventListener("click", () => {
      const link = `${location.origin}${location.pathname.replace("host.html","")}judge.html?code=${code}`;
      navigator.clipboard?.writeText(link);
      const btn = $("#copyJudgeLink");
      const original = btn.textContent;
      btn.textContent = "تم النسخ ✓";
      setTimeout(() => (btn.textContent = original), 1500);
    });
    $("#copyPlayerLink")?.addEventListener("click", () => {
      const link = `${location.origin}${location.pathname.replace("host.html","")}player.html?code=${code}`;
      navigator.clipboard?.writeText(link);
      const btn = $("#copyPlayerLink");
      const original = btn.textContent;
      btn.textContent = "تم النسخ ✓";
      setTimeout(() => (btn.textContent = original), 1500);
    });

    let lastSeenStatus = "";
    let lastSeenQuestionStart = 0;

    // متابعة تغيرات الحالة
    Transport.poll(code, (newState) => {
      if (!newState) return;
      state = newState;
      handleStateChange();
    });

    function handleStateChange() {
      // تحديث مؤشرات الاتصال في قاعة الانتظار
      const judgeStatus = $("#judgeStatus");
      const playerStatus = $("#playerStatus");
      if (judgeStatus) judgeStatus.classList.toggle("status-pill--ok", state.judgeConnected);
      if (playerStatus) playerStatus.classList.toggle("status-pill--ok", state.playerConnected);
      if ($("#judgeStatusText")) $("#judgeStatusText").textContent = state.judgeConnected ? "متصل ✓" : "في انتظار الاتصال…";
      if ($("#playerStatusText")) $("#playerStatusText").textContent = state.playerConnected ? "متصل ✓" : "في انتظار الاتصال…";

      const startBtn = $("#startGameBtn");
      if (startBtn) startBtn.disabled = !(state.judgeConnected && state.playerConnected);

      // تحديث الشاشة حسب الحالة
      if (state.status === "lobby") {
        showScreen("lobby");
      } else if (state.status === "board") {
        renderBoard();
        showScreen("board");
      } else if (state.status === "question") {
        renderQuestion();
        showScreen("question");
        // ابدأ العداد فقط لما يصير سؤال جديد
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

    /* ---- بدء اللعبة ---- */
    $("#startGameBtn")?.addEventListener("click", async () => {
      state.status = "board";
      await Transport.write(code, state);
    });

    /* ---- لوحة الفئات ---- */
    function renderBoard() {
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

    // قراءة الرمز من URL
    const urlCode = new URLSearchParams(location.search).get("code");
    if (urlCode) {
      $("#judgeCodeInput").value = urlCode.toUpperCase();
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

        if (state.status === "board" || state.status === "selecting-difficulty") {
          showScreen("waiting", "data-jscreen");
          $("#waitingMsg").textContent = state.status === "board"
            ? `${state.teams[state.currentTurn].name} يختار الفئة…`
            : "اللاعب يختار درجة الصعوبة…";
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
      const points = state.selectedDifficulty;
      if (isCorrect) {
        state.teams[team].score += points;
      }
      state.lastResult = { team, points, correct: isCorrect };
      state.used.push(`${state.selectedCategory}-${state.selectedDifficulty}`);
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
  function initPlayer() {
    let code = "";

    const urlCode = new URLSearchParams(location.search).get("code");
    if (urlCode) {
      $("#playerCodeInput").value = urlCode.toUpperCase();
    }

    $("#playerCodeInput")?.addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });

    $("#playerConnectBtn")?.addEventListener("click", async () => {
      const c = $("#playerCodeInput").value.trim().toUpperCase();
      const hint = $("#playerHint");
      hint.textContent = "";

      if (c.length !== 6) {
        hint.textContent = "الرمز ٦ خانات.";
        hint.classList.add("hint--err");
        return;
      }

      const btn = $("#playerConnectBtn");
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
      state.playerConnected = true;
      await Transport.write(code, state);
      startWatching();
    });

    function startWatching() {
      Transport.poll(code, (state) => {
        if (!state) return;

        if (state.status === "lobby") {
          showScreen("waiting", "data-pscreen");
          $("#playerWaitMsg").textContent = "في انتظار بدء اللعبة…";
        } else if (state.status === "board") {
          renderCategorySelect(state);
        } else if (state.status === "selecting-difficulty") {
          renderDifficultySelect(state);
        } else if (state.status === "question" || state.status === "judging") {
          showScreen("answering", "data-pscreen");
          $("#playerAnsweringTeam").textContent = state.teams[state.currentTurn].name;
        } else if (state.status === "result") {
          renderResult(state);
        } else if (state.status === "final") {
          showScreen("ended", "data-pscreen");
        }
      }, 300);
    }

    function renderCategorySelect(state) {
      const turnTeam = state.teams[state.currentTurn].name;
      $("#playerTurnLabel").textContent = `دور: ${turnTeam}`;
      $("#playerStepLabel").textContent = "اختر الفئة";

      const grid = $("#playerCategoryGrid");
      grid.innerHTML = state.gameCategories.map((cat, ci) => {
        const allUsed = cat.questions.every(q => state.used.includes(`${ci}-${q.points}`));
        return `<button class="picker-tile ${allUsed ? 'picker-tile--used' : ''}" data-cat="${ci}" ${allUsed ? "disabled" : ""}>
          <span class="picker-tile__emoji">${cat.emoji}</span>
          <span class="picker-tile__name">${escapeHtml(cat.name)}</span>
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

      // تحديث النتائج في الأعلى
      $("#playerTeam1Name").textContent = state.teams.team1.name;
      $("#playerTeam2Name").textContent = state.teams.team2.name;
      $("#playerTeam1Score").textContent = ar(state.teams.team1.score);
      $("#playerTeam2Score").textContent = ar(state.teams.team2.score);

      showScreen("picking", "data-pscreen");
    }

    function renderDifficultySelect(state) {
      const cat = state.gameCategories[state.selectedCategory];
      $("#playerStepLabel").textContent = `اختر درجة الصعوبة`;
      $("#playerCatHeader").innerHTML = `<span class="cat-emoji-big">${cat.emoji}</span> ${escapeHtml(cat.name)}`;

      const grid = $("#playerDifficultyGrid");
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

      $("#playerBackToCat")?.addEventListener("click", async () => {
        const cur = await Transport.read(code);
        if (!cur) return;
        cur.selectedCategory = -1;
        cur.status = "board";
        await Transport.write(code, cur);
      });

      showScreen("difficulty", "data-pscreen");
    }

    function renderResult(state) {
      const r = state.lastResult;
      if (!r) return;
      const teamName = state.teams[r.team].name;
      $("#playerResultIcon").textContent = r.correct ? "✓" : "✗";
      $("#playerResultBox").classList.toggle("result-box--correct", r.correct);
      $("#playerResultBox").classList.toggle("result-box--wrong", !r.correct);
      $("#playerResultVerdict").textContent = r.correct ? "إجابة صحيحة!" : "إجابة خاطئة";
      $("#playerResultPoints").textContent = r.correct
        ? `+${ar(r.points)} نقطة لـ ${teamName}`
        : `لا نقاط لـ ${teamName}`;
      showScreen("result", "data-pscreen");
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
  window.MamaHanaa = { initHost, initJudge, initPlayer };
})();
