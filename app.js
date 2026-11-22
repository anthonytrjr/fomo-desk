/* Plan B shell: open once as {URL}#d=..., keep it in localStorage, poll every 15s.
   Never log the path or leave it in the document URL after the first load. */
(function () {
  const hint = document.getElementById("hint");
  const cash = document.getElementById("cash");
  const today = document.getElementById("today");
  const modeEl = document.getElementById("mode");
  const activity = document.getElementById("activity");
  const positions = document.getElementById("positions");
  const screen = document.getElementById("screen");

  const hash = location.hash.startsWith("#") ? location.hash.slice(1) : "";
  const parts = {};
  hash.split("&").forEach(function (pair) {
    const i = pair.indexOf("=");
    if (i > 0) parts[decodeURIComponent(pair.slice(0, i))] = decodeURIComponent(pair.slice(i + 1));
  });
  if (parts.t) {
    try { localStorage.setItem("desk_app_token", parts.t); } catch (e) {}
  }
  if (parts.d) {
    try { localStorage.setItem("desk_data_path", parts.d); } catch (e) {}
  }
  if (parts.t || parts.d) {
    history.replaceState(null, "", location.pathname + location.search);
  }

  function dataPath() {
    try { return localStorage.getItem("desk_data_path") || ""; } catch (e) { return ""; }
  }

  function dataUrl(file) {
    const d = dataPath();
    if (!d) return null;
    // Relative to this app: .../fomo-desk/d/.../file
    return "d/" + encodeURIComponent(d) + "/" + file;
  }

  function setText(el, value) {
    if (el) el.textContent = value;
  }

  function applyState(s) {
    if (!s || typeof s !== "object") return;
    if (s.mode) setText(modeEl, s.mode);
    if (s.balance != null) setText(cash, typeof s.balance === "number" ? ("$" + s.balance.toFixed(2)) : String(s.balance));
    if (s.today != null) setText(today, "today " + s.today);
    if (Array.isArray(s.bots)) {
      s.bots.forEach(function (bot) {
        var card = document.querySelector('.bot[data-bot="' + bot.name + '"] .state');
        if (card && bot.state) card.textContent = bot.state;
      });
    }
    if (Array.isArray(s.positions)) {
      if (!s.positions.length) setText(positions, "No open positions.");
      else setText(positions, s.positions.length + " open");
    }
    if (Array.isArray(s.activity) && activity) {
      activity.innerHTML = "";
      if (!s.activity.length) {
        var li = document.createElement("li");
        li.className = "empty";
        li.textContent = "No activity yet.";
        activity.appendChild(li);
      } else {
        s.activity.slice(0, 30).forEach(function (row) {
          var li = document.createElement("li");
          li.textContent = (row.title || row.kind || "") + (row.subtitle ? " · " + row.subtitle : "");
          activity.appendChild(li);
        });
      }
    }
  }

  function poll() {
    var stateUrl = dataUrl("state.json");
    if (!stateUrl) return;
    fetch(stateUrl, { cache: "no-store" }).then(function (r) {
      if (!r.ok) return null;
      return r.json();
    }).then(function (s) {
      if (s) applyState(s);
    }).catch(function () {});

    var chartUrl = dataUrl("chart.json");
    if (chartUrl && window.DeskChart) {
      fetch(chartUrl, { cache: "no-store" }).then(function (r) {
        if (!r.ok) return null;
        return r.json();
      }).then(function (c) {
        var points = c && (c.points || c);
        if (Array.isArray(points) && points.length) {
          window.DeskChart.draw(document.getElementById("chart"), points);
        }
      }).catch(function () {});
    }

    var screenUrl = dataUrl("screen.jpg");
    if (screenUrl && screen) {
      var img = screen.querySelector("img");
      if (!img) {
        img = document.createElement("img");
        img.alt = "Live screen";
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "cover";
        img.style.borderRadius = "10px";
        screen.textContent = "";
        screen.appendChild(img);
      }
      img.onerror = function () { /* keep last frame or placeholder */ };
      img.src = screenUrl + "?t=" + Date.now();
    }
  }

  if (window.DeskChart) {
    window.DeskChart.drawEmpty(document.getElementById("chart"));
  }

  if (dataPath()) {
    poll();
    setInterval(poll, 15000);
    if (hint) hint.textContent = "Safari → Share → Add to Home Screen. Polling the desk every 15s.";
  } else if (hint) {
    hint.textContent = "Open this app once with #d= in the URL, or add it to your Home Screen after that. Safari → Share → Add to Home Screen.";
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(function () {});
  }
})();
