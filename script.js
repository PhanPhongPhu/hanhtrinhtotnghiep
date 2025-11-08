// ùuuu giỏi vậy tarrr, biết vào trong này luôn. Xem thôi đừng phá đấy nhá =))
// 🌍 DỮ LIỆU & CẤU HÌNH
let EVENTS = [], FRIENDS = [];
const map = L.map('map', { zoomControl: true }).setView([15.5, 107], 5);
L.tileLayer('https://mt1.google.com/vt/lyrs=r&x={x}&y={y}&z={z}', { maxZoom: 12 }).addTo(map);

const pathGlow = L.polyline([], { color: '#2ecc71', opacity: 0.25, weight: 10 }).addTo(map);
const pathLine = L.polyline([], { color: '#2ecc71', opacity: 0.95, weight: 4 }).addTo(map);
const markers = [];
const friendsLayer = L.layerGroup().addTo(map);
// per-friend markers (created on demand, kept visible once shown)
const friendMarkers = [];

let current = -1;
let timelineWasVisible = true;
let inFriendsMode = false; // Kiểm soát chế độ bạn bè
// currently opened friend marker (so we can close it when moving to next)
let currentFriendMarker = null;
// token to cancel/ignore stale friend sequence steps
let friendSequenceToken = 0;

// 🔘 Lấy phần tử giao diện
const audio = document.getElementById('bgm');
const muteBtn = document.getElementById('muteBtn');
const startBtn = document.getElementById('startBtn');
const nextBtn = document.getElementById('nextBtn');
const prevBtn = document.getElementById('prevBtn');
const closeStoryBtn = document.getElementById('closeStoryBtn');
const showFriendsBtn = document.getElementById('showFriendsBtn');
const inviteCloseBtn = document.getElementById('inviteCloseBtn');
const autoPlayBtn = document.getElementById('autoPlayBtn');
const progressBar = document.getElementById('progressBar');
const toggleTimelineBtn = document.getElementById('toggleTimelineBtn');

function renderAutoBtn(running){
  autoPlayBtn.innerHTML = running
    ? `<svg viewBox="0 0 24 24" class="icon"><path d="M8 6h3v12H8zM13 6h3v12h-3z" fill="currentColor"/></svg><span class="label">Auto</span>`
    : `<svg viewBox="0 0 24 24" class="icon"><path d="M8 5v14l11-7z" fill="currentColor"/></svg><span class="label">Auto</span>`;
  autoPlayBtn.classList.toggle('active', !!running);
}

const overlays = {
  intro: document.getElementById('intro'),
  story: document.getElementById('storyOverlay'),
  invite: document.getElementById('inviteOverlay')
};
// Khoảng cách an toàn giữa controls và timeline/map
const CONTROLS_GAP_WHEN_TIMELINE = 12;   // px
const CONTROLS_GAP_NO_TIMELINE   = 30;   // px

function updateControlsPosition() {
  const controls = document.getElementById('controls');
  const timeline = document.getElementById('timeline');
  const isVisible = timeline && timeline.style.display !== 'none' && timeline.classList.contains('show');

  // nếu timeline hiện -> đẩy controls lên bằng đúng chiều cao timeline + gap
  if (isVisible) {
    const h = timeline.offsetHeight || 0;
    controls.style.bottom = `${h + CONTROLS_GAP_WHEN_TIMELINE}px`;
    controls.classList.remove('controls-lower');
  } else {
    // nếu timeline ẩn -> hạ controls xuống gần mép dưới
    controls.style.bottom = `${CONTROLS_GAP_NO_TIMELINE}px`;
    controls.classList.add('controls-lower');
  }
}

// debounce resize to avoid layout thrash
let __resizeTimeout = null;
window.addEventListener('resize', () => {
  if (__resizeTimeout) clearTimeout(__resizeTimeout);
  __resizeTimeout = setTimeout(() => updateControlsPosition(), 120);
});

