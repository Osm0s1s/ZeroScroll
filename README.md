<div align="center">

<img src="icons/icon-512.png" alt="Hopper Logo" width="120" />

# Hopper

A Chrome extension that adds a navigation sidebar to AI chat platforms

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
![JavaScript](https://img.shields.io/badge/JavaScript-71%25-green?logo=javascript&logoColor=white)
![Version](https://img.shields.io/badge/Version-1.0.0-green)

[Installation](#installation) • [Supported Platforms](#supported-platforms) • [Development](#development)

</div>

## About

Hopper adds a navigation sidebar to AI chat platforms. It lets you view all messages at a glance, search conversations, filter by role, and jump to any message instantly instead of scrolling through long threads.

## Features

- **Instant Search & Filtering** — Quickly find any message and filter by user, AI, or favorites
- **Real-time Message Extraction** — Automatically captures and indexes conversations as you chat
- **Privacy-Focused** — All data, collections, and API keys stored securely on your local device
- **Manifest V3 Compliant** — Built with the latest Chrome Extension standards for security and performance
- **Multi-Platform Support** — Works seamlessly across ChatGPT, Claude, Gemini, and more
- **Resizable Sidebar** — Customize the interface to fit your workflow

## Supported Platforms

<div align="center">

![ChatGPT](https://img.shields.io/badge/ChatGPT-74aa9c?style=for-the-badge&logo=openai&logoColor=white)
![Claude](https://img.shields.io/badge/Claude-181818?style=for-the-badge&logo=anthropic&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-8E75B2?style=for-the-badge&logo=google&logoColor=white)
![Kimi](https://img.shields.io/badge/Kimi-FF6B6B?style=for-the-badge)
![DeepSeek](https://img.shields.io/badge/DeepSeek-1E90FF?style=for-the-badge)
![Grok](https://img.shields.io/badge/Grok-000000?style=for-the-badge&logo=x&logoColor=white)
![Qwen](https://img.shields.io/badge/Qwen-FF6A00?style=for-the-badge)

</div>

## Prerequisites

Modern Chromium-based browser (Chrome, Edge, or Opera)

## Installation

### Option 1: Download ZIP (Easiest)

1. **Download** — Go to [Releases](https://github.com/Osm0s1s/Hopper/releases) and download the latest `.zip` file

2. **Extract** — Unzip the file to a folder on your computer

3. **Open Extensions Page** — Navigate to your browser's extensions page:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Opera: `opera://extensions`

4. **Enable Developer Mode** — Toggle the switch in the top-right corner

5. **Load Extension** — Click "Load unpacked" and select the extracted folder

6. **Done!** — Visit any supported AI chat platform to see Hopper in action

---

### Option 2: Clone from GitHub

1. **Clone Repository**
   ```bash
   git clone https://github.com/Osm0s1s/Hopper.git
   ```

2. **Open Extensions Page** — Navigate to:
   - Chrome: `chrome://extensions`
   - Edge: `edge://extensions`
   - Opera: `opera://extensions`

3. **Enable Developer Mode** — Toggle the switch in the top-right corner

4. **Load Extension** — Click "Load unpacked" and select the cloned folder

5. **Done!** — Visit any supported AI chat platform to see Hopper in action

> **Note:** The extension automatically activates on all supported platforms.

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

| Technology | Purpose |
|------------|---------|
| Chrome Extension Manifest V3 | Modern extension framework for Chrome browser compatibility |
| Vanilla JavaScript | Core logic for message detection, UI rendering, and user interactions |
| CSS with Custom Properties | Dynamic theming and platform-specific styling |
| MutationObserver API | Real-time DOM monitoring to detect new messages as they appear |
| chrome.storage.local | Persistent storage for favorites, theme preferences, and sidebar state |

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Bug reports and pull requests are welcome on GitHub.

---

<div align="center">

**If you found Hopper useful, please ⭐ star this repository!**

It helps others discover the project.

</div>

