// ===== ERPL Website - Main JavaScript =====

// Load all data and initialize the site
document.addEventListener('DOMContentLoaded', async () => {
    await Promise.all([
        loadSiteData(),
        loadNavigation(),
        loadCountdowns(),
        loadProjects(),
        loadTestHistory(),
        loadLeadership(),
        loadSocialLinks(),
        loadSponsors(),
        loadAlumniOutcomes()
    ]);

    initProjectRouting();
    initMobileMenu();
    initSmoothScroll();
    initHeroSlideshow();
});

// ===== Data Loading Functions =====

async function loadJSON(path) {
    try {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`Failed to load ${path}`);
        return await response.json();
    } catch (error) {
        console.error(`Error loading ${path}:`, error);
        return null;
    }
}

async function loadSiteData() {
    const data = await loadJSON('data/site.json');
    if (!data) return;

    document.getElementById('heroTagline').textContent = data.tagline;
    document.getElementById('heroSubtitle').textContent = data.subtitle;
    document.getElementById('aboutDescription').textContent = data.description;
    document.getElementById('aboutMission').textContent = data.mission || '';
    document.getElementById('aboutPhilosophy').textContent = data.philosophy || '';
    document.getElementById('joinBtn').href = data.joinLink;
}

async function loadNavigation() {
    const navData = await loadJSON('data/nav.json');
    if (!navData) return;

    const navLinks = document.getElementById('navLinks');
    navLinks.innerHTML = navData.map(item => {
        const isExternal = !item.link.startsWith('#');
        const attrs = isExternal ? 'target="_blank" rel="noopener"' : '';
        const highlightClass = item.highlight ? 'nav-highlight' : '';
        return `<a href="${item.link}" ${attrs} class="${highlightClass}">${item.name}</a>`;
    }).join('');
}

async function loadCountdowns() {
    const countdowns = await loadJSON('data/countdowns.json');
    if (!countdowns) return;

    const container = document.getElementById('countdowns');
    container.innerHTML = countdowns.map(countdown => `
        <div class="countdown-item" data-date="${countdown.date}" data-id="${countdown.id}">
            <div class="countdown-title">${countdown.title}</div>
            <div class="countdown-timer">
                <div class="countdown-unit">
                    <div class="countdown-value" data-unit="days">00</div>
                    <div class="countdown-label">Days</div>
                </div>
                <div class="countdown-unit">
                    <div class="countdown-value" data-unit="hours">00</div>
                    <div class="countdown-label">Hours</div>
                </div>
                <div class="countdown-unit">
                    <div class="countdown-value" data-unit="minutes">00</div>
                    <div class="countdown-label">Minutes</div>
                </div>
                <div class="countdown-unit">
                    <div class="countdown-value" data-unit="seconds">00</div>
                    <div class="countdown-label">Seconds</div>
                </div>
            </div>
        </div>
    `).join('');

    // Start countdown updates
    updateCountdowns();
    setInterval(updateCountdowns, 1000);
}

