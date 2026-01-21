const app = {
    chapters: [],
    filteredChapters: [],
    currentChapter: null,
    fontSize: 1.2, // Base font size in rem
    // List of proxies for better reliability
    proxies: [
        { name: 'AllOrigins', url: 'https://api.allorigins.win/get?url=', type: 'json' },
        { name: 'CodeTabs', url: 'https://api.codetabs.com/v1/proxy?quest=', type: 'text' }
    ],
    currentProxyIndex: 0,
    baseUrl: 'https://stonescape.xyz/series/shadow-slave/',

    async init() {
        console.log("Initializing app...");

        // Detect local file protocol
        if (window.location.protocol === 'file:') {
            console.warn("Project is running via file:// protocol. CORS will block local JSON fetching.");
            this.showLocalWarning();
        }

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

    showLocalWarning() {
        const stats = document.getElementById('chapter-stats');
        stats.innerHTML = `<span style="color: #fb7185">⚠️ Running locally (CORS Blocked). Please host on GitHub Pages for full functionality.</span>`;
    },

    async loadChapters() {
        try {
            const response = await fetch('chapters.json');
            if (!response.ok) throw new Error("CORS or File Not Found");

            this.chapters = await response.json();
            this.chapters.reverse();
            this.filteredChapters = [...this.chapters];
            this.renderChapterList();
            this.renderDropdown();
            document.getElementById('chapter-stats').textContent = `${this.chapters.length} Chapters available`;
        } catch (err) {
            console.error("Failed to load chapters.json", err);
            // If local and failed, we can't do much without a server
            if (window.location.protocol === 'file:') {
                document.getElementById('chapter-list').innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center; padding: 2rem; background: rgba(251, 113, 133, 0.1); border-radius: 1rem; border: 1px dashed #fb7185;">
                        <h3 style="color: #fb7185">Local Security Restriction</h3>
                        <p>Browsers block data loading from your hard drive for security. To test this locally:</p>
                        <ol style="display: inline-block; text-align: left; margin-top: 1rem; color: var(--text-secondary);">
                            <li>Upload these files to <b>GitHub Pages</b> (Recommended)</li>
                            <li>OR Use a local server (e.g., VS Code "Live Server")</li>
                        </ol>
                    </div>
                `;
            } else {
                document.getElementById('chapter-stats').textContent = "Error loading chapters index.";
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
                <p class="stats">${ch.slug.replace('shadow-slave-', '')}</p>
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

        // Update trigger text
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

    async showReader(slug) {
        document.getElementById('home-view').classList.add('hidden');
        document.getElementById('reader-view').classList.remove('hidden');
        document.getElementById('chapterSearch').parentElement.classList.add('hidden');
        window.scrollTo(0, 0);

        this.currentChapter = slug;

        // Hide dropdown menu if open
        document.getElementById('dropdown-menu')?.classList.add('hidden');
        this.renderDropdown(); // Update active state and text

        const titleElem = document.getElementById('chapter-title');
        const contentElem = document.getElementById('chapter-content');

        // Reset copy button if it was in "Copied!" state
        const copyBtn = document.getElementById('btn-copy');
        if (copyBtn) {
            copyBtn.textContent = 'Copy Content';
            copyBtn.classList.remove('copied');
        }

        // --- 1. Check Cache first ---
        const cacheKey = `ss-cache-${slug}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
            try {
                const data = JSON.parse(cached);
                console.log(`Loading ${slug} from cache...`);
                titleElem.textContent = data.title;
                contentElem.innerHTML = data.content;
                document.title = `${data.title} - Shadow Slave Reader`;
                return; // มุดออกถ้ามีแคสแล้ว
            } catch (e) {
                console.warn("Cache parse error, re-fetching...");
                localStorage.removeItem(cacheKey);
            }
        }

        contentElem.innerHTML = `
            <div class="loader">
                <div class="spinner"></div>
                <p>Connecting to source... (via Proxy)</p>
            </div>
        `;

        titleElem.textContent = "Loading Chapter...";

        // Try proxies one by one
        let contentFound = false;
        for (let i = 0; i < this.proxies.length; i++) {
            const proxy = this.proxies[(this.currentProxyIndex + i) % this.proxies.length];
            console.log(`Trying proxy: ${proxy.name}`);

            try {
                const targetUrl = `${this.baseUrl}${slug}/`;
                const response = await fetch(`${proxy.url}${encodeURIComponent(targetUrl)}`);

                let htmlText = '';
                if (proxy.type === 'json') {
                    const data = await response.json();
                    htmlText = data.contents;
                } else {
                    htmlText = await response.text();
                }

                if (!htmlText || htmlText.length < 500) continue; // Likely a fail

                const parser = new DOMParser();
                const doc = parser.parseFromString(htmlText, 'text/html');

                const title = doc.querySelector('.breadcrumb li.active')?.textContent ||
                    doc.querySelector('h1')?.textContent || slug;

                let content = doc.querySelector('.reading-content .text-left')?.innerHTML ||
                    doc.querySelector('.reading-content')?.innerHTML;

                if (content && content.length > 100) {
                    titleElem.textContent = title;
                    contentElem.innerHTML = content;
                    document.title = `${title} - Shadow Slave Reader`;
                    contentFound = true;

                    // --- 2. Save to Cache ---
                    try {
                        localStorage.setItem(cacheKey, JSON.stringify({
                            title: title,
                            content: content,
                            timestamp: Date.now()
                        }));
                    } catch (e) {
                        console.warn("LocalStorage full, could not cache chapter");
                    }

                    this.currentProxyIndex = (this.currentProxyIndex + i) % this.proxies.length; // Save working proxy
                    break;
                }
            } catch (err) {
                console.warn(`Proxy ${proxy.name} failed:`, err);
            }
        }

        if (!contentFound) {
            contentElem.innerHTML = `
                <div style="text-align: center; color: #fb7185;">
                    <h3>All Scraping Proxies Failed</h3>
                    <p>The source site (StoneScape) might be blocking our current proxies or is temporarily down.</p>
                    <button class="btn primary" onclick="location.reload()" style="margin-top: 1rem">Try Again</button>
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
        const idx = this.chapters.findIndex(c => c.slug === this.currentChapter);
        if (idx > 0) {
            this.openChapter(this.chapters[idx - 1].slug);
        }
    },

    nextChapter() {
        const idx = this.chapters.findIndex(c => c.slug === this.currentChapter);
        if (idx < this.chapters.length - 1) {
            this.openChapter(this.chapters[idx + 1].slug);
        }
    },

    copyContent() {
        const content = document.getElementById('chapter-content').innerText;
        const btn = document.getElementById('btn-copy');

        if (!content || content.length < 10) {
            alert("Nothing to copy yet!");
            return;
        }

        navigator.clipboard.writeText(content).then(() => {
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
    }
};

app.init();
