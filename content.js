/**
 * Hopper - Main Content Script
 *
 * Platform-agnostic router that coordinates platform-specific implementations.
 * Manages sidebar injection, message detection, DOM observation, and user interactions.
 * Supports ChatGPT, Claude, Gemini, Kimi, DeepSeek, Grok, and Qwen.
 */

// Global State
let messages = [];
let favorites = [];
let sidebarInjected = false;
let currentUrl = window.location.href;
let observer = null;
let isResetting = false;
let currentTheme = 'dark';
let searchTimeout = null;
let lastSearchQuery = '';
let activeSidebarMessageId = null;
let activeSidebarElement = null;
let scrollSpyObserver = null;
let kimiScrollContainer = null;
const highlightCleanupMap = new WeakMap();

// Platform instance (dynamically set after detection)
let currentPlatform = null;
const KIMI_SCROLL_SELECTORS = [
  '.chat-content-container',
  '.chat-detail-content',
  '.chat-detail-main',
  '.chat-page.chat',
  '.layout-content-main',
  '.layout-content',
  '.chat-layout',
  '.chat-layout-main',
  '.n-scrollbar-container',
  '.n-scrollbar-content',
  '.scrollbar-container',
  '.scrollbar-content',
  '.virtual-list',
  '.virtual-list-container',
  '.virtual-scroll',
  '[class*="scroll-area"]',
  '[class*="scrollbar"]',
  '[class*="chat-content"]'
];
const KIMI_SCROLL_SELECTOR_STRING = KIMI_SCROLL_SELECTORS.join(', ');



function clearDeepSeekInterval() {
  if (window.hopperDeepSeekInterval) {
    clearInterval(window.hopperDeepSeekInterval);
    window.hopperDeepSeekInterval = null;
  }
}

/**
 * Detects the active AI platform and returns its implementation.
 * 
 * @returns {Object|null} Platform implementation object or null if no platform detected.
 */
function detectPlatform() {
  try {
    // Verify platform APIs are loaded
    if (!window.HopperPlatform) {
      console.error('Hopper: Platform APIs not loaded');
      return null;
    }

    // Iterate through supported platforms
    const platforms = ['chatgpt', 'claude', 'gemini', 'kimi', 'deepseek', 'grok', 'qwen'];

    for (const platformName of platforms) {
      const platform = window.HopperPlatform[platformName];
      if (platform && platform.isActive && platform.isActive()) {
        return platform;
      }
    }

    return null;
  } catch (error) {
    console.error('Hopper: Error detecting platform:', error);
    return null;
  }
}

/**
 * Initializes the extension for the detected platform.
 * Sets up message detection, DOM observation, sidebar injection, and theme.
 */
function init() {
  try {
    // Detect current platform
    currentPlatform = detectPlatform();
    // Reset cached scroll container on context switch
    kimiScrollContainer = null;

    if (!currentPlatform) {
      return;
    }

    if (currentPlatform.name !== 'DeepSeek') {
      clearDeepSeekInterval();
    }

    // Clear Qwen interval if switching away from Qwen
    if (currentPlatform.name !== 'Qwen' && window.hopperQwenInterval) {
      clearInterval(window.hopperQwenInterval);
      window.hopperQwenInterval = null;
    }

    // Load theme preference
    chrome.runtime.sendMessage({ type: 'GET_THEME' }, (response) => {
      if (!chrome.runtime.lastError) {
        currentTheme = response.theme || 'dark';
        applyTheme(currentTheme);
      }
    });

    // Load favorites
    chrome.runtime.sendMessage({ type: 'GET_FAVORITES' }, (response) => {
      if (!chrome.runtime.lastError) {
        favorites = response.favorites || [];
        setTimeout(() => updateTabCounts(), 100);
      }
    });

    // Inject sidebar immediately
    injectSidebar();

    // Set platform attribute for platform-specific styling (after sidebar is injected)
    setTimeout(() => {
      setPlatformAttribute();
    }, 0);

    // Set up URL change detection (for SPA navigation)
    setupNavigationObserver();

    // Kimi-specific: Wait longer for messages to load before starting detection
    const isKimi = currentPlatform.name === 'Kimi';
    const initialDelay = isKimi ? 5000 : 0; // 5 second delay for Kimi (slower loading on page reload)

    // Aggressive initial detection - try multiple times to catch first message
    let attemptCount = 0;
    const maxAttempts = isKimi ? 15 : 10; // More attempts for Kimi

    // Get platform-specific detection interval (Claude needs longer waits)
    const detectionInterval = currentPlatform.getStreamingWaitTime ?
      Math.max(500, currentPlatform.getStreamingWaitTime() / 4) : 500;

    const tryDetect = () => {
      try {
        attemptCount++;

        // For Kimi: Check if container exists before trying to detect (but don't block if it doesn't - let detectMessages handle it)
        if (isKimi && attemptCount <= 3) {
          // For first few attempts, check if the chat container exists
          const chatContainer = document.querySelector('.chat-content-container, [class*="chat-content-container"], .chat-detail-main, [class*="chat-detail-main"]');
          if (!chatContainer) {
            // Container not ready yet, wait longer before first few attempts
            if (attemptCount < maxAttempts) {
              setTimeout(tryDetect, 2000);
            }
            return;
          }
        }

        const beforeCount = messages.length;
        detectMessages();
        const afterCount = messages.length;

        if (afterCount > beforeCount) {
          observeDOM();
          // If platform has streaming wait time, wait longer before next attempt
          if (attemptCount < maxAttempts) {
            const nextInterval = currentPlatform.getStreamingWaitTime ?
              Math.max(detectionInterval, currentPlatform.getStreamingWaitTime() / 2) : detectionInterval;
            setTimeout(tryDetect, nextInterval);
          }
        } else if (afterCount === 0 && attemptCount < maxAttempts) {
          // Kimi: Use longer intervals if no messages found yet
          const retryInterval = isKimi ? Math.max(detectionInterval * 3, 1500) : detectionInterval;
          setTimeout(tryDetect, retryInterval);
        } else if (afterCount > 0) {
          observeDOM();
        } else if (afterCount === 0 && attemptCount >= maxAttempts) {
          // Even if max attempts reached, still set up observer for late-loading messages
          observeDOM();
        }
      } catch (error) {
        console.error('Hopper: Error in detection attempt:', error);
      }
    };

    // Initial attempts with platform-specific timing (Kimi gets initial delay)
    setTimeout(() => {
      tryDetect();
      setTimeout(tryDetect, detectionInterval);
      setTimeout(tryDetect, detectionInterval * 2);
    }, initialDelay);
  } catch (error) {
    console.error('Hopper: Fatal error in init:', error);
  }
}

/**
 * Sets up navigation detection for Single Page Applications.
 * Intercepts history API calls and monitors URL changes to trigger resets.
 */
function setupNavigationObserver() {
  try {
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(history, args);
      checkUrlChange();
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(history, args);
      checkUrlChange();
    };

    window.addEventListener('popstate', checkUrlChange);
    setInterval(checkUrlChange, 1000);
  } catch (error) {
    console.error('Hopper: Error setting up navigation observer:', error);
  }
}

