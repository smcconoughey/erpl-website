document.addEventListener('DOMContentLoaded', loadArchive);

async function loadArchive() {
    const grid = document.getElementById('archiveGrid');
    if (!grid) return;

    try {
        const response = await fetch('data/projects.json');
        if (!response.ok) throw new Error('Unable to load project archive');

        const projects = await response.json();
        const archived = projects
            .filter(project => project.archive)
            .sort((a, b) => (a.archiveOrder || 0) - (b.archiveOrder || 0));

        grid.innerHTML = archived.map(renderArchiveProject).join('');
    } catch (error) {
        console.error(error);
        grid.innerHTML = '<p class="archive-error">The project archive could not be loaded.</p>';
    }
}

function renderArchiveProject(project) {
    const image = project.images?.[0] || project.image;
    const details = project.details || {};
    const specs = details.specs ? renderSpecs(details.specs) : '';

    return `
        <article class="archive-card" id="${project.id}">
            <div class="archive-card-image">
                <img src="${image}" alt="${project.name}" loading="lazy" onerror="this.style.display='none'">
            </div>
            <div class="archive-card-content">
                <div class="archive-card-meta">
                    <span>${details.status || 'Past Program'}</span>
                    <span>${String(project.archiveOrder).padStart(2, '0')}</span>
                </div>
                <h2>${project.name}</h2>
                <p class="archive-card-summary">${project.description}</p>
                <p>${details.about || ''}</p>
                ${specs}
            </div>
        </article>
    `;
}

function renderSpecs(specs) {
    const labels = {
        thrust: 'Thrust',
        chamberPressure: 'Chamber Pressure',
        massFlowRate: 'Mass Flow Rate',
        mixtureRatio: 'Mixture Ratio',
        injectionType: 'Injection Type',
        oxidizerFlowRate: 'Oxidizer Flow Rate'
    };

    return `
        <dl class="archive-specs">
            ${Object.entries(specs).map(([key, value]) => `
                <div>
                    <dt>${labels[key] || key}</dt>
                    <dd>${value}</dd>
                </div>
            `).join('')}
        </dl>
    `;
}
