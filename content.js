// Firefox Crunchyroll Rating Helper Content Script
// Displays anime ratings directly in titles and enables sorting by rating

(function() {
    'use strict';

    const processedCards = new WeakSet();
    const processedContainers = new WeakSet();
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
     * Sort cards within a container by rating
     * @param {Element} container - The container element holding the cards
     * @returns {boolean} - Whether sorting was performed
     */
    function sortContainer(container) {
        if (processedContainers.has(container)) {
            return false; // Already sorted
        }

        console.log('=== CONTAINER DEBUG INFO ===');
        console.log('Container element:', container);
        console.log('Container classes:', container.className);
        console.log('Container parent:', container.parentElement?.className);

        const cards = Array.from(container.querySelectorAll(SELECTORS.card));
        console.log('Total cards found:', cards.length);
        
        if (cards.length < 2) {
            console.log('Not enough cards to sort');
            return false; // Nothing to sort
        }

        // Log the structure of first few cards
        cards.slice(0, 3).forEach((card, index) => {
            const titleElement = card.querySelector(SELECTORS.title);
            const title = titleElement ? titleElement.textContent.trim() : 'No title';
            const rating = extractRatingData(card).rating;
            console.log(`Card ${index}: ${title} (${rating})`);
            console.log('Card parent:', card.parentElement?.className);
            console.log('Card wrapper:', card.closest('[data-t="carousel-card-wrapper"]')?.className);
        });

        // Create array of cards with their ratings for sorting
        const cardsWithRatings = cards.map(card => {
            const titleElement = card.querySelector(SELECTORS.title);
            const title = titleElement ? titleElement.textContent.trim() : 'No title';
            const ratingData = extractRatingData(card);
            return {
                element: card,
                title: title,
                ...ratingData
            };
        }).filter(item => item.rating > 0); // Only sort cards that have ratings

        console.log('Cards with ratings before sort:', cardsWithRatings.map(c => `${c.title}: ${c.rating}`));

        if (cardsWithRatings.length < 2) {
            console.log('Not enough rated cards to sort');
            return false; // Not enough rated cards to sort
        }

        // Sort by rating (highest first), then by votes
        cardsWithRatings.sort((a, b) => {
            if (a.rating !== b.rating) {
                return b.rating - a.rating;
            }
            return b.votes - a.votes;
        });

        console.log('Cards with ratings after sort:', cardsWithRatings.map(c => `${c.title}: ${c.rating}`));

        // Check if we need to move wrapper elements instead of just cards
        const firstCardWrapper = cards[0].parentElement;
        const isWrapped = firstCardWrapper && firstCardWrapper.hasAttribute('data-t') && 
                         firstCardWrapper.getAttribute('data-t').includes('carousel-card-wrapper');
        
        console.log('Cards are wrapped:', isWrapped);
        console.log('Wrapper element:', firstCardWrapper?.className);

        if (isWrapped) {
            // We need to sort the wrapper elements, not the cards directly
            const wrappers = cardsWithRatings.map(item => item.element.parentElement);
            console.log('Moving wrappers instead of cards');
            
            const fragment = document.createDocumentFragment();
            wrappers.forEach(wrapper => {
                if (wrapper && wrapper.parentNode === container) {
                    fragment.appendChild(wrapper);
                }
            });
            
            // Add non-rated card wrappers at the end
            cards.forEach(card => {
                const wrapper = card.parentElement;
                const hasRating = cardsWithRatings.some(item => item.element === card);
                if (!hasRating && wrapper && wrapper.parentNode === container) {
                    fragment.appendChild(wrapper);
                }
            });
            
            container.appendChild(fragment);
        } else {
            // Original logic for unwrapped cards
            console.log('Moving cards directly');
            const fragment = document.createDocumentFragment();
            
            cardsWithRatings.forEach(item => {
                if (item.element.parentNode === container) {
                    fragment.appendChild(item.element);
                }
            });
            
            // Add any non-rated cards at the end
            cards.forEach(card => {
                const hasRating = cardsWithRatings.some(item => item.element === card);
                if (!hasRating && card.parentNode === container) {
                    fragment.appendChild(card);
                }
            });
            
            container.appendChild(fragment);
        }
        
        // Reset scroll position for carousels - more aggressive approach
        // Use setTimeout to ensure DOM manipulation is complete before scrolling
        setTimeout(() => {
            console.log(`Checking scroll positions for container...`);
            
            // Force scroll the main container to 0 regardless of current position
            const originalScroll = container.scrollLeft;
            container.scrollLeft = 0;
            console.log(`Force scrolled container from ${originalScroll} to 0`);
            
            // Check all parent containers up the tree
            let scrollParent = container.parentElement;
            let level = 0;
            while (scrollParent && scrollParent !== document.body && level < 5) {
                const parentScroll = scrollParent.scrollLeft;
                if (parentScroll !== 0) {
                    console.log(`Scrolling parent level ${level} (${scrollParent.className}) from ${parentScroll} to 0`);
                }
                scrollParent.scrollLeft = 0;
                scrollParent = scrollParent.parentElement;
                level++;
            }
            
            // Double-check with a second pass
            setTimeout(() => {
                if (container.scrollLeft !== 0) {
                    console.log(`Second pass: container still scrolled to ${container.scrollLeft}, forcing to 0`);
                    container.scrollLeft = 0;
                }
            }, 100);
        }, 50);
        
        processedContainers.add(container);
        console.log(`Crunchyroll Helper: Sorted ${cardsWithRatings.length} cards in container`);
        console.log('=== END CONTAINER DEBUG ===');
        return true;
    }

    /**
     * Find and sort all containers on the page
     */
    function sortAllContainers() {
        const carouselContainers = document.querySelectorAll(SELECTORS.carouselContainer);
        const browseContainers = document.querySelectorAll(SELECTORS.browseContainer);
        
        let sortedCount = 0;
        
        // Sort carousel containers
        carouselContainers.forEach(container => {
            if (sortContainer(container)) {
                sortedCount++;
            }
        });
        
        // Sort browse containers
        browseContainers.forEach(container => {
            if (sortContainer(container)) {
                sortedCount++;
            }
        });
        
        if (sortedCount > 0) {
            console.log(`Crunchyroll Helper: Sorted ${sortedCount} containers by rating`);
        }
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
            
            // After processing ratings, sort containers by rating
            setTimeout(() => {
                sortAllContainers();
            }, 100); // Small delay to ensure DOM is stable
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
                                (node.querySelector && node.querySelector(SELECTORS.card)) ||
                                node.matches(SELECTORS.carouselContainer) ||
                                node.matches(SELECTORS.browseContainer)
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