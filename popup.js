const $ = (id) => document.getElementById(id);
let state = null;

function formatTime(seconds) {
  const value = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const hours = Math.floor(value / 3600);
  const minutes = Math.floor((value % 3600) / 60);
  const remainingSeconds = Math.floor(value % 60);
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  return `${minutes}:${String(remainingSeconds).padStart(2, '0')}`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function bookmarkUrl(bookmark) {
  return `${bookmark.url.split('#')[0]}#video-bookmark=${Math.floor(bookmark.time)}`;
}

function videoKey(url) {
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    ['t', 'start', 'time_continue'].forEach((name) => parsed.searchParams.delete(name));
    return parsed.toString();
  } catch {
    return String(url).split('#')[0];
  }
}

function progressPercent(bookmark) {
  return Number.isFinite(bookmark.duration) && bookmark.duration > 0 ? Math.min(100, Math.round((bookmark.time / bookmark.duration) * 100)) : null;
}

async function renderCurrentBookmarks() {
  const container = $('currentBookmarks');
  const slot = $('otherButtonSlot');
  if (!state) { container.innerHTML = ''; return; }
  const bookmarks = (await getBookmarks()).filter((bookmark) => videoKey(bookmark.url) === videoKey(state.url));
  if (!bookmarks.length) { container.innerHTML = ''; slot.hidden = false; return; }
  container.innerHTML = `<div class="current-heading">Bookmarks on this video</div>${bookmarks.map((bookmark) => { const percent = progressPercent(bookmark); return `<article class="current-bookmark"><strong>${escapeHtml(bookmark.title)}</strong><small>${formatTime(bookmark.time)}${Number.isFinite(bookmark.duration) && bookmark.duration > 0 ? ` / ${formatTime(bookmark.duration)}${percent !== null ? ` · ${percent}%` : ''}` : ''}</small>${percent !== null ? `<div class="progress-track"><div class="progress-fill" style="width:${percent}%"></div></div>` : ''}<br><a href="${escapeHtml(bookmarkUrl(bookmark))}" target="_blank">Play from timestamp</a></article>`; }).join('')}`;
  slot.hidden = true;
}

function setDetection(kind, message) {
  $('capture').className = `capture ${kind}`;
  $('status').textContent = message;
  $('save').disabled = kind !== 'ready';
}

async function getBookmarks() {
  const result = await chrome.storage.local.get({ bookmarks: [] });
  return Array.isArray(result.bookmarks) ? result.bookmarks : [];
}

async function renderBookmarks() {
  const bookmarks = await getBookmarks();
  const folders = new Map();
  bookmarks.forEach((bookmark, index) => {
    const key = videoKey(bookmark.url);
    if (!folders.has(key)) folders.set(key, { title: bookmark.sourceTitle || bookmark.title, items: [] });
    folders.get(key).items.push({ bookmark, index });
  });

  $('list').innerHTML = bookmarks.length ? [...folders.values()].map((folder, folderIndex) => `
    <details class="folder" ${folderIndex === 0 ? 'open' : ''}>
      <summary>
        <span class="folder-icon">📁</span>
        <span class="folder-title" title="${escapeHtml(folder.title)}">${escapeHtml(folder.title)}</span>
        <span class="count">${folder.items.length}</span>
      </summary>
      <div class="folder-items">
        ${folder.items.map(({ bookmark, index }) => `
          <article class="item">
            <button class="delete" data-index="${index}" title="Delete bookmark">×</button>
            <strong>${escapeHtml(bookmark.title)}</strong>
            <small>${formatTime(bookmark.time)}${bookmark.note ? ` · ${escapeHtml(bookmark.note)}` : ''}</small><br>
            <a href="${escapeHtml(bookmarkUrl(bookmark))}" target="_blank">Play from timestamp</a>
          </article>`).join('')}
      </div>
    </details>`).join('') : '<p class="empty">No video folders yet.</p>';

  document.querySelectorAll('.delete').forEach((button) => {
    button.addEventListener('click', async () => {
      const current = await getBookmarks();
      current.splice(Number(button.dataset.index), 1);
      await chrome.storage.local.set({ bookmarks: current });
      await renderBookmarks();
    });
  });
}

function inspectFrame() {
  const candidates = [...document.querySelectorAll('video')].map((video) => {
    const box = video.getBoundingClientRect();
    return {
      currentTime: Number(video.currentTime) || 0,
      duration: Number(video.duration),
      area: Math.max(0, box.width) * Math.max(0, box.height)
    };
  });
  candidates.sort((a, b) => b.area - a.area);
  return candidates[0] || null;
}

async function detectVideo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id || !/^https?:/i.test(tab.url || '')) {
      setDetection('error', 'This page cannot be checked. Open a normal webpage with a video.');
      return;
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      func: inspectFrame
    });
    const videos = results.map((entry) => entry.result).filter(Boolean).sort((a, b) => b.area - a.area);
    if (!videos.length) {
      setDetection('error', 'No compatible video detected. Start the video, then reopen this popup.');
      return;
    }

    const video = videos[0];
    state = { title: tab.title, url: tab.url, time: video.currentTime, duration: video.duration };
    $('title').value = tab.title || '';
    const durationText = Number.isFinite(video.duration) && video.duration > 0 ? ` / ${formatTime(video.duration)}` : '';
    setDetection('ready', `Video detected — ready to save at ${formatTime(video.currentTime)}${durationText}.`);
    await renderCurrentBookmarks();
  } catch (error) {
    setDetection('error', 'Brave blocked access to this page. Refresh it after reloading the extension.');
  }
}

$('save').addEventListener('click', async () => {
  if (!state) {
    $('status').textContent = 'No video position is ready to save yet.';
    return;
  }

  try {
    const bookmarks = await getBookmarks();
    bookmarks.unshift({
      title: $('title').value.trim() || state.title || 'Video bookmark',
      sourceTitle: state.title || 'Video',
      url: state.url,
      time: state.time,
      duration: state.duration,
      note: $('note').value.trim(),
      createdAt: Date.now()
    });
    await chrome.storage.local.set({ bookmarks });
    $('note').value = '';
    setDetection('ready', `Bookmark saved at ${formatTime(state.time)}.`);
    await renderBookmarks();
    await renderCurrentBookmarks();
  } catch (error) {
    $('status').textContent = 'The bookmark could not be saved. Reload the extension and try again.';
  }
});

$('bookmarksToggle').addEventListener('click', () => {
  const library = $('library');
  const isHidden = library.hidden;
  library.hidden = !isHidden;
  $('bookmarksToggle').setAttribute('aria-expanded', String(isHidden));
  $('bookmarksToggle').textContent = isHidden ? 'Hide bookmarks' : 'Bookmarks';
});

$('otherBookmarks').addEventListener('click', async () => {
  const exclude = state?.url || '';
  await chrome.tabs.create({ url: chrome.runtime.getURL(`bookmarks.html?exclude=${encodeURIComponent(exclude)}`) });
});

renderBookmarks();
detectVideo();
