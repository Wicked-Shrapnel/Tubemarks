const $ = (id) => document.getElementById(id);
const excludedUrl = new URLSearchParams(location.search).get('exclude') || '';
const formatTime = (seconds) => { const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0; const h = Math.floor(value / 3600), m = Math.floor((value % 3600) / 60), s = Math.floor(value % 60); return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`; };
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function key(url) { try { const u = new URL(url); u.hash = ''; ['t','start','time_continue'].forEach((x) => u.searchParams.delete(x)); return u.toString(); } catch { return String(url).split('#')[0]; } }
function link(b) { return `${b.url.split('#')[0]}#video-bookmark=${Math.floor(b.time)}`; }
function progress(b) { return Number.isFinite(b.duration) && b.duration > 0 ? Math.min(100, Math.round((b.time / b.duration) * 100)) : null; }
async function render() {
  const { bookmarks = [] } = await chrome.storage.local.get({ bookmarks: [] });
  const groups = new Map();
  bookmarks.filter((b) => key(b.url) !== key(excludedUrl)).forEach((b) => { const k = key(b.url); if (!groups.has(k)) groups.set(k, { title: b.sourceTitle || b.title, items: [] }); groups.get(k).items.push(b); });
  $('list').innerHTML = groups.size ? [...groups.values()].map((g, i) => `<details class="folder" ${i === 0 ? 'open' : ''}><summary><span class="folder-icon">📁</span><span class="folder-title">${escapeHtml(g.title)}</span><span class="count">${g.items.length}</span></summary><div class="folder-items">${g.items.map((b) => { const p = progress(b); return `<article class="item"><button class="delete" data-id="${b.createdAt}" title="Delete bookmark">×</button><strong>${escapeHtml(b.title)}</strong><small>${formatTime(b.time)}${Number.isFinite(b.duration) && b.duration > 0 ? ` / ${formatTime(b.duration)}${p !== null ? ` · ${p}%` : ''}` : ''}${b.note ? ` · ${escapeHtml(b.note)}` : ''}</small>${p !== null ? `<div class="progress-track"><div class="progress-fill" style="width:${p}%"></div></div>` : ''}<br><a href="${escapeHtml(link(b))}">Play from timestamp</a></article>`; }).join('')}</div></details>`).join('') : '<p class="empty">No other bookmarks yet.</p>';
}
$('back').onclick = () => window.close();
document.addEventListener('click', async (event) => { const button = event.target.closest('.delete'); if (!button) return; const { bookmarks = [] } = await chrome.storage.local.get({ bookmarks: [] }); await chrome.storage.local.set({ bookmarks: bookmarks.filter((b) => String(b.createdAt) !== button.dataset.id) }); await render(); });
render();
