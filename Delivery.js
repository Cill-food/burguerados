// ================================================================
// DELIVERY.JS — Ribbs ZN
// Script principal para pedidos.html (Delivery / Retirada)
// Substitui app.js na página de pedidos online.
// ================================================================

// ================================
// WELCOME MODAL
// ================================
const WelcomeModal = {
  init() {
    const modal = document.getElementById("welcome-modal");
    const closeBtn = document.getElementById("btn-welcome-close");

    modal.classList.remove("hidden");
    document.body.style.overflow = "hidden";

    closeBtn.addEventListener("click", () => {
      modal.classList.add("closing");
      setTimeout(() => {
        modal.classList.add("hidden");
        modal.classList.remove("closing");
        document.body.style.overflow = "auto";
      }, 800);
    });
  },
};

// ================================
// CONFIGURAÇÃO
// ================================
const CONFIG = {
  whatsappNumber: "5581996469626",
  menuDataUrl: "cardapio.json",
  firebaseConfig: {
    apiKey: "AIzaSyD3A4S7qaX-d6XjuGNRJ_GJZCPSED4Avis",
    authDomain: "burgueradospaulista.firebaseapp.com",
    databaseURL: "https://burgueradospaulista-default-rtdb.firebaseio.com",
    projectId: "burgueradospaulista",
    storageBucket: "burgueradospaulista.firebasestorage.app",
    messagingSenderId: "979247036551",
    appId: "1:979247036551:web:06cda0842b882987eaa022",
  },
};

// ================================
// FIREBASE
// ================================
let database = null;

async function initFirebase() {
  try {
    if (typeof firebase === "undefined") {
      console.warn("⚠️ Firebase não carregado — pedidos não irão ao KDS");
      return;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(CONFIG.firebaseConfig);
    }

    database = firebase.database();

    // Reenviar fila offline automaticamente ao reconectar
    database.ref(".info/connected").on("value", (snap) => {
      if (snap.val() === true) {
        console.log("🌐 Firebase reconectado — verificando fila offline...");
        setTimeout(() => OrderSender._flushOfflineQueue(), 1000);
      }
    });

    // Auth anônima obrigatória pelas regras do Firebase
    const auth = firebase.auth();
    if (!auth.currentUser) {
      try {
        await auth.signInAnonymously();
        console.log("✅ Autenticação anônima realizada");
      } catch (authError) {
        console.warn("⚠️ Autenticação anônima falhou:", authError.message);
      }
    }

    console.log("✅ Firebase inicializado");
  } catch (error) {
    console.error("❌ Erro ao inicializar Firebase:", error);
  }
}

// ================================
// ESTADO DA APLICAÇÃO
// ================================
const AppState = {
  cardapioData: null,
  cart: [],
  deliveryType: "pickup",
  deliveryFee: 0,
  selectedNeighborhood: null,

  // Disponibilidade
  ingredientsAvailability: {},
  paidExtrasAvailability: {},
  menuAvailability: {},

  // Controle de combos
  isCombo: false,
  isFullCombo: false,
  comboData: null,
  currentBurgerIndex: 0,
  comboItems: [],
  isProcessingUpgrades: false,

  // Controle de steps
  currentStep: 0,
  stepsData: [],
  tempItem: {},
};

// ================================
// UTILITÁRIOS
// ================================
const Utils = {
  sanitizeHTML(str) {
    const div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  },

  formatPrice(value) {
    return `R$ ${value.toFixed(2).replace(".", ",")}`;
  },

  getExtras(item) {
    return item.paidExtras || item.adicionais || item.extras || [];
  },

  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      clearTimeout(timeout);
      timeout = setTimeout(() => func.apply(this, args), wait);
    };
  },
};

function showToast(message) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

// ================================
// DOM HELPERS
// ================================
const DOM = {
  get(selector) {
    return document.querySelector(selector);
  },

  getAll(selector) {
    return document.querySelectorAll(selector);
  },

  create(tag, className, attributes = {}) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    Object.entries(attributes).forEach(([key, value]) => {
      element.setAttribute(key, value);
    });
    return element;
  },

  elements: {
    get menuContainer() {
      return DOM.get("[data-menu-container]");
    },
    get searchInput() {
      return DOM.get("[data-search-input]");
    },
    get categoriesContainer() {
      return DOM.get("[data-categories-container]");
    },
    get modal() {
      return DOM.get("[data-modal]");
    },
    get modalTitle() {
      return DOM.get("[data-modal-title]");
    },
    get modalBody() {
      return DOM.get("[data-modal-body]");
    },
    get progressDots() {
      return DOM.get("[data-progress-dots]");
    },
    get btnBack() {
      return DOM.get("[data-btn-back]");
    },
    get btnNext() {
      return DOM.get("[data-btn-next]");
    },
    get sidebar() {
      return DOM.get("[data-sidebar]");
    },
    get cartItems() {
      return DOM.get("[data-cart-items]");
    },
    get totalCart() {
      return DOM.get("[data-total-cart]");
    },
    get cartCount() {
      return DOM.get("[data-cart-count]");
    },
    get overlay() {
      return DOM.get("[data-overlay]");
    },
    get checkoutForm() {
      return DOM.get("[data-checkout-form]");
    },
    get deliveryFields() {
      return DOM.get("[data-delivery-fields]");
    },
    get changeField() {
      return DOM.get("[data-change-field]");
    },
  },
};

// ================================
// MENU SERVICE
// ================================
const MenuService = {
  async loadMenu() {
    try {
      const response = await fetch(CONFIG.menuDataUrl);
      if (!response.ok) throw new Error("Erro ao carregar cardápio");
      return await response.json();
    } catch (error) {
      console.error("Erro ao carregar cardápio:", error);
      throw error;
    }
  },

  listenToLojaStatus() {
    if (!database) return;

    database.ref("config/lojaAberta").on("value", (snapshot) => {
      const aberta = snapshot.val() !== false;
      let banner = document.getElementById("loja-fechada-banner");

      if (!aberta) {
        if (!banner) {
          banner = document.createElement("div");
          banner.id = "loja-fechada-banner";
          banner.style.cssText = [
            "position:fixed",
            "top:0",
            "left:0",
            "right:0",
            "z-index:9998",
            "background:#ef4444",
            "color:#fff",
            "text-align:center",
            "padding:12px 16px",
            "font-weight:700",
            "font-size:14px",
            "letter-spacing:0.3px",
            "box-shadow:0 2px 12px rgba(0,0,0,0.4)",
          ].join(";");
          banner.textContent =
            "🔴 Loja fechada no momento — não estamos aceitando pedidos";
          document.body.prepend(banner);
        }
        // Desabilita o botão de finalizar
        const btnFinalizar = document.getElementById("btn-finalizar-pedido");
        if (btnFinalizar) {
          btnFinalizar.disabled = true;
          btnFinalizar.style.opacity = "0.5";
          btnFinalizar.style.cursor = "not-allowed";
          btnFinalizar.title = "Loja fechada";
        }
      } else {
        if (banner) banner.remove();
        const btnFinalizar = document.getElementById("btn-finalizar-pedido");
        if (btnFinalizar) {
          btnFinalizar.disabled = false;
          btnFinalizar.style.opacity = "";
          btnFinalizar.style.cursor = "";
          btnFinalizar.title = "";
        }
      }
    });
  },

  listenToAvailability() {
    if (!database) return;

    database.ref("menuAvailability").on("value", (snapshot) => {
      AppState.menuAvailability = snapshot.val() || {};
      CartManager.checkAndRemoveUnavailableItems();
      if (AppState.cardapioData) MenuUI.render(AppState.cardapioData);
      console.log("✅ Disponibilidade de menu atualizada");
    });
  },

  listenToIngredientsAvailability() {
    if (!database) return;

    database.ref("ingredientsAvailability").on("value", (snapshot) => {
      AppState.ingredientsAvailability = snapshot.val() || {};
      console.log("📦 Disponibilidade de ingredientes atualizada");
    });

    database.ref("paidExtrasAvailability").on("value", (snapshot) => {
      AppState.paidExtrasAvailability = snapshot.val() || {};
      console.log("💰 Disponibilidade de adicionais pagos atualizada");

      // Se modal de extras estiver aberto, atualizar ao vivo
      const modal = DOM.elements.modal;
      if (modal && modal.classList.contains("active")) {
        const step = AppState.stepsData[AppState.currentStep];
        if (step && step.type === "extras") {
          if (AppState.tempItem.added?.length) {
            AppState.tempItem.added = AppState.tempItem.added.filter(
              (a) => AppState.paidExtrasAvailability[a.nome] !== false,
            );
          }
          const availableNow = step.data.filter(
            (e) => AppState.paidExtrasAvailability[e.nome] !== false,
          );
          OrderFlow.renderExtras(
            DOM.elements.modalTitle,
            DOM.elements.modalBody,
            availableNow,
            step.burgerName,
          );
        }
      }

      if (AppState.cardapioData) MenuUI.render(AppState.cardapioData);
    });
  },

  listenToPriceChanges() {
    if (!database) return;

    database.ref("cardapio").on("value", (snapshot) => {
      const firebaseMenu = snapshot.val();
      if (!firebaseMenu || !AppState.cardapioData) return;

      let pricesUpdated = false;

      Object.entries(firebaseMenu).forEach(([category, items]) => {
        if (AppState.cardapioData[category]) {
          items.forEach((firebaseItem, index) => {
            const localItem = AppState.cardapioData[category][index];
            if (localItem && firebaseItem.precoBase !== undefined) {
              const oldPrice = JSON.stringify(localItem.precoBase);
              const newPrice = JSON.stringify(firebaseItem.precoBase);
              if (oldPrice !== newPrice) {
                localItem.precoBase = firebaseItem.precoBase;
                pricesUpdated = true;
                console.log(`💰 Preço atualizado: ${localItem.nome}`);
              }
            }
          });
        }
      });

      if (pricesUpdated && AppState.cardapioData) {
        MenuUI.render(AppState.cardapioData);
        showToast("💰 Preços atualizados!");
      }
    });
  },

  async syncPricesFromFirebase() {
    if (!database) return;

    try {
      const snapshot = await database.ref("cardapio").once("value");
      const firebaseMenu = snapshot.val();
      if (!firebaseMenu || !AppState.cardapioData) return;

      Object.entries(firebaseMenu).forEach(([category, items]) => {
        if (AppState.cardapioData[category]) {
          items.forEach((firebaseItem, index) => {
            const localItem = AppState.cardapioData[category][index];
            if (localItem && firebaseItem.precoBase !== undefined) {
              localItem.precoBase = firebaseItem.precoBase;
            }
          });
        }
      });

      console.log("✅ Preços sincronizados do Firebase");
    } catch (error) {
      console.error("❌ Erro ao sincronizar preços:", error);
    }
  },
};