/**
 * Monitors URL changes and triggers extension reset for new conversations.
 * Uses platform-specific URL normalization to detect context switches.
 */
function checkUrlChange() {
  try {
    if (!currentPlatform) return;

    const newUrl = window.location.href;
    const normalizeUrl = currentPlatform.normalizeUrl || ((url) => {
      try {
        const u = new URL(url);
        return u.pathname + (u.search || '');
      } catch {
        return url.split('#')[0].replace(/\/$/, '');
      }
    });

    const currentNormalized = normalizeUrl(currentUrl);
    const newNormalized = normalizeUrl(newUrl);

    if (currentNormalized !== newNormalized && !isResetting) {
      isResetting = true;
      if (currentPlatform?.name === 'Kimi') {
        kimiScrollContainer = null;
      }
      messages = [];
      teardownScrollSpy();
      currentUrl = newUrl;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (observerTimeout) {
        clearTimeout(observerTimeout);
        observerTimeout = null;
      }
      updateUI();
      setTimeout(() => {
        detectMessages();
        observeDOM();
        isResetting = false;
      }, 1000);
    }
  } catch (error) {
    console.error('Hopper: Error checking URL change:', error);
  }
}

/**
 * Injects the Hopper sidebar into the page.
 * Creates UI structure, attaches event listeners, and initializes resize functionality.
 */
function injectSidebar() {
  if (sidebarInjected) return;

  const container = document.createElement('div');
  container.id = 'hopper-root';
  container.innerHTML = `
    <div id="hopper-pill" class="hopper-pill">
      <div class="hopper-pill-content">
        <div class="hopper-pill-brand">
          <span class="hopper-brand-text">
            <span class="hopper-letter">H</span>
            <span class="hopper-letter">O</span>
            <span class="hopper-letter">P</span>
            <span class="hopper-letter">P</span>
            <span class="hopper-letter">E</span>
            <span class="hopper-letter">R</span>
          </span>
        </div>
        <div class="hopper-pill-badge">
          <span class="hopper-badge">0</span>
        </div>
      </div>
    </div>
   
    <div id="hopper-sidebar" class="hopper-sidebar hopper-hidden">
       <div class="hopper-resize-handle"></div>
       <div class="hopper-header">
        <div class="hopper-header-title">
          <h2>
            <span class="hopper-header-brand">Hopper</span>
            <span id="hopper-platform-tag" class="hopper-platform-tag"></span>
          </h2>
          <button id="hopper-code-link" class="hopper-code-link">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path d="M9 18l-6-6 6-6m6 12l6-6-6-6M4 12h3m10 0h3"/>
            </svg>
            <span class="hopper-tooltip">View source</span>
          </button>
        </div>
        <div class="hopper-header-actions">
           <button id="hopper-theme-toggle" class="hopper-btn-icon hopper-theme-toggle" title="Toggle theme">
             <svg class="hopper-theme-icon hopper-theme-icon-dark" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
               <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>
             </svg>
             <svg class="hopper-theme-icon hopper-theme-icon-light" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
               <circle cx="12" cy="12" r="4"/>
               <path d="m12 2 0 2m0 16 0 2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12l2 0m16 0 2 0M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
             </svg>
           </button>
           <button id="hopper-close" class="hopper-btn-icon" title="Close sidebar">
             <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
               <path d="M18 6L6 18M6 6l12 12"/>
             </svg>
           </button>
         </div>
       </div>
      
      <div class="hopper-tabs">
        <button class="hopper-tab hopper-tab-active" data-filter="all">
          <span class="hopper-tab-label">All</span>
          <span class="hopper-tab-count" data-count-type="all">0</span>
        </button>
        <button class="hopper-tab" data-filter="user">
          <span class="hopper-tab-label">User</span>
          <span class="hopper-tab-count" data-count-type="user">0</span>
        </button>
        <button class="hopper-tab" data-filter="assistant">
          <span class="hopper-tab-label">AI</span>
          <span class="hopper-tab-count" data-count-type="assistant">0</span>
        </button>
         <button class="hopper-tab" data-filter="favorites">
           <span class="hopper-tab-label">
             <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
               <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
             </svg>
           </span>
           <span class="hopper-tab-count" data-count-type="favorites">0</span>
         </button>
      </div>
      
      <div class="hopper-search">
        <input type="text" id="hopper-search-input" placeholder="Search messages..." />
      </div>
      
      <div id="hopper-messages" class="hopper-messages">
        <div class="hopper-empty">No messages yet</div>
      </div>
    </div>
  `;

  document.body.appendChild(container);
  sidebarInjected = true;

  // Attach event listeners
  document.getElementById('hopper-pill').addEventListener('click', toggleSidebar);
  document.getElementById('hopper-close').addEventListener('click', toggleSidebar);
  document.getElementById('hopper-search-input').addEventListener('input', handleSearch);

  const themeToggle = document.getElementById('hopper-theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }
  const codeLink = document.getElementById('hopper-code-link');
  if (codeLink) {
    codeLink.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      window.open('https://github.com/Osm0s1s/Hopper', '_blank', 'noopener,noreferrer');
    });
  }

  // Load saved sidebar width
  chrome.storage.local.get(['sidebarWidth'], (result) => {
    const sidebar = document.getElementById('hopper-sidebar');
    if (sidebar && result.sidebarWidth) {
      sidebar.style.width = `${result.sidebarWidth}px`;
    }
  });

  // Initialize sidebar resize functionality
  const resizeHandle = document.querySelector('.hopper-resize-handle');
  const sidebar = document.getElementById('hopper-sidebar');
  if (resizeHandle && sidebar) {
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;
    let activePointerId = null;

    const startResize = (clientX) => {
      isResizing = true;
      startX = clientX;
      startWidth = sidebar.offsetWidth || parseInt(getComputedStyle(sidebar).width, 10) || 380;
      document.body.style.cursor = 'ew-resize';
      document.body.style.userSelect = 'none';
      sidebar.style.transition = 'none';
    };

    const updateResize = (clientX) => {
      if (!isResizing) return;
      const diff = startX - clientX;
      const newWidth = Math.max(280, Math.min(600, startWidth + diff));
      sidebar.style.width = `${newWidth}px`;
      sidebar.style.setProperty('width', `${newWidth}px`, 'important');
    };

    const stopResize = () => {
      if (!isResizing) return;
      isResizing = false;
      activePointerId = null;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      sidebar.style.transition = '';
      const currentWidth = sidebar.offsetWidth || parseInt(getComputedStyle(sidebar).width, 10);
      if (currentWidth) {
        chrome.storage.local.set({ sidebarWidth: currentWidth });
      }
    };

    const shouldStartResize = (e) => {
      const sidebarRect = sidebar.getBoundingClientRect();
      const distanceFromLeft = e.clientX - sidebarRect.left;
      const targetIsHandle = e.target === resizeHandle || (e.target && e.target.closest && e.target.closest('.hopper-resize-handle'));
      return targetIsHandle || distanceFromLeft <= 14;
    };

    const handlePointerDown = (e) => {
      if (!shouldStartResize(e)) return;
      activePointerId = e.pointerId;
      startResize(e.clientX);
      if (e.target && e.target.setPointerCapture) {
        try {
          e.target.setPointerCapture(activePointerId);
        } catch (_) { }
      }
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
    };

    const handlePointerMove = (e) => {
      if (!isResizing) return;
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      updateResize(e.clientX);
      e.preventDefault();
      e.stopPropagation();
    };

    const handlePointerUp = (e) => {
      if (activePointerId !== null && e.pointerId !== activePointerId) return;
      if (e.target && e.target.releasePointerCapture) {
        try {
          e.target.releasePointerCapture(activePointerId || e.pointerId);
        } catch (_) { }
      }
      stopResize();
      e.preventDefault();
      e.stopPropagation();
    };

    const handleMouseLeave = () => {
      if (isResizing) {
        stopResize();
      }
    };

    // Attach pointer listeners
    resizeHandle.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: false });
    sidebar.addEventListener('pointerdown', handlePointerDown, { capture: true, passive: false });
    window.addEventListener('pointermove', handlePointerMove, { capture: true, passive: false });
    window.addEventListener('pointerup', handlePointerUp, { capture: true, passive: false });
    window.addEventListener('pointercancel', handlePointerUp, { capture: true, passive: false });
    sidebar.addEventListener('mouseleave', handleMouseLeave, { capture: true });

    // Prevent text selection / drag artifacts
    resizeHandle.addEventListener('selectstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    });
    resizeHandle.addEventListener('dragstart', (e) => {
      e.preventDefault();
      e.stopPropagation();
      return false;
    });
  }

  // Event delegation for tab switching (handles fast clicks reliably)
  const tabsContainer = document.querySelector('.hopper-tabs');
  if (tabsContainer) {
    tabsContainer.addEventListener('click', (e) => {
      const tab = e.target.closest('.hopper-tab');
      if (tab && tab.dataset.filter) {
        e.preventDefault();
        e.stopPropagation();
        handleFilter({ target: tab });
      }
    }, { passive: false });
  }

  // Event delegation for message interactions (handles rapid UI updates reliably)
  const messagesContainer = document.getElementById('hopper-messages');
  if (messagesContainer) {
    messagesContainer.addEventListener('click', (e) => {
      // Immediate handling - no delays or debouncing
      e.stopPropagation(); // Prevent any parent handlers

      // Handle copy button
      const copyBtn = e.target.closest('.hopper-copy');
      if (copyBtn && copyBtn.dataset.id) {
        e.preventDefault();
        copyMessage(copyBtn.dataset.id);
        return;
      }

      // Handle favorite button
      const favoriteBtn = e.target.closest('.hopper-favorite');
      if (favoriteBtn && favoriteBtn.dataset.id) {
        e.preventDefault();
        toggleFavorite(favoriteBtn.dataset.id);
        return;
      }

      // Handle message card click (scroll to message)
      const messageCard = e.target.closest('.hopper-message');
      if (messageCard && !e.target.closest('.hopper-message-actions') && messageCard.dataset.id) {
        triggerMessageRipple(messageCard, e);
        scrollToMessage(messageCard.dataset.id);
      }
    }, { passive: false, capture: false }); // Ensure we can preventDefault
  }

  // Apply initial theme
  applyTheme(currentTheme);

  // Update platform tag after sidebar is fully injected
  if (currentPlatform) {
    setPlatformAttribute();
  }

  // Initial UI update
  updateUI();
}

/**
 * Detects and parses messages from the current page.
 * Delegates to platform-specific implementation and updates global state.
 */
function detectMessages() {
  try {
    if (!currentPlatform || !currentPlatform.detectMessages) {
      return;
    }

    const newMessages = currentPlatform.detectMessages();

    if (newMessages.length > 0) {
      // Check for duplicates by ID first
      const existingIds = new Set(messages.map(m => m.id));
      let uniqueNewMessages = newMessages.filter(m => !existingIds.has(m.id));

      // For DeepSeek: Ensure new messages get order numbers higher than existing ones
      // This prevents old messages from appearing after new ones
      if (currentPlatform && currentPlatform.name === 'DeepSeek' && uniqueNewMessages.length > 0) {
        const maxExistingOrder = messages.length > 0
          ? Math.max(...messages.map(m => m.order !== undefined ? m.order : -1))
          : -1;

        // Reassign order numbers to new messages, starting from maxExistingOrder + 1
        uniqueNewMessages.forEach((msg, index) => {
          msg.order = maxExistingOrder + 1 + index;
        });
      }

      // Additional deduplication: check for similar content (handles streaming duplicates)
      // This catches cases where same message is detected during streaming and after completion
      // BUT allows legitimate duplicate messages (same content sent multiple times)
      uniqueNewMessages = uniqueNewMessages.filter(newMsg => {
        // Check if we already have a very similar message
        for (const existingMsg of messages) {
          // Must be same role
          if (existingMsg.role !== newMsg.role) continue;

          // Check 1: Same order position AND same element (most reliable - same position in conversation, same DOM element)
          // This catches streaming updates where the same message is detected multiple times
          if (existingMsg.order !== undefined && newMsg.order !== undefined) {
            if (existingMsg.order === newMsg.order) {
              // Same order - check if it's the same element (streaming update) or different (legitimate duplicate)
              if (existingMsg.element && newMsg.element && existingMsg.element === newMsg.element) {
                return false;
              }
              // Same order but different element - might be legitimate, but likely a duplicate
              // Only filter if content is also very similar
              const existingContent = (existingMsg.fullContent || existingMsg.content || '').trim().toLowerCase();
              const newContent = (newMsg.fullContent || newMsg.content || '').trim().toLowerCase();
              if (existingContent && newContent && existingContent === newContent) {
                return false;
              }
            }
          }

          // Check 2: Same element reference (definitely a duplicate - same DOM element detected again)
          if (existingMsg.element && newMsg.element && existingMsg.element === newMsg.element) {
            return false;
          }

          // Check 3: Content similarity - only filter if it's likely a streaming update
          // Allow legitimate duplicate messages (same content, different elements, different positions)
          const existingContent = (existingMsg.fullContent || existingMsg.content || '').trim().toLowerCase();
          const newContent = (newMsg.fullContent || newMsg.content || '').trim().toLowerCase();

          if (!existingContent || !newContent) continue;

          // Only filter if content is very similar AND elements are close in DOM (likely streaming update)
          // If elements are far apart or different, allow it (legitimate duplicate message)
          if (existingContent === newContent ||
            (existingContent.length > 10 && newContent.length > 10 &&
              Math.abs(existingContent.length - newContent.length) < 5 &&
              existingContent.substring(0, Math.min(50, existingContent.length)) === newContent.substring(0, Math.min(50, newContent.length)))) {

            // Check if elements are close in DOM (likely streaming update)
            if (existingMsg.element && newMsg.element) {
              try {
                // Check if elements are siblings or very close (within 5 levels)
                let distance = 0;
                let current = newMsg.element;
                while (current && current !== existingMsg.element && distance < 5) {
                  current = current.parentElement;
                  distance++;
                }

                // If elements are close (siblings or within 3 levels), likely streaming update
                if (distance < 3 && current === existingMsg.element) {
                  return false;
                }
                // Elements are far apart - allow it (legitimate duplicate message)
              } catch (e) {
                // Error checking DOM relationship - be conservative, allow the message
              }
            }
          }
        }
        return true;
      });

      if (uniqueNewMessages.length > 0) {
        messages = [...messages, ...uniqueNewMessages];
        // Sort by detection order first (most reliable), then DOM position
        messages.sort((a, b) => {
          // Priority 1: Use detection order if available (most reliable for complex DOMs)
          if (a.order !== undefined && b.order !== undefined) {
            return a.order - b.order;
          }
          if (a.order !== undefined) return -1; // a has order, b doesn't - a comes first
          if (b.order !== undefined) return 1; // b has order, a doesn't - b comes first

          // Priority 2: Use DOM position if elements exist
          if (a.element && b.element) {
            // Try compareDocumentPosition first
            try {
              const position = a.element.compareDocumentPosition(b.element);
              // If a comes before b in document order (b follows a)
              if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
                return -1; // a should come first
              }
              // If a comes after b in document order (b precedes a)
              if (position & Node.DOCUMENT_POSITION_PRECEDING) {
                return 1; // b should come first
              }
            } catch (e) {
              // compareDocumentPosition failed, fall through to offsetTop
            }

            // Fallback to offsetTop
            const posA = a.element.offsetTop || 0;
            const posB = b.element.offsetTop || 0;
            if (posA !== posB) {
              return posA - posB;
            }
          }

          // Priority 3: Use timestamp as last resort
          return (a.timestamp || 0) - (b.timestamp || 0);
        });
        setupScrollSpy();
        updateUI();
      }
    }
  } catch (error) {
    console.error(`Hopper: Error detecting messages on ${currentPlatform?.name || 'unknown'}:`, error);
  }
}

