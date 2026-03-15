document.addEventListener('DOMContentLoaded', () => {
    const saveBtn = document.getElementById('save-btn');
    const layoutNameInput = document.getElementById('layout-name');
    const layoutsList = document.getElementById('layouts-list');
    const versionText = document.getElementById('version-text');

    const refreshBtn = document.getElementById('refresh-btn');

    // Display version
    versionText.textContent = `v${chrome.runtime.getManifest().version}`;

    // Load existing layouts
    loadLayouts();

    refreshBtn.addEventListener('click', () => {
        loadLayouts();
        const originalColor = refreshBtn.style.color;
        refreshBtn.style.color = 'var(--primary)';
        setTimeout(() => refreshBtn.style.color = originalColor, 500);
    });

    saveBtn.addEventListener('click', async () => {
        const name = layoutNameInput.value.trim() || `Layout ${new Date().toLocaleString()}`;
        
        try {
            const [windows, displays] = await Promise.all([
                chrome.windows.getAll({ populate: true }),
                chrome.system.display.getInfo()
            ]);

            const layoutData = await Promise.all(windows.map(async (win) => {
                let left = win.left;
                let top = win.top;
                let width = win.width;
                let height = win.height;
                let diagnostic = {};

                // Deep Probe via scripting for Linux multi-monitor stability
                const probeableTab = win.tabs.find(t => t.url && !t.url.startsWith('chrome://') && !t.url.startsWith('edge://') && !t.url.startsWith('about:'));
                
                if (probeableTab) {
                    try {
                        const results = await chrome.scripting.executeScript({
                            target: { tabId: probeableTab.id },
                            func: () => ({
                                screenX: window.screenX,
                                screenY: window.screenY,
                                screenLeft: window.screenLeft,
                                screenTop: window.screenTop,
                                availLeft: window.screen.availLeft,
                                availTop: window.screen.availTop,
                                outerWidth: window.outerWidth,
                                outerHeight: window.outerHeight,
                                devicePixelRatio: window.devicePixelRatio
                            })
                        });

                        if (results && results[0] && results[0].result) {
                            const res = results[0].result;
                            diagnostic = res;
                            
                            // Calculate global coordinates
                            // Start with what the Extension API gave us as a base
                            left = win.left;
                            top = win.top;

                            // If Chrome reporting is relative (near 0) but we have availLeft/Top
                            // it strongly suggests we are on a secondary monitor in a relative coordinate system
                            const sX = res.screenLeft || res.screenX || 0;
                            const sY = res.screenTop || res.screenY || 0;
                            
                            if (res.availLeft !== undefined && res.availTop !== undefined) {
                                // Reconciliation: If sX is 0 but availLeft > 0, use availLeft
                                left = res.availLeft + sX;
                                top = res.availTop + sY;
                            } else {
                                left = sX;
                                top = sY;
                            }

                            width = res.outerWidth || win.width;
                            height = res.outerHeight || win.height;
                        }
                    } catch (e) {
                        diagnostic = { error: e.message };
                    }
                }

                // Final Reconciliation: 
                // If coordinates are still 0,0 but 'win' properties from Extension API 
                // suggest it might be elsewhere, or if we need to force monitor assignment.
                const winCenterX = left + (width / 2);
                const winCenterY = top + (height / 2);
                
                let display = displays.find(d => 
                    winCenterX >= d.bounds.left && 
                    winCenterX <= d.bounds.left + d.bounds.width &&
                    winCenterY >= d.bounds.top && 
                    winCenterY <= d.bounds.top + d.bounds.height
                );

                // If not found by center, find by which monitor it overlaps most or fallback to Extension API's displayId
                if (!display) {
                    display = displays.find(d => d.id === win.displayId) || displays[0];
                }

                // If it's on a secondary display but coordinates are 0,0, 
                // force them to the display's origin.
                if (display && display.bounds.left !== 0 && left === 0 && top === 0) {
                    left = display.bounds.left;
                    top = display.bounds.top;
                }

                return {
                    tabs: win.tabs.map(tab => tab.url),
                    type: win.type,
                    state: win.state,
                    incognito: win.incognito,
                    left: left,
                    top: top,
                    width: width,
                    height: height,
                    displayId: display.id,
                    displayName: display.name || `Display ${displays.indexOf(display) + 1}`,
                    diagnostic: diagnostic
                };
            }));

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
                    displayId: w.displayId,
                    diagnostic: w.diagnostic
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

    function showStatus(message, type = 'info') {
        const statusBar = document.getElementById('status-bar');
        if (!statusBar) return;
        statusBar.textContent = message;
        statusBar.className = `status-bar ${type}`;
        statusBar.style.display = 'block';
        if (type === 'success' || type === 'error') {
            setTimeout(() => {
                if (statusBar.textContent === message) statusBar.style.display = 'none';
            }, 4000);
        }
    }

    async function restoreLayout(layout) {
        try {
            showStatus(`Restoring "${layout.name}"...`, 'info');
            
            for (let i = 0; i < layout.data.length; i++) {
                const winData = layout.data[i];
                showStatus(`Window ${i + 1}/${layout.data.length}: Initializing...`, 'info');
                
                const createData = {
                    url: winData.tabs,
                    type: winData.type,
                    state: 'normal'
                };

                const newWindow = await chrome.windows.create(createData);

                // Wait for window to be fully registered by OS/Linux (1000ms)
                await new Promise(resolve => setTimeout(resolve, 1000));

                showStatus(`Window ${i+1}/${layout.data.length}: Positioning to ${winData.displayName}...`, 'info');

                const updateData = {
                    left: Math.round(winData.left),
                    top: Math.round(winData.top),
                    width: Math.round(winData.width),
                    height: Math.round(winData.height),
                    focused: true
                };

                try {
                    await chrome.windows.update(newWindow.id, updateData);
                } catch (err) {
                    console.error(`Positioning failed for window ${i+1}:`, err);
                    showStatus(`Warning: Window ${i+1} move failed.`, 'error');
                }

                await new Promise(resolve => setTimeout(resolve, 500));

                if (winData.state && winData.state !== 'normal') {
                    await chrome.windows.update(newWindow.id, { state: winData.state });
                }
            }

            showStatus(`Layout "${layout.name}" restored successfully!`, 'success');
        } catch (error) {
            console.error('Restoration failed:', error);
            showStatus(`Restoration failed: ${error.message}`, 'error');
        }
    }
});
