(() => {
  // Minimal utility: stable href watcher for SPA nav
  let lastHref = location.href;
  const onUrlChange = () => {
    if (location.href !== lastHref) {
      lastHref = location.href;
      setTimeout(handleVideoChange, 300);
    }
  };
  const obs = new MutationObserver(onUrlChange);
  obs.observe(document, {subtree: true, childList: true});

  document.addEventListener('yt-navigate-finish', () => setTimeout(handleVideoChange, 300));

  function getVideoEl(){ return document.querySelector('video'); }
  function getVideoId(){
    const u = new URL(location.href);
    return u.searchParams.get('v') || location.pathname.replace('/shorts/','');
  }
  function getTitle(){
    const el = document.querySelector('h1.ytd-watch-metadata') || document.querySelector('h1.title');
    return el ? el.textContent.trim() : document.title.replace(' - YouTube','');
  }
  function pause(){ const v = getVideoEl(); if (v) v.pause(); }
  function play(){ const v = getVideoEl(); if (v) v.play(); }
  function seekTo(s){
    const v = getVideoEl(); if (!v) return;
    v.currentTime = s;
    v.play();
  }
  function fmtTime(sec){
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec/3600);
    const m = Math.floor((sec%3600)/60);
    const s = sec%60;
    const mm = String(m).padStart(2,'0');
    const ss = String(s).padStart(2,'0');
    return h>0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  }

  // Storage using chrome.storage.sync (cross-device w/ Google account)
  async function loadNotes(videoId){
    const key = `yn_notes_${videoId}`;
    return new Promise(res => {
      chrome.storage.sync.get([key], obj => res(obj[key] || []));
    });
  }
  async function saveNotes(videoId, notes){
    const key = `yn_notes_${videoId}`;
    return new Promise(res => chrome.storage.sync.set({[key]: notes}, res));
  }

  // UI: Button near the Subscribe area (not floating)
  async function injectHeaderButton(){
    if (document.getElementById('yn-header-btn-add') || document.getElementById('yn-header-btn-view')) return;

    const tryTargets = [
      'ytd-video-owner-renderer #top-row',
      'ytd-subscribe-button-renderer',
      '#owner #top-row'
    ];
    let host;
    for (const sel of tryTargets){
      host = document.querySelector(sel);
      if (host) break;
    }
    if (!host) return setTimeout(injectHeaderButton, 600);

    // Add Note button
    const addBtn = document.createElement('button');
    addBtn.id = 'yn-header-btn-add';
    addBtn.className = 'yn-btn';
    addBtn.innerHTML = `<span class="yn-icon">＋</span><span class="yn-label">Add note</span>`;
    addBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      openModalForCurrentTime();
    });

    // View Notes button
    const viewBtn = document.createElement('button');
    viewBtn.id = 'yn-header-btn-view';
    viewBtn.className = 'yn-btn';
    viewBtn.innerHTML = `<span class="yn-icon">👁</span><span class="yn-label">View notes</span>`;
    viewBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const sb = ensureSidebar();
      sb.classList.toggle('visible');
      if (sb.classList.contains('visible')) {
        await renderNotes();
      }
    });

    host.prepend(viewBtn);
    host.prepend(addBtn);
  }

  // Sidebar
  function ensureSidebar(){
    let sb = document.getElementById('yn-sidebar');
    if (sb) return sb;
    sb = document.createElement('div');
    sb.id = 'yn-sidebar';
    sb.innerHTML = `
      <div class="yn-header">
        <div class="yn-title">Notes</div>
        <div class="yn-actions">
  <button id="yn-export"><span class="yn-icon">📤</span><span class="yn-label">Export</span></button>
  <button id="yn-import"><span class="yn-icon">📥</span><span class="yn-label">Import</span></button>
  <button id="yn-close"><span class="yn-label">Close</span></button>
</div>

      </div>
      <div class="yn-list" id="yn-list"></div>
      <div class="yn-footer">Made by Ankit</div>
    `;
    document.documentElement.appendChild(sb);
    sb.querySelector('#yn-close').addEventListener('click', ()=> sb.classList.remove('visible'));
    sb.querySelector('#yn-export').addEventListener('click', exportNotes);
    sb.querySelector('#yn-import').addEventListener('click', importNotes);
    return sb;
  }
  function showSidebar(){ ensureSidebar().classList.add('visible'); }
  function hideSidebar(){ const sb = document.getElementById('yn-sidebar'); if (sb) sb.classList.remove('visible'); }

  async function renderNotes(){
    const vid = getVideoId();
    if (!vid) return;
    const notes = (await loadNotes(vid)).sort((a,b)=>a.timestamp-b.timestamp);
    const list = ensureSidebar().querySelector('#yn-list');
    list.innerHTML = '';
    for (const n of notes){
      const row = document.createElement('div');
      row.className = 'yn-note';
      row.innerHTML = `
        <div class="yn-ts">${fmtTime(n.timestamp)}</div>
        <div class="yn-text"></div>
        <div class="yn-row-actions">
          <button class="yn-del" title="Delete">✕</button>
        </div>
      `;
      row.querySelector('.yn-text').textContent = n.text;

      // Make the whole row clickable except delete
      row.addEventListener('click', (e) => {
        if (e.target.closest('.yn-del')) return; // ignore delete
        seekTo(n.timestamp);
      });

      row.querySelector('.yn-del').addEventListener('click', async () => {
        const after = notes.filter(x=>x.id!==n.id);
        await saveNotes(vid, after);
        renderNotes();
      });

      list.appendChild(row);
    }
    const titleEl = document.querySelector('#yn-sidebar .yn-title');
if (titleEl) titleEl.textContent = "Notes";

  }

  // Modal input
  function ensureModal(){
    let m = document.getElementById('yn-modal');
    if (m) return m;
    m = document.createElement('div');
    m.id = 'yn-modal';
    m.innerHTML = `
      <div class="yn-card">
        <div class="yn-card-header">
          <div id="yn-modal-title">Add Note</div>
          <button id="yn-x" title="Close">×</button>
        </div>
        <div class="yn-card-body">
          <div style="margin-bottom:8px; opacity:0.9">Time: <span id="yn-ts">0:00</span></div>
          <textarea id="yn-input" placeholder="Type your note... (Ctrl+Enter to save)"></textarea>
        </div>
        <div class="yn-card-footer">
          <button id="yn-cancel">Cancel</button>
          <button id="yn-save" class="primary">Save</button>
        </div>
      </div>
    `;
    document.documentElement.appendChild(m);
    const close = ()=>{ m.classList.remove('visible'); };
    m.addEventListener('click',(e)=>{ if(e.target===m) close(); });
    m.querySelector('#yn-x').addEventListener('click', close);
    m.querySelector('#yn-cancel').addEventListener('click', close);
    return m;
  }

  let lastTs = 0;
  function openModalForCurrentTime(){
    pause();
    const m = ensureModal();
    lastTs = (getVideoEl()?.currentTime) || 0;
    m.querySelector('#yn-ts').textContent = fmtTime(lastTs);
    const input = m.querySelector('#yn-input');
    input.value = '';
    m.classList.add('visible');
    input.focus();
    input.addEventListener('keydown', onInputKeydown);
    m.querySelector('#yn-save').onclick = saveFromModal;
  }
  function onInputKeydown(e){
    if (e.key === 'Escape'){ e.preventDefault(); document.getElementById('yn-modal').classList.remove('visible'); }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter'){
      e.preventDefault();
      saveFromModal();
    }
  }
  async function saveFromModal(){
    const input = document.querySelector('#yn-input');
    const text = (input?.value || '').trim();
    const m = document.getElementById('yn-modal');
    if (!text){ m.classList.remove('visible'); play(); return; }
    const vid = getVideoId();
    const existing = await loadNotes(vid);
    existing.push({
      id: Date.now().toString(),
      videoId: vid,
      videoTitle: getTitle(),
      timestamp: lastTs,
      text,
      date: new Date().toISOString(),
      url: location.href
    });
    await saveNotes(vid, existing);
    m.classList.remove('visible');
    renderNotes();
    play();
    showSidebar();
  }

  // Export notes as JSON
  async function exportNotes(){
    const vid = getVideoId();
    const notes = await loadNotes(vid);
    const data = {
      videoId: vid,
      videoTitle: getTitle(),
      url: location.href,
      exportedAt: new Date().toISOString(),
      notes
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `notes_${vid}.ynotes.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // Import notes from JSON
  async function importNotes(){
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.ynotes.json';
    input.onchange = async () => {
      const file = input.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        const data = JSON.parse(text);
        if (!data.videoId || !Array.isArray(data.notes)) {
          alert("Invalid notes file.");
          return;
        }
        const vid = getVideoId();
        if (vid !== data.videoId) {
          if (!confirm("These notes are for a different video. Import anyway?")) return;
        }
        const existing = await loadNotes(vid);
        const merged = [...existing, ...data.notes].reduce((acc, note) => {
          if (!acc.some(n => n.id === note.id)) acc.push(note);
          return acc;
        }, []);
        await saveNotes(vid, merged);
        alert(`Imported ${data.notes.length} notes.`);
        renderNotes();
      } catch(err){
        alert("Failed to import notes: " + err.message);
      }
    };
    input.click();
  }

  async function handleVideoChange(){
    injectHeaderButton();
    renderNotes();
  }

  // Also add a keyboard shortcut: Alt+N to add note; Alt+S to toggle sidebar
  window.addEventListener('keydown', (e) => {
    if (e.altKey && !e.shiftKey && !e.ctrlKey && !e.metaKey){
      if (e.key.toLowerCase() === 'n'){ e.preventDefault(); openModalForCurrentTime(); }
      if (e.key.toLowerCase() === 's'){ e.preventDefault(); const sb = ensureSidebar(); sb.classList.toggle('visible'); if(sb.classList.contains('visible')) renderNotes(); }
    }
  });

  // Initial kick
  handleVideoChange();
})();
