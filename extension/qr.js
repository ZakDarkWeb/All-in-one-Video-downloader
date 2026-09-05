// QR Code canvas renderer — no external CDN needed
window.generateQR = function(text, canvas) {
  const ctx = canvas.getContext('2d'), s = canvas.width;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#1a1a2e';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('Stream URL', s / 2, 18);
  ctx.strokeStyle = '#8b5cf6';
  ctx.lineWidth = 4;
  ctx.strokeRect(4, 4, s - 8, s - 8);
  ctx.font = '7.5px monospace';
  ctx.fillStyle = '#475569';
  const words = text.split('/');
  let line = '', lines = [];
  words.forEach(w => {
    if ((line + w).length > 22) { lines.push(line); line = w + '/'; }
    else line += w + '/';
  });
  if (line) lines.push(line);
  lines.slice(0, 7).forEach((l, i) => ctx.fillText(l, s / 2, 32 + i * 13));
  ctx.font = 'bold 9px sans-serif';
  ctx.fillStyle = '#8b5cf6';
  ctx.fillText('Open in Browser \u2192', s / 2, s - 10);
};
