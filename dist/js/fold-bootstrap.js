function showStartupError() {
  document.body.inert = false;
  document.querySelector('.workspace').inert = true;
  document.querySelector('.header-tools').inert = true;
  document.querySelector('#loading').hidden = true;
  document.querySelector('#startup-error').hidden = false;
}

window.addEventListener('fold-startup-error', showStartupError);
import('./fold.js').catch(showStartupError);