// ========================
// 🎵 ÂM THANH
// ========================
let isMuted = false;
muteBtn.onclick = () => {
  isMuted = !isMuted;
  audio.muted = isMuted;
  muteBtn.textContent = isMuted ? '🔈' : '🔊';
};

// fallback nhạc nếu lỗi
audio.onerror = () => {
  if (!audio.dataset.fallback) {
    audio.dataset.fallback = '1';
    audio.innerHTML = `<source src="https://www.dropbox.com/scl/fi/w5vhpt271i0nc9po6saux/Everytime.mp3?dl=1" type="audio/mpeg">`;
    audio.load();
    audio.play().catch(() => {});
  }
};

// ========================
// ⚙️ HÀM TIỆN ÍCH
// ========================
const delay = (ms = 1000) => new Promise(r => setTimeout(r, ms));
// central config for small timing values so they're easy to tune
const CONFIG = {
  FLY_EVENT_DUR: 3,
  FLY_FRIEND_DUR: 2,
  PREVIEW_DELAY: 120,
  PREVIEW_HIDE_DELAY: 180,
  FRIEND_WAIT_EXTRA: 300,
  FRIEND_VIEW_MS: 2000
};

const flyToEvent = (lat, lng, zoom = 10, dur = CONFIG.FLY_EVENT_DUR) => map.flyTo([lat, lng], zoom, { duration: dur });
const flyToFriend = (lat, lng, dur = CONFIG.FLY_FRIEND_DUR) => map.flyTo([lat, lng], 10, { duration: dur });

function fadeInMarker(m, scale = 6, stepTime = 40) {
  let step = 0;
  const fade = setInterval(() => {
    step += 0.1;
    if (step >= 1) clearInterval(fade);
  }, stepTime);
}

// --- PROGRESS BAR ---
function updateProgress() {
  if (!EVENTS.length) return;
  const percent = ((current + 1) / EVENTS.length) * 100;
  if (progressBar) progressBar.style.width = `${percent}%`;
}

// ========================
// 📦 LOAD DỮ LIỆU
// ========================
async function loadData() {
  try {
    const [e, f] = await Promise.all([fetch('data/events.json'), fetch('data/friends.json')]);
    EVENTS = await e.json();
    FRIENDS = await f.json();
  } catch {
    console.error('⚠️ Không thể tải dữ liệu');
  }
}

// ========================
// 📍 TẠO MARKER SỰ KIỆN
// ========================
function bindMarkers() {
  markers.length = 0;

  EVENTS.forEach((e, i) => {
    let iconUrl;
    if (i === 0) iconUrl = 'https://cdn-icons-png.flaticon.com/512/3010/3010995.png'; // 🏠 Nhà
    else if (i === EVENTS.length - 1) iconUrl = 'https://cdn-icons-png.flaticon.com/512/2995/2995600.png'; // 🎓 Tốt nghiệp
    else if (e.place.match(/Thực tập|Nha Trang|Long An|Vĩnh Hy/i)) iconUrl = 'https://cdn-icons-png.flaticon.com/512/2028/2028376.png'; // 🌄 Chuyến đi
    else if (e.place.match(/Trường|Thủ Đức|Dĩ An/i)) iconUrl = 'https://cdn-icons-png.flaticon.com/512/4185/4185714.png'; // 🎒 Đi học
    else if (e.place.match(/Công ty|Tân Bình/i)) iconUrl = 'https://cdn-icons-png.flaticon.com/512/2163/2163311.png'; // 💼 Làm việc
    else iconUrl = 'https://cdn-icons-png.flaticon.com/512/1344/1344759.png';

    const iconEvent = L.icon({
      iconUrl,
      iconSize: [36, 36],
      iconAnchor: [18, 36],
      popupAnchor: [0, -30]
    });

    let imgs = "";
    if (Array.isArray(e.img) && e.img.length > 0) {
      // Add row class depending on number of images so CSS can size them appropriately
      const rowClass = e.img.length > 2 ? 'img-row many' : 'img-row few';
      imgs = `<div class="${rowClass}">` +
        e.img.map(src => `<img class="event-img" src="${src}" loading="lazy" alt="${e.title}">`).join('') +
        `</div>`;
    } else if (e.img) {
      imgs = `<div class="img-row few"><img class="event-img" src="${e.img}" alt="${e.title}"></div>`;
    }

    const html = `
      <h3>${e.title} <span class="badge">${e.date || ''}</span></h3>
      <p><b>Địa điểm:</b> ${e.place || ''}</p>
      <p>${e.desc || ''}</p>
      ${imgs}
    `;

    markers.push(L.marker(e.coords, { icon: iconEvent }).bindPopup(html, { maxWidth: 300 }));
  });
}

