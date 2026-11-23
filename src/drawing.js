// 고정 해상도의 캔버스에 그리고 표시 크기만 바꿔 리사이즈 시 그림을 보존합니다.
export function createDrawing(canvas, onChange) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('이 브라우저에서는 그림 도구를 열 수 없어요.');
  const layer = document.createElement('canvas');
  layer.width = canvas.width;
  layer.height = canvas.height;
  const ink = layer.getContext('2d');
  let color = '#42644c', brightness = 100, opacity = 1, size = 12, eraser = false;
  let current = null, base = null, strokes = 0, hasInk = false, enabled = true;
  const history = [];
  const MAX_UNDO = 12;

  function white() {
    context.globalAlpha = 1;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
  function changed() {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    hasInk = false;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i] !== 255 || pixels[i + 1] !== 255 || pixels[i + 2] !== 255) { hasInk = true; break; }
    }
    onChange({ hasDrawing: hasInk, canUndo: history.length > 0 });
  }
  function remember() {
    history.push({ pixels: context.getImageData(0, 0, canvas.width, canvas.height), strokes });
    if (history.length > MAX_UNDO) history.shift();
  }
  function penColor() {
    const rgb = color.match(/\w\w/g).map(value => parseInt(value, 16));
    const factor = brightness / 100;
    return 'rgb(' + rgb.map(value => Math.round(factor <= 1 ? value * factor : value + (255 - value) * (factor - 1))).join(',') + ')';
  }
  function point(event) {
    const bounds = canvas.getBoundingClientRect();
    return { x: Math.max(0, Math.min(canvas.width, (event.clientX - bounds.left) * canvas.width / bounds.width)),
      y: Math.max(0, Math.min(canvas.height, (event.clientY - bounds.top) * canvas.height / bounds.height)) };
  }
  function renderStroke() {
    ink.clearRect(0, 0, layer.width, layer.height);
    ink.strokeStyle = ink.fillStyle = eraser ? '#ffffff' : penColor();
    ink.lineWidth = size;
    ink.lineCap = ink.lineJoin = 'round';
    if (current.points.length === 1) {
      ink.beginPath(); ink.arc(current.points[0].x, current.points[0].y, size / 2, 0, Math.PI * 2); ink.fill();
    } else {
      ink.beginPath(); ink.moveTo(current.points[0].x, current.points[0].y);
      for (const p of current.points.slice(1)) ink.lineTo(p.x, p.y);
      ink.stroke();
    }
    context.putImageData(base, 0, 0);
    // 각 선을 별도 레이어에 그린 후 합성해 한 획의 불투명도를 일정하게 유지합니다.
    context.globalAlpha = eraser ? 1 : opacity;
    context.drawImage(layer, 0, 0);
    context.globalAlpha = 1;
  }
  function endStroke(event) {
    if (!current || (event && event.pointerId !== current.pointerId)) return;
    const pointerId = current.pointerId;
    current = null; base = null; strokes++;
    if (canvas.hasPointerCapture(pointerId)) canvas.releasePointerCapture(pointerId);
    changed();
  }
  canvas.addEventListener('pointerdown', event => {
    if (!enabled || current || (event.pointerType === 'mouse' && event.button !== 0)) return;
    event.preventDefault();
    remember();
    base = history.at(-1).pixels;
    current = { pointerId: event.pointerId, points: [point(event)] };
    canvas.setPointerCapture(event.pointerId);
    renderStroke();
  });
  canvas.addEventListener('pointermove', event => {
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault();
    current.points.push(point(event)); renderStroke();
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, endStroke);
  white(); changed();
  return {
    setEnabled(value) {
      endStroke(); enabled = value;
      canvas.setAttribute('aria-disabled', String(!value));
      canvas.style.cursor = value ? 'crosshair' : 'default';
    },
    configure(options) {
      endStroke();
      ({ color = color, brightness = brightness, opacity = opacity, size = size, eraser = eraser } = options);
      return { color: penColor(), opacity: eraser ? 1 : opacity, size };
    },
    undo() {
      endStroke();
      const previous = history.pop();
      if (previous) { context.putImageData(previous.pixels, 0, 0); strokes = previous.strokes; changed(); }
    },
    clear() { endStroke(); remember(); white(); strokes = 0; changed(); },
    toBlob() {
      endStroke();
      return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('그림 파일을 만들지 못했어요.')), 'image/png'));
    },
    get hasDrawing() { return hasInk; },
  };
}
