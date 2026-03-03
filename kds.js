// ═══════════════════════════════════════════
// KDS.JS — Burguerados Paulista
// Kitchen Display System — Enhanced
// ═══════════════════════════════════════════

const firebaseConfig = {
  apiKey: "AIzaSyD3A4S7qaX-d6XjuGNRJ_GJZCPSED4Avis",
  authDomain: "burgueradospaulista.firebaseapp.com",
  databaseURL: "https://burgueradospaulista-default-rtdb.firebaseio.com",
  projectId: "burgueradospaulista",
  storageBucket: "burgueradospaulista.firebasestorage.app",
  messagingSenderId: "979247036551",
  appId: "1:979247036551:web:06cda0842b882987eaa022",
  measurementId: "G-8QTLHNZ354",
};

// ─── STATE ───
let db = null;
let orders = {};
let historyOrders = [];
let menuAvailability = {};
let currentFilter = "all";
let confirmCallback = null;
let cardapioRaw = null;
let lojaAberta = true;
let knownOrderIds = new Set();
let titleBlinkInterval = null;
let orderCounter = 1;
const originalTitle = "KDS — Burguerados Paulista";

// ═══════════════════════════════════════════
// FIREBASE
// ═══════════════════════════════════════════
async function initFirebase() {
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.database();

    const dot = document.getElementById("online-dot");
    db.ref(".info/connected").on("value", (snap) => {
      dot.classList.toggle("offline", !snap.val());
    });

    // Nós públicos — inicia antes do auth
    listenToMenuAvailability();
    listenToLojaStatus();

    try {
      await firebase.auth().signInAnonymously();
    } catch (e) {
      console.warn("Auth anônimo falhou:", e.message);
    }

    listenToOrders();
    listenToHistory();
    listenToOrderCounter();

    console.log("✅ Firebase KDS inicializado");
  } catch (e) {
    console.error("Firebase error:", e);
    showToast("⚠️ Falha ao conectar Firebase", "error");
  }
}

function listenToOrders() {
  if (!db) return;
  db.ref("pedidos").on("value", (snap) => {
    const newOrders = snap.val() || {};
    // Detecta novos pedidos (após primeira carga)
    if (knownOrderIds.size > 0) {
      Object.keys(newOrders).forEach((id) => {
        if (!knownOrderIds.has(id)) {
          playNewOrderSound();
          triggerTitleBlink();
        }
      });
    }
    Object.keys(newOrders).forEach((id) => knownOrderIds.add(id));
    orders = newOrders;
    renderKDS();
    updateStats();
  });
}

function listenToHistory() {
  if (!db) return;
  db.ref("historicoPedidos").on("value", (snap) => {
    const raw = snap.val() || {};
    historyOrders = Object.entries(raw)
      .map(([id, o]) => ({ id, ...o }))
      .sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
    applyHistoryFilter();
    updateStats();
  });
}

function listenToMenuAvailability() {
  if (!db) return;
  db.ref("menuAvailability").on("value", (snap) => {
    menuAvailability = snap.val() || {};
    if (cardapioRaw) renderCardapio(cardapioRaw);
  });
}

function listenToLojaStatus() {
  if (!db) return;
  db.ref("config/lojaAberta").on("value", (snap) => {
    lojaAberta = snap.val() !== false;
    updateLojaBtn();
  });
}

function listenToOrderCounter() {
  if (!db) return;
  db.ref("config/orderCounter").once("value", (snap) => {
    if (snap.val()) orderCounter = snap.val();
  });
}

// ═══════════════════════════════════════════
// LOJA ABERTA / FECHADA
// ═══════════════════════════════════════════
function toggleLoja() {
  if (!db) {
    showToast("Firebase não conectado", "error");
    return;
  }
  const novoStatus = !lojaAberta;
  openConfirm(
    novoStatus ? "🟢" : "🔴",
    novoStatus ? "Abrir loja" : "Fechar loja",
    novoStatus
      ? "Os clientes poderão fazer novos pedidos."
      : "Nenhum novo pedido será aceito pelo site até você reabrir.",
    () => db.ref("config/lojaAberta").set(novoStatus),
    novoStatus ? "Abrir" : "Fechar",
  );
}

function updateLojaBtn() {
  const btn = document.getElementById("btn-loja");
  if (!btn) return;
  btn.textContent = lojaAberta ? "🟢 Loja Aberta" : "🔴 Loja Fechada";
  btn.classList.toggle("loja-fechada", !lojaAberta);
}

// ═══════════════════════════════════════════
// SOM DE NOVO PEDIDO (Web Audio API)
// ═══════════════════════════════════════════
function playNewOrderSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    [
      { freq: 880, start: 0, dur: 0.12 },
      { freq: 1100, start: 0.15, dur: 0.12 },
      { freq: 1320, start: 0.3, dur: 0.22 },
    ].forEach(({ freq, start, dur }) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = "sine";
      gain.gain.setValueAtTime(0, ctx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + start + 0.02);
      gain.gain.linearRampToValueAtTime(0, ctx.currentTime + start + dur);
      osc.start(ctx.currentTime + start);
      osc.stop(ctx.currentTime + start + dur + 0.05);
    });
  } catch (e) {
    /* sem suporte */
  }
}

