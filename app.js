(function(){
  "use strict";

  // ============================================================
  // SETUP — fill these in before deploying.
  // 1. Create a free project at https://supabase.com
  // 2. In the SQL Editor, run the contents of supabase_schema.sql
  // 3. Project Settings > API: copy "Project URL" and the "anon public" key
  // ============================================================
  var SUPABASE_URL = "https://paelujytnfhgcayvvjjz.supabase.co";
  var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhZWx1anl0bmZoZ2NheXZ2amp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2MjM4NTEsImV4cCI6MjEwNzE5OTg1MX0.Q9ibKm-YFFByyDzx-WO6hIow6Dz0vql2kYAle5G5c0E";

  // Change this to set your own admin PIN (this is a soft UI gate, not
  // real security — anyone who reads this file's source can see it).
  var ADMIN_PIN = "2026";
  // ============================================================

  // ============================================================
  // INVENTORY COLUMNS — the single source of truth for the item form
  // and the inventory table. To add, remove, or edit a column, change
  // this array only; the form fields, table headers/cells, and the
  // object sent to Supabase are all generated from it.
  //
  // IMPORTANT: this does NOT change the database. Adding a column here
  // means you also need, once, in the Supabase SQL editor:
  //   alter table public.items add column <db_column> <type>;
  // and removing one means (optionally, to actually drop the data):
  //   alter table public.items drop column <db_column>;
  // Keep supabase_schema.sql in sync so a fresh setup matches.
  //
  // Field shape:
  //   key        camelCase name used in JS (state, mapItem, etc.)
  //   column     snake_case column name in the "items" table
  //   label      shown above the input in the add/edit form
  //   tableHeader  column header text in the inventory table (defaults to label)
  //   type       "text" | "number" | "currency" | "date" | "select"
  //   width      "full" or "half" — half-width fields pair up two per row
  //   required   whether the form field is required
  //   placeholder  optional input placeholder
  //   min / step   for "number" and "currency" inputs
  //   options()  for "select" only — function returning the current list of choices
  //   chip       for "select" only — render the table cell as a pill badge
  //   showInTable  set to false to keep a field in the form but hide it from the table
  // ============================================================
  var ITEM_FIELDS = [
    { key:"origem", column:"origem", label:"Origem Doação", type:"text", width:"full", required:true,
      placeholder:"Ex: Padaria Central, Família Silva…" },
    { key:"produto", column:"produto", label:"Produto", type:"text", width:"full", required:true,
      placeholder:"Ex: Caixas de sumo" },
    { key:"quantidade", column:"quantidade", label:"Quantidade", tableHeader:"Qtd.", type:"number",
      width:"half", required:true, min:0, step:1 },
    { key:"tipo", column:"tipo", label:"Tipo", type:"select", width:"half", chip:true,
      options:function(){ return state.settings.tipoOptions; } },
    { key:"dataEntrega", column:"data_entrega", label:"Data de entrega", tableHeader:"Entrega",
      type:"date", width:"half" },
    { key:"preco", column:"preco", label:"Preço (€)", tableHeader:"Preço", type:"currency",
      width:"half", min:0, step:0.01, placeholder:"0.00" }
  ];
  // ============================================================

  // The splash screen's category picker. "inventory" is the only wired-up
  // module today; add a new entry here (and a matching branch in render())
  // to ship another category — disabled entries render as "Em breve"
  // placeholders so the picker already shows it's built for more than one.
  var CATEGORIES = [
    { key:"inventory", label:"Inventário de Festas", description:"Doações e compras para cada festa do ano.", icon:"🎈", enabled:true },
    { key:"soon", label:"Em breve", description:"Novas categorias de gestão vão aparecer aqui.", icon:"✨", enabled:false }
  ];

  var $ = function(id){ return document.getElementById(id); };

  var CONFIGURED = SUPABASE_URL.indexOf("YOUR-PROJECT") === -1 && SUPABASE_ANON_KEY.indexOf("YOUR-ANON-PUBLIC-KEY") === -1;
  var sb = CONFIGURED ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  var state = {
    status: CONFIGURED ? "loading" : "unconfigured", // unconfigured | loading | ready | error
    events: [],
    items: [],
    settings: { tipoOptions: ["Alimentação","Bebidas","Decoração","Brinquedos","Material Escolar","Outro"] },
    currentCategory: null,
    currentEventId: null,
    adminUnlocked: false,
    pendingAfterUnlock: null
  };

  try{ state.adminUnlocked = sessionStorage.getItem("jiAdminUnlocked") === "1"; }catch(e){}

  var itemsChannel = null;

  function fmtMoney(n){
    var v = Number(n);
    if(!isFinite(v)) v = 0;
    return v.toLocaleString("pt-PT",{minimumFractionDigits:2, maximumFractionDigits:2}) + " €";
  }
  function fmtDate(s){
    if(!s) return "—";
    var parts = String(s).slice(0,10).split("-");
    if(parts.length !== 3) return s;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }
  function esc(s){
    return String(s==null?"":s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];
    });
  }

  // ---------- data loading ----------
  function init(){
    if(!CONFIGURED){ render(); return; }

    loadEvents();
    loadSettings();

    sb.channel("events-changes")
      .on("postgres_changes", {event:"*", schema:"public", table:"events"}, loadEvents)
      .subscribe();

    sb.channel("settings-changes")
      .on("postgres_changes", {event:"*", schema:"public", table:"settings"}, loadSettings)
      .subscribe();
  }

  function loadEvents(){
    sb.from("events").select("*").order("created_at",{ascending:false}).then(function(res){
      if(res.error){ state.status = "error"; render(); return; }
      state.events = res.data.map(mapEvent);
      state.status = "ready";
      render();
    });
  }

  function loadSettings(){
    sb.from("settings").select("*").eq("id","config").maybeSingle().then(function(res){
      if(!res.error && res.data && Array.isArray(res.data.tipo_options) && res.data.tipo_options.length){
        state.settings.tipoOptions = res.data.tipo_options;
      }
      render();
    });
  }

  function mapEvent(row){
    return { id: row.id, name: row.name, date: row.date, location: row.location || "", notes: row.notes || "", createdAt: row.created_at };
  }

  // Builds the view-model object from a DB row using ITEM_FIELDS, so every
  // configured column round-trips automatically — no per-column code needed.
  function mapItem(row){
    var out = { id: row.id, eventId: row.event_id, createdAt: row.created_at };
    ITEM_FIELDS.forEach(function(f){ out[f.key] = row[f.column]; });
    return out;
  }

  function watchItems(eventId){
    if(itemsChannel){ sb.removeChannel(itemsChannel); itemsChannel = null; }
    state.items = [];
    loadItems(eventId);
    itemsChannel = sb.channel("items-changes-" + eventId)
      .on("postgres_changes", {event:"*", schema:"public", table:"items", filter:"event_id=eq." + eventId}, function(){ loadItems(eventId); })
      .subscribe();
  }

  function loadItems(eventId){
    sb.from("items").select("*").eq("event_id", eventId).order("created_at",{ascending:true}).then(function(res){
      if(res.error) return;
      state.items = res.data.map(mapItem);
      render();
    });
  }

  // ---------- navigation ----------
  function openCategory(key){
    state.currentCategory = key;
    render();
  }
  function goCategories(){
    state.currentCategory = null;
    state.currentEventId = null;
    if(itemsChannel){ sb.removeChannel(itemsChannel); itemsChannel = null; }
    render();
  }
  function openEvent(id){
    state.currentEventId = id;
    watchItems(id);
    render();
  }
  function goHome(){
    state.currentEventId = null;
    if(itemsChannel){ sb.removeChannel(itemsChannel); itemsChannel = null; }
    render();
  }
  function handleBack(){
    if(state.currentEventId){ goHome(); }
    else{ goCategories(); }
  }
  $("btnBack").addEventListener("click", handleBack);

  // ---------- rendering ----------
  function render(){
    var main = $("main");
    $("btnBack").hidden = !state.currentCategory;

    if(!state.currentCategory){
      renderSplash(main);
      $("pageTitle").textContent = "Associação de Pais";
      $("pageSubtitle").textContent = "Ferramentas de gestão da associação";
      return;
    }

    // From here on a category is open — "inventory" is the only wired-up
    // one, so these states/branches are all scoped to it.
    var category = CATEGORIES.filter(function(c){ return c.key === state.currentCategory; })[0];

    if(state.status === "unconfigured"){
      main.innerHTML =
        '<div class="config-warning">'+
        '<strong>Configuração necessária.</strong> Este painel ainda não está ligado a uma base de dados partilhada. '+
        'Abra <code>app.js</code>, siga os passos no topo do ficheiro para criar um projeto Supabase gratuito, e preencha '+
        '<code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code> com os valores do seu projeto.'+
        '</div>';
      $("pageTitle").textContent = category ? category.label : "Inventário de Festas";
      $("pageSubtitle").textContent = "Associação de Pais";
      return;
    }
    if(state.status === "loading"){
      main.innerHTML = '<div class="empty"><span class="emoji">⏳</span>A carregar o inventário…</div>';
      $("pageTitle").textContent = category ? category.label : "Inventário de Festas";
      $("pageSubtitle").textContent = "Associação de Pais";
      return;
    }
    if(state.status === "error"){
      main.innerHTML =
        '<div class="config-warning">'+
        '<strong>Não foi possível ligar à base de dados.</strong> Verifique se o endereço e a chave em <code>app.js</code> '+
        'estão corretos e se executou o <code>supabase_schema.sql</code> no seu projeto Supabase.'+
        '</div>';
      return;
    }

    if(!state.currentEventId){
      renderHome(main);
    }else{
      renderEvent(main);
    }
    renderAdminPanel();
  }

  // The category splash screen — always reachable regardless of Supabase
  // connectivity, since picking a category needs no data of its own.
  function renderSplash(main){
    var html = '<div class="splash">'+
      '<div class="splash-hero">'+
        '<img class="splash-logo" src="img/AP-ji-agro.png" alt="APEJI AGRO — Associação de Pais do Jardim de Infância do Agro">'+
        '<h2>O que quer gerir?</h2>'+
        '<p>Escolha uma categoria para continuar.</p>'+
      '</div><div class="grid-categories">';
    CATEGORIES.forEach(function(c){
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

  function renderHome(main){
    var category = CATEGORIES.filter(function(c){ return c.key === state.currentCategory; })[0];
    $("pageTitle").textContent = category ? category.label : "Inventário de Festas";
    $("pageSubtitle").textContent = "Associação de Pais · " + state.events.length + " evento(s)";

    var html = '<div class="section-title"><h2>Eventos</h2>'+
      '<button type="button" class="btn primary small" id="btnNewEventHome">+ Novo evento</button></div>';

    if(!state.events.length){
      html += '<div class="empty"><span class="emoji">🎉</span>'+
        '<p style="margin:0 0 6px; font-weight:600; color:var(--fg);">Ainda não há eventos</p>'+
        '<p style="margin:0;">Peça a um administrador para criar o primeiro evento (ex: "Festa de Natal 2026") para começar a registar doações.</p></div>';
    }else{
      html += '<div class="grid-events">';
      state.events.forEach(function(ev){
        html += '<button type="button" class="card-event" data-open-event="'+esc(ev.id)+'">'+
          '<h3>'+esc(ev.name||"Sem nome")+'</h3>'+
          '<div class="meta">'+ (ev.date ? fmtDate(ev.date) : "Sem data definida") + (ev.location ? " · "+esc(ev.location) : "") +'</div>'+
          '<div class="badge-row"><span class="badge" data-count-badge="'+esc(ev.id)+'">— itens</span></div>'+
          '</button>';
      });
      html += '</div>';
    }
    main.innerHTML = html;

    $("btnNewEventHome").addEventListener("click", function(){
      requireAdmin(function(){ openEventDialog(null); });
    });
    main.querySelectorAll("[data-open-event]").forEach(function(btn){
      btn.addEventListener("click", function(){ openEvent(btn.getAttribute("data-open-event")); });
      fillEventCount(btn.getAttribute("data-open-event"));
    });
  }

  // The home-screen badge always shows item count + total "preco" value —
  // that's a product choice (preco is the one column treated as "the
  // money"), not something every configured column should feed into, so
  // it's intentionally hardcoded to that column rather than driven by
  // ITEM_FIELDS.
  function fillEventCount(eventId){
    sb.from("items").select("preco", {count:"exact"}).eq("event_id", eventId).then(function(res){
      if(res.error) return;
      var n = res.count != null ? res.count : res.data.length;
      var total = 0;
      res.data.forEach(function(row){ total += Number(row.preco)||0; });
      var badge = document.querySelector('[data-count-badge="'+eventId+'"]');
      if(badge){
        badge.textContent = n + (n===1 ? " item" : " itens");
        if(total>0){
          badge.insertAdjacentHTML("afterend", '<span class="badge gold">'+fmtMoney(total)+'</span>');
        }
      }
    });
  }

  function renderEvent(main){
    var ev = state.events.find(function(e){ return e.id === state.currentEventId; });
    if(!ev){
      main.innerHTML = '<div class="empty">Este evento já não existe.</div>';
      return;
    }
    $("pageTitle").textContent = ev.name || "Evento";
    $("pageSubtitle").textContent = (ev.date ? fmtDate(ev.date) : "Sem data") + (ev.location ? " · "+ev.location : "");

    // Same product-level choice as fillEventCount: these three stat tiles
    // are specifically about "preco" (money) and "origem" (who donated),
    // not generic per-column aggregates — they keep working regardless of
    // how many other columns ITEM_FIELDS has, but they do assume those two
    // particular columns exist.
    var totalValor = state.items.reduce(function(s,i){ return s + (Number(i.preco)||0); }, 0);
    var doadores = new Set(state.items.map(function(i){ return (i.origem||"").trim().toLowerCase(); }).filter(Boolean)).size;

    var html = '<div class="stats">'+
      '<div class="stat"><div class="label">Itens</div><div class="value num">'+state.items.length+'</div></div>'+
      '<div class="stat"><div class="label">Valor total</div><div class="value num">'+fmtMoney(totalValor)+'</div></div>'+
      '<div class="stat"><div class="label">Doadores distintos</div><div class="value num">'+doadores+'</div></div>'+
      '</div>';

    html += '<div class="section-title"><h2>Inventário</h2>'+
      '<div class="row">'+
      '<button type="button" class="btn small" id="btnEditEvent">Editar evento</button>'+
      '<button type="button" class="btn small" id="btnExportCsv">Exportar CSV</button>'+
      '<button type="button" class="btn small" id="btnImportCsv">Importar CSV</button>'+
      '<button type="button" class="btn danger small" id="btnDeleteEvent">Remover evento</button>'+
      '<button type="button" class="btn primary small" id="btnAddItem">+ Adicionar item</button>'+
      '</div></div>';

    if(!state.items.length){
      html += '<div class="empty"><span class="emoji">📦</span>'+
        '<p style="margin:0 0 6px; font-weight:600; color:var(--fg);">Ainda sem itens registados</p>'+
        '<p style="margin:0;">Use "+ Adicionar item" para registar a primeira doação ou compra para este evento.</p></div>';
    }else{
      html += renderItemsTable();
    }

    main.innerHTML = html;

    $("btnAddItem").addEventListener("click", function(){ openItemDialog(null); });
    $("btnEditEvent").addEventListener("click", function(){ requireAdmin(function(){ openEventDialog(ev.id); }); });
    $("btnExportCsv").addEventListener("click", function(){ exportEventCSV(ev); });
    $("btnImportCsv").addEventListener("click", function(){ requireAdmin(function(){ $("fileImportCsv").click(); }); });
    $("btnDeleteEvent").addEventListener("click", function(){ requireAdmin(function(){ confirmDeleteEvent(ev); }); });
    main.querySelectorAll("[data-edit-item]").forEach(function(btn){
      btn.addEventListener("click", function(){ openItemDialog(btn.getAttribute("data-edit-item")); });
    });
    main.querySelectorAll("[data-del-item]").forEach(function(btn){
      btn.addEventListener("click", function(){ confirmDeleteItem(btn.getAttribute("data-del-item")); });
    });
  }

  // Table header + rows, generated entirely from ITEM_FIELDS.
  function renderItemsTable(){
    var visible = ITEM_FIELDS.filter(function(f){ return f.showInTable !== false; });
    var minWidth = Math.max(560, visible.length * 120 + 160);

    var html = '<div class="table-wrap"><table style="min-width:'+minWidth+'px"><thead><tr>';
    visible.forEach(function(f){ html += '<th>'+esc(f.tableHeader || f.label)+'</th>'; });
    html += '<th></th></tr></thead><tbody>';

    state.items.forEach(function(it){
      html += '<tr>';
      visible.forEach(function(f){
        var cls = (f.type === "number" || f.type === "currency") ? ' class="num"' : "";
        html += '<td'+cls+'>'+renderItemCell(f, it[f.key])+'</td>';
      });
      html += '<td class="actions">'+
        '<button type="button" class="btn small" data-edit-item="'+esc(it.id)+'">Editar</button> '+
        '<button type="button" class="btn danger small" data-del-item="'+esc(it.id)+'">Remover</button>'+
      '</td></tr>';
    });

    html += '</tbody></table></div>';
    return html;
  }

  function renderItemCell(f, value){
    if(f.type === "currency") return fmtMoney(value);
    if(f.type === "date") return fmtDate(value);
    if(f.type === "select" && f.chip) return '<span class="tipo-chip">'+esc(value||"—")+'</span>';
    return esc(value);
  }

  // ---------- item form (built from ITEM_FIELDS) ----------
  function fieldInputHtml(f){
    var id = "f_" + f.key;
    if(f.type === "select"){
      return '<select id="'+id+'"></select>';
    }
    if(f.type === "date"){
      return '<input id="'+id+'" type="date"'+(f.required?" required":"")+'>';
    }
    if(f.type === "number" || f.type === "currency"){
      var min = f.min != null ? f.min : 0;
      var step = f.step != null ? f.step : 1;
      var ph = f.placeholder ? ' placeholder="'+esc(f.placeholder)+'"' : "";
      return '<input id="'+id+'" type="number" min="'+min+'" step="'+step+'"'+(f.required?" required":"")+ph+'>';
    }
    var ph2 = f.placeholder ? ' placeholder="'+esc(f.placeholder)+'"' : "";
    return '<input id="'+id+'" type="text" maxlength="120"'+(f.required?" required":"")+ph2+'>';
  }

  function renderItemFormFields(){
    var html = "";
    var halfBuffer = [];
    function flushHalves(){
      for(var i=0; i<halfBuffer.length; i+=2){
        if(halfBuffer[i+1]){
          html += '<div class="field-row">'+fieldWrapHtml(halfBuffer[i])+fieldWrapHtml(halfBuffer[i+1])+'</div>';
        }else{
          html += fieldWrapHtml(halfBuffer[i]);
        }
      }
      halfBuffer = [];
    }
    function fieldWrapHtml(f){
      return '<div class="field"><label for="f_'+f.key+'">'+esc(f.label)+'</label>'+fieldInputHtml(f)+'</div>';
    }
    ITEM_FIELDS.forEach(function(f){
      if(f.width === "half"){ halfBuffer.push(f); }
      else{ flushHalves(); html += fieldWrapHtml(f); }
    });
    flushHalves();
    return html;
  }

  function getFieldValue(f, el){
    if(f.type === "number" || f.type === "currency") return Number(el.value) || 0;
    if(f.type === "date") return el.value || null;
    if(f.type === "text") return el.value.trim();
    return el.value;
  }

  function setFieldValue(f, el, value){
    if(f.type === "date"){ el.value = value ? String(value).slice(0,10) : ""; return; }
    if(f.type === "select"){ el.value = (value != null && value !== "") ? value : ((f.options()[0]) || ""); return; }
    el.value = (value != null) ? value : "";
  }

  function populateSelectField(f, el, currentValue){
    var opts = f.options ? f.options() : [];
    el.innerHTML = opts.map(function(o){ return '<option value="'+esc(o)+'">'+esc(o)+'</option>'; }).join("");
    if(currentValue && opts.indexOf(currentValue) === -1){
      el.insertAdjacentHTML("afterbegin", '<option value="'+esc(currentValue)+'">'+esc(currentValue)+'</option>');
    }
  }

  var editingItemId = null;
  function openItemDialog(itemId){
    editingItemId = itemId;
    $("itemFormFields").innerHTML = renderItemFormFields();

    var it = itemId ? state.items.find(function(i){ return i.id === itemId; }) : null;
    $("dlgItemTitle").textContent = itemId ? "Editar item" : "Novo item";

    ITEM_FIELDS.forEach(function(f){
      var el = $("f_"+f.key);
      var val = it ? it[f.key] : undefined;
      if(f.type === "select"){ populateSelectField(f, el, val); }
      setFieldValue(f, el, val);
    });

    $("dlgItem").showModal();
  }

  $("formItem").addEventListener("submit", function(e){
    e.preventDefault();
    if(!state.currentEventId) return;
    var data = { event_id: state.currentEventId, updated_at: new Date().toISOString() };
    ITEM_FIELDS.forEach(function(f){
      data[f.column] = getFieldValue(f, $("f_"+f.key));
    });
    var submitBtn = e.target.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    var p;
    if(editingItemId){
      p = sb.from("items").update(data).eq("id", editingItemId);
    }else{
      p = sb.from("items").insert([data]);
    }
    p.then(function(res){
      submitBtn.disabled = false;
      if(res.error){ alertInline("Não foi possível guardar o item (" + res.error.message + ")."); return; }
      $("dlgItem").close();
      loadItems(state.currentEventId);
    });
  });

  function confirmDeleteItem(itemId){
    var it = state.items.find(function(i){ return i.id === itemId; });
    openConfirm("Remover item", 'Remover "'+(it?it.produto:"este item")+'" do inventário?', function(){
      sb.from("items").delete().eq("id", itemId).then(function(res){
        if(res.error){ alertInline("Não foi possível remover o item."); return; }
        loadItems(state.currentEventId);
      });
    });
  }

  // ---------- CSV export / import (built from ITEM_FIELDS, so a column
  // added/removed there round-trips automatically — no per-column code
  // needed here either) ----------
  function csvField(v){
    var s = v==null ? "" : String(v);
    if(/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g,'""') + '"';
    return s;
  }

  function itemsToCSV(items){
    var lines = [ITEM_FIELDS.map(function(f){ return csvField(f.label); }).join(",")];
    items.forEach(function(it){
      var row = ITEM_FIELDS.map(function(f){
        var v = it[f.key];
        if(f.type === "date") return v ? String(v).slice(0,10) : "";
        return v==null ? "" : v;
      });
      lines.push(row.map(csvField).join(","));
    });
    return lines.join("\r\n");
  }

  function slugify(s){
    return String(s||"").toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g,"")
      .replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"") || "evento";
  }

  function downloadText(filename, text){
    var blob = new Blob(["﻿" + text], {type:"text/csv;charset=utf-8;"});
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
  }

  function exportEventCSV(ev){
    var csv = itemsToCSV(state.items);
    var today = new Date().toISOString().slice(0,10);
    downloadText("inventario-" + slugify(ev.name) + "-" + today + ".csv", csv);
  }

  // Minimal RFC4180-style parser: handles quoted fields, embedded commas/
  // quotes/newlines, and CRLF or LF line endings — enough for a CSV saved
  // from Excel, Numbers, or Google Sheets.
  function parseCSV(text){
    var rows = [], row = [], field = "", inQuotes = false, i = 0;
    text = String(text).replace(/^﻿/, "");
    while(i < text.length){
      var c = text[i];
      if(inQuotes){
        if(c === '"'){
          if(text[i+1] === '"'){ field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if(c === '"'){ inQuotes = true; i++; continue; }
      if(c === ','){ row.push(field); field = ""; i++; continue; }
      if(c === '\r'){ i++; continue; }
      if(c === '\n'){ row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    row.push(field);
    if(row.length > 1 || row[0] !== ""){ rows.push(row); }
    return rows;
  }

  function handleImportFile(e){
    var file = e.target.files && e.target.files[0];
    e.target.value = "";
    if(!file) return;
    if(!state.currentEventId){ alertInline("Abra um evento antes de importar."); return; }
    var eventId = state.currentEventId;

    var reader = new FileReader();
    reader.onload = function(){
      var rows = parseCSV(reader.result);
      if(!rows.length){ alertInline("O ficheiro CSV está vazio."); return; }

      var header = rows[0].map(function(h){ return String(h||"").trim().toLowerCase(); });
      var colIndex = {};
      ITEM_FIELDS.forEach(function(f){
        var idx = header.indexOf(f.label.toLowerCase());
        if(idx !== -1) colIndex[f.key] = idx;
      });
      if(!Object.keys(colIndex).length){
        alertInline('Não foi possível reconhecer as colunas do CSV. Confirme que a primeira linha tem os nomes das colunas (ex: "'+ITEM_FIELDS[0].label+'").');
        return;
      }

      var dataRows = rows.slice(1).filter(function(r){
        return r.some(function(v){ return String(v||"").trim() !== ""; });
      });
      if(!dataRows.length){ alertInline("O ficheiro CSV não tem itens para importar."); return; }

      openConfirm("Importar itens", "Importar " + dataRows.length + " item(ns) deste ficheiro para este evento?", function(){
        var payload = dataRows.map(function(r){
          var obj = { event_id: eventId, updated_at: new Date().toISOString() };
          ITEM_FIELDS.forEach(function(f){
            var idx = colIndex[f.key];
            var raw = (idx != null) ? (r[idx] || "") : "";
            if(f.type === "number" || f.type === "currency") obj[f.column] = Number(String(raw).replace(",",".")) || 0;
            else if(f.type === "date") obj[f.column] = raw ? String(raw).trim().slice(0,10) : null;
            else obj[f.column] = String(raw).trim();
          });
          return obj;
        });
        sb.from("items").insert(payload).then(function(res){
          if(res.error){ alertInline("Não foi possível importar o CSV (" + res.error.message + ")."); return; }
          loadItems(eventId);
        });
      }, {confirmLabel:"Importar", confirmClass:"primary"});
    };
    reader.readAsText(file, "utf-8");
  }
  $("fileImportCsv").addEventListener("change", handleImportFile);

  // ---------- event dialog ----------
  var editingEventId = null;
  function openEventDialog(eventId){
    editingEventId = eventId;
    if(eventId){
      var ev = state.events.find(function(e){ return e.id === eventId; });
      $("dlgEventTitle").textContent = "Editar evento";
      $("fEventName").value = ev.name || "";
      $("fEventDate").value = ev.date ? String(ev.date).slice(0,10) : "";
      $("fEventLocal").value = ev.location || "";
      $("fEventNotas").value = ev.notes || "";
    }else{
      $("dlgEventTitle").textContent = "Novo evento";
      $("formEvent").reset();
    }
    $("dlgEvent").showModal();
  }
  $("formEvent").addEventListener("submit", function(e){
    e.preventDefault();
    var data = {
      name: $("fEventName").value.trim(),
      date: $("fEventDate").value || null,
      location: $("fEventLocal").value.trim(),
      notes: $("fEventNotas").value.trim()
    };
    var submitBtn = e.target.querySelector('button[type=submit]');
    submitBtn.disabled = true;
    var p;
    if(editingEventId){
      p = sb.from("events").update(data).eq("id", editingEventId);
    }else{
      p = sb.from("events").insert([data]);
    }
    p.then(function(res){
      submitBtn.disabled = false;
      if(res.error){ alertInline("Não foi possível guardar o evento."); return; }
      $("dlgEvent").close();
      loadEvents();
    });
  });

  function confirmDeleteEvent(ev){
    openConfirm("Remover evento", 'Remover "'+ev.name+'" e todos os seus itens de inventário? Esta ação não pode ser desfeita.', function(){
      sb.from("events").delete().eq("id", ev.id).then(function(res){
        if(res.error){ alertInline("Não foi possível remover o evento."); return; }
        if(state.currentEventId === ev.id) goHome();
        loadEvents();
      });
    });
  }

  // ---------- confirm dialog ----------
  // Generic confirm/alert dialog. opts.confirmLabel/confirmClass let callers
  // other than "delete this" (e.g. CSV import) reuse it with non-danger
  // wording instead of the default "Remover" button.
  var pendingConfirm = null;
  function openConfirm(title, msg, onYes, opts){
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

  function alertInline(msg){
    openConfirm("Aviso", msg, null);
    $("btnConfirmYes").hidden = true;
    var restore = function(){ $("btnConfirmYes").hidden = false; };
    $("dlgConfirm").addEventListener("close", restore, {once:true});
  }

  // ---------- admin ----------
  function requireAdmin(cb){
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

  document.querySelectorAll(".tab").forEach(function(tab){
    tab.addEventListener("click", function(){
      document.querySelectorAll(".tab").forEach(function(t){ t.classList.remove("active"); });
      tab.classList.add("active");
      $("tabEvents").hidden = tab.getAttribute("data-tab") !== "events";
      $("tabTipos").hidden = tab.getAttribute("data-tab") !== "tipos";
    });
  });

  $("btnNewEventAdmin").addEventListener("click", function(){ openEventDialog(null); });

  function renderAdminPanel(){
    if(!state.adminUnlocked) return;
    var list = $("adminEventList");
    if(!state.events.length){
      list.innerHTML = '<p class="admin-note">Ainda não existem eventos.</p>';
    }else{
      list.innerHTML = state.events.map(function(ev){
        return '<div class="admin-eventrow">'+
          '<div><div class="name">'+esc(ev.name)+'</div><div class="meta">'+(ev.date?fmtDate(ev.date):"Sem data")+'</div></div>'+
          '<div class="row">'+
          '<button type="button" class="btn small" data-admin-edit-event="'+esc(ev.id)+'">Editar</button>'+
          '<button type="button" class="btn danger small" data-admin-del-event="'+esc(ev.id)+'">Remover</button>'+
          '</div></div>';
      }).join("");
      list.querySelectorAll("[data-admin-edit-event]").forEach(function(btn){
        btn.addEventListener("click", function(){ openEventDialog(btn.getAttribute("data-admin-edit-event")); });
      });
      list.querySelectorAll("[data-admin-del-event]").forEach(function(btn){
        btn.addEventListener("click", function(){
          var ev = state.events.find(function(e){ return e.id === btn.getAttribute("data-admin-del-event"); });
          if(ev) confirmDeleteEvent(ev);
        });
      });
    }

    var chips = $("tipoChips");
    chips.innerHTML = state.settings.tipoOptions.map(function(t){
      return '<span class="chip">'+esc(t)+'<button type="button" data-rm-tipo="'+esc(t)+'">✕</button></span>';
    }).join("");
    chips.querySelectorAll("[data-rm-tipo]").forEach(function(btn){
      btn.addEventListener("click", function(){
        var t = btn.getAttribute("data-rm-tipo");
        var next = state.settings.tipoOptions.filter(function(x){ return x !== t; });
        saveTipoOptions(next);
      });
    });
  }

  $("formAddTipo").addEventListener("submit", function(e){
    e.preventDefault();
    var val = $("fNewTipo").value.trim();
    if(!val) return;
    if(state.settings.tipoOptions.indexOf(val) !== -1){ $("fNewTipo").value=""; return; }
    saveTipoOptions(state.settings.tipoOptions.concat([val]));
    $("fNewTipo").value = "";
  });

  function saveTipoOptions(list){
    state.settings.tipoOptions = list;
    renderAdminPanel();
    sb.from("settings").update({ tipo_options: list }).eq("id","config").then(function(res){
      if(res.error) alertInline("Não foi possível guardar as categorias.");
    });
  }

  // ---------- dialog close wiring ----------
  document.querySelectorAll("[data-close]").forEach(function(btn){
    btn.addEventListener("click", function(){ $(btn.getAttribute("data-close")).close(); });
  });
  document.querySelectorAll("dialog").forEach(function(dlg){
    dlg.addEventListener("click", function(e){ if(e.target === dlg) dlg.close(); });
  });

  init();
})();