// ================================
// CART MANAGER
// ================================
const CartManager = {
  add(item) {
    if (item.categoria && item.nome) {
      const itemKey = `${item.categoria}:${item.nome}`;
      if (AppState.menuAvailability[itemKey] === false) {
        showToast("❌ Item indisponível no momento");
        return;
      }
    }

    const existingIndex = AppState.cart.findIndex(
      (cartItem) =>
        cartItem.nome === item.nome &&
        cartItem.selectedSize === item.selectedSize &&
        JSON.stringify(cartItem.selectedCaldas) ===
          JSON.stringify(item.selectedCaldas) &&
        JSON.stringify(cartItem.removed) === JSON.stringify(item.removed),
    );

    if (existingIndex > -1) {
      AppState.cart[existingIndex].quantity =
        (AppState.cart[existingIndex].quantity || 1) + 1;
    } else {
      AppState.cart.push({ ...item, quantity: 1 });
    }

    showToast(`✅ ${item.nome} adicionado ao carrinho`);
    this.update();
  },

  updateQuantity(index, change) {
    const item = AppState.cart[index];
    if (!item) return;

    if (change > 0 && item.categoria && item.nome) {
      const itemKey = `${item.categoria}:${item.nome}`;
      if (AppState.menuAvailability[itemKey] === false) {
        showToast("❌ Item indisponível no momento");
        this.remove(index);
        return;
      }
    }

    item.quantity = (item.quantity || 1) + change;
    if (item.quantity < 1) {
      this.remove(index);
    } else {
      this.update();
    }
  },

  remove(index) {
    AppState.cart.splice(index, 1);
    this.update();
  },

  clear() {
    AppState.cart = [];
    this.update();
  },

  getTotal() {
    const cartTotal = AppState.cart.reduce((sum, item) => {
      return sum + item.finalPrice * (item.quantity || 1);
    }, 0);

    const deliveryFee =
      AppState.deliveryType === "delivery" &&
      AppState.selectedNeighborhood?.value !== "campo-grande"
        ? AppState.deliveryFee
        : 0;

    return cartTotal + deliveryFee;
  },

  update() {
    CartUI.render();
  },

  checkAndRemoveUnavailableItems() {
    const removedItems = [];

    AppState.cart = AppState.cart.filter((item) => {
      if (item.categoria && item.nome) {
        const itemKey = `${item.categoria}:${item.nome}`;
        if (AppState.menuAvailability[itemKey] === false) {
          removedItems.push(item.nome);
          return false;
        }
      }
      return true;
    });

    if (removedItems.length > 0) {
      showToast(
        `⚠️ Itens removidos (indisponíveis): ${removedItems.join(", ")}`,
      );
      this.update();
    }
  },
};

// ================================
// CATEGORIES UI
// ================================
const CategoriesUI = {
  render(categories) {
    const container = DOM.elements.categoriesContainer;
    container.innerHTML = "";

    categories.forEach((category) => {
      const btn = DOM.create("button", "category-btn", {
        "data-category": category,
      });
      btn.textContent = category;
      btn.addEventListener("click", () => this.scrollToCategory(category));
      container.appendChild(btn);
    });

    setTimeout(() => {
      const firstBtn = container.querySelector(".category-btn");
      if (firstBtn) firstBtn.classList.add("active");
    }, 100);
  },

  scrollToCategory(categoryName) {
    const section = DOM.get(`[data-category-section="${categoryName}"]`);
    const carousel = DOM.get(".categories-carousel");
    const btn = DOM.get(`.category-btn[data-category="${categoryName}"]`);

    if (section) section.scrollIntoView({ behavior: "smooth", block: "start" });

    DOM.getAll(".category-btn").forEach((b) => b.classList.remove("active"));
    if (btn) {
      btn.classList.add("active");
      const scrollPosition =
        btn.offsetLeft - carousel.offsetWidth / 2 + btn.offsetWidth / 2;
      carousel.scrollTo({ left: scrollPosition, behavior: "smooth" });
    }
  },

  updateActiveOnScroll: Utils.debounce(() => {
    const sections = DOM.getAll(".category-section");
    const scrollPos = window.scrollY + 250;

    sections.forEach((section) => {
      const sectionTop = section.offsetTop;
      const sectionBottom = sectionTop + section.offsetHeight;
      const categoryName = section.getAttribute("data-category-section");
      const btn = DOM.get(`.category-btn[data-category="${categoryName}"]`);

      if (scrollPos >= sectionTop && scrollPos < sectionBottom) {
        DOM.getAll(".category-btn").forEach((b) =>
          b.classList.remove("active"),
        );
        if (btn) btn.classList.add("active");
      }
    });
  }, 100),
};