// ═══════════════════════════════════════════
// BLINK DO TÍTULO DA ABA
// ═══════════════════════════════════════════
function triggerTitleBlink() {
  if (titleBlinkInterval) return;
  let on = true;
  titleBlinkInterval = setInterval(() => {
    document.title = on ? "🔔 NOVO PEDIDO!" : originalTitle;
    on = !on;
  }, 800);
  const stop = () => {
    clearInterval(titleBlinkInterval);
    titleBlinkInterval = null;
    document.title = originalTitle;
    window.removeEventListener("focus", stop);
  };
  window.addEventListener("focus", stop);
}

// ═══════════════════════════════════════════
// ATALHOS DE TECLADO
// ═══════════════════════════════════════════
document.addEventListener("keydown", (e) => {
  if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;

  if (e.key === "Escape") {
    closeNewOrderModal();
    closeConfirm();
    closeEditModal();
  }
  // A = aceitar o pedido pendente mais antigo
  if (e.key === "a" || e.key === "A") {
    const oldest = Object.entries(orders)
      .map(([id, o]) => ({ id, ...o }))
      .filter(
        (o) => !o.arquivado && (!o.kdsStatus || o.kdsStatus === "pending"),
      )
      .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))[0];
    if (oldest) {
      acceptOrder(oldest.id);
      showToast(
        `⌨️ Aceito: #${oldest.numeroPedido || oldest.id.slice(-4)}`,
        "success",
      );
    }
  }
  // N = novo pedido manual
  if (e.key === "n" || e.key === "N") {
    openNewOrderModal();
  }
});

// ═══════════════════════════════════════════
// RELÓGIO + TIMER AO VIVO
// ═══════════════════════════════════════════
function updateClock() {
  document.getElementById("clock").textContent = new Date()
    .toTimeString()
    .slice(0, 8);
}
setInterval(updateClock, 1000);
updateClock();

setInterval(() => {
  document.querySelectorAll(".card-elapsed[data-ts]").forEach((el) => {
    const mins = Math.floor((Date.now() - parseInt(el.dataset.ts)) / 60000);
    el.textContent = mins < 1 ? "< 1min" : `${mins}min`;
    el.className =
      "card-elapsed" + (mins >= 15 ? " urgent" : mins >= 8 ? " warn" : "");
  });
}, 10000);

// ═══════════════════════════════════════════
// NAVEGAÇÃO
// ═══════════════════════════════════════════
function switchView(view) {
  document
    .querySelectorAll(".view")
    .forEach((v) => v.classList.remove("active"));
  document
    .querySelectorAll(".nav-item")
    .forEach((n) => n.classList.remove("active"));
  document.getElementById("view-" + view).classList.add("active");
  document.querySelector(`[data-view="${view}"]`).classList.add("active");
  if (view === "history") applyHistoryFilter();
  if (view === "cardapio" && cardapioRaw) renderCardapio(cardapioRaw);
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  const isMobile = window.innerWidth <= 640;
  if (isMobile) {
    const isOpen = sidebar.classList.toggle("mobile-open");
    let backdrop = document.getElementById("sidebar-backdrop");
    if (!backdrop) {
      backdrop = document.createElement("div");
      backdrop.id = "sidebar-backdrop";
      backdrop.className = "sidebar-backdrop";
      backdrop.onclick = toggleSidebar;
      document.body.appendChild(backdrop);
    }
    backdrop.classList.toggle("active", isOpen);
  } else {
    sidebar.classList.toggle("collapsed");
  }
}

// ═══════════════════════════════════════════
// KDS — RENDER
// ═══════════════════════════════════════════
function setFilter(f, btn) {
  currentFilter = f;
  document
    .querySelectorAll(".filter-tab")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  renderKDS();
}

