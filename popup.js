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
async function settings() {
  const saved = await chrome.storage.local.get({ openCurrentTab: null, separateWindow: false });
  return { openCurrentTab: saved.openCurrentTab === null ? !saved.separateWindow : saved.openCurrentTab };
}
function creatorInfo() {
  const nameElement = document.querySelector('ytd-channel-name #text, ytd-channel-name a, #owner #channel-name a, #owner ytd-channel-name, [itemprop="author"] [itemprop="name"], meta[name="author"], meta[itemprop="author"]');
  const name = nameElement?.content || nameElement?.textContent?.trim() || '';
  const image = document.querySelector('ytd-channel-avatar img, #owner img, [itemprop="author"] img')?.src || '';
  return { name, image };
}
async function openTimestamp(url) {
  const { openCurrentTab } = await settings();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (openCurrentTab && tab?.id) await chrome.tabs.update(tab.id, { url });
  else await chrome.windows.create({ url, type: 'popup', width: 760, height: 700, focused: true });
}

function videoKey(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes('youtube.com') && parsed.searchParams.get('v')) return `youtube:${parsed.searchParams.get('v')}`;
    if (parsed.hostname === 'youtu.be') return `youtube:${parsed.pathname.slice(1)}`;
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
    if (!folders.has(key)) folders.set(key, { title: `${bookmark.creatorName ? `${bookmark.creatorName} · ` : ''}${bookmark.sourceTitle || bookmark.title}`, image: bookmark.creatorImage || '', items: [] });
    folders.get(key).items.push({ bookmark, index });
  });

  $('list').innerHTML = bookmarks.length ? [...folders.values()].map((folder, folderIndex) => `
    <details class="folder" ${folderIndex === 0 ? 'open' : ''}>
      <summary>
        ${folder.image ? `<img class="folder-avatar" src="${escapeHtml(folder.image)}" alt="">` : '<span class="folder-icon">📁</span>'}
        <span class="folder-title" title="${escapeHtml(folder.title)}">${escapeHtml(folder.title)}</span>
        <span class="count">${folder.items.length}</span>
      </summary>
      <div class="folder-items">
        ${folder.items.map(({ bookmark, index }) => `
          <article class="item">
            <button class="delete" data-index="${index}" title="Delete bookmark">×</button>
            <strong>${escapeHtml(bookmark.title)}</strong>
            <small>${formatTime(bookmark.time)}${bookmark.note ? ` · ${escapeHtml(bookmark.note)}` : ''}</small><br>
      <a class="timestamp-link" href="${escapeHtml(bookmarkUrl(bookmark))}">Play from timestamp</a>
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
  const readCreatorForVideo = (video) => {
    const card = video.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-playlist-video-renderer, ytd-grid-video-renderer, ytd-rich-grid-media') || video.parentElement?.closest('ytd-rich-item-renderer, ytd-video-renderer, ytd-playlist-video-renderer');
    const watchPage = location.pathname === '/watch' && new URL(location.href).searchParams.has('v');
    const scope = card || (watchPage ? document : video.closest('ytd-player, #player, ytd-popup-container') || video.parentElement);
    const nameSelectors = [
      '#channel-name yt-formatted-string', '#channel-name a', '#channel-name', 'ytd-channel-name yt-formatted-string#text',
      'ytd-channel-name #text', 'ytd-channel-name', '[itemprop="author"] [itemprop="name"]', '[aria-label*="by "]', 'meta[name="author"]', 'meta[itemprop="author"]'
    ];
    let name = '';
    for (const selector of nameSelectors) {
      const element = scope.querySelector(selector);
      const value = element?.content || element?.textContent?.trim();
      if (value && value.length < 120) { name = value.replace(/^by\s+/i, '').trim(); break; }
    }
    const avatar = scope.querySelector('#avatar img, ytd-channel-avatar img, yt-img-shadow img, [itemprop="author"] img');
    const image = avatar?.currentSrc || avatar?.src || avatar?.getAttribute('data-src') || avatar?.getAttribute('data-thumb') || '';
    const titleElement = scope.querySelector('#video-title, a#video-title, h3 a');
    const title = titleElement?.textContent?.trim() || document.title;
    const link = scope?.querySelector('a[href*="watch?v="], a[href*="youtu.be/"]')?.href || '';
    let videoId = '';
    try {
      const pageUrl = new URL(location.href);
      const linkedUrl = new URL(link || location.href, location.href);
      videoId = pageUrl.searchParams.get('v') || linkedUrl.searchParams.get('v') || (linkedUrl.hostname === 'youtu.be' ? linkedUrl.pathname.slice(1) : '');
    } catch {}
    return { name, image, title, videoId, sourceUrl: videoId ? `https://www.youtube.com/watch?v=${videoId}` : location.href };
  };
  const readChannelName = () => {
    const selectors = [
      'ytd-video-owner-renderer #channel-name yt-formatted-string',
      'ytd-video-owner-renderer #channel-name a',
      'ytd-video-owner-renderer ytd-channel-name',
      'ytd-channel-name yt-formatted-string#text',
      'ytd-channel-name #text',
      '#owner-name a',
      '[itemprop="author"] [itemprop="name"]',
      'meta[name="author"]',
      'meta[itemprop="author"]'
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      const value = element?.content || element?.textContent?.trim();
      if (value && value.length < 120) return value;
    }
    return '';
  };
  const candidates = [...document.querySelectorAll('video')].map((video) => {
    const box = video.getBoundingClientRect();
    return {
      currentTime: Number(video.currentTime) || 0,
      duration: Number(video.duration),
      area: Math.max(0, box.width) * Math.max(0, box.height),
      playing: !video.paused && !video.ended,
      ...readCreatorForVideo(video)
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
    const videos = results.map((entry) => entry.result).filter(Boolean).sort((a, b) => Number(b.playing) - Number(a.playing) || b.area - a.area);
    if (!videos.length) {
      setDetection('error', 'No compatible video detected. Start the video, then reopen this popup.');
      return;
    }

    const video = videos[0];
    state = { title: video.title || tab.title, url: video.sourceUrl || tab.url, time: video.currentTime, duration: video.duration, creatorName: video.name, creatorImage: video.image };
    $('title').value = state.title || '';
    if (state.creatorName || state.creatorImage) {
      $('creator').hidden = false;
      $('creator').innerHTML = `${state.creatorImage ? `<img src="${escapeHtml(state.creatorImage)}" alt="">` : ''}<span>${escapeHtml(state.creatorName || 'Channel')}</span>`;
    }
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
    const alreadySaved = bookmarks.some((bookmark) => videoKey(bookmark.url) === videoKey(state.url) && Math.abs(Number(bookmark.time) - Number(state.time)) < 2);
    if (alreadySaved) {
      setDetection('ready', 'This timestamp is already saved below.');
      await renderCurrentBookmarks();
      return;
    }
    bookmarks.unshift({
      title: $('title').value.trim() || state.title || 'Video bookmark',
      sourceTitle: state.title || 'Video',
      creatorName: state.creatorName || '',
      creatorImage: state.creatorImage || '',
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
  chrome.windows.create({ url: chrome.runtime.getURL('bookmarks.html'), type: 'popup', width: 760, height: 700, focused: true });
});

$('settingsToggle').addEventListener('click', async () => {
  const panel = $('settingsPanel');
  panel.hidden = !panel.hidden;
  if (!panel.hidden) $('separateWindow').checked = (await settings()).openCurrentTab;
});
$('separateWindow').addEventListener('change', () => chrome.storage.local.set({ openCurrentTab: $('separateWindow').checked }));
document.addEventListener('click', (event) => { const link = event.target.closest('.timestamp-link'); if (link) { event.preventDefault(); openTimestamp(link.href); } });

$('otherBookmarks').addEventListener('click', async () => {
  const exclude = state?.url || '';
  await chrome.tabs.create({ url: chrome.runtime.getURL(`bookmarks.html?exclude=${encodeURIComponent(exclude)}`) });
});

renderBookmarks();
detectVideo();
