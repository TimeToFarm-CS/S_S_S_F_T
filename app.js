const app = {
    chapters: [],
    filteredChapters: [],
    currentChapter: null, // This will be the chapter ID as a string
    currentChunkData: null, // Memory cache for the current chunk
    fontSize: 1.2, // Base font size in rem

    async init() {
        console.log("Initializing app...");

        await this.loadChapters();
        this.handleRouting();
        this.loadFontSize();

        window.addEventListener('popstate', () => this.handleRouting());

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.custom-dropdown')) {
                document.getElementById('dropdown-menu')?.classList.add('hidden');
            }
        });
    },

    async loadChapters() {
        try {
            // Using shadow-slave-Chapters.json as the master list
            const response = await fetch('shadow-slave-Chapters.json');
            if (!response.ok) throw new Error("Failed to load shadow-slave-Chapters.json");

            const rawData = await response.json();

            // Map the new data format (id, title) to the app's expectation (slug, title)
            this.chapters = rawData.map(ch => ({
                title: ch.title,
                slug: ch.id.toString()
            }));

            // Sort by ID ascending (น้อยไปมาก)
            this.chapters.sort((a, b) => parseInt(a.slug) - parseInt(b.slug));

            this.filteredChapters = [...this.chapters];
            this.renderChapterList();
            this.renderDropdown();
            document.getElementById('chapter-stats').textContent = `${this.chapters.length} Chapters available`;
        } catch (err) {
            console.error("Failed to load chapters index", err);
            document.getElementById('chapter-stats').textContent = "Error loading chapters index.";

            if (window.location.protocol === 'file:') {
                document.getElementById('chapter-list').innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center; padding: 2rem; background: rgba(251, 113, 133, 0.1); border-radius: 1rem; border: 1px dashed #fb7185;">
                        <h3 style="color: #fb7185">Local Security Restriction</h3>
                        <p>Browsers block data loading from your hard drive for security. Please host on a server or use VS Code "Live Server".</p>
                    </div>
                `;
            }
        }
    },

    renderChapterList() {
        const container = document.getElementById('chapter-list');
        if (this.filteredChapters.length === 0 && this.chapters.length > 0) {
            container.innerHTML = `<p style="grid-column: 1/-1; text-align: center; padding: 2rem;">No chapters match your search.</p>`;
            return;
        }
        container.innerHTML = this.filteredChapters.map((ch, index) => `
            <div class="chapter-card" onclick="app.openChapter('${ch.slug}')" style="animation-delay: ${Math.min(index * 0.02, 0.5)}s">
                <h3>${ch.title}</h3>
                <p class="stats">Chapter ${ch.slug}</p>
            </div>
        `).join('');
    },

    renderDropdown() {
        const container = document.getElementById('dropdown-items');
        const query = document.getElementById('dropdownSearch')?.value.toLowerCase() || "";

        const filtered = this.chapters.filter(ch =>
            ch.title.toLowerCase().includes(query) || ch.slug.toLowerCase().includes(query)
        );

        container.innerHTML = filtered.map(ch => `
            <div class="dropdown-item ${ch.slug === this.currentChapter ? 'active' : ''}" 
                 onclick="app.goToChapter('${ch.slug}')">
                ${ch.title}
            </div>
        `).join('');

        const current = this.chapters.find(c => c.slug === this.currentChapter);
        if (current) {
            document.getElementById('current-chapter-text').textContent = current.title;
        }
    },

    toggleDropdown() {
        const menu = document.getElementById('dropdown-menu');
        menu.classList.toggle('hidden');
        if (!menu.classList.contains('hidden')) {
            document.getElementById('dropdownSearch').focus();
        }
    },

    filterDropdown() {
        this.renderDropdown();
    },

    filterChapters() {
        const query = document.getElementById('chapterSearch').value.toLowerCase();
        this.filteredChapters = this.chapters.filter(ch =>
            ch.title.toLowerCase().includes(query) || ch.slug.toLowerCase().includes(query)
        );
        this.renderChapterList();
    },

    handleRouting() {
        const params = new URLSearchParams(window.location.search);
        const slug = params.get('chapter');
        if (slug) {
            this.showReader(slug);
        } else {
            this.showHome();
        }
    },

    getChunkFilename(chapterId) {
        const id = parseInt(chapterId);
        if (isNaN(id)) return null;

        // Supabase Pattern: chunks of 100, e.g., 1201_1300, 1301_1400
        // URL Example: https://zxjsrhdzatzfvwiobddo.supabase.co/storage/v1/object/public/Shadow%20Slave/chapters_1301_1400.json
        const start = Math.floor((id - 1) / 100) * 100 + 1;
        const end = start + 99;

        const baseUrl = "https://zxjsrhdzatzfvwiobddo.supabase.co/storage/v1/object/public/Shadow%20Slave/";
        return `${baseUrl}chapters_${start}_${end}.json`;
    },

    async showReader(slug) {
        document.getElementById('home-view').classList.add('hidden');
        document.getElementById('reader-view').classList.remove('hidden');
        document.getElementById('chapterSearch').parentElement.classList.add('hidden');
        window.scrollTo(0, 0);

        this.currentChapter = slug;
        document.getElementById('dropdown-menu')?.classList.add('hidden');
        this.renderDropdown();

        const titleElem = document.getElementById('chapter-title');
        const contentElem = document.getElementById('chapter-content');

        const copyBtn = document.getElementById('btn-copy');
        if (copyBtn) {
            copyBtn.textContent = 'Copy';
            copyBtn.classList.remove('copied');
        }

        // Cache check
        const cacheKey = `ss-cache-${slug}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            try {
                const data = JSON.parse(cached);
                titleElem.textContent = data.title;
                contentElem.innerHTML = data.content;
                document.title = `${data.title} - Shadow Slave Reader`;
                return;
            } catch (e) {
                localStorage.removeItem(cacheKey);
            }
        }

        contentElem.innerHTML = `
            <div class="loader">
                <div class="spinner"></div>
                <p>Loading chapter from Supabase...</p>
            </div>
        `;
        titleElem.textContent = "Loading Chapter...";

        // Load from local chunk
        try {
            const chunkFile = this.getChunkFilename(slug);
            if (!chunkFile) throw new Error("Chapter out of range or invalid");

            let chunkData = this.currentChunkData;

            // If the chunk isn't in memory or it's the wrong chunk, fetch it
            const currentChunkFileUrl = this.currentChunkData?.url;
            if (!chunkData || currentChunkFileUrl !== chunkFile) {
                const response = await fetch(chunkFile);
                if (!response.ok) throw new Error(`Failed to load ${chunkFile}`);
                chunkData = await response.json();
                chunkData.url = chunkFile; // Tag it so we know which one it is
                this.currentChunkData = chunkData;
            }

            const chapterIndex = chunkData.findIndex(c => c.id.toString() === slug);
            const chapter = chapterIndex !== -1 ? chunkData[chapterIndex] : null;

            if (chapter) {
                const formattedContent = chapter.content.split('\n').map(p => `<p>${p}</p>`).join('');
                titleElem.textContent = chapter.title;
                contentElem.innerHTML = formattedContent;
                document.title = `${chapter.title} - Shadow Slave Reader`;

                // Cash the current chapter
                this.safeSetItem(cacheKey, JSON.stringify({
                    title: chapter.title,
                    content: formattedContent,
                    timestamp: Date.now()
                }));

                // Look-ahead caching: Pre-cache the next 5 chapters from the same chunk
                for (let i = 1; i <= 5; i++) {
                    const nextChapter = chunkData[chapterIndex + i];
                    if (nextChapter) {
                        const nextSlug = nextChapter.id.toString();
                        const nextCacheKey = `ss-cache-${nextSlug}`;
                        // Only cache if not already present
                        if (!localStorage.getItem(nextCacheKey)) {
                            this.safeSetItem(nextCacheKey, JSON.stringify({
                                title: nextChapter.title,
                                content: nextChapter.content.split('\n').map(p => `<p>${p}</p>`).join(''),
                                timestamp: Date.now()
                            }));
                        }
                    }
                }
            } else {
                throw new Error("Chapter not found in chunk");
            }
        } catch (err) {
            console.error("Reader Error:", err);
            contentElem.innerHTML = `
                <div style="text-align: center; color: #fb7185;">
                    <h3>Chapter Not Available</h3>
                    <p>${err.message}</p>
                    <button class="btn primary" onclick="app.showHome()" style="margin-top: 1rem">Back to Home</button>
                </div>
            `;
        }
    },

    showHome() {
        document.getElementById('home-view').classList.remove('hidden');
        document.getElementById('reader-view').classList.add('hidden');
        document.getElementById('chapterSearch').parentElement.classList.remove('hidden');
        document.title = "Shadow Slave Reader";

        const url = new URL(window.location);
        url.searchParams.delete('chapter');
        window.history.pushState({}, '', url);
    },

    openChapter(slug) {
        const url = new URL(window.location);
        url.searchParams.set('chapter', slug);
        window.history.pushState({}, '', url);
        this.showReader(slug);
    },

    goToChapter(slug) {
        this.openChapter(slug);
    },

    prevChapter() {
        const currentIndex = this.chapters.findIndex(c => c.slug === this.currentChapter);
        if (currentIndex > 0) {
            this.openChapter(this.chapters[currentIndex - 1].slug);
        }
    },

    nextChapter() {
        const currentIndex = this.chapters.findIndex(c => c.slug === this.currentChapter);
        if (currentIndex < this.chapters.length - 1) {
            this.openChapter(this.chapters[currentIndex + 1].slug);
        }
    },

    copyContent() {
        const title = document.getElementById('chapter-title').innerText;
        const content = document.getElementById('chapter-content').innerText;
        const btn = document.getElementById('btn-copy');

        if (!content || content.length < 10) {
            alert("Nothing to copy yet!");
            return;
        }

        const textToCopy = `${title}\n\n${content}`;

        navigator.clipboard.writeText(textToCopy).then(() => {
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            btn.classList.add('copied');

            setTimeout(() => {
                btn.textContent = originalText;
                btn.classList.remove('copied');
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy: ', err);
            alert('Could not copy text. Please try selecting it manually.');
        });
    },

    changeFontSize(delta) {
        this.fontSize = Math.max(0.8, Math.min(2.5, this.fontSize + (delta * 0.1)));
        document.documentElement.style.setProperty('--reader-font-size', `${this.fontSize}rem`);
        localStorage.setItem('ss-font-size', this.fontSize);
    },

    loadFontSize() {
        const saved = localStorage.getItem('ss-font-size');
        if (saved) {
            this.fontSize = parseFloat(saved);
            document.documentElement.style.setProperty('--reader-font-size', `${this.fontSize}rem`);
        }
    },

    clearCache() {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('ss-cache-')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));
        alert('Cache cleared! (Settings preserved)');
        location.reload();
    },

    safeSetItem(key, value) {
        try {
            localStorage.setItem(key, value);
        } catch (e) {
            if (e.name === 'QuotaExceededError' || e.code === 22) {
                console.warn('LocalStorage quota exceeded. Purging old cache...');
                this.purgeOldCache();
                try {
                    localStorage.setItem(key, value);
                } catch (retryError) {
                    console.error('Still failed to set item after purge', retryError);
                }
            } else {
                console.error('Error saving to localStorage', e);
            }
        }
    },

    purgeOldCache() {
        const cachedItems = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('ss-cache-')) {
                try {
                    const data = JSON.parse(localStorage.getItem(key));
                    cachedItems.push({ key, timestamp: data.timestamp || 0 });
                } catch (e) {
                    cachedItems.push({ key, timestamp: 0 });
                }
            }
        }

        // Sort by timestamp (oldest first)
        cachedItems.sort((a, b) => a.timestamp - b.timestamp);

        // Remove the oldest 50% of cached chapters
        const toRemove = Math.ceil(cachedItems.length / 2);
        for (let i = 0; i < toRemove; i++) {
            localStorage.removeItem(cachedItems[i].key);
        }
    }
};

app.init();