function renderKDS() {
  const grid = document.getElementById("kds-grid");

  const list = Object.entries(orders)
    .map(([id, o]) => ({ id, ...o }))
    .filter((o) => !o.arquivado)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

  const filtered =
    currentFilter === "all"
      ? list
      : list.filter((o) => o.kdsStatus === currentFilter);

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-icon">🍽️</div>
        <div class="empty-state-text">Nenhum pedido ${currentFilter !== "all" ? "neste status" : "no momento"}</div>
        <div class="empty-state-hint">
          <kbd>N</kbd> novo pedido &nbsp;·&nbsp; <kbd>A</kbd> aceitar mais antigo &nbsp;·&nbsp; <kbd>Esc</kbd> fechar modal
        </div>
      </div>`;
    return;
  }

  grid.innerHTML = filtered.map((o) => buildOrderCard(o)).join("");
}

function buildOrderCard(o) {
  const ts = o.timestamp || Date.now();
  const mins = Math.floor((Date.now() - ts) / 60000);
  const elapsed = mins < 1 ? "< 1min" : `${mins}min`;
  const elClass = mins >= 15 ? "urgent" : mins >= 8 ? "warn" : "";

  const status = o.kdsStatus || "pending";
  const isPending = status === "pending";
  const isAccepted = status === "accepted";

  const typeMap = {
    delivery: "badge-delivery",
    pickup: "badge-pickup",
    mesa: "badge-mesa",
  };
  const typeLabel = {
    delivery: "🛵 Delivery",
    pickup: "🏪 Retirada",
    mesa: "🪑 Mesa",
  };
  const tipo = o.tipo || o.tipoEntrega || "pickup";

  const num = sanitize(
    o.numeroPedido || o.id?.slice(-4)?.toUpperCase() || "????",
  );
  const cliente = sanitize(o.cliente || o.nomeCliente || o.nome || "Cliente");
  const pagamento = sanitize(o.formaPagamento || o.pagamento || "");
  const address = sanitize(o.endereco || o.enderecoEntrega || "");
  const obsGeral = sanitize(o.observacoes || o.obs || "");
  const total = o.total || o.totalPedido || 0;
  const isNew = mins < 1;

  const itens = o.itens || o.items || [];
  const itemsHtml = itens
    .map((item) => {
      const name = sanitize(item.nome || item.name || "Item");
      const qty = item.quantidade || item.qty || 1;
      const obs = sanitize(
        item.observacoes || item.observacao || item.obs || item.notes || "",
      );
      const opcao = sanitize(item.opcao || item.opcaoSelecionada || "");
      const extras = item.paidExtras || item.adicionais || [];
      const extrasHtml = extras
        .map(
          (ex) =>
            `<div class="item-extra">＋ ${ex.nome || ex.name}${ex.quantidade > 1 ? ` ×${ex.quantidade}` : ""}</div>`,
        )
        .join("");
      return `
      <div class="order-item">
        <div class="item-qty">${qty}×</div>
        <div class="item-info">
          <div class="item-name">${name}</div>
          ${opcao ? `<div class="item-sub">${opcao}</div>` : ""}
          ${extrasHtml}
          ${obs ? `<div class="item-notes">📝 ${obs}</div>` : ""}
        </div>
      </div>`;
    })
    .join("");

  const actionsHtml = isPending
    ? `<button class="btn btn-accept" onclick="acceptOrder('${o.id}')">✅ Aceitar</button>
       <button class="btn btn-refuse" onclick="refuseOrder('${o.id}')">✕ Recusar</button>`
    : isAccepted
      ? `<button class="btn btn-print-client"  onclick="printOrder('${o.id}', 'client')">🖨️ Cliente</button>
         <button class="btn btn-print-kitchen" onclick="printOrder('${o.id}', 'kitchen')">🔧 Cozinha</button>
         <button class="btn btn-complete"      onclick="completeOrder('${o.id}')">🏁 Concluir</button>
         <button class="btn btn-cancel"        onclick="cancelOrder('${o.id}')">✕ Cancelar</button>`
      : `<span style="color:var(--text-muted);font-size:12px;padding:4px 0">✔ Pedido concluído</span>`;

  return `
    <div class="order-card status-${status}${isNew ? " card-new" : ""}" id="card-${o.id}">
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="card-order-num">#${num}</div>
          ${isNew ? `<span class="badge-new">NOVO</span>` : ""}
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="card-type-badge ${typeMap[tipo] || "badge-pickup"}">${typeLabel[tipo] || "🏪 Retirada"}</span>
          <span class="card-elapsed ${elClass}" data-ts="${ts}">${elapsed}</span>
        </div>
      </div>
      <div class="card-customer">
        <div class="customer-name">${cliente}</div>
        <div class="customer-detail">${[pagamento, address].filter(Boolean).join(" · ")}</div>
      </div>
      <div class="card-items">${itemsHtml}</div>
      ${obsGeral ? `<div class="card-obs">⚠️ ${obsGeral}</div>` : ""}
      <div class="card-total">
        <span>Total</span>
        <strong>${formatPrice(total)}</strong>
      </div>
      <div class="card-actions">${actionsHtml}</div>
    </div>`;
}

// ═══════════════════════════════════════════
// AÇÕES DOS PEDIDOS
// ═══════════════════════════════════════════
function acceptOrder(id) {
  if (!db) return;
  db.ref(`pedidos/${id}`).update({
    kdsStatus: "accepted",
    acceptedAt: Date.now(),
  });
  showToast("✅ Pedido aceito!", "success");
}

function refuseOrder(id) {
  openConfirm(
    "❌",
    "Recusar pedido",
    "O pedido será recusado e movido ao histórico. Deseja continuar?",
    () => {
      const o = orders[id];
      if (!o || !db) return;
      archiveOrder(id, {
        ...o,
        kdsStatus: "refused",
        finalStatus: "refused",
        closedAt: Date.now(),
      });
      db.ref(`pedidos/${id}`).remove();
      knownOrderIds.delete(id);
      showToast("Pedido recusado e arquivado.", "error");
    },
    "Recusar",
  );
}

function completeOrder(id) {
  const o = orders[id];
  if (!o || !db) return;
  archiveOrder(id, {
    ...o,
    kdsStatus: "done",
    finalStatus: "done",
    closedAt: Date.now(),
  });
  db.ref(`pedidos/${id}`).remove();
  knownOrderIds.delete(id);
  showToast("🏁 Pedido concluído!", "success");
}

function cancelOrder(id) {
  openConfirm(
    "⚠️",
    "Cancelar pedido",
    "O pedido aceito será cancelado e movido ao histórico.",
    () => {
      const o = orders[id];
      if (!o || !db) return;
      archiveOrder(id, {
        ...o,
        kdsStatus: "cancelled",
        finalStatus: "cancelled",
        closedAt: Date.now(),
      });
      db.ref(`pedidos/${id}`).remove();
      knownOrderIds.delete(id);
      showToast("Pedido cancelado.", "error");
    },
    "Cancelar pedido",
  );
}

function archiveOrder(id, data) {
  if (!db) return;
  db.ref(`historicoPedidos/${id}`).set(data);
}

// ═══════════════════════════════════════════
// ESTATÍSTICAS
// ═══════════════════════════════════════════
function updateStats() {
  const list = Object.values(orders).filter((o) => !o.arquivado);
  const pending = list.filter(
    (o) => !o.kdsStatus || o.kdsStatus === "pending",
  ).length;
  const accepted = list.filter((o) => o.kdsStatus === "accepted").length;

  document.getElementById("stat-pending").textContent = pending;
  document.getElementById("stat-accepted").textContent = accepted;
  document.getElementById("badge-pending").textContent = pending + accepted;

  const today = new Date().toDateString();
  const doneToday = historyOrders.filter(
    (o) =>
      o.finalStatus === "done" &&
      new Date(o.closedAt || 0).toDateString() === today,
  );
  document.getElementById("stat-done").textContent = doneToday.length;

  // Tempo médio de preparo
  const tempoEl = document.getElementById("stat-avg-time");
  if (tempoEl) {
    const tempos = doneToday
      .filter((o) => o.acceptedAt && o.closedAt)
      .map((o) => (o.closedAt - o.acceptedAt) / 60000);
    tempoEl.textContent = tempos.length
      ? `${Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length)}min`
      : "—";
  }
}

// ═══════════════════════════════════════════
// IMPRESSÃO
// ═══════════════════════════════════════════
function printOrder(id, type) {
  const o = orders[id];
  if (!o) return;

  const num = o.numeroPedido || id.slice(-4).toUpperCase();
  const isClient = type === "client";

  const itensHtml = (o.itens || o.items || [])
    .map((item) => {
      const qty = item.quantidade || item.qty || 1;
      const name = item.nome || item.name;
      const opcao = item.opcao || item.opcaoSelecionada || "";
      const obs = item.observacoes || item.observacao || item.obs || "";
      const extras = (item.paidExtras || item.adicionais || [])
        .map(
          (ex) =>
            `<tr><td></td><td style="padding:1px 6px;color:#555;font-size:11px">＋ ${ex.nome || ex.name}</td></tr>`,
        )
        .join("");
      return `<tr>
      <td style="padding:2px 6px;font-weight:bold;vertical-align:top">${qty}×</td>
      <td style="padding:2px 6px">${name}${opcao ? ` (${opcao})` : ""}${obs ? `<br><small style="color:#555">${obs}</small>` : ""}</td>
    </tr>${extras}`;
    })
    .join("");

  const html = `
    <div style="font-family:monospace;font-size:13px;width:280px;padding:12px;color:#000;background:#fff">
      <div style="text-align:center;font-size:16px;font-weight:bold;margin-bottom:8px">
        ${isClient ? "── COMPROVANTE ──" : "── COMANDA COZINHA ──"}
      </div>
      <div style="border-top:1px dashed #000;border-bottom:1px dashed #000;padding:6px 0;margin:6px 0">
        <b>Pedido #${num}</b><br>
        ${isClient ? `Cliente: ${o.cliente || o.nomeCliente || ""}<br>` : ""}
        Tipo: ${o.tipo || o.tipoEntrega || "Retirada"}<br>
        ${isClient && (o.endereco || o.enderecoEntrega) ? `Endereço: ${o.endereco || o.enderecoEntrega}<br>` : ""}
        ${new Date().toLocaleString("pt-BR")}
      </div>
      <table style="width:100%;margin:6px 0">${itensHtml}</table>
      ${
        isClient
          ? `
        <div style="border-top:1px dashed #000;padding-top:6px;margin-top:6px">
          ${o.total ? `<b>Total: ${formatPrice(o.total)}</b><br>` : ""}
          ${o.taxaEntrega ? `Taxa de entrega: ${formatPrice(o.taxaEntrega)}<br>` : ""}
          ${o.formaPagamento ? `Pagamento: ${o.formaPagamento}` : ""}
        </div>`
          : ""
      }
      ${o.observacoes ? `<div style="border-top:1px dashed #000;margin-top:6px;padding-top:6px">⚠️ Obs: ${o.observacoes}</div>` : ""}
      <div style="text-align:center;margin-top:10px;font-size:11px">Burguerados Paulista</div>
    </div>`;

  const area = document.getElementById("print-area");
  area.innerHTML = html;
  area.style.display = "block";
  setTimeout(() => {
    window.print();
    area.style.display = "none";
  }, 150);
}

// ═══════════════════════════════════════════
// HISTÓRICO
// ═══════════════════════════════════════════
function applyHistoryFilter() {
  const start = document.getElementById("hist-date-start").value;
  const end = document.getElementById("hist-date-end").value;
  const status = document.getElementById("hist-status-filter").value;
  const type = document.getElementById("hist-type-filter").value;

  let filtered = [...historyOrders];
  if (start) {
    const s = new Date(start + "T00:00:00");
    filtered = filtered.filter(
      (o) => new Date(o.closedAt || o.timestamp || 0) >= s,
    );
  }
  if (end) {
    const e = new Date(end + "T23:59:59");
    filtered = filtered.filter(
      (o) => new Date(o.closedAt || o.timestamp || 0) <= e,
    );
  }
  if (status !== "all")
    filtered = filtered.filter((o) => o.finalStatus === status);
  if (type !== "all")
    filtered = filtered.filter(
      (o) => (o.tipo || o.tipoEntrega || "pickup") === type,
    );

  renderHistoryTable(filtered);
}

function renderHistoryTable(list) {
  const tbody = document.getElementById("history-tbody");
  const done = list.filter((o) => o.finalStatus === "done");
  const revenue = done.reduce((sum, o) => sum + (o.total || 0), 0);
  const avg = done.length ? revenue / done.length : 0;
  const refused = list.filter((o) => o.finalStatus === "refused").length;

  document.getElementById("hs-total").textContent = list.length;
  document.getElementById("hs-revenue").textContent = formatPrice(revenue);
  document.getElementById("hs-avg").textContent = formatPrice(avg);
  document.getElementById("hs-refused").textContent = refused;

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--text-muted);padding:30px">Nenhum registro encontrado.</td></tr>`;
    return;
  }

  const statusMap = {
    done: '<span class="status-pill pill-done">✅ Concluído</span>',
    refused: '<span class="status-pill pill-refused">✕ Recusado</span>',
    cancelled: '<span class="status-pill pill-cancelled">⊘ Cancelado</span>',
  };
  const typeLabel = {
    delivery: "🛵 Delivery",
    pickup: "🏪 Retirada",
    mesa: "🪑 Mesa",
  };

  tbody.innerHTML = list
    .map((o) => {
      const num = o.numeroPedido || o.id?.slice(-4)?.toUpperCase() || "??";
      const ts = o.closedAt || o.timestamp || 0;
      const time = ts
        ? new Date(ts).toLocaleString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          })
        : "—";
      const cliente = o.cliente || o.nomeCliente || "—";
      const tipo = typeLabel[o.tipo || o.tipoEntrega] || "—";
      const qtdItens = (o.itens || o.items || []).reduce(
        (s, i) => s + (i.quantidade || i.qty || 1),
        0,
      );
      const total = formatPrice(o.total || 0);
      const pill =
        statusMap[o.finalStatus] ||
        `<span class="status-pill">${o.finalStatus}</span>`;
      return `<tr>
      <td style="font-family:monospace;color:var(--orange)">#${num}</td>
      <td style="color:var(--text-dim)">${time}</td>
      <td style="font-weight:600">${cliente}</td>
      <td>${tipo}</td>
      <td style="color:var(--text-dim)">${qtdItens} item(s)</td>
      <td style="font-family:monospace;font-weight:600">${total}</td>
      <td>${pill}</td>
    </tr>`;
    })
    .join("");
}

