/**
 * A short message that floats up from `anchor` at the click position and fades out
 * ("Copied!", "Loaded!"). Styled by .copy-toast.
 */
export function showToast(text: string, container: HTMLElement, anchor: HTMLElement, event: MouseEvent) {
    const toast = document.createElement("div");
    toast.className = "copy-toast";
    toast.textContent = text;
    container.append(toast);
    const top = anchor.getBoundingClientRect().top;
    toast.style.left = `${event.pageX - toast.offsetWidth / 2}px`;
    toast.style.top = `${top}px`;
    toast
        .animate([{ top: `${top}px`, opacity: 0 }, { top: `${top - 25}px`, opacity: 1 }], {
            duration: 300,
            easing: "ease-in-out",
            fill: "forwards",
        })
        .finished.then(() =>
            toast.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" }).finished
        )
        .then(() => toast.remove());
}
