import '@fontsource/lilita-one/400.css';
import '@fontsource/nunito/600.css';
import '@fontsource/nunito/800.css';
import './styles.css';
import { App } from './ui/app';

const root = document.getElementById('app')!;
try {
  new App(root);
} catch (err) {
  // Most likely no WebGL (very old GPU or outdated drivers): explain instead of a blank window.
  console.error(err);
  root.innerHTML = `<main class="screen panel fatal">
    <h2>Dominó Boricua</h2>
    <p>No se pudo iniciar los gráficos 3D. Actualiza los drivers de tu tarjeta de video.</p>
    <p>Could not start 3D graphics. Please update your graphics drivers.</p>
    <pre>${String((err as Error).message ?? err).replace(/</g, '&lt;')}</pre></main>`;
}