// ═══════════════════════════════════════════
// GESTÃO DE CARDÁPIO
// ═══════════════════════════════════════════
async function loadCardapio() {
  // Try Firebase first, then fallback to JSON
  if (db) {
    try {
      const snap = await db.ref("cardapio").once("value");
      if (snap.val()) {
        cardapioRaw = snap.val();
        renderCardapio(cardapioRaw);
        // Listen for realtime updates
        db.ref("cardapio").on("value", (s) => {
          if (s.val()) {
            cardapioRaw = s.val();
            renderCardapio(cardapioRaw);
          }
        });
        return;
      }
    } catch (e) {
      /* fallthrough to JSON */
    }
  }
  try {
    const res = await fetch("cardapio.json");
    cardapioRaw = await res.json();
    renderCardapio(cardapioRaw);
    // If we have db now, seed it and listen
    if (db) {
      await db.ref("cardapio").set(cardapioRaw);
      db.ref("cardapio").on("value", (s) => {
        if (s.val()) {
          cardapioRaw = s.val();
          renderCardapio(cardapioRaw);
        }
      });
    }
  } catch (e) {
    document.getElementById("cardapio-content").innerHTML =
      `<p style="color:var(--red);text-align:center;margin-top:40px">⚠️ Não foi possível carregar o cardápio.</p>`;
  }
}

