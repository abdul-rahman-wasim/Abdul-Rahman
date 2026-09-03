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

    dialog.querySelector('[data-close]').addEventListener('click', () => dialog.close());
    this.inputs.forEach((input) => input.addEventListener('change', () => this.update()));
    this.submit.addEventListener('click', () => this.addToCart());
    this.update();
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
      const response = await fetch(Theme.routes.cart_add_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ items, sections: sectionIds() }),
      });
      const data = await response.json();

      if (data.status) throw new Error(data.description || data.message);

      const cart = await refreshCart();
      deferred.resolve({
        cart: CartLinesUpdateEvent.createCartFromAjaxResponse(cart),
        detail: {
          items: cart.items,
          source: 'product-grid',
          sourceId: this.dialog.id,
          itemCount: items.length,
          productId: this.dialog.dataset.productId,
          didError: false,
        },
      });

      this.dialog.close();
    } catch (error) {
      deferred.reject(error);
      this.error.textContent = error.message;
      this.error.hidden = false;
    } finally {
      this.update();
    }
  }
}

for (const section of document.querySelectorAll('.product-grid')) {
  for (const dialog of section.querySelectorAll('.product-grid__dialog')) {
    new ProductGridPopup(dialog, section);
  }

  section.addEventListener('click', (event) => {
    const hotspot = event.target.closest('[data-dialog]');
    if (hotspot) document.getElementById(hotspot.dataset.dialog)?.showModal();
  });
}
