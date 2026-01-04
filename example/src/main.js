import './style.css';

const versionTarget = document.querySelector('[data-version]');
if (versionTarget) {
  const now = new Date();
  versionTarget.textContent = `Hydrated via Vite at ${now.toLocaleTimeString()}`;
}

const toggleButtons = document.querySelectorAll('[data-toggle]');
toggleButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    document.body.classList.toggle('alt-theme');
  });
});