function renderCardapio(data, search = "") {
  const content = document.getElementById("cardapio-content");
  const q = search.toLowerCase();
  let html = "";

  for (const [cat, items] of Object.entries(data)) {
    const filtered = search
      ? items.filter(
          (i) =>
            i.nome.toLowerCase().includes(q) ||
            (i.descricao || "").toLowerCase().includes(q),
        )
      : items;
    if (!filtered.length) continue;

    const unavailCount = filtered.filter(
      (item) => menuAvailability[`${cat}:${item.nome}`] === false,
    ).length;

    html += `<div class="cat-section">
      <div class="cat-title">
        ${cat}
        ${unavailCount > 0 ? `<span class="cat-unavail-badge">${unavailCount} indisponível${unavailCount > 1 ? "is" : ""}</span>` : ""}
      </div>
      <div class="item-grid">`;

    filtered.forEach((item) => {
      const key = `${cat}:${item.nome}`;
      const available = menuAvailability[key] !== false;
      const price = Array.isArray(item.precoBase)
        ? item.precoBase[0]
        : item.precoBase;
      const discount = item.desconto || null;

      let priceHtml = "";
      if (discount) {
        const discVal =
          discount.tipo === "porcentagem"
            ? price * (1 - discount.valor / 100)
            : price - discount.valor;
        const discFinal = Math.max(0, discVal);
        priceHtml = `<div class="item-price-menu">
          <span class="price-original">${formatPrice(price)}</span>
          <span class="price-discount">${formatPrice(discFinal)}</span>
          <span class="discount-badge">${discount.tipo === "porcentagem" ? `-${discount.valor}%` : `-R$${discount.valor.toFixed(2).replace(".", ",")}`}</span>
        </div>`;
      } else {
        priceHtml = `<div class="item-price-menu">${formatPrice(price)}</div>`;
      }

      html += `
        <div class="menu-item-card ${available ? "" : "unavailable"}">
          <div class="item-info-menu">
            <div class="item-name-menu">${item.nome}</div>
            ${priceHtml}
            ${item.descricao ? `<div class="item-desc-menu">${item.descricao}</div>` : ""}
          </div>
          <div class="item-card-actions">
            <label class="toggle-switch">
              <input type="checkbox" ${available ? "checked" : ""} onchange="toggleMenuItem('${key}', this.checked)">
              <span class="toggle-slider"></span>
            </label>
            <button class="btn-edit-item" onclick="openEditModal('${encodeURIComponent(cat)}','${encodeURIComponent(item.nome)}')">✏️ Editar</button>
          </div>
        </div>`;
    });
    html += "</div></div>";
  }

  content.innerHTML =
    html ||
    '<p style="color:var(--text-muted);text-align:center;margin-top:40px">Nenhum item encontrado.</p>';
}

