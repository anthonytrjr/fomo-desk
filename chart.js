/* Charts are drawn by hand on <canvas>. No chart library. */
(function (global) {
  function drawEmpty(canvas) {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#2c2c2e";
    ctx.beginPath();
    ctx.moveTo(16, h / 2);
    ctx.lineTo(w - 16, h / 2);
    ctx.stroke();
    ctx.fillStyle = "#8e8e93";
    ctx.font = "14px -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("No points yet", w / 2, h / 2 - 12);
  }

  function draw(canvas, points) {
    if (!canvas) return;
    if (!points || points.length < 2) {
      drawEmpty(canvas);
      return;
    }
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const pad = 16;
    let min = points[0], max = points[0];
    for (const p of points) {
      if (p < min) min = p;
      if (p > max) max = p;
    }
    if (min === max) { min -= 1; max += 1; }
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "#111";
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    ctx.strokeStyle = "#00d35a";
    ctx.lineWidth = 2;
    points.forEach((p, i) => {
      const x = pad + (i / (points.length - 1)) * (w - pad * 2);
      const y = pad + (1 - (p - min) / (max - min)) * (h - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  global.DeskChart = { draw, drawEmpty };
})(window);
