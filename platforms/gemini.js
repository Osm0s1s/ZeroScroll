/**
 * Gemini Platform Strategy
 *
 * Implements the HopperPlatform interface for Google Gemini.
 * Handles custom elements (user-query-content, response-container) and streaming states.
 * Uses stable IDs and element normalization to maintain message consistency across DOM updates.
 */
(function () {
  'use strict';

  // Export platform API
  window.HopperPlatform = window.HopperPlatform || {};

  window.HopperPlatform.gemini = {
    name: 'Gemini',
    hostnames: ['gemini.google.com'],

    /**
     * Determines if the current environment is the Gemini platform.
     * @returns {boolean} True if the hostname matches Gemini domains.
     */
    isActive: function () {
      return this.hostnames.includes(window.location.hostname);
    },

    /**
     * Scans the DOM to identify and parse chat messages.
     *
     * Strategy:
     * 1. Resolves the main container using Gemini-specific selectors.
     * 2. Aggregates user and assistant message blocks separately, then merges.
     * 3. Sorts elements by DOM position to ensure chronological order.
     * 4. Applies role heuristics and stable ID assignment.
     * 5. Filters out streaming or incomplete messages.
     *
     * @returns {Array} Array of normalized message objects.
     */
    detectMessages: function () {
      try {
        const container = document.querySelector('main') ||
          document.querySelector('[class*="chat"]') ||
          document.querySelector('[class*="conversation"]') ||
          document.querySelector('response-container')?.parentElement;

        if (!container) {
          return [];
        }

        const newMessages = [];
        const seen = new Set();
        let order = 0;

        // Checks if an element is in an active streaming state
        const isStreaming = (element) => {
          if (!element) return false;
          const busyEl = element.closest('[aria-busy="true"]') || element.querySelector('[aria-busy="true"]');
          if (busyEl) return true;
          const ariaLive = element.getAttribute('aria-live');
          if (ariaLive && ariaLive.toLowerCase() === 'polite' && element.getAttribute('aria-busy') === 'true') {
            return true;
          }
          const text = element.textContent?.trim().toLowerCase() || '';
          if (text.length <= 80 && (text.includes('thinking') || text.includes('preparing'))) {
            return true;
          }
          return false;
        };

        // Generates or retrieves a stable ID for an element to prevent duplication on re-detection
        const getStableId = (el, role, fallbackHash) => {
          if (!el) return `msg-gemini-${role}-${fallbackHash}`;
          const existing = el.getAttribute('data-hopper-id');
          if (existing) return existing;

          const domId = el.getAttribute('data-message-id') || el.id;
          const newId = domId ? `msg-gemini-${role}-${domId}` : `msg-gemini-${role}-${fallbackHash}`;
          el.setAttribute('data-hopper-id', newId);
          return newId;
        };

        // Normalizes a node to its outermost message container
        const normalizeNode = (node) => {
          if (!node) return null;
          const userWrapper = node.closest('.user-query-container, user-query-content');
          if (userWrapper) return userWrapper;
          const responseWrapper = node.closest('response-container, div.response-container');
          if (responseWrapper) return responseWrapper;
          return node;
        };

        // Checks if an element is visually hidden
        const isHidden = (el) => {
          if (!el) return true;
          if (el.hasAttribute('hidden')) return true;
          const ariaHidden = el.getAttribute('aria-hidden');
          if (ariaHidden && ariaHidden.toLowerCase() === 'true') return true;
          const style = window.getComputedStyle ? window.getComputedStyle(el) : null;
          if (style && (style.display === 'none' || style.visibility === 'hidden')) return true;
          return false;
        };

        // Processes a single message node and adds it to the collection if valid
        const handleNode = (node, roleHint) => {
          if (!node) return;
          const el = normalizeNode(node);
          if (!el || seen.has(el)) return;
          if (isHidden(el)) return;

          let role = roleHint || 'assistant';

          // Role Classification: Check for user-specific patterns
          if (el.matches('.user-query-container, user-query-content')) {
            role = 'user';
          }

          if (el.matches('response-container, div.response-container')) {
            role = 'assistant';
          }

          if (el.querySelector('[class*="user"]') ||
            el.querySelector('[class*="User"]') ||
            el.getAttribute('data-role') === 'user' ||
            el.getAttribute('data-message-role') === 'user' ||
            el.classList.toString().toLowerCase().includes('user')) {
            role = 'user';
          }

          if (el.querySelector('[class*="model"]') ||
            el.querySelector('[class*="assistant"]') ||
            el.querySelector('[class*="Assistant"]') ||
            el.getAttribute('data-role') === 'assistant' ||
            el.getAttribute('data-message-role') === 'model' ||
            el.classList.toString().toLowerCase().includes('model')) {
            role = 'assistant';
          }

          let content = '';

          // Content Extraction: Target markdown or text containers, fallback to element itself
          const textEl = el.querySelector('.markdown, .markdown-main-panel') ||
            el.querySelector('[class*="text"]') ||
            el.querySelector('[class*="content"]') ||
            el.querySelector('p') ||
            el.querySelector('div[role="text"]') ||
            el;

          if (textEl) {
            const clone = textEl.cloneNode(true);
            // Remove UI elements that are not part of the message content
            clone.querySelectorAll('button, svg, cite-chip, inline-copy-host, response-actions-bar').forEach(node => node.remove());
            content = clone.textContent || '';
          }

          content = content.replace(/\s+/g, ' ').trim();

          // Skip streaming assistant messages (incomplete content)
          if (role === 'assistant' && isStreaming(el)) {
            return;
          }

          if (!content || content.length < 1) {
            return;
          }

          const contentHash = content.substring(0, 80).replace(/\s/g, '').substring(0, 30) || `${Date.now()}`;
          const id = getStableId(el, role, `${order}-${contentHash}`);

          seen.add(el);

          newMessages.push({
            id,
            role: role,
            content: content.substring(0, 200),
            fullContent: content,
            element: el,
            timestamp: Date.now(),
            order: order++
          });
        };

        // Aggregation: Collect user and assistant blocks separately
        let userBlocks = Array.from(container.querySelectorAll('user-query-content'));
        if (userBlocks.length === 0) {
          userBlocks = Array.from(container.querySelectorAll('.user-query-container.user-query-bubble, .user-query-bubble-with-background'));
        }

        let assistantBlocks = Array.from(container.querySelectorAll('model-response'));
        if (assistantBlocks.length === 0) {
          assistantBlocks = Array.from(container.querySelectorAll('response-container, div.response-container'));
        }

        const messageElements = [...userBlocks, ...assistantBlocks];

        // Chronological Sorting: Ensure messages are processed in visual order
        messageElements.sort((a, b) => {
          if (a === b) return 0;
          return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1;
        });

        messageElements.forEach(el => handleNode(el, el.matches('.user-query-container, user-query-content') ? 'user' : 'assistant'));

        return newMessages;
      } catch (error) {
        console.error('Hopper [Gemini]: Error detecting messages:', error);
        return [];
      }
    },

    /**
     * Returns the main scrollable container for the chat interface.
     */
    getContainer: function () {
      return document.querySelector('main') ||
        document.querySelector('[class*="chat"]') ||
        document.querySelector('[class*="conversation"]') ||
        document.querySelector('response-container')?.parentElement;
    },

    /**
     * Returns the CSS selectors used to identify message elements.
     */
    getMessageSelector: function () {
      return '[data-message-id], [class*="message"], [class*="Message"], response-container, div.response-container, .user-query-container, user-query-content, .query-content';
    },

    /**
     * Normalizes the current URL to detect conversation context switches.
     */
    normalizeUrl: function (url) {
      try {
        const u = new URL(url);
        return u.pathname + (u.search || '');
      } catch {
        return url.split('#')[0].replace(/\/$/, '');
      }
    }
  };
})();

