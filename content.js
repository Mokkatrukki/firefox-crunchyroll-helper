// Firefox Crunchyroll Rating Helper Content Script
// Displays anime ratings directly in titles and enables sorting by rating

(function() {
    'use strict';

    const processedCards = new WeakSet();
    let debounceTimeout = null;
    let observer = null;
    let retryCount = 0;
    const MAX_RETRIES = 5;
    let hasFoundCards = false;

    // Core selectors based on research
    const SELECTORS = {
        card: '.browse-card--esJdT',
        title: '.browse-card__title-link--SLlRM',
        rating: '.star-rating-short-static__rating--bdAfR',
        votes: '.star-rating-short-static__votes-count--h9Sun',
        carouselContainer: '.carousel-scroller__track--43f0L',
        browseContainer: '.erc-browse-cards-collection'
    };

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
            console.log('Crunchyroll Helper: No rating found for card:', titleElement.textContent.trim());
            return false;
        }
        
        // Only add rating if we found a valid rating and haven't already processed this title
        if (rating > 0 && !titleElement.textContent.includes(`(${rating})`)) {
            const originalTitle = titleElement.textContent.trim();
            titleElement.textContent = `${originalTitle} (${rating})`;
            processedCards.add(card);
            console.log(`Crunchyroll Helper: Added rating ${rating} to "${originalTitle}"`);
            return true;
        }
        
        return false;
    }

    /**
     * Process all anime cards on the page
     */
    function processAllCards() {
        const cards = document.querySelectorAll(SELECTORS.card);
        
        if (cards.length === 0) {
            if (!hasFoundCards && retryCount < MAX_RETRIES) {
                console.log(`Crunchyroll Helper: No cards found, retrying in 800ms (attempt ${retryCount + 1}/${MAX_RETRIES})`);
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
            console.log(`Crunchyroll Helper: Found ${cards.length} cards to process`);
        }
        
        let processedCount = 0;
        cards.forEach(card => {
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
            console.log(`Crunchyroll Helper: Processed ${processedCount} new cards`);
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
        }, 100); // 100ms debounce
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
                                node.matches(SELECTORS.card) ||
                                (node.querySelector && node.querySelector(SELECTORS.card))
                            );
                        }
                        return false;
                    });
                    
                    if (hasCards) {
                        shouldProcess = true;
                        console.log('Crunchyroll Helper: New cards detected via MutationObserver');
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
            console.log('Crunchyroll Helper: MutationObserver set up successfully');
        } else {
            // If body doesn't exist yet, wait for it
            setTimeout(setupObserver, 100);
        }
    }

    /**
     * Initialize the extension when DOM is ready
     */
    function initialize() {
        console.log(`Crunchyroll Helper: Initializing... DOM state: ${document.readyState}`);
        
        // Multiple initialization strategies for different loading states
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                console.log('Crunchyroll Helper: DOMContentLoaded fired');
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
            console.log('Crunchyroll Helper: Window load event fired');
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

        console.log('Crunchyroll Rating Helper: Initialized successfully');
    }

    // Start the extension
    initialize();
})();