(function () {
  "use strict";

  var POLL_MS = 8000;
  if (!Promise.allSettled) {
    Promise.allSettled = function (ps) {
      return Promise.all((ps || []).map(function (p) {
        return Promise.resolve(p).then(
          function (v) { return { status: "fulfilled", value: v }; },
          function (e) { return { status: "rejected", reason: e }; }
        );
      }));
    };
  }

  var CACHE = "desk_data_path";
  var TOKEN_CACHE = "desk_token";
  var state = { data: null, trades: [], activity: [], lastOk: 0, startedLabel: "" };
  var sellPct = 100;
  var sellMint = null;
  var tradeFilter = "all";
  var tickTimer = null;

  function $(id) { return document.getElementById(id); }

  function hashParts() {
    var raw = (location.hash || "").replace(/^#/, "");
    var out = {};
    raw.split("&").forEach(function (pair) {
      if (!pair) return;
      var i = pair.indexOf("=");
      if (i < 0) out[decodeURIComponent(pair)] = "";
      else out[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
    });
    return out;
  }

  function dataPath() {
    var fromHash = hashParts().d || "";
    try {
      if (fromHash) localStorage.setItem(CACHE, fromHash);
      return fromHash || localStorage.getItem(CACHE) || "";
    } catch (e) {
      return fromHash || "";
    }
  }

  function token() {
    var fromHash = hashParts().t || "";
    try {
      if (fromHash) localStorage.setItem(TOKEN_CACHE, fromHash);
      return fromHash || localStorage.getItem(TOKEN_CACHE) || "";
    } catch (e) {
      return fromHash || "";
    }
  }

  var skipDirectUntil = 0;

  function candidateUrls(file) {
    var base = (dataPath() || "").replace(/\/+$/, "");
    var flat = String(file || "").replace(/^\/+/, "");
    var urls = [];
    if (!base || !flat) return urls;
    if (!/^https?:\/\//i.test(base)) return urls;
    var direct = base + "/" + flat;
    var mirrors = [];
    try {
      var u = new URL(base);
      if (u.hostname === "gist.githubusercontent.com") {
        var parts = u.pathname.replace(/^\/+/, "").split("/");
        if (parts.length >= 2) {
          var user = parts[0];
          var id = parts[1];
          mirrors.push("https://gistcdn.githack.com/" + user + "/" + id + "/raw/" + flat);
          mirrors.push("https://cdn.statically.io/gist/" + user + "/" + id + "/raw/" + flat);
        }
      }
    } catch (e) {}
    var onPages = false;
    try { onPages = /(?:^|\.)github\.io$/i.test(location.hostname); } catch (e2) {}
    var now = Date.now();
    var useDirectFirst = !onPages && now >= skipDirectUntil;
    if (useDirectFirst) urls.push(direct);
    mirrors.forEach(function (m) { urls.push(m); });
    if (!useDirectFirst) urls.push(direct);
    return urls;
  }

  function safeReason(err, status) {
    if (status) return "Could not load desk data (HTTP " + status + ").";
    var name = (err && err.name) || "";
    if (name === "TypeError") return "Could not reach the desk data host (network or CORS).";
    if (name === "AbortError") return "Desk data request timed out.";
    return "Could not load desk data.";
  }

  function showError(msg) {
    var el = $("error-bar");
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
  }

  function hideError() {
    var el = $("error-bar");
    if (!el) return;
    el.hidden = true;
    el.textContent = "";
  }

  function money(n) {
    if (n == null || n === "") return "—";
    var v = Number(n);
    if (!isFinite(v)) return "—";
    var sign = v < 0 ? "-" : "";
    return sign + "$" + Math.abs(v).toFixed(2);
  }

  function pct(n, signed) {
    if (n == null || n === "") return "—";
    var v = Number(n);
    if (!isFinite(v)) return "—";
    var sign = signed && v > 0 ? "+" : "";
    return sign + v.toFixed(2) + "%";
  }

  function ago(ts, now) {
    if (!ts) return "";
    var sec = Math.max(0, Math.round(((now || Date.now()) / 1000) - Number(ts)));
    if (sec < 5) return "just now";
    if (sec < 60) return sec + "s ago";
    var m = Math.floor(sec / 60);
    if (m < 60) return m + "m ago";
    var h = Math.floor(m / 60);
    if (h < 48) return h + "h ago";
    return Math.floor(h / 24) + "d ago";
  }

  function clock(ts) {
    if (!ts) return "—";
    try {
      return new Date(Number(ts) * 1000).toLocaleTimeString("en-US", {
        timeZone: "America/Los_Angeles",
        hour: "numeric",
        minute: "2-digit"
      });
    } catch (e) {
      return "—";
    }
  }

  function hold(s) {
    if (s == null || s === "") return "";
    var n = Number(s);
    if (!isFinite(n) || n < 0) return "";
    if (n < 60) return Math.round(n) + "s";
    var m = Math.floor(n / 60);
    var r = Math.round(n % 60);
    if (m < 60) return m + "m" + (r ? " " + r + "s" : "");
    return Math.floor(m / 60) + "h " + (m % 60) + "m";
  }

  function pnlClass(n) {
    if (n == null || !isFinite(Number(n))) return "pnl";
    return "pnl " + (Number(n) < 0 ? "down" : "up");
  }

  function isPlanB() {
    var s = state.data || {};
    return (s.plan || "B") === "B";
  }

  function canSellRemote() {
    return !isPlanB() && !!token() && location.protocol !== "file:";
  }

  function closeSheet() {
    var el = $("sheet");
    if (!el) return;
    el.hidden = true;
    el.classList.remove("is-open");
    sellMint = null;
  }

  function openSell(pos) {
    var el = $("sheet");
    if (!el || !pos) return;
    sellMint = pos.mint || pos.id || null;
    sellPct = 100;
    $("sheet-title").textContent = "Sell now";
    $("sheet-coin").textContent = (pos.symbol || pos.name || "Coin") + (pos.size_usd != null ? " · " + money(pos.size_usd) : "");
    var actions = $("sheet-actions");
    var note = $("sheet-note");
    if (canSellRemote()) {
      if (actions) actions.hidden = false;
      if (note) note.hidden = true;
      document.querySelectorAll(".pcts button").forEach(function (b) {
        b.classList.toggle("is-on", b.getAttribute("data-pct") === "100");
      });
    } else {
      if (actions) actions.hidden = true;
      if (note) {
        note.hidden = false;
        note.textContent = "PAPER desk is read-only on this phone. Use Telegram or the desk to sell.";
      }
    }
    el.hidden = false;
    el.classList.add("is-open");
  }

  function bindSheet() {
    var el = $("sheet");
    if (!el) return;
    closeSheet();
    $("cancel-sell").addEventListener("click", function (e) {
      e.preventDefault();
      closeSheet();
    });
    el.querySelectorAll("[data-close-sheet]").forEach(function (n) {
      n.addEventListener("click", function () { closeSheet(); });
    });
    document.querySelectorAll(".pcts button").forEach(function (b) {
      b.addEventListener("click", function () {
        sellPct = Number(b.getAttribute("data-pct")) || 100;
        document.querySelectorAll(".pcts button").forEach(function (x) { x.classList.remove("is-on"); });
        b.classList.add("is-on");
      });
    });
    $("confirm-sell").addEventListener("click", confirmSell);
    var startY = 0;
    var card = el.querySelector(".sheet-card");
    if (!card) return;
    card.addEventListener("touchstart", function (e) {
      startY = e.changedTouches[0].clientY;
    }, { passive: true });
    card.addEventListener("touchend", function (e) {
      var dy = e.changedTouches[0].clientY - startY;
      if (dy > 60) closeSheet();
    }, { passive: true });
  }

  function confirmSell() {
    if (!sellMint || !canSellRemote()) {
      closeSheet();
      return;
    }
    fetch("/api/sell/" + encodeURIComponent(sellMint), {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token() },
      body: JSON.stringify({ pct: sellPct, paper: true })
    }).catch(function () {}).then(function () {
      closeSheet();
      poll();
    });
  }

  function showScreen(name) {
    document.querySelectorAll(".screen").forEach(function (s) {
      s.hidden = s.id !== "screen-" + name;
    });
    document.querySelectorAll(".tabs [data-go]").forEach(function (b) {
      b.classList.toggle("is-on", b.getAttribute("data-go") === name);
    });
  }

  function applyBadge(mode) {
    var el = $("mode-badge");
    var m = String(mode || "PAPER").toUpperCase() === "REAL" ? "REAL" : "PAPER";
    el.textContent = m;
    el.className = "mode-badge " + (m === "REAL" ? "real" : "paper");
    setText("account-mode", m);
  }

  function freshestHeartbeat(bots) {
    var best = 0;
    (bots || []).forEach(function (b) {
      var h = Number(b.heartbeat || 0);
      if (h > best) best = h;
    });
    return best;
  }

  function applyStatus(s) {
    var el = $("bot-status");
    var stopped = (s.trading || "on") === "stopped";
    var hb = freshestHeartbeat(s.bots);
    var age = hb ? ago(hb) : "";
    if (stopped) {
      el.textContent = "Stopped" + (age ? " · last beat " + age : "");
      el.className = "bot-status stopped";
    } else {
      el.textContent = "Trading on" + (age ? " · heartbeat " + age : "");
      el.className = "bot-status";
    }
    setText("account-trading", stopped ? "Stopped" : "Trading on");
    if (s.started_at) {
      state.startedLabel = "Desk scanning since " + clock(s.started_at) + " PT";
    }
  }

  function refreshUpdated() {
    var el = $("updated");
    if (!el) return;
    if (!state.lastOk) {
      el.textContent = dataPath() ? "Loading…" : "Not connected";
      return;
    }
    var sec = Math.max(0, Math.round((Date.now() - state.lastOk) / 1000));
    el.textContent = sec <= 1 ? "Updated just now" : "Updated " + sec + "s ago";
  }

  function setText(id, text) {
    var el = $(id);
    if (el) el.textContent = text;
  }

  function renderPositions(rows) {
    var list = $("pos-list");
    var empty = $("pos-empty");
    list.innerHTML = "";
    rows = rows || [];
    empty.hidden = rows.length > 0;
    if (!rows.length) {
      empty.textContent = "No open positions.";
      return;
    }
    rows.forEach(function (p) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "pos";
      var chg = p.since_entry_pct;
      btn.innerHTML =
        "<div><div class=\"sym\">" + esc(p.symbol || p.name || "Coin") + "</div>" +
        "<div class=\"meta\">" + esc(money(p.size_usd)) + (p.entry_price != null ? " @ " + Number(p.entry_price).toPrecision(4) : "") + "</div></div>" +
        "<div class=\"" + pnlClass(chg) + "\">" + esc(pct(chg, true)) + "</div>";
      btn.addEventListener("click", function () { openSell(p); });
      list.appendChild(btn);
    });
  }

  function tradeHtml(row) {
    var mode = String(row.mode || row.badge || "PAPER").toUpperCase();
    var open = String(row.state || "").toLowerCase() === "open" || !row.sell_ts;
    var pnl = row.pnl;
    var pnlPct = row.pnl_pct;
    var holdStr = hold(row.hold_s);
    var bits = [];
    bits.push(open ? "Open" : "Closed");
    if (row.buy_ts) bits.push("bought " + clock(row.buy_ts));
    if (!open && row.sell_ts) bits.push("sold " + clock(row.sell_ts));
    if (holdStr) bits.push("held " + holdStr);
    if (row.exit_reason) bits.push(String(row.exit_reason));
    var prices = [];
    if (row.buy_price != null) prices.push("in " + Number(row.buy_price).toPrecision(4));
    if (row.sell_price != null) prices.push("out " + Number(row.sell_price).toPrecision(4));
    var pnlLine = "";
    if (!open && (pnl != null || pnlPct != null)) {
      pnlLine = "<div class=\"" + pnlClass(pnl != null ? pnl : pnlPct) + "\">" +
        esc(pnl != null ? money(pnl) : "") +
        (pnlPct != null ? " (" + esc(pct(pnlPct, true)) + ")" : "") +
        "</div>";
    }
    return (
      "<div><div><span class=\"pill " + (open ? "open" : "") + "\">" + esc(mode) + "</span> " +
      "<span class=\"sym\">" + esc(row.symbol || row.name || "Coin") + "</span></div>" +
      "<div class=\"meta\">" + esc(bits.join(" · ")) + (prices.length ? "<br>" + esc(prices.join(" · ")) : "") + "</div></div>" +
      pnlLine
    );
  }

  function filterTrades(rows) {
    return (rows || []).filter(function (r) {
      var mode = String(r.mode || r.badge || "PAPER").toUpperCase();
      var open = String(r.state || "").toLowerCase() === "open" || !r.sell_ts;
      if (tradeFilter === "open") return open;
      if (tradeFilter === "closed") return !open;
      if (tradeFilter === "PAPER" || tradeFilter === "REAL") return mode === tradeFilter;
      return true;
    });
  }

  function renderTrades() {
    var rows = filterTrades(state.trades);
    var home = $("home-trades");
    var homeEmpty = $("home-trades-empty");
    var list = $("trades-list");
    var empty = $("trades-empty");
    var emptyMsg = state.trades.length ? "No trades match this filter." : ("No trades yet." + (state.startedLabel ? " " + state.startedLabel : ""));
    function fill(target, emptyEl, slice) {
      target.innerHTML = "";
      emptyEl.hidden = slice.length > 0;
      emptyEl.textContent = emptyMsg;
      slice.forEach(function (row) {
        var el = document.createElement(row.coin_url ? "a" : "div");
        el.className = "trade";
        if (row.coin_url) {
          el.href = row.coin_url;
          el.target = "_blank";
          el.rel = "noopener";
        }
        el.innerHTML = tradeHtml(row);
        target.appendChild(el);
      });
    }
    fill(home, homeEmpty, (state.trades || []).slice(0, 5));
    fill(list, empty, rows);
  }

  function activityText(row) {
    var kind = String(row.kind || row.type || row.bot || "").toLowerCase();
    var coin = row.symbol || row.mint || "";
    var reason = row.reason || row.detail || row.msg || row.text || "";
    if (row.summary) return row.summary;
    if (kind.indexOf("scan") >= 0) return "Scanning" + (reason ? " · " + reason : "");
    if (kind.indexOf("vet") >= 0 || kind.indexOf("analyst") >= 0 || kind.indexOf("score") >= 0) {
      return "Vetting" + (coin ? " " + coin : "") + (reason ? " · " + reason : "");
    }
    if (kind.indexOf("buy") >= 0 || kind === "bought") return "Bought " + (coin || "coin") + (reason ? " · " + reason : "");
    if (kind.indexOf("sell") >= 0 || kind === "sold" || kind === "closed") return "Sold " + (coin || "coin") + (reason ? " · " + reason : "");
    return (row.bot ? row.bot + " · " : "") + (reason || kind || "Update");
  }

  function renderActivity(rows) {
    var list = $("home-activity");
    var empty = $("home-activity-empty");
    list.innerHTML = "";
    rows = (rows || []).slice(0, 8);
    empty.hidden = rows.length > 0;
    if (!rows.length) {
      empty.textContent = "No activity yet." + (state.startedLabel ? " " + state.startedLabel : "");
      return;
    }
    rows.forEach(function (row) {
      var el = document.createElement("div");
      el.className = "act";
      el.innerHTML = "<div><div>" + esc(activityText(row)) + "</div><div class=\"meta\">" +
        esc((row.bot ? row.bot + " · " : "") + (row.ts ? ago(row.ts) : "")) + "</div></div>";
      list.appendChild(el);
    });
  }

  function renderBots(bots) {
    var list = $("bots-list");
    list.innerHTML = "";
    (bots || []).forEach(function (b) {
      var el = document.createElement("div");
      el.className = "bot";
      var paused = b.paused || b.state === "stopped";
      el.innerHTML = "<div><div class=\"sym\">" + esc(b.name || "bot") + "</div>" +
        "<div class=\"meta\">" + esc((paused ? "paused" : (b.state || "running")) +
        (b.heartbeat ? " · beat " + ago(b.heartbeat) : "") +
        (b.count != null ? " · " + b.count + " today" : "")) + "</div></div>";
      list.appendChild(el);
    });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  function applyState(s) {
    if (!s || typeof s !== "object") return;
    state.data = s;
    state.lastOk = Date.now();
    hideError();
    applyBadge(s.mode);
    applyStatus(s);
    setText("balance", money(s.balance));
    var today = $("today");
    if (today) {
      var v = s.today_pct;
      today.textContent = (v == null ? "Today —" : pct(v, true) + " today");
      today.className = "today" + (v == null ? "" : (Number(v) < 0 ? " down" : " up"));
    }
    setText("account-cash", money(s.balance));
    renderPositions(s.positions || []);
    renderBots(s.bots || []);
    refreshUpdated();
    var prof = $("profile-link");
    // profile comes from account.json separately
  }

  function applyAccount(acc) {
    if (!acc) return;
    var a = $("profile-link");
    if (a && acc.profile_url) {
      a.hidden = false;
      a.href = acc.profile_url;
    }
    var btn = $("invite-btn");
    if (btn && acc.invite_url) {
      btn.onclick = function () {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(acc.invite_url).catch(function () {});
        }
        btn.textContent = "Invite link copied";
        setTimeout(function () { btn.textContent = "Copy invite link"; }, 1600);
      };
    }
  }

  function fetchOne(url) {
    var ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 8000) : null;
    return fetch(url, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) {
      if (!res.ok) {
        var err = new Error("http");
        err.status = res.status;
        throw err;
      }
      return res.json();
    }).finally(function () {
      if (timer) clearTimeout(timer);
    });
  }

  function fetchJson(file) {
    var urls = candidateUrls(file);
    if (!urls.length) return Promise.resolve(null);
    function attempt(i) {
      if (i >= urls.length) return Promise.reject(new Error("empty"));
      return fetchOne(urls[i]).then(function (data) {
        try {
          if (i > 0 && urls[0] && /gist\.githubusercontent\.com/.test(urls[0])) {
            skipDirectUntil = Date.now() + 60000;
          }
        } catch (e) {}
        return data;
      }).catch(function (err) {
        if (i + 1 < urls.length) return attempt(i + 1);
        throw err;
      });
    }
    return attempt(0);
  }

  function saveLastGood() {
    try {
      localStorage.setItem("desk_last_good", JSON.stringify({
        data: state.data,
        trades: state.trades,
        activity: state.activity,
        lastOk: state.lastOk
      }));
    } catch (e) {}
  }

  function restoreLastGood() {
    try {
      var raw = localStorage.getItem("desk_last_good");
      if (!raw) return false;
      var snap = JSON.parse(raw);
      if (!snap || !snap.data) return false;
      applyState(snap.data);
      state.trades = snap.trades || [];
      state.activity = snap.activity || [];
      state.lastOk = snap.lastOk || 0;
      renderTrades();
      renderActivity(state.activity);
      return true;
    } catch (e) {
      return false;
    }
  }

  function poll() {
    if (!dataPath()) {
      showError("This app is missing its desk link. Open it once from the original #d= link, then add it to the Home Screen again.");
      refreshUpdated();
      return;
    }
    return Promise.allSettled([
      fetchJson("state.json"),
      fetchJson("trades.json"),
      fetchJson("activity.json"),
      fetchJson("account.json")
    ]).then(function (parts) {
      var s = parts[0].status === "fulfilled" ? parts[0].value : null;
      var tr = parts[1].status === "fulfilled" ? parts[1].value : null;
      var a = parts[2].status === "fulfilled" ? parts[2].value : null;
      var acc = parts[3].status === "fulfilled" ? parts[3].value : null;
      if (!s) {
        var err = parts[0].reason || new Error("empty");
        if (!state.data && !restoreLastGood()) {
          showError(safeReason(err, err && err.status));
        } else {
          showError("Could not refresh desk data. Showing the last successful load.");
        }
        refreshUpdated();
        return;
      }
      applyState(s);
      if (tr) {
        state.trades = (tr && tr.rows) || tr || [];
        renderTrades();
      }
      if (a) {
        state.activity = (a && a.rows) || a || [];
        renderActivity(state.activity);
      } else if (!state.activity) {
        renderActivity([]);
      }
      if (acc) applyAccount(acc);
      saveLastGood();
    });
  }

  function dropServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.getRegistrations().then(function (regs) {
      regs.forEach(function (r) { r.unregister(); });
    }).catch(function () {});
    if (window.caches) {
      caches.keys().then(function (keys) {
        keys.forEach(function (k) { caches.delete(k); });
      }).catch(function () {});
    }
  }

  document.querySelectorAll("[data-go]").forEach(function (b) {
    b.addEventListener("click", function () { showScreen(b.getAttribute("data-go")); });
  });
  document.querySelectorAll("#trade-filters button").forEach(function (b) {
    b.addEventListener("click", function () {
      tradeFilter = b.getAttribute("data-filter") || "all";
      document.querySelectorAll("#trade-filters button").forEach(function (x) { x.classList.remove("is-on"); });
      b.classList.add("is-on");
      renderTrades();
    });
  });

  bindSheet();
  dropServiceWorker();
  showScreen("home");
  refreshUpdated();
  if (tickTimer) clearInterval(tickTimer);
  tickTimer = setInterval(refreshUpdated, 1000);
  poll();
  setInterval(poll, POLL_MS);
})();
