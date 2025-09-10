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
     * Handle carousel containers (Chrome-style approach)
     * @param {Element} container - The carousel container
     * @returns {boolean} - Whether sorting was performed
     */
    function handleCarouselContainer(container) {
        if (processedContainers.has(container)) {
            return false; // Already sorted
        }

        console.log('=== CAROUSEL CONTAINER DEBUG ===');
        console.log('Container:', container.className);
        
        const cards = Array.from(container.querySelectorAll(SELECTORS.carouselCard));
        console.log('Carousel cards found:', cards.length);
        
        if (cards.length < 2) {
            console.log('Not enough carousel cards to sort');
            return false;
        }

        // Extract and sort cards
        const cardsWithRatings = cards.map(card => {
            const innerCard = card.querySelector(SELECTORS.innerCard);
            if (!innerCard) return null;
            
            const ratingData = extractRatingData(innerCard);
            const titleElement = innerCard.querySelector(SELECTORS.title);
            const title = titleElement ? titleElement.textContent.trim() : 'No title';
            
            // Add rating to title
            addRatingToTitle(innerCard);
            
            return {
                element: card, // The wrapper element
                title: title,
                ...ratingData
            };
        }).filter(item => item && item.rating > 0);

        console.log('Carousel cards with ratings:', cardsWithRatings.map(c => `${c.title}: ${c.rating}`));
        
        if (cardsWithRatings.length < 2) {
            console.log('Not enough rated carousel cards to sort');
            return false;
        }

        // Sort by rating (highest first), then by votes
        cardsWithRatings.sort((a, b) => {
            if (a.rating !== b.rating) {
                return b.rating - a.rating;
            }
            return b.votes - a.votes;
        });

        console.log('After sort:', cardsWithRatings.map(c => `${c.title}: ${c.rating}`));

        // Move sorted cards
        const fragment = document.createDocumentFragment();
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
        
        // Reset scroll position
        setTimeout(() => {
            container.scrollLeft = 0;
            console.log('Carousel scrolled to beginning');
        }, 50);
        
        processedContainers.add(container);
        console.log(`Sorted ${cardsWithRatings.length} carousel cards`);
        console.log('=== END CAROUSEL DEBUG ===');
        return true;
    }

    /**
     * Handle browse containers (Chrome-style approach)  
     * @param {Element} container - The browse container
     * @returns {boolean} - Whether sorting was performed
     */
    function handleBrowseContainer(container) {
        if (processedContainers.has(container)) {
            return false; // Already sorted
        }

        console.log('=== BROWSE CONTAINER DEBUG ===');
        console.log('Container:', container.className);
        
        const cards = Array.from(container.querySelectorAll(SELECTORS.browseCard));
        console.log('Browse cards found:', cards.length);
        
        if (cards.length < 2) {
            console.log('Not enough browse cards to sort');
            return false;
        }

        // Extract and sort cards
        const cardsWithRatings = cards.map(card => {
            const innerCard = card.querySelector ? card.querySelector(SELECTORS.innerCard) : card;
            if (!innerCard) return null;
            
            const ratingData = extractRatingData(innerCard);
            const titleElement = innerCard.querySelector(SELECTORS.title);
            const title = titleElement ? titleElement.textContent.trim() : 'No title';
            
            // Add rating to title
            addRatingToTitle(innerCard);
            
            return {
                element: card,
                title: title,
                ...ratingData
            };
        }).filter(item => item && item.rating > 0);

        console.log('Browse cards with ratings:', cardsWithRatings.map(c => `${c.title}: ${c.rating}`));
        
        if (cardsWithRatings.length < 2) {
            console.log('Not enough rated browse cards to sort');
            return false;
        }

        // Sort by rating (highest first), then by votes
        cardsWithRatings.sort((a, b) => {
            if (a.rating !== b.rating) {
                return b.rating - a.rating;
            }
            return b.votes - a.votes;
        });

        console.log('After sort:', cardsWithRatings.map(c => `${c.title}: ${c.rating}`));

        // Move sorted cards
        const fragment = document.createDocumentFragment();
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
        
        processedContainers.add(container);
        console.log(`Sorted ${cardsWithRatings.length} browse cards`);
        console.log('=== END BROWSE DEBUG ===');
        return true;
    }

    /**
     * Handle generic/unknown containers with fallback card detection
     * @param {Element} container - The unknown container
     * @returns {boolean} - Whether sorting was performed
     */
    function handleGenericContainer(container) {
        if (processedContainers.has(container)) {
            return false;
        }

        console.log('=== GENERIC CONTAINER DEBUG ===');
        console.log('Container:', container.className);
        
        // Try multiple card selector strategies
        let cards = [];
        
        for (const selector of SELECTORS.cardFallbacks) {
            try {
                const foundCards = Array.from(container.querySelectorAll(selector));
                if (foundCards.length > 0) {
                    cards = foundCards;
                    console.log(`Found ${cards.length} cards using fallback selector: "${selector}"`);
                    break;
                }
            } catch (error) {
                console.log(`Fallback selector "${selector}" failed:`, error.message);
            }
        }
        
        if (cards.length < 2) {
            console.log('Not enough cards found for generic container');
            return false;
        }

        // Extract and sort cards
        const cardsWithRatings = cards.map(card => {
            // Try to find the inner card element if this is a wrapper
            const innerCard = card.querySelector(SELECTORS.innerCard) || card;
            const ratingData = extractRatingData(innerCard);
            const titleElement = innerCard.querySelector(SELECTORS.title);
            const title = titleElement ? titleElement.textContent.trim() : 'No title';
            
            // Add rating to title
            addRatingToTitle(innerCard);
            
            return {
                element: card,
                title: title,
                ...ratingData
            };
        }).filter(item => item && item.rating > 0);

        console.log('Generic cards with ratings:', cardsWithRatings.map(c => `${c.title}: ${c.rating}`));
        
        if (cardsWithRatings.length < 2) {
            console.log('Not enough rated cards for generic container');
            return false;
        }

        // Sort by rating (highest first), then by votes
        cardsWithRatings.sort((a, b) => {
            if (a.rating !== b.rating) {
                return b.rating - a.rating;
            }
            return b.votes - a.votes;
        });

        console.log('After sort:', cardsWithRatings.map(c => `${c.title}: ${c.rating}`));

        // Move sorted cards
        const fragment = document.createDocumentFragment();
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
        
        // Try to reset scroll if it's a carousel-like container
        if (container.className.includes('carousel') || container.className.includes('scroller')) {
            setTimeout(() => {
                container.scrollLeft = 0;
                console.log('Generic container scrolled to beginning');
            }, 50);
        }
        
        processedContainers.add(container);
        console.log(`Sorted ${cardsWithRatings.length} cards in generic container`);
        console.log('=== END GENERIC DEBUG ===');
        return true;
    }

    /**
     * Enhanced container sorting with smart detection and fallbacks
     */
    function sortAllContainers() {
        console.log(`=== ENHANCED CONTAINER DETECTION ===`);
        
        const detected = detectAllContainers();
        console.log(`Primary detection: ${detected.carousels.length} carousels, ${detected.browse.length} browse, ${detected.unknown.length} unknown`);
        
        let sortedCount = 0;
        
        // Sort detected carousel containers
        detected.carousels.forEach((container, index) => {
            if (!processedContainers.has(container)) {
                console.log(`Processing carousel ${index}: "${container.className}"`);
                if (handleCarouselContainer(container)) {
                    sortedCount++;
                }
            }
        });
        
        // Sort detected browse containers
        detected.browse.forEach((container, index) => {
            if (!processedContainers.has(container)) {
                console.log(`Processing browse ${index}: "${container.className}"`);
                if (handleBrowseContainer(container)) {
                    sortedCount++;
                }
            }
        });
        
        // Handle unknown containers with smart detection
        detected.unknown.forEach(({ container, cards }, index) => {
            if (!processedContainers.has(container)) {
                console.log(`Processing unknown container ${index}: "${container.className}" with ${cards} cards`);
                
                // Try to determine container type based on structure
                const hasCarouselStructure = container.querySelector('.carousel-scroller__card--4Lrk-');
                const hasBrowseStructure = container.querySelector('.browse-card');
                
                if (hasCarouselStructure) {
                    console.log(`Unknown container ${index} appears to be a carousel based on structure`);
                    if (handleCarouselContainer(container)) {
                        sortedCount++;
                    }
                } else if (hasBrowseStructure) {
                    console.log(`Unknown container ${index} appears to be a browse container based on structure`);
                    if (handleBrowseContainer(container)) {
                        sortedCount++;
                    }
                } else {
                    console.log(`Unknown container ${index} - attempting generic card sorting`);
                    if (handleGenericContainer(container)) {
                        sortedCount++;
                    }
                }
            }
        });
        
        console.log(`=== SORTING COMPLETE: ${sortedCount} containers processed ===`);
        
        if (sortedCount > 0) {
            console.log(`🎯 Crunchyroll Helper: Successfully sorted ${sortedCount} containers by rating!`);
        } else {
            console.log(`⚠️ Crunchyroll Helper: No containers were sorted - may need selector updates`);
        }
    }

    /**
     * Process all anime cards on the page
     */
    function processAllCards() {
        // Look for both carousel and browse cards (using inner cards for rating injection)
        const innerCards = document.querySelectorAll(SELECTORS.innerCard);
        
        if (innerCards.length === 0) {
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
            console.log(`Crunchyroll Helper: Found ${innerCards.length} cards to process`);
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