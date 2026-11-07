document.querySelectorAll('[data-reveal]').forEach((button) => {
  const input = document.getElementById(button.dataset.reveal);
  if (!(input instanceof HTMLInputElement)) return;

  button.hidden = false;
  button.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.textContent = reveal ? button.dataset.hide : button.dataset.show;
    button.setAttribute('aria-label', reveal ? button.dataset.hideLabel : button.dataset.showLabel);
    button.setAttribute('aria-pressed', String(reveal));
  });
});

document.querySelectorAll('[data-login-form]').forEach((form) => {
  const button = form.querySelector('button[type="submit"]');
  const label = button?.querySelector('span');
  if (!button || !label) return;

  const originalLabel = label.textContent;
  form.addEventListener('submit', () => {
    button.disabled = true;
    label.textContent = button.dataset.submitting;
  });

  window.addEventListener('pageshow', () => {
    button.disabled = false;
    label.textContent = originalLabel;
  });
});
