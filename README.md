<div align="center">

<img src="icons/icon-512.png" alt="Hopper Logo" width="120" />

# Hopper

A Chrome extension that adds a navigation sidebar to AI chat platforms

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[Installation](#installation) • [Supported Platforms](#supported-platforms) • [Development](#development)

</div>

## About

Hopper adds a navigation sidebar to AI chat platforms. It lets you view all messages at a glance, search conversations, filter by role, and jump to any message instantly instead of scrolling through long threads.

## Features

- Navigate through all messages in your conversation
- Search across the entire conversation
- Filter messages by user or AI responses
- Bookmark and access your favorite messages
- Resizable sidebar
- Works across multiple AI platforms

## Supported Platforms

- ChatGPT
- Claude
- Gemini / AI Studio
- Kimi
- DeepSeek
- Grok
- Qwen

## Installation

### From Source

1. Clone this repository
2. Open Chrome and go to `chrome://extensions`
3. Enable Developer mode (toggle in top-right corner)
4. Click "Load unpacked" and select the extension folder
5. Visit any supported AI chat platform

The extension will automatically activate on supported sites.

## Usage

When you're on a supported AI chat platform, you'll see a floating "Hopper" button on the right side of the screen. Click it to open the sidebar.

The sidebar has four tabs:
- **All** - Shows all messages in the conversation
- **User** - Shows only your messages
- **AI** - Shows only AI responses
- **Favorites** - Shows your bookmarked messages

You can search for specific messages using the search bar, and click the star icon to bookmark messages you want to find later.

## Development

This extension uses vanilla JavaScript and CSS with no build process. To make changes:

1. Edit the files
2. Go to `chrome://extensions` and click the reload button for Hopper
3. Refresh the AI chat page

### Project Structure

```
├── manifest.json       # Extension configuration
├── background.js       # Background service worker
├── content.js          # Main extension logic and UI
├── sidebar.css         # All styles
├── platforms/          # Platform-specific code
│   ├── chatgpt.js
│   ├── claude.js
│   ├── gemini.js
│   └── ...
└── icons/              # Extension icons
```

### Adding a New Platform

To add support for a new AI platform:

1. Create a new file in `platforms/` (e.g., `platforms/newplatform.js`)
2. Implement the platform interface:

```javascript
window.HopperPlatform.newplatform = {
  name: 'NewPlatform',
  hostnames: ['newplatform.com'],
  
  isActive: function() {
    return this.hostnames.includes(window.location.hostname);
  },
  
  detectMessages: function() {
    // Return array of message objects
  },
  
  getContainer: function() {
    // Return the main chat container element
  }
};
```

3. Add the hostname to `manifest.json` under `host_permissions`
4. Add the script to `manifest.json` under `content_scripts.js`

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript
- CSS with custom properties for theming
- MutationObserver API for live updates
- chrome.storage.local for persistence

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Bug reports and pull requests are welcome on GitHub.

