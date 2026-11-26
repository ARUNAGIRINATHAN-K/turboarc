import { installBenchGlobal, mountRacingGame } from './entry';

installBenchGlobal();

const boot = () => {
  const root = document.getElementById('root') || document.body;
  mountRacingGame(root);
};

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