function filterCardapio(q) {
  if (cardapioRaw) renderCardapio(cardapioRaw, q);
}

function toggleMenuItem(key, available) {
  if (!db) {
    showToast("Firebase não conectado", "error");
    return;
  }
  db.ref(`menuAvailability/${key}`)
    .set(available)
    .then(() =>
      showToast(
        available ? "✅ Item disponibilizado" : "⊘ Item indisponibilizado",
      ),
    )
    .catch((err) => {
      showToast("❌ Erro: " + err.message, "error");
    });
}

// ─── EDIÇÃO DE ITEM DO CARDÁPIO ───────────────────────────────────────
let editTarget = null;

function openEditModal(catEnc, nomeEnc) {
  const cat = decodeURIComponent(catEnc);
  const nome = decodeURIComponent(nomeEnc);
  if (!cardapioRaw || !cardapioRaw[cat]) return;

  const idx = cardapioRaw[cat].findIndex((i) => i.nome === nome);
  if (idx < 0) return;
  const item = cardapioRaw[cat][idx];
  editTarget = { cat, idx };

  document.getElementById("edit-item-nome").value = item.nome || "";
  document.getElementById("edit-item-desc").value = item.descricao || "";

  const pricesWrap = document.getElementById("edit-prices-list");
  pricesWrap.innerHTML = "";
  const precos = Array.isArray(item.precoBase)
    ? item.precoBase
    : [item.precoBase];
  const opcoes = item.opcoes || ["Individual"];
  precos.forEach((p, i) => {
    pricesWrap.appendChild(buildOpcaoRow(opcoes[i] || "", p));
  });

  const discount = item.desconto || null;
  document.getElementById("edit-discount-active").checked = !!discount;
  document.getElementById("edit-discount-fields").style.display = discount
    ? "flex"
    : "none";
  if (discount) {
    document.getElementById("edit-discount-tipo").value =
      discount.tipo || "porcentagem";
    document.getElementById("edit-discount-valor").value = discount.valor || "";
  } else {
    document.getElementById("edit-discount-tipo").value = "porcentagem";
    document.getElementById("edit-discount-valor").value = "";
  }

  document.getElementById("modal-edit-item").classList.add("active");
}

function closeEditModal() {
  document.getElementById("modal-edit-item").classList.remove("active");
  editTarget = null;
}

function buildOpcaoRow(opcaoNome, preco) {
  const row = document.createElement("div");
  row.className = "edit-price-row";
  row.innerHTML = `
    <input type="text" class="form-input edit-opcao-nome" placeholder="Nome da opção" value="${opcaoNome}">
    <input type="number" class="form-input edit-price-input" min="0" step="0.5" placeholder="0,00" value="${preco}">
    <button type="button" class="btn-remove-opcao" onclick="removeOpcaoRow(this)" title="Remover opção">✕</button>`;
  return row;
}

function addOpcaoRow() {
  document
    .getElementById("edit-prices-list")
    .appendChild(buildOpcaoRow("", ""));
  updateDiscountLabel();
}

