function findVideo() {
  const videos = [...document.querySelectorAll('video')].filter(v => {
    const box = v.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && !v.disabled;
  });
  if (!videos.length) return null;
  return videos.sort((a, b) => (b.getBoundingClientRect().width * b.getBoundingClientRect().height) - (a.getBoundingClientRect().width * a.getBoundingClientRect().height))[0];
}

function resumeFromHash() {
  const match = location.hash.match(/video-bookmark=(\d+(?:\.\d+)?)/);
  if (!match) return;
  const attempt = () => { const video = findVideo(); if (video) video.currentTime = Number(match[1]); else setTimeout(attempt, 500); };
  attempt();
}
resumeFromHash();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  const video = findVideo();
  if (message.type === 'getVideoState') {
    sendResponse(video ? {found: true, currentTime: video.currentTime, duration: video.duration, title: document.title, url: location.href} : {found: false});
  }
  if (message.type === 'seek') {
    if (video) { video.currentTime = Number(message.time); video.play().catch(() => {}); sendResponse({ok: true}); }
    else sendResponse({ok: false});
  }
  return true;
});
