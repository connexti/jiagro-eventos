// ============================================================
// "Inventário Stock" category — a flat register of things the
// association owns (as opposed to party-inventory.js, which tracks
// donations/purchases per event). No event grid here: just one table.
// Unlike party-inventory, item CRUD here is admin-only (requireAdmin
// gates add/edit/delete), per product requirement. See js/core.js for
// the generic shell this plugs into, and the category module contract
// described in CLAUDE.md.
// ============================================================
import { $, esc, fmtDate, sb, render, requireAdmin, openConfirm, alertInline, renderAdminPanel } from "../core.js";

// ============================================================
// STOCK COLUMNS — the single source of truth for the item form and the
// stock table. To add, remove, or edit a column, change this array only;
// the form fields, table headers/cells, and the object sent to Supabase
// are all generated from it.
//
// IMPORTANT: this does NOT change the database. Adding a column here
// means you also need, once, in the Supabase SQL editor:
//   alter table public.stock_items add column <db_column> <type>;
// and removing one means (optionally, to actually drop the data):
//   alter table public.stock_items drop column <db_column>;
// Keep supabase_schema.sql in sync so a fresh setup matches.
//
// Field shape: same as party-inventory.js's ITEM_FIELDS, plus a
// "textarea" type for free-form notes.
// ============================================================
var ITEM_FIELDS = [
  { key:"artigo", column:"artigo", label:"Artigo", type:"text", width:"full", required:true,
    placeholder:"Ex: Mesas dobráveis" },
  { key:"tipo", column:"tipo", label:"Tipo", type:"select", width:"half", chip:true,
    options:function(){ return settings.tipoOptions; } },
  { key:"quantidade", column:"quantidade", label:"Quantidade", tableHeader:"Qtd.", type:"number",
    width:"half", required:true, min:0, step:1 },
  { key:"local", column:"local", label:"Local", type:"text", width:"full",
    placeholder:"Ex: Arrecadação, Sala 2…" },
  { key:"notas", column:"notas", label:"Notas", type:"textarea", width:"full",
    placeholder:"Detalhes adicionais (opcional)" }
];

var meta = { key:"inventory-stock", label:"Inventário Stock", description:"Registo do material que a associação tem guardado.", icon:"📋" };

// ---------- local state ----------
var items = [];
var settings = { tipoOptions: ["Material Festas","Decoração","Mobiliário","Eletrodomésticos","Outro"] };
var status = "loading"; // loading | ready | error
var itemsChannel = null;
var settingsChannel = null;

// ---------- data loading ----------
function onOpen(){
  status = "loading";
  loadItems();
  loadSettings();
  itemsChannel = sb.channel("stock-items-changes")
    .on("postgres_changes", {event:"*", schema:"public", table:"stock_items"}, loadItems)
    .subscribe();
  settingsChannel = sb.channel("stock-settings-changes")
    .on("postgres_changes", {event:"*", schema:"public", table:"settings", filter:"id=eq.stock"}, loadSettings)
    .subscribe();
}
function onClose(){
  if(itemsChannel){ sb.removeChannel(itemsChannel); itemsChannel = null; }
  if(settingsChannel){ sb.removeChannel(settingsChannel); settingsChannel = null; }
  items = [];
}

function loadItems(){
  sb.from("stock_items").select("*").order("created_at",{ascending:true}).then(function(res){
    if(res.error){ status = "error"; render(); return; }
    items = res.data.map(mapItem);
    status = "ready";
    render();
  });
}

function loadSettings(){
  sb.from("settings").select("*").eq("id","stock").maybeSingle().then(function(res){
    if(!res.error && res.data && Array.isArray(res.data.tipo_options) && res.data.tipo_options.length){
      settings.tipoOptions = res.data.tipo_options;
    }
    render();
  });
}

// Builds the view-model object from a DB row using ITEM_FIELDS, so every
// configured column round-trips automatically — no per-column code needed.
function mapItem(row){
  var out = { id: row.id, createdAt: row.created_at };
  ITEM_FIELDS.forEach(function(f){ out[f.key] = row[f.column]; });
  return out;
}

// ---------- rendering ----------
function renderCategory(main){
  $("pageTitle").textContent = meta.label;
  $("pageSubtitle").textContent = "Associação de Pais · " + items.length + " artigo(s)";

  if(status === "loading"){
    main.innerHTML = '<div class="empty"><span class="emoji">⏳</span>A carregar o stock…</div>';
    return;
  }
  if(status === "error"){
    main.innerHTML =
      '<div class="config-warning">'+
      '<strong>Não foi possível ligar à base de dados.</strong> Verifique se o endereço e a chave em <code>js/core.js</code> '+
      'estão corretos e se executou o <code>supabase_schema.sql</code> no seu projeto Supabase.'+
      '</div>';
    return;
  }

  var html = '<div class="section-title"><h2>Stock</h2>'+
    '<div class="row">'+
    '<button type="button" class="btn small" id="btnRefreshStock" title="Atualizar lista">🔄 Atualizar</button>'+
    '<button type="button" class="btn small" id="btnExportCsv">Exportar CSV</button>'+
    '<button type="button" class="btn small" id="btnImportCsv">Importar CSV</button>'+
    '<button type="button" class="btn primary small" id="btnAddItem">+ Adicionar artigo</button>'+
    '</div></div>';

  if(!items.length){
    html += '<div class="empty"><span class="emoji">📦</span>'+
      '<p style="margin:0 0 6px; font-weight:600; color:var(--fg);">Ainda sem artigos registados</p>'+
      '<p style="margin:0;">Use "+ Adicionar artigo" para começar a registar o stock da associação.</p></div>';
  }else{
    html += renderItemsTable();
  }

  main.innerHTML = html;

  $("btnAddItem").addEventListener("click", function(){ requireAdmin(function(){ openItemDialog(null); }); });
  $("btnRefreshStock").addEventListener("click", function(){
    var btn = $("btnRefreshStock");
    btn.disabled = true;
    btn.textContent = "A atualizar…";
    loadItems();
  });
  $("btnExportCsv").addEventListener("click", exportStockCSV);
  $("btnImportCsv").addEventListener("click", function(){ requireAdmin(function(){ $("fileImportStockCsv").click(); }); });
  main.querySelectorAll("[data-edit-item]").forEach(function(btn){
    btn.addEventListener("click", function(){ requireAdmin(function(){ openItemDialog(btn.getAttribute("data-edit-item")); }); });
  });
  main.querySelectorAll("[data-del-item]").forEach(function(btn){
    btn.addEventListener("click", function(){ requireAdmin(function(){ confirmDeleteItem(btn.getAttribute("data-del-item")); }); });
  });
}

// Table header + rows, generated entirely from ITEM_FIELDS.
function renderItemsTable(){
  var visible = ITEM_FIELDS.filter(function(f){ return f.showInTable !== false; });
  var minWidth = Math.max(560, visible.length * 120 + 160);

  var html = '<div class="table-wrap"><table style="min-width:'+minWidth+'px"><thead><tr>';
  visible.forEach(function(f){ html += '<th>'+esc(f.tableHeader || f.label)+'</th>'; });
  html += '<th></th></tr></thead><tbody>';

  items.forEach(function(it){
    html += '<tr>';
    visible.forEach(function(f){
      var cls = (f.type === "number") ? ' class="num"' : "";
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
  if(f.type === "date") return fmtDate(value);
  if(f.type === "select" && f.chip) return '<span class="tipo-chip">'+esc(value||"—")+'</span>';
  return esc(value);
}

// ---------- item form (built from ITEM_FIELDS) ----------
function fieldInputHtml(f){
  var id = "sf_" + f.key;
  if(f.type === "select"){
    return '<select id="'+id+'"></select>';
  }
  if(f.type === "textarea"){
    var ph0 = f.placeholder ? ' placeholder="'+esc(f.placeholder)+'"' : "";
    return '<textarea id="'+id+'" rows="2" maxlength="500"'+ph0+'></textarea>';
  }
  if(f.type === "number"){
    var min = f.min != null ? f.min : 0;
    var step = f.step != null ? f.step : 1;
    var ph = f.placeholder ? ' placeholder="'+esc(f.placeholder)+'"' : "";
    return '<input id="'+id+'" type="number" min="'+min+'" step="'+step+'"'+(f.required?" required":"")+ph+'>';
  }
  var ph2 = f.placeholder ? ' placeholder="'+esc(f.placeholder)+'"' : "";
  return '<input id="'+id+'" type="text" maxlength="200"'+(f.required?" required":"")+ph2+'>';
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
    return '<div class="field"><label for="sf_'+f.key+'">'+esc(f.label)+'</label>'+fieldInputHtml(f)+'</div>';
  }
  ITEM_FIELDS.forEach(function(f){
    if(f.width === "half"){ halfBuffer.push(f); }
    else{ flushHalves(); html += fieldWrapHtml(f); }
  });
  flushHalves();
  return html;
}

function getFieldValue(f, el){
  if(f.type === "number") return Number(el.value) || 0;
  if(f.type === "text" || f.type === "textarea") return el.value.trim();
  return el.value;
}

function setFieldValue(f, el, value){
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
  $("stockItemFormFields").innerHTML = renderItemFormFields();

  var it = itemId ? items.find(function(i){ return i.id === itemId; }) : null;
  $("dlgStockItemTitle").textContent = itemId ? "Editar artigo" : "Novo artigo";

  ITEM_FIELDS.forEach(function(f){
    var el = $("sf_"+f.key);
    var val = it ? it[f.key] : undefined;
    if(f.type === "select"){ populateSelectField(f, el, val); }
    setFieldValue(f, el, val);
  });

  $("dlgStockItem").showModal();
}

$("formStockItem").addEventListener("submit", function(e){
  e.preventDefault();
  var data = { updated_at: new Date().toISOString() };
  ITEM_FIELDS.forEach(function(f){
    data[f.column] = getFieldValue(f, $("sf_"+f.key));
  });
  var submitBtn = e.target.querySelector('button[type=submit]');
  submitBtn.disabled = true;
  var p;
  if(editingItemId){
    p = sb.from("stock_items").update(data).eq("id", editingItemId);
  }else{
    p = sb.from("stock_items").insert([data]);
  }
  p.then(function(res){
    submitBtn.disabled = false;
    if(res.error){ alertInline("Não foi possível guardar o artigo (" + res.error.message + ")."); return; }
    $("dlgStockItem").close();
    loadItems();
  });
});

function confirmDeleteItem(itemId){
  var it = items.find(function(i){ return i.id === itemId; });
  openConfirm("Remover artigo", 'Remover "'+(it?it.artigo:"este artigo")+'" do stock?', function(){
    sb.from("stock_items").delete().eq("id", itemId).then(function(res){
      if(res.error){ alertInline("Não foi possível remover o artigo."); return; }
      loadItems();
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

function itemsToCSV(list){
  var lines = [ITEM_FIELDS.map(function(f){ return csvField(f.label); }).join(",")];
  list.forEach(function(it){
    var row = ITEM_FIELDS.map(function(f){
      var v = it[f.key];
      return v==null ? "" : v;
    });
    lines.push(row.map(csvField).join(","));
  });
  return lines.join("\r\n");
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

function exportStockCSV(){
  var csv = itemsToCSV(items);
  var today = new Date().toISOString().slice(0,10);
  downloadText("inventario-stock-" + today + ".csv", csv);
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
    if(!dataRows.length){ alertInline("O ficheiro CSV não tem artigos para importar."); return; }

    openConfirm("Importar artigos", "Importar " + dataRows.length + " artigo(s) deste ficheiro para o stock?", function(){
      var payload = dataRows.map(function(r){
        var obj = { updated_at: new Date().toISOString() };
        ITEM_FIELDS.forEach(function(f){
          var idx = colIndex[f.key];
          var raw = (idx != null) ? (r[idx] || "") : "";
          if(f.type === "number") obj[f.column] = Number(String(raw).replace(",",".")) || 0;
          else obj[f.column] = String(raw).trim();
        });
        return obj;
      });
      sb.from("stock_items").insert(payload).then(function(res){
        if(res.error){ alertInline("Não foi possível importar o CSV (" + res.error.message + ")."); return; }
        loadItems();
      });
    }, {confirmLabel:"Importar", confirmClass:"primary"});
  };
  reader.readAsText(file, "utf-8");
}
$("fileImportStockCsv").addEventListener("change", handleImportFile);

// ---------- admin tab (Tipo list only — add/edit/delete of the items
// themselves happens inline in the main table, gated by requireAdmin) ----------
function renderAdminTiposTab(container){
  container.innerHTML =
    '<p class="admin-note">Estas categorias aparecem no campo "Tipo" ao adicionar um artigo ao stock.</p>'+
    '<div class="chips" id="stockTipoChips"></div>'+
    '<form id="formAddStockTipo" class="row">'+
      '<input id="fNewStockTipo" placeholder="Nova categoria…" maxlength="40" style="flex:1; font:inherit; padding:9px 11px; border-radius:9px; border:1px solid var(--border); background:var(--bg); color:var(--fg);">'+
      '<button type="submit" class="btn small">Adicionar</button>'+
    '</form>';
  renderTipoChips();
  $("formAddStockTipo").addEventListener("submit", function(e){
    e.preventDefault();
    var val = $("fNewStockTipo").value.trim();
    if(!val) return;
    if(settings.tipoOptions.indexOf(val) !== -1){ $("fNewStockTipo").value=""; return; }
    saveTipoOptions(settings.tipoOptions.concat([val]));
    $("fNewStockTipo").value = "";
  });
}

function renderTipoChips(){
  var chips = $("stockTipoChips");
  if(!chips) return;
  chips.innerHTML = settings.tipoOptions.map(function(t){
    return '<span class="chip">'+esc(t)+'<button type="button" data-rm-stock-tipo="'+esc(t)+'">✕</button></span>';
  }).join("");
  chips.querySelectorAll("[data-rm-stock-tipo]").forEach(function(btn){
    btn.addEventListener("click", function(){
      var t = btn.getAttribute("data-rm-stock-tipo");
      var next = settings.tipoOptions.filter(function(x){ return x !== t; });
      saveTipoOptions(next);
    });
  });
}

function saveTipoOptions(list){
  settings.tipoOptions = list;
  renderAdminPanel();
  sb.from("settings").update({ tipo_options: list }).eq("id","stock").then(function(res){
    if(res.error) alertInline("Não foi possível guardar as categorias.");
  });
}

export default {
  meta: meta,
  onOpen: onOpen,
  onClose: onClose,
  render: renderCategory,
  adminTabs: [
    { key:"stock-tipos", label:"Categorias (Tipo)", render: renderAdminTiposTab }
  ]
};
