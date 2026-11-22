const main = document.getElementById("main");
const dialog = document.getElementById("editor");
const form = document.getElementById("editor-form");
const fields = document.getElementById("editor-fields");
const confirmDialog = document.getElementById("confirm-dialog");
let state = {decks:[], tags:[], cards:[], today:"", now:""};
let view = "today", selectedDeck = 0, search = "", study = null, studyIndex = 0, revealed = false, startedAt = 0;
let filterDeck = 0, filterTag = 0, exportDeck = 0, editing = null, editorDeck = 0, editorTagIds = new Set();
let csvFile = null, jsonFile = null, toastTimer, renderVersion = 0, studyResults = [];

const paths = {
  plus:'<path d="M12 5v14M5 12h14"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  chevron:'<path d="m6 9 6 6 6-6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  upload:'<path d="M12 16V4m-5 5 5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  download:'<path d="M12 4v12m-5-5 5 5 5-5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>',
  search:'<circle cx="10.8" cy="10.8" r="6.2"/><path d="m16 16 4.5 4.5"/>',
  clock:'<circle cx="12" cy="12" r="8"/><path d="M12 7v5l3.5 2"/>',
  cards:'<rect x="5" y="7" width="13" height="13" rx="2"/><path d="M8 4h10a2 2 0 0 1 2 2v10M8 12h6"/>',
  shield:'<path d="M12 3 4 6v5c0 5 3.3 8.2 8 10 4.7-1.8 8-5 8-10V6l-8-3Z"/><path d="m9 12 2 2 4-4"/>',
  spark:'<path d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19"/>',
  rotate:'<path d="M4 11a8 8 0 1 1 2.4 5.7M4 5v6h6"/>',
  mountain:'<path d="m3 19 6.5-9 4 5 2.5-3L21 19H3Z"/>',
  rise:'<path d="M4 18 10 12l4 4 6-8M15 8h5v5"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  close:'<path d="M6 6l12 12M18 6 6 18"/>'
};
function icon(name, extra) {
  return '<svg class="' + (extra || "icon") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths[name] + '</svg>';
}
function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, function(c) {
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}
function dateLabel(value) {
  if (!value) return "New";
  return new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric",year:"numeric"}).format(new Date(value.length === 10 ? value+"T00:00:00" : value));
}
function choice(id,label,items,value) {
  const selected = items.find(function(item){return String(item.value) === String(value);}) || items[0];
  return '<div class="choice" id="' + esc(id) + '" data-value="' + esc(value || "") + '">' +
    '<span class="choice-label" id="' + esc(id) + '-label">' + esc(label) + '</span>' +
    '<button type="button" class="choice-trigger" data-choice-trigger aria-haspopup="listbox" aria-expanded="false" aria-labelledby="' + esc(id) + '-label ' + esc(id) + '-value">' +
    '<span id="' + esc(id) + '-value" class="choice-value">' + esc(selected.label) + '</span>' + icon("chevron","choice-chevron") + '</button>' +
    '<div class="choice-menu" role="listbox" aria-label="' + esc(label) + '" hidden>' +
    items.map(function(item){return '<button type="button" role="option" class="choice-option" data-choice-option data-value="' + esc(item.value) + '" aria-selected="' + (String(item.value) === String(value) ? "true" : "false") + '">' + esc(item.label) + (String(item.value) === String(value) ? icon("check","option-check") : "") + '</button>';}).join("") +
    '</div></div>';
}
function toast(message) {
  const el=document.getElementById("toast");
  el.textContent=message; el.classList.add("show");
  clearTimeout(toastTimer); toastTimer=setTimeout(function(){el.classList.remove("show");},3500);
}
async function api(path,method,data,type) {
  const opts={method:method || "GET"};
  if(data !== undefined) {
    opts.body=type === "raw" ? data : JSON.stringify(data);
    opts.headers={"Content-Type":type === "raw" ? "text/plain" : "application/json"};
  }
  const res=await fetch("/api/"+path,opts);
  const value=await res.json().catch(function(){return {error:"The server returned an invalid response."};});
  if(!res.ok) throw new Error(value.error || "The request could not be completed.");
  return value;
}
function heading(title,subtitle,actions) {
  return '<header class="page-head"><div><h1>' + esc(title) + '</h1><p class="subtitle">' + esc(subtitle) + '</p></div>' + (actions || "") + '</header>';
}
function empty(title,description,action) {
  return '<section class="empty"><div class="empty-mark" aria-hidden="true">' + icon("cards") + '</div><h2>' + esc(title) + '</h2><p>' + esc(description) + '</p>' + (action || "") + '</section>';
}
function deckOptions(allLabel) {
  return [{value:"",label:allLabel}].concat(state.decks.map(function(d){return {value:d.id,label:d.name};}));
}
function tagOptions() {
  return [{value:"",label:"All tags"}].concat(state.tags.map(function(t){return {value:t.id,label:t.name};}));
}
async function refresh() {
  state=await api("state");
  const count=state.cards.filter(function(c){return c.due_at <= state.now;}).length;
  document.getElementById("nav-count").textContent=count || "";
  await render();
}
function setView(next) {
  view=next; study=null; closeChoices();
  document.querySelectorAll(".nav-item").forEach(function(b){
    b.classList.toggle("active",b.dataset.view === view);
    if(b.dataset.view === view) b.setAttribute("aria-current","page"); else b.removeAttribute("aria-current");
  });
  render(); main.focus();
}
async function render() {
  const token=++renderVersion;
  try {
    if(view === "today") await renderToday(token);
    if(view === "library") renderLibrary();
    if(view === "insights") await renderInsights(token);
    if(view === "data") renderData();
  } catch(error) {
    if(token === renderVersion) main.innerHTML=empty("Unable to load this view",error.message,'<button class="button primary" data-action="retry">Try again</button>');
  }
}
async function renderToday(token) {
  if(study) {renderStudy();return;}
  const params=new URLSearchParams();
  if(filterDeck) params.set("deck",filterDeck);
  if(filterTag) params.set("tag",filterTag);
  const summary=await api("session"+(params.size ? "?"+params : ""));
  const todayStats=await api("stats");
  if(token !== renderVersion || view !== "today" || study) return;
  const count=summary.cards.length;
  const start=count ? '<button class="button light-action" data-action="start">' + icon("arrow") + 'Start review</button>' :
    state.cards.length ? '<span class="hero-rest">Nothing due right now</span>' : '<button class="button light-action" data-view-link="library">' + icon("plus") + 'Create your first deck</button>';
  const hero='<section class="today-hero"><div class="hero-copy"><p class="hero-date">' + esc(new Intl.DateTimeFormat(undefined,{weekday:"long",month:"long",day:"numeric"}).format(new Date(state.today+"T12:00:00"))) + '</p>' +
    '<h1>' + (count ? 'A little practice<br>goes a long way.' : 'You’re right on time.') + '</h1>' +
    '<p>' + (count ? count + ' card' + (count === 1 ? "" : "s") + ' ready for you. Pick up where your memory left off.' : state.cards.length ? 'Your next review is on its way. The work you’ve done is saved.' : 'Build your first deck, then come back for a short review.') + '</p>' +
    '<div class="hero-actions">' + start + (count ? '<span>' + summary.review_due + ' due · ' + summary.new + ' new</span>' : "") + '</div></div>' +
    '<div class="hero-art" aria-hidden="true"><div class="art-card art-back"></div><div class="art-card art-mid"></div><div class="art-card art-front"><div class="art-line short"></div><div class="art-line"></div><div class="art-line medium"></div><div class="art-mark">' + icon("spark") + '</div></div></div></section>';
  main.innerHTML=hero +
    '<section class="today-lower"><div class="today-main"><div class="section-heading"><div><h2>Your review space</h2><p>Choose what to focus on, then work through one card at a time.</p></div></div>' +
    '<div class="filter-row">' + choice("review-deck","Deck",deckOptions("All decks"),filterDeck) + choice("review-tag","Tag",tagOptions(),filterTag) + '</div>' +
    (count ? '<div class="queue-note">' + icon("clock") + '<span>' + summary.review_due + ' due reviews and ' + summary.new + ' new cards in this queue</span></div>' :
      empty(state.cards.length ? "Nothing in this queue" : "Your first card starts here",
        state.cards.length ? "Try another deck or tag, or return when the next review is due." : "A few cards are enough to begin building a memory habit.",
        state.cards.length ? "" : '<button class="button primary" data-view-link="library">Open library</button>')) +
    '</div><aside class="daily-aside"><div class="daily-fact"><span>Reviewed today</span><strong>' + todayStats.reviewed_today + '</strong></div><div class="daily-fact"><span>Current streak</span><strong>' + todayStats.streak + ' <small>day' + (todayStats.streak === 1 ? "" : "s") + '</small></strong></div><p>Each return makes the next one easier.</p></aside></section>';
}
function nextHint(card,rating) {
  if(rating === "Again") return "10 min";
  const due=card.review_options && card.review_options[rating];
  if(!due) return "";
  const today=new Date(state.today+"T12:00:00");
  const date=new Date(due.slice(0,10)+"T12:00:00");
  const days=Math.round((date-today)/86400000);
  return days === 1 ? "Tomorrow" : "In "+days+" days";
}
function renderStudy() {
  const total=study.cards.length;
  if(studyIndex >= total) {
    const remembered=studyResults.filter(function(r){return r.rating !== "Again";}).length;
    const next=studyResults.map(function(r){return r.due_at;}).sort()[0];
    const nextDate=next ? new Date(next) : null;
    const dateOptions=nextDate && (nextDate.getHours() || nextDate.getMinutes()) ? {weekday:"long",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"} : {weekday:"long",month:"short",day:"numeric"};
    const when=nextDate ? new Intl.DateTimeFormat(undefined,dateOptions).format(nextDate) : "No cards scheduled";
    main.innerHTML='<div class="completion"><div class="completion-mark" aria-hidden="true">' + icon("spark") + '</div><p class="completion-kicker">Session complete</p><h1>Good work showing up.</h1><p class="completion-intro">Your cards have their next return date. You can leave the rest to Recall.</p>' +
      '<div class="completion-receipt"><div><strong>' + total + '</strong><span>card' + (total === 1 ? '' : 's') + ' reviewed</span></div><div><strong>' + remembered + '</strong><span>remembered</span></div><div class="completion-next">' + icon("clock") + '<span><small>Next card returns</small><strong>' + esc(when) + '</strong></span></div></div>' +
      '<button class="button primary" data-action="finish">Return to today' + icon("arrow") + '</button></div>';
    return;
  }
  const card=study.cards[studyIndex];
  const pct=Math.round(100*studyIndex/total);
  const ratings=[["Again","again","rotate"],["Hard","hard","mountain"],["Good","good","rise"],["Easy","easy","sun"]];
  main.innerHTML='<div class="study-shell"><div class="study-top"><button class="button text-action" data-action="exit-study">Leave session</button><span>' + (studyIndex+1) + ' of ' + total + '</span></div>' +
    '<div class="progress" role="progressbar" aria-label="Session progress" aria-valuenow="' + studyIndex + '" aria-valuemax="' + total + '"><span style="width:' + pct + '%"></span></div>' +
    '<div class="study-deck">' + esc(card.deck_name) + '</div><div class="study-card ' + (revealed ? "is-revealed" : "") + '"><div class="study-card-top"><span>' + (revealed ? "Answer" : "Question") + '</span><span class="study-card-symbol" aria-hidden="true">' + icon("cards") + '</span></div>' +
    '<div class="study-question">' + esc(card.front) + '</div>' +
    (revealed ? '<div class="study-answer">' + esc(card.back) + '</div>' : '<div class="study-card-bottom"><span>Bring the answer to mind before turning the card.</span><button class="button primary" data-action="reveal">Reveal answer</button></div>') + '</div>' +
    (revealed ? '<div class="rating-title"><h2>How well did you remember?</h2><p>Your answer sets the next review.</p></div><div class="rating-row">' + ratings.map(function(r,i){return '<button class="rating ' + r[1] + '" data-rating="' + r[0] + '" aria-label="' + esc(r[0]) + ', next review ' + nextHint(card,r[0]) + ', shortcut ' + (i+1) + '"><span class="rating-icon" aria-hidden="true">' + icon(r[2]) + '</span><span class="rating-copy"><strong>' + esc(r[0]) + '</strong><small>' + nextHint(card,r[0]) + '</small></span><kbd>' + (i+1) + '</kbd></button>';}).join("") + '</div>' :
      '<p class="study-hint">Press Space to reveal the answer.</p>') + '</div>';
}
function libraryCards() {
  const query=search.trim().toLowerCase();
  return state.cards.filter(function(c){return (!selectedDeck || c.deck_id === selectedDeck) &&
    (!query || c.front.toLowerCase().includes(query) || c.back.toLowerCase().includes(query) ||
      c.tags.some(function(t){return t.name.toLowerCase().includes(query);}));});
}
function cardRows() {
  const found=libraryCards();
  if(!found.length) return empty("No cards here yet",search ? "Try another word or tag." : "Add a card to give this deck its first question.",
    '<button class="button primary" data-action="new-card">Add card</button>');
  return '<div class="card-list">' + found.map(function(c){return '<article class="card-row"><div class="card-content"><div class="card-row-top"><span class="card-deck">' + esc(c.deck_name) + '</span><span class="card-due">' + (c.review_count ? "Due "+dateLabel(c.due_at) : "New card") + '</span></div><h3>' + esc(c.front) + '</h3><p>' + esc(c.back) + '</p><div class="row-tags">' +
    c.tags.map(function(t){return '<span class="tag">' + esc(t.name) + '</span>';}).join("") + '</div></div><div class="row-actions"><button class="small-action" data-action="edit-card" data-id="' + c.id + '">Edit</button><button class="small-action danger-text" data-action="delete-card" data-id="' + c.id + '">Delete</button></div></article>';}).join("") + '</div>';
}
function renderLibrary() {
  const deck=state.decks.find(function(d){return d.id === selectedDeck;});
  const decks='<div class="deck-list"><button class="deck-tile ' + (!selectedDeck ? "selected" : "") + '" data-action="select-deck" data-id="0"><span>All cards</span><small>' + state.cards.length + '</small></button>' +
    state.decks.map(function(d){const count=state.cards.filter(function(c){return c.deck_id === d.id;}).length;
      return '<button class="deck-tile ' + (selectedDeck === d.id ? "selected" : "") + '" data-action="select-deck" data-id="' + d.id + '"><span>' + esc(d.name) + '</span><small>' + count + '</small></button>';}).join("") + '</div>';
  const tags='<div class="section-heading"><div><h2>Tags</h2><p>Organize ideas across decks.</p></div><button class="button subtle" data-action="new-tag">' + icon("plus") + 'New tag</button></div><div class="tag-manager">' +
    (state.tags.length ? state.tags.map(function(t){return '<div class="tag-manage"><span class="tag">' + esc(t.name) + '</span><button class="small-action" data-action="edit-tag" data-id="' + t.id + '" aria-label="Rename ' + esc(t.name) + '">Rename</button><button class="small-action danger-text" data-action="delete-tag" data-id="' + t.id + '" aria-label="Delete ' + esc(t.name) + '">Delete</button></div>';}).join("") : '<p class="muted">No tags yet. Add one when a theme starts to emerge.</p>') + '</div>';
  main.innerHTML=heading("Your library","A home for everything you want to keep.",
    '<div class="page-actions"><button class="button subtle" data-action="new-deck">' + icon("plus") + 'New deck</button><button class="button primary" data-action="new-card"' + (!state.decks.length ? " disabled" : "") + '>' + icon("plus") + 'Add card</button></div>') +
    '<div class="library-layout"><aside class="deck-rail"><div class="rail-heading">Decks</div>' + decks + '</aside><section class="library-main"><div class="library-main-head"><div><h2>' + (deck ? esc(deck.name) : "All cards") + '</h2><span>' + libraryCards().length + ' card' + (libraryCards().length === 1 ? "" : "s") + '</span></div><div class="row-actions">' +
    (deck ? '<button class="small-action" data-action="edit-deck" data-id="' + deck.id + '">Edit deck</button><button class="small-action danger-text" data-action="delete-deck" data-id="' + deck.id + '">Delete deck</button>' : "") + '</div></div>' +
    '<div class="search-field">' + icon("search") + '<input aria-label="Search cards" id="card-search" name="card-search" type="text" inputmode="search" autocomplete="off" placeholder="Search front, back, or tag…" value="' + esc(search) + '"><button type="button" class="search-clear" data-action="clear-search" aria-label="Clear search"' + (!search ? " hidden" : "") + '>' + icon("close") + '</button></div><div id="card-results">' + cardRows() + '</div></section></div>' +
    '<section class="tags-section">' + tags + '</section>';
  document.getElementById("card-search").oninput=function(e){search=e.target.value;document.getElementById("card-results").innerHTML=cardRows();document.querySelector(".search-clear").hidden=!search;};
}
async function renderInsights(token) {
  const s=await api("stats");
  if(token !== renderVersion || view !== "insights") return;
  const start=new Date(state.today+"T12:00:00");
  const seven=Array.from({length:7},function(_,i){const d=new Date(start);d.setDate(d.getDate()+i);
    const key=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
    return {label:i === 0 ? "Today" : new Intl.DateTimeFormat(undefined,{weekday:"short"}).format(d),
      count:(s.due_next_7_days.find(function(x){return x.day === key;}) || {}).count || 0};});
  const max=Math.max(1,...seven.map(function(x){return x.count;}));
  main.innerHTML=heading("Your progress","See what you’ve kept and what comes next.") +
    '<div class="insight-band"><div><i aria-hidden="true">' + icon("cards") + '</i><span>Cards in your library</span><strong>' + s.total_cards + '</strong></div><div><i aria-hidden="true">' + icon("check") + '</i><span>Reviewed today</span><strong>' + s.reviewed_today + '</strong></div><div><i aria-hidden="true">' + icon("rise") + '</i><span>Learned</span><strong>' + s.learned + '</strong></div><div><i aria-hidden="true">' + icon("spark") + '</i><span>Daily streak</span><strong>' + s.streak + '<small>' + (s.streak === 1 ? 'day' : 'days') + '</small></strong></div></div>' +
    '<section class="insight-section"><div class="section-heading"><div><h2>The next seven days</h2><p>Cards already scheduled to come back.</p></div></div><div class="bars">' +
    seven.map(function(x){return '<div class="bar-row"><span>' + esc(x.label) + '</span><div class="bar-track"><b style="width:' + Math.max(x.count ? 8 : 0,Math.round(100*x.count/max)) + '%"></b></div><strong>' + x.count + '</strong></div>';}).join("") + '</div></section>' +
    '<section class="insight-section"><div class="section-heading"><div><h2>By deck</h2><p>Retention counts reviews remembered as Hard, Good, or Easy.</p></div></div>' +
    (s.decks.length ? '<div class="deck-stats-head"><span>Deck</span><span>Cards</span><span>Learned</span><span>Retention</span></div>' +
      s.decks.map(function(d){return '<div class="deck-stat"><strong>' + esc(d.name) + '</strong><span>' + d.cards + '</span><span>' + d.learned + '</span><span>' + (d.retention == null ? "—" : d.retention+"%") + '</span></div>';}).join("") :
      empty("No deck statistics yet","Add a deck and review a few cards to see how your practice grows.",'<button class="button primary" data-view-link="library">Open library</button>')) + '</section>';
}
function fileZone(kind,file) {
  return '<button type="button" class="upload-zone" data-action="pick-' + kind + '" data-drop="' + kind + '"><div class="upload-symbol">' + icon("upload") + '</div><div><strong>' + (file ? esc(file.name) : kind === "csv" ? "Choose a CSV file" : "Choose a JSON backup") + '</strong><span>' + (file ? "Ready to " + (kind === "csv" ? "import" : "restore") : "Browse or drop a file here") + '</span></div><span class="browse-pill">Browse</span></button><input class="hidden-file" type="file" id="' + kind + '-file" accept="' + (kind === "csv" ? ".csv,text/csv" : ".json,application/json") + '" tabindex="-1" aria-hidden="true">';
}
function renderData() {
  main.innerHTML=heading("Backup & import","Your cards are yours to keep, move, and restore.") +
    '<section class="backup-hero"><div><div class="backup-icon">' + icon("shield") + '</div><h2>Keep a copy of your learning.</h2><p>One JSON file holds your decks, cards, tags, schedules, and review history.</p></div><div class="backup-hero-action"><span>' + state.cards.length + ' card' + (state.cards.length === 1 ? '' : 's') + ' in this collection</span><button class="button light-action" data-action="export-json-full">' + icon("download") + 'Download full backup</button></div></section>' +
    '<div class="data-grid"><section class="data-section"><div class="section-heading"><div><h2>Bring in cards</h2><p>Import questions and answers from a CSV file.</p></div></div>' +
    fileZone("csv",csvFile) + '<p class="helper-text">Use front and back columns. Deck and tags are optional. Separate tags with commas in a quoted cell.</p>' +
    '<button class="button primary" data-action="import-csv"' + (!csvFile ? " disabled" : "") + '>Import cards</button></section>' +
    '<section class="data-section"><div class="section-heading"><div><h2>Share a deck</h2><p>Export card text and tags as a CSV file.</p></div></div>' +
    choice("export-deck","Collection",deckOptions("Everything"),exportDeck) +
    '<button class="button secondary" data-action="export-csv">' + icon("download") + 'Download CSV</button></section></div>' +
    '<section class="restore-section"><div class="section-heading"><div><h2>Restore from a backup</h2><p>Return your entire collection to a saved point in time.</p></div></div>' +
    '<div class="restore-layout"><div>' + fileZone("json",jsonFile) + '<p class="helper-text">Restoring replaces every current deck, card, tag, and review. Download a full backup first if you need to keep this version.</p></div>' +
    '<button class="button outline-danger" data-action="import-json"' + (!jsonFile ? " disabled" : "") + '>Restore backup</button></div></section>';
  document.querySelectorAll(".hidden-file").forEach(function(input){input.onchange=function(){setFile(input.id.startsWith("csv") ? "csv" : "json",input.files[0]);};});
  document.querySelectorAll("[data-drop]").forEach(function(zone){
    zone.ondragover=function(e){e.preventDefault();zone.classList.add("dragging");};
    zone.ondragleave=function(){zone.classList.remove("dragging");};
    zone.ondrop=function(e){e.preventDefault();zone.classList.remove("dragging");setFile(zone.dataset.drop,e.dataTransfer.files[0]);};
  });
}
function setFile(kind,file) {
  if(!file) return;
  const extension=kind === "csv" ? ".csv" : ".json";
  if(!file.name.toLowerCase().endsWith(extension)) {toast("Choose a "+extension+" file.");return;}
  if(kind === "csv") csvFile=file; else jsonFile=file;
  renderData();
}
function openEditor(kind,id) {
  editing={kind:kind,id:id || null};
  const current=kind === "card" ? state.cards.find(function(x){return x.id === id;}) :
    kind === "deck" ? state.decks.find(function(x){return x.id === id;}) : state.tags.find(function(x){return x.id === id;});
  editorDeck=current && kind === "card" ? current.deck_id : selectedDeck;
  editorTagIds=new Set(current && kind === "card" ? current.tags.map(function(t){return t.id;}) : []);
  document.getElementById("dialog-title").textContent=(id ? "Edit " : "New ")+kind;
  const saveButton=document.querySelector("#editor .dialog-actions .primary");
  saveButton.disabled=false;
  saveButton.textContent=id ? "Save changes" : "Create "+kind;
  if(kind === "deck") fields.innerHTML='<label class="field">Name<input name="name" autocomplete="off" maxlength="100" value="' + esc(current && current.name) + '" placeholder="e.g. Spanish vocabulary…"></label><label class="field">Description<textarea name="description" placeholder="What belongs in this deck?…">' + esc(current && current.description) + '</textarea></label>';
  if(kind === "tag") fields.innerHTML='<label class="field">Name<input name="name" autocomplete="off" maxlength="80" value="' + esc(current && current.name) + '" placeholder="e.g. Exam prep…"></label>';
  if(kind === "card") fields.innerHTML=choice("editor-deck","Deck",deckOptions("Choose a deck"),editorDeck) +
    '<label class="field">Front<textarea name="front" placeholder="What do you want to remember?…">' + esc(current && current.front) + '</textarea></label>' +
    '<label class="field">Back<textarea name="back" placeholder="Write the answer here…">' + esc(current && current.back) + '</textarea></label>' +
    '<div class="field"><span>Tags</span><div class="tag-choice-list">' + (state.tags.length ? state.tags.map(function(t){const selected=editorTagIds.has(t.id);
      return '<button type="button" class="tag-choice ' + (selected ? "selected" : "") + '" data-tag-choice="' + t.id + '" aria-pressed="' + selected + '">' + (selected ? icon("check") : icon("plus")) + esc(t.name) + '</button>';}).join("") :
      '<span class="muted">Add tags from the library when you need them.</span>') + '</div></div>';
  fields.innerHTML+='<p id="editor-error" class="form-error" role="alert" hidden></p>';
  dialog.showModal();
  const first=fields.querySelector("input,textarea,.choice-trigger");
  if(first) first.focus();
}
function editorError(message,element) {
  const error=document.getElementById("editor-error");
  error.textContent=message; error.hidden=false;
  if(element) element.focus();
}
form.noValidate=true;
form.onsubmit=async function(e) {
  e.preventDefault();
  const data=new FormData(form),kind=editing.kind;
  if(kind === "card" && !editorDeck) return editorError("Choose a deck for this card.",document.querySelector("#editor-deck .choice-trigger"));
  if(kind === "card" && !String(data.get("front") || "").trim()) return editorError("Write the front of the card.",fields.querySelector('[name="front"]'));
  if(kind === "card" && !String(data.get("back") || "").trim()) return editorError("Write the answer on the back.",fields.querySelector('[name="back"]'));
  if(kind !== "card" && !String(data.get("name") || "").trim()) return editorError("Give this "+kind+" a name.",fields.querySelector('[name="name"]'));
  const payload=kind === "card" ? {deck_id:editorDeck,front:data.get("front"),back:data.get("back"),tag_ids:[...editorTagIds]} :
    kind === "deck" ? {name:data.get("name"),description:data.get("description")} : {name:data.get("name")};
  const save=form.querySelector('[type="submit"]');
  save.disabled=true;save.textContent="Saving…";
  try {
    await api(kind+"s"+(editing.id ? "/"+editing.id : ""),editing.id ? "PATCH" : "POST",payload);
    dialog.close();toast((editing.id ? "Updated " : "Created ")+kind+".");
    await refresh();
  } catch(error) {editorError(error.message);save.disabled=false;save.textContent=editing.id ? "Save changes" : "Create "+kind;}
};
function askConfirm(title,copy,label) {
  document.getElementById("confirm-title").textContent=title;
  document.getElementById("confirm-copy").textContent=copy;
  document.getElementById("confirm-accept").textContent=label;
  confirmDialog.showModal();
  return new Promise(function(resolve){
    let settled=false;
    function onCancel(e){e.preventDefault();finish(false);}
    function finish(value){
      if(settled)return;
      settled=true;
      confirmDialog.removeEventListener("cancel",onCancel);
      confirmDialog.close();
      resolve(value);
    }
    document.getElementById("confirm-cancel").onclick=function(){finish(false);};
    document.getElementById("confirm-accept").onclick=function(){finish(true);};
    confirmDialog.addEventListener("cancel",onCancel);
  });
}
function closeChoices() {
  document.querySelectorAll(".choice-menu").forEach(function(menu){menu.hidden=true;menu.closest(".choice").querySelector(".choice-trigger").setAttribute("aria-expanded","false");});
}
document.addEventListener("click",function(e) {
  const trigger=e.target.closest("[data-choice-trigger]");
  const option=e.target.closest("[data-choice-option]");
  if(trigger) {
    const choiceEl=trigger.closest(".choice"),menu=choiceEl.querySelector(".choice-menu"),wasOpen=!menu.hidden;
    closeChoices();
    if(!wasOpen){menu.hidden=false;trigger.setAttribute("aria-expanded","true");menu.querySelector('[aria-selected="true"]')?.focus();}
    return;
  }
  if(option) {
    const choiceEl=option.closest(".choice"),value=option.dataset.value;
    choiceEl.dataset.value=value;
    choiceEl.querySelector(".choice-value").textContent=option.textContent.trim();
    choiceEl.querySelectorAll("[data-choice-option]").forEach(function(el){el.setAttribute("aria-selected",el === option ? "true" : "false");el.querySelector(".option-check")?.remove();});
    option.insertAdjacentHTML("beforeend",icon("check","option-check"));
    closeChoices();choiceEl.querySelector(".choice-trigger").focus();
    if(choiceEl.id === "review-deck"){
      filterDeck=Number(value)||0;
      render().then(function(){if(view === "today")document.querySelector("#review-deck .choice-trigger")?.focus();});
    }
    if(choiceEl.id === "review-tag"){
      filterTag=Number(value)||0;
      render().then(function(){if(view === "today")document.querySelector("#review-tag .choice-trigger")?.focus();});
    }
    if(choiceEl.id === "export-deck") exportDeck=Number(value)||0;
    if(choiceEl.id === "editor-deck") editorDeck=Number(value)||0;
    return;
  }
  if(!e.target.closest(".choice")) closeChoices();
});
document.addEventListener("keydown",function(e) {
  const choiceEl=document.activeElement.closest(".choice");
  if(choiceEl && ["ArrowDown","ArrowUp","Home","End","Escape"].includes(e.key)) {
    const trigger=choiceEl.querySelector(".choice-trigger"),menu=choiceEl.querySelector(".choice-menu");
    const options=[...menu.querySelectorAll("[data-choice-option]")];
    if(e.key === "Escape"){e.preventDefault();closeChoices();trigger.focus();return;}
    e.preventDefault();
    if(menu.hidden){trigger.click();return;}
    let index=options.indexOf(document.activeElement);
    if(e.key === "Home") index=0; else if(e.key === "End") index=options.length-1;
    else index=(index+(e.key === "ArrowDown" ? 1 : -1)+options.length)%options.length;
    options[index].focus();return;
  }
  if(!study || dialog.open || confirmDialog.open ||
     document.activeElement.closest("button,a,input,textarea,select,[role=button],[contenteditable=true]")) return;
  if(!revealed && e.code === "Space"){e.preventDefault();document.querySelector("[data-action=reveal]")?.click();}
  else if(revealed && ["1","2","3","4"].includes(e.key)){e.preventDefault();document.querySelector('[data-rating="'+["Again","Hard","Good","Easy"][Number(e.key)-1]+'"]')?.click();}
});
document.getElementById("close-dialog").onclick=function(){dialog.close();};
document.getElementById("cancel-dialog").onclick=function(){dialog.close();};
document.querySelectorAll(".nav-item").forEach(function(b){b.onclick=function(){setView(b.dataset.view);};});
main.onclick=async function(e) {
  const node=e.target.closest("[data-action],[data-view-link],[data-rating],[data-tag-choice]");
  if(!node)return;
  if(node.dataset.viewLink){setView(node.dataset.viewLink);return;}
  const action=node.dataset.action,id=Number(node.dataset.id);
  try {
    if(action === "retry"){await refresh();return;}
    if(action === "new-deck")return openEditor("deck");
    if(action === "edit-deck")return openEditor("deck",id);
    if(action === "new-card")return openEditor("card");
    if(action === "edit-card")return openEditor("card",id);
    if(action === "new-tag")return openEditor("tag");
    if(action === "edit-tag")return openEditor("tag",id);
    if(action === "select-deck"){selectedDeck=id;renderLibrary();return;}
    if(action === "clear-search"){search="";renderLibrary();document.getElementById("card-search").focus();return;}
    if(action === "delete-deck"){
      const d=state.decks.find(function(x){return x.id === id;});
      const count=state.cards.filter(function(c){return c.deck_id === id;}).length;
      if(!await askConfirm("Delete "+d.name+"?","This removes "+count+" card"+(count === 1 ? "" : "s")+" and their review history. Other decks stay intact.","Delete deck"))return;
      await api("decks/"+id,"DELETE");selectedDeck=0;toast("Deck deleted.");await refresh();return;
    }
    if(action === "delete-card"){
      if(!await askConfirm("Delete this card?","Its review history will be removed too.","Delete card"))return;
      await api("cards/"+id,"DELETE");toast("Card deleted.");await refresh();return;
    }
    if(action === "delete-tag"){
      if(!await askConfirm("Delete this tag?","Cards with this tag will stay in your library.","Delete tag"))return;
      await api("tags/"+id,"DELETE");toast("Tag deleted.");await refresh();return;
    }
    if(action === "start"){
      const params=new URLSearchParams();if(filterDeck)params.set("deck",filterDeck);if(filterTag)params.set("tag",filterTag);
      study=await api("session"+(params.size ? "?"+params : ""));
      studyIndex=0;studyResults=[];revealed=false;startedAt=Date.now();renderStudy();return;
    }
    if(action === "reveal"){revealed=true;renderStudy();return;}
    if(node.dataset.rating){
      if(!revealed || !study)return;
      const result=await api("review","POST",{card_id:study.cards[studyIndex].id,rating:node.dataset.rating,seconds:Math.max(0,Math.round((Date.now()-startedAt)/1000))});
      studyResults.push({rating:node.dataset.rating,due_at:result.due_at});
      studyIndex++;revealed=false;startedAt=Date.now();renderStudy();
      if(studyIndex < study.cards.length) toast(result.interval_days ? "Next review in "+result.interval_days+" day"+(result.interval_days === 1 ? "" : "s")+".":"Back in 10 minutes.");
      return;
    }
    if(action === "finish" || action === "exit-study"){study=null;await refresh();return;}
    if(action === "export-csv" || action === "export-json-full"){
      const suffix=action === "export-csv" && exportDeck ? "?deck="+encodeURIComponent(exportDeck) : "";
      window.location.href="/api/"+(action === "export-csv" ? "export-csv" : "export-json")+suffix;return;
    }
    if(action === "pick-csv" || action === "pick-json"){document.getElementById(action === "pick-csv" ? "csv-file" : "json-file").click();return;}
    if(action === "import-csv"){
      if(!csvFile)throw new Error("Choose a CSV file first.");
      const result=await api("import-csv","POST",await csvFile.text(),"raw");
      csvFile=null;toast("Imported "+result.cards+" cards.");await refresh();return;
    }
    if(action === "import-json"){
      if(!jsonFile)throw new Error("Choose a JSON backup first.");
      if(!await askConfirm("Restore this backup?","Every current deck, card, tag, schedule, and review will be replaced.","Restore backup"))return;
      const result=await api("import-json","POST",JSON.parse(await jsonFile.text()));
      jsonFile=null;toast("Restored "+result.cards+" cards.");await refresh();return;
    }
  } catch(error){toast(error.message);}
};
dialog.addEventListener("click",function(e){
  const tag=e.target.closest("[data-tag-choice]");
  if(!tag)return;
  const id=Number(tag.dataset.tagChoice);
  if(editorTagIds.has(id))editorTagIds.delete(id);else editorTagIds.add(id);
  const selected=editorTagIds.has(id);tag.classList.toggle("selected",selected);
  tag.setAttribute("aria-pressed",String(selected));
  tag.querySelector("svg")?.remove();
  tag.insertAdjacentHTML("afterbegin",icon(selected ? "check" : "plus"));
});
refresh().catch(function(error){main.innerHTML=empty("Unable to load your cards",error.message,'<button class="button primary" data-action="retry">Try again</button>');});
