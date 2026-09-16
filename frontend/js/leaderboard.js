import { api } from './api.js';

const MEDALS = ['gold', 'silver', 'bronze'];

function renderRow(entry, index) {
  const medalClass = MEDALS[index];
  const rankCell = medalClass
    ? `<span class="medal ${medalClass}">${index + 1}</span>`
    : `${index + 1}`;
  return `
    <tr>
      <td>${rankCell}</td>
      <td><b>${escapeHtml(entry.name)}</b></td>
      <td class="num">${entry.score}</td>
      <td class="num">${entry.deathsCaused ?? '—'}</td>
    </tr>
  `;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

export async function renderLeaderboard(container) {
  container.innerHTML = '<p class="empty-state">Carregando…</p>';
  try {
    const entries = await api.getLeaderboard();
    if (!entries.length) {
      container.innerHTML = '<p class="empty-state">Ninguém desarmou uma bomba ainda.</p>';
      return;
    }
    container.innerHTML = `
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>#</th><th>Jogador</th><th class="num">Pontos</th><th class="num">Mortes</th></tr>
          </thead>
          <tbody>${entries.map(renderRow).join('')}</tbody>
        </table>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Não foi possível carregar o placar (${escapeHtml(err.message)}).</p>`;
  }
}