/**
 * Observes DOM changes and triggers message re-detection.
 * Platform-specific optimizations for streaming detection and debounce timing.
 */
let observerTimeout;
let streamingTimeout;
function observeDOM() {
  try {
    if (!currentPlatform) return;

    // Disconnect existing observer if any
    if (observer) {
      observer.disconnect();
    }

    let container = currentPlatform.getContainer ? currentPlatform.getContainer() : document.querySelector('main');
    if (!container) {
      container = document.body;
    }

    // Get platform-specific debounce time (default 300ms for fast platforms)
    const debounceTime = currentPlatform.getDebounceTime ? currentPlatform.getDebounceTime() : 300;

    const shouldWatchAttributes = currentPlatform && ['DeepSeek', 'Gemini', 'Qwen'].includes(currentPlatform.name);

    observer = new MutationObserver((mutations) => {
      clearTimeout(observerTimeout);

      // Platform-specific handling for real-time message detection
      if (currentPlatform) {
        const addedNodes = mutations.reduce((sum, m) => sum + m.addedNodes.length, 0);
        const removedNodes = mutations.reduce((sum, m) => sum + m.removedNodes.length, 0);
        const hasRelevantChanges = addedNodes > 0 || removedNodes > 0 ||
          mutations.some(m => m.type === 'attributes' && (m.attributeName === 'class' || m.attributeName === 'style'));

        if (hasRelevantChanges) {
          // DeepSeek: Check for message nodes
          if (currentPlatform.name === 'DeepSeek') {
            const hasMessageNodes = mutations.some(m => {
              return Array.from(m.addedNodes).some(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  const el = node;
                  return el.classList && (
                    el.classList.contains('ds-message') ||
                    el.classList.toString().includes('ds-message') ||
                    el.querySelector('.ds-message, .fbb737a4, .ds-markdown')
                  );
                }
                return false;
              });
            });

            if (hasMessageNodes) {
              clearTimeout(observerTimeout);
              observerTimeout = setTimeout(() => {
                detectMessages();
              }, 200);
              return;
            }
          }

          // Qwen: Check for new assistant messages (response containers) - more aggressive
          if (currentPlatform.name === 'Qwen') {
            const hasQwenMessages = mutations.some(m => {
              // Check added nodes
              const hasAdded = Array.from(m.addedNodes).some(node => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                  const el = node;
                  // Check if it's a message element or contains message elements
                  return (el.id && el.id.startsWith('message-')) ||
                    el.classList.contains('user-message') ||
                    el.classList.contains('response-meesage-container') ||
                    el.classList.contains('response-message-container') ||
                    el.querySelector('div[id^="message-"], .user-message, .response-meesage-container, .response-message-container, .markdown-content-container, #response-content-container') !== null;
                }
                return false;
              });

              // Also check for attribute changes in message containers (streaming updates)
              if (m.type === 'attributes' && m.target) {
                const target = m.target;
                if (target.id && target.id.startsWith('message-')) {
                  return true;
                }
                if (target.closest && target.closest('div[id^="message-"]')) {
                  return true;
                }
              }

              // Check subtree changes (content being added to existing messages)
              if (m.type === 'childList' && m.target) {
                const target = m.target;
                if (target.id && target.id.startsWith('message-')) {
                  return true;
                }
                if (target.closest && target.closest('div[id^="message-"]')) {
                  return true;
                }
              }

              return hasAdded;
            });

            if (hasQwenMessages) {
              clearTimeout(observerTimeout);
              // Immediate detection for Qwen (very short debounce)
              observerTimeout = setTimeout(() => {
                detectMessages();
                // Also schedule a follow-up detection to catch streaming updates
                setTimeout(() => {
                  detectMessages();
                }, 800);
              }, 200);
              return;
            }
          }
        }
      }

      // Clear any existing streaming timeout
      if (streamingTimeout) {
        clearTimeout(streamingTimeout);
      }

      observerTimeout = setTimeout(() => {
        // Skip streaming check if we already have messages (likely loading old conversation)
        // Only check streaming for new/active conversations
        const hasExistingMessages = messages.length > 0;

        // Check if platform is still streaming (e.g., Claude thinking)
        // Only check if we don't have messages yet OR if we detect active streaming
        const isStreaming = !hasExistingMessages && currentPlatform.isStreaming ? currentPlatform.isStreaming() : false;

        if (isStreaming) {
          // If still streaming, wait longer before detecting
          const streamingWaitTime = currentPlatform.getStreamingWaitTime ? currentPlatform.getStreamingWaitTime() : 2000;

          streamingTimeout = setTimeout(() => {
            // Check again if still streaming
            const stillStreaming = currentPlatform.isStreaming ? currentPlatform.isStreaming() : false;
            if (!stillStreaming) {
              // Not streaming anymore, safe to detect
              detectMessages();
            } else {
              // Still streaming, wait a bit more
              streamingTimeout = setTimeout(() => {
                detectMessages();
              }, streamingWaitTime);
            }
          }, streamingWaitTime);
        } else {
          // Not streaming (or loading old conversation), detect immediately
          const beforeCount = messages.length;
          detectMessages();
          const afterCount = messages.length;

          // If new messages were detected in an active conversation, wait a bit more to ensure complete
          // Skip this wait if we already had messages (old conversation loading)
          if (!hasExistingMessages && afterCount > beforeCount && currentPlatform.getStreamingWaitTime) {
            const streamingWaitTime = currentPlatform.getStreamingWaitTime();
            streamingTimeout = setTimeout(() => {
              // Re-detect after streaming completes to catch final message content
              detectMessages();
            }, streamingWaitTime);
          }

          // Qwen-specific: Always re-detect after a delay to catch streaming content updates
          if (currentPlatform.name === 'Qwen') {
            const qwenWaitTime = currentPlatform.getStreamingWaitTime ? currentPlatform.getStreamingWaitTime() : 1500;
            if (afterCount > beforeCount || hasExistingMessages) {
              // New messages detected or existing conversation - do follow-up detection
              setTimeout(() => {
                detectMessages();
              }, qwenWaitTime);
            }
          }
        }
      }, debounceTime);
    });

    const observerOptions = {
      childList: true,
      subtree: true
    };

    if (shouldWatchAttributes) {
      observerOptions.attributes = true;
      observerOptions.attributeFilter = ['class', 'style'];
    }

    observer.observe(container, observerOptions);

    if (currentPlatform && currentPlatform.name === 'DeepSeek') {
      // Clear any existing interval
      clearDeepSeekInterval();

      let periodicCheckInterval = setInterval(() => {
        detectMessages();
      }, 1500); // Check every 1.5 seconds as fallback (more frequent)

      // Store interval ID so we can clear it if needed
      window.hopperDeepSeekInterval = periodicCheckInterval;
    } else {
      clearDeepSeekInterval();
    }

    // Qwen: Also add periodic check for streaming messages
    if (currentPlatform && currentPlatform.name === 'Qwen') {
      // Clear any existing Qwen interval
      if (window.hopperQwenInterval) {
        clearInterval(window.hopperQwenInterval);
      }

      let qwenCheckInterval = setInterval(() => {
        detectMessages();
      }, 1200); // Check every 1.2 seconds for Qwen streaming updates

      window.hopperQwenInterval = qwenCheckInterval; // Store interval ID
    }
  } catch (error) {
    console.error(`Hopper: Error setting up DOM observer for ${currentPlatform?.name || 'unknown'}:`, error);
  }
}