// ========================
// 🚀 BẮT ĐẦU HÀNH TRÌNH
// ========================
async function start() {
  await loadData();
  bindMarkers();
  overlays.intro.classList.add('hidden');
  audio.currentTime = 0;
  audio.volume = 0.8;
  audio.play().catch(() => {});

  const controls = document.getElementById("controls");
  controls.classList.add("show");

  const timeline = document.getElementById("timeline");
  timeline.classList.remove("show");
  timeline.style.display = "none";
  controls.classList.add("controls-lower");
  timelineWasVisible = false;

  // Ensure controls are positioned correctly after UI changes
  setTimeout(() => updateControlsPosition(), 60);

  showEvent(0);
}

// ========================
// 🗺️ HIỂN THỊ SỰ KIỆN
// ========================
async function showEvent(index, forward = true) {
  current = index;
  prevBtn.disabled = current <= 0;
  nextBtn.disabled = current >= EVENTS.length - 1;

  const e = EVENTS[index];
  const coords = L.latLng(e.coords);
  const points = forward ? [...pathLine.getLatLngs(), coords] : EVENTS.slice(0, index + 1).map(ev => ev.coords);
  pathLine.setLatLngs(points);
  pathGlow.setLatLngs(points);

  flyToEvent(e.coords[0], e.coords[1]);
  if (!map.hasLayer(markers[index])) markers[index].addTo(map);
  markers[index].openPopup();
  updateProgress();

  // Thêm ảnh vào timeline
  const timelineBox = document.getElementById("timelineContent");
  if (e.img) {
    const imgs = Array.isArray(e.img) ? e.img : [e.img];
    imgs.forEach(src => {
      const img = document.createElement("img");
      img.src = src;
      img.className = "timeline-img";
      timelineBox.prepend(img);
      setTimeout(() => img.classList.add("show"), 100);
    });
    timelineBox.scrollTo({ left: 0, behavior: "smooth" });
  }

  if (index === EVENTS.length - 1) {
    await delay(2500);
    overlays.story.classList.remove('hidden');
    celebrate();
  }
}

// ========================
// 🎉 PHÁO GIẤY & PHÁO HOA
// ========================
function celebrate() {
  const seq = [
    { particleCount: 160, spread: 80, startVelocity: 45 },
    { particleCount: 200, spread: 120, startVelocity: 55 },
    { particleCount: 260, spread: 140, startVelocity: 60 }
  ];
  seq.forEach((s, i) =>
    setTimeout(() => confetti({ ...s, origin: { y: 0.6 } }), i * 700)
  );
}

// ========================
// 🎬 AUTO PLAY HÀNH TRÌNH & BẠN BÈ
// ========================
let autoPlay = false;
let autoPlayTimer = null;
let friendTimer = null;
let friendIndex = 0;
let friendPaused = false;
let friendSequenceAbort = false;

function startAutoJourney() {
  clearInterval(autoPlayTimer);
  autoPlay = true;
  autoPlayBtn.classList.add("active");
  renderAutoBtn(true);
  autoPlayTimer = setInterval(() => {
    if (current < EVENTS.length - 1) showEvent(current + 1);
    else stopAutoJourney();
  }, 5500);
}
function stopAutoJourney() {
  clearInterval(autoPlayTimer);
  autoPlay = false;
  autoPlayBtn.classList.remove("active");
  renderAutoBtn(false);
}

function showFriend(i) {
  const f = FRIENDS[i];
  if (!f) return Promise.resolve(false);

  // create or reuse a per-friend marker so previously shown icons remain visible
  const icon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/2107/2107957.png',
    iconSize: [32, 32], iconAnchor: [16, 32], popupAnchor: [0, -28]
  });

  const myToken = ++friendSequenceToken; // capture token for this run

  if (!friendMarkers[i]) {
    const m = L.marker(f.coords, { icon }).bindPopup(`
      <div style="text-align:center; max-width:180px;">
        <b>${f.name}</b><br>
        ${f.img ? `<img src="${f.img}" style="width:100%;max-height:120px;border-radius:8px;">` : ''}
        <p>${f.msg || ''}</p>
      </div>`);
    friendMarkers[i] = m;
  } else {
    try { friendMarkers[i].setLatLng(f.coords); } catch (e) {}
  }

  // close any existing popup
  try { map.closePopup(); } catch (e) {}

  // Fly then open popup; Promise resolves when popup is opened (or sequence canceled)
  return new Promise((resolve) => {
  if (friendSequenceToken !== myToken) return resolve(false);

  flyToFriend(...f.coords);

    let settled = false;
    const done = (opened) => {
      if (settled) return;
      settled = true;
      try {
        // ensure the reusable marker is present on the map/layer so icon remains
        if (reusableFriendMarker && !map.hasLayer(reusableFriendMarker)) {
          reusableFriendMarker.addTo(friendsLayer);
        }
      } catch (e) {}
      resolve(opened);
    };

    // prepare holders so moveend and fallback can clear each other
    let fallback = null;
    let abortCheck = null;

    const onMoveEnd = () => {
      if (friendSequenceToken !== myToken) return done(false);
      // ensure we only open once
      if (!settled) {
        try {
          // add marker to layer (if not already) so icon remains
          if (!map.hasLayer(friendMarkers[i])) friendMarkers[i].addTo(friendsLayer);
          friendMarkers[i].openPopup();
        } catch (e) {}
        // clear fallback so it won't reopen
        if (fallback) clearTimeout(fallback);
        if (abortCheck) { clearInterval(abortCheck); }
        done(true);
      }
    };

    map.once('moveend', onMoveEnd);

    // fallback in case moveend doesn't fire
    fallback = setTimeout(() => {
      if (friendSequenceToken !== myToken) return done(false);
      if (!settled) {
        try {
          if (!map.hasLayer(friendMarkers[i])) friendMarkers[i].addTo(friendsLayer);
          friendMarkers[i].openPopup();
        } catch (e) {}
        done(true);
      }
    }, (CONFIG.FLY_FRIEND_DUR * 1000) + CONFIG.FRIEND_WAIT_EXTRA);

    // Cleanup if token changes (another run started)
    abortCheck = setInterval(() => {
      if (friendSequenceToken !== myToken) {
        clearInterval(abortCheck);
        try { map.off('moveend', onMoveEnd); } catch (e) {}
        if (fallback) clearTimeout(fallback);
        done(false);
      }
    }, 80);
  });
}

function startAutoFriendsSequence() {
  // start an async sequence that waits for each fly+popup to finish
  clearInterval(friendTimer);
  friendTimer = null;
  friendIndex = 0;
  friendPaused = false;
  friendSequenceAbort = false;
  autoPlay = true;
  autoPlayBtn.textContent = "⏸";

  (async function run() {
    while (!friendSequenceAbort && friendIndex < FRIENDS.length) {
      if (friendPaused) {
        await delay(400);
        continue;
      }
      // await the showFriend promise so next friend waits for fly+popup
      await showFriend(friendIndex);
      friendIndex++;
  // give time for user to view popup (CONFIG.FRIEND_VIEW_MS)
  await delay(CONFIG.FRIEND_VIEW_MS);
    }
    if (!friendSequenceAbort) stopAutoFriends();  
  })();
}

function stopAutoFriends() {
  // signal any running showFriend/promises to abort
  friendSequenceAbort = true;
  // increment token to cancel any active showFriend callbacks
  friendSequenceToken++;

  clearInterval(friendTimer);
  friendTimer = null;
  autoPlay = false;
  friendPaused = false;
  autoPlayBtn.textContent = "⏵ Tự động phát";

  // Keep the reusable friend marker visible (user requested icon remain),
  // but close any open popup so the map is tidy.
  try {
    if (reusableFriendMarker) {
      try { reusableFriendMarker.closePopup(); } catch (e) {}
      // intentionally keep the marker on the map so the icon remains
    }
    try { map.closePopup(); } catch (e) {}
  } catch (e) {}
  // Ensure marker is added back if for some reason it was removed earlier
  try {
    if (reusableFriendMarker && !map.hasLayer(reusableFriendMarker)) {
      reusableFriendMarker.addTo(friendsLayer);
    }
  } catch (e) {}

  // 🎊 Hiển thị các bạn phụ (EXTRA_FRIENDS)
  const EXTRA_FRIENDS = [
    [10.181312,105.02934],[21.314253,106.41557],[9.136016,105.185867],[9.741704,105.759187],
    [22.744235,106.085667],[15.681718,108.21346],[12.920833,108.445585],[21.710477,103.023615],
    [11.435488,107.035754],[10.495061,105.897457],[13.889082,108.440932],[20.999186,105.699851],
    [18.290224,105.737081],[20.869045,106.507798],[16.330726,107.519444],[20.614969,106.276306],
    [22.316816,103.187044],[11.672261,107.970793],[21.838538,106.620681],[22.059544,104.3492],
    [19.236351,104.946119],[20.307646,106.051826],[21.014025,105.285948],[14.76793,108.145635],
    [21.240554,107.267896],[17.239355,106.529388],[21.192675,104.071508],[11.049251,106.166868],
    [22.022424,105.825298],[20.045184,105.319816],[10.865813,106.845196],[22.488711,105.10103],[9.996202,106.289283]
  ];

  const extraIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/2107/2107957.png',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -10]
  });

  EXTRA_FRIENDS.forEach((coords, idx) => {
    setTimeout(() => {
      const m = L.marker(coords, { icon: extraIcon }).addTo(friendsLayer);
      try { if (m._icon) m._icon.style.transform = 'scale(0)'; } catch(e){}
      setTimeout(() => { try { if (m._icon) m._icon.style.transform = 'scale(1)'; } catch(e){} }, 60);
    }, idx * 40);
  });

  // 📍 Hiển thị popup kết thúc
  const msg = L.popup({ closeButton: false })
    .setLatLng([10.853389081049862, 106.64577969192148])
    .setContent(`<b>…và còn rất nhiều người khác nữa 💫</b><br>Mỗi người một nơi,<br>nhưng tất cả đều là một phần của hành trình này.`)
    .openOn(map);

  // 🎇 Hiệu ứng kết thúc
  setTimeout(() => {
    map.closePopup(msg);
    map.flyToBounds(L.latLngBounds([
      ...FRIENDS.map(f => f.coords),
      ...EXTRA_FRIENDS
    ]), { padding: [40, 40], duration: 3 });
  }, 4500);

  // Sau khi zoom xong → mở overlay mời
  setTimeout(() => {
    overlays.invite.classList.remove('hidden');
    startFireworks();
  }, 8000);
}

