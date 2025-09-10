// Firefox Crunchyroll Rating Helper Content Script
// Displays anime ratings directly in titles and enables sorting by rating

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        DEBUG_MODE: false, // Set to false for production
        MAX_RETRIES: 5,
        DEBOUNCE_DELAY: 100,
        SORT_DELAY: 100,
        PERFORMANCE_MONITOR: true
    };

    // Enhanced logging system
    const Logger = {
        log: CONFIG.DEBUG_MODE ? console.log.bind(console, '🎯 CR Helper:') : () => {},
        debug: CONFIG.DEBUG_MODE ? console.log.bind(console, '🔍 CR Debug:') : () => {},
        info: console.info.bind(console, 'ℹ️ CR Info:'),
        warn: console.warn.bind(console, '⚠️ CR Warning:'),
        error: console.error.bind(console, '❌ CR Error:'),
        success: console.log.bind(console, '✅ CR Success:')
    };

    // Performance monitoring
    const Performance = {
        timers: new Map(),
        start: (label) => {
            if (CONFIG.PERFORMANCE_MONITOR) {
                Performance.timers.set(label, performance.now());
            }
        },
        end: (label) => {
            if (CONFIG.PERFORMANCE_MONITOR && Performance.timers.has(label)) {
                const duration = performance.now() - Performance.timers.get(label);
                Performance.timers.delete(label);
                if (duration > 10) { // Only log if > 10ms
                    Logger.debug(`${label} took ${duration.toFixed(2)}ms`);
                }
                return duration;
            }
        }
    };

    // State management
    const processedCards = new WeakSet();
    const processedContainers = new WeakSet();
    let debounceTimeout = null;
    let observer = null;
    let retryCount = 0;
    let hasFoundCards = false;

    // Enhanced selector system with fallbacks for maximum compatibility
    const SELECTORS = {
        // Card types (in order of preference)
        innerCard: '.browse-card--esJdT',
        carouselCard: '.carousel-scroller__card--4Lrk-',
        browseCard: '.browse-card',
        
        // Fallback card selectors (for future-proofing)
        cardFallbacks: [
            '.browse-card--esJdT',
            '.browse-card',
            '[class*="browse-card"]',
            '[class*="card"]:has([class*="rating"])'
        ],
        
        // Content selectors
        title: '.browse-card__title-link--SLlRM',
        rating: '.star-rating-short-static__rating--bdAfR',
        votes: '.star-rating-short-static__votes-count--h9Sun',
        
        // Container types
        carouselContainer: '.carousel-scroller__track--43f0L',
        browseContainer: '.erc-browse-cards-collection',
        
        // Fallback container selectors
        containerFallbacks: [
            '.carousel-scroller__track--43f0L',
            '.erc-browse-cards-collection',
            '[class*="carousel"][class*="track"]',
            '[class*="browse"][class*="collection"]',
            '[class*="scroller"]:has([class*="card"])'
        ]
    };

    /**
     * Smart container detection with fallback strategies
     * @returns {Object} - Detected containers with types
     */
    function detectAllContainers() {
        const detected = {
            carousels: [],
            browse: [],
            unknown: []
        };
        
        // Primary detection
        const carousels = document.querySelectorAll(SELECTORS.carouselContainer);
        const browse = document.querySelectorAll(SELECTORS.browseContainer);
        
        detected.carousels = Array.from(carousels);
        detected.browse = Array.from(browse);
        
        // If no containers found, try fallback detection
        if (detected.carousels.length === 0 && detected.browse.length === 0) {
            console.log('No containers found with primary selectors, trying fallbacks...');
            
            SELECTORS.containerFallbacks.forEach(selector => {
                try {
                    const containers = document.querySelectorAll(selector);
                    containers.forEach(container => {
                        const carouselCards = container.querySelectorAll(SELECTORS.carouselCard).length;
                        const browseCards = container.querySelectorAll(SELECTORS.browseCard).length;
                        const innerCards = container.querySelectorAll(SELECTORS.innerCard).length;
                        
                        if (carouselCards > 0) {
                            detected.carousels.push(container);
                            console.log(`Fallback: Found carousel container "${container.className}" with ${carouselCards} cards`);
                        } else if (browseCards > 0) {
                            detected.browse.push(container);
                            console.log(`Fallback: Found browse container "${container.className}" with ${browseCards} cards`);
                        } else if (innerCards > 0) {
                            detected.unknown.push({ container, cards: innerCards });
                            console.log(`Fallback: Found unknown container "${container.className}" with ${innerCards} inner cards`);
                        }
                    });
                } catch (error) {
                    console.log(`Fallback selector "${selector}" failed:`, error.message);
                }
            });
        }
        
        return detected;
    }

    /**
     * Extract rating data from a card element
     * @param {Element} card - The anime card element
     * @returns {Object} - Rating data with rating and votes
     */
    function extractRatingData(card) {
        const ratingElement = card.querySelector(SELECTORS.rating);
        const votesElement = card.querySelector(SELECTORS.votes);
        
        const rating = ratingElement ? parseFloat(ratingElement.textContent.trim()) : 0;
        const votesText = votesElement ? votesElement.textContent.trim() : '(0)';
        
        // Parse votes count (e.g., "(121.4k)" -> 121400)
        let votes = 0;
        const match = votesText.match(/\(([\d.]+)([kK])?\)/);
        if (match) {
            votes = parseFloat(match[1]);
            if (match[2] && match[2].toLowerCase() === 'k') {
                votes *= 1000;
            }
        }
        
        return { rating, votes, votesText };
    }

    /**
     * Add rating to anime title
     * @param {Element} card - The anime card element
     */
    function addRatingToTitle(card) {
        if (processedCards.has(card)) {
            return false; // Already processed
        }

        const titleElement = card.querySelector(SELECTORS.title);
        if (!titleElement) {
            console.log('Crunchyroll Helper: No title element found in card');
            return false;
        }

        const { rating } = extractRatingData(card);
        
        // Debug log for rating extraction (only log if we haven't found cards yet, to reduce spam)
        if (rating === 0 && !hasFoundCards) {
            Logger.debug('No rating found for card:', titleElement.textContent.trim());
            return false;
        }
        
        // Only add rating if we found a valid rating and haven't already processed this title
        if (rating > 0 && !titleElement.textContent.includes(`(${rating})`)) {
            const originalTitle = titleElement.textContent.trim();
            titleElement.textContent = `${originalTitle} (${rating})`;
            processedCards.add(card);
            Logger.log(`Added rating ${rating} to "${originalTitle}"`);
            return true;
        }
        
        return false;
    }

    /**
     * Compare two cards for sorting by rating (highest first), then by votes
     * @param {Element} cardA - First card to compare
     * @param {Element} cardB - Second card to compare
     * @returns {number} - Comparison result for Array.sort()
     */
    function compareCards(cardA, cardB) {
        const dataA = extractRatingData(cardA);
        const dataB = extractRatingData(cardB);
        
        // Primary sort: by rating (highest first)
        if (dataA.rating !== dataB.rating) {
            return dataB.rating - dataA.rating;
        }
        
        // Secondary sort: by votes (highest first) 
        return dataB.votes - dataA.votes;
    }

    /**
     * Unified container sorting function - handles all container types
     * @param {Element} container - The container element
     * @param {string} containerType - 'carousel', 'browse', or 'generic'
     * @returns {boolean} - Whether sorting was performed
     */
    function sortContainer(container, containerType = 'generic') {
        if (processedContainers.has(container)) {
            return false; // Already sorted
        }

        Performance.start(`sort-${containerType}`);
        Logger.debug(`Sorting ${containerType} container: "${container.className}"`);
        
        // Determine card selector based on container type
        let cardSelector, needsWrapper = false;
        switch (containerType) {
            case 'carousel':
                cardSelector = SELECTORS.carouselCard;
                needsWrapper = true; // Carousel cards need wrapper elements
                break;
            case 'browse':
                cardSelector = SELECTORS.browseCard;
                break;
            default: // generic
                // Try fallback selectors for generic containers
                cardSelector = SELECTORS.cardFallbacks.find(selector => {
                    try {
                        return container.querySelectorAll(selector).length > 0;
                    } catch (error) {
                        Logger.debug(`Fallback selector "${selector}" failed:`, error.message);
                        return false;
                    }
                });
                if (!cardSelector) {
                    Logger.debug('No valid card selector found for generic container');
                    return false;
                }
        }
        
        const cards = Array.from(container.querySelectorAll(cardSelector));
        Logger.debug(`Found ${cards.length} ${containerType} cards`);
        
        if (cards.length < 2) {
            Logger.debug(`Not enough cards to sort (${cards.length})`);
            return false;
        }

        // Extract rating data and sort cards
        const cardsWithRatings = cards.map(card => {
            try {
                // Find the inner card element for rating extraction
                const innerCard = needsWrapper ? 
                    card.querySelector(SELECTORS.innerCard) || card : 
                    card.querySelector(SELECTORS.innerCard) || card;
                
                if (!innerCard) return null;
                
                const ratingData = extractRatingData(innerCard);
                const titleElement = innerCard.querySelector(SELECTORS.title);
                const title = titleElement ? titleElement.textContent.trim() : 'Untitled';
                
                // Add rating to title
                addRatingToTitle(innerCard);
                
                return {
                    element: card, // The element to move (wrapper for carousels, card for others)
                    innerCard: innerCard,
                    title: title,
                    ...ratingData
                };
            } catch (error) {
                Logger.error('Error processing card:', error);
                return null;
            }
        }).filter(item => item && item.rating > 0);

        Logger.debug(`Cards with ratings: [${cardsWithRatings.map(c => `"${c.title}" (${c.rating})`).join(', ')}]`);
        
        if (cardsWithRatings.length < 2) {
            Logger.debug('Not enough rated cards to sort');
            return false;
        }

        // Sort by rating (highest first), then by votes
        cardsWithRatings.sort((a, b) => {
            if (a.rating !== b.rating) {
                return b.rating - a.rating; // Highest rating first
            }
            return b.votes - a.votes; // Most votes first as tiebreaker
        });

        Logger.debug(`Sorted order: [${cardsWithRatings.map(c => `"${c.title}" (${c.rating})`).join(', ')}]`);

        // Reorder DOM elements
        try {
            const fragment = document.createDocumentFragment();
            
            // Add sorted rated cards first
            cardsWithRatings.forEach(item => {
                fragment.appendChild(item.element);
            });
            
            // Add non-rated cards at the end
            cards.forEach(card => {
                const hasRating = cardsWithRatings.some(item => item.element === card);
                if (!hasRating && card.parentNode === container) {
                    fragment.appendChild(card);
                }
            });
            
            container.appendChild(fragment);
            
            // Handle carousel-specific behavior (scroll reset)
            if (containerType === 'carousel' || container.className.includes('carousel') || container.className.includes('scroller')) {
                setTimeout(() => {
                    container.scrollLeft = 0;
                    Logger.debug('Carousel scrolled to show highest rated content');
                }, 50);
            }
            
            processedContainers.add(container);
            const duration = Performance.end(`sort-${containerType}`);
            Logger.success(`Sorted ${cardsWithRatings.length} ${containerType} cards ${duration ? `in ${duration.toFixed(1)}ms` : ''}`);
            return true;
            
        } catch (error) {
            Logger.error('Error during DOM manipulation:', error);
            return false;
        }
    }

    /**
     * Enhanced container sorting with smart detection and fallbacks
     */
    function sortAllContainers() {
        Performance.start('sortAllContainers');
        Logger.log('Starting container detection and sorting');
        
        try {
            const detected = detectAllContainers();
            Logger.debug(`Container detection: ${detected.carousels.length} carousels, ${detected.browse.length} browse, ${detected.unknown.length} unknown`);
            
            let sortedCount = 0;
            const errors = [];
            
            // Sort carousel containers
            detected.carousels.forEach((container, index) => {
                try {
                    if (!processedContainers.has(container)) {
                        Logger.debug(`Processing carousel ${index + 1}/${detected.carousels.length}`);
                        if (sortContainer(container, 'carousel')) {
                            sortedCount++;
                        }
                    }
                } catch (error) {
                    errors.push(`Carousel ${index}: ${error.message}`);
                    Logger.error(`Error sorting carousel ${index}:`, error);
                }
            });
            
            // Sort browse containers
            detected.browse.forEach((container, index) => {
                try {
                    if (!processedContainers.has(container)) {
                        Logger.debug(`Processing browse ${index + 1}/${detected.browse.length}`);
                        if (sortContainer(container, 'browse')) {
                            sortedCount++;
                        }
                    }
                } catch (error) {
                    errors.push(`Browse ${index}: ${error.message}`);
                    Logger.error(`Error sorting browse container ${index}:`, error);
                }
            });
            
            // Handle unknown containers with smart type detection
            detected.unknown.forEach(({ container, cards }, index) => {
                try {
                    if (!processedContainers.has(container)) {
                        Logger.debug(`Processing unknown container ${index + 1}/${detected.unknown.length} (${cards} cards)`);
                        
                        // Determine container type based on structure
                        let containerType = 'generic';
                        if (container.querySelector(SELECTORS.carouselCard)) {
                            containerType = 'carousel';
                        } else if (container.querySelector(SELECTORS.browseCard)) {
                            containerType = 'browse';
                        }
                        
                        Logger.debug(`Unknown container ${index} detected as: ${containerType}`);
                        
                        if (sortContainer(container, containerType)) {
                            sortedCount++;
                        }
                    }
                } catch (error) {
                    errors.push(`Unknown ${index}: ${error.message}`);
                    Logger.error(`Error sorting unknown container ${index}:`, error);
                }
            });
            
            const duration = Performance.end('sortAllContainers');
            
            if (sortedCount > 0) {
                Logger.success(`Sorted ${sortedCount} containers by rating ${duration ? `in ${duration.toFixed(1)}ms` : ''}`);
            } else {
                Logger.warn('No containers were sorted - may need selector updates');
            }
            
            if (errors.length > 0) {
                Logger.warn(`${errors.length} errors occurred during sorting:`, errors);
            }
            
            return { sortedCount, errors };
            
        } catch (error) {
            Logger.error('Critical error in sortAllContainers:', error);
            Performance.end('sortAllContainers'); // Ensure timer cleanup
            return { sortedCount: 0, errors: [error.message] };
        }
    }

    /**
     * Process all anime cards on the page
     */
    function processAllCards() {
        // Look for both carousel and browse cards (using inner cards for rating injection)
        const innerCards = document.querySelectorAll(SELECTORS.innerCard);
        
        if (innerCards.length === 0) {
            if (!hasFoundCards && retryCount < CONFIG.MAX_RETRIES) {
                Logger.debug(`No cards found, retrying in 800ms (attempt ${retryCount + 1}/${CONFIG.MAX_RETRIES})`);
                retryCount++;
                setTimeout(processAllCards, 800);
                return;
            }
            // Stop retrying if we've found cards before or hit max retries
            return;
        }
        
        // We found cards!
        if (!hasFoundCards) {
            hasFoundCards = true;
            Logger.info(`Found ${innerCards.length} cards to process`);
        }
        
        let processedCount = 0;
        innerCards.forEach(card => {
            try {
                const wasProcessed = processedCards.has(card);
                addRatingToTitle(card);
                if (!wasProcessed && processedCards.has(card)) {
                    processedCount++;
                }
            } catch (error) {
                console.error('Crunchyroll Helper: Error processing card:', error);
            }
        });
        
        if (processedCount > 0) {
            Logger.success(`Processed ${processedCount} new cards with ratings`);
            
            // After processing ratings, sort containers by rating
            setTimeout(() => {
                sortAllContainers();
            }, CONFIG.SORT_DELAY); // Small delay to ensure DOM is stable
        }
        
        retryCount = 0; // Reset retry count on successful processing
    }

    /**
     * Debounced version of processAllCards to avoid excessive processing
     */
    function debouncedProcessCards() {
        if (debounceTimeout) {
            clearTimeout(debounceTimeout);
        }
        
        debounceTimeout = setTimeout(() => {
            processAllCards();
        }, CONFIG.DEBOUNCE_DELAY);
    }

    /**
     * Set up MutationObserver to handle dynamic content
     */
    function setupObserver() {
        if (observer) {
            observer.disconnect();
        }
        
        observer = new MutationObserver((mutations) => {
            let shouldProcess = false;
            
            mutations.forEach(mutation => {
                // Check if new nodes were added that might contain cards
                if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                    const addedNodes = Array.from(mutation.addedNodes);
                    const hasCards = addedNodes.some(node => {
                        if (node.nodeType === Node.ELEMENT_NODE) {
                            return node.matches && (
                                node.matches(SELECTORS.innerCard) ||
                                node.matches(SELECTORS.carouselCard) ||
                                node.matches(SELECTORS.browseCard) ||
                                (node.querySelector && (
                                    node.querySelector(SELECTORS.innerCard) ||
                                    node.querySelector(SELECTORS.carouselCard) ||
                                    node.querySelector(SELECTORS.browseCard)
                                )) ||
                                node.matches(SELECTORS.carouselContainer) ||
                                node.matches(SELECTORS.browseContainer)
                            );
                        }
                        return false;
                    });
                    
                    if (hasCards) {
                        shouldProcess = true;
                        Logger.debug('New cards detected via MutationObserver');
                    }
                }
            });
            
            if (shouldProcess) {
                debouncedProcessCards();
            }
        });

        // Start observing the document body
        if (document.body) {
            observer.observe(document.body, {
                childList: true,
                subtree: true,
                attributes: false
            });
            Logger.info('MutationObserver set up successfully');
        } else {
            // If body doesn't exist yet, wait for it
            setTimeout(setupObserver, 100);
        }
    }

    /**
     * Initialize the extension when DOM is ready
     */
    function initialize() {
        Performance.start('initialization');
        Logger.info(`Initializing extension... DOM state: ${document.readyState}`);
        
        try {
            // Multiple initialization strategies for different loading states
            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', () => {
                    Logger.debug('DOMContentLoaded event fired');
                    processAllCards();
                    setupObserver();
                });
            } else {
                // DOM is already ready
                processAllCards();
                setupObserver();
            }
            
            // Also try after window load in case content loads later
            window.addEventListener('load', () => {
                Logger.debug('Window load event fired');
                setTimeout(processAllCards, 1000); // Give it a second for any final content
            });
        
        // Periodic check for the first few seconds in case we miss dynamic content
        let periodicCheck = 0;
        const periodicInterval = setInterval(() => {
            periodicCheck++;
            // Only do periodic checks if we haven't found cards yet
            if (!hasFoundCards) {
                processAllCards();
            }
            if (periodicCheck >= 4 || hasFoundCards) { // Check for 2 seconds or until we find cards
                clearInterval(periodicInterval);
            }
        }, 500);

            const initDuration = Performance.end('initialization');
            Logger.success(`Extension initialized successfully ${initDuration ? `in ${initDuration.toFixed(1)}ms` : ''}`);
            
        } catch (error) {
            Logger.error('Failed to initialize extension:', error);
            Performance.end('initialization'); // Ensure timer cleanup
        }
    }

    // Start the extension
    initialize();
})();