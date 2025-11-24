/**
 * Grok Platform Strategy
 *
 * Implements the HopperPlatform interface for xAI's Grok.
 * Uses predictable ID patterns (response-*) and action button heuristics for role classification.
 * Handles inline media containers and toolbar elements during content extraction.
 */
(function () {
  'use strict';

  window.HopperPlatform = window.HopperPlatform || {};

  window.HopperPlatform.grok = {
    name: 'Grok',
    hostnames: ['grok.com', 'www.grok.com'],

    /**
     * Determines if the current environment is the Grok platform.
     * @returns {boolean} True if the hostname matches Grok domains.
     */
    isActive: function () {
      return this.hostnames.includes(window.location.hostname);
    },

    /**
     * Scans the DOM to identify and parse chat messages.
     *
     * Strategy:
     * 1. Locates message nodes via predictable ID pattern (response-*).
     * 2. Classifies role using action button signatures (Edit/Delete vs Regenerate/Like).
     * 3. Extracts content from message bubbles while filtering UI elements.
     *
     * @returns {Array} Array of normalized message objects.
     */
    detectMessages: function () {
      try {
        const container = this.getContainer();
        if (!container) {
          return [];
        }

        const messageNodes = container.querySelectorAll('div[id^="response-"]');
        if (messageNodes.length === 0) {
          return [];
        }

        const newMessages = [];
        let order = 0;

        messageNodes.forEach((msgEl, index) => {
          try {
            const bubble = msgEl.querySelector('.message-bubble');
            if (!bubble) {
              return;
            }

            const role = determineRole(msgEl);
            const content = extractContent(bubble);

            if (!role || !content || content.length < 1) {
              return;
            }

            const contentHash = content.substring(0, 50).replace(/\s/g, '').substring(0, 20);
            const id = `msg-grok-${role}-${index}-${contentHash}`;

            newMessages.push({
              id,
              originalId: msgEl.id, // Store original DOM ID for reliable lookup
              role,
              content: content.substring(0, 200),
              fullContent: content,
              element: msgEl,
              timestamp: Date.now(),
              order: order++
            });
          } catch (err) {
            console.error('Hopper [Grok]: Error processing message node:', err);
          }
        });

        return newMessages;
      } catch (error) {
        console.error('Hopper [Grok]: Error detecting messages:', error);
        return [];
      }

      // Classifies message role based on action button presence
      function determineRole(msgEl) {
        const hasUserActions = msgEl.querySelector('button[aria-label="Edit"], button[aria-label="Delete"]');
        const hasAssistantActions = msgEl.querySelector('button[aria-label="Regenerate"], button[aria-label="Read Aloud"], button[aria-label="Like"]');

        if (hasUserActions && !hasAssistantActions) {
          return 'user';
        }
        if (hasAssistantActions) {
          return 'assistant';
        }

        // Heuristic Fallback: Check for feedback buttons
        const hasFeedback = msgEl.querySelector('button[aria-label="Like"], button[aria-label="Dislike"]');
        if (hasFeedback) {
          return 'assistant';
        }
        return 'user';
      }

      // Extracts text content from bubble while filtering UI elements
      function extractContent(bubble) {
        const clone = bubble.cloneNode(true);
        clone.querySelectorAll('button, svg, section.inline-media-container, div.action-buttons, div[role="toolbar"]').forEach(el => el.remove());

        const textBlocks = clone.querySelectorAll('div[dir="auto"].break-words, p.break-words');
        const parts = [];
        textBlocks.forEach(block => {
          const text = block.textContent.replace(/\s+/g, ' ').trim();
          if (text) {
            parts.push(text);
          }
        });

        if (parts.length === 0) {
          const fallback = clone.textContent.replace(/\s+/g, ' ').trim();
          if (fallback) {
            parts.push(fallback);
          }
        }

        return parts.join('\n\n').trim();
      }
    },

    /**
     * Returns the main scrollable container for the chat interface.
     */
    getContainer: function () {
      return document.querySelector('[data-testid="drop-container"] main') ||
        document.querySelector('[data-testid="drop-container"]') ||
        document.querySelector('main') ||
        document.body;
    },

    /**
     * Returns the CSS selector pattern for message elements.
     */
    getMessageSelector: function () {
      return 'div[id^="response-"]';
    },

    /**
     * Checks if the platform is currently in a streaming state.
     * @returns {boolean} True if active streaming is detected.
     */
    isStreaming: function () {
      try {
        return !!document.querySelector('div[id^="response-"] [data-state="loading"], div[id^="response-"] svg[aria-label="Loading"]');
      } catch (error) {
        return false;
      }
    },

    /**
     * Returns the debounce time for DOM observation (400ms).
     */
    getDebounceTime: function () {
      return 400;
    },

    /**
     * Returns the wait time after initial detection (1300ms).
     */
    getStreamingWaitTime: function () {
      return 1300;
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

