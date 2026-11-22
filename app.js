const DB_NAME = "offline-player-db";
const DB_VERSION = 1;
const STORE = "tracks";

const audio = document.getElementById("audio");
const fileInput = document.getElementById("fileInput");
const trackList = document.getElementById("trackList");
const emptyState = document.getElementById("emptyState");
const playlistList = document.getElementById("playlistList");
const searchInput = document.getElementById("searchInput");
const toastEl = document.getElementById("toast");

let db;
let tracks = [];
let playlists = [];
let currentTrackId = null;
let currentObjectUrl = null;
let currentView = "library";
let currentPlaylistId = null;
let queue = [];
let shuffle = false;
let repeat = false;
let sortNewestFirst = true;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function getAllTracks() {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const request = tx.objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function saveTrack(track) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(track);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function deleteTrack(id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

function savePlaylists() {
  localStorage.setItem("offline-player-playlists", JSON.stringify(playlists));
}

function loadPlaylists() {
  try { playlists = JSON.parse(localStorage.getItem("offline-player-playlists") || "[]"); }
  catch { playlists = []; }
}

function makeId() {
  return (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
}

function showToast(message) {
  toastEl.textContent = message;
  toastEl.classList.add("show");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return "0:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
}

function cleanName(filename) {
  return filename.replace(/\.[^/.]+$/, "").replace(/[_-]+/g, " ").trim();
}

function visibleTracks() {
  let list = [...tracks];
  if (currentView === "playlist" && currentPlaylistId) {
    const playlist = playlists.find(p => p.id === currentPlaylistId);
    const ids = playlist?.trackIds || [];
    list = ids.map(id => tracks.find(t => t.id === id)).filter(Boolean);
  }
  const query = searchInput.value.trim().toLowerCase();
  if (query) list = list.filter(t => `${t.title} ${t.filename}`.toLowerCase().includes(query));
  list.sort((a, b) => sortNewestFirst ? b.addedAt - a.addedAt : a.title.localeCompare(b.title));
  return list;
}

function render() {
  renderPlaylists();
  const list = visibleTracks();
  document.getElementById("songCount").textContent = tracks.length;
  document.getElementById("trackTotal").textContent = `${list.length} ${list.length === 1 ? "TITEL" : "TITEL"}`;
  trackList.innerHTML = "";

  if (!list.length) {
    const isEmptyLibrary = currentView === "library" && tracks.length === 0;
    trackList.innerHTML = `<div class="empty-state">
      <div class="empty-icon">♫</div>
      <h2>${isEmptyLibrary ? "Hier ist noch Platz für Musik." : "Noch keine Songs hier."}</h2>
      <p>${isEmptyLibrary ? "Tippe auf „Musik hinzufügen“ und importiere deine Audiodateien." : "Füge Songs hinzu oder wähle eine andere Playlist."}</p>
    </div>`;
  } else {
    list.forEach((track, index) => {
      const row = document.createElement("div");
      row.className = `track-row ${track.id === currentTrackId ? "playing" : ""}`;
      row.draggable = true;
      row.innerHTML = `
        <span class="track-number">${track.id === currentTrackId ? "♫" : String(index + 1).padStart(2, "0")}</span>
        <div class="track-main"><div class="mini-cover">♫</div><div style="min-width:0"><div class="track-name"></div><div class="track-artist">Lokale Audiodatei</div></div></div>
        <span class="track-file"></span><span class="track-duration">${formatTime(track.duration)}</span>
        <button class="row-menu" title="Optionen" aria-label="Songoptionen">⋯</button>`;
      row.querySelector(".track-name").textContent = track.title;
      row.querySelector(".track-file").textContent = track.filename;
      row.addEventListener("click", (event) => {
        if (event.target.closest(".row-menu")) return;
        playTrack(track.id, list);
      });
      row.addEventListener("dragstart", event => {
        event.dataTransfer.setData("text/plain", track.id);
        event.dataTransfer.effectAllowed = "copy";
      });
      row.querySelector(".row-menu").addEventListener("click", event => {
        event.stopPropagation();
        showTrackMenu(track);
      });
      trackList.appendChild(row);
    });
  }
  updateCurrentDisplay();
}

function renderPlaylists() {
  playlistList.innerHTML = "";
  playlists.forEach(playlist => {
    const button = document.createElement("button");
    button.className = `playlist-item ${currentView === "playlist" && currentPlaylistId === playlist.id ? "active" : ""}`;
    button.innerHTML = `<span>♫</span><span class="playlist-name"></span><span class="playlist-count">${playlist.trackIds.length}</span>`;
    button.querySelector(".playlist-name").textContent = playlist.name;
    button.addEventListener("click", () => {
      currentView = "playlist";
      currentPlaylistId = playlist.id;
      document.getElementById("viewTitle").textContent = playlist.name;
      document.getElementById("viewSubtitle").textContent = "Deine Playlist";
      render();
    });
    button.addEventListener("dragover", event => { event.preventDefault(); button.classList.add("active"); });
    button.addEventListener("dragleave", () => button.classList.remove("active"));
    button.addEventListener("drop", event => {
      event.preventDefault();
      button.classList.remove("active");
      const id = event.dataTransfer.getData("text/plain");
      addTrackToPlaylist(id, playlist.id);
    });
    playlistList.appendChild(button);
  });
}

function updateCurrentDisplay() {
  const track = tracks.find(t => t.id === currentTrackId);
  document.getElementById("currentTitle").textContent = track?.title || "Noch kein Song ausgewählt";
  document.getElementById("currentArtist").textContent = track ? "Lokale Audiodatei" : "Füge deine Musik hinzu";
  document.getElementById("playButton").textContent = audio.paused ? "▶" : "Ⅱ";
  document.getElementById("playButton").setAttribute("aria-label", audio.paused ? "Abspielen" : "Pause");
  document.querySelectorAll(".track-row").forEach(row => row.classList.toggle("playing", row.querySelector(".track-name")?.textContent === track?.title));
}

function showTrackMenu(track) {
  const action = prompt(`Song: ${track.title}\n\n1 = Zu Playlist hinzufügen\n2 = Aus Bibliothek löschen\n\nNummer eingeben:`);
  if (action === "1") {
    if (!playlists.length) return showToast("Erstelle zuerst eine Playlist.");
    const names = playlists.map((p, i) => `${i + 1}: ${p.name}`).join("\n");
    const choice = Number(prompt(`Zu welcher Playlist?\n${names}`));
    if (playlists[choice - 1]) addTrackToPlaylist(track.id, playlists[choice - 1].id);
  } else if (action === "2") {
    removeTrack(track.id);
  }
}

async function addFiles(files) {
  const audioFiles = [...files].filter(file => file.type.startsWith("audio/") || /\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(file.name));
  if (!audioFiles.length) return showToast("Keine unterstützte Audiodatei gefunden.");

  for (const file of audioFiles) {
    const id = makeId();
    const track = {
      id,
      title: cleanName(file.name),
      filename: file.name,
      blob: file,
      duration: 0,
      addedAt: Date.now()
    };
    await saveTrack(track);
    tracks.push(track);
    readDuration(track);
  }
  render();
  showToast(`${audioFiles.length} ${audioFiles.length === 1 ? "Song" : "Songs"} importiert.`);
}

function readDuration(track) {
  const url = URL.createObjectURL(track.blob);
  const probe = new Audio();
  probe.preload = "metadata";
  probe.src = url;
  probe.onloadedmetadata = async () => {
    track.duration = Number.isFinite(probe.duration) ? probe.duration : 0;
    await saveTrack(track);
    URL.revokeObjectURL(url);
    render();
  };
  probe.onerror = () => URL.revokeObjectURL(url);
}

async function playTrack(id, list = visibleTracks()) {
  const track = tracks.find(t => t.id === id);
  if (!track) return;
  queue = list.map(t => t.id);
  currentTrackId = id;
  if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
  currentObjectUrl = URL.createObjectURL(track.blob);
  audio.src = currentObjectUrl;
  try {
    await audio.play();
  } catch {
    showToast("Wiedergabe konnte nicht gestartet werden. Tippe erneut auf Play.");
  }
  updateCurrentDisplay();
  render();
}

function togglePlay() {
  if (!currentTrackId) {
    const first = visibleTracks()[0];
    if (first) playTrack(first.id);
    else showToast("Importiere zuerst Musik.");
    return;
  }
  if (audio.paused) audio.play().catch(() => showToast("Tippe erneut auf Play."));
  else audio.pause();
  updateCurrentDisplay();
}

function playNext() {
  const list = queue.length ? queue : visibleTracks().map(t => t.id);
  if (!list.length) return;
  if (shuffle && list.length > 1) {
    const choices = list.filter(id => id !== currentTrackId);
    playTrack(choices[Math.floor(Math.random() * choices.length)], list.map(id => tracks.find(t => t.id === id)).filter(Boolean));
    return;
  }
  const index = list.indexOf(currentTrackId);
  const next = list[index + 1];
  if (next) playTrack(next, list.map(id => tracks.find(t => t.id === id)).filter(Boolean));
  else if (repeat) playTrack(list[0], list.map(id => tracks.find(t => t.id === id)).filter(Boolean));
}

function playPrevious() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  const list = queue.length ? queue : visibleTracks().map(t => t.id);
  const index = list.indexOf(currentTrackId);
  const previous = list[index - 1];
  if (previous) playTrack(previous, list.map(id => tracks.find(t => t.id === id)).filter(Boolean));
  else audio.currentTime = 0;
}

function addTrackToPlaylist(trackId, playlistId) {
  const playlist = playlists.find(p => p.id === playlistId);
  if (!playlist || !tracks.some(t => t.id === trackId)) return;
  if (!playlist.trackIds.includes(trackId)) {
    playlist.trackIds.push(trackId);
    savePlaylists();
    render();
    showToast("Song zur Playlist hinzugefügt.");
  } else showToast("Song ist bereits in dieser Playlist.");
}

async function removeTrack(id) {
  if (!confirm("Diesen Song wirklich aus deiner Bibliothek löschen?")) return;
  await deleteTrack(id);
  tracks = tracks.filter(t => t.id !== id);
  playlists.forEach(p => p.trackIds = p.trackIds.filter(trackId => trackId !== id));
  savePlaylists();
  if (currentTrackId === id) {
    audio.pause();
    audio.removeAttribute("src");
    currentTrackId = null;
    if (currentObjectUrl) URL.revokeObjectURL(currentObjectUrl);
    currentObjectUrl = null;
  }
  render();
  showToast("Song gelöscht.");
}

document.getElementById("libraryButton").addEventListener("click", () => {
  currentView = "library";
  currentPlaylistId = null;
  document.getElementById("viewTitle").textContent = "Alle Songs";
  document.getElementById("viewSubtitle").textContent = "Deine lokale Musikbibliothek";
  document.getElementById("libraryButton").classList.add("active");
  render();
});

document.getElementById("newPlaylistButton").addEventListener("click", () => {
  const name = prompt("Wie soll deine Playlist heißen?");
  if (!name?.trim()) return;
  const playlist = { id: makeId(), name: name.trim(), trackIds: [] };
  playlists.push(playlist);
  savePlaylists();
  currentView = "playlist";
  currentPlaylistId = playlist.id;
  document.getElementById("viewTitle").textContent = playlist.name;
  document.getElementById("viewSubtitle").textContent = "Deine Playlist";
  render();
  showToast("Playlist erstellt. Ziehe Songs darauf oder füge sie über ⋯ hinzu.");
});

fileInput.addEventListener("change", async event => {
  await addFiles(event.target.files);
  fileInput.value = "";
});
searchInput.addEventListener("input", render);
document.getElementById("playButton").addEventListener("click", togglePlay);
document.getElementById("nextButton").addEventListener("click", playNext);
document.getElementById("previousButton").addEventListener("click", playPrevious);
document.getElementById("shuffleButton").addEventListener("click", () => {
  shuffle = !shuffle;
  document.getElementById("shuffleButton").classList.toggle("active", shuffle);
  showToast(shuffle ? "Zufallswiedergabe an" : "Zufallswiedergabe aus");
});
document.getElementById("repeatButton").addEventListener("click", () => {
  repeat = !repeat;
  audio.loop = repeat;
  document.getElementById("repeatButton").classList.toggle("active", repeat);
  showToast(repeat ? "Wiederholen an" : "Wiederholen aus");
});
document.getElementById("sortButton").addEventListener("click", event => {
  sortNewestFirst = !sortNewestFirst;
  event.currentTarget.textContent = sortNewestFirst ? "Zuletzt hinzugefügt ↓" : "Alphabetisch ↑";
  render();
});
document.getElementById("volume").addEventListener("input", event => { audio.volume = Number(event.target.value); });
document.getElementById("progress").addEventListener("input", event => {
  if (Number.isFinite(audio.duration)) audio.currentTime = (Number(event.target.value) / 1000) * audio.duration;
});
audio.addEventListener("timeupdate", () => {
  document.getElementById("currentTime").textContent = formatTime(audio.currentTime);
  document.getElementById("duration").textContent = formatTime(audio.duration);
  if (Number.isFinite(audio.duration) && audio.duration > 0) {
    document.getElementById("progress").value = Math.round((audio.currentTime / audio.duration) * 1000);
  }
});
audio.addEventListener("loadedmetadata", () => {
  document.getElementById("duration").textContent = formatTime(audio.duration);
});
audio.addEventListener("play", updateCurrentDisplay);
audio.addEventListener("pause", updateCurrentDisplay);
audio.addEventListener("ended", () => { if (!repeat) playNext(); });

async function init() {
  try {
    db = await openDatabase();
    tracks = await getAllTracks();
    loadPlaylists();
    audio.volume = 0.8;
    render();
  } catch (error) {
    console.error(error);
    showToast("Speicher konnte nicht geöffnet werden. Bitte Seite neu laden.");
  }
}
init();
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js")
      .catch(error => console.error("Service Worker:", error));
  });
}