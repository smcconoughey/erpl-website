// Opt-in light theme. The default stylesheet remains active and unchanged.
(() => {
    const stylesheet = document.getElementById('tensionStylesheet');
    const storageKey = 'erpl-theme';
    let light = false;
    try { light = localStorage.getItem(storageKey) === 'light'; } catch (_) { /* storage may be disabled */ }

    function applyTheme(enabled) {
        light = enabled;
        stylesheet.media = enabled ? 'all' : 'not all';
        document.documentElement.style.colorScheme = enabled ? 'light' : 'dark';
        const button = document.getElementById('themeToggle');
        if (button) {
            const label = enabled ? 'Switch to dark mode' : 'Switch to light mode';
            button.setAttribute('aria-label', label);
            button.setAttribute('title', label);
            button.setAttribute('aria-pressed', String(enabled));
            button.innerHTML = enabled ? '◑ <span>DARK</span>' : '◐ <span>LIGHT</span>';
        }
    }

    applyTheme(light);
    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(light);
        document.getElementById('themeToggle')?.addEventListener('click', () => {
            applyTheme(!light);
            try { localStorage.setItem(storageKey, light ? 'light' : 'dark'); } catch (_) { /* session-only preference */ }
        });
    });
})();
