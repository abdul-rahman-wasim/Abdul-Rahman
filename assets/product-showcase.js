import { CartLinesUpdateEvent } from '@shopify/events';

// NOTE: cart-items-component owns the drawer markup, so refresh through it when present
async function refreshCart() {
  const cartItems = document.querySelector('cart-items-component');

  if (cartItems) {
    await customElements.whenDefined('cart-items-component');
    return cartItems.fetchCartData();
  }

  return fetch(`${Theme.routes.cart_url}.json`, { headers: { Accept: 'application/json' } }).then((response) =>
    response.json()
  );
}

function post(items) {
  return fetch(Theme.routes.cart_add_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ items, sections: sectionIds() }),
  }).then((response) => response.json());
}

function sectionIds() {
  return [...document.querySelectorAll('cart-items-component[data-section-id]')]
    .map((item) => item.dataset.sectionId)
    .join(',');
}

class ProductGridPopup {
  constructor(dialog, section) {
    this.dialog = dialog;
    this.section = section;
    this.variants = JSON.parse(dialog.querySelector('[data-variants]').textContent);
    this.inputs = [...dialog.querySelectorAll('[data-option-index]')];
    this.price = dialog.querySelector('[data-price]');
    this.error = dialog.querySelector('[data-error]');
    this.submit = dialog.querySelector('[data-submit]');
    this.submitText = dialog.querySelector('[data-submit-text]');

    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    this.inputs.forEach((input) => input.addEventListener('change', () => this.update()));
    this.submit.addEventListener('click', () => this.addToCart());
    this.setupSelects();
    this.setupSwatches();
    this.update();
  }

  setupSelects() {
    this.selects = [...this.dialog.querySelectorAll('[data-select]')];

    for (const select of this.selects) {
      const list = select.querySelector('[role="listbox"]');
      const label = select.querySelector('[data-select-label]');
      const input = select.querySelector('input');

      select.querySelector('[data-select-trigger]').addEventListener('click', () => {
        const open = !select.hasAttribute('data-open');
        this.closeSelects();
        this.toggleSelect(select, open);
      });

      for (const option of list.children) {
        option.addEventListener('click', () => {
          input.value = option.dataset.value;
          label.textContent = option.dataset.value;
          select.setAttribute('data-selected', '');
          for (const sibling of list.children) sibling.setAttribute('aria-selected', sibling === option);
          this.toggleSelect(select, false);
          this.update();
        });
      }
    }

    this.dialog.addEventListener('click', (event) => {
      if (!event.target.closest('[data-select]')) this.closeSelects();
    });
  }

  setupSwatches() {
    for (const group of this.dialog.querySelectorAll('.product-showcase__swatches')) {
      const inputs = [...group.querySelectorAll('input')];
      const move = () => {
        const index = inputs.findIndex((input) => input.checked);
        if (index >= 0) group.style.setProperty('--active', index);
      };

      for (const input of inputs) input.addEventListener('change', move);
      move();
    }
  }

  toggleSelect(select, open) {
    select.toggleAttribute('data-open', open);
    select.querySelector('[data-select-trigger]').setAttribute('aria-expanded', open);
    select.querySelector('[role="listbox"]').hidden = !open;
  }

  closeSelects() {
    for (const select of this.selects) this.toggleSelect(select, false);
  }

  get selection() {
    const values = [];
    for (const input of this.inputs) {
      const index = Number(input.dataset.optionIndex) - 1;
      if (input.type === 'radio' ? input.checked : input.value) values[index] = input.value;
    }
    return values;
  }

  get variant() {
    const values = this.selection;
    if (values.length !== new Set(this.inputs.map((i) => i.dataset.optionIndex)).size) return null;
    return this.variants[values.join(' / ')] ?? null;
  }

  update() {
    const variant = this.variant;
    if (variant) this.price.innerHTML = variant.price;
    this.submit.disabled = !variant?.available;
    this.submitText.textContent = variant && !variant.available ? 'SOLD OUT' : 'ADD TO CART';
    this.error.hidden = true;
  }

  // Auto-add fires when every trigger value from the section settings is selected
  get autoAddId() {
    const trigger = (this.section.dataset.autoAddOptions || '')
      .split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const selected = this.selection.map((value) => value.toLowerCase());

    if (!trigger.length || !trigger.every((value) => selected.includes(value))) return null;
    return this.section.dataset.autoAddId || null;
  }

  async addToCart() {
    const variant = this.variant;
    if (!variant) return;

    const items = [{ id: variant.id, quantity: 1 }];
    const autoAddId = this.autoAddId;
    if (autoAddId) items.push({ id: Number(autoAddId), quantity: 1 });

    this.submit.disabled = true;
    this.submitText.textContent = 'ADDING…';
    const deferred = CartLinesUpdateEvent.createPromise();

    this.dialog.dispatchEvent(
      new CartLinesUpdateEvent({
        action: 'add',
        context: 'product',
        lines: items.map((item) => ({ merchandiseId: item.id, quantity: item.quantity })),
        promise: deferred.promise,
      })
    );

    try {
      let data = await post(items);
      if (data.status && items.length > 1) {
        console.warn('[product-showcase] gift line rejected:', data.description || data.message);
        data = await post([items[0]]);
      }
      if (data.status) throw new Error(data.description || data.message);

      const cart = await refreshCart();
      deferred.resolve({
        cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
        detail: {
          items: cart.items,
          sections: data.sections,
          source: 'product-showcase',
          sourceId: this.dialog.id,
          itemCount: items.length,
          productId: this.dialog.dataset.productId,
          didError: false,
        },
      });

      this.dialog.close();
      this.update();
    } catch (error) {
      deferred.reject(error);
      this.update();
      this.error.textContent = error.message;
      this.error.hidden = false;
    }
  }
}

for (const section of document.querySelectorAll('.product-showcase')) {
  for (const dialog of section.querySelectorAll('.product-showcase__dialog')) {
    new ProductGridPopup(dialog, section);
  }

  section.addEventListener('click', (event) => {
    const hotspot = event.target.closest('[data-dialog]');
    if (hotspot) document.getElementById(hotspot.dataset.dialog)?.showModal();
  });
}
