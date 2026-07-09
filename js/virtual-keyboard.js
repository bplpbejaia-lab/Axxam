
/**
 * Virtual Keyboard for Touch Screens
 * Toggles visibility based on settings and input focus.
 */

class VirtualKeyboard {
    constructor() {
        this.isVisible = false;
        this.isEnabled = localStorage.getItem('virtualKeyboardEnabled') !== 'false';
        this.activeInput = null;
        this.capsLock = false;
        this.numericOnly = false;
        this._lastShowTime = 0;
        this.isInitialized = false;

        if (this.isEnabled) {
            this.init();
        }
    }

    init() {
        if (this.isInitialized) return;
        this.createKeyboardDOM();
        this.attachEventListeners();
        this.isInitialized = true;
    }




    createKeyboardDOM() {
        if (document.getElementById('virtualKeyboard')) return;

        const keyboardContainer = document.createElement('div');
        keyboardContainer.id = 'virtualKeyboard';
        keyboardContainer.className = 'virtual-keyboard hidden';
        document.body.appendChild(keyboardContainer);
        this.renderLayout();
    }

    renderLayout() {
        const kbd = document.getElementById('virtualKeyboard');
        if (!kbd) return;

        const layouts = {
            alpha: [
                ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'Backspace'],
                ['a', 'z', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
                ['q', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'm', 'Enter'],
                ['Caps', 'w', 'x', 'c', 'v', 'b', 'n', ',', '.', '?'],
                ['Space', 'OK']
            ],


            numeric: [
                ['1', '2', '3', 'Backspace'],
                ['4', '5', '6', 'Enter'],
                ['7', '8', '9', 'OK'],
                ['0', '.', ',', '']
            ]
        };

        const rows = this.numericOnly ? layouts.numeric : layouts.alpha;
        let html = `<div class="keyboard-rows ${this.numericOnly ? 'numeric-layout' : ''}">`;

        rows.forEach(row => {
            html += '<div class="keyboard-row">';
            row.forEach(key => {
                if (key === '') {
                    html += '<div class="key-btn spacer" style="visibility:hidden"></div>';
                    return;
                }
                let className = 'key-btn';
                let label = key;
                let action = 'char';

                if (key === 'Backspace') { label = '⌫'; className += ' key-wide'; action = 'backspace'; }
                else if (key === 'Enter') { label = '↵'; className += ' key-wide'; action = 'enter'; }
                else if (key === 'Caps') { label = '⇪'; className += ' key-wide'; action = 'caps'; }
                else if (key === 'Space') { label = '_______________'; className += ' key-space'; action = 'space'; }
                else if (key === 'OK') { label = 'OK'; className += ' key-hide'; action = 'hide'; }

                html += `<button type="button" class="${className}" data-key="${key}" data-action="${action}">${label}</button>`;
            });
            html += '</div>';
        });

        html += '</div>';
        kbd.innerHTML = html;

        // Re-attach clicks since we replaced content
        this.attachKeyboardClicks();
    }

