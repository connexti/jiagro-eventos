// ============================================================
// CORE SHELL — generic app infrastructure shared by every category:
// Supabase client/config, splash screen + category nav, the admin PIN
// gate, the composable admin panel (each category contributes its own
// admin tab(s) via its adminTabs list), and the generic confirm/alert
// dialog. Nothing in here knows about events/items/CSV/etc. — that's
// category-specific and lives in js/categories/*.js.
// ============================================================

// ============================================================
// SETUP — fill these in before deploying.
// 1. Create a free project at https://supabase.com
// 2. In the SQL Editor, run the contents of supabase_schema.sql
// 3. Project Settings > API: copy "Project URL" and the "anon public" key
// ============================================================
export var SUPABASE_URL = "https://paelujytnfhgcayvvjjz.supabase.co";
export var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZWx1anl0bmZoZ2NheXZ2amp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2MjM4NTEsImV4cCI6MjEwNzE5OTg1MX0.Q9ibKm-YFFByyDzx-WO6hIow6Dz0vql2kYAle5G5c0E";

// Change this to set your own admin PIN (this is a soft UI gate, not
// real security — anyone who reads this file's source can see it).
export var ADMIN_PIN = "2026";
// ============================================================

export var $ = function(id){ return document.getElementById(id); };

export var CONFIGURED = SUPABASE_URL.indexOf("YOUR-PROJECT") === -1 && SUPABASE_ANON_KEY.indexOf("YOUR-ANON-PUBLIC-KEY") === -1;
export var sb = CONFIGURED ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

export function fmtMoney(n){
  var v = Number(n);
  if(!isFinite(v)) v = 0;
  return v.toLocaleString("pt-PT",{minimumFractionDigits:2, maximumFractionDigits:2}) + " €";
}
export function fmtDate(s){
  if(!s) return "—";
  var parts = String(s).slice(0,10).split("-");
  if(parts.length !== 3) return s;
  return parts[2] + "/" + parts[1] + "/" + parts[0];
}
export function esc(s){
  return String(s==null?"":s).replace(/[&<>"']/g, function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
  });
}

// Shell-only state. Category-specific data (events/items/settings/the
// currently open event, etc.) lives inside each category module instead.
var state = {
  currentCategory: null,
  adminUnlocked: false,
  pendingAfterUnlock: null
};
try{ state.adminUnlocked = sessionStorage.getItem("jiAdminUnlocked") === "1"; }catch(e){}

// The splash screen's disabled placeholder — not a real category module,
// just a UI filler showing more categories are coming.
var PLACEHOLDER_CATEGORIES = [
  { key:"soon", label:"Em breve", description:"Novas categorias de gestão vão aparecer aqui.", icon:"✨", enabled:false }
];

var categoryModules = [];
var activeAdminTabKey = null;

function getActiveCategory(){
  return categoryModules.filter(function(c){ return c.meta.key === state.currentCategory; })[0];
}

// ---------- navigation ----------
function openCategory(key){
  state.currentCategory = key;
  var cat = getActiveCategory();
  if(CONFIGURED && cat && cat.onOpen) cat.onOpen();
  render();
}
function goCategories(){
  var cat = getActiveCategory();
  if(cat && cat.onClose) cat.onClose();
  state.currentCategory = null;
  render();
}
// Each category's handleBack() should mutate its own nav state and
// re-render itself (it has `render` from this module for that), returning
// true once it has handled a back-step. Returning false/undefined lets
// core pop back out to the splash screen.
function handleBack(){
  var cat = getActiveCategory();
  if(cat && cat.handleBack && cat.handleBack()){ return; }
  goCategories();
}
$("btnBack").addEventListener("click", handleBack);

