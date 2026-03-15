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
            await updateStatus(`Window ${i+1}/${layout.data.length}: Anchoring ghost window...`, 'info');
            
            // 1. Create BLANK window first at target coordinates
            // Empty URL array ensures the window manager isn't "busy" during initial placement.
            const createData = {
                url: 'about:blank',
                type: winData.type || 'normal',
                left: Math.round(winData.left),
                top: Math.round(winData.top),
                width: Math.round(winData.width),
                height: Math.round(winData.height),
                focused: false
            };

            const newWindow = await chrome.windows.create(createData);
            const initialTabId = newWindow.tabs[0].id;

            // 2. MONITOR SETTLE: Heavy wait for Linux Window Manager to "anchor" the empty window (2000ms)
            await new Promise(resolve => setTimeout(resolve, 2000));

            await updateStatus(`Window ${i+1}/${layout.data.length}: Populating ${winData.tabs.length} tabs...`, 'info');

            // 3. POPULATE TABS: Create the saved tabs in the ghost window
            for (const url of winData.tabs) {
                await chrome.tabs.create({
                    windowId: newWindow.id,
                    url: url,
                    active: false // Keep them in background to reduce window manager signals
                });
                // Micro-delay between tabs for responsiveness
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            // 4. CLEANUP: Close the initial about:blank tab
            await chrome.tabs.remove(initialTabId);

            // 5. FINALIZE POSITION: One last attempt to correct any "smart placement" shift
            try {
                await chrome.windows.update(newWindow.id, {
                    left: Math.round(winData.left),
                    top: Math.round(winData.top),
                    width: Math.round(winData.width),
                    height: Math.round(winData.height)
                });
            } catch (err) {
                console.warn(`Final coordinate check failed:`, err);
            }

            // 6. APPLY STATE: Final maximized/minimized state
            if (winData.state && winData.state !== 'normal') {
                await new Promise(resolve => setTimeout(resolve, 800));
                await chrome.windows.update(newWindow.id, { state: winData.state });
            }
            
            // 7. SEQUENTIAL LOCK: Give the OS 3 full seconds to breathe before next window
            if (i < layout.data.length - 1) {
                await updateStatus(`Window ${i+1} complete. Waiting for OS sync...`, 'info');
                await new Promise(resolve => setTimeout(resolve, 3000));
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
