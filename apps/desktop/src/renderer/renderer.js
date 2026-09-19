// Plain JS: the renderer is not in the TypeScript build, because it needs no
// build step to do what a spike needs.
const api = window.overlay;

let protection = true;
let clickThrough = false;

const protectionButton = document.getElementById('protection');
const clickThroughButton = document.getElementById('clickthrough');

protectionButton.addEventListener('click', async () => {
  protection = await api.setProtection(!protection);
  protectionButton.textContent = `Protection: ${protection ? 'on' : 'off'}`;
});

clickThroughButton.addEventListener('click', async () => {
  clickThrough = await api.setClickThrough(!clickThrough);
  clickThroughButton.textContent = `Click-through: ${clickThrough ? 'on' : 'off'}`;
  // With click-through on, this window stops receiving clicks — including the
  // one that would turn it back off. Say so rather than letting someone strand
  // themselves.
  if (clickThrough) {
    clickThroughButton.textContent += ' (restart to undo)';
  }
});

api.platform().then((info) => {
  document.getElementById('platform').textContent =
    `${info.platform} · Electron ${info.electron} · Chromium ${info.chrome}`;
});
