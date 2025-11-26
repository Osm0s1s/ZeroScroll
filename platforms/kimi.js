/**
 * Kimi Platform Strategy
 *
 * Implements the HopperPlatform interface for Moonshot AI's Kimi.
 * Handles unique "thinking stage" indicators and complex nested content structures.
 * Uses multi-level fallback strategies to handle various message container patterns.
 */
(function () {
  'use strict';

  // Export platform API
  window.HopperPlatform = window.HopperPlatform || {};

  window.HopperPlatform.kimi = {
    name: 'Kimi',
    hostnames: ['www.kimi.com', 'kimi.com'],

    /**
     * Determines if the current environment is the Kimi platform.
     * @returns {boolean} True if the hostname matches Kimi domains.
     */
    isActive: function () {
      return this.hostnames.includes(window.location.hostname);
    },

    /**
     * Scans the DOM to identify and parse chat messages.
     *
     * Strategy:
     * 1. Locates the chat container using multiple fallback selectors.
     * 2. Identifies message items via chat-content-item class.
     * 3. Filters out "thinking stage" UI elements with no actual content.
     * 4. Classifies messages by role using class signatures and element structure.
     * 5. Extracts content using cascading strategies (paragraph → markdown → segment → fallback).
     *
     * @returns {Array} Array of normalized message objects.
     */
    detectMessages: function () {
      try {
        // Container Resolution: Try multiple strategies to locate the chat container
        let container = document.querySelector('.chat-content-container');
        if (!container) {
          container = document.querySelector('[class*="chat-content-container"]');
        }
        if (!container) {
          container = document.querySelector('.chat-detail-main');
        }
        if (!container) {
          container = document.querySelector('[class*="chat-detail-main"]');
        }
        if (!container) {
          container = document.querySelector('.chat-content-list');
        }
        if (!container) {
          container = document.querySelector('[class*="chat-content-list"]');
        }
        if (!container) {
          container = document.querySelector('[class*="chat-content"]');
        }
        if (!container) {
          container = document.querySelector('main');
        }
        if (!container) {
          container = document.body;
        }

        const newMessages = [];

        // Message Aggregation: Collect all message items
        let messageItems = container.querySelectorAll('.chat-content-item');
        if (messageItems.length === 0) {
          messageItems = container.querySelectorAll('[class*="chat-content-item"]');
        }
        if (messageItems.length === 0) {
          messageItems = document.querySelectorAll('.chat-content-item');
        }
        if (messageItems.length === 0) {
          messageItems = document.querySelectorAll('[class*="chat-content-item"]');
        }

        let messageOrder = 0;

        Array.from(messageItems).forEach((itemEl, index) => {
          try {
            // Filter: Skip items that are ONLY thinking stages with no actual content
            const thinkStage = itemEl.querySelector('.think-stage, [class*="think-stage"]');
            const hasParagraph = itemEl.querySelector('.paragraph');
            const hasMarkdown = itemEl.querySelector('.markdown-container');
            const hasUserContent = itemEl.querySelector('.user-content');
            const hasSegmentContent = itemEl.querySelector('.segment-content');

            const hasToolCallContent = itemEl.querySelector('.toolcall-content-text');

            if (thinkStage && !hasParagraph && !hasMarkdown && !hasUserContent && !hasSegmentContent) {
              return;
            }

            // Skip if it's purely a tool call content text (thinking stage)
            if (hasToolCallContent && !hasParagraph && !hasMarkdown && !hasUserContent && !hasSegmentContent) {
              return;
            }

            let role = null;
            let content = '';
            let scrollElement = itemEl;

            // Role Classification: Determine if user or assistant based on class signatures
            const classList = itemEl.classList.toString();
            const classListLower = classList.toLowerCase();
            const isUserItem = classList.includes('chat-content-item-user') ||
              classListLower.includes('chat-content-item-user') ||
              (classListLower.includes('user') && !classListLower.includes('assistant'));

            if (isUserItem) {
              // User Message Extraction
              const userContent = itemEl.querySelector('.user-content');
              if (userContent) {
                role = 'user';
                content = userContent.textContent.trim();
                scrollElement = itemEl;
              } else {
                // Fallback: Extract from item, removing UI elements
                const itemClone = itemEl.cloneNode(true);
                itemClone.querySelectorAll('button, .btn, [class*="button"], [class*="action"]').forEach(el => el.remove());
                content = itemClone.textContent.trim();
                if (content.length > 0) {
                  role = 'user';
                  scrollElement = itemEl;
                }
              }
            } else {
              // Assistant Message Extraction
              const isAssistantItem = classList.includes('chat-content-item-assistant') ||
                classListLower.includes('chat-content-item-assistant') ||
                (!isUserItem && (classListLower.includes('assistant') || classListLower.includes('kimi')));

              const segmentContainer = itemEl.querySelector('.segment-container');

              if (segmentContainer) {
                // Strategy 1: Extract from paragraphs (exclude thinking stage paragraphs)
                const paragraphs = segmentContainer.querySelectorAll('.paragraph');
                if (paragraphs.length > 0) {
                  role = 'assistant';
                  content = Array.from(paragraphs)
                    .filter(p => !p.closest('.think-stage, [class*="think-stage"], .toolcall-content-text'))
                    .map(p => p.textContent.trim())
                    .filter(t => t.length > 0)
                    .join('\n\n');
                  scrollElement = itemEl;

                  // If all paragraphs were filtered out, try fallback strategies
                  if (!content || content.length === 0) {
                    // Strategy 2: Markdown container
                    const markdownContainer = segmentContainer.querySelector('.markdown-container');
                    if (markdownContainer) {
                      const markdownText = markdownContainer.textContent.trim();
                      if (markdownText.length > 0) {
                        content = markdownText;
                      }
                    }

                    // Strategy 3: Segment content (remove avatar only)
                    if (!content || content.length === 0) {
                      const segmentContent = segmentContainer.querySelector('.segment-content');
                      if (segmentContent) {
                        const contentClone = segmentContent.cloneNode(true);
                        contentClone.querySelectorAll('.segment-avatar, .rive-container, [class*="segment-avatar"], [class*="rive-container"]').forEach(el => el.remove());
                        const segmentText = contentClone.textContent.trim();
                        if (segmentText.length > 0) {
                          content = segmentText;
                        }
                      }
                    }

                    // Strategy 4: Segment container (remove avatar)
                    if (!content || content.length === 0) {
                      const segmentClone = segmentContainer.cloneNode(true);
                      segmentClone.querySelectorAll('.segment-avatar, .rive-container, [class*="segment-avatar"], [class*="rive-container"]').forEach(el => el.remove());
                      const containerText = segmentClone.textContent.trim();
                      if (containerText.length > 0) {
                        content = containerText;
                      }
                    }

                    // Strategy 5: All paragraphs including thinking stage
                    if (!content || content.length === 0) {
                      const allParagraphs = segmentContainer.querySelectorAll('.paragraph');
                      if (allParagraphs.length > 0) {
                        content = Array.from(allParagraphs)
                          .map(p => p.textContent.trim())
                          .filter(t => t.length > 0)
                          .join('\n\n');
                      }
                    }

                    // Strategy 6: Entire item (last resort)
                    if (!content || content.length === 0) {
                      const itemClone = itemEl.cloneNode(true);
                      itemClone.querySelectorAll('.segment-avatar, .rive-container, [class*="segment-avatar"], [class*="rive-container"], button, .btn').forEach(el => el.remove());
                      const itemText = itemClone.textContent.trim();
                      if (itemText.length > 0) {
                        content = itemText;
                      }
                    }
                  }
                } else {
                  // No paragraphs: Try markdown or segment content
                  const markdownContainer = segmentContainer.querySelector('.markdown-container');
                  if (markdownContainer && !markdownContainer.closest('.think-stage, [class*="think-stage"], .toolcall-content-text') && !markdownContainer.classList.contains('toolcall-content-text')) {
                    role = 'assistant';
                    content = markdownContainer.textContent.trim();
                    scrollElement = segmentContainer;
                  } else {
                    const segmentContent = segmentContainer.querySelector('.segment-content');
                    if (segmentContent) {
                      role = 'assistant';
                      const contentClone = segmentContent.cloneNode(true);
                      contentClone.querySelectorAll('.segment-avatar, .rive-container, [class*="segment-avatar"], [class*="rive-container"], .think-stage, [class*="think-stage"], .toolcall-content-text').forEach(el => el.remove());
                      content = contentClone.textContent.trim();
                      scrollElement = segmentContainer;
                    } else {
                      // Fallback: Get from segment container
                      const segmentClone = segmentContainer.cloneNode(true);
                      segmentClone.querySelectorAll('.segment-avatar, .rive-container, [class*="segment-avatar"], [class*="rive-container"], .think-stage, [class*="think-stage"], .toolcall-content-text').forEach(el => el.remove());
                      const segmentText = segmentClone.textContent.trim();
                      if (segmentText.length > 0) {
                        role = 'assistant';
                        content = segmentText;
                        scrollElement = segmentContainer;
                      }
                    }
                  }
                }
              } else {
                // No segment container: Try direct extraction
                const paragraph = itemEl.querySelector('.paragraph');
                const markdown = itemEl.querySelector('.markdown-container');

                if (paragraph && !paragraph.closest('.think-stage, [class*="think-stage"], .toolcall-content-text')) {
                  role = 'assistant';
                  content = paragraph.textContent.trim();
                  scrollElement = itemEl;
                } else if (markdown && !markdown.closest('.think-stage, [class*="think-stage"], .toolcall-content-text') && !markdown.classList.contains('toolcall-content-text')) {
                  role = 'assistant';
                  content = markdown.textContent.trim();
                  scrollElement = itemEl;
                } else if (isAssistantItem) {
                  // Has assistant class but no content: Extract from item
                  const itemClone = itemEl.cloneNode(true);
                  itemClone.querySelectorAll('.segment-avatar, .rive-container, [class*="segment-avatar"], [class*="rive-container"], .think-stage, [class*="think-stage"], .toolcall-content-text, button, .btn').forEach(el => el.remove());
                  content = itemClone.textContent.trim();
                  if (content.length > 0) {
                    role = 'assistant';
                    scrollElement = itemEl;
                  }
                } else {
                  // Last resort: Check for avatar (indicates assistant)
                  const hasAvatar = itemEl.querySelector('.segment-avatar, .rive-container, [class*="segment-avatar"], [class*="rive-container"]');
                  if (hasAvatar) {
                    role = 'assistant';
                    const itemClone = itemEl.cloneNode(true);
                    itemClone.querySelectorAll('.segment-avatar, .rive-container, [class*="segment-avatar"], [class*="rive-container"], .think-stage, [class*="think-stage"], .toolcall-content-text').forEach(el => el.remove());
                    content = itemClone.textContent.trim();
                    if (content.length > 0) {
                      scrollElement = itemEl;
                    }
                  }
                }
              }
            }

            if (content) {
              content = content.replace(/\s+/g, ' ').trim();
            }

            if (!role || !content || content.length < 1) {
              return;
            }

            const contentHash = content.substring(0, 50).replace(/\s/g, '').substring(0, 20);
            const id = `msg-kimi-${role}-${index}-${contentHash}`;

            // Scroll Element Validation: Ensure scroll target is the full item
            if (!scrollElement) {
              scrollElement = itemEl;
            } else if (scrollElement !== itemEl) {
              scrollElement = itemEl;
            }

            // DOM Connectivity Check: Verify element is still in DOM
            if (scrollElement && (!scrollElement.isConnected || scrollElement.offsetHeight === 0)) {
              const foundItem = document.querySelector(`.chat-content-item:nth-of-type(${index + 1})`);
              if (foundItem && foundItem.isConnected) {
                scrollElement = foundItem;
              } else {
                if (itemEl.isConnected) {
                  scrollElement = itemEl;
                }
              }
            }

            newMessages.push({
              id,
              role: role,
              content: content.substring(0, 200),
              fullContent: content,
              element: scrollElement,
              timestamp: Date.now(),
              order: messageOrder++
            });
          } catch (err) {
            console.error(`Hopper [Kimi]: Error processing item ${index}:`, err);
          }
        });

        return newMessages;
      } catch (error) {
        console.error('Hopper [Kimi]: Error detecting messages:', error);
        return [];
      }
    },

    /**
     * Returns the main scrollable container for the chat interface.
     */
    getContainer: function () {
      return document.querySelector('.chat-content-container') ||
        document.querySelector('[class*="chat-content-container"]') ||
        document.querySelector('.chat-detail-main') ||
        document.querySelector('[class*="chat-detail-main"]') ||
        document.querySelector('.chat-content-list') ||
        document.querySelector('[class*="chat-content-list"]') ||
        document.querySelector('[class*="chat-content"]') ||
        document.querySelector('main') ||
        document.body;
    },

    /**
     * Returns the CSS selectors used to identify message elements.
     */
    getMessageSelector: function () {
      return '.chat-content-item, [class*="chat-content-item"], .segment-container, .user-content, .paragraph';
    },

    /**
     * Checks if the platform is in a streaming or "thinking" state.
     * Detects visible thinking stage indicators.
     *
     * @returns {boolean} True if active thinking/streaming is detected.
     */
    isStreaming: function () {
      try {
        const thinkStage = document.querySelector('.think-stage, [class*="think-stage"], .toolcall-content-text');
        if (thinkStage) {
          const rect = thinkStage.getBoundingClientRect();
          const style = window.getComputedStyle(thinkStage);
          if (rect.width > 0 && rect.height > 0 &&
            style.display !== 'none' &&
            style.visibility !== 'hidden') {
            return true;
          }
        }
        return false;
      } catch (error) {
        return false;
      }
    },

    /**
     * Returns the debounce time for DOM observation (800ms).
     */
    getDebounceTime: function () {
      return 800;
    },

    /**
     * Returns the wait time after initial detection (2000ms).
     */
    getStreamingWaitTime: function () {
      return 2000;
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
