/* Plan B shell: open once as {URL}#d={DATA_PATH} (and optional #t=). Keep the
   #d= and #t= fragment in the address bar so Add to Home Screen (Safari or
   Chrome on iOS 16.4+) saves the full link. The fragment is never sent to a
   server. Also persist to localStorage as a fallback. Never log the values.
   FOMO links come from the JSON the process writes (links.py); this file never
   builds those URLs. */
(function () {
  const POLL_MS = 15000;
  const $ = function (id) { return document.getElementById(id); };
  const state = {
    data: null,
    activity: null,
    chart: null,
    settings: null,
    screen: "home",
    range: "LIVE",
    lastOk: 0,
    retryIn: 15,
    sellMint: null,
    sellPct: 100,
    prevBalance: null,
  };

  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const parts = {};
  hash.split("&").forEach(function (pair) {
    const i = pair.indexOf("=");
    if (i > 0) parts[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
  });
  try {
    if (parts.t) localStorage.setItem("desk_app_token", parts.t);
    if (parts.d) localStorage.setItem("desk_data_path", parts.d);
  } catch (e) {}
  // Keep the fragment in the address bar. Do not history.replaceState it away.

  function dataPath() {
    try { return localStorage.getItem("desk_data_path") || ""; } catch (e) { return ""; }
  }
  function appToken() {
    try { return localStorage.getItem("desk_app_token") || ""; } catch (e) { return ""; }
  }
  function withCacheBust(url) {
    try {
      const u = new URL(url, location.href);
      u.searchParams.set("_t", String(Date.now()));
      return u.toString();
    } catch (e) {
      return url;
    }
  }

  function flattenGistName(file) {
    if (file === "screen.jpg") return "screen.json";
    if (file.indexOf("coin/") === 0 && /\.json$/.test(file)) return "coin-" + file.slice(5);
    return file;
  }

  function gistIdFrom(d) {
    if (!d) return "";
    const m = String(d).match(/^[0-9a-f]{32}$/i);
    if (m) return m[0];
    try {
      const u = new URL(d);
      // raw base .../githubusercontent.com/{user}/{id}/raw
      // or api.github.com/gists/{id}
      const parts = u.pathname.split("/").filter(Boolean);
      if (u.hostname === "api.github.com" && parts[0] === "gists" && parts[1]) return parts[1];
      if (u.hostname === "gist.githubusercontent.com" && parts.length >= 2) return parts[1];
      if (u.hostname === "gist.github.com" && parts.length >= 1) return parts[parts.length - 1];
    } catch (e) {}
    return "";
  }

  let gistFileUrls = null;

  function refreshGistMap() {
    const d = dataPath();
    const id = gistIdFrom(d);
    if (!id) {
      gistFileUrls = null;
      return Promise.resolve(false);
    }
    return fetch("https://api.github.com/gists/" + encodeURIComponent(id), {
      cache: "no-store",
      headers: { "Accept": "application/vnd.github+json" }
    }).then(function (r) {
      if (!r.ok) throw new Error("gist http " + r.status);
      return r.json();
    }).then(function (data) {
      const map = {};
      const files = (data && data.files) || {};
      Object.keys(files).forEach(function (name) {
        if (files[name] && files[name].raw_url) map[name] = files[name].raw_url;
      });
      gistFileUrls = map;
      return true;
    });
  }

  function dataUrl(file) {
    const d = dataPath();
    if (!d) return null;
    const flat = flattenGistName(file);
    if (gistFileUrls && gistFileUrls[flat]) return withCacheBust(gistFileUrls[flat]);
    if (/^https?:\/\//i.test(d)) {
      const base = d.replace(/\/$/, "");
      return withCacheBust(base + "/" + flat);
    }
    if (gistIdFrom(d)) return null; // waiting for the map
    return "d/" + encodeURIComponent(d) + "/" + file;
  }

  function showScreen(name) {
    state.screen = name;
    document.querySelectorAll("main.screen").forEach(function (el) {
      const on = el.dataset.screen === name;
      el.hidden = !on;
      el.classList.toggle("is-active", on);
    });
    document.querySelectorAll(".tabbar .tab").forEach(function (el) {
      el.classList.toggle("is-on", el.dataset.tab === name);
    });
  }

  function money(n) {
    if (n == null || isNaN(n)) return "—";
    const sign = n < 0 ? "-" : "";
    return sign + "$" + Math.abs(n).toFixed(2);
  }
  function pct(n, plus) {
    if (n == null || isNaN(n)) return "—";
    const body = (plus && n > 0 ? "+" : "") + n.toFixed(2) + "%";
    return body;
  }

  function setText(el, v) { if (el) el.textContent = v; }

  function applyPaperBadge(mode) {
    const show = (mode || "PAPER") === "PAPER";
    ["paper-badge", "coin-paper"].forEach(function (id) {
      const el = $(id);
      if (el) el.hidden = !show;
    });
  }

  function botColor(name) {
    return ({ scanner: "#64d2ff", analyst: "#ffd60a", brain: "#bf5af2", executor: "#00d35a", risk: "#ff6b9a" })[name] || "#fff";
  }

  function renderBotsCarousel(bots) {
    const root = $("bot-carousel");
    if (!root) return;
    root.innerHTML = "";
    (bots || []).forEach(function (b) {
      const el = document.createElement("article");
      el.className = "bot-card";
      el.innerHTML = '<div class="name"></div><div class="detail"></div>';
      el.querySelector(".name").style.color = botColor(b.name);
      el.querySelector(".name").textContent = (b.name || "").replace(/^./, function (c) { return c.toUpperCase(); });
      el.querySelector(".detail").textContent = (b.state || "idle") + " · " + (b.count || 0);
      root.appendChild(el);
    });
    const running = (bots || []).filter(function (b) { return b.state === "running" && !b.paused; }).length;
    setText($("bots-running"), running + " running");
  }

  function renderBotsFull(bots) {
    const root = $("bots-full");
    if (!root) return;
    root.innerHTML = "";
    (bots || []).forEach(function (b) {
      const wrap = document.createElement("section");
      wrap.className = "bot-full";
      const locked = b.name === "risk" && (state.data && (state.data.positions || []).length);
      wrap.innerHTML =
        '<div class="top"><span class="status-dot"></span><strong></strong>' +
        '<span class="count tabular"></span><input type="checkbox" class="switch"></div>' +
        '<div class="decisions"></div>';
      wrap.querySelector("strong").textContent = (b.name || "").replace(/^./, function (c) { return c.toUpperCase(); });
      wrap.querySelector("strong").style.color = botColor(b.name);
      wrap.querySelector(".count").textContent = (b.count || 0) + " today";
      const dot = wrap.querySelector(".status-dot");
      dot.classList.toggle("paused", !!b.paused);
      dot.classList.toggle("idle", b.state === "idle" && !b.paused);
      const sw = wrap.querySelector(".switch");
      sw.checked = !b.paused;
      sw.disabled = !!locked;
      sw.addEventListener("change", function () {
        /* Plan B: pause goes through Telegram. Reflect locally only if /api is reachable. */
        postApi("/api/bots/" + b.name + "/" + (sw.checked ? "resume" : "pause")).catch(function () {
          sw.checked = !sw.checked;
        });
      });
      root.appendChild(wrap);
    });
  }

  function activityRow(row, compact) {
    const li = document.createElement("li");
    const main = document.createElement("div");
    main.className = "row-main";
    const title = document.createElement("div");
    title.className = "row-title";
    title.textContent = row.title || row.kind || "";
    const sub = document.createElement("div");
    sub.className = "row-sub";
    sub.textContent = row.subtitle || row.bot || "";
    main.appendChild(title);
    main.appendChild(sub);
    const right = document.createElement("div");
    right.className = "row-right tabular";
    right.textContent = row.value || "";
    li.appendChild(main);
    li.appendChild(right);
    li.addEventListener("click", function () {
      if ((row.kind || "") === "rejected") openAudit(row.mint);
      else if (row.mint) openCoin(row.mint, row.link);
    });
    if (!compact && row.link) {
      const open = document.createElement("a");
      open.className = "text-link";
      open.textContent = "Open on FOMO";
      open.href = row.link;
      open.target = "_blank";
      open.rel = "noopener";
      open.addEventListener("click", function (e) { e.stopPropagation(); });
      li.appendChild(open);
    }
    return li;
  }

  function renderActivity(rows, into, emptyEl, limit) {
    const list = $(into);
    if (!list) return;
    list.innerHTML = "";
    const slice = (rows || []).slice(0, limit || rows.length);
    if (!slice.length) {
      if (emptyEl) { $(emptyEl).hidden = false; $(emptyEl).textContent = "Nothing yet tonight"; }
      if (into === "home-activity") {
        const li = document.createElement("li");
        li.className = "empty";
        li.textContent = "Waiting for the first trade";
        list.appendChild(li);
      }
      return;
    }
    if (emptyEl) $(emptyEl).hidden = true;
    slice.forEach(function (row) { list.appendChild(activityRow(row, into === "home-activity")); });
  }

  function applyState(s) {
    if (!s || typeof s !== "object") return;
    state.data = s;
    state.lastOk = Date.now();
    hideError();
    applyPaperBadge(s.mode);
    const bal = s.balance;
    setText($("balance"), money(bal));
    const today = s.today_pct;
    const todayEl = $("today");
    if (todayEl) {
      todayEl.textContent = pct(today, true) + " today";
      todayEl.style.color = today == null ? "" : (today < 0 ? "var(--red)" : "var(--green)");
    }
    const m = $("multiplier");
    if (m) {
      if (s.multiplier != null) {
        m.hidden = false;
        m.textContent = Number(s.multiplier).toFixed(2) + "×";
      } else m.hidden = true;
    }
    setText($("account-cash"), money(s.balance));
    renderBotsCarousel(s.bots);
    renderBotsFull(s.bots);
    const last = s.last_order;
    if (last) {
      const checks = last.checks || {};
      const bits = ["screen", "api", "chain"].map(function (k) {
        const v = checks[k];
        if (v === "n/a") return "chain n/a";
        return (v ? "✓ " : "· ") + k;
      }).join(" · ");
      setText($("live-last"), (last.reason || last.side || "Order") + " · " + bits);
    } else {
      setText($("live-last"), "No order yet");
    }
    const owner = $("live-owner");
    if (owner) owner.textContent = "Idle";
    document.querySelectorAll("#mode-seg button").forEach(function (btn) {
      btn.classList.toggle("is-on", btn.dataset.mode === (s.mode || "PAPER"));
    });
  }

  function applyActivity(a) {
    const rows = (a && a.rows) || a || [];
    state.activity = rows;
    renderActivity(rows, "home-activity", null, 5);
    renderActivity(rows, "activity-list", "activity-empty");
  }

  function applyChart(c) {
    state.chart = c;
    if (window.DeskChart) window.DeskChart.draw($("chart"), c || { points: [], marks: [] });
  }

  function applyAccount(acc) {
    if (!acc) return;
    const a = $("profile-link");
    if (a && acc.profile_url) {
      a.hidden = false;
      a.href = acc.profile_url;
      a.target = "_blank";
      a.rel = "noopener";
    }
    const btn = $("invite-btn");
    if (btn && acc.invite_url) {
      btn.onclick = function () {
        const url = acc.invite_url;
        if (navigator.share) {
          navigator.share({ title: "FOMO", url: url }).catch(function () { copy(url); });
        } else copy(url);
      };
    }
    setText($("push-state"), acc.plan_b_note || acc.pushes || "Plan B: Telegram only");
  }

  function copy(text) {
    function ok() {
      const el = $("invite-copied");
      if (el) { el.hidden = false; setTimeout(function () { el.hidden = true; }, 1600); }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok).catch(ok);
    } else ok();
  }

  function showError() {
    const el = $("error-bar");
    if (!el) return;
    el.hidden = false;
    const last = state.lastOk ? new Date(state.lastOk).toLocaleTimeString() : "never";
    el.textContent = "Desk offline · retrying in " + state.retryIn + "s · last update " + last;
  }
  function hideError() {
    const el = $("error-bar");
    if (el) el.hidden = true;
  }

  function fetchJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    });
  }

  function postApi(path, body) {
    const t = appToken();
    if (!t) return Promise.reject(new Error("no api"));
    return fetch(path, {
      method: "POST",
      cache: "no-store",
      headers: { "Authorization": "Bearer " + t, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : "{}",
    }).then(function (r) {
      if (!r.ok) throw new Error("http " + r.status);
      return r.json();
    });
  }


  function renderSettings(payload) {
    const root = $("settings-groups");
    if (!root || !payload || !payload.settings) return;
    state.settings = payload;
    const groups = { scanner: "Scanner", analyst: "Analyst", social: "Social", brain: "Brain", executor: "Executor", risk: "Risk", desk: "Desk", copy_picks: "Copy picks" };
    const by = {};
    Object.keys(payload.settings).forEach(function (key) {
      const g = key.split(".")[0];
      (by[g] = by[g] || []).push(key);
    });
    root.innerHTML = "";
    Object.keys(groups).forEach(function (g) {
      const keys = by[g];
      if (!keys) return;
      const h = document.createElement("h2");
      h.textContent = groups[g];
      h.style.margin = "8px 0";
      root.appendChild(h);
      keys.forEach(function (key) {
        const val = payload.settings[key];
        const range = (payload.ranges || {})[key];
        const row = document.createElement("div");
        row.className = "setting";
        const lab = document.createElement("label");
        lab.textContent = key;
        row.appendChild(lab);
        if (range && typeof val === "number") {
          const meta = document.createElement("div");
          meta.className = "meta";
          meta.textContent = range.min + " – " + range.max;
          row.appendChild(meta);
          const sl = document.createElement("input");
          sl.type = "range"; sl.min = range.min; sl.max = range.max; sl.step = "any"; sl.value = val;
          const num = document.createElement("input");
          num.type = "number"; num.min = range.min; num.max = range.max; num.value = val;
          function send(v) {
            postApi("/api/settings", { [key]: v }).catch(function () {});
          }
          sl.addEventListener("change", function () { num.value = sl.value; send(+sl.value); });
          num.addEventListener("change", function () { sl.value = num.value; send(+num.value); });
          row.appendChild(sl); row.appendChild(num);
        } else {
          const num = document.createElement("input");
          num.type = typeof val === "number" ? "number" : "text";
          num.value = val == null ? "" : String(val);
          num.addEventListener("change", function () { postApi("/api/settings", { [key]: num.value }).catch(function () {}); });
          row.appendChild(num);
        }
        root.appendChild(row);
      });
    });
  }

  function poll() {
    pollReady();
  }

  function pollReady() {
    const stateUrl = dataUrl("state.json");
    if (!stateUrl) {
      showError();
      return;
    }
    fetchJson(stateUrl).then(function (s) {
      applyState(s);
    }).catch(function () { showError(); });

    const actUrl = dataUrl("activity.json");
    if (actUrl) fetchJson(actUrl).then(applyActivity).catch(function () {});

    const chartUrl = dataUrl("chart.json");
    if (chartUrl) fetchJson(chartUrl).then(applyChart).catch(function () {});

    /* account/settings are optional extras when the process writes them */
    const accUrl = dataUrl("account.json");
    if (accUrl) fetchJson(accUrl).then(applyAccount).catch(function () {});
    const setUrl = dataUrl("settings.json");
    if (setUrl) fetchJson(setUrl).then(renderSettings).catch(function () {});

    const img = $("live-img");
    const ph = $("live-placeholder");
    const screenUrl = dataUrl("screen.jpg");
    if (screenUrl && img) {
      const applyBlob = function (blob) {
        const src = URL.createObjectURL(blob);
        const next = new Image();
        next.onload = function () {
          if (img.dataset.blob) {
            try { URL.revokeObjectURL(img.dataset.blob); } catch (e) {}
          }
          img.dataset.blob = src;
          img.src = src;
          img.hidden = false;
          if (ph) ph.hidden = true;
          const age = $("live-age");
          if (age) age.innerHTML = '<span class="led red"></span> Live · Bot\'s computer';
        };
        next.onerror = function () { try { URL.revokeObjectURL(src); } catch (e) {} };
        next.src = src;
      };
      // Plan B gist: screen.json {mime,b64}. Local /d/: screen.jpg also works.
      fetch(screenUrl, { cache: "no-store" }).then(function (r) {
        if (!r.ok) throw new Error("no screen");
        const ct = (r.headers.get("content-type") || "").toLowerCase();
        if (ct.indexOf("json") !== -1 || /screen\.json(\?|$)/.test(screenUrl)) {
          return r.json().then(function (doc) {
            if (!doc || !doc.b64) throw new Error("no b64");
            const bin = atob(doc.b64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            applyBlob(new Blob([arr], { type: doc.mime || "image/jpeg" }));
          });
        }
        return r.blob().then(applyBlob);
      }).catch(function () { /* keep last frame */ });
    }
  }

  function openCoin(mint, link) {
    showScreen("coin");
    const body = $("coin-body");
    body.innerHTML = '<div class="skel" style="height:120px;margin:16px"></div>';
    const url = dataUrl("coin/" + encodeURIComponent(mint) + ".json");
    const render = function (c) {
      const coin = (c && c.coin) || {};
      const pos = (c && c.position) || {};
      setText($("coin-title"), coin.symbol || coin.name || "Coin");
      const href = (c && c.link) || link || pos.link;
      body.innerHTML = "";
      const price = document.createElement("div");
      price.className = "coin-price tabular";
      price.textContent = c && c.price != null ? String(c.price) : "—";
      body.appendChild(price);
      const meta = document.createElement("p");
      meta.className = "empty";
      meta.style.textAlign = "left";
      meta.textContent = (coin.symbol || "") + (pos.since_entry_pct != null ? "  " + pct(pos.since_entry_pct, true) + " since entry" : "");
      body.appendChild(meta);
      const actions = document.createElement("div");
      actions.className = "coin-actions";
      if (href) {
        const a = document.createElement("a");
        a.className = "secondary";
        a.style.textAlign = "center";
        a.style.lineHeight = "50px";
        a.style.textDecoration = "none";
        a.textContent = "Open on FOMO";
        a.href = href;
        a.target = "_blank";
        a.rel = "noopener";
        actions.appendChild(a);
      }
      const sell = document.createElement("button");
      sell.type = "button";
      sell.className = "primary danger";
      sell.textContent = "Sell now";
      sell.addEventListener("click", function () { openSell(mint); });
      actions.appendChild(sell);
      body.appendChild(actions);
    };
    if (url) fetchJson(url).then(render).catch(function () { render({ mint: mint, link: link }); });
    else render({ mint: mint, link: link });
  }

  function openAudit(mint) {
    showScreen("audit");
    const body = $("audit-body");
    body.textContent = "No audit yet.";
  }

  function openSell(mint) {
    state.sellMint = mint;
    state.sellPct = 100;
    $("sheet").hidden = false;
  }

  function confirmSell() {
    const mint = state.sellMint;
    $("sheet").hidden = true;
    postApi("/api/sell/" + encodeURIComponent(mint), { pct: state.sellPct, confirm: true })
      .catch(function () {
        /* Plan B: sell also goes through Telegram when /api is not on this host. */
      });
  }

  document.querySelectorAll(".tabbar .tab").forEach(function (btn) {
    btn.addEventListener("click", function () { showScreen(btn.dataset.tab); });
  });
  document.querySelectorAll("[data-back]").forEach(function (btn) {
    btn.addEventListener("click", function () { showScreen("home"); });
  });
  $("home-avatar") && $("home-avatar").addEventListener("click", function () { showScreen("account"); });
  $("activity-see-all") && $("activity-see-all").addEventListener("click", function () { showScreen("activity"); });
  $("ranges") && $("ranges").addEventListener("click", function (e) {
    const btn = e.target.closest("button[data-range]");
    if (!btn) return;
    state.range = btn.dataset.range;
    $("ranges").querySelectorAll("button").forEach(function (b) { b.classList.toggle("is-on", b === btn); });
    applyChart(state.chart);
  });
  $("sheet-cancel") && $("sheet-cancel").addEventListener("click", function () { $("sheet").hidden = true; });
  $("confirm-sell") && $("confirm-sell").addEventListener("click", confirmSell);
  $("sell-pcts") && $("sell-pcts").addEventListener("click", function (e) {
    const btn = e.target.closest("button[data-pct]");
    if (!btn) return;
    state.sellPct = +btn.dataset.pct;
    $("sell-pcts").querySelectorAll("button").forEach(function (b) { b.classList.toggle("is-on", b === btn); });
  });
  $("home-search") && $("home-search").addEventListener("click", function () {
    $("search-overlay").hidden = false;
    $("search-input").focus();
  });
  $("search-close") && $("search-close").addEventListener("click", function () {
    $("search-overlay").hidden = true;
  });

  if (window.DeskChart) window.DeskChart.drawEmpty($("chart"));
  if (dataPath()) {
    poll();
    setInterval(poll, POLL_MS);
  } else {
    showError();
    const el = $("error-bar");
    if (el) { el.hidden = false; el.textContent = "Open this app once with #d= in the URL, then add it to the Home Screen."; }
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();
