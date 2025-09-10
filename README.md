# Firefox Crunchyroll Rating Helper

Transform your Crunchyroll browsing experience by displaying anime ratings directly in titles!

## Features

- **Phase 1**: Display ratings directly in anime titles (e.g., "My Wife Has No Emotion (4.6)")
- **Phase 2** (Coming Soon): Sort anime by highest ratings first

## Installation

### Temporary Installation (for testing)
1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" in the left sidebar
3. Click "Load Temporary Add-on..."
4. Navigate to this directory and select `manifest.json`
5. The extension will be loaded and active on Crunchyroll

### Permanent Installation
1. Package the extension as a `.zip` file with all files
2. Install via Firefox Add-ons or load as developer extension

## How It Works

The extension:
1. Detects anime cards on Crunchyroll pages
2. Extracts rating information from hover components
3. Injects ratings directly into anime titles
4. Uses MutationObserver to handle dynamic content loading

## Technical Details

- **Manifest Version**: 2 (Firefox compatible)
- **Permissions**: Only `*://*.crunchyroll.com/*`
- **Performance**: Debounced processing with WeakSet tracking
- **Compatibility**: Works on all Crunchyroll page types

## CSS Selectors Used

- Cards: `.browse-card--esJdT`
- Titles: `.browse-card__title-link--SLlRM` 
- Ratings: `.star-rating-short-static__rating--bdAfR`
- Vote Counts: `.star-rating-short-static__votes-count--h9Sun`

## Development

Based on research of Chrome extension patterns, adapted for Firefox Manifest v2 with performance optimizations and robust error handling.

## Troubleshooting

If ratings don't appear:
1. Check browser console for errors
2. Verify Crunchyroll hasn't changed their CSS classes
3. Try refreshing the page or reloading the extension