document.addEventListener('DOMContentLoaded', () => {
    const saveBtn = document.getElementById('save-btn');
    const layoutNameInput = document.getElementById('layout-name');
    const layoutsList = document.getElementById('layouts-list');
    const versionText = document.getElementById('version-text');

    // Display version
    versionText.textContent = `v${chrome.runtime.getManifest().version}`;

    // Load existing layouts
    loadLayouts();

    saveBtn.addEventListener('click', async () => {
        const name = layoutNameInput.value.trim() || `Layout ${new Date().toLocaleString()}`;
        
        try {
            const [windows, displays] = await Promise.all([
                chrome.windows.getAll({ populate: true }),
                chrome.system.display.getInfo()
            ]);

            const layoutData = windows.map(win => {
                // Find which display this window is primarily on
                const winCenterX = win.left + (win.width / 2);
                const winCenterY = win.top + (win.height / 2);
                
                const display = displays.find(d => 
                    winCenterX >= d.bounds.left && 
                    winCenterX <= d.bounds.left + d.bounds.width &&
                    winCenterY >= d.bounds.top && 
                    winCenterY <= d.bounds.top + d.bounds.height
                ) || displays[0];

                return {
                    tabs: win.tabs.map(tab => tab.url),
                    type: win.type,
                    state: win.state,
                    incognito: win.incognito,
                    left: win.left,
                    top: win.top,
                    width: win.width,
                    height: win.height,
                    displayId: display.id,
                    displayName: display.name || `Display ${displays.indexOf(display) + 1}`
                };
            });

            let savedLayouts = await getStoredLayouts();
            
            // Filter out any existing layout with the same name (case-insensitive) to prevent duplicates
            savedLayouts = savedLayouts.filter(l => l.name.toLowerCase() !== name.toLowerCase());

            savedLayouts.push({
                id: Date.now().toString(),
                name: name,
                timestamp: new Date().toISOString(),
                displaySetup: displays,
                data: layoutData
            });

            await chrome.storage.local.set({ layouts: savedLayouts });
            layoutNameInput.value = '';
            loadLayouts();
            
            // Informative feedback without using alert()
            const originalText = saveBtn.textContent;
            saveBtn.textContent = 'Saved!';
            saveBtn.classList.add('success');
            setTimeout(() => {
                saveBtn.textContent = originalText;
                saveBtn.classList.remove('success');
            }, 2000);

        } catch (error) {
            // Silently handle or log to a custom UI element if needed
            saveBtn.textContent = 'Error Saving';
            saveBtn.classList.add('error');
            setTimeout(() => {
                saveBtn.textContent = 'Save Current Layout';
                saveBtn.classList.remove('error');
            }, 3000);
        }
    });

    async function getStoredLayouts() {
        return new Promise((resolve) => {
            chrome.storage.local.get(['layouts'], (result) => {
                resolve(result.layouts || []);
            });
        });
    }

    async function loadLayouts() {
        const layouts = await getStoredLayouts();
        layoutsList.innerHTML = '';

        if (layouts.length === 0) {
            layoutsList.innerHTML = '<div class="empty-state">No layouts saved yet.</div>';
            return;
        }

        // Sort by timestamp descending
        layouts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        layouts.forEach(layout => {
            const item = document.createElement('div');
            item.className = 'layout-item';
            
            const windowCount = layout.data.length;
            const tabCount = layout.data.reduce((acc, win) => acc + win.tabs.length, 0);
            const monitorNames = [...new Set(layout.data.map(win => win.displayName))].join(', ');
            
            // Build a small coordinate summary for debugging
            const coordsInfo = layout.data.map(w => `[${w.left},${w.top}]`).join(' ');

            const debugJson = JSON.stringify({ 
                displays: layout.displaySetup || [], 
                windows: layout.data.map(w => ({ 
                    left: w.left, 
                    top: w.top, 
                    width: w.width, 
                    height: w.height, 
                    monitor: w.displayName,
                    displayId: w.displayId
                }))
            }, null, 2);

            item.innerHTML = `
                <div class="layout-info">
                    <span class="layout-name-text">${layout.name}</span>
                    <span class="layout-meta">${windowCount} windows on ${monitorNames} • ${tabCount} tabs</span>
                    <button class="debug-toggle">Show Debug Info</button>
                    <div class="debug-info">
                        <div class="debug-text">${debugJson}</div>
                        <button class="copy-debug-btn">Copy Debug Data</button>
                    </div>
                </div>
                <div class="layout-actions">
                    <button class="icon-btn delete-btn" title="Delete" data-id="${layout.id}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                    </button>
                </div>
            `;

            // Debug toggle functionality
            const debugToggle = item.querySelector('.debug-toggle');
            const debugInfo = item.querySelector('.debug-info');
            const copyBtn = item.querySelector('.copy-debug-btn');

            debugToggle.addEventListener('click', (e) => {
                e.stopPropagation();
                const isHidden = debugInfo.style.display === 'none' || !debugInfo.style.display;
                debugInfo.style.display = isHidden ? 'block' : 'none';
                debugToggle.textContent = isHidden ? 'Hide Debug Info' : 'Show Debug Info';
            });

            copyBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                navigator.clipboard.writeText(debugJson).then(() => {
                    const originalText = copyBtn.textContent;
                    copyBtn.textContent = 'Copied!';
                    setTimeout(() => copyBtn.textContent = originalText, 2000);
                });
            });

            // Restore layout on click (except if clicking delete/debug/copy)
            item.addEventListener('click', (e) => {
                if (!e.target.closest('.delete-btn') && !e.target.closest('.debug-toggle') && !e.target.closest('.copy-debug-btn')) {
                    restoreLayout(layout);
                }
            });

            // Delete functionality
            const deleteBtn = item.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (confirm(`Delete layout "${layout.name}"?`)) {
                    const currentLayouts = await getStoredLayouts();
                    const updatedLayouts = currentLayouts.filter(l => l.id !== layout.id);
                    await chrome.storage.local.set({ layouts: updatedLayouts });
                    loadLayouts();
                }
            });

            layoutsList.appendChild(item);
        });
    }

    async function restoreLayout(layout) {
        try {
            for (const winData of layout.data) {
                // Filter out restricted/empty URLs that might cause issues
                const validUrls = winData.tabs.filter(url => 
                    url && !url.startsWith('chrome://') && !url.startsWith('edge://')
                );

                if (validUrls.length === 0) continue;

                // Prepare window creation options (Always start 'normal' to ensure move works)
                const createData = {
                    url: validUrls,
                    type: winData.type || 'normal',
                    state: 'normal', 
                    incognito: winData.incognito || false
                };

                // Create the window
                const newWindow = await chrome.windows.create(createData);

                // Delay to ensure window is initialized
                await new Promise(resolve => setTimeout(resolve, 600));

                // Stage 1: Move to target Monitor coordinates (X, Y only)
                if (winData.left !== undefined || winData.top !== undefined) {
                    await chrome.windows.update(newWindow.id, {
                        left: winData.left,
                        top: winData.top,
                        state: 'normal'
                    });
                    
                    // Small delay after move
                    await new Promise(resolve => setTimeout(resolve, 300));
                }

                // Stage 2: Set precise Width and Height
                if (winData.width !== undefined || winData.height !== undefined) {
                    await chrome.windows.update(newWindow.id, {
                        width: winData.width,
                        height: winData.height
                    });
                    
                    // Small delay after resize
                    await new Promise(resolve => setTimeout(resolve, 300));
                }

                // Stage 3: Apply final state (Maximized/Minimized)
                if (winData.state && winData.state !== 'normal') {
                    await chrome.windows.update(newWindow.id, { state: winData.state });
                }
            }
        } catch (error) {
            // Error handling without generic alerts
        }
    }
});