// ================================
// MENU UI
// ================================
const MenuUI = {
  render(data) {
    const container = DOM.elements.menuContainer;
    container.innerHTML = "";

    Object.entries(data).forEach(([category, items]) => {
      const section = this.createCategorySection(category, items);
      container.appendChild(section);
    });
  },

  createCategorySection(category, items) {
    const section = DOM.create("section", "category-section", {
      "data-category-section": category,
    });

    const title = DOM.create("h2", "category-title");
    title.textContent = category;
    section.appendChild(title);

    const grid = DOM.create("div", "grid");
    items.forEach((item) => {
      const card = this.createProductCard(item, category);
      grid.appendChild(card);
    });

    section.appendChild(grid);
    return section;
  },

  createProductCard(item, category) {
    const card = DOM.create("div", "card");
    card.dataset.category = category;
    card.dataset.itemName = item.nome;

    const img = DOM.create("img");
    img.src = item.img || this.getPlaceholderImage();
    img.onerror = () => (img.src = this.getPlaceholderImage());

    const info = DOM.create("div", "info");

    const textDiv = DOM.create("div");
    const h3 = DOM.create("h3");
    h3.textContent = item.nome;
    const p = DOM.create("p");
    p.textContent = item.descricao || "";

    textDiv.appendChild(h3);
    textDiv.appendChild(p);

    const optionsContainer = DOM.create("div", "options-container");

    const itemKey = `${category}:${item.nome}`;
    const isItemAvailable = AppState.menuAvailability[itemKey] !== false;

    if (item.opcoes && Array.isArray(item.opcoes)) {
      item.opcoes.forEach((size, index) => {
        const price = item.precoBase?.[index] || 0;
        const btn = DOM.create("button", "opt-btn");

        const optionKey = `${category}:${item.nome}:${size}`;
        const isOptionAvailable =
          isItemAvailable && AppState.menuAvailability[optionKey] !== false;

        if (!isOptionAvailable) {
          btn.disabled = true;
          btn.style.opacity = "0.5";
          btn.style.cursor = "not-allowed";
          btn.style.background = "#666";
          btn.innerHTML = `${size}<span class="price-tag">Indisponível</span>`;
        } else {
          const originalPrice = item.precoOriginal?.[index] ?? null;
          const priceHtml = originalPrice
            ? `<span class="price-tag price-tag--promo">
                <span class="preco-antigo">${Utils.formatPrice(originalPrice)}</span>
                <span class="preco-promocional">${Utils.formatPrice(price)}</span>
               </span>`
            : `<span class="price-tag">${Utils.formatPrice(price)}</span>`;
          btn.innerHTML = `${size}${priceHtml}`;
          btn.addEventListener("click", () =>
            OrderFlow.start(item, category, size, price),
          );
        }

        optionsContainer.appendChild(btn);
      });
    }

    info.appendChild(textDiv);
    info.appendChild(optionsContainer);

    if (!isItemAvailable) {
      card.classList.add("unavailable");
      card.style.opacity = "0.5";
      card.style.pointerEvents = "none";
      card.style.filter = "grayscale(80%)";

      const unavailableTag = DOM.create("div", "unavailable-tag");
      unavailableTag.textContent = "⚠️ Indisponível";
      unavailableTag.style.cssText = `
        color: #f44336; font-weight: bold; font-size: 0.85rem;
        margin-top: 8px; background: rgba(244,67,54,0.1);
        padding: 4px 10px; border-radius: 5px; border: 1px solid #f44336;
      `;
      info.appendChild(unavailableTag);
    }

    card.appendChild(img);
    card.appendChild(info);
    return card;
  },

  getPlaceholderImage() {
    return "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100' height='100'%3E%3Crect fill='%23333' width='100' height='100'/%3E%3Ctext fill='%23666' x='50%25' y='50%25' text-anchor='middle' dy='.3em' font-family='Arial' font-size='14'%3ESem imagem%3C/text%3E%3C/svg%3E";
  },

  renderError() {
    DOM.elements.menuContainer.innerHTML = `
      <div class="error-message">
        <h3>Erro ao carregar o cardápio 😕</h3>
        <p>Não foi possível carregar os itens. Tente novamente.</p>
        <button onclick="location.reload()">Recarregar Página</button>
      </div>
    `;
  },
};

