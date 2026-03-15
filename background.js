chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'RESTORE_LAYOUT') {
        restoreLayout(request.layout);
        return true; // Keep message channel open for async status
    }
});

async function updateStatus(message, type = 'info') {
    // We use storage to communicate status back to the popup if it's open
    await chrome.storage.local.set({ 
        lastStatus: { message, type, timestamp: Date.now() } 
    });
}

async function restoreLayout(layout) {
    try {
        await updateStatus(`Restoring "${layout.name}"...`, 'info');
        
        for (let i = 0; i < layout.data.length; i++) {
            const winData = layout.data[i];
            await updateStatus(`Window ${i+1}/${layout.data.length}: Bursting to ${winData.displayName}...`, 'info');
            
            // 1. Create window with tabs IMMEDIATELY (Faster)
            const createData = {
                url: winData.tabs,
                type: winData.type || 'normal',
                left: Math.round(winData.left),
                top: Math.round(winData.top),
                width: Math.round(winData.width),
                height: Math.round(winData.height),
                focused: false
            };

            const newWindow = await chrome.windows.create(createData);

            // 2. PULSE POSITIONING: Brute-force shove
            // We call update 8 times over 2 seconds to overcome Linux "Smart Placement" cascading.
            for (let pulse = 0; pulse < 8; pulse++) {
                try {
                    await chrome.windows.update(newWindow.id, {
                        left: Math.round(winData.left),
                        top: Math.round(winData.top),
                        width: Math.round(winData.width),
                        height: Math.round(winData.height)
                    });
                } catch (e) {
                    console.warn(`Pulse ${pulse} failed:`, e);
                }
                await new Promise(resolve => setTimeout(resolve, 250));
            }

            // 3. APPLY STATE: Final maximized/minimized state
            if (winData.state && winData.state !== 'normal') {
                await chrome.windows.update(newWindow.id, { state: winData.state });
            }
            
            // 4. SEQUENTIAL LOCK: Faster cooldown (1s)
            if (i < layout.data.length - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }

        // Final focus on the last window
        const allWindows = await chrome.windows.getAll();
        if (allWindows.length > 0) {
            await chrome.windows.update(allWindows[allWindows.length - 1].id, { focused: true });
        }

        await updateStatus(`Layout "${layout.name}" restored successfully!`, 'success');
    } catch (error) {
        console.error('Restoration failed:', error);
        await updateStatus(`Restoration failed: ${error.message}`, 'error');
    }
}
