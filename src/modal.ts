// modal.ts — confirm dialog for Bronzeman Mode

let modalCallback: (() => void) | null = null;

export function showModal(message: string, level: "SAFE" | "WARNING" | "DANGER" | "INFO", onConfirm: () => void): void {
    const modal = document.getElementById("modal");
    const content = document.getElementById("modal_content");
    const msgEl = document.getElementById("modal_msg");
    if (!modal || !content || !msgEl) return;
    msgEl.textContent = message;
    content.className = "modal-content" + (level === "WARNING" ? " level-warning" : level === "DANGER" ? " level-danger" : level === "INFO" ? " level-info" : "");
    modalCallback = onConfirm;
    modal.style.display = "flex";
}

export function modalCancel(): void {
    const modal = document.getElementById("modal");
    if (modal) modal.style.display = "none";
    modalCallback = null;
}

export function modalOk(): void {
    const modal = document.getElementById("modal");
    if (modal) modal.style.display = "none";
    if (modalCallback) {
        const cb = modalCallback;
        modalCallback = null;
        cb();
    }
}