// ================================
// ORDER FLOW
// ================================
const OrderFlow = {
  start(item, category, selectedSize, selectedPrice) {
    const itemKey = `${category}:${item.nome}`;
    if (AppState.menuAvailability[itemKey] === false) {
      showToast("❌ Este item está indisponível no momento");
      return;
    }

    if (selectedSize && selectedSize !== item.nome) {
      const optionKey = `${category}:${item.nome}:${selectedSize}`;
      if (AppState.menuAvailability[optionKey] === false) {
        showToast(`❌ A opção "${selectedSize}" está indisponível no momento`);
        return;
      }
    }

    if (item.combo && category === "Combos" && item.upgrades) {
      this.startFullCombo(item, category, selectedSize, selectedPrice);
    } else if (item.combo && item.burgers?.length > 0) {
      this.startSimpleCombo(item, category, selectedSize, selectedPrice);
    } else {
      this.startSingleItem(item, category, selectedSize, selectedPrice);
    }
  },

  startSingleItem(item, category, selectedSize, selectedPrice) {
    AppState.isCombo = false;
    AppState.isFullCombo = false;
    AppState.tempItem = {
      nome: item.nome,
      img: item.img,
      categoria: category,
      selectedSize,
      selectedPrice,
      opcoes: item.opcoes,
      meatPoint: null,
      selectedCaldas: [],
      removed: [],
      added: [],
      obs: "",
      finalPrice: selectedPrice,
    };

    AppState.stepsData = this.buildStepsForItem(item, selectedSize);
    AppState.currentStep = 0;

    if (AppState.stepsData.length === 0) {
      CartManager.add(AppState.tempItem);
      return;
    }

    ModalUI.open();
    this.renderCurrentStep();
  },

  startSimpleCombo(item, category, selectedSize, selectedPrice) {
    AppState.isCombo = true;
    AppState.isFullCombo = false;
    AppState.comboData = {
      nomeCombo: item.nome,
      categoria: category,
      selectedSize,
      basePrice: selectedPrice,
      itemRef: item,
    };
    AppState.currentBurgerIndex = 0;
    AppState.comboItems = [];
    this.startNextBurgerInCombo();
  },

  startFullCombo(item, category, selectedSize, selectedPrice) {
    AppState.isCombo = true;
    AppState.isFullCombo = true;
    AppState.comboData = {
      nomeCombo: item.nome,
      categoria: category,
      selectedSize,
      basePrice: selectedPrice,
      itemRef: item,
      upgrades: item.upgrades,
    };
    AppState.currentBurgerIndex = 0;
    AppState.comboItems = [];
    this.startNextBurgerInCombo();
  },

  startNextBurgerInCombo() {
    const burger =
      AppState.comboData.itemRef.burgers[AppState.currentBurgerIndex];
    AppState.tempItem = {
      nome: burger.nome,
      img: burger.img || AppState.comboData.itemRef.img,
      categoria: AppState.comboData.categoria,
      selectedSize: AppState.comboData.selectedSize,
      selectedPrice: 0,
      meatPoint: null,
      selectedCaldas: [],
      removed: [],
      added: [],
      obs: "",
      finalPrice: 0,
    };

    AppState.stepsData = this.buildStepsForItem(
      burger,
      AppState.comboData.selectedSize,
    ).map((step) => ({ ...step, burgerName: burger.nome }));
    AppState.currentStep = 0;

    ModalUI.open();
    this.renderCurrentStep();
  },

  buildStepsForItem(item, selectedSize) {
    const steps = [];

    if (item.pontoCarne) {
      steps.push({ type: "meatPoint", data: item.pontoCarne });
    }

    if (item.caldas && Array.isArray(item.caldas)) {
      steps.push({ type: "caldas", data: item.caldas });
    }

    let ingredients = [];
    if (item.ingredientesPorOpcao?.[selectedSize]) {
      ingredients = item.ingredientesPorOpcao[selectedSize];
    } else if (item.ingredientesPadrao) {
      ingredients = item.ingredientesPadrao;
    } else {
      if (Array.isArray(item.retiradas)) ingredients.push(...item.retiradas);
      if (Array.isArray(item.ingredientes))
        ingredients.push(...item.ingredientes);
      if (Array.isArray(item.simplesIngredients))
        ingredients.push(...item.simplesIngredients);
      if (Array.isArray(item.duploIngredients))
        ingredients.push(...item.duploIngredients);
    }

    const uniqueIngredients = [...new Set(ingredients)].filter(
      (i) => i?.trim() !== "",
    );
    if (uniqueIngredients.length > 0) {
      steps.push({ type: "retiradas", data: uniqueIngredients });
    }

    const extras = Utils.getExtras(item);
    const availableExtras = extras.filter(
      (e) => AppState.paidExtrasAvailability[e.nome] !== false,
    );
    if (availableExtras.length > 0) {
      steps.push({ type: "extras", data: availableExtras });
    }

    steps.push({ type: "observacoes" });
    return steps;
  },

  renderCurrentStep() {
    const step = AppState.stepsData[AppState.currentStep];
    const { modalTitle, modalBody, progressDots, btnBack, btnNext } =
      DOM.elements;

    progressDots.innerHTML = AppState.stepsData
      .map(
        (_, i) =>
          `<div class="dot ${i === AppState.currentStep ? "active" : ""}"></div>`,
      )
      .join("");

    btnBack.style.display = AppState.currentStep > 0 ? "block" : "none";

    const isLastStep = AppState.currentStep === AppState.stepsData.length - 1;
    const isLastBurger =
      AppState.isCombo &&
      AppState.currentBurgerIndex ===
        AppState.comboData.itemRef.burgers.length - 1;

    if (AppState.isProcessingUpgrades) {
      btnNext.textContent = isLastStep
        ? "ADICIONAR COMBO AO CARRINHO"
        : "PRÓXIMO";
    } else if (AppState.isCombo) {
      if (isLastStep && isLastBurger) {
        btnNext.textContent = AppState.isFullCombo
          ? "PRÓXIMO"
          : "ADICIONAR COMBO AO CARRINHO";
      } else if (isLastStep) {
        btnNext.textContent = "PRÓXIMO ITEM DO COMBO";
      } else {
        btnNext.textContent = "PRÓXIMO";
      }
    } else {
      btnNext.textContent = isLastStep ? "ADICIONAR AO CARRINHO" : "PRÓXIMO";
    }

    switch (step.type) {
      case "meatPoint":
        this.renderMeatPoint(modalTitle, modalBody, step.data, step.burgerName);
        break;
      case "caldas":
        this.renderCaldas(modalTitle, modalBody, step.data, step.burgerName);
        break;
      case "retiradas":
        this.renderRetiradas(modalTitle, modalBody, step.data, step.burgerName);
        break;
      case "extras":
        this.renderExtras(modalTitle, modalBody, step.data, step.burgerName);
        break;
      case "observacoes":
        this.renderObservacoes(modalTitle, modalBody, step.burgerName);
        break;
      case "batataUpgrade":
        this.renderBatataUpgrade(modalTitle, modalBody, step.data);
        break;
      case "bebidaUpgrade":
        this.renderBebidaUpgrade(modalTitle, modalBody, step.data);
        break;
    }
  },

  renderMeatPoint(title, body, options, burgerName) {
    const displayName = burgerName || AppState.tempItem.nome;
    title.textContent = `${displayName} - Ponto da Carne 🥩`;
    body.innerHTML = options
      .map(
        (opt, i) => `
        <div class="option-row">
          <label for="meat-${i}" style="flex:1;cursor:pointer;">${opt}</label>
          <input type="radio" id="meat-${i}" name="meatPoint" value="${opt}"
            ${AppState.tempItem.meatPoint === opt ? "checked" : ""}>
        </div>
      `,
      )
      .join("");
    body.querySelectorAll("input").forEach((input) => {
      input.onchange = (e) => (AppState.tempItem.meatPoint = e.target.value);
    });
  },

  renderCaldas(title, body, options, burgerName) {
    const displayName = burgerName || AppState.tempItem.nome;
    title.textContent = `${displayName} - Escolha a Calda 🍯`;
    if (!AppState.tempItem.selectedCaldas)
      AppState.tempItem.selectedCaldas = [];

    body.innerHTML = options
      .map(
        (opt, i) => `
        <div class="option-row">
          <label for="calda-${i}" style="flex:1;cursor:pointer;">${opt}</label>
          <input type="radio" name="calda-selection" id="calda-${i}" value="${opt}"
            ${AppState.tempItem.selectedCaldas.includes(opt) ? "checked" : ""}>
        </div>
      `,
      )
      .join("");

    body.querySelectorAll("input[type='radio']").forEach((input) => {
      input.onchange = (e) => {
        AppState.tempItem.selectedCaldas = [e.target.value];
      };
    });
  },

  renderRetiradas(title, body, ingredients, burgerName) {
    const displayName = burgerName || AppState.tempItem.nome;
    title.textContent = `${displayName} - Retirar Ingredientes ❌`;
    if (!AppState.tempItem.removed) AppState.tempItem.removed = [];

    const availableIngredients = ingredients.filter(
      (ing) => AppState.ingredientsAvailability[ing] !== false,
    );

    if (availableIngredients.length === 0) {
      body.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);">
        <p>Nenhum ingrediente disponível para retirar no momento.</p></div>`;
      return;
    }

    body.innerHTML = availableIngredients
      .map(
        (ing, i) => `
        <div class="option-row">
          <label for="remove-${i}" style="flex:1;cursor:pointer;">${ing}</label>
          <input type="checkbox" id="remove-${i}" value="${ing}"
            ${AppState.tempItem.removed.includes(ing) ? "checked" : ""}>
        </div>
      `,
      )
      .join("");

    body.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.onchange = (e) => {
        const value = e.target.value;
        if (e.target.checked) {
          if (!AppState.tempItem.removed.includes(value))
            AppState.tempItem.removed.push(value);
        } else {
          const idx = AppState.tempItem.removed.indexOf(value);
          if (idx > -1) AppState.tempItem.removed.splice(idx, 1);
        }
      };
    });
  },

  renderExtras(title, body, extras, burgerName) {
    const displayName = burgerName || AppState.tempItem.nome;
    title.textContent = `${displayName} - Adicionais Pagos 💰`;
    if (!AppState.tempItem.added) AppState.tempItem.added = [];

    const availableExtras = extras.filter(
      (extra) => AppState.paidExtrasAvailability[extra.nome] !== false,
    );

    if (availableExtras.length === 0) {
      body.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-muted);">
        <p>Nenhum adicional disponível no momento.</p></div>`;
      return;
    }

    body.innerHTML = availableExtras
      .map(
        (extra, i) => `
        <div class="option-row">
          <label for="extra-${i}" style="flex:1;cursor:pointer;">
            ${extra.nome} <span style="color:var(--primary);">+ ${Utils.formatPrice(extra.preco)}</span>
          </label>
          <input type="checkbox" id="extra-${i}" value="${i}"
            ${AppState.tempItem.added.some((a) => a.nome === extra.nome) ? "checked" : ""}>
        </div>
      `,
      )
      .join("");

    body.querySelectorAll("input[type='checkbox']").forEach((input) => {
      input.onchange = (e) => {
        const extra = availableExtras[parseInt(e.target.value)];
        if (e.target.checked) {
          if (!AppState.tempItem.added.some((a) => a.nome === extra.nome)) {
            AppState.tempItem.added.push({
              nome: extra.nome,
              preco: extra.preco,
            });
          }
        } else {
          const idx = AppState.tempItem.added.findIndex(
            (a) => a.nome === extra.nome,
          );
          if (idx > -1) AppState.tempItem.added.splice(idx, 1);
        }
      };
    });
  },

  renderObservacoes(title, body, burgerName) {
    const displayName = burgerName || AppState.tempItem.nome;
    title.textContent = `${displayName} - Observações 💬`;
    body.innerHTML = `
      <textarea id="obs-input"
        placeholder="Adicione alguma observação especial..."
        style="width:100%;min-height:120px;padding:15px;background:#111;
               border:1px solid var(--border);border-radius:12px;
               color:white;font-size:0.95rem;resize:vertical;outline:none;"
      >${AppState.tempItem.obs || ""}</textarea>
    `;
    body.querySelector("#obs-input").oninput = (e) =>
      (AppState.tempItem.obs = e.target.value);
  },

  renderBatataUpgrade(title, body, upgrades) {
    title.textContent = "Escolha a Batata 🍟";
    if (!AppState.comboData.selectedBatata) {
      AppState.comboData.selectedBatata = upgrades[0].nome;
      AppState.comboData.batataPriceAdjust = upgrades[0].adicional || 0;
    }
    const currentSelection = AppState.comboData.selectedBatata;
    body.innerHTML = upgrades
      .map((opt, i) => {
        const priceText =
          opt.adicional > 0
            ? `+${Utils.formatPrice(opt.adicional)}`
            : opt.adicional < 0
              ? Utils.formatPrice(opt.adicional)
              : "Inclusa";
        return `
          <div class="option-row">
            <label for="batata-${i}" style="flex:1;cursor:pointer;">
              ${opt.nome} <span style="color:var(--primary);">${priceText}</span>
            </label>
            <input type="radio" id="batata-${i}" name="batataUpgrade" value="${i}"
              ${currentSelection === opt.nome ? "checked" : ""}>
          </div>
        `;
      })
      .join("");
    body.querySelectorAll("input").forEach((input) => {
      input.onchange = (e) => {
        const selected = upgrades[parseInt(e.target.value)];
        AppState.comboData.selectedBatata = selected.nome;
        AppState.comboData.batataPriceAdjust = selected.adicional || 0;
      };
    });
  },

  renderBebidaUpgrade(title, body, upgrades) {
    title.textContent = "Escolha a Bebida 🥤";
    if (!AppState.comboData.selectedBebida) {
      AppState.comboData.selectedBebida = upgrades[0].nome;
      AppState.comboData.bebidaPriceAdjust = upgrades[0].adicional || 0;
    }
    const currentSelection = AppState.comboData.selectedBebida;
    body.innerHTML = upgrades
      .map((opt, i) => {
        const priceText =
          opt.adicional > 0
            ? `+${Utils.formatPrice(opt.adicional)}`
            : opt.adicional < 0
              ? Utils.formatPrice(opt.adicional)
              : "Inclusa";
        return `
          <div class="option-row">
            <label for="bebida-${i}" style="flex:1;cursor:pointer;">
              ${opt.nome} <span style="color:var(--primary);">${priceText}</span>
            </label>
            <input type="radio" id="bebida-${i}" name="bebidaUpgrade" value="${i}"
              ${currentSelection === opt.nome ? "checked" : ""}>
          </div>
        `;
      })
      .join("");
    body.querySelectorAll("input").forEach((input) => {
      input.onchange = (e) => {
        const selected = upgrades[parseInt(e.target.value)];
        AppState.comboData.selectedBebida = selected.nome;
        AppState.comboData.bebidaPriceAdjust = selected.adicional || 0;
      };
    });
  },

  nextStep() {
    const currentStepData = AppState.stepsData[AppState.currentStep];
    if (currentStepData?.type === "caldas") {
      if (!AppState.tempItem.selectedCaldas?.length) {
        showToast("⚠️ Por favor, escolha uma calda");
        return;
      }
    }

    if (AppState.currentStep < AppState.stepsData.length - 1) {
      AppState.currentStep++;
      this.renderCurrentStep();
    } else {
      this.completeCurrentItem();
    }
  },

  prevStep() {
    if (AppState.currentStep > 0) {
      AppState.currentStep--;
      this.renderCurrentStep();
    }
  },

  completeCurrentItem() {
    if (AppState.isProcessingUpgrades) {
      AppState.isProcessingUpgrades = false;
      this.finalizeCombo();
      return;
    }

    if (AppState.isCombo) {
      this.saveComboItem();
      AppState.currentBurgerIndex++;

      if (
        AppState.currentBurgerIndex < AppState.comboData.itemRef.burgers.length
      ) {
        this.startNextBurgerInCombo();
      } else if (AppState.isFullCombo) {
        this.showComboUpgrades();
      } else {
        this.finalizeCombo();
      }
    } else {
      this.finalizeSingleItem();
    }
  },

  saveComboItem() {
    const extrasTotal = (AppState.tempItem.added || []).reduce(
      (sum, e) => sum + e.preco,
      0,
    );
    AppState.tempItem.finalPrice = extrasTotal;
    AppState.comboItems.push({ ...AppState.tempItem });
  },

  showComboUpgrades() {
    const { upgrades } = AppState.comboData;
    AppState.stepsData = [
      { type: "batataUpgrade", data: upgrades.batata },
      { type: "bebidaUpgrade", data: upgrades.bebida },
    ];
    AppState.currentStep = 0;
    AppState.isProcessingUpgrades = true;
    this.renderCurrentStep();
  },

  finalizeCombo() {
    const totalExtras = AppState.comboItems.reduce(
      (sum, item) => sum + item.finalPrice,
      0,
    );
    const finalPrice =
      AppState.comboData.basePrice +
      totalExtras +
      (AppState.comboData.batataPriceAdjust || 0) +
      (AppState.comboData.bebidaPriceAdjust || 0);

    const comboItem = {
      nome: AppState.comboData.nomeCombo,
      img: AppState.comboData.itemRef.img,
      categoria: AppState.comboData.categoria,
      selectedSize: AppState.comboData.selectedSize,
      selectedPrice: AppState.comboData.basePrice,
      isCombo: true,
      burgers: AppState.comboItems,
      selectedBatata: AppState.comboData.selectedBatata || null,
      selectedBebida: AppState.comboData.selectedBebida || null,
      finalPrice,
    };

    CartManager.add(comboItem);
    ModalUI.close();
  },

  finalizeSingleItem() {
    const extrasTotal = (AppState.tempItem.added || []).reduce(
      (sum, e) => sum + e.preco,
      0,
    );
    AppState.tempItem.finalPrice =
      AppState.tempItem.selectedPrice + extrasTotal;
    CartManager.add(AppState.tempItem);
    ModalUI.close();
  },
};

