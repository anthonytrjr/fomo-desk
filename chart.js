/* Device-pixel-ratio aware canvas chart. No FOMO URLs here. */
(function (global) {
  function prefersReduced() {
    return global.matchMedia && global.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  function draw(canvas, payload) {
    if (!canvas) return;
    const points = (payload && payload.points) || [];
    const marks = (payload && payload.marks) || [];
    const dpr = global.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 390;
    const cssH = canvas.clientHeight || 180;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    if (!points.length) {
      drawEmpty(canvas);
      return;
    }
    const xs = points.map(function (p) { return +p.t; });
    const ys = points.map(function (p) { return +p.v; });
    const minX = Math.min.apply(null, xs);
    const maxX = Math.max.apply(null, xs);
    const minY = Math.min.apply(null, ys);
    const maxY = Math.max.apply(null, ys);
    const pad = 8;
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    function X(t) { return pad + ((t - minX) / spanX) * (cssW - pad * 2); }
    function Y(v) { return cssH - pad - ((v - minY) / spanY) * (cssH - pad * 2); }

    const startY = Y(ys[0]);
    ctx.save();
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(235,235,245,0.3)";
    ctx.beginPath();
    ctx.moveTo(pad, startY);
    ctx.lineTo(cssW - pad, startY);
    ctx.stroke();
    ctx.restore();

    const grad = ctx.createLinearGradient(0, 0, 0, cssH);
    grad.addColorStop(0, "rgba(0,211,90,0.28)");
    grad.addColorStop(1, "rgba(0,211,90,0)");
    ctx.beginPath();
    points.forEach(function (p, i) {
      const x = X(p.t), y = Y(p.v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.lineTo(X(points[points.length - 1].t), cssH);
    ctx.lineTo(X(points[0].t), cssH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    ctx.beginPath();
    points.forEach(function (p, i) {
      const x = X(p.t), y = Y(p.v);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = "#00d35a";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Marks sit above the line; a later mark moves up a row if it would overlap.
    const placed = [];
    marks.forEach(function (m) {
      if (m.t == null) return;
      const x = X(m.t);
      let y = Y(nearest(points, m.t)) - 10;
      placed.forEach(function (p) {
        if (Math.abs(p.x - x) < 60 && Math.abs(p.y - y) < 14) y -= 14;
      });
      placed.push({ x: x, y: y });
      ctx.fillStyle = m.color || "#0a84ff";
      ctx.font = "11px -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(m.label || "", x, y);
    });
  }

  function nearest(points, t) {
    let best = points[0], d = Infinity;
    points.forEach(function (p) {
      const dd = Math.abs(p.t - t);
      if (dd < d) { d = dd; best = p; }
    });
    return best.v;
  }

  function drawEmpty(canvas) {
    if (!canvas) return;
    const dpr = global.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 390;
    const cssH = canvas.clientHeight || 180;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = "rgba(235,235,245,0.3)";
    ctx.font = "13px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Waiting for the first trade", cssW / 2, cssH / 2);
  }

  global.DeskChart = { draw: draw, drawEmpty: drawEmpty, prefersReduced: prefersReduced };
})(window);