    attachEventListeners() {
        // Listen for all inputs
        const handleTrigger = (e) => {
            if (!this.isEnabled) return;
            const target = e.target;

            if (target.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="submit"]), textarea')) {
                const wasNumeric = this.numericOnly;
                const targetId = (target.id || '').toLowerCase();
                const targetName = (target.name || '').toLowerCase();

                this.numericOnly = (target.type === 'number' ||
                    target.inputMode === 'numeric' ||
                    target.inputMode === 'decimal' ||
                    targetId.includes('price') ||
                    targetId.includes('qty') ||
                    targetId.includes('cost') ||
                    targetName.includes('price') ||
                    targetName.includes('qty') ||
                    targetName.includes('cost'));
                this.activeInput = target;

                if (wasNumeric !== this.numericOnly) {
                    this.renderLayout();
                }
                this.show();
            }
        };

        document.addEventListener('focusin', handleTrigger);
        // Also listen for touchstart on inputs to force focus and show keyboard immediately
        // Use closest() so clicks on child elements (icons, wrappers) count as input interactions
        const inputSelector = 'input:not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="file"]):not([type="submit"]), textarea';
        document.addEventListener('touchstart', (e) => {
            const input = (e.target && e.target.closest) ? e.target.closest(inputSelector) : (e.target && e.target.matches && e.target.matches(inputSelector) ? e.target : null);
            if (input) {
                input.focus();
                handleTrigger({ target: input });
            }
        }, { passive: true });

        // Global mousedown detector with strict exclusion
        document.addEventListener('mousedown', (e) => {
            if (!this.isVisible) return;

            // Consider clicks inside input wrappers or child elements as input interactions
            const inputSelectorGeneric = 'input, textarea';
            const inputEl = (e.target && e.target.closest) ? e.target.closest(inputSelectorGeneric) : (e.target && e.target.matches && e.target.matches(inputSelectorGeneric) ? e.target : null);
            const isInput = !!inputEl;
            const isKeyboard = e.target && e.target.closest ? e.target.closest('#virtualKeyboard') : null;
            const isOverlay = e.target && e.target.classList && (e.target.classList.contains('modal-overlay') || e.target.classList.contains('choco-modal-overlay'));
            const isManagedUI = e.target && e.target.closest ? e.target.closest('.modal-content, .popup, .modal-body, .settings-card, .swal2-popup, .choco-modal, .choco-modal-body') : null;

            // If we click the overlay while keyboard is active, hide keyboard and STOP propagation to prevent modal close
            if (isOverlay && !isKeyboard && !isInput) {
                this.hide();
                // Flag to catch the following 'click' event
                this._hideEventCaptured = true;
                setTimeout(() => this._hideEventCaptured = false, 200);

                // Stop the mousedown from doing anything else
                e.stopPropagation();
            } else if (!isKeyboard && !isInput && !isManagedUI && !isOverlay) {
                this.hide();
            }
        }, true);

        // Catch the click event that follows mousedown on the overlay
        document.addEventListener('click', (e) => {
            if (this._hideEventCaptured && e.target.classList.contains('modal-overlay')) {
                e.preventDefault();
                e.stopPropagation();
                this._hideEventCaptured = false;
            }
        }, true);

        document.addEventListener('focusout', (e) => {
            setTimeout(() => {
                const active = document.activeElement;
                const isInput = active && active.matches('input, textarea');
                const isKeyboard = active && active.closest('#virtualKeyboard');

                // If focus moved to nothing or non-input, hide (unless we just captured an overlay click)
                if (!isInput && !isKeyboard && !this._hideEventCaptured) {
                    this.hide();
                }
            }, 300);
        });
    }

    attachKeyboardClicks() {
        const keyboard = document.getElementById('virtualKeyboard');
        if (!keyboard) return;

        // Ensure we don't have multiple listeners
        const newKeyboard = keyboard.cloneNode(true);
        keyboard.parentNode.replaceChild(newKeyboard, keyboard);

        newKeyboard.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const btn = e.target.closest('.key-btn');
            if (!btn || btn.classList.contains('spacer')) return;

            // Maintain focus on the input so the keyboard doesn't hide
            if (this.activeInput) {
                this.activeInput.focus();
            }

            this.handleKey(btn.dataset.action, btn.dataset.key);
        });

        newKeyboard.addEventListener('mousedown', (e) => e.preventDefault());
    }

    handleKey(action, key) {
        if (!this.activeInput) return;
        const input = this.activeInput;
        let start, end;

        try {
            // Number inputs return null in some browsers instead of throwing
            start = input.selectionStart;
            end = input.selectionEnd;
            if (start === null) throw "null selection";
        } catch (e) {
            start = end = input.value.length;
        }

        const val = input.value;

        switch (action) {
            case 'char':
                let char = this.capsLock ? key.toUpperCase() : key;
                // Auto-convert comma to dot for numeric-focused inputs to ensure it works across all locales
                if (this.numericOnly && char === ',') {
                    char = '.';
                }
                input.value = val.substring(0, start) + char + val.substring(end);
                try { input.selectionStart = input.selectionEnd = start + 1; } catch (e) { }
                this.triggerEvents();
                break;
            case 'space':
                input.value = val.substring(0, start) + ' ' + val.substring(end);
                try { input.selectionStart = input.selectionEnd = start + 1; } catch (e) { }
                this.triggerEvents();
                break;
            case 'backspace':
                if (start !== end) {
                    // Delete selection
                    input.value = val.substring(0, start) + val.substring(end);
                    try { input.setSelectionRange(start, start); } catch (e) {}
                    this.triggerEvents();
                } else if (start > 0) {
                    // Delete char before cursor
                    const newPos = start - 1;
                    input.value = val.substring(0, newPos) + val.substring(end);
                    try { input.setSelectionRange(newPos, newPos); } catch (e) {}
                    this.triggerEvents();
                } else if (input.type === 'number' && val.length > 0) {
                    // Force delete for number inputs if selection is buggy
                    input.value = val.substring(0, val.length - 1);
                    this.triggerEvents();
                }
                break;
            case 'enter':
                if (input.tagName === 'TEXTAREA') {
                    input.value = val.substring(0, start) + '\n' + val.substring(end);
                    try { input.selectionStart = input.selectionEnd = start + 1; } catch (e) { }
                    this.triggerEvents();
                } else {
                    if (input.form) input.form.dispatchEvent(new Event('submit', { bubbles: true }));
                    this.hide();
                }
                break;
            case 'caps':
                this.capsLock = !this.capsLock;
                this.updateKeysCase();
                break;
            case 'hide':
                this.hide();
                break;
        }
    }

    updateKeysCase() {
        document.querySelectorAll('#virtualKeyboard .key-btn[data-action="char"]').forEach(k => {
            k.textContent = this.capsLock ? k.dataset.key.toUpperCase() : k.dataset.key;
        });
    }

    triggerEvents() {
        if (!this.activeInput) return;
        this.activeInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    show() {
        this.isVisible = true;
        this._lastShowTime = Date.now();
        const kbd = document.getElementById('virtualKeyboard');

        const isPaymentModal = this.activeInput && this.activeInput.closest('#paymentModal');
        
        if (isPaymentModal) {
            kbd.classList.add('side');
            document.body.classList.add('keyboard-side-active');
            document.body.classList.remove('keyboard-active');
        } else {
            // Force bottom keyboard for all other views (like recipe detail) as requested
            kbd.classList.remove('side');
            document.body.classList.remove('keyboard-side-active');
            document.body.classList.add('keyboard-active');
        }

        kbd.classList.remove('hidden');
        kbd.classList.add('visible');

        // Ensure the active input is visible above the bottom keyboard
        if (this.activeInput) {
            setTimeout(() => {
                if (!this.isVisible || !this.activeInput) return;
                try {
                    const kRect = kbd.getBoundingClientRect();
                    const kHeight = kRect.height || 260;
                    const keyboardTop = window.innerHeight - kHeight;

                    // Find nearest scrollable ancestor
                    const getScrollAncestor = (el) => {
                        let parent = el.parentElement;
                        while (parent && parent !== document.body) {
                            const style = window.getComputedStyle(parent);
                            const overflowY = style.overflowY;
                            // Check for common scrollable class names or overflow styles
                            if (parent.classList.contains('picker-body') || 
                                parent.classList.contains('view-detail') ||
                                parent.classList.contains('modal-overlay') || 
                                parent.classList.contains('choco-modal-overlay')) {
                                return parent;
                            }
                            if ((overflowY === 'auto' || overflowY === 'scroll') && parent.scrollHeight > parent.clientHeight) {
                                return parent;
                            }
                            parent = parent.parentElement;
                        }
                        return document.scrollingElement || document.documentElement;
                    };

                    const scrollParent = getScrollAncestor(this.activeInput);
                    const inputRect = this.activeInput.getBoundingClientRect();
                    const margin = 15;

                    // We only need to scroll if the input is actually covered by the keyboard
                    const overlap = inputRect.bottom - (keyboardTop - 5); // Reduced margin for a tighter fit
                    
                    if (overlap > 0) {
                        // Special case: if input is in the cart, don't scroll too far
                        const isInCart = this.activeInput.closest('#cartItems') || this.activeInput.closest('.cart-footer') || this.activeInput.classList.contains('cart-qty-input');
                        const scrollAmount = overlap;

                        if (scrollParent === document.scrollingElement || scrollParent === document.documentElement) {
                            window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
                        } else {
                            scrollParent.scrollBy({ top: scrollAmount, behavior: 'smooth' });
                        }
                    }
                    
                    // Also check if input is above the visible area (rare but possible)
                    const topOverlap = inputRect.top - margin;
                    if (topOverlap < 0) {
                        if (scrollParent === document.scrollingElement || scrollParent === document.documentElement) {
                            window.scrollBy({ top: topOverlap, behavior: 'smooth' });
                        } else {
                            scrollParent.scrollBy({ top: topOverlap, behavior: 'smooth' });
                        }
                    }

                    // Maintain focus
                    try { this.activeInput.focus({ preventScroll: true }); } catch (e) { try { this.activeInput.focus(); } catch (e) { } }
                } catch (err) {
                    // ignore any errors — non-critical UX improvement
                }
            }, 160);
        }
    }

    hide() {
        this.isVisible = false;
        if (this.activeInput) {
            try { this.activeInput.blur(); } catch (e) {}
        }
        this.activeInput = null;
        document.body.classList.remove('keyboard-active', 'keyboard-side-active');
        const kbd = document.getElementById('virtualKeyboard');
        if (kbd) {
            kbd.classList.remove('visible', 'side');
            kbd.classList.add('hidden');
        }
    }

    startVisibilityObserver() {
        this._observer = new MutationObserver(() => {
            if (!this.isVisible || !this.activeInput) return;

            // Add a small delay to the observer check to ignore temporary detachment during reflow
            setTimeout(() => {
                if (!this.activeInput) return;
                const rect = this.activeInput.getBoundingClientRect();
                const style = window.getComputedStyle(this.activeInput);
                const isAttached = this.activeInput.offsetParent !== null;

                if (rect.width === 0 || rect.height === 0 || style.display === 'none' || !isAttached) {
                    this.hide();
                }
            }, 100);
        });
        this._observer.observe(document.body, { attributes: true, childList: true, subtree: true });
    }

    enable() {
        this.isEnabled = true;
        localStorage.setItem('virtualKeyboardEnabled', 'true');
        this.init();
        if (this.startVisibilityObserver) this.startVisibilityObserver();
    }

    disable() {
        this.isEnabled = false;
        localStorage.setItem('virtualKeyboardEnabled', 'false');
        if (this._observer) this._observer.disconnect();
        const kbd = document.getElementById('virtualKeyboard');
        if (kbd) kbd.remove();
        this.isInitialized = false;
    }
}

// Global Singleton
window.virtualKeyboard = new VirtualKeyboard();
if (window.virtualKeyboard.isEnabled) {
    window.virtualKeyboard.startVisibilityObserver();
}