// ================================
// CART UI
// ================================
const CartUI = {
  render() {
    const { cartItems, cartCount, totalCart } = DOM.elements;

    cartCount.textContent = AppState.cart.length;
    totalCart.textContent = Utils.formatPrice(CartManager.getTotal());

    cartItems.innerHTML = "";

    if (AppState.cart.length === 0) {
      cartItems.innerHTML = `
        <div style="text-align:center;padding:40px 0;color:#666;">
          <p>Seu carrinho está vazio 🛒</p>
        </div>
      `;
      return;
    }

    AppState.cart.forEach((item, index) => {
      cartItems.appendChild(this.renderCartItem(item, index));
    });
  },

  renderCartItem(item, index) {
    const div = DOM.create("div", "cart-item");
    div.style.cssText =
      "display:flex;gap:15px;align-items:start;padding:15px 0;border-bottom:1px solid #222;";

    const nomeComOpcao = item.selectedSize
      ? `${item.nome} - ${item.selectedSize}`
      : item.nome;
    let detailsHtml = "";

    if (item.isCombo && item.burgers) {
      detailsHtml += `<div style="color:var(--primary);font-weight:bold;margin-top:5px;">Itens do Combo:</div>`;
      item.burgers.forEach((burger) => {
        detailsHtml += `<div style="margin-left:10px;margin-top:5px;">• <strong>${burger.nome}</strong></div>`;
        if (burger.meatPoint)
          detailsHtml += `<div style="margin-left:20px;font-size:0.8rem;color:#ccc;">Ponto: ${burger.meatPoint}</div>`;
        if (burger.removed?.length)
          detailsHtml += `<div style="margin-left:20px;font-size:0.8rem;color:#ff4444;">Sem: ${burger.removed.join(", ")}</div>`;
        if (burger.added?.length)
          detailsHtml += `<div style="margin-left:20px;font-size:0.8rem;color:#4CAF50;">➕ ${burger.added.map((a) => a.nome).join(", ")}</div>`;
        if (burger.obs)
          detailsHtml += `<div style="margin-left:20px;font-size:0.8rem;color:#aaa;">💬 ${burger.obs}</div>`;
      });
      if (item.selectedBatata)
        detailsHtml += `<div style="margin-top:3px;">🍟 ${item.selectedBatata}</div>`;
      if (item.selectedBebida)
        detailsHtml += `<div>🥤 ${item.selectedBebida}</div>`;
    } else {
      if (item.meatPoint)
        detailsHtml += `<div style="margin-top:3px;">🥩 Ponto: ${item.meatPoint}</div>`;
      if (item.selectedCaldas?.length)
        detailsHtml += `<div>🍯 Calda: ${item.selectedCaldas.join(", ")}</div>`;
      if (item.removed?.length)
        detailsHtml += `<div style="color:#ff4444;">❌ Sem: ${item.removed.join(", ")}</div>`;
      if (item.added?.length)
        detailsHtml += `<div style="color:#4CAF50;">➕ Adicionais: ${item.added.map((a) => a.nome).join(", ")}</div>`;
      if (item.obs)
        detailsHtml += `<div style="margin-top:3px;color:#aaa;">💬 ${item.obs}</div>`;
    }

    div.innerHTML = `
      <div style="flex-shrink:0;">
        <img src="${item.img || "./img/placeholder.png"}" alt="${item.nome}"
          style="width:70px;height:70px;object-fit:cover;border-radius:10px;
                 border:2px solid var(--primary);box-shadow:0 2px 8px rgba(255,193,7,0.2);">
      </div>
      <div style="flex:1;">
        <div class="cart-item-header">
          <div style="font-weight:bold;font-size:1.05rem;color:#fff;">${nomeComOpcao}</div>
          <div style="color:var(--primary);margin:2px 0;font-weight:600;">
            ${Utils.formatPrice(item.finalPrice * (item.quantity || 1))}
          </div>
        </div>
        <div style="font-size:0.85rem;color:#aaa;">${detailsHtml}</div>
        <div class="cart-controls" style="display:flex;align-items:center;gap:12px;margin-top:10px;">
          <div class="quantity-selector">
            <button onclick="CartManager.updateQuantity(${index}, -1)">-</button>
            <span>${item.quantity || 1}</span>
            <button onclick="CartManager.updateQuantity(${index}, 1)">+</button>
          </div>
          <button class="btn-remove-link" onclick="CartManager.remove(${index})">Remover</button>
        </div>
      </div>
    `;

    return div;
  },
};