/**
 * Toggles the visibility of the sidebar.
 * Manages animation states and pill display.
 */
function toggleSidebar() {
  const sidebar = document.getElementById('hopper-sidebar');
  const pill = document.getElementById('hopper-pill');

  if (!sidebar || !pill) return;

  const isHidden = sidebar.classList.contains('hopper-hidden');

  if (isHidden) {
    // Opening: Remove hidden class to trigger expand animation
    sidebar.classList.remove('hopper-hidden');
    // Hide pill with fade
    pill.classList.add('hopper-hidden');
    // Focus search after animation
    setTimeout(() => {
      const searchInput = document.getElementById('hopper-search-input');
      if (searchInput) {
        searchInput.focus();
      }
    }, 200);
  } else {
    // Closing: Add hidden class to trigger collapse animation
    sidebar.classList.add('hopper-hidden');
    // Show pill after sidebar starts collapsing
    setTimeout(() => {
      pill.classList.remove('hopper-hidden');
    }, 100);
  }
}

/**
 * Scrolls to a specific message in the chat and highlights it.
 * @param {string} id Message ID to scroll to.
 */
function scrollToMessage(id) {
  const msg = messages.find(m => m.id === id);
  if (!msg) {
    return;
  }

  const messageCard = document.querySelector(`.hopper-message[data-id="${id}"]`);
  if (messageCard) {
    messageCard.classList.add('hopper-message-press');
    setTimeout(() => messageCard.classList.remove('hopper-message-press'), 220);
  }

  highlightSidebarMessage(id);

  const target = ensureMessageElement(msg, id);
  if (!target || !target.isConnected) {
    return;
  }

  const { container } = resolveScrollContainer(target);
  smoothScrollToTarget(target, container);
  animateMessageHighlight(target);
}

function ensureMessageElement(msg, id) {
  if (msg.element && msg.element.isConnected) {
    return msg.element;
  }

  let candidate = null;
  const platformName = currentPlatform?.name;
  const searchText = (msg.fullContent || msg.content || '').trim().toLowerCase();

  if (platformName === 'Kimi' && searchText) {
    const firstWords = searchText.split(/\s+/).slice(0, 5).join(' ');
    const items = document.querySelectorAll('.chat-content-item');
    for (const item of items) {
      const text = item.textContent.trim().toLowerCase();
      if (text.startsWith(firstWords) || text.includes(` ${firstWords}`) || text.includes(searchText.substring(0, 50))) {
        candidate = item;
        break;
      }
    }

    if (!candidate) {
      const selectors = msg.role === 'assistant'
        ? '.paragraph, .markdown-container'
        : '.user-content';
      const blocks = document.querySelectorAll(selectors);
      for (const block of blocks) {
        const text = block.textContent.trim().toLowerCase();
        if (text.startsWith(firstWords) || text.includes(` ${firstWords}`)) {
          const wrapper = block.closest('.chat-content-item');
          if (wrapper) {
            candidate = wrapper;
            break;
          }
        }
      }
    }
  } else {
    // Try originalId first (most reliable for Grok)
    if (msg.originalId) {
      candidate = document.getElementById(msg.originalId);
    }

    if (!candidate) {
      candidate = document.querySelector(`[data-id="${id}"]`) ||
        document.querySelector(`[id*="${id}"]`);
    }
  }

  if (candidate) {
    msg.element = candidate;
  }
  return candidate;
}

function resolveScrollContainer(target) {
  const platformName = currentPlatform?.name;
  let container = null;

  if (platformName === 'Kimi') {
    container = getKimiScrollContainer(target);
    gentlyNudgeKimiContainer(container);
  } else if (platformName === 'Grok') {
    container = document.querySelector('[data-testid="drop-container"] main') ||
      document.querySelector('[data-testid="drop-container"]');
  } else if (platformName === 'ChatGPT') {
    container = document.querySelector('.flex-1.flex.flex-col') ||
      document.querySelector('[class*="overflow"]');
  } else if (platformName === 'DeepSeek') {
    container = document.querySelector('.ds-scroll-area') ||
      document.querySelector('[class*="ds-scroll-area"]') ||
      document.querySelector('[class*="_0f72b0b"]');
  } else {
    container = document.querySelector('main') ||
      document.querySelector('[class*="scroll"]');
  }

  const ancestor = findScrollableAncestor(target);
  if (ancestor && ancestor !== document.body) {
    // For Grok, don't let ancestor override if we already found the main drop-container
    // This prevents selecting the message card itself as the scroll container
    if (platformName === 'Grok' && container && container.getAttribute('data-testid') === 'drop-container') {
      // Keep existing container
    } else {
      container = ancestor;
    }
  }

  const fallback = document.scrollingElement || document.documentElement;
  const hasScrollSpace = container && (container.scrollHeight - container.clientHeight > 10);
  return { container: hasScrollSpace ? container : fallback };
}

