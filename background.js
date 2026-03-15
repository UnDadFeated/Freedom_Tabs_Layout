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
            
            // STEALTH CREATION: Create unfocused and as normal window
            const createData = {
                url: winData.tabs,
                type: winData.type || 'normal',
                state: 'normal',
                focused: false
            };

            const newWindow = await chrome.windows.create(createData);

            // RELIABILITY: Wait for window to be fully registered by OS/Linux (1000ms)
            await new Promise(resolve => setTimeout(resolve, 1000));

            await updateStatus(`Window ${i+1}/${layout.data.length}: Positioning to ${winData.displayName}...`, 'info');

            // ATOMIC MOVE: Combine position, size, and focus in one call
            const updateData = {
                left: Math.round(winData.left),
                top: Math.round(winData.top),
                width: Math.round(winData.width),
                height: Math.round(winData.height),
                focused: true // Now we can focus it as it lands
            };

            try {
                await chrome.windows.update(newWindow.id, updateData);
            } catch (err) {
                console.error(`Positioning failed for window ${i+1}:`, err);
                await updateStatus(`Warning: Window ${i+1} move failed.`, 'error');
            }

            // Let it settle
            await new Promise(resolve => setTimeout(resolve, 500));

            // Apply final state (Maximized/Minimized)
            if (winData.state && winData.state !== 'normal') {
                await chrome.windows.update(newWindow.id, { state: winData.state });
            }
            
            // Wait slightly before starting next window to prevent overwhelming the Window Manager
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        await updateStatus(`Layout "${layout.name}" restored successfully!`, 'success');
    } catch (error) {
        console.error('Restoration failed:', error);
        await updateStatus(`Restoration failed: ${error.message}`, 'error');
    }
}