// ================================
// MODAL UI
// ================================
const ModalUI = {
  open() {
    DOM.elements.modal.classList.add("active");
    DOM.elements.overlay.classList.add("active");
  },
  close() {
    DOM.elements.modal.classList.remove("active");
    DOM.elements.overlay.classList.remove("active");
  },
};

// ================================
// MODAL DE CONFIRMAÇÃO (WHATSAPP)
// ================================
const ConfirmacaoModal = {
  show(formattedMessage, whatsappURL) {
    const modal = document.getElementById("modal-confirmacao");
    const preview = document.getElementById("confirmacao-preview");
    const btnWhatsApp = document.getElementById("btn-enviar-whatsapp");

    if (!modal || !preview || !btnWhatsApp) return;

    preview.textContent = formattedMessage
      .replace(/\*(.*?)\*/g, "$1")
      .replace(/━/g, "─");
    preview.scrollTop = 0;

    btnWhatsApp.href = whatsappURL;
    modal.classList.add("active");
  },

  close() {
    document.getElementById("modal-confirmacao")?.classList.remove("active");
  },
};

// ================================
// SIDEBAR UI
// ================================
const SidebarUI = {
  open() {
    DOM.elements.sidebar.classList.add("active");
    DOM.elements.overlay.classList.add("active");
  },
  close() {
    DOM.elements.sidebar.classList.remove("active");
    DOM.elements.overlay.classList.remove("active");
  },
  toggle() {
    DOM.elements.sidebar.classList.contains("active")
      ? this.close()
      : this.open();
  },
};

// ================================
// CHECKOUT MANAGER
// ================================
const CheckoutManager = {
  init() {
    const form = DOM.elements.checkoutForm;
    if (!form) return;

    // Toggle Entrega / Retirada
    DOM.getAll("[data-delivery-type]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        const type = e.target.dataset.deliveryType;
        AppState.deliveryType = type;

        DOM.getAll("[data-delivery-type]").forEach((b) =>
          b.classList.remove("active"),
        );
        e.target.classList.add("active");

        const deliveryFields = DOM.elements.deliveryFields;
        if (type === "delivery") {
          deliveryFields.style.display = "block";
          deliveryFields
            .querySelectorAll("[data-delivery-required]")
            .forEach((el) => {
              el.required = true;
            });
          deliveryFields.querySelectorAll("select").forEach((el) => {
            el.required = true;
          });
        } else {
          deliveryFields.style.display = "none";
          deliveryFields.querySelectorAll("input, select").forEach((el) => {
            el.required = false;
          });
        }

        CartUI.render();
      });
    });

    // Seleção de bairro + taxa de entrega
    const neighborhoodSelect = form.querySelector("[data-neighborhood-select]");
    if (neighborhoodSelect) {
      neighborhoodSelect.addEventListener("change", (e) => {
        const selectedOption = e.target.options[e.target.selectedIndex];
        const fee = parseFloat(selectedOption.dataset.fee) || 0;
        const neighborhoodValue = e.target.value;
        const neighborhoodText =
          selectedOption.textContent.split(" - ")[0] || "";

        AppState.deliveryFee = fee;
        AppState.selectedNeighborhood = {
          value: neighborhoodValue,
          text: neighborhoodText,
        };

        const feeDisplay = DOM.get("[data-delivery-fee-display]");
        const feeValue = DOM.get("[data-delivery-fee-value]");

        if (neighborhoodValue === "campo-grande") {
          feeDisplay.style.display = "flex";
          feeDisplay.classList.add("campo-grande");
          feeValue.textContent = "A combinar";
        } else if (fee > 0) {
          feeDisplay.style.display = "flex";
          feeDisplay.classList.remove("campo-grande");
          feeValue.textContent = Utils.formatPrice(fee);
        } else {
          feeDisplay.style.display = "none";
        }

        CartUI.render();
      });
    }

    // Troco para dinheiro
    const paymentSelect = form.querySelector('[name="paymentMethod"]');
    if (paymentSelect) {
      paymentSelect.addEventListener("change", (e) => {
        const changeField = DOM.elements.changeField;
        if (e.target.value === "dinheiro") {
          changeField.style.display = "block";
        } else {
          changeField.style.display = "none";
          changeField.querySelector("input").required = false;
        }
      });
    }

    // Submit
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      await this.processCheckout(new FormData(form));
    });
  },

  async processCheckout(formData) {
    const data = Object.fromEntries(formData.entries());

    if (AppState.cart.length === 0) {
      showToast("⚠️ Carrinho vazio");
      return;
    }

    if (!data.customerName?.trim()) {
      showToast("⚠️ Informe seu nome");
      return;
    }

    if (!data.paymentMethod) {
      showToast("⚠️ Selecione a forma de pagamento");
      return;
    }

    // Verificar se loja está aberta
    if (database) {
      try {
        const storeSnap = await database.ref("config/lojaAberta").once("value");
        if (storeSnap.val() === false) {
          showToast(
            "🔴 A loja está fechada no momento. Tente novamente em breve!",
          );
          return;
        }
      } catch (error) {
        console.warn("Erro ao verificar status da loja, prosseguindo:", error);
      }
    }

    // Validações de endereço (só para entrega)
    if (AppState.deliveryType === "delivery") {
      if (!data.neighborhood) {
        showToast("⚠️ Selecione o bairro de entrega");
        return;
      }
      if (!data.street?.trim()) {
        showToast("⚠️ Informe o endereço (Rua/Av)");
        return;
      }
      if (!data.houseNumber?.trim()) {
        showToast("⚠️ Informe o número da casa");
        return;
      }

      const selectedOption = DOM.get(
        `[data-neighborhood-select] option[value="${data.neighborhood}"]`,
      );
      data.neighborhoodInfo = {
        value: data.neighborhood,
        text: selectedOption?.textContent.split(" - ")[0] || "",
      };
      data.address = `${data.street.trim()}, ${data.houseNumber.trim()}`;
    }

    // Montar URL WhatsApp e mensagem de preview
    const whatsappURL = OrderSender.buildWhatsAppURL(data);
    const formattedMessage = OrderSender._buildMessage(data);

    // Fechar sidebars e exibir modal de confirmação
    this.closeCheckout();
    SidebarUI.close();
    ConfirmacaoModal.show(formattedMessage, whatsappURL);

    showToast("📤 Enviando pedido para a cozinha...");

    // Enviar ao KDS em background (não bloqueia o cliente)
    OrderSender.sendToKDSRobust(data).then((kdsOk) => {
      if (!kdsOk) {
        showToast(
          "⚠️ Pedido no WhatsApp, mas cozinha não confirmou. Ligue para a loja!",
        );
      } else {
        showToast("✅ Pedido enviado com sucesso!");
      }
    });

    // Limpar carrinho
    setTimeout(() => CartManager.clear(), 500);
  },

  _checkoutOpening: false,

  async openCheckout() {
    // Evita duplo clique enquanto aguarda o Firebase
    if (this._checkoutOpening) return;
    this._checkoutOpening = true;

    try {
      // Verifica se loja está aberta antes de abrir o checkout
      if (database) {
        try {
          const storeSnap = await database
            .ref("config/lojaAberta")
            .once("value");
          if (storeSnap.val() === false) {
            showToast(
              "🔴 A loja está fechada no momento. Tente novamente em breve!",
            );
            return;
          }
        } catch (error) {
          console.warn("Erro ao verificar status da loja:", error);
        }
      }
    } finally {
      this._checkoutOpening = false;
    }

    SidebarUI.close();
    setTimeout(() => {
      document.getElementById("sidebar-checkout")?.classList.add("active");
      DOM.elements.overlay.classList.add("active");
      // Atualizar total em todos os data-total-cart
      document.querySelectorAll("[data-total-cart]").forEach((el) => {
        el.textContent = Utils.formatPrice(CartManager.getTotal());
      });
    }, 300);
  },

  closeCheckout() {
    document.getElementById("sidebar-checkout")?.classList.remove("active");
    DOM.elements.overlay.classList.remove("active");
  },
};