function findScrollableAncestor(node) {
  let parent = node ? node.parentElement : null;
  let depth = 0;
  const isKimi = currentPlatform?.name === 'Kimi';
  while (parent && depth < 15) {
    const style = window.getComputedStyle(parent);
    const overflowY = style.overflowY || style.overflow || '';
    const hasOverflow = /(auto|scroll|overlay)/i.test(overflowY);
    const scrollRoom = parent.scrollHeight - parent.clientHeight > 50;
    if ((hasOverflow && scrollRoom) || (isKimi && scrollRoom)) {
      return parent;
    }
    parent = parent.parentElement;
    depth++;
  }
  return null;
}

function getKimiScrollContainer(target) {
  const fallback = document.scrollingElement || document.documentElement;

  if (kimiScrollContainer && isScrollableCandidate(kimiScrollContainer)) {
    return kimiScrollContainer;
  }

  const candidates = new Set();

  if (target && target.isConnected) {
    let ancestor = target;
    let depth = 0;
    while (ancestor && depth < 20) {
      candidates.add(ancestor);
      if (KIMI_SCROLL_SELECTOR_STRING) {
        const matched = ancestor.closest(KIMI_SCROLL_SELECTOR_STRING);
        if (matched) {
          candidates.add(matched);
        }
      }
      ancestor = ancestor.parentElement;
      depth++;
    }
  }

  if (KIMI_SCROLL_SELECTOR_STRING) {
    document.querySelectorAll(KIMI_SCROLL_SELECTOR_STRING).forEach((el) => candidates.add(el));
  }

  let best = null;
  let bestDelta = 0;
  for (const candidate of candidates) {
    if (!candidate || !candidate.isConnected) continue;
    const delta = candidate.scrollHeight - candidate.clientHeight;
    if (isScrollableCandidate(candidate) && delta >= bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }

  if (best) {
    kimiScrollContainer = best;
    return best;
  }

  kimiScrollContainer = fallback;
  return fallback;
}

function isScrollableCandidate(el, minDelta = 80) {
  if (!el || !el.isConnected) return false;
  const delta = el.scrollHeight - el.clientHeight;
  if (delta > minDelta) {
    return true;
  }
  const style = window.getComputedStyle(el);
  const overflowY = style.overflowY || style.overflow || '';
  return /auto|scroll|overlay/i.test(overflowY) && delta > 10;
}

function gentlyNudgeKimiContainer(container) {
  if (!container || container === document.documentElement || container === document.body) {
    return;
  }
  const original = container.scrollTop;
  container.scrollTop = original + 1;
  container.scrollTop = original;
}

function smoothScrollToTarget(target, container, attempt = 0) {
  const maxAttempts = 2;
  const containerHeight = container.clientHeight || window.innerHeight;
  const currentScrollTop = container === document.documentElement
    ? (window.pageYOffset || document.documentElement.scrollTop)
    : container.scrollTop;

  const desired = computeTargetScrollTop(target, container, containerHeight);
  const start = currentScrollTop;
  const delta = desired - start;
  const absDelta = Math.abs(delta);

  if (absDelta < 1) {
    return;
  }

  // Dynamic duration based on distance
  // Base 300ms + up to 500ms based on distance
  // Short scrolls are snappy (~350ms), long scrolls are smooth (~800ms)
  const baseDuration = 320;
  const dynamicPart = Math.min(absDelta * 0.4, 580);
  const duration = attempt === 0 ? (baseDuration + dynamicPart) : 300;

  const startTime = performance.now();

  // easeOutQuart - starts fast, slows down very gently
  const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);

  const step = (now) => {
    const elapsed = now - startTime;
    const progress = Math.min(1, elapsed / duration);
    const eased = easeOutQuart(progress);
    const next = start + delta * eased;

    if (container === document.documentElement) {
      window.scrollTo(0, next);
    } else {
      container.scrollTop = next;
    }

    if (progress < 1) {
      requestAnimationFrame(step);
    } else if (attempt < maxAttempts && !isTargetCentered(target)) {
      // Retry with a faster duration if we missed the target (e.g. due to layout shift)
      requestAnimationFrame(() => smoothScrollToTarget(target, container, attempt + 1));
    }
  };

  requestAnimationFrame(step);
}

function computeTargetScrollTop(target, container, containerHeight) {
  const currentScrollTop = container === document.documentElement
    ? (window.pageYOffset || document.documentElement.scrollTop)
    : container.scrollTop;

  const targetRect = target.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();

  let elementTopInContent;
  if (target.offsetParent && container.contains(target.offsetParent)) {
    let offsetTop = target.offsetTop;
    let parent = target.offsetParent;
    while (parent && parent !== container && parent !== document.body) {
      offsetTop += parent.offsetTop;
      parent = parent.offsetParent;
    }
    elementTopInContent = offsetTop;
  } else {
    elementTopInContent = targetRect.top - containerRect.top + currentScrollTop;
  }

  const desiredCenterOffset = Math.max(0, elementTopInContent - (containerHeight * 0.15));
  const maxScroll = Math.max(0, container.scrollHeight - containerHeight);
  return Math.max(0, Math.min(desiredCenterOffset, maxScroll));
}

function isTargetCentered(target) {
  const rect = target.getBoundingClientRect();
  const viewportCenter = window.innerHeight / 2;
  const distance = Math.abs((rect.top + Math.min(rect.height, 140) / 2) - viewportCenter);
  return distance < 90;
}