// ========================
// 💬 HIỆU ỨNG CHỮ GÕ (TRONG LÚC XEM BẠN BÈ)
// ========================
function typingDuringFriends() {
  const messages = [
    "Những người bạn đã cùng tôi đi qua hành trình này 💚",
    "Mỗi người một nơi nhưng kỷ niệm thì vẫn còn mãi ✨",
    "Cảm ơn vì đã đồng hành cùng tôi trong những ngày tháng học tập và trưởng thành 🎓",
    "Có những ngày chỉ cần ngồi bên nhau thôi cũng thấy lòng bình yên lắm ☕",
    "Những chuyến đi, những buổi học, những bức ảnh cùng nhau sẽ luôn là ký ức quý giá 📸",
    "Cảm ơn mọi người vì đã luôn giúp đỡ và động viên để tôi có thêm niềm tin và năng lượng ❤️",
    "Có lúc mệt có lúc nản nhưng nhờ có bạn bè mà mọi thứ đều trở nên dễ dàng hơn 🌈",
    "Mọi người là phần không thể thiếu trong hành trình này và tôi thật sự trân quý điều đó 💫",
    "Hy vọng sau này dù mỗi người một hướng, chúng ta vẫn nhớ về những ngày tươi đẹp ấy 😊"
  ];

  const box = document.createElement("div");
  box.id = "typingOverlay";
  Object.assign(box.style, {
    position: "fixed",
    top: "10%",
    left: "50%",
    transform: "translateX(-50%)",
    fontSize: "1.4rem",
    color: "#fff",
    textShadow: "0 0 8px rgba(0,0,0,0.7)",
    fontWeight: "500",
    textAlign: "center",
    zIndex: 1200
  });
  document.body.appendChild(box);

  let isRunning = true;
  async function typeAndErase(text) {
    for (let i = 0; i < text.length && isRunning; i++) {
      box.textContent += text[i];
      await delay(50);
    }
    await delay(1500);
    for (let i = text.length; i >= 0 && isRunning; i--) {
      box.textContent = text.slice(0, i);
      await delay(25);
    }
  }

  (async function run() {
    while (isRunning) {
      for (const msg of messages) await typeAndErase(msg);
    }
  })();

  return {
    stop() {
      isRunning = false;
      box.style.opacity = 0;
      setTimeout(() => box.remove(), 400);
    }
  };
}

// ========================
// 🔘 CÁC NÚT CHỨC NĂNG
// ========================
autoPlayBtn.onclick = () => {
  if (inFriendsMode) {
    if (!autoPlay) startAutoFriendsSequence();
    else friendPaused = !friendPaused, autoPlayBtn.textContent = friendPaused ? "⏵ Tiếp tục" : "⏸ Tạm dừng";
  } else {
    if (!autoPlay) startAutoJourney();
    else stopAutoJourney();
  }
};

startBtn.onclick = start;
nextBtn.onclick = () => current < EVENTS.length - 1 && showEvent(current + 1);
prevBtn.onclick = () => current > 0 && showEvent(current - 1);

// Nút xem bạn bè
showFriendsBtn.onclick = () => {
  inFriendsMode = true;
  overlays.story.classList.add('hidden');
  // 🧭 Ẩn toàn bộ markers và line của hành trình
  markers.forEach(m => map.removeLayer(m));
  map.removeLayer(pathLine);
  map.removeLayer(pathGlow);
  updateControlsPosition();
  const typingFx = typingDuringFriends();
  // ensure friends layer is present so friend icon stays visible
  try { friendsLayer.addTo(map); } catch (e) {}
  // if we already have a reusable friend marker, ensure it's added to the layer
  try { if (reusableFriendMarker && !map.hasLayer(reusableFriendMarker)) reusableFriendMarker.addTo(friendsLayer); } catch (e) {}
  startAutoFriendsSequence();
  setTimeout(() => typingFx.stop(), FRIENDS.length * 3000 + 2000);
};