// ================================
// ORDER SENDER — KDS + WHATSAPP
// ================================
const OrderSender = {
  buildWhatsAppURL(data) {
    return `https://wa.me/${CONFIG.whatsappNumber}?text=${encodeURIComponent(this._buildMessage(data))}`;
  },

  _buildMessage(data) {
    let msg = `🔥 *PEDIDO RIBBS ZN* 🔥\n\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n`;
    msg += `📦 *TIPO:* ${AppState.deliveryType === "delivery" ? "🛵 ENTREGA" : "🏪 RETIRADA"}\n`;

    if (AppState.deliveryType === "delivery") {
      msg += `📍 *Bairro:* ${data.neighborhoodInfo?.text || ""}\n`;
      msg += `📍 *Endereço:* ${data.address}\n`;
      if (data.complement) msg += `   ${data.complement}\n`;
      if (
        AppState.deliveryFee > 0 &&
        AppState.selectedNeighborhood?.value !== "campo-grande"
      ) {
        msg += `🛵 *Taxa de Entrega:* ${Utils.formatPrice(AppState.deliveryFee)}\n`;
      } else if (AppState.selectedNeighborhood?.value === "campo-grande") {
        msg += `🛵 *Taxa de Entrega:* A combinar\n`;
      }
    }

    msg += `👤 *Cliente:* ${data.customerName}\n`;
    msg += `━━━━━━━━━━━━━━━━━━\n\n`;
    msg += `🍔 *ITENS DO PEDIDO:*\n\n`;

    AppState.cart.forEach((item, idx) => {
      msg += `${idx + 1}. *${item.nome}*\n`;

      if (item.isCombo && item.burgers) {
        item.burgers.forEach((burger) => {
          msg += `   --- ${burger.nome} ---\n`;
          if (burger.meatPoint) msg += `   🥩 Ponto: ${burger.meatPoint}\n`;
          if (burger.selectedCaldas?.length)
            msg += `   🍯 Caldas: ${burger.selectedCaldas.join(", ")}\n`;
          if (burger.removed?.length)
            msg += `   ❌ Sem: ${burger.removed.join(", ")}\n`;
          if (burger.added?.length)
            msg += `   ➕ Adicionais: ${burger.added.map((a) => a.nome).join(", ")}\n`;
          if (burger.obs) msg += `   💬 Obs: ${burger.obs}\n`;
        });
        if (item.selectedBatata)
          msg += `   🍟 Batata: ${item.selectedBatata}\n`;
        if (item.selectedBebida)
          msg += `   🥤 Bebida: ${item.selectedBebida}\n`;
      } else {
        if (item.selectedSize) msg += `   Tamanho: ${item.selectedSize}\n`;
        if (item.meatPoint) msg += `   🥩 Ponto: ${item.meatPoint}\n`;
        if (item.selectedCaldas?.length)
          msg += `   🍯 Caldas: ${item.selectedCaldas.join(", ")}\n`;
        if (item.removed?.length)
          msg += `   ❌ Sem: ${item.removed.join(", ")}\n`;
        if (item.added?.length)
          msg += `   ➕ Adicionais: ${item.added.map((a) => a.nome).join(", ")}\n`;
        if (item.obs) msg += `   💬 Obs: ${item.obs}\n`;
      }

      msg += `   💰 ${Utils.formatPrice(item.finalPrice)}\n`;
      if (item.quantity > 1) msg += `   Quantidade: ${item.quantity}x\n`;
      msg += `\n`;
    });

    msg += `━━━━━━━━━━━━━━━━━━\n`;
    msg += `💳 *Pagamento:* ${this._getPaymentName(data.paymentMethod)}\n`;
    if (data.paymentMethod === "dinheiro" && data.changeFor) {
      msg += `💵 *Troco para:* R$ ${data.changeFor}\n`;
    }
    msg += `\n💰 *TOTAL: ${Utils.formatPrice(CartManager.getTotal())}*`;

    return msg;
  },

  _getPaymentName(method) {
    const names = {
      pix: "💚 PIX",
      dinheiro: "💵 Dinheiro",
      debito: "💳 Cartão de Débito",
      credito: "💳 Cartão de Crédito",
    };
    return names[method] || method;
  },

  // Monta o objeto pedido para o Firebase/KDS
  _buildPedido(data) {
    const paymentNames = {
      pix: "PIX",
      dinheiro: "Dinheiro",
      debito: "Débito",
      credito: "Crédito",
    };

    const itens = AppState.cart.map((item) => {
      const itemFormatado = {
        nome: item.nome,
        preco: item.selectedPrice || 0,
        quantidade: item.quantity || 1,
        qtd: item.quantity || 1,
      };

      const observacoes = [];

      if (item.isCombo && item.burgers) {
        item.burgers.forEach((burger) => {
          observacoes.push(`--- ${burger.nome} ---`);
          if (burger.meatPoint) observacoes.push(`Ponto: ${burger.meatPoint}`);
          if (burger.selectedCaldas?.length)
            observacoes.push(`Caldas: ${burger.selectedCaldas.join(", ")}`);
          if (burger.removed?.length)
            observacoes.push(`Sem: ${burger.removed.join(", ")}`);
          if (burger.added?.length)
            observacoes.push(
              `Adicionais: ${burger.added.map((a) => a.nome).join(", ")}`,
            );
          if (burger.obs) observacoes.push(burger.obs);
        });
        if (item.selectedBatata)
          observacoes.push(`Batata: ${item.selectedBatata}`);
        if (item.selectedBebida)
          observacoes.push(`Bebida: ${item.selectedBebida}`);
      } else {
        if (item.selectedSize)
          observacoes.push(`Tamanho: ${item.selectedSize}`);
        if (item.meatPoint) {
          observacoes.push(`Ponto: ${item.meatPoint}`);
          itemFormatado.ponto = item.meatPoint;
        }
        if (item.selectedCaldas?.length)
          observacoes.push(`Caldas: ${item.selectedCaldas.join(", ")}`);
        if (item.removed?.length) {
          observacoes.push(`Sem: ${item.removed.join(", ")}`);
          itemFormatado.retiradas = item.removed;
        }
        if (item.added?.length) {
          observacoes.push(
            `Adicionais: ${item.added.map((a) => a.nome).join(", ")}`,
          );
          itemFormatado.adicionais = item.added.map((a) => ({
            nome: a.nome,
            preco: a.preco,
          }));
        }
        if (item.obs) observacoes.push(item.obs);
      }

      if (observacoes.length > 0)
        itemFormatado.observacao = observacoes.join(" | ");
      return itemFormatado;
    });

    // tipo reflete o modo real (delivery ou pickup)
    const tipoReal =
      AppState.deliveryType === "delivery" ? "delivery" : "pickup";

    const pedido = {
      tipo: tipoReal,
      tipoEntrega: tipoReal,
      tipoOrigem: tipoReal,
      kdsStatus: "pending", // BUG FIX: campo obrigatório para o KDS
      status: "pending",
      nomeCliente: data.customerName,
      cliente: data.customerName,
      nome: data.customerName,
      pagamento: paymentNames[data.paymentMethod] || data.paymentMethod,
      formaPagamento: paymentNames[data.paymentMethod] || data.paymentMethod, // BUG FIX: KDS lê formaPagamento
      itens,
      total: CartManager.getTotal(),
      timestamp: Date.now(),
      dataHora: new Date().toLocaleString("pt-BR"),
    };

    if (AppState.deliveryType === "delivery") {
      pedido.modoConsumo = "🛵 ENTREGA";
      pedido.endereco = data.address || "";
      if (data.complement?.trim())
        pedido.endereco += ` - ${data.complement.trim()}`;
      if (data.neighborhoodInfo) pedido.bairro = data.neighborhoodInfo.text;
      if (AppState.deliveryFee > 0) pedido.taxaEntrega = AppState.deliveryFee;
    } else {
      pedido.modoConsumo = "🏪 RETIRADA";
      pedido.endereco = "RETIRADA NO LOCAL";
    }

    if (data.paymentMethod === "dinheiro" && data.changeFor) {
      pedido.troco = `Troco para R$ ${data.changeFor}`;
    }

    return pedido;
  },

  // Envia uma única vez ao KDS
  async sendToKDS(data) {
    if (!database) throw new Error("Firebase não conectado");
    const pedido = this._buildPedido(data);
    const ref = database.ref("pedidos").push();
    await ref.set(pedido);
    console.log("✅ Pedido enviado ao KDS!");
  },

  // Envia com retry (3x) + fila offline se tudo falhar
  // Retorna true se conseguiu, false se foi para fila offline
  async sendToKDSRobust(data) {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = 2000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        await this.sendToKDS(data);
        this._flushOfflineQueue(); // tenta reenviar pedidos pendentes
        return true;
      } catch (error) {
        console.warn(
          `⚠️ Tentativa ${attempt}/${MAX_RETRIES} falhou:`,
          error.message,
        );
        if (attempt < MAX_RETRIES) {
          showToast(`⏳ Tentando novamente... (${attempt}/${MAX_RETRIES})`);
          await new Promise((res) => setTimeout(res, RETRY_DELAY_MS));
        }
      }
    }

    console.error("❌ Todas as tentativas falharam. Salvando na fila offline.");
    this._saveToOfflineQueue(data);
    return false;
  },

  // Salva pedido no localStorage para reenvio posterior
  _saveToOfflineQueue(data) {
    try {
      const queue = JSON.parse(
        localStorage.getItem("kds_offline_queue") || "[]",
      );
      queue.push({
        data,
        cart: JSON.parse(JSON.stringify(AppState.cart)),
        deliveryType: AppState.deliveryType,
        deliveryFee: AppState.deliveryFee,
        selectedNeighborhood: AppState.selectedNeighborhood,
        savedAt: Date.now(),
      });
      localStorage.setItem("kds_offline_queue", JSON.stringify(queue));
      console.log(
        `📦 Pedido salvo na fila offline. Total na fila: ${queue.length}`,
      );
    } catch (e) {
      console.error("❌ Erro ao salvar na fila offline:", e);
    }
  },

  // Reenviar fila offline ao reconectar
  async _flushOfflineQueue() {
    try {
      const queue = JSON.parse(
        localStorage.getItem("kds_offline_queue") || "[]",
      );
      if (queue.length === 0) return;

      console.log(`🔄 Reenviando ${queue.length} pedido(s) da fila offline...`);
      const remaining = [];

      for (const entry of queue) {
        try {
          if (!database) {
            remaining.push(entry);
            continue;
          }

          // Snapshot do estado atual
          const savedCart = AppState.cart;
          const savedDelivery = AppState.deliveryType;
          const savedFee = AppState.deliveryFee;
          const savedNeighborhood = AppState.selectedNeighborhood;

          // Restaurar estado do pedido offline
          AppState.cart = entry.cart;
          AppState.deliveryType = entry.deliveryType;
          AppState.deliveryFee = entry.deliveryFee;
          AppState.selectedNeighborhood = entry.selectedNeighborhood;

          const pedido = this._buildPedido(entry.data);
          pedido.reenviado = true;
          pedido.savedAt = entry.savedAt;

          const ref = database.ref("pedidos").push();
          await ref.set(pedido);

          // Restaurar estado original
          AppState.cart = savedCart;
          AppState.deliveryType = savedDelivery;
          AppState.deliveryFee = savedFee;
          AppState.selectedNeighborhood = savedNeighborhood;

          console.log("✅ Pedido offline reenviado com sucesso!");
        } catch (e) {
          remaining.push(entry);
        }
      }

      localStorage.setItem("kds_offline_queue", JSON.stringify(remaining));
      if (remaining.length < queue.length) {
        showToast(
          `✅ ${queue.length - remaining.length} pedido(s) pendente(s) enviado(s) à cozinha!`,
        );
      }
    } catch (e) {
      console.error("❌ Erro ao processar fila offline:", e);
    }
  },
};