function animateMessageHighlight(target) {
  if (!target) return;

  const existing = highlightCleanupMap.get(target);
  if (existing) {
    clearTimeout(existing.fadeTimeout);
    clearTimeout(existing.resetTimeout);
    existing.restore();
    highlightCleanupMap.delete(target);
  }

  const root = document.getElementById('hopper-root');
  const accentBg = (root ? getComputedStyle(root).getPropertyValue('--hopper-accent-bg').trim() : '') || 'rgba(59, 130, 246, 0.28)';
  const accentShadow = (root ? getComputedStyle(root).getPropertyValue('--hopper-accent-shadow').trim() : '') || 'rgba(59, 130, 246, 0.4)';
  const accentOutline = (root ? getComputedStyle(root).getPropertyValue('--hopper-accent').trim() : '') || 'rgba(59, 130, 246, 0.85)';

  const original = {
    backgroundColor: target.style.backgroundColor,
    boxShadow: target.style.boxShadow,
    borderRadius: target.style.borderRadius,
    outline: target.style.outline,
    outlineOffset: target.style.outlineOffset,
    transition: target.style.transition,
    willChange: target.style.willChange
  };

  const applyHighlight = () => {
    target.style.willChange = 'background-color, box-shadow, border-radius, outline';
    target.style.transition = 'background-color 0.35s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.35s cubic-bezier(0.16, 1, 0.3, 1), outline 0.35s cubic-bezier(0.16, 1, 0.3, 1)';
    target.style.backgroundColor = accentBg;
    target.style.boxShadow = `0 0 28px ${accentShadow}`;
    target.style.borderRadius = original.borderRadius || '16px';
    target.style.outline = `2px solid ${accentOutline}`;
    target.style.outlineOffset = '3px';
  };

  const fadeOut = () => {
    if (!target || !target.isConnected) return;
    target.style.transition = 'background-color 0.8s cubic-bezier(0.33, 1, 0.68, 1), box-shadow 0.8s cubic-bezier(0.33, 1, 0.68, 1), outline 0.8s cubic-bezier(0.33, 1, 0.68, 1)';
    target.style.backgroundColor = original.backgroundColor || '';
    target.style.boxShadow = original.boxShadow || '';
    target.style.outline = original.outline || '';
    target.style.outlineOffset = original.outlineOffset || '';
  };

  const resetHighlight = () => {
    if (!target || !target.isConnected) return;
    target.style.backgroundColor = original.backgroundColor || '';
    target.style.boxShadow = original.boxShadow || '';
    target.style.borderRadius = original.borderRadius || '';
    target.style.outline = original.outline || '';
    target.style.outlineOffset = original.outlineOffset || '';
    target.style.transition = original.transition || '';
    target.style.willChange = original.willChange || '';
    highlightCleanupMap.delete(target);
  };

  applyHighlight();
  const fadeTimeout = setTimeout(fadeOut, 600);
  const resetTimeout = setTimeout(resetHighlight, 1700);

  highlightCleanupMap.set(target, {
    fadeTimeout,
    resetTimeout,
    restore: resetHighlight
  });
}

function triggerMessageRipple(target, event) {
  if (!target || !target.isConnected) return;

  const ripple = document.createElement('span');
  ripple.className = 'hopper-ripple';

  const rect = target.getBoundingClientRect();
  const size = Math.max(rect.width, rect.height);
  const clickX = (event?.clientX ?? rect.left + rect.width / 2) - rect.left;
  const clickY = (event?.clientY ?? rect.top + rect.height / 2) - rect.top;

  ripple.style.width = ripple.style.height = `${size}px`;
  ripple.style.left = `${clickX - size / 2}px`;
  ripple.style.top = `${clickY - size / 2}px`;

  const root = document.getElementById('hopper-root');
  const accentBg = (root ? getComputedStyle(root).getPropertyValue('--hopper-accent-bg').trim() : '') || 'rgba(59, 130, 246, 0.35)';
  ripple.style.setProperty('--hopper-ripple-color', accentBg);

  target.appendChild(ripple);
  ripple.addEventListener('animationend', () => {
    ripple.remove();
  }, { once: true });
}


/**
 * Updates the message count badges in the tab navigation.
 */
function updateTabCounts() {
  const allCount = messages.length;
  const userCount = messages.filter(m => m.role === 'user').length;
  const assistantCount = messages.filter(m => m.role === 'assistant').length;
  const favoritesCount = messages.filter(m => favorites.includes(m.id)).length;

  const allTab = document.querySelector('[data-count-type="all"]');
  const userTab = document.querySelector('[data-count-type="user"]');
  const assistantTab = document.querySelector('[data-count-type="assistant"]');
  const favoritesTab = document.querySelector('[data-count-type="favorites"]');

  if (allTab) allTab.textContent = allCount;
  if (userTab) userTab.textContent = userCount;
  if (assistantTab) assistantTab.textContent = assistantCount;
  if (favoritesTab) favoritesTab.textContent = favoritesCount;
}

/**
 * Re-renders the message list based on active filter and search query.
 * @param {string} filter Filter type ('all', 'user', 'assistant', 'favorites').
 * @param {string} searchQuery Search term for filtering messages.
 */
function updateUI(filter = 'all', searchQuery = '') {
  const badge = document.querySelector('.hopper-badge');
  const messagesContainer = document.getElementById('hopper-messages');

  badge.textContent = messages.length;

  updateTabCounts();

  let filtered = messages;

  // Apply filter
  if (filter === 'favorites') {
    filtered = messages.filter(m => favorites.includes(m.id));
  } else if (filter !== 'all') {
    filtered = messages.filter(m => m.role === filter);
  }

  // Apply search
  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    filtered = filtered.filter(m => {
      const content = (m.fullContent || m.content).toLowerCase();
      return content.includes(query);
    });
  }

  if (filtered.length === 0) {
    if (messages.length === 0) {
      messagesContainer.innerHTML = `
        <div class="hopper-empty">
          <p>No messages detected yet.</p>
          <p style="font-size: 12px; margin-top: 8px; color: #9ca3af;">
            Platform: ${currentPlatform?.name || 'Unknown'}
          </p>
        </div>
      `;
    } else {
      messagesContainer.innerHTML = '<div class="hopper-empty">No messages match your filter/search</div>';
    }
    return;
  }

  // Helper function to highlight search keyword
  const highlightKeyword = (text, keyword) => {
    if (!keyword || keyword.trim().length === 0) {
      return escapeHtml(text);
    }

    const searchTerm = keyword.trim();
    const regex = new RegExp(`(${escapeRegex(searchTerm)})`, 'gi');
    const escapedText = escapeHtml(text);

    return escapedText.replace(regex, '<mark class="hopper-highlight">$1</mark>');
  };

  // Escape HTML to prevent XSS
  const escapeHtml = (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  };

  // Escape special regex characters
  const escapeRegex = (string) => {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  };

  messagesContainer.innerHTML = filtered.map((msg, index) => {
    const content = searchQuery ? highlightKeyword(msg.content, searchQuery) : escapeHtml(msg.content);
    // Get original message index (for numbering)
    const originalIndex = messages.findIndex(m => m.id === msg.id);
    const messageNumber = originalIndex !== -1 ? originalIndex + 1 : index + 1;

    return `
    <div class="hopper-message" data-id="${msg.id}">
      <div class="hopper-message-header">
        <div class="hopper-badge-wrapper">
          <span class="hopper-badge-${msg.role}">${msg.role === 'user' ? 'You' : 'AI'}</span>
          <span class="hopper-message-number">${messageNumber}</span>
        </div>
         <div class="hopper-message-actions">
           <button class="hopper-btn-icon hopper-copy" 
                   data-id="${msg.id}"
                   title="Copy message">
             <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
               <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
               <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
             </svg>
           </button>
           <button class="hopper-btn-icon hopper-favorite ${favorites.includes(msg.id) ? 'active' : ''}" 
                   data-id="${msg.id}"
                   title="Favorite">
             ${favorites.includes(msg.id)
        ? '<svg width="16" height="16" fill="#fbbf24" stroke="#fbbf24" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
        : '<svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>'
      }
           </button>
         </div>
      </div>
      <div class="hopper-message-content">${content}</div>
    </div>
    `;
  }).join('');

  highlightSidebarMessage(activeSidebarMessageId, { force: true });

  // Event handlers are now handled via event delegation in injectSidebar()
  // No need to re-attach listeners here - they persist through innerHTML updates
}