function updateCountdowns() {
    document.querySelectorAll('.countdown-item').forEach(item => {
        const targetDate = new Date(item.dataset.date);
        const now = new Date();
        const diff = targetDate - now;

        if (diff <= 0) {
            item.querySelector('[data-unit="days"]').textContent = '00';
            item.querySelector('[data-unit="hours"]').textContent = '00';
            item.querySelector('[data-unit="minutes"]').textContent = '00';
            item.querySelector('[data-unit="seconds"]').textContent = '00';
            return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        item.querySelector('[data-unit="days"]').textContent = String(days).padStart(2, '0');
        item.querySelector('[data-unit="hours"]').textContent = String(hours).padStart(2, '0');
        item.querySelector('[data-unit="minutes"]').textContent = String(minutes).padStart(2, '0');
        item.querySelector('[data-unit="seconds"]').textContent = String(seconds).padStart(2, '0');
    });
}

// Store projects globally for modal access
let projectsData = [];

async function loadProjects() {
    projectsData = await loadJSON('data/projects.json');
    if (!projectsData) return;

    // Load flagship project (MOE)
    loadFlagshipProject();

    const grid = document.getElementById('projectsGrid');
    grid.innerHTML = projectsData.map(project => {
        // Support both single image and images array
        const images = project.images || [project.image];
        const hasCarousel = images.length > 1;

        return `
        <div class="project-card" id="project-${project.id}">
            <div class="project-image ${hasCarousel ? 'project-carousel' : ''}" data-images='${JSON.stringify(images)}'>
                ${images.map((img, i) => `
                    <img src="${img}" alt="${project.name}" 
                         class="carousel-img ${i === 0 ? 'active' : ''}"
                         onerror="this.style.display='none'">
                `).join('')}
            </div>
            <div class="project-content">
                <h3>${project.name}</h3>
                <p>${project.description}</p>
                <a href="#project/${project.id}" class="btn btn-secondary project-read-more" data-project-id="${project.id}">Read more</a>
            </div>
        </div>
    `}).join('');

    // Initialize carousels
    initProjectCarousels();
}

async function loadFlagshipProject() {
    const flagship = document.getElementById('projectFlagship');
    if (!flagship || !projectsData) return;

    // Find MOE project
    const moe = projectsData.find(p => p.id === 'moe');
    if (!moe) return;

    // Get site data for What's Next content
    const siteData = await loadJSON('data/site.json');
    const whatsNext = siteData?.whatsNext || '';

    const images = moe.images || [moe.image];
    
    flagship.innerHTML = `
        <div class="flagship-image flagship-carousel">
            ${images.map((img, i) => `
                <img src="${img}" alt="${moe.name}" class="carousel-img ${i === 0 ? 'active' : ''}">
            `).join('')}
        </div>
        <div class="flagship-content">
            <h3>${moe.name}</h3>
            <p class="flagship-tagline">Our Flagship Vehicle</p>
            <p>${moe.description}</p>
            <p class="flagship-next">${whatsNext}</p>
            <a href="#project/${moe.id}" class="btn btn-secondary project-read-more" data-project-id="${moe.id}">Learn More</a>
        </div>
    `;

    // Initialize flagship carousel after content is loaded
    initFlagshipCarousel();

}

async function loadTestHistory() {
    const events = await loadJSON('data/test-history.json');
    const grid = document.getElementById('testRecordGrid');
    if (!events || !grid) return;

    grid.innerHTML = events.map(event => `
        <article class="test-record-card">
            <a class="test-record-media project-deep-link" href="#project/${event.projectId}" data-project-id="${event.projectId}" aria-label="Open ${event.title}">
                <img src="${event.image}" alt="" loading="lazy">
            </a>
            <div class="test-record-content">
                <div class="test-record-meta">
                    <span>${event.date}</span>
                    <strong>${event.result}</strong>
                </div>
                <h3><a class="project-deep-link" href="#project/${event.projectId}" data-project-id="${event.projectId}">${event.title}</a></h3>
                <p>${event.summary}</p>
                <div class="test-record-actions">
                    <a class="project-deep-link" href="#project/${event.projectId}" data-project-id="${event.projectId}">View system</a>
                    <a href="${event.source}" target="_blank" rel="noopener">${event.sourceLabel}</a>
                </div>
            </div>
        </article>
    `).join('');
}

function initProjectCarousels() {
    // Initialize project card carousels
    const carousels = document.querySelectorAll('.project-carousel');

    carousels.forEach(carousel => {
        const images = carousel.querySelectorAll('.carousel-img');
        if (images.length <= 1) return;

        let currentIndex = 0;

        setInterval(() => {
            images[currentIndex].classList.remove('active');
            currentIndex = (currentIndex + 1) % images.length;
            images[currentIndex].classList.add('active');
        }, 5000); // 5 second rotation
    });
}

function initFlagshipCarousel() {
    const flagshipCarousel = document.querySelector('.flagship-carousel');
    if (flagshipCarousel) {
        const images = flagshipCarousel.querySelectorAll('.carousel-img');
        if (images.length > 1) {
            let currentIndex = 0;
            setInterval(() => {
                images[currentIndex].classList.remove('active');
                currentIndex = (currentIndex + 1) % images.length;
                images[currentIndex].classList.add('active');
            }, 4000); // 4 second rotation for flagship
        }
    }
}

let currentGalleryIndex = 0;
let currentGalleryImages = [];
let modalReturnHash = '#projects-full';
let modalTrigger = null;
let modalHistoryEntryCreated = false;

function getProjectIdFromHash() {
    const match = window.location.hash.match(/^#project\/([a-z0-9-]+)$/i);
    return match ? decodeURIComponent(match[1]) : null;
}

function openProjectModal(projectId, { updateHistory = false, trigger = null } = {}) {
    const project = projectsData.find(p => p.id === projectId);
    if (!project) return false;

    const modal = document.getElementById('projectModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalStatus = document.getElementById('modalStatus');
    const modalGallery = document.getElementById('modalGallery');
    const galleryDots = document.getElementById('galleryDots');
    const modalAbout = document.getElementById('modalAbout');
    const modalNewMembers = document.getElementById('modalNewMembers');
    const modalSpecs = document.getElementById('modalSpecs');
    const modalShareStatus = document.getElementById('modalShareStatus');

    if (updateHistory) {
        if (!getProjectIdFromHash()) {
            modalReturnHash = window.location.hash || '#projects-full';
        }
        const projectHash = `#project/${project.id}`;
        if (window.location.hash !== projectHash) {
            window.history.pushState({ projectId: project.id }, '', projectHash);
            modalHistoryEntryCreated = true;
        }
    }

    modalTrigger = trigger || modalTrigger;
    modal.dataset.projectId = project.id;
    modalShareStatus.textContent = '';

    // Populate modal
    modalTitle.textContent = project.name;

    // Handle both single image and images array
    currentGalleryImages = project.images || [project.image];
    currentGalleryIndex = 0;

    // Build gallery images
    modalGallery.innerHTML = currentGalleryImages.map((src, i) => `
        <img src="${src}" alt="${project.name}" class="gallery-image ${i === 0 ? 'active' : ''}">
    `).join('');

    // Build dots
    if (currentGalleryImages.length > 1) {
        galleryDots.innerHTML = currentGalleryImages.map((_, i) => `
            <span class="gallery-dot ${i === 0 ? 'active' : ''}" data-index="${i}"></span>
        `).join('');
        galleryDots.style.display = 'flex';

        // Show/hide nav buttons
        modal.querySelector('.gallery-prev').style.display = 'flex';
        modal.querySelector('.gallery-next').style.display = 'flex';
    } else {
        galleryDots.innerHTML = '';
        galleryDots.style.display = 'none';
        modal.querySelector('.gallery-prev').style.display = 'none';
        modal.querySelector('.gallery-next').style.display = 'none';
    }

    if (project.details) {
        modalAbout.textContent = project.details.about || project.description;
        modalStatus.textContent = project.details.status || '';
        modalStatus.style.display = project.details.status ? 'inline-block' : 'none';

        if (project.details.newMembers) {
            const newMembers = project.details.newMembers;
            modalNewMembers.innerHTML = `
                <p class="modal-new-members-kicker">Start here / first semester</p>
                <h4>Own real work early.</h4>
                <p>${newMembers.summary}</p>
                <ul>${newMembers.work.map(item => `<li>${item}</li>`).join('')}</ul>
            `;
            modalNewMembers.style.display = 'block';
        } else {
            modalNewMembers.innerHTML = '';
            modalNewMembers.style.display = 'none';
        }

        // Build specs if available
        if (project.details.specs) {
            const specs = project.details.specs;
            const specLabels = {
                thrust: 'Thrust',
                chamberPressure: 'Chamber Pressure',
                massFlowRate: 'Mass Flow Rate',
                mixtureRatio: 'Mixture Ratio',
                injectionType: 'Injection Type',
                oxidizerFlowRate: 'Oxidizer Flow Rate'
            };

            let specsHtml = '<h4>Engine Specifications</h4><ul>';
            for (const [key, value] of Object.entries(specs)) {
                const label = specLabels[key] || key;
                specsHtml += `<li><strong>${label}:</strong> ${value}</li>`;
            }
            specsHtml += '</ul>';
            modalSpecs.innerHTML = specsHtml;
            modalSpecs.style.display = 'block';
        } else {
            modalSpecs.style.display = 'none';
        }
    } else {
        modalAbout.textContent = project.description;
        modalStatus.style.display = 'none';
        modalNewMembers.style.display = 'none';
        modalSpecs.style.display = 'none';
    }

    // Show modal
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => modal.querySelector('.modal-close').focus());
    return true;
}

function navigateGallery(direction) {
    const images = document.querySelectorAll('#modalGallery .gallery-image');
    const dots = document.querySelectorAll('#galleryDots .gallery-dot');

    if (images.length <= 1) return;

    images[currentGalleryIndex].classList.remove('active');
    dots[currentGalleryIndex]?.classList.remove('active');

    currentGalleryIndex = (currentGalleryIndex + direction + images.length) % images.length;

    images[currentGalleryIndex].classList.add('active');
    dots[currentGalleryIndex]?.classList.add('active');
}

function goToGallerySlide(index) {
    const images = document.querySelectorAll('#modalGallery .gallery-image');
    const dots = document.querySelectorAll('#galleryDots .gallery-dot');

    images[currentGalleryIndex].classList.remove('active');
    dots[currentGalleryIndex]?.classList.remove('active');

    currentGalleryIndex = index;

    images[currentGalleryIndex].classList.add('active');
    dots[currentGalleryIndex]?.classList.add('active');
}

function hideProjectModal() {
    const modal = document.getElementById('projectModal');
    if (!modal.classList.contains('active')) return;
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    currentGalleryImages = [];
    currentGalleryIndex = 0;
    modalTrigger?.focus();
    modalTrigger = null;
}

function closeProjectModal({ updateHistory = true } = {}) {
    if (updateHistory && getProjectIdFromHash()) {
        if (modalHistoryEntryCreated) {
            modalHistoryEntryCreated = false;
            window.history.back();
            return;
        }
        window.history.replaceState(null, '', modalReturnHash);
        hideProjectModal();
        const returnTarget = document.getElementById(modalReturnHash.replace(/^#/, ''));
        returnTarget?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        return;
    }
    hideProjectModal();
}

function syncProjectRoute() {
    const projectId = getProjectIdFromHash();
    if (projectId) {
        openProjectModal(projectId);
    } else {
        modalHistoryEntryCreated = false;
        hideProjectModal();
    }
}

function initProjectRouting() {
    document.addEventListener('click', (event) => {
        const projectLink = event.target.closest('[data-project-id][href^="#project/"]');
        if (!projectLink) return;
        event.preventDefault();
        openProjectModal(projectLink.dataset.projectId, {
            updateHistory: true,
            trigger: projectLink
        });
    });

    window.addEventListener('popstate', syncProjectRoute);
    syncProjectRoute();
}

async function copyCurrentProjectLink() {
    const projectId = document.getElementById('projectModal').dataset.projectId;
    if (!projectId) return;

    const url = `${window.location.origin}${window.location.pathname}#project/${projectId}`;
    const status = document.getElementById('modalShareStatus');

    try {
        await navigator.clipboard.writeText(url);
    } catch (error) {
        const textArea = document.createElement('textarea');
        textArea.value = url;
        textArea.setAttribute('readonly', '');
        textArea.style.position = 'fixed';
        textArea.style.opacity = '0';
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        textArea.remove();
    }

    status.textContent = 'Copied';
}

// Initialize modal event listeners
document.addEventListener('DOMContentLoaded', () => {
    const modal = document.getElementById('projectModal');
    if (modal) {
        // Close on backdrop click
        modal.querySelector('.modal-backdrop').addEventListener('click', () => closeProjectModal());
        // Close on X button click
        modal.querySelector('.modal-close').addEventListener('click', () => closeProjectModal());
        modal.querySelector('#modalShare').addEventListener('click', copyCurrentProjectLink);

        // Gallery navigation
        modal.querySelector('.gallery-prev').addEventListener('click', () => navigateGallery(-1));
        modal.querySelector('.gallery-next').addEventListener('click', () => navigateGallery(1));

        // Dot navigation
        modal.querySelector('#galleryDots').addEventListener('click', (e) => {
            if (e.target.classList.contains('gallery-dot')) {
                goToGallerySlide(parseInt(e.target.dataset.index));
            }
        });

        // Keyboard navigation
        document.addEventListener('keydown', (e) => {
            if (!modal.classList.contains('active')) return;
            if (e.key === 'Escape') closeProjectModal();
            if (e.key === 'ArrowLeft') navigateGallery(-1);
            if (e.key === 'ArrowRight') navigateGallery(1);

            if (e.key === 'Tab') {
                const focusable = [...modal.querySelectorAll('button, a[href], [tabindex]:not([tabindex="-1"])')]
                    .filter(element => !element.disabled && element.offsetParent !== null);
                if (!focusable.length) return;
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (e.shiftKey && document.activeElement === first) {
                    e.preventDefault();
                    last.focus();
                } else if (!e.shiftKey && document.activeElement === last) {
                    e.preventDefault();
                    first.focus();
                }
            }
        });
    }
});

async function loadLeadership() {
    const leaders = await loadJSON('data/leadership.json');
    if (!leaders) return;

    const grid = document.getElementById('leadershipGrid');
    grid.innerHTML = leaders.map(leader => `
        <div class="leader-card">
            <div class="leader-photo">
                <img src="${leader.photo}" alt="${leader.name}"
                     onerror="this.style.display='none'; this.parentElement.innerHTML='<span style=\\'display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:2rem;\\'>${leader.name.split(' ').map(n => n[0]).join('')}</span>'">
            </div>
            <h3>${leader.name}</h3>
            <p class="role">${leader.role}</p>
        </div>
    `).join('');
}

async function loadSocialLinks() {
    const social = await loadJSON('data/social.json');
    if (!social) return;

    const container = document.getElementById('socialLinks');

    const socialIcons = {
        twitter: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
        instagram: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/></svg>',
        youtube: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
        email: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>'
    };

    const links = [];

    if (social.twitter) {
        links.push(`<a href="${social.twitter}" class="social-link" target="_blank" rel="noopener">${socialIcons.twitter} Twitter</a>`);
    }
    if (social.instagram) {
        links.push(`<a href="${social.instagram}" class="social-link" target="_blank" rel="noopener">${socialIcons.instagram} Instagram</a>`);
    }
    if (social.youtube) {
        links.push(`<a href="${social.youtube}" class="social-link" target="_blank" rel="noopener">${socialIcons.youtube} YouTube</a>`);
    }
    if (social.email) {
        links.push(`<a href="mailto:${social.email}" class="social-link">${socialIcons.email} ${social.email}</a>`);
    }

    container.innerHTML = links.join('');
}

async function loadSponsors() {
    const sponsors = await loadJSON('data/sponsors.json');
    if (!sponsors) return;

    const container = document.getElementById('sponsorsContainer');
    if (!container) return;

    // Group sponsors by tier
    const tiers = {
        platinum: sponsors.filter(s => s.tier === 'platinum'),
        gold: sponsors.filter(s => s.tier === 'gold'),
        silver: sponsors.filter(s => s.tier === 'silver'),
        bronze: sponsors.filter(s => s.tier === 'bronze')
    };

    let html = '';

    // Render each tier
    for (const [tierName, tierSponsors] of Object.entries(tiers)) {
        if (tierSponsors.length === 0) continue;

        html += `<div class="sponsors-tier sponsors-tier-${tierName}">`;
        html += `<div class="sponsors-grid sponsors-grid-${tierName}">`;

        tierSponsors.forEach(sponsor => {
            const url = sponsor.url && sponsor.url !== '#' ? sponsor.url : null;
            const linkOpen = url ? `<a href="${url}" target="_blank" rel="noopener" class="sponsor-link">` : '<div class="sponsor-link">';
            const linkClose = url ? '</a>' : '</div>';

            const wrapperClass = sponsor.theme === 'dark'
                ? 'sponsor-logo-wrapper dark-bg'
                : 'sponsor-logo-wrapper';
            const logoClass = sponsor.logoTreatment === 'black'
                ? 'sponsor-logo sponsor-logo-black'
                : 'sponsor-logo';

            html += `
                ${linkOpen}
                    <div class="${wrapperClass}">
                        <img src="${sponsor.logo}" alt="${sponsor.name}" class="${logoClass}"
                             onerror="this.style.display='none'; this.parentElement.innerHTML='<span class=\\'sponsor-name\\'>${sponsor.name}</span>'">
                    </div>
                ${linkClose}
            `;
        });

        html += '</div></div>';
    }

    container.innerHTML = html;
}

async function loadAlumniOutcomes() {
    const data = await loadJSON('data/alumni.json');
    if (!data) return;

    // Set header text
    const headlineEl = document.getElementById('outcomesHeadline');
    const subtitleEl = document.getElementById('outcomesSubtitle');
    const descriptionEl = document.getElementById('outcomesDescription');
    
    if (headlineEl) headlineEl.textContent = data.headline;
    if (subtitleEl) subtitleEl.textContent = data.subtitle;
    if (descriptionEl) descriptionEl.textContent = data.description;

    // Render company logos carousel
    const companiesContainer = document.getElementById('outcomesCompanies');
    if (companiesContainer && data.companies) {
        // Create logo items HTML
        const logosHtml = data.companies.map(company => {
            const mark = company.textLogo
                ? `<span class="company-name-mark" aria-label="${company.name}">${company.textLogo}</span>`
                : `<img src="${company.logo}" alt="${company.name}"
                         onerror="this.style.display='none'; this.parentElement.innerHTML='<span class=\\'company-name-mark\\'>${company.name}</span>'">`;

            return `
                <div class="company-logo-item">
                    <div class="company-logo-wrapper">
                        ${mark}
                    </div>
                </div>
            `;
        }).join('');
        
        // Duplicate logos for seamless infinite scroll
        companiesContainer.innerHTML = `
            <div class="companies-track">
                ${logosHtml}
                ${logosHtml}
            </div>
        `;
    }

    // Render values
    const valuesContainer = document.getElementById('outcomesValues');
    if (valuesContainer && data.values) {
        valuesContainer.innerHTML = data.values.map(value => `
            <div class="value-card">
                <h4>${value.title}</h4>
                <p>${value.description}</p>
            </div>
        `).join('');
    }

    // Render testimonials
    const testimonialsContainer = document.getElementById('outcomesTestimonials');
    if (testimonialsContainer && data.testimonials) {
        testimonialsContainer.innerHTML = data.testimonials.map(testimonial => `
            <div class="testimonial-card">
                <p class="testimonial-quote">${testimonial.quote}</p>
                <div class="testimonial-author">
                    <span class="name">${testimonial.author}</span>
                    <span class="role">${testimonial.role}</span>
                </div>
            </div>
        `).join('');
    }

    // Set CTA content
    if (data.callToAction) {
        const ctaTitleEl = document.getElementById('outcomesCtaTitle');
        const ctaTextEl = document.getElementById('outcomesCtaText');
        const ctaBtnEl = document.getElementById('outcomesCtaBtn');
        
        if (ctaTitleEl) ctaTitleEl.textContent = data.callToAction.title;
        if (ctaTextEl) ctaTextEl.textContent = data.callToAction.text;
        if (ctaBtnEl) {
            ctaBtnEl.textContent = data.callToAction.buttonText;
            ctaBtnEl.href = data.callToAction.buttonLink;
        }
    }
}

// ===== UI Interactions =====

function initMobileMenu() {
    const menuToggle = document.getElementById('menuToggle');
    const navLinks = document.getElementById('navLinks');

    if (!menuToggle) return;

    menuToggle.addEventListener('click', () => {
        menuToggle.classList.toggle('active');
        navLinks.classList.toggle('mobile-active');
        document.body.classList.toggle('menu-open');
        menuToggle.setAttribute('aria-expanded', String(menuToggle.classList.contains('active')));
    });

    navLinks.addEventListener('click', (event) => {
        if (!event.target.closest('a')) return;
        menuToggle.classList.remove('active');
        navLinks.classList.remove('mobile-active');
        document.body.classList.remove('menu-open');
        menuToggle.setAttribute('aria-expanded', 'false');
    });
}

function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            const href = this.getAttribute('href');
            if (!href || href === '#' || href.startsWith('#project/')) return;

            const target = document.getElementById(href.slice(1));
            if (!target) return;

            e.preventDefault();
            const headerHeight = document.getElementById('header').offsetHeight;
            const targetPosition = target.offsetTop - headerHeight;
            window.scrollTo({
                top: targetPosition,
                behavior: 'smooth'
            });

            if (window.location.hash !== href) {
                window.history.pushState(null, '', href);
            }
        });
    });
}

