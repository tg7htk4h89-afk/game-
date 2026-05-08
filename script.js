/* ============================================================
 * سين جيم — محرك اللعبة
 * ------------------------------------------------------------
 * البنية:
 *   - طبقة النقل (LocalTransport) للمزامنة بين المُقدِّم واللاعبين.
 *     الافتراضي: localStorage في نفس المتصفح للاختبار.
 *     استبدلها بـ NetworkTransport يربط n8n / Firebase / Supabase
 *     لتفعيل اللعب على أجهزة متعددة.
 *   - متحكم المُقدِّم يقود حالة اللعبة.
 *   - متحكم اللاعب يستجيب لتغيرات الحالة.
 * ============================================================ */

(function () {
  "use strict";

  const CFG = window.QUIZ_CONFIG;
  const QUESTIONS = window.QUIZ_QUESTIONS;

  /* ---------- أدوات مساعدة ---------- */
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

  // تحويل الأرقام إلى أرقام عربية (هندية)
  const arDigits = ["٠","١","٢","٣","٤","٥","٦","٧","٨","٩"];
  const ar = (n) => String(n).replace(/\d/g, d => arDigits[d]);

  /* ============================================================
   * طبقة النقل
   * ============================================================ */
  const LocalTransport = {
    key(code) { return `quizarena::${code}`; },

    read(code) {
      try { return JSON.parse(localStorage.getItem(this.key(code))) || null; }
      catch { return null; }
    },

    write(code, state) {
      localStorage.setItem(this.key(code), JSON.stringify(state));
    },

    subscribe(code, callback) {
      const handler = (e) => {
        if (e.key === this.key(code)) {
          try { callback(JSON.parse(e.newValue)); } catch (_) {}
        }
      };
      window.addEventListener("storage", handler);
      return () => window.removeEventListener("storage", handler);
    },

    poll(code, callback, intervalMs = 400) {
      let last = JSON.stringify(this.read(code));
      const id = setInterval(() => {
        const cur = JSON.stringify(this.read(code));
        if (cur !== last) {
          last = cur;
          try { callback(JSON.parse(cur)); } catch (_) {}
        }
      }, intervalMs);
      return () => clearInterval(id);
    }
  };

  /* ============================================================
   * شكل حالة اللعبة:
   * { code, status, currentQ, players: {id: {name, score, answers, correct, totalTime}},
   *   currentAnswers: {id: {option, time}}, revealed, questionStartedAt }
   * status: "lobby" | "question" | "reveal" | "leaderboard" | "final"
   * ============================================================ */

  function newGameState(code) {
    return {
      code,
      status: "lobby",
      currentQ: -1,
      players: {},
      currentAnswers: {},
      revealed: false,
      questionStartedAt: 0,
      lastUpdate: Date.now()
    };
  }

  /* ============================================================
   * متحكم المُقدِّم
   * ============================================================ */
  function initHost() {
    const code = randCode();
    let state = newGameState(code);
    LocalTransport.write(code, state);

    let timerInterval = null;

    const save = () => {
      state.lastUpdate = Date.now();
      LocalTransport.write(code, state);
    };

    /* ---- قاعة الانتظار ---- */
    $("#gameCodeDisplay").textContent = code.split("").join(" ");
    $("#copyCodeBtn").addEventListener("click", () => {
      navigator.clipboard?.writeText(code);
      const btn = $("#copyCodeBtn");
      btn.textContent = "تم النسخ ✓";
      setTimeout(() => (btn.textContent = "نسخ الرمز"), 1500);
    });

    LocalTransport.poll(code, (newState) => {
      if (!newState) return;
      const incomingPlayers = newState.players || {};
      const incomingAnswers = newState.currentAnswers || {};
      let changed = false;

      Object.keys(incomingPlayers).forEach(pid => {
        if (!state.players[pid]) {
          state.players[pid] = incomingPlayers[pid];
          changed = true;
        }
      });

      Object.keys(incomingAnswers).forEach(pid => {
        if (!state.currentAnswers[pid] && incomingAnswers[pid]) {
          state.currentAnswers[pid] = incomingAnswers[pid];
          changed = true;
        }
      });

      if (changed) {
        save();
        renderPlayers();
        renderAnswerCount();
        if (
          state.status === "question" &&
          !state.revealed &&
          Object.keys(state.currentAnswers).length === Object.keys(state.players).length &&
          Object.keys(state.players).length > 0
        ) {
          revealAnswer();
        }
      }
    }, 400);

    function renderPlayers() {
      const ids = Object.keys(state.players);
      $("#playerCount").textContent = ar(ids.length);
      const list = $("#playersList");
      if (ids.length === 0) {
        list.innerHTML = '<li class="players-empty">لا يوجد لاعبون بعد — شارك الرمز أعلاه.</li>';
      } else {
        list.innerHTML = ids
          .map((id, i) => {
            const p = state.players[id];
            const initial = (p.name || "؟").charAt(0);
            return `<li class="player-pill" style="--i:${i}">
              <span class="player-pill__avatar">${initial}</span>
              <span class="player-pill__name">${escapeHtml(p.name)}</span>
            </li>`;
          })
          .join("");
      }
      $("#startGameBtn").disabled = ids.length === 0;
      $("#lobbyHint").textContent = ids.length === 0
        ? "في انتظار انضمام اللاعبين…"
        : `${ar(ids.length)} ${ids.length === 1 ? "لاعب انضم" : ids.length === 2 ? "لاعبان انضما" : "لاعبين انضموا"} — جاهز للبدء.`;
    }

    /* ---- بدء اللعبة ---- */
    $("#startGameBtn").addEventListener("click", () => {
      state.currentQ = 0;
      goToQuestion();
    });

    /* ---- مسار السؤال ---- */
    function goToQuestion() {
      state.status = "question";
      state.revealed = false;
      state.currentAnswers = {};
      state.questionStartedAt = Date.now();
      save();

      const q = QUESTIONS[state.currentQ];
      $("#qRoundLabel").textContent = `السؤال ${ar(state.currentQ + 1)} / ${ar(QUESTIONS.length)}`;
      $("#qCategoryBadge").textContent = q.category || "عام";
      $("#qCategory").textContent = q.category || "عام";
      $("#qDifficulty").textContent = q.difficulty || "متوسط";
      $("#questionText").textContent = q.question;

      const img = $("#questionImage");
      if (q.image) {
        img.src = q.image; img.style.display = "block";
      } else {
        img.removeAttribute("src"); img.style.display = "none";
      }

      const grid = $("#optionsGrid");
      const arabicLetters = ["أ", "ب", "ج", "د"];
      grid.innerHTML = q.options.map((opt, i) =>
        `<div class="option-card" data-opt="${escapeHtml(opt)}" style="--i:${i}">
          <span class="option-card__letter">${arabicLetters[i]}</span>
          <span class="option-card__text">${escapeHtml(opt)}</span>
        </div>`
      ).join("");

      $("#totalPlayers").textContent = ar(Object.keys(state.players).length);
      $("#answerCount").textContent = "٠";
      $("#nextQuestionBtn").disabled = true;
      $("#showAnswerBtn").disabled = false;

      showScreen("question");
      startTimer();
    }

    function startTimer() {
      const total = CFG.questionTime;
      let remaining = total;
      const ring = $("#timerRing");
      const circumference = 2 * Math.PI * 54;
      ring.style.strokeDasharray = circumference;
      ring.style.strokeDashoffset = "0";

      $("#timerNum").textContent = ar(remaining);

      clearInterval(timerInterval);
      const tickStart = Date.now();
      timerInterval = setInterval(() => {
        const elapsed = (Date.now() - tickStart) / 1000;
        remaining = Math.max(0, total - elapsed);
        $("#timerNum").textContent = ar(Math.ceil(remaining));
        ring.style.strokeDashoffset = circumference * (1 - remaining / total);
        if (remaining <= 0) {
          clearInterval(timerInterval);
          if (!state.revealed) revealAnswer();
        }
      }, 100);
    }

    function renderAnswerCount() {
      $("#answerCount").textContent = ar(Object.keys(state.currentAnswers).length);
    }

    /* ---- كشف الإجابة ---- */
    $("#showAnswerBtn").addEventListener("click", revealAnswer);

    function revealAnswer() {
      if (state.revealed) return;
      clearInterval(timerInterval);
      state.revealed = true;

      const q = QUESTIONS[state.currentQ];

      $$(".option-card").forEach(card => {
        const opt = card.dataset.opt;
        if (opt === q.correctAnswer) card.classList.add("option-card--correct");
        else card.classList.add("option-card--wrong");
      });

      let correctN = 0, wrongN = 0, totalTime = 0, timedAnswers = 0;
      Object.keys(state.currentAnswers).forEach(pid => {
        const a = state.currentAnswers[pid];
        const player = state.players[pid];
        if (!player) return;
        const elapsedSec = (a.time - state.questionStartedAt) / 1000;
        const remaining = CFG.questionTime - elapsedSec;
        if (a.option === q.correctAnswer) {
          const points = computePoints(remaining);
          player.score = (player.score || 0) + points;
          player.correct = (player.correct || 0) + 1;
          player.lastPoints = points;
          player.lastResult = "correct";
          correctN++;
        } else {
          player.lastPoints = 0;
          player.lastResult = "wrong";
          wrongN++;
        }
        player.totalTime = (player.totalTime || 0) + elapsedSec;
        player.answers = (player.answers || 0) + 1;
        totalTime += elapsedSec;
        timedAnswers++;
      });

      Object.keys(state.players).forEach(pid => {
        if (!state.currentAnswers[pid]) {
          state.players[pid].lastPoints = 0;
          state.players[pid].lastResult = "missed";
        }
      });

      $("#correctCount").textContent = ar(correctN);
      $("#wrongCount").textContent = ar(wrongN);
      $("#avgTime").textContent = timedAnswers > 0
        ? ar((totalTime / timedAnswers).toFixed(1)) + "ث"
        : "—";

      $("#revealAnswerText").textContent = q.correctAnswer;
      $("#revealExplanation").textContent = q.explanation || "";

      $("#nextQuestionBtn").disabled = false;
      $("#showAnswerBtn").disabled = true;

      state.status = "reveal";
      save();

      setTimeout(() => {
        showScreen("reveal");
      }, 1800);
    }

    function computePoints(remainingSec) {
      const s = CFG.scoring;
      if (remainingSec >= s.tier1.minRemaining) return s.tier1.points;
      if (remainingSec >= s.tier2.minRemaining) return s.tier2.points;
      if (remainingSec >= s.tier3.minRemaining) return s.tier3.points;
      if (remainingSec > 0) return s.tier4.points;
      return 0;
    }

    /* ---- المتصدرون ---- */
    $("#showLeaderboardBtn").addEventListener("click", showLeaderboard);

    function showLeaderboard() {
      state.status = "leaderboard";
      save();

      const sorted = Object.entries(state.players)
        .map(([id, p]) => ({ id, ...p, score: p.score || 0 }))
        .sort((a, b) => b.score - a.score);

      $("#lbRoundLabel").textContent = `بعد السؤال ${ar(state.currentQ + 1)}`;

      const top3 = sorted.slice(0, 3);
      const podium = $("#podium");
      podium.innerHTML = "";
      const order = [1, 0, 2];
      order.forEach(idx => {
        if (!top3[idx]) return;
        const p = top3[idx];
        const place = idx + 1;
        podium.innerHTML += `
          <div class="podium__col podium__col--p${place}" style="--i:${idx}">
            <div class="podium__crown">${place === 1 ? "👑" : ""}</div>
            <div class="podium__avatar">${escapeHtml((p.name || "؟").charAt(0))}</div>
            <div class="podium__name">${escapeHtml(p.name)}</div>
            <div class="podium__score">${ar(p.score)}</div>
            <div class="podium__plinth">#${ar(place)}</div>
          </div>
        `;
      });

      const rest = sorted.slice(3);
      $("#restList").innerHTML = rest.map((p, i) => `
        <li class="rest-row" style="--i:${i}">
          <span class="rest-row__rank">#${ar(i + 4)}</span>
          <span class="rest-row__name">${escapeHtml(p.name)}</span>
          <span class="rest-row__score">${ar(p.score)}</span>
        </li>
      `).join("");

      const isLast = state.currentQ >= QUESTIONS.length - 1;
      $("#continueBtn").innerHTML = isLast
        ? `<span class="btn__label">عرض النتائج النهائية ←</span>`
        : `<span class="btn__label">السؤال التالي ←</span>`;

      showScreen("leaderboard");
    }

    /* ---- التالي / النهاية ---- */
    $("#nextQuestionBtn").addEventListener("click", showLeaderboard);

    $("#continueBtn").addEventListener("click", () => {
      if (state.currentQ >= QUESTIONS.length - 1) {
        showFinal();
      } else {
        state.currentQ++;
        goToQuestion();
      }
    });

    function showFinal() {
      state.status = "final";
      save();

      const sorted = Object.entries(state.players)
        .map(([id, p]) => ({ id, ...p, score: p.score || 0 }))
        .sort((a, b) => b.score - a.score);

      const champ = sorted[0];
      if (champ) {
        $("#championName").textContent = champ.name;
        $("#championScore").textContent = ar(champ.score);
      }

      const top3 = sorted.slice(0, 3);
      const podium = $("#finalPodium");
      podium.innerHTML = "";
      [1, 0, 2].forEach(idx => {
        if (!top3[idx]) return;
        const p = top3[idx];
        const place = idx + 1;
        podium.innerHTML += `
          <div class="podium__col podium__col--p${place}" style="--i:${idx}">
            <div class="podium__crown">${place === 1 ? "👑" : place === 2 ? "🥈" : "🥉"}</div>
            <div class="podium__avatar">${escapeHtml((p.name || "؟").charAt(0))}</div>
            <div class="podium__name">${escapeHtml(p.name)}</div>
            <div class="podium__score">${ar(p.score)}</div>
            <div class="podium__plinth">#${ar(place)}</div>
          </div>
        `;
      });

      const rest = sorted.slice(3);
      $("#finalRestList").innerHTML = rest.map((p, i) => `
        <li class="rest-row" style="--i:${i}">
          <span class="rest-row__rank">#${ar(i + 4)}</span>
          <span class="rest-row__name">${escapeHtml(p.name)}</span>
          <span class="rest-row__score">
            ${ar(p.score)}
            <em>${ar(p.correct || 0)} صحيحة</em>
          </span>
        </li>
      `).join("");

      showScreen("final");
    }

    /* ---- إعادة اللعبة ---- */
    $("#restartBtn").addEventListener("click", () => {
      Object.keys(state.players).forEach(pid => {
        state.players[pid].score = 0;
        state.players[pid].correct = 0;
        state.players[pid].answers = 0;
        state.players[pid].totalTime = 0;
      });
      state.currentQ = -1;
      state.status = "lobby";
      state.currentAnswers = {};
      state.revealed = false;
      save();
      showScreen("lobby");
      renderPlayers();
    });
  }

  /* ============================================================
   * متحكم اللاعب
   * ============================================================ */
  function initPlayer() {
    let code = "";
    let playerId = "";
    let playerName = "";
    let lastSeenStatus = "";
    let lastSeenQ = -1;
    let lastSeenRevealed = false;
    let pTimerInterval = null;

    /* ---- الانضمام ---- */
    $("#codeInput").addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });

    $("#joinBtn").addEventListener("click", () => {
      const c = $("#codeInput").value.trim().toUpperCase();
      const n = $("#nameInput").value.trim();
      const hint = $("#joinHint");
      hint.textContent = "";
      hint.className = "pjoin__hint";

      if (c.length !== 6) { hint.textContent = "الرمز يجب أن يكون ٦ خانات."; hint.classList.add("pjoin__hint--err"); return; }
      if (n.length < 2)   { hint.textContent = "اكتب اسماً (حرفان على الأقل).";    hint.classList.add("pjoin__hint--err"); return; }

      const state = LocalTransport.read(c);
      if (!state) { hint.textContent = "اللعبة غير موجودة. تأكد من الرمز."; hint.classList.add("pjoin__hint--err"); return; }
      if (state.status !== "lobby") { hint.textContent = "اللعبة بدأت بالفعل."; hint.classList.add("pjoin__hint--err"); return; }

      const dup = Object.values(state.players || {}).some(p => p.name.toLowerCase() === n.toLowerCase());
      if (dup) { hint.textContent = "الاسم مستخدم بالفعل."; hint.classList.add("pjoin__hint--err"); return; }

      code = c;
      playerName = n;
      playerId = "p_" + Math.random().toString(36).slice(2, 10);
      state.players[playerId] = {
        name: n, score: 0, correct: 0, answers: 0, totalTime: 0
      };
      LocalTransport.write(code, state);

      $("#waitName").textContent = n;
      $("#pHeaderName").textContent = n;
      showPlayer("wait");
      startWatching();
    });

    function showPlayer(name) {
      showScreen(name, "data-pscreen");
    }

    function startWatching() {
      LocalTransport.poll(code, (state) => {
        if (!state) return;
        const me = state.players[playerId];
        if (!me) return;

        $("#pHeaderScore").textContent = ar(me.score || 0);

        if (state.status === "question" && (state.currentQ !== lastSeenQ || lastSeenStatus !== "question")) {
          lastSeenQ = state.currentQ;
          lastSeenRevealed = false;
          renderQuestion(state);
        }

        if (state.status === "reveal" && !lastSeenRevealed) {
          lastSeenRevealed = true;
          showResult(state);
        }

        if (state.status === "final" && lastSeenStatus !== "final") {
          showFinal(state);
        }

        lastSeenStatus = state.status;
      }, 400);
    }

    function renderQuestion(state) {
      clearInterval(pTimerInterval);
      const q = QUESTIONS[state.currentQ];
      $("#pQuestionHint").textContent = `السؤال ${ar(state.currentQ + 1)} · ${q.category || "عام"}`;

      const opts = $("#pOptions");
      const arabicLetters = ["أ", "ب", "ج", "د"];
      const colors = ["a", "b", "c", "d"];
      opts.innerHTML = q.options.map((opt, i) => {
        return `<button class="poption poption--${colors[i]}" data-opt="${escapeHtml(opt)}" style="--i:${i}">
          <span class="poption__letter">${arabicLetters[i]}</span>
          <span class="poption__text">${escapeHtml(opt)}</span>
        </button>`;
      }).join("");

      $$(".poption").forEach(b => {
        b.addEventListener("click", () => submitAnswer(b.dataset.opt));
      });

      const total = CFG.questionTime;
      const bar = $("#pTimerBar");
      const num = $("#pTimerNum");

      pTimerInterval = setInterval(() => {
        const cur = LocalTransport.read(code);
        if (!cur || cur.status !== "question") {
          clearInterval(pTimerInterval); return;
        }
        const elapsed = (Date.now() - cur.questionStartedAt) / 1000;
        const remaining = Math.max(0, total - elapsed);
        num.textContent = ar(Math.ceil(remaining));
        bar.style.transform = `scaleX(${remaining / total})`;
        if (remaining <= 0) clearInterval(pTimerInterval);
      }, 100);

      showPlayer("answer");
    }

    function submitAnswer(option) {
      const state = LocalTransport.read(code);
      if (!state || state.status !== "question") return;
      if (state.currentAnswers[playerId]) return;

      state.currentAnswers[playerId] = { option, time: Date.now() };
      LocalTransport.write(code, state);

      $$(".poption").forEach(b => {
        if (b.dataset.opt === option) b.classList.add("poption--selected");
        b.disabled = true;
      });

      setTimeout(() => showPlayer("submitted"), 350);
    }

    function showResult(state) {
      clearInterval(pTimerInterval);
      const me = state.players[playerId];
      const sorted = Object.entries(state.players)
        .map(([id, p]) => ({ id, score: p.score || 0 }))
        .sort((a, b) => b.score - a.score);
      const myRank = sorted.findIndex(p => p.id === playerId) + 1;

      const box = $("#presultBox");
      box.classList.remove("presult--correct", "presult--wrong", "presult--missed");

      if (me.lastResult === "correct") {
        box.classList.add("presult--correct");
        $("#presultIcon").textContent = "✓";
        $("#presultVerdict").textContent = "إجابة صحيحة!";
      } else if (me.lastResult === "wrong") {
        box.classList.add("presult--wrong");
        $("#presultIcon").textContent = "✗";
        $("#presultVerdict").textContent = "إجابة خاطئة";
      } else {
        box.classList.add("presult--missed");
        $("#presultIcon").textContent = "—";
        $("#presultVerdict").textContent = "لم تُجِب";
      }

      $("#presultPoints").textContent = ar(me.lastPoints || 0);
      $("#presultRank").textContent = "#" + ar(myRank);
      $("#presultTotal").textContent = ar(me.score || 0);

      showPlayer("result");
    }

    function showFinal(state) {
      const me = state.players[playerId];
      const sorted = Object.entries(state.players)
        .map(([id, p]) => ({ id, score: p.score || 0 }))
        .sort((a, b) => b.score - a.score);
      const myRank = sorted.findIndex(p => p.id === playerId) + 1;

      $("#pfinalRank").textContent = "#" + ar(myRank);
      $("#pfinalName").textContent = me.name;
      $("#pfinalScore").textContent = ar(me.score || 0);
      $("#pfinalCorrect").textContent = ar(me.correct || 0);
      showPlayer("final");
    }
  }

  /* ---------- أدوات ---------- */
  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /* ---------- تصدير ---------- */
  window.QuizArena = { initHost, initPlayer };
})();