// Khi người dùng nhấn nút "Đóng" trên overlay kết thúc -> hiển thị overlay mời dự lễ
closeStoryBtn.onclick = () => {
  // Ẩn overlay câu chuyện
  overlays.story.classList.add('hidden');

  // Hiện overlay lời mời
  overlays.invite.classList.remove('hidden');

  // Tắt nhạc nền nếu đang chạy, bật nhạc pháo hoa
  const bgm = document.getElementById('bgm');
  const fireworksSound = document.getElementById('fireworkSound');
  try {
    if (bgm && !bgm.paused) bgm.pause();
  } catch (e) {}
  try {
    if (fireworksSound) {
      fireworksSound.currentTime = 0;
      fireworksSound.play().catch(() => {});
    }
  } catch (e) {}

  // Bật hiệu ứng pháo hoa trên canvas
  startFireworks();

  // Ẩn controls tạm thời để fokus vào overlay
  const controls = document.getElementById('controls');
  if (controls) {
    controls.style.display = 'none';
    setTimeout(() => controls.classList.remove('show'), 10);
  }
};

// ========================
// 🖼️ NÚT BẬT/TẮT TIMELINE
// ========================
toggleTimelineBtn.onclick = () => {
  const timeline = document.getElementById("timeline");
  const controls = document.getElementById("controls");
  const isHidden = timeline.style.display === "none" || !timeline.classList.contains("show");
if (isHidden) {
  timeline.style.display = "flex";
  setTimeout(() => {
    timeline.classList.add("show");
    updateControlsPosition();   // <-- đẩy nút lên ngay khi timeline hiện
  }, 10);
  toggleTimelineBtn.classList.remove("off");
  timelineWasVisible = true;
} else {
  timeline.classList.remove("show");
  setTimeout(() => {
    timeline.style.display = "none";
    updateControlsPosition();   // <-- hạ nút xuống khi timeline ẩn
  }, 420);
  toggleTimelineBtn.classList.add("off");
  timelineWasVisible = false;
}};
// ========================
// 🎆 HIỆU ỨNG PHÁO HOA (BỔ SUNG)
// ========================
function startFireworks() {
  const canvas = document.getElementById('fireworks');
  const ctx = canvas.getContext('2d');
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  canvas.style.opacity = 1;

  let fireworks = [];
  let running = true;

  const random = (min, max) => Math.random() * (max - min) + min;

  function createFirework(x, y) {
    const color = `hsl(${random(0, 360)}, 100%, 60%)`;
    return Array.from({ length: 80 }, () => ({
      x, y,
      angle: random(0, Math.PI * 2),
      speed: random(2, 6),
      alpha: 1,
      color
    }));
  }

  function draw() {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.15)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    fireworks.forEach((particles, i) => {
      particles.forEach(p => {
        p.x += Math.cos(p.angle) * p.speed;
        p.y += Math.sin(p.angle) * p.speed + 0.5;
        p.alpha -= 0.01;
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
        ctx.fill();
      });
      if (particles.every(p => p.alpha <= 0)) fireworks.splice(i, 1);
    });
    ctx.globalAlpha = 1;
    if (running) requestAnimationFrame(draw);
  }

  draw();
  setInterval(() => {
    for (let i = 0; i < 3; i++)
      fireworks.push(createFirework(random(0, canvas.width), random(0, canvas.height / 2)));
  }, 500);
}

// 🎇 KHI ĐÓNG LỜI MỜI
inviteCloseBtn.onclick = () => {
  overlays.invite.classList.add('hidden');

  const timeline = document.getElementById("timeline");
  const controls = document.getElementById("controls");

  if (timelineWasVisible) {
    timeline.style.display = "flex";
    setTimeout(() => timeline.classList.add("show"), 10);
  }

  controls.style.display = "flex";
  setTimeout(() => controls.classList.add("show"), 10);
  // Recalculate proper controls position instead of using a hard-coded value
  setTimeout(() => updateControlsPosition(), 80);

  map.flyTo([15.5, 107], 5, { duration: 3 });
  map.addLayer(pathLine);
  map.addLayer(pathGlow);
  markers.forEach(m => m.addTo(map));

  const canvas = document.getElementById('fireworks');
  canvas.style.opacity = 1;
  startFireworks();

  const bgm = document.getElementById('bgm');
  const fireworks = document.getElementById('fireworkSound');
  fireworks.pause();
  fireworks.currentTime = 0;
  bgm.play().catch(() => {});

  setTimeout(() => {
    canvas.style.opacity = 0;
  }, 3000);
};