// ================================
// BUSCA
// ================================
const SearchManager = {
  init() {
    DOM.elements.searchInput.addEventListener(
      "input",
      Utils.debounce((e) => this.handleSearch(e.target.value), 300),
    );
  },

  handleSearch(query) {
    if (!AppState.cardapioData) return;
    const lowerQuery = query.toLowerCase();

    if (!lowerQuery.trim()) {
      MenuUI.render(AppState.cardapioData);
      return;
    }

    const filtered = {};
    Object.entries(AppState.cardapioData).forEach(([category, items]) => {
      const matches = items.filter(
        (item) =>
          item.nome.toLowerCase().includes(lowerQuery) ||
          item.descricao?.toLowerCase().includes(lowerQuery),
      );
      if (matches.length) filtered[category] = matches;
    });

    MenuUI.render(filtered);
  },
};

// ================================
// EVENT LISTENERS
// ================================
const EventListeners = {
  init() {
    DOM.get("[data-close-modal]")?.addEventListener("click", () =>
      ModalUI.close(),
    );
    DOM.get("[data-btn-next]")?.addEventListener("click", () =>
      OrderFlow.nextStep(),
    );
    DOM.get("[data-btn-back]")?.addEventListener("click", () =>
      OrderFlow.prevStep(),
    );

    DOM.get("[data-action='toggle-sidebar']")?.addEventListener("click", () =>
      SidebarUI.toggle(),
    );
    DOM.get("[data-close-sidebar]")?.addEventListener("click", () =>
      SidebarUI.close(),
    );

    DOM.elements.overlay?.addEventListener("click", () => {
      const modalActive = DOM.elements.modal.classList.contains("active");
      const checkoutActive = document
        .getElementById("sidebar-checkout")
        ?.classList.contains("active");
      const sidebarActive = DOM.elements.sidebar.classList.contains("active");

      if (modalActive) ModalUI.close();
      else if (checkoutActive) CheckoutManager.closeCheckout();
      else if (sidebarActive) SidebarUI.close();
    });

    document
      .getElementById("btn-finalizar-pedido")
      ?.addEventListener("click", () => {
        if (AppState.cart.length === 0) {
          showToast("⚠️ Seu carrinho está vazio");
          return;
        }
        CheckoutManager.openCheckout();
      });

    document
      .getElementById("btn-back-to-cart")
      ?.addEventListener("click", () => {
        CheckoutManager.closeCheckout();
        SidebarUI.open();
      });

    document
      .getElementById("btn-close-checkout")
      ?.addEventListener("click", () => {
        CheckoutManager.closeCheckout();
      });

    document
      .getElementById("btn-fechar-confirmacao")
      ?.addEventListener("click", () => {
        ConfirmacaoModal.close();
      });

    document
      .getElementById("modal-confirmacao")
      ?.addEventListener("click", (e) => {
        if (e.target === document.getElementById("modal-confirmacao"))
          ConfirmacaoModal.close();
      });

    // Modal Campo Grande
    document
      .getElementById("btn-campo-grande-ok")
      ?.addEventListener("click", () => {
        document
          .getElementById("modal-campo-grande")
          ?.classList.remove("active");
      });

    window.addEventListener("scroll", CategoriesUI.updateActiveOnScroll);

    CheckoutManager.init();
    SearchManager.init();
  },
};

// ================================
// INICIALIZAÇÃO
// ================================
const App = {
  async init() {
    try {
      WelcomeModal.init();

      await initFirebase();
      AppState.cardapioData = await MenuService.loadMenu();

      // Sincronizar preços do Firebase antes de renderizar
      await MenuService.syncPricesFromFirebase();

      // Carregar disponibilidade antes do render inicial
      if (database) {
        const [menuSnap, ingredSnap, extrasSnap] = await Promise.all([
          database.ref("menuAvailability").once("value"),
          database.ref("ingredientsAvailability").once("value"),
          database.ref("paidExtrasAvailability").once("value"),
        ]);
        AppState.menuAvailability = menuSnap.val() || {};
        AppState.ingredientsAvailability = ingredSnap.val() || {};
        AppState.paidExtrasAvailability = extrasSnap.val() || {};
        console.log("✅ Disponibilidade carregada antes do render");
      }

      CategoriesUI.render(Object.keys(AppState.cardapioData));
      MenuUI.render(AppState.cardapioData);
      CartUI.render();
      EventListeners.init();

      // Listeners em tempo real (Firebase)
      MenuService.listenToAvailability();
      MenuService.listenToIngredientsAvailability();
      MenuService.listenToPriceChanges();
      MenuService.listenToLojaStatus();

      console.log("✅ delivery.js inicializado com sucesso");
    } catch (error) {
      console.error("❌ Erro na inicialização:", error);
      MenuUI.renderError();
    }
  },
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => App.init());
} else {
  App.init();
}
