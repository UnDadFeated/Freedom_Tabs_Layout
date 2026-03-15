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
            await updateStatus(`Window ${i + 1}/${layout.data.length}: Initializing...`, 'info');
            
            // DIRECT POSITIONING: Pass coordinates directly to create call
            // Linux window managers are more likely to respect this than a subsequent update.
            const createData = {
                url: winData.tabs,
                type: winData.type || 'normal',
                left: Math.round(winData.left),
                top: Math.round(winData.top),
                width: Math.round(winData.width),
                height: Math.round(winData.height),
                focused: false // Keep it unfocused while others are being created
            };

            const newWindow = await chrome.windows.create(createData);

            // Give it time to exist
            await new Promise(resolve => setTimeout(resolve, 1500));

            // If the positioning failed or was overridden, try one forced update
            try {
                await chrome.windows.update(newWindow.id, {
                    left: Math.round(winData.left),
                    top: Math.round(winData.top),
                    width: Math.round(winData.width),
                    height: Math.round(winData.height)
                });
            } catch (err) {
                console.warn(`Retry update failed for window ${i+1}:`, err);
            }

            // Apply final state (Maximized/Minimized) after positioning is settled
            if (winData.state && winData.state !== 'normal') {
                await new Promise(resolve => setTimeout(resolve, 500));
                await chrome.windows.update(newWindow.id, { state: winData.state });
            }
            
            // Sequential delay to prevent races
            await new Promise(resolve => setTimeout(resolve, 800));
        }

        // Final focus on the last window to signal completion
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
