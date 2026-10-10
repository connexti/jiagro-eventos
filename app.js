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

  var $ = function(id){ return document.getElementById(id); };

  var CONFIGURED = SUPABASE_URL.indexOf("YOUR-PROJECT") === -1 && SUPABASE_ANON_KEY.indexOf("YOUR-ANON-PUBLIC-KEY") === -1;
  var sb = CONFIGURED ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

  var state = {
    status: CONFIGURED ? "loading" : "unconfigured", // unconfigured | loading | ready | error
    events: [],
    items: [],
    settings: { tipoOptions: ["Alimentação","Bebidas","Decoração","Brinquedos","Material Escolar","Outro"] },
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
  function mapItem(row){
    return {
      id: row.id, eventId: row.event_id, origem: row.origem, produto: row.produto,
      quantidade: row.quantidade, tipo: row.tipo, dataEntrega: row.data_entrega,
      preco: row.preco, createdAt: row.created_at
    };
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
  $("btnBack").addEventListener("click", goHome);

  // ---------- rendering ----------
  function render(){
    var main = $("main");
    $("btnBack").hidden = !state.currentEventId;

    if(state.status === "unconfigured"){
      main.innerHTML =
        '<div class="config-warning">'+
        '<strong>Configuração necessária.</strong> Este painel ainda não está ligado a uma base de dados partilhada. '+
        'Abra <code>app.js</code>, siga os passos no topo do ficheiro para criar um projeto Supabase gratuito, e preencha '+
        '<code>SUPABASE_URL</code> e <code>SUPABASE_ANON_KEY</code> com os valores do seu projeto.'+
        '</div>';
      $("pageTitle").textContent = "Inventário de Festas";
      $("pageSubtitle").textContent = "Associação de Pais";
      return;
    }
    if(state.status === "loading"){
      main.innerHTML = '<div class="empty"><span class="emoji">⏳</span>A carregar o inventário…</div>';
      $("pageTitle").textContent = "Inventário de Festas";
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

  function renderHome(main){
    $("pageTitle").textContent = "Inventário de Festas";
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

  function fillEventCount(eventId){
    sb.from("items").select("quantidade,preco", {count:"exact"}).eq("event_id", eventId).then(function(res){
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
      '<button type="button" class="btn danger small" id="btnDeleteEvent">Remover evento</button>'+
      '<button type="button" class="btn primary small" id="btnAddItem">+ Adicionar item</button>'+
      '</div></div>';

    if(!state.items.length){
      html += '<div class="empty"><span class="emoji">📦</span>'+
        '<p style="margin:0 0 6px; font-weight:600; color:var(--fg);">Ainda sem itens registados</p>'+
        '<p style="margin:0;">Use "+ Adicionar item" para registar a primeira doação ou compra para este evento.</p></div>';
    }else{
      html += '<div class="table-wrap"><table><thead><tr>'+
        '<th>Origem Doação</th><th>Produto</th><th>Qtd.</th><th>Tipo</th><th>Entrega</th><th>Preço</th><th></th>'+
        '</tr></thead><tbody>';
      state.items.forEach(function(it){
        html += '<tr>'+
          '<td>'+esc(it.origem)+'</td>'+
          '<td>'+esc(it.produto)+'</td>'+
          '<td class="num">'+esc(it.quantidade)+'</td>'+
          '<td><span class="tipo-chip">'+esc(it.tipo||"—")+'</span></td>'+
          '<td>'+fmtDate(it.dataEntrega)+'</td>'+
          '<td class="num">'+fmtMoney(it.preco)+'</td>'+
          '<td class="actions">'+
            '<button type="button" class="btn small" data-edit-item="'+esc(it.id)+'">Editar</button> '+
            '<button type="button" class="btn danger small" data-del-item="'+esc(it.id)+'">Remover</button>'+
          '</td>'+
        '</tr>';
      });
      html += '</tbody></table></div>';
    }

    main.innerHTML = html;

    $("btnAddItem").addEventListener("click", function(){ openItemDialog(null); });
    $("btnEditEvent").addEventListener("click", function(){ requireAdmin(function(){ openEventDialog(ev.id); }); });
    $("btnDeleteEvent").addEventListener("click", function(){ requireAdmin(function(){ confirmDeleteEvent(ev); }); });
    main.querySelectorAll("[data-edit-item]").forEach(function(btn){
      btn.addEventListener("click", function(){ openItemDialog(btn.getAttribute("data-edit-item")); });
    });
    main.querySelectorAll("[data-del-item]").forEach(function(btn){
      btn.addEventListener("click", function(){ confirmDeleteItem(btn.getAttribute("data-del-item")); });
    });
  }

  // ---------- item dialog ----------
  var editingItemId = null;
  function openItemDialog(itemId){
    editingItemId = itemId;
    var sel = $("fTipo");
    sel.innerHTML = state.settings.tipoOptions.map(function(t){ return '<option value="'+esc(t)+'">'+esc(t)+'</option>'; }).join("");
    if(itemId){
      var it = state.items.find(function(i){ return i.id === itemId; });
      $("dlgItemTitle").textContent = "Editar item";
      $("fOrigem").value = it.origem || "";
      $("fProduto").value = it.produto || "";
      $("fQuantidade").value = it.quantidade != null ? it.quantidade : "";
      if(it.tipo && state.settings.tipoOptions.indexOf(it.tipo) === -1){
        sel.insertAdjacentHTML("afterbegin", '<option value="'+esc(it.tipo)+'">'+esc(it.tipo)+'</option>');
      }
      sel.value = it.tipo || state.settings.tipoOptions[0];
      $("fData").value = it.dataEntrega ? String(it.dataEntrega).slice(0,10) : "";
      $("fPreco").value = it.preco != null ? it.preco : "";
    }else{
      $("dlgItemTitle").textContent = "Novo item";
      $("formItem").reset();
      sel.value = state.settings.tipoOptions[0];
    }
    $("dlgItem").showModal();
  }
  $("formItem").addEventListener("submit", function(e){
    e.preventDefault();
    if(!state.currentEventId) return;
    var data = {
      event_id: state.currentEventId,
      origem: $("fOrigem").value.trim(),
      produto: $("fProduto").value.trim(),
      quantidade: Number($("fQuantidade").value) || 0,
      tipo: $("fTipo").value,
      data_entrega: $("fData").value || null,
      preco: Number($("fPreco").value) || 0,
      updated_at: new Date().toISOString()
    };
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
  var pendingConfirm = null;
  function openConfirm(title, msg, onYes){
    $("confirmTitle").textContent = title;
    $("confirmMsg").textContent = msg;
    pendingConfirm = onYes;
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