// Copy message
function formatMessageAsMarkdown(msg) {
  if (!msg) return '';

  const roleLabel = msg.role === 'user' ? 'You' : (currentPlatform?.name || 'AI');
  const index = messages.findIndex(m => m.id === msg.id);
  const headingNumber = index !== -1 ? `${index + 1}. ` : '';
  const heading = `### ${headingNumber}${roleLabel}\n\n`;

  const rawContent = (msg.fullContent || msg.content || '').trim();
  if (!rawContent) return heading.trim();

  const normalized = rawContent
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(line => line.startsWith('- ') || line.startsWith('* ') ? line : line)
    .join('\n\n');

  return `${heading}${normalized}`;
}

function copyMessage(id) {
  const msg = messages.find(m => m.id === id);
  if (!msg) return;
  const contentToCopy = formatMessageAsMarkdown(msg);
  const copyBtn = document.querySelector(`.hopper-copy[data-id="${id}"]`);

  if (copyBtn) {
    copyBtn.style.transform = 'scale(0.9)';
    setTimeout(() => {
      copyBtn.style.transform = '';
    }, 100);
  }

  // Show toast
  if (copyBtn) {
    showCopyToast(copyBtn);
  }

  navigator.clipboard.writeText(contentToCopy).then(() => {
    // Toast already shown above
  }).catch(err => {
    const textArea = document.createElement('textarea');
    textArea.value = contentToCopy;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);

    // Toast already shown above
  });
}

// Show copy toast
function showCopyToast(button) {
  // Remove any existing toast
  const existingToast = document.querySelector('.hopper-copy-toast');
  if (existingToast) {
    existingToast.remove();
  }

  // Create toast element
  const toast = document.createElement('div');
  toast.className = 'hopper-copy-toast';
  toast.textContent = 'COPIED';

  // Get button position in viewport (fixed positioning)
  const buttonRect = button.getBoundingClientRect();

  // Get accent color from root for the toast
  const root = document.getElementById('hopper-root');
  if (!root) return;

  const accentColor = getComputedStyle(root).getPropertyValue('--hopper-accent').trim() || '#10b981';
  toast.style.background = accentColor;

  // Position toast centered above the button using fixed positioning
  toast.style.left = (buttonRect.left + buttonRect.width / 2) + 'px';
  toast.style.top = (buttonRect.top - 5) + 'px';

  // Add to body (fixed positioning works from body)
  document.body.appendChild(toast);

  // Force reflow to ensure initial state is applied
  toast.offsetHeight;

  // Trigger animation on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
  });

  // Remove after animation completes
  setTimeout(() => {
    if (toast.parentNode) {
      toast.remove();
    }
  }, 400);
}

// Toggle favorite
function toggleFavorite(id) {
  const favoriteBtn = document.querySelector(`.hopper-favorite[data-id="${id}"]`);

  if (favoriteBtn) {
    favoriteBtn.style.transform = 'scale(0.8) rotate(-10deg)';
    setTimeout(() => {
      favoriteBtn.style.transform = '';
    }, 150);
  }

  if (favorites.includes(id)) {
    favorites = favorites.filter(f => f !== id);
  } else {
    favorites.push(id);
  }

  chrome.runtime.sendMessage({
    type: 'SAVE_FAVORITES',
    favorites
  });

  updateTabCounts();
  updateUI(getCurrentFilter(), getCurrentSearch());
}

// Toggle theme
function toggleTheme() {
  currentTheme = currentTheme === 'dark' ? 'light' : 'dark';
  applyTheme(currentTheme);

  chrome.runtime.sendMessage({
    type: 'SAVE_THEME',
    theme: currentTheme
  });
}

// Apply theme
function applyTheme(theme) {
  const root = document.getElementById('hopper-root');
  if (!root) return;

  root.setAttribute('data-theme', theme);
}

// Set platform attribute for platform-specific styling
function setPlatformAttribute() {
  const root = document.getElementById('hopper-root');
  if (!root || !currentPlatform) return;

  // Get platform name in lowercase (chatgpt, claude, gemini)
  const platformName = currentPlatform.name.toLowerCase();
  root.setAttribute('data-platform', platformName);

  // Update platform tag in header
  const platformTag = document.getElementById('hopper-platform-tag');
  if (platformTag && currentPlatform) {
    platformTag.textContent = currentPlatform.name;
    platformTag.style.display = 'inline-block';
  } else if (platformTag) {
    platformTag.style.display = 'none';
  }
}

// Handle filter
function handleFilter(e) {
  const targetTab = e.target;
  if (!targetTab || !targetTab.dataset.filter) return;

  // Immediately update active state (visual feedback)
  document.querySelectorAll('.hopper-tab').forEach(t => t.classList.remove('hopper-tab-active'));
  targetTab.classList.add('hopper-tab-active');

  // Update UI immediately (no delays)
  const filter = targetTab.dataset.filter;
  updateUI(filter, getCurrentSearch());
}

// Handle search with debouncing
function handleSearch(e) {
  const query = e.target.value.trim();

  if (searchTimeout) {
    clearTimeout(searchTimeout);
    searchTimeout = null;
  }

  // Immediate update when clearing search
  if (query.length === 0) {
    if (lastSearchQuery !== '') {
      lastSearchQuery = '';
      updateUI(getCurrentFilter(), '');
    }
    return;
  }

  // Skip update if query hasn't changed
  if (query === lastSearchQuery) {
    return;
  }

  // Debounce for non-empty searches (200ms delay)
  searchTimeout = setTimeout(() => {
    const currentQuery = document.getElementById('hopper-search-input')?.value.trim() || '';
    if (currentQuery === query && currentQuery !== lastSearchQuery) {
      lastSearchQuery = query;
      updateUI(getCurrentFilter(), query);
    }
    searchTimeout = null;
  }, 200);
}

function setupScrollSpy() {
  // Feature disabled - no-op
  return;
}

function teardownScrollSpy() {
  if (scrollSpyObserver) {
    scrollSpyObserver.disconnect();
    scrollSpyObserver = null;
  }
  highlightSidebarMessage(null, { force: true });
  activeSidebarMessageId = null;
}

function highlightSidebarMessage(id, options = {}) {
  const { force = false } = options;
  if (!force && id === activeSidebarMessageId) return;

  if (activeSidebarElement) {
    activeSidebarElement.classList.remove('hopper-message-active');
  }

  activeSidebarMessageId = id || null;
  activeSidebarElement = null;

  if (!id) return;

  const element = document.querySelector(`.hopper-message[data-id="${id}"]`);
  if (element) {
    element.classList.add('hopper-message-active');
    activeSidebarElement = element;
  }
}

// Helpers
function getCurrentFilter() {
  return document.querySelector('.hopper-tab-active')?.dataset.filter || 'all';
}

function getCurrentSearch() {
  return document.getElementById('hopper-search-input')?.value || '';
}

// Start
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