// ---------- rendering ----------
export function render(){
  var main = $("main");
  $("btnBack").hidden = !state.currentCategory;

  if(!state.currentCategory){
    renderSplash(main);
    $("pageTitle").textContent = "Associação de Pais";
    $("pageSubtitle").textContent = "Ferramentas de gestão da associação";
  }else{
    var cat = getActiveCategory();
    if(!CONFIGURED){
      main.innerHTML =
        '<div class="config-warning">'+
        '<strong>Configuração necessária.</strong> Este painel ainda não está ligado a uma base de dados partilhada. '+
        'Abra <code>js/core.js</code>, siga os passos no topo do ficheiro para criar um projeto Supabase gratuito, e preencha '+
        '<code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code> com os valores do seu projeto.'+
        '</div>';
      $("pageTitle").textContent = cat ? cat.meta.label : "Associação de Pais";
      $("pageSubtitle").textContent = "Associação de Pais";
    }else if(cat){
      cat.render(main);
    }
  }
  renderAdminPanel();
}

// The category splash screen — always reachable regardless of Supabase
// connectivity, since picking a category needs no data of its own.
function renderSplash(main){
  var cards = categoryModules.map(function(c){
    return { key:c.meta.key, label:c.meta.label, description:c.meta.description, icon:c.meta.icon, enabled:true };
  }).concat(PLACEHOLDER_CATEGORIES);

  var html = '<div class="splash">'+
    '<div class="splash-hero">'+
      '<img class="splash-logo" src="img/AP-ji-agro.png" alt="APEJI AGRO — Associação de Pais do Jardim de Infância do Agro">'+
      '<h2>O que quer gerir?</h2>'+
      '<p>Escolha uma categoria para continuar.</p>'+
    '</div><div class="grid-categories">';
  cards.forEach(function(c){
    html += '<button type="button" class="card-category'+(c.enabled?'':' disabled')+'"'+
      (c.enabled ? (' data-open-category="'+esc(c.key)+'"') : ' disabled')+'>'+
      (!c.enabled ? '<span class="badge soon">Em breve</span>' : '')+
      '<span class="card-category-icon">'+c.icon+'</span>'+
      '<h3>'+esc(c.label)+'</h3>'+
      '<p>'+esc(c.description)+'</p>'+
      '</button>';
  });
  html += '</div></div>';
  main.innerHTML = html;
  main.querySelectorAll("[data-open-category]").forEach(function(btn){
    btn.addEventListener("click", function(){ openCategory(btn.getAttribute("data-open-category")); });
  });
}

// ---------- confirm dialog ----------
// Generic confirm/alert dialog. opts.confirmLabel/confirmClass let callers
// other than "delete this" (e.g. CSV import) reuse it with non-danger
// wording instead of the default "Remover" button.
var pendingConfirm = null;
export function openConfirm(title, msg, onYes, opts){
  opts = opts || {};
  $("confirmTitle").textContent = title;
  $("confirmMsg").textContent = msg;
  pendingConfirm = onYes;
  var yesBtn = $("btnConfirmYes");
  yesBtn.textContent = opts.confirmLabel || "Remover";
  yesBtn.className = "btn " + (opts.confirmClass || "danger");
  $("dlgConfirm").showModal();
}
$("btnConfirmYes").addEventListener("click", function(){
  var fn = pendingConfirm;
  pendingConfirm = null;
  $("dlgConfirm").close();
  if(fn) fn();
});

export function alertInline(msg){
  openConfirm("Aviso", msg, null);
  $("btnConfirmYes").hidden = true;
  var restore = function(){ $("btnConfirmYes").hidden = false; };
  $("dlgConfirm").addEventListener("close", restore, {once:true});
}

// ---------- admin ----------
export function requireAdmin(cb){
  if(state.adminUnlocked){ cb(); return; }
  state.pendingAfterUnlock = cb;
  openAdminDialog();
}
function openAdminDialog(){
  $("adminPinView").hidden = state.adminUnlocked;
  $("adminPanelView").hidden = !state.adminUnlocked;
  $("btnLockAdmin").hidden = !state.adminUnlocked;
  $("btnAdmin").classList.toggle("unlocked", state.adminUnlocked);
  if(!state.adminUnlocked){
    var digits = document.querySelectorAll(".pindigit");
    digits.forEach(function(d){ d.value = ""; });
    $("pinError").textContent = "";
  }else{
    renderAdminPanel();
  }
  $("dlgAdmin").showModal();
  if(!state.adminUnlocked){
    document.querySelector(".pindigit").focus();
  }
}
$("btnAdmin").addEventListener("click", openAdminDialog);