// Ensure controls position once after the page fully loads
window.addEventListener('load', () => setTimeout(() => updateControlsPosition(), 120));

// -----------------------------
// Image preview (hover / click)
// -----------------------------
function ensureImagePreviewUI() {
  if (document.getElementById('imgPreview')) return;
  const el = document.createElement('div');
  el.id = 'imgPreview';
  el.className = 'hidden';
  el.innerHTML = `<img alt="preview"><div class="hint">Click để đóng</div>`;
  document.body.appendChild(el);

  // Interactions: hover over preview keeps it open; click closes
  el.addEventListener('mouseenter', () => {
    if (el._hideTimeout) clearTimeout(el._hideTimeout);
  });
  el.addEventListener('mouseleave', () => {
    el._hideTimeout = setTimeout(() => hideImagePreview(), CONFIG.PREVIEW_HIDE_DELAY);
  });
  el.addEventListener('click', () => hideImagePreview());
}

function showImagePreview(src) {
  ensureImagePreviewUI();
  const el = document.getElementById('imgPreview');
  const img = el.querySelector('img');
  img.src = src;
  el.classList.remove('hidden');
  // allow CSS transition
  setTimeout(() => el.classList.add('visible'), 10);
}

function hideImagePreview() {
  const el = document.getElementById('imgPreview');
  if (!el) return;
  el.classList.remove('visible');
  if (el._hideTimeout) clearTimeout(el._hideTimeout);
  el._hideTimeout = setTimeout(() => {
    el.classList.add('hidden');
  }, CONFIG.PREVIEW_HIDE_DELAY);
}

// Delegate hover/click events for popup images
// Use pointer events (better for touch & more predictable enter/leave)
document.addEventListener('pointerover', (ev) => {
  const img = ev.target && ev.target.classList && ev.target.classList.contains('event-img') ? ev.target : null;
  if (!img) return;
  const preview = document.getElementById('imgPreview');
  // If preview already visible, update image immediately and cancel hide timeout
  if (preview && preview.classList.contains('visible')) {
    const pimg = preview.querySelector('img');
    if (pimg && pimg.src !== img.src) pimg.src = img.src;
    if (preview._hideTimeout) { clearTimeout(preview._hideTimeout); preview._hideTimeout = null; }
    return;
  }
  // otherwise schedule showing (small delay prevents accidental flicker)
  if (img._previewTimer) clearTimeout(img._previewTimer);
  img._previewTimer = setTimeout(() => showImagePreview(img.src), CONFIG.PREVIEW_DELAY);
});

document.addEventListener('pointerout', (ev) => {
  const img = ev.target && ev.target.classList && ev.target.classList.contains('event-img') ? ev.target : null;
  if (!img) return;
  if (img._previewTimer) { clearTimeout(img._previewTimer); img._previewTimer = null; }

  const related = ev.relatedTarget;
  // If pointer moved into the preview or another thumbnail, don't hide
  if (related) {
    try {
      if (related.id === 'imgPreview' || (related.closest && related.closest('#imgPreview'))) return;
    } catch (e) {}
    if (related.classList && related.classList.contains('event-img')) return;
  }

  // otherwise hide after a short delay (allows moving into preview)
  const preview = document.getElementById('imgPreview');
  if (preview) {
    if (preview._hideTimeout) clearTimeout(preview._hideTimeout);
    preview._hideTimeout = setTimeout(() => hideImagePreview(), CONFIG.PREVIEW_HIDE_DELAY);
  } else {
    hideImagePreview();
  }
});
// also support click to open instantly (mobile/touch)
document.addEventListener('click', (ev) => {
  const img = ev.target && ev.target.classList && ev.target.classList.contains('event-img') ? ev.target : null;
  if (!img) return;
  // open immediately on click
  showImagePreview(img.src);
});