// ===== Hero Slideshow =====

async function initHeroSlideshow() {
    const heroConfig = await loadJSON('data/hero.json');
    if (!heroConfig) return;

    const slidesContainer = document.getElementById('heroSlides');

    if (!slidesContainer) return;

    // Build slides from config
    const slidesData = heroConfig.slides || [];
    const imageDuration = heroConfig.imageDuration || 6000; // 6 seconds for images

    slidesData.forEach((slide, index) => {
        const slideDiv = document.createElement('div');
        slideDiv.className = 'hero-slide' + (index === 0 ? ' active' : '');
        slideDiv.dataset.type = slide.type;

        if (slide.type === 'video') {
            const video = document.createElement('video');
            video.className = 'hero-media';
            video.muted = true;
            video.playsInline = true;
            if (index === 0) video.autoplay = true;

            // Store timing data if present (for trimmed videos)
            if (slide.startTime !== undefined) {
                video.dataset.start = slide.startTime;
            }
            if (slide.endTime !== undefined) {
                video.dataset.end = slide.endTime;
            }

            const source = document.createElement('source');
            source.src = slide.src;
            source.type = 'video/mp4';
            video.appendChild(source);
            slideDiv.appendChild(video);
        } else {
            // Image slide
            const imgDiv = document.createElement('div');
            imgDiv.className = 'hero-media hero-image';
            imgDiv.style.backgroundImage = `url('${slide.src}')`;
            slideDiv.appendChild(imgDiv);
        }

        slidesContainer.appendChild(slideDiv);
    });

    // Get all slides
    const slides = slidesContainer.querySelectorAll('.hero-slide');
    if (slides.length === 0) return;

    let currentSlide = 0;
    let imageTimer = null;

    function goToNextSlide() {
        // Clear any pending timer
        if (imageTimer) {
            clearTimeout(imageTimer);
            imageTimer = null;
        }

        // Remove active class and pause current video
        slides[currentSlide].classList.remove('active');
        const currentVideo = slides[currentSlide].querySelector('video');
        if (currentVideo) {
            currentVideo.pause();
            currentVideo.removeEventListener('ended', goToNextSlide);
        }

        // Move to next slide
        currentSlide = (currentSlide + 1) % slides.length;
        slides[currentSlide].classList.add('active');

        // Handle the new slide
        const slideType = slides[currentSlide].dataset.type;
        const newVideo = slides[currentSlide].querySelector('video');

        if (slideType === 'video' && newVideo) {
            // Reset to start position if defined
            const startTime = parseFloat(newVideo.dataset.start) || 0;
            newVideo.currentTime = startTime;

            // If end time is defined, use timeupdate to transition
            const endTime = newVideo.dataset.end ? parseFloat(newVideo.dataset.end) : null;
            if (endTime !== null) {
                const onTimeUpdate = () => {
                    if (newVideo.currentTime >= endTime) {
                        newVideo.removeEventListener('timeupdate', onTimeUpdate);
                        goToNextSlide();
                    }
                };
                newVideo.addEventListener('timeupdate', onTimeUpdate);
            } else {
                // No end time, use ended event for full video
                newVideo.addEventListener('ended', goToNextSlide, { once: true });
            }
            newVideo.play();
        } else {
            // Image slide - use timer
            imageTimer = setTimeout(goToNextSlide, imageDuration);
        }
    }

    // Start the first slide
    const firstSlide = slides[0];
    const firstVideo = firstSlide.querySelector('video');

    if (firstSlide.dataset.type === 'video' && firstVideo) {
        const startTime = parseFloat(firstVideo.dataset.start) || 0;
        firstVideo.currentTime = startTime;

        const endTime = firstVideo.dataset.end ? parseFloat(firstVideo.dataset.end) : null;
        if (endTime !== null) {
            const onTimeUpdate = () => {
                if (firstVideo.currentTime >= endTime) {
                    firstVideo.removeEventListener('timeupdate', onTimeUpdate);
                    goToNextSlide();
                }
            };
            firstVideo.addEventListener('timeupdate', onTimeUpdate);
        } else {
            firstVideo.addEventListener('ended', goToNextSlide, { once: true });
        }
    } else {
        // First slide is image
        imageTimer = setTimeout(goToNextSlide, imageDuration);
    }
}

// ===== Header scroll effect =====
let lastScroll = 0;
window.addEventListener('scroll', () => {
    const header = document.getElementById('header');
    const currentScroll = window.pageYOffset;

    if (currentScroll > 100) {
        header.classList.add('scrolled');
    } else {
        header.classList.remove('scrolled');
    }

    lastScroll = currentScroll;
});