var pinDigits = Array.prototype.slice.call(document.querySelectorAll(".pindigit"));
pinDigits.forEach(function(input, idx){
  input.addEventListener("input", function(){
    input.value = input.value.replace(/\D/g,"");
    if(input.value && idx < pinDigits.length-1) pinDigits[idx+1].focus();
  });
  input.addEventListener("keydown", function(e){
    if(e.key === "Backspace" && !input.value && idx>0) pinDigits[idx-1].focus();
  });
});
$("formPin").addEventListener("submit", function(e){
  e.preventDefault();
  var pin = pinDigits.map(function(d){ return d.value; }).join("");
  if(pin === ADMIN_PIN){
    state.adminUnlocked = true;
    try{ sessionStorage.setItem("jiAdminUnlocked","1"); }catch(err){}
    $("pinError").textContent = "";
    $("adminPinView").hidden = true;
    $("adminPanelView").hidden = false;
    $("btnLockAdmin").hidden = false;
    $("btnAdmin").classList.add("unlocked");
    renderAdminPanel();
    var pending = state.pendingAfterUnlock;
    state.pendingAfterUnlock = null;
    if(pending){
      $("dlgAdmin").close();
      pending();
    }
  }else{
    $("pinError").textContent = "PIN incorreto. Tente novamente.";
    pinDigits.forEach(function(d){ d.value = ""; });
    pinDigits[0].focus();
  }
});
$("btnLockAdmin").addEventListener("click", function(){
  state.adminUnlocked = false;
  try{ sessionStorage.removeItem("jiAdminUnlocked"); }catch(e){}
  $("btnAdmin").classList.remove("unlocked");
  $("dlgAdmin").close();
});

// Composable admin panel: collects adminTabs from every registered
// category module, renders the tab nav, and delegates the active tab's
// body to that tab's own render(container). Exported so a category can
// call it after an optimistic local update (e.g. right after adding/
// removing a "Tipo", before the Supabase round-trip resolves).
export function renderAdminPanel(){
  if(!state.adminUnlocked) return;

  var tabs = [];
  categoryModules.forEach(function(cat){
    (cat.adminTabs||[]).forEach(function(t){ tabs.push(t); });
  });

  if(!activeAdminTabKey || !tabs.some(function(t){ return t.key === activeAdminTabKey; })){
    activeAdminTabKey = tabs.length ? tabs[0].key : null;
  }

  var nav = $("adminTabsNav");
  nav.innerHTML = tabs.map(function(t){
    return '<button type="button" class="tab'+(t.key===activeAdminTabKey?' active':'')+'" data-admin-tab="'+esc(t.key)+'">'+esc(t.label)+'</button>';
  }).join("");
  nav.querySelectorAll("[data-admin-tab]").forEach(function(btn){
    btn.addEventListener("click", function(){
      activeAdminTabKey = btn.getAttribute("data-admin-tab");
      renderAdminPanel();
    });
  });

  var content = $("adminTabContent");
  content.innerHTML = "";
  var active = tabs.filter(function(t){ return t.key === activeAdminTabKey; })[0];
  if(active) active.render(content);
}

// ---------- dialog close wiring ----------
document.querySelectorAll("[data-close]").forEach(function(btn){
  btn.addEventListener("click", function(){ $(btn.getAttribute("data-close")).close(); });
});
document.querySelectorAll("dialog").forEach(function(dlg){
  dlg.addEventListener("click", function(e){ if(e.target === dlg) dlg.close(); });
});

// ---------- entry point ----------
export function init(mods){
  categoryModules = mods;
  render();
}