function removeOpcaoRow(btn) {
  const list = document.getElementById("edit-prices-list");
  if (list.children.length <= 1) {
    showToast("O item precisa ter ao menos uma opção", "error");
    return;
  }
  btn.closest(".edit-price-row").remove();
  updateDiscountLabel();
}

function saveEditItem() {
  if (!editTarget || !cardapioRaw) return;
  const { cat, idx } = editTarget;
  const item = { ...cardapioRaw[cat][idx] };

  const novoNome = document.getElementById("edit-item-nome").value.trim();
  const novaDesc = document.getElementById("edit-item-desc").value.trim();

  if (!novoNome) {
    showToast("Nome não pode ser vazio", "error");
    return;
  }

  const priceRows = document.querySelectorAll(
    "#edit-prices-list .edit-price-row",
  );
  if (priceRows.length === 0) {
    showToast("Adicione ao menos uma opção", "error");
    return;
  }

  const novasOpcoes = [];
  const novosPrecos = [];
  let opcaoInvalida = false;
  priceRows.forEach((row) => {
    const opcaoNome = row.querySelector(".edit-opcao-nome").value.trim();
    const preco = parseFloat(row.querySelector(".edit-price-input").value);
    if (!opcaoNome) {
      opcaoInvalida = true;
      return;
    }
    novasOpcoes.push(opcaoNome);
    novosPrecos.push(isNaN(preco) ? 0 : preco);
  });
  if (opcaoInvalida) {
    showToast("Preencha o nome de todas as opções", "error");
    return;
  }

  const discountActive = document.getElementById(
    "edit-discount-active",
  ).checked;
  let desconto = null;
  if (discountActive) {
    const tipo = document.getElementById("edit-discount-tipo").value;
    const valor = parseFloat(
      document.getElementById("edit-discount-valor").value,
    );
    if (!valor || valor <= 0) {
      showToast("Informe o valor do desconto", "error");
      return;
    }
    desconto = { tipo, valor };
  }

  const oldNome = item.nome;
  const oldKey = `${cat}:${oldNome}`;
  const newKey = `${cat}:${novoNome}`;

  cardapioRaw[cat][idx] = {
    ...item,
    nome: novoNome,
    descricao: novaDesc,
    opcoes: novasOpcoes,
    precoBase: novosPrecos,
    desconto: desconto,
  };

  if (!db) {
    showToast("Firebase não conectado", "error");
    return;
  }

  const updates = {};
  // Save the full cardapio object (category names are the keys)
  updates["cardapio"] = cardapioRaw;

  if (novoNome !== oldNome) {
    const wasAvail = menuAvailability[oldKey];
    if (wasAvail !== undefined) {
      updates[`menuAvailability/${newKey}`] = wasAvail;
      updates[`menuAvailability/${oldKey}`] = null;
    }
  }

  db.ref()
    .update(updates)
    .then(() => {
      showToast("✅ Item atualizado!", "success");
      closeEditModal();
    })
    .catch((err) => showToast("❌ Erro: " + err.message, "error"));
}

// Firebase keys cannot contain . # $ [ ] / — encode category names
function encodeCardapioKey(cat) {
  return cat.replace(/[.#$[\]/]/g, "_");
}

// ═══════════════════════════════════════════
// MODAL: NOVO PEDIDO
// ═══════════════════════════════════════════
function openNewOrderModal() {
  document.getElementById("modal-new-order").classList.add("active");
  document.getElementById("modal-items-list").innerHTML = "";
  document.getElementById("new-customer").value = "";
  document.getElementById("new-obs").value = "";
  document.getElementById("new-fee").value = "0";
  addItemRow();
  document.getElementById("new-type").onchange = function () {
    document.getElementById("new-address-row").style.display =
      this.value === "delivery" ? "grid" : "none";
  };
}

function closeNewOrderModal() {
  document.getElementById("modal-new-order").classList.remove("active");
}

function addItemRow() {
  const list = document.getElementById("modal-items-list");
  const row = document.createElement("div");
  row.className = "modal-item-row";

  let opts = "";
  if (cardapioRaw) {
    for (const items of Object.values(cardapioRaw)) {
      items.forEach((item) => {
        if (item.opcoes && item.opcoes.length > 1) {
          item.opcoes.forEach((op, i) => {
            const price = Array.isArray(item.precoBase)
              ? item.precoBase[i] || item.precoBase[0]
              : item.precoBase;
            opts += `<option value="${item.nome}|${op}|${price}">${item.nome} (${op}) — ${formatPrice(price)}</option>`;
          });
        } else {
          const price = Array.isArray(item.precoBase)
            ? item.precoBase[0]
            : item.precoBase;
          const op = item.opcoes ? item.opcoes[0] : "";
          opts += `<option value="${item.nome}|${op}|${price}">${item.nome} — ${formatPrice(price)}</option>`;
        }
      });
    }
  }

  row.innerHTML = `
    <select class="form-input-full item-select">${opts}</select>
    <input type="number" class="form-input-full modal-item-qty" min="1" value="1" title="Qtd">
    <input type="text" class="form-input-full" placeholder="Obs..." style="max-width:160px">
    <button class="btn-remove-item" onclick="this.closest('.modal-item-row').remove()">✕</button>`;
  list.appendChild(row);
}

function saveManualOrder() {
  const customer = document.getElementById("new-customer").value.trim();
  if (!customer) {
    showToast("Informe o nome do cliente", "error");
    return;
  }

  const rows = document.querySelectorAll("#modal-items-list .modal-item-row");
  if (rows.length === 0) {
    showToast("Adicione ao menos um item", "error");
    return;
  }

  const itens = [];
  let total = 0;
  rows.forEach((row) => {
    const sel = row.querySelector(".item-select");
    const qty = parseInt(row.querySelector(".modal-item-qty").value) || 1;
    const obs = row.querySelectorAll("input")[1]?.value || "";
    const [nome, opcao, precoStr] = sel.value.split("|");
    const preco = parseFloat(precoStr) || 0;
    itens.push({ nome, opcao, quantidade: qty, preco, observacoes: obs });
    total += preco * qty;
  });

  const fee = parseFloat(document.getElementById("new-fee").value) || 0;
  total += fee;
  const tipo = document.getElementById("new-type").value;
  const pagamento = document.getElementById("new-payment").value;
  const obs = document.getElementById("new-obs").value.trim();
  const address = document.getElementById("new-address").value.trim();

  orderCounter++;
  if (db) db.ref("config/orderCounter").set(orderCounter);
  const num = String(orderCounter).padStart(3, "0");

  const pedido = {
    numeroPedido: num,
    cliente: customer,
    nomeCliente: customer,
    tipo,
    tipoEntrega: tipo,
    itens,
    total,
    taxaEntrega: fee,
    formaPagamento: pagamento,
    observacoes: obs,
    endereco: address,
    timestamp: Date.now(),
    kdsStatus: "pending",
    origem: "manual",
  };

  if (db) {
    db.ref("pedidos")
      .push(pedido)
      .then(() => {
        showToast("✅ Pedido criado!", "success");
        closeNewOrderModal();
      })
      .catch(() => showToast("Erro ao criar pedido", "error"));
  } else {
    const id = "manual_" + Date.now();
    orders[id] = { id, ...pedido };
    renderKDS();
    updateStats();
    showToast("✅ Pedido criado (offline)", "success");
    closeNewOrderModal();
  }
}

// ═══════════════════════════════════════════
// MODAL: CONFIRMAÇÃO
// ═══════════════════════════════════════════
function openConfirm(icon, title, msg, callback, okLabel = "Confirmar") {
  document.getElementById("confirm-icon").textContent = icon;
  document.getElementById("confirm-title").textContent = title;
  document.getElementById("confirm-msg").textContent = msg;
  document.getElementById("confirm-ok").textContent = okLabel;
  confirmCallback = callback;
  document.getElementById("confirm-modal").classList.add("active");
}

function closeConfirm() {
  document.getElementById("confirm-modal").classList.remove("active");
  confirmCallback = null;
}

function confirmAction() {
  if (confirmCallback) confirmCallback();
  closeConfirm();
}

// ═══════════════════════════════════════════
// TOAST
// ═══════════════════════════════════════════
function showToast(msg, type = "") {
  const c = document.getElementById("toast-container");
  const t = document.createElement("div");
  t.className = "toast" + (type ? " " + type : "");
  t.textContent = msg;
  c.appendChild(t);
  setTimeout(() => t.remove(), 3500);
}

// ═══════════════════════════════════════════
// UTILS
// ═══════════════════════════════════════════
function formatPrice(val) {
  return "R$ " + (parseFloat(val) || 0).toFixed(2).replace(".", ",");
}

// BUG FIX #9: Sanitização contra XSS — escapa caracteres HTML em strings de usuário
function sanitize(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function setDefaultDates() {
  const today = new Date();
  const prior = new Date();
  prior.setDate(prior.getDate() - 7);
  const fmt = (d) => d.toISOString().slice(0, 10);
  document.getElementById("hist-date-start").value = fmt(prior);
  document.getElementById("hist-date-end").value = fmt(today);
}

function updateDiscountLabel() {
  const tipo = document.getElementById("edit-discount-tipo");
  const valorEl = document.getElementById("edit-discount-valor");
  const preview = document.getElementById("edit-discount-preview");
  if (!tipo || !valorEl) return;

  document.getElementById("edit-discount-valor-label").textContent =
    tipo.value === "porcentagem" ? "VALOR (%)" : "VALOR (R$)";

  const valor = parseFloat(valorEl.value);
  if (!valor || !preview) {
    if (preview) preview.textContent = "";
    return;
  }

  const firstPrice = document.querySelector(
    "#edit-prices-list .edit-price-input",
  );
  if (!firstPrice) return;
  const preco = parseFloat(firstPrice.value) || 0;

  const final =
    tipo.value === "porcentagem" ? preco * (1 - valor / 100) : preco - valor;

  preview.innerHTML = `Preço base: <b>${formatPrice(preco)}</b> → Com desconto: <b style="color:var(--green)">${formatPrice(Math.max(0, final))}</b>`;
}

// ═══════════════════════════════════════════
// BOOT
// ═══════════════════════════════════════════
setDefaultDates();
loadCardapio();
initFirebase();
